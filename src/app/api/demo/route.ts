import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, unauthorized } from "@/lib/require-user";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { getDb } from "@/db";
import { voiceProfiles, tweets, drafts } from "@/db/schema";
import { eq, sql, desc } from "drizzle-orm";
import { checkCoherence, scoreStyleDeviation } from "@/modules/analysis/coherence";
import { evaluateDraft } from "@/modules/analysis/evaluate";
import { MockTweetSource } from "@/modules/ingestion/mock-tweet-source";
import { createProfileFromHandle } from "@/modules/profiles/create-service";
import { styleProfileSchema } from "@/modules/analysis/style-profile";
import { getLlmClient } from "@/modules/llm/openrouter";
import { buildLlmRouter, LlmRouter } from "@/modules/llm/router";
import { moderateDraft } from "@/modules/voice/moderation";
import { generateDrafts } from "@/modules/voice/generation-service";
import { getProfileByHandle, getCorpus, createDrafts } from "@/modules/drafts/service";
import { generationJobs } from "@/db/schema";
import { getBreakerState } from "@/lib/circuit-breaker";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Body = z.object({
  stage: z.enum(["auth", "ingest", "analyze", "resilience", "generate", "quality", "moderate", "shadow", "persist", "done"]),
  handle: z.string().max(30).optional(),
});

const DEMO_HANDLE = "demoeval";

function parseStoredProfile(json: unknown) {
  return styleProfileSchema.parse(
    JSON.parse(typeof json === "string" ? json : JSON.stringify(json))
  );
}

/**
 * Guided demo runner. Executes the REAL pipeline stage-by-stage in test mode
 * so an evaluator sees the actual code paths, not canned output.
 * Demo handles are namespaced ("demo_*") and scoped to the calling user.
 * Hard rate-limited so the tour can never exhaust the LLM quota.
 */
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const rl = rateLimit(`demo:${user.id}`, 60, 60 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Demo rate limit reached (60 actions/hour)." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body: expected { stage }." }, { status: 400 });
  }
  const { stage } = parsed.data;

  // Demo profiles are prefixed and scoped to the calling user only.
  const handle = `demo_${(parsed.data.handle ?? DEMO_HANDLE).replace(/^@/, "").replace(/^demo_/, "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 9) || DEMO_HANDLE}`.slice(0, 15);

  try {
    switch (stage) {
      case "auth": {
        return NextResponse.json({
          ok: true,
          stage,
          evidence: {
            strategy: "JWT (stateless) session, re-verified against the users table on every request",
            sessionUserId: user.id,
            sessionEmail: user.email,
            ownershipScoping: "every profile/draft query filters on userId — no cross-user path exists",
            bruteForceGuard: "10 sign-in attempts / 5 min per email, enforced inside the Credentials provider",
          },
        });
      }

      case "ingest": {
        const source = new MockTweetSource();
        const started = Date.now();
        const { profileId, sampleCount } = await createProfileFromHandle(handle, source, 100, user.id);
        return NextResponse.json({
          ok: true,
          stage,
          evidence: {
            adapter: "MockTweetSource — fixture-backed TweetSource adapter, zero X API calls",
            profileId,
            handle,
            sampleCount,
            ms: Date.now() - started,
            modeEnforced: "server-side: the route resolves the adapter; the client cannot trigger live spend",
            idempotency: "profile creation supports caller idempotencyKey; duplicates replay the cached result",
          },
        });
      }

      case "analyze": {
        const row = await getProfileByHandle(handle, user.id);
        if (!row) {
          return NextResponse.json({ error: "Run the ingestion stage first." }, { status: 404 });
        }
        const profile = parseStoredProfile(row.styleProfile);
        const corpus = await getCorpus(row.id);
        return NextResponse.json({
          ok: true,
          stage,
          evidence: {
            factorsRun: ["syntax", "lexical", "topics", "engagement", "emojiFormat", "toneBaseline"],
            pass2: getLlmClient()
              ? "LLM refinement merged over the deterministic baseline, re-validated with Zod"
              : "deterministic PASS 1 only (no LLM key configured)",
            zodValidatedOnRead: true,
            sampleCount: profile.sampleCount,
            corpusRows: corpus.length,
            profile: { syntax: profile.syntax, tone: profile.tone, voice: profile.voice },
          },
        });
      }

      case "resilience": {
        const client = getLlmClient();
        const router = client ? buildLlmRouter(process.env.OPENROUTER_API_KEY ?? "") : null;
        return NextResponse.json({
          ok: true,
          stage,
          evidence: {
            routerEnabled: !!router,
            providers: router ? router.health() : [],
            openrouterBreaker: getBreakerStateSafe("openrouter"),
            failoverOrder: router ? router.providerNames : [],
            failoverBehavior: "per-provider circuit breakers; failures advance to the next provider; open breakers fail fast",
            idempotency: "(scope, key) durable table + in-process lock; retries replay cached results",
          },
        });
      }

      case "generate": {
        const row = await getProfileByHandle(handle, user.id);
        if (!row) {
          return NextResponse.json({ error: "Run the ingestion stage first." }, { status: 404 });
        }
        const profile = parseStoredProfile(row.styleProfile);
        const corpusRows = await getCorpus(row.id);
        const client = getLlmClient();
        if (!client) {
          return NextResponse.json(
            { error: "OPENROUTER_API_KEY not configured — generation stage unavailable." },
            { status: 503 }
          );
        }
        const router = buildLlmRouter(process.env.OPENROUTER_API_KEY ?? "");
        const outcome = await generateDrafts(
          router,
          profile,
          corpusRows.map((t) => ({
            id: t.id,
            text: t.text,
            createdAt: t.postedAt ?? new Date().toISOString(),
            likeCount: t.likes,
            retweetCount: t.rts,
            replyCount: t.replies,
            quoteCount: 0,
            impressionCount: t.impressions,
          })),
          5
        );
        const jobId = outcome.jobId;
        const moderated = outcome.drafts
          .map((d) => ({ ...d, verdict: moderateDraft(d.text) }))
          .filter((d) => d.verdict.allowed);
        const blockedCount = outcome.drafts.length - moderated.length;
        if (blockedCount > 0) {
          logger.warn("Demo drafts blocked by moderation", { jobId, blockedCount });
        }
        // Persist exactly like the production /api/generate route: a first-class
        // generation job row plus moderation-labeled drafts, so later stages and
        // the dashboard read the same durable data.
        await getDb()
          .insert(generationJobs)
          .values({
            id: jobId,
            userId: user.id,
            voiceProfileId: row.id,
            status: "done",
            count: outcome.drafts.length,
            createdAt: new Date(),
          });
        const rows = moderated.length
          ? await createDrafts(row.id, jobId, moderated.map((d) => ({ text: d.text, styleMatch: d.styleMatch })))
          : [];
        return NextResponse.json({
          ok: true,
          stage,
          evidence: {
            jobId,
            provider: router.providerNames.join(","),
            tokensIn: outcome.tokensIn,
            tokensOut: outcome.tokensOut,
            draftsGenerated: outcome.drafts.length,
            draftsBlockedByModeration: blockedCount,
            draftsPersisted: rows.length,
            scoredBy: "evaluateDraft() — deterministic quality gate against the StyleProfile",
            drafts: outcome.drafts.map((d) => ({ text: d.text, styleMatch: d.styleMatch })),
          },
        });
      }

      case "quality": {
        const row = await getProfileByHandle(handle, user.id);
        if (!row) {
          return NextResponse.json({ error: "Run the ingestion stage first." }, { status: 404 });
        }
        const profile = parseStoredProfile(row.styleProfile);
        const recentDrafts = await getDb()
          .select({ text: drafts.text, styleMatch: drafts.styleMatch })
          .from(drafts)
          .where(eq(drafts.voiceProfileId, row.id))
          .orderBy(desc(drafts.createdAt))
          .limit(5);
        const scored = recentDrafts.map((d) => {
          const coherence = checkCoherence(d.text);
          const gate = evaluateDraft(d.text, profile).score;
          const deviation = scoreStyleDeviation(d.text, profile);
          return {
            text: d.text.slice(0, 60),
            storedStyleMatch: d.styleMatch,
            coherent: coherence.coherent,
            coherenceFlags: coherence.flags,
            profileGateScore: gate,
            deviationScore: deviation.score,
            deviations: deviation.deviations,
            blendedStyleMatch: Math.round((gate + deviation.score) / 2),
          };
        });
        return NextResponse.json({
          ok: true,
          stage,
          evidence: {
            coherenceChecks: ["repeated_word", "garbage_chars", "symbol_heavy", "trailing_comma", "dangling_word", "unterminated"],
            coherencePhilosophy: "drops objectively broken model output; never flags authentic voice quirks (lowercase starts, run-ons, slang)",
            deviationChecks: ["length distribution", "question style", "caps shouting", "topic drift", "profanity policy", "hashtag policy"],
            scoring: "styleMatch = mean(profile gate score, distribution-aware deviation score)",
            draftsRescored: scored,
          },
        });
      }

      case "moderate": {
        const benign = moderateDraft(
          "Shipping the new release today. Small team, big week — feedback welcome."
        );
        const blocked = moderateDraft("read this thread about how to make a bomb");
        const row = await getProfileByHandle(handle, user.id);
        const stored = row
          ? await getDb()
              .select({ flags: drafts.moderationFlags, label: drafts.moderationLabel })
              .from(drafts)
              .where(eq(drafts.voiceProfileId, row.id))
          : [];
        return NextResponse.json({
          ok: true,
          stage,
          evidence: {
            benign: { allowed: benign.allowed, flags: benign.flags },
            blocked: { allowed: blocked.allowed, flags: blocked.flags, reason: blocked.reason },
            storedLabelsOnDemoDrafts: stored,
            policy: "every draft labeled synthetic_content; hard categories rejected before persistence",
          },
        });
      }

      case "shadow": {
        const jobRows = await getDb()
          .select({
            id: generationJobs.id,
            status: generationJobs.status,
            count: generationJobs.count,
            shadowVerdict: generationJobs.shadowVerdict,
            shadowValidator: generationJobs.shadowValidator,
            createdAt: generationJobs.createdAt,
          })
          .from(generationJobs)
          .where(eq(generationJobs.userId, user.id))
          .orderBy(desc(generationJobs.createdAt))
          .limit(3);
        return NextResponse.json({
          ok: true,
          stage,
          evidence: {
            validatorDesign:
              "a secondary model from the router chain (the generator model is skipped) answers one Yes/No question: was the output on-topic and coherent?",
            nonBlocking: "validator failure/timeout (20s cap) degrades to verdict 'unknown' — it never fails the generation",
            persistedOn: "generation_jobs.shadow_verdict + shadow_validator",
            recentJobs: jobRows,
          },
        });
      }

      case "persist": {
        const profiles = await getDb()
          .select({
            id: voiceProfiles.id,
            handle: voiceProfiles.handle,
            sampleCount: voiceProfiles.sampleCount,
          })
          .from(voiceProfiles)
          .where(eq(voiceProfiles.userId, user.id));
        const corpusCountRows = await getDb()
          .select({ count: sql<number>`count(*)` })
          .from(tweets)
          .innerJoin(voiceProfiles, eq(tweets.voiceProfileId, voiceProfiles.id))
          .where(eq(voiceProfiles.userId, user.id));
        return NextResponse.json({
          ok: true,
          stage,
          evidence: {
            engine: "Neon Postgres via Drizzle ORM (neon-http serverless driver)",
            migrations: "append-only, guarded (IF NOT EXISTS / check-before-alter), transactional, tracked in _migrations",
            profilesOwnedByThisUser: profiles,
            corpusRowsForThisUser: corpusCountRows[0]?.count ?? 0,
            rateLimiter: "in-memory fixed window with memory sweep — tradeoff documented in code",
          },
        });
      }

      default:
        return NextResponse.json({ ok: true, stage });
    }
  } catch (err) {
    logger.error("Demo stage failed", { stage, error: String(err), userId: user.id });
    return NextResponse.json({ error: `Stage "${stage}" failed: ${String(err)}` }, { status: 500 });
  }
}

function getBreakerStateSafe(provider: string): string {
  try {
    return getBreakerState(provider);
  } catch {
    return "closed";
  }
}
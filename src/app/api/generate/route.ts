import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { generationJobs } from "@/db/schema";
import { getProfileByHandle, getCorpus, createDrafts } from "@/modules/drafts/service";
import { getLlmClient } from "@/modules/llm/openrouter";
import { buildLlmRouter } from "@/modules/llm/router";
import { moderateDraft } from "@/modules/voice/moderation";
import { generateDrafts, MissingKeyError } from "@/modules/voice/generation-service";
import { styleProfileSchema } from "@/modules/analysis/style-profile";
import { logger } from "@/lib/logger";
import { requireUser, unauthorized } from "@/lib/require-user";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const rl = rateLimit(`generate:${user.id}`, 20, 60 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit: max 20 generations per hour. Try again later." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  try {
    const body = (await req.json()) as { handle?: string; count?: number; topic?: string };
    const count = Math.min(8, Math.max(1, body.count ?? 5));
    const profileRow = body.handle
      ? await getProfileByHandle(body.handle, user.id) // scoped to this user
      : undefined;
    if (!profileRow) {
      return NextResponse.json({ error: "Profile not found — create one first." }, { status: 404 });
    }
    const profile = styleProfileSchema.parse(
      JSON.parse(typeof profileRow.styleProfile === "string" ? profileRow.styleProfile : JSON.stringify(profileRow.styleProfile))
    );
    const corpusRows = await getCorpus(profileRow.id);
    const corpus = corpusRows.map((t) => ({
      id: t.id,
      text: t.text,
      createdAt: t.postedAt ?? new Date().toISOString(),
      likeCount: t.likes,
      retweetCount: t.rts,
      replyCount: t.replies,
      quoteCount: 0,
      impressionCount: t.impressions,
    }));

    const client = getLlmClient();
    if (!client) {
      const jobId = randomUUID();
      await getDb().insert(generationJobs).values({
        id: jobId,
        userId: user.id,
        voiceProfileId: profileRow.id,
        status: "failed",
        error: "OPENROUTER_API_KEY missing",
        count,
        createdAt: new Date(),
      });
      return NextResponse.json(
        {
          error:
            "Generation unavailable: OPENROUTER_API_KEY is not configured. Add it to .env and restart.",
          jobId,
        },
        { status: 503 }
      );
    }

    const job = { id: randomUUID(), status: "running" as const };
    await getDb().insert(generationJobs).values({
      id: job.id,
      userId: user.id,
      voiceProfileId: profileRow.id,
      status: "running",
      count,
      createdAt: new Date(),
    });

    try {
      // Route through provider-failover router: primary + fallback free models,
      // each with its own circuit breaker. Chain order from bake-off (Sep 2026):
      // nex-n2.5-pro 3/3 valid @ 11-14s; nemotron-3-ultra 2/3; dots-3-note 1/3.
      const router = buildLlmRouter(process.env.OPENROUTER_API_KEY!);
      const outcome = await generateDrafts(router, profile, corpus, count, body.topic);
      const moderated = outcome.drafts.filter((d) => moderateDraft(d.text).allowed);
      const blockedCount = outcome.drafts.length - moderated.length;
      if (blockedCount > 0) {
        logger.warn("Drafts blocked by moderation", { jobId: job.id, blockedCount });
      }
      const rows = moderated.length ? await createDrafts(profileRow.id, job.id, moderated) : [];
      await getDb().update(generationJobs).set({ status: "done" }).where(eq(generationJobs.id, job.id));
      return NextResponse.json({
        ok: true,
        jobId: job.id,
        count: rows.length,
        blockedCount,
        drafts: rows.map((d) => ({
          id: d.id,
          text: d.text,
          styleMatch: d.styleMatch,
          status: d.status,
          moderationFlags: d.moderationFlags,
          moderationLabel: d.moderationLabel,
        })),
      });
    } catch (err) {
      if (err instanceof MissingKeyError) throw err;
      await getDb().update(generationJobs).set({ status: "failed", error: String(err) }).where(eq(generationJobs.id, job.id));
      throw err;
    }
  } catch (err) {
    logger.error("Generation failed", { error: String(err), userId: user.id });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
import { randomUUID } from "crypto";
import type { StyleProfile } from "../analysis/style-profile";
import type { RawTweet } from "../ingestion/ports/tweet-source";
import { generationJobRepository } from "../../repositories";
import { moderateDraft } from "./moderation";
import { generateDrafts, MissingKeyError } from "./generation-service";
import { runShadowValidation } from "../llm/shadow-validator";
import { buildLlmRouter, LlmRouter } from "../llm/router";
import { recordSpend } from "../llm/token-ledger";
import { createDrafts } from "../drafts/service";
import { logger } from "../../lib/logger";

/**
 * Generation orchestration service: owns the full generate → validate →
 * moderate → persist pipeline. Controllers call this; it interacts with
 * the DB only through the repository layer.
 */

export interface GenerateForHandleResult {
  jobId: string;
  blockedCount: number;
  drafts: Array<{
    id: string;
    text: string;
    styleMatch: number;
    status: string;
    moderationFlags: string[];
    moderationLabel: string | null;
  }>;
  shadowValidation: { verdict: string; validator: string | null };
}

export async function runGenerationForProfile(
  userId: string,
  profileId: string,
  profile: StyleProfile,
  corpus: RawTweet[],
  count: number,
  topic?: string
): Promise<GenerateForHandleResult> {
  const jobId = randomUUID();
  await generationJobRepository.insert({
    id: jobId,
    userId,
    voiceProfileId: profileId,
    status: "running",
    error: null,
    count,
    shadowVerdict: null,
    shadowValidator: null,
    createdAt: new Date(),
  });

  let result;
  try {
    // Route through provider-failover router: primary + fallback free models,
    // each with its own circuit breaker.
    const router = buildLlmRouter(process.env.OPENROUTER_API_KEY ?? "");
    const outcome = await generateDrafts(router, profile, corpus, count, topic);

    // Token ledger: durable per-user spend record (survives cold starts,
    // unlike in-process metrics). Best-effort — never fails the request.
    await recordSpend({
      userId,
      provider: outcome.provider,
      tokensIn: outcome.tokensIn,
      tokensOut: outcome.tokensOut,
    });

    // Shadow validation ("LLM madness validator"): an independent secondary
    // model answers Yes/No whether the primary's output was on-topic and
    // coherent. Non-blocking: failure degrades to 'unknown', never an error.
    const shadow = await runShadowValidation(
      router.getProviders(),
      topic
        ? `Write ${count} short tweets in this person's voice about: ${topic}`
        : `Write ${count} short tweets in this person's natural voice`,
      outcome.drafts.map((d) => d.text),
      outcome.provider
    );

    const moderated = outcome.drafts.filter((d) => moderateDraft(d.text).allowed);
    const blockedCount = outcome.drafts.length - moderated.length;
    if (blockedCount > 0) {
      logger.warn("Drafts blocked by moderation", { jobId, blockedCount });
    }
    const rows = moderated.length ? await createDrafts(profileId, jobId, moderated) : [];
    await generationJobRepository.update(jobId, {
      status: "done",
      shadowVerdict: shadow.verdict,
      shadowValidator: shadow.validator,
    });

    return {
      jobId,
      blockedCount,
      drafts: rows.map((d) => ({
        id: d.id,
        text: d.text,
        styleMatch: d.styleMatch,
        status: d.status,
        moderationFlags: d.moderationFlags ?? [],
        moderationLabel: d.moderationLabel,
      })),
      shadowValidation: { verdict: shadow.verdict, validator: shadow.validator },
    };
  } catch (err) {
    if (err instanceof MissingKeyError) throw err;
    await generationJobRepository.update(jobId, { status: "failed", error: String(err) });
    throw err;
  }
}

// Re-exported so controllers can reference the router type without importing
// router internals directly.
export type { LlmRouter };

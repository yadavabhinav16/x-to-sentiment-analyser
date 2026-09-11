import { randomUUID } from "crypto";
import type { StyleProfile } from "../analysis/style-profile";
import type { RawTweet } from "../ingestion/ports/tweet-source";
import { buildSystemPrompt, buildDraftRequestPrompt, selectExemplars } from "./prompt-builder";
import { extractJson, type LlmClient } from "../llm/openrouter";
import { evaluateDraft } from "../analysis/evaluate";
import { checkCoherence, scoreStyleDeviation } from "../analysis/coherence";
import { logger } from "../../lib/logger";

export interface GenerationOutcome {
  drafts: Array<{ text: string; styleMatch: number }>;
  jobId: string;
  tokensIn: number;
  tokensOut: number;
  /** Which router provider produced the output (for shadow-validation independence). */
  provider: string;
}

export class MissingKeyError extends Error {
  constructor() {
    super("LLM generation unavailable: OPENROUTER_API_KEY is not configured.");
  }
}

export async function generateDrafts(
  client: LlmClient,
  profile: StyleProfile,
  corpus: RawTweet[],
  count: number,
  topicNudge?: string
): Promise<GenerationOutcome> {
  const jobId = randomUUID();
  const exemplars = selectExemplars(corpus, profile);
  const system = buildSystemPrompt(profile, exemplars);
  const user = buildDraftRequestPrompt(profile, count, topicNudge);

  logger.info("Generation started", { jobId, handle: profile.handle, count });
  const messages = [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];

  // Retry on malformed LLM output: free models intermittently return empty or
  // truncated bodies even in JSON mode (observed ~1/3 on some models). The
  // router handles provider-level failover; this handles transient bad output.
  let result;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      result = await client.complete(messages, { jsonMode: true, maxTokens: 4000 });
      extractJson(result.content) as { drafts?: unknown }; // validate parsability
      break;
    } catch (err) {
      lastErr = err;
      if (attempt === 3) throw err;
      logger.warn("Generation attempt failed; retrying", { jobId, attempt, error: String(err) });
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }

  const parsed = extractJson(result!.content) as { drafts?: unknown };
  const texts = Array.isArray(parsed.drafts) ? parsed.drafts : [];
  if (!texts.length) throw new Error("LLM returned no drafts");

  // Quality gate: structural coherence first (drops broken model output),
  // then blended style score: original profile gate + distribution-aware
  // deviation scoring. Combined = mean of the two, floored at 0.
  const drafts = texts
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim())
    .filter((t) => {
      const coh = checkCoherence(t);
      if (!coh.coherent) {
        logger.warn("Draft failed coherence check; dropping", { jobId, flags: coh.flags });
        return false;
      }
      return true;
    })
    .slice(0, count)
    .map((text) => {
      const gate = evaluateDraft(text, profile).score;
      const dev = scoreStyleDeviation(text, profile).score;
      return { text, styleMatch: Math.round((gate + dev) / 2) };
    });

  // Quality floor: drafts scoring below 55/100 on the blended style score are
  // dropped before persistence — the generated set should never include
  // off-voice material just because it survived coherence checks.
  const QUALITY_FLOOR = 55;
  const kept = drafts.filter((d) => d.styleMatch >= QUALITY_FLOOR);
  const dropped = drafts.length - kept.length;
  if (dropped > 0) {
    logger.warn("Drafts dropped below quality floor", { jobId, dropped, floor: QUALITY_FLOOR });
  }

  logger.info("Generation complete", {
    jobId,
    drafts: kept.length,
    tokensIn: result!.tokensIn,
    tokensOut: result!.tokensOut,
  });
  return { drafts: kept, jobId, tokensIn: result!.tokensIn, tokensOut: result!.tokensOut, provider: (result as { provider?: string }).provider ?? "unknown" };
}

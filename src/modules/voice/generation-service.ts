import { randomUUID } from "crypto";
import type { StyleProfile } from "../analysis/style-profile";
import type { RawTweet } from "../ingestion/ports/tweet-source";
import { buildSystemPrompt, buildDraftRequestPrompt, selectExemplars } from "./prompt-builder";
import { extractJson, type LlmClient } from "../llm/openrouter";
import { evaluateDraft } from "../analysis/evaluate";
import { logger } from "../../lib/logger";

export interface GenerationOutcome {
  drafts: Array<{ text: string; styleMatch: number }>;
  jobId: string;
  tokensIn: number;
  tokensOut: number;
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

  const drafts = texts
    .filter((t): t is string => typeof t === "string")
    .slice(0, count)
    .map((text) => ({
      text: text.trim(),
      styleMatch: evaluateDraft(text.trim(), profile).score,
    }));

  logger.info("Generation complete", {
    jobId,
    drafts: drafts.length,
    tokensIn: result!.tokensIn,
    tokensOut: result!.tokensOut,
  });
  return { drafts, jobId, tokensIn: result!.tokensIn, tokensOut: result!.tokensOut };
}

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
  const result = await client.complete(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { jsonMode: true, maxTokens: 2000 }
  );

  const parsed = extractJson(result.content) as { drafts?: unknown };
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
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  });
  return { drafts, jobId, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
}

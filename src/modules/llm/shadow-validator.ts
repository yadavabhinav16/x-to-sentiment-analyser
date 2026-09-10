import type { LlmClient } from "./openrouter";
import { logger } from "../../lib/logger";

/**
 * Shadow validation layer ("LLM madness validator").
 *
 * After the primary model generates drafts, a SECONDARY model (next in the
 * router chain — cheaper/different family) independently answers one question
 * with Yes/No: did the primary sensibly do the task (on-topic, coherent)?
 *
 * Design properties:
 * - NON-BLOCKING for availability: a failed/unavailable validator never fails
 *   the generation (degrades to no-op, logged). Validation is a quality signal,
 *   not a gate — the deterministic gates (coherence, moderation, styleMatch)
 *   remain the hard filters.
 * - Verdict is recorded on the generation job for observability.
 * - Uses the router's failover chain skipping the model that produced the
 *   output (independent judge), with a 20s timeout so demos never hang.
 */

export interface ShadowVerdict {
  verdict: "yes" | "no" | "unknown";
  validator: string | null;
  latencyMs: number;
}

const VALIDATOR_SYSTEM =
  "You are a strict output validator. You will be given a task description " +
  "and an AI's attempt at it. Judge ONLY whether the output is on-topic and " +
  "coherent (makes sense, no nonsense, no contradictions, no gibberish). " +
  "Do NOT judge style, voice, or quality of writing. " +
  'Respond ONLY with JSON: {"answer":"yes"} or {"answer":"no"}.';

export function buildShadowValidatorPrompt(
  task: string,
  output: string[]
): { system: string; user: string } {
  return {
    system: VALIDATOR_SYSTEM,
    user: `TASK: ${task}\n\nOUTPUT:\n${output
      .map((d, i) => `${i + 1}. ${d}`)
      .join("\n")}\n\nWas this output on-topic and coherent? Answer yes or no.`,
  };
}

function extractAnswer(raw: string): "yes" | "no" | null {
  const m = raw.toLowerCase().match(/"(?:answer|verdict)"\s*:\s*"(yes|no)"/);
  if (m) return m[1] as "yes" | "no";
  // tolerate bare yes/no outputs
  const bare = raw.trim().toLowerCase();
  if (bare === "yes" || bare.startsWith("yes")) return "yes";
  if (bare === "no" || bare.startsWith("no")) return "no";
  return null;
}

/**
 * Run the shadow validation. `clients` are candidate validators (model slug +
 * client), tried in order, skipping any that equals the generator model.
 * Never throws — returns verdict 'unknown' on any failure.
 */
export async function runShadowValidation(
  validators: Array<{ name: string; client: LlmClient }>,
  task: string,
  output: string[],
  generatorModel: string
): Promise<ShadowVerdict> {
  const t0 = Date.now();
  for (const v of validators) {
    if (v.name === generatorModel) continue; // independence: don't self-validate
    try {
      const prompt = buildShadowValidatorPrompt(task, output);
      const result = await Promise.race([
        v.client.complete(
          [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
          ],
          { jsonMode: true, maxTokens: 200 }
        ),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error("shadow validation timeout")), 20_000)
        ),
      ]);
      const answer = extractAnswer(result.content);
      if (answer) {
        const latencyMs = Date.now() - t0;
        logger.info("Shadow validation verdict", {
          validator: v.name,
          generator: generatorModel,
          verdict: answer,
          latencyMs,
        });
        return { verdict: answer, validator: v.name, latencyMs };
      }
      logger.warn("Shadow validator returned unparseable answer; trying next", {
        validator: v.name,
        raw: result.content.slice(0, 120),
      });
    } catch (err) {
      logger.warn("Shadow validator failed; trying next", {
        validator: v.name,
        error: String(err),
      });
    }
  }
  logger.warn("Shadow validation unavailable for this generation", {
    generator: generatorModel,
  });
  return { verdict: "unknown", validator: null, latencyMs: Date.now() - t0 };
}
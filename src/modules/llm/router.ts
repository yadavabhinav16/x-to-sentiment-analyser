import type { LlmClient, LlmMessage, LlmResult } from "./openrouter";
import { OpenRouterClient } from "./openrouter";
import { logger } from "../../lib/logger";
import {
  allowRequest,
  recordFailure,
  recordSuccess,
  getBreakerState,
} from "../../lib/circuit-breaker";

/**
 * LLM router with provider failover.
 *
 * Wraps a list of provider clients in priority order. Each provider gets its
 * own circuit breaker; failures advance to the next provider. When every
 * provider is open/exhausted, throws AllProvidersFailedError.
 */

export class AllProvidersFailedError extends Error {
  constructor(public attempts: Array<{ provider: string; error: string }>) {
    super(
      `All LLM providers failed: ${attempts
        .map((a) => `${a.provider} (${a.error})`)
        .join("; ")}`
    );
    this.name = "AllProvidersFailedError";
  }
}

export class ProviderOpenError extends Error {
  constructor(public provider: string) {
    super(`LLM provider "${provider}" circuit breaker is open — failing fast.`);
    this.name = "ProviderOpenError";
  }
}

export interface RoutedProvider {
  name: string;
  client: LlmClient;
  /** Lower = tried first. */
  priority: number;
}

export interface RouterResult extends LlmResult {
  provider: string;
  attempts: Array<{ provider: string; error: string }>;
}

export class LlmRouter {
  constructor(private providers: RoutedProvider[]) {
    this.providers = [...providers].sort((a, b) => a.priority - b.priority);
  }

  get providerNames(): string[] {
    return this.providers.map((p) => p.name);
  }

  async complete(
    messages: LlmMessage[],
    opts?: { jsonMode?: boolean; maxTokens?: number }
  ): Promise<RouterResult> {
    const attempts: Array<{ provider: string; error: string }> = [];

    for (const provider of this.providers) {
      if (!allowRequest(provider.name)) {
        attempts.push({ provider: provider.name, error: "circuit open" });
        continue;
      }
      try {
        const result = await provider.client.complete(messages, opts);
        recordSuccess(provider.name);
        return { ...result, provider: provider.name, attempts };
      } catch (err) {
        const { opened } = recordFailure(provider.name);
        attempts.push({ provider: provider.name, error: String(err) });
        logger.warn("LLM provider failed; failing over", {
          provider: provider.name,
          error: String(err),
          breakerOpened: opened,
        });
      }
    }

    throw new AllProvidersFailedError(attempts);
  }

  /** Health snapshot for diagnostics/tests. */
  health(): Array<{ provider: string; state: string }> {
    return this.providers.map((p) => ({
      provider: p.name,
      state: getBreakerState(p.name),
    }));
  }
}

/** Default provider chain when LLM_PROVIDERS is unset. */
export const DEFAULT_LLM_CHAIN =
  "z-ai/glm-5.3-flash,nex-agi/nex-n2.5-pro:free,nvidia/nemotron-3-ultra-550b-a55b:free";

/**
 * Parse a comma-separated provider chain string into slugs.
 * Trims whitespace, drops empties, dedupes.
 */
export function parseLlmChain(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const slug = part.trim();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }
  return out;
}

/**
 * Build an LlmRouter from the LLM_PROVIDERS env var (comma-separated model
 * slugs, tried in order). Falls back to LLM_MODEL (deprecated single model),
 * then to DEFAULT_LLM_CHAIN. Each provider is an OpenRouterClient named by
 * its slug, with priority = position in the chain (lower = first).
 */
export function buildLlmRouter(
  apiKey: string = process.env.OPENROUTER_API_KEY ?? ""
): LlmRouter {
  const raw =
    process.env.LLM_PROVIDERS ??
    (process.env.LLM_MODEL ? process.env.LLM_MODEL : DEFAULT_LLM_CHAIN);
  const slugs = parseLlmChain(raw);
  const providers: RoutedProvider[] = slugs.map((slug, i) => ({
    name: slug,
    client: new OpenRouterClient(apiKey, slug),
    priority: i + 1,
  }));
  return new LlmRouter(providers);
}
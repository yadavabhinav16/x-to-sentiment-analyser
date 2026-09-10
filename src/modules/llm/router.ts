import type { LlmClient, LlmMessage, LlmResult } from "./openrouter";
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
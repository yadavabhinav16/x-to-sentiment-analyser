import { describe, it, expect, beforeEach } from "vitest";
import { LlmRouter, AllProvidersFailedError } from "../src/modules/llm/router";
import type { LlmClient, LlmResult } from "../src/modules/llm/openrouter";
import { resetBreakers } from "../src/lib/circuit-breaker";

function fakeClient(
  impl?: (msgs: unknown[], opts?: unknown) => Promise<LlmResult>
): LlmClient {
  return {
    complete: impl ?? (async () => ({ content: "ok", tokensIn: 1, tokensOut: 1 })),
  };
}

const msgs = [{ role: "user" as const, content: "hi" }];

describe("LlmRouter", () => {
  beforeEach(() => resetBreakers());

  it("uses the highest-priority healthy provider", async () => {
    const router = new LlmRouter([
      { name: "backup", client: fakeClient(), priority: 2 },
      { name: "primary", client: fakeClient(), priority: 1 },
    ]);
    const res = await router.complete(msgs);
    expect(res.provider).toBe("primary");
  });

  it("fails over to the backup when the primary throws", async () => {
    const failing = fakeClient(async () => {
      throw new Error("503 upstream");
    });
    const router = new LlmRouter([
      { name: "primary", client: failing, priority: 1 },
      { name: "backup", client: fakeClient(), priority: 2 },
    ]);
    const res = await router.complete(msgs);
    expect(res.provider).toBe("backup");
    expect(res.attempts).toHaveLength(1);
    expect(res.attempts[0].provider).toBe("primary");
  });

  it("skips providers with an open breaker (fail-fast) without calling them", async () => {
    const failing = fakeClient(async () => {
      throw new Error("down");
    });
    const router = new LlmRouter([
      { name: "dead", client: failing, priority: 1 },
      { name: "backup", client: fakeClient(), priority: 2 },
    ]);
    // trip the breaker for "dead"
    for (let i = 0; i < 5; i++) await router.complete(msgs);
    const health = router.health();
    expect(health.find((h) => h.provider === "dead")?.state).toBe("open");
    // still reaches backup
    const res = await router.complete(msgs);
    expect(res.provider).toBe("backup");
  });

  it("throws AllProvidersFailedError when every provider fails", async () => {
    const failing = fakeClient(async () => {
      throw new Error("down");
    });
    const router = new LlmRouter([
      { name: "a", client: failing, priority: 1 },
      { name: "b", client: failing, priority: 2 },
    ]);
    await expect(router.complete(msgs)).rejects.toBeInstanceOf(AllProvidersFailedError);
  });
});
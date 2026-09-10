import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";
import { withIdempotency, getCompleted, IdempotencyConflictError } from "../src/modules/llm/idempotency";

// DB is the real Neon Postgres (DATABASE_URL from .env.local via vitest setup).
// Isolation is provided by unique (scope, key) pairs — a random run prefix
// keeps concurrent CI runs from colliding. No live X API / OpenRouter calls.
const runId = randomUUID().slice(0, 8);

describe("withIdempotency", () => {
  it("executes once and caches the result", async () => {
    const scope = `${runId}-scope1`;
    let calls = 0;
    const run = async () => ({ n: ++calls, id: "abc" });
    const first = await withIdempotency(scope, "key1", run);
    expect(first.value).toEqual({ n: 1, id: "abc" });
    const second = await withIdempotency(scope, "key1", run);
    expect(second.record).not.toBeNull();
    expect(second.value).toEqual({ n: 1, id: "abc" });
    expect(calls).toBe(1);
  });

  it("caches per (scope, key)", async () => {
    let calls = 0;
    const run = async () => ++calls;
    await withIdempotency(`${runId}-s1`, "k", run);
    const r2 = await withIdempotency(`${runId}-s2`, "k", run);
    expect(r2.value).toBe(2);
  });

  it("throws IdempotencyConflictError while in progress", async () => {
    const scope = `${runId}-sc`;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = async () => {
      await gate;
      return "done";
    };
    const p = withIdempotency(scope, "conc", slow);
    await new Promise((r) => setTimeout(r, 10));
    await expect(withIdempotency(scope, "conc", slow)).rejects.toBeInstanceOf(
      IdempotencyConflictError
    );
    release();
    await expect(p).resolves.toBeTruthy();
  });

  it("allows retry after failure", async () => {
    const scope = `${runId}-sf`;
    const failing = async () => {
      throw new Error("boom");
    };
    await expect(withIdempotency(scope, "k", failing)).rejects.toThrow("boom");
    const ok = await withIdempotency(scope, "k", async () => "recovered");
    expect(ok.value).toBe("recovered");
  });

  it("getCompleted returns parsed result", async () => {
    const scope = `${runId}-sg`;
    await withIdempotency(scope, "k", async () => ({ x: 42 }));
    expect(await getCompleted<{ x: number }>(scope, "k")).toEqual({ x: 42 });
    expect(await getCompleted(scope, "missing")).toBeNull();
  });
});

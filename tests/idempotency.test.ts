import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "crypto";
import type { FakeDbState } from "./helpers/fake-db";

// DB-backed module under test runs against the shared in-memory fake —
// zero live database, never prod. (vi.mock is hoisted above the const, so
// the state must be created inside vi.hoisted.)
const { state } = vi.hoisted(() => ({ state: {} as FakeDbState }));
vi.mock("../src/db", async () => {
  const { makeDbMock } = await import("./helpers/fake-db");
  return makeDbMock(state);
});

import {
  withIdempotency,
  getCompleted,
  IdempotencyConflictError,
} from "../src/modules/llm/idempotency";

const runId = randomUUID().slice(0, 8);

describe("withIdempotency", () => {
  beforeEach(() => {
    for (const k of Object.keys(state)) delete state[k];
  });

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

  it("TOCTOU: a concurrent second caller cannot overwrite the in_progress row (DB-level claim)", async () => {
    const scope = `${runId}-race`;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = async () => {
      await gate;
      return "first";
    };
    const p1 = withIdempotency(scope, "race", slow);
    await new Promise((r) => setTimeout(r, 5));
    // Second caller with the same key: must conflict, not execute.
    let calls = 0;
    await expect(
      withIdempotency(scope, "race", async () => {
        calls++;
        return "second";
      })
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(calls).toBe(0);
    release();
    await expect(p1).resolves.toMatchObject({ value: "first" });
    // The row must record exactly one completed execution.
    const row = state["idempotency_keys"]?.[0];
    expect(row).toMatchObject({ scope, status: "completed" });
    expect(state["idempotency_keys"]).toHaveLength(1);
  });
});

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { withIdempotency, getCompleted, IdempotencyConflictError } from "../src/modules/llm/idempotency";

// Redirect the app DB to a temp file before importing schema's getDb.
const dir = mkdtempSync(join(tmpdir(), "idem-"));
process.chdir(dir);

let dbPath: string;
beforeEach(() => {
  // fresh module per test not needed; scope+key provide isolation
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("withIdempotency", () => {
  it("executes once and caches the result", async () => {
    let calls = 0;
    const run = async () => ({ n: ++calls, id: "abc" });
    const first = await withIdempotency("scope1", "key1", run);
    expect(first.value).toEqual({ n: 1, id: "abc" });
    const second = await withIdempotency("scope1", "key1", run);
    expect(second.record).not.toBeNull();
    expect(second.value).toEqual({ n: 1, id: "abc" });
    expect(calls).toBe(1);
  });

  it("caches per (scope, key)", async () => {
    let calls = 0;
    const run = async () => ++calls;
    await withIdempotency("s1", "k", run);
    const r2 = await withIdempotency("s2", "k", run);
    expect(r2.value).toBe(2);
  });

  it("throws IdempotencyConflictError while in progress", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = async () => {
      await gate;
      return "done";
    };
    const p = withIdempotency("sc", "conc", slow);
    await new Promise((r) => setTimeout(r, 10));
    await expect(withIdempotency("sc", "conc", slow)).rejects.toBeInstanceOf(
      IdempotencyConflictError
    );
    release();
    await expect(p).resolves.toBeTruthy();
  });

  it("allows retry after failure", async () => {
    const failing = async () => {
      throw new Error("boom");
    };
    await expect(withIdempotency("sf", "k", failing)).rejects.toThrow("boom");
    const ok = await withIdempotency("sf", "k", async () => "recovered");
    expect(ok.value).toBe("recovered");
  });

  it("getCompleted returns parsed result", async () => {
    await withIdempotency("sg", "k", async () => ({ x: 42 }));
    expect(getCompleted<{ x: number }>("sg", "k")).toEqual({ x: 42 });
    expect(getCompleted("sg", "missing")).toBeNull();
  });
});
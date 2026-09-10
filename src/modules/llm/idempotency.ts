import { getDb } from "../../db";
import { idempotencyKeys } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "../../lib/logger";

/**
 * Idempotency for profile creation and LLM calls.
 *
 * Pattern: caller supplies a client-generated key; the first request executes
 * and caches its result under the key; repeated requests with the same
 * (scope, key) return the cached result without re-executing. Failures are
 * recorded and may be retried.
 *
 * The (scope, key) primary key in idempotency_keys is the durable backstop;
 * an in-process map guards against duplicate concurrent execution.
 */

export interface IdempotencyRow {
  key: string;
  scope: string;
  status: "in_progress" | "completed" | "failed";
  result: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class IdempotencyConflictError extends Error {
  constructor(scope: string, key: string) {
    super(
      `Request with idempotency key "${key}" (${scope}) is already in progress.`
    );
    this.name = "IdempotencyConflictError";
  }
}

const inFlight = new Set<string>();

async function row(scope: string, key: string): Promise<IdempotencyRow | undefined> {
  const rows = await getDb()
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)))
    .limit(1);
  return rows[0] as IdempotencyRow | undefined;
}

export async function withIdempotency<T>(
  scope: string,
  key: string,
  fn: () => Promise<T>
): Promise<{ record: IdempotencyRow | null; value?: T }> {
  const lockId = `${scope}:${key}`;
  const existing = await row(scope, key);

  if (existing?.status === "completed") {
    return {
      record: existing,
      value: existing.result !== null ? JSON.parse(existing.result) : undefined,
    };
  }
  if (existing?.status === "in_progress" || inFlight.has(lockId)) {
    throw new IdempotencyConflictError(scope, key);
  }
  if (inFlight.has(lockId)) throw new IdempotencyConflictError(scope, key);
  inFlight.add(lockId);

  const now = new Date();
  const db = getDb();
  await db.insert(idempotencyKeys)
    .values({ scope, key, status: "in_progress", createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [idempotencyKeys.scope, idempotencyKeys.key],
      set: { status: "in_progress", error: null, result: null, updatedAt: now },
    });

  try {
    const value = await fn();
    await db.update(idempotencyKeys)
      .set({ status: "completed", result: JSON.stringify(value), updatedAt: new Date() })
      .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));
    return { record: null, value };
  } catch (err) {
    await db.update(idempotencyKeys)
      .set({ status: "failed", error: String(err), updatedAt: new Date() })
      .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));
    throw err;
  } finally {
    inFlight.delete(lockId);
  }
}

/** Look up a completed result (parsed), or null. */
export async function getCompleted<T>(scope: string, key: string): Promise<T | null> {
  const r = await row(scope, key);
  if (!r || r.status !== "completed" || r.result === null) return null;
  return JSON.parse(r.result) as T;
}

void logger;
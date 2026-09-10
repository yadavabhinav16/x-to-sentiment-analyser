import { idempotencyRepository } from "../../repositories";
import type { IdempotencyRow } from "../../db/schema";
import { logger } from "../../lib/logger";

/**
 * Idempotency for profile creation and LLM calls.
 *
 * Pattern: caller supplies a client-generated key; the first request executes
 * and caches its result under the key; repeated requests with the same
 * (scope, key) return the cached result without re-executing. Failures are
 * recorded and may be retried.
 *
 * Concurrency safety (TOCTOU): the lock is acquired by an INSERT with
 * ON CONFLICT DO NOTHING, and ownership is decided by the affected row
 * count — exactly one concurrent caller wins the insert. There is no
 * check-then-act window: a second caller can never overwrite the winner's
 * in_progress row (the previous onConflictDoUpdate allowed exactly that,
 * causing duplicate LLM execution). The in-process Set is only a fast-path
 * guard for same-instance duplicates; the DB constraint is the durable
 * backstop across instances.
 *
 * DB access goes through the IdempotencyRepository interface; the Drizzle
 * implementation is wired in src/repositories/index.ts.
 */

export type { IdempotencyRow } from "../../db/schema";

export class IdempotencyConflictError extends Error {
  constructor(scope: string, key: string) {
    super(
      `Request with idempotency key "${key}" (${scope}) is already in progress.`
    );
    this.name = "IdempotencyConflictError";
  }
}

const inFlight = new Set<string>();

async function row(scope: string, key: string) {
  return idempotencyRepository.find(scope, key);
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
  // A failed row from a previous run is reclaimable: delete it so the
  // insert-if-absent claim below can win.
  if (existing?.status === "failed") {
    await idempotencyRepository.delete(scope, key);
  }

  // Atomically claim the key: insert-if-absent. affected rows = 0 means a
  // concurrent caller holds the in_progress row (or completed it between our
  // read and now) — re-read and replay/conflict accordingly.
  inFlight.add(lockId);
  const now = new Date();
  let claimed = false;
  try {
    const inserted = await idempotencyRepository.claim({
      scope,
      key,
      status: "in_progress",
      result: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    });
    claimed = inserted.length > 0;
  } finally {
    if (!claimed) inFlight.delete(lockId);
  }

  if (!claimed) {
    // Lost the race: re-read to distinguish "replay a freshly completed
    // result" from "still in progress → conflict".
    const raced = await row(scope, key);
    if (raced?.status === "completed") {
      return {
        record: raced,
        value: raced.result !== null ? JSON.parse(raced.result) : undefined,
      };
    }
    throw new IdempotencyConflictError(scope, key);
  }

  try {
    const value = await fn();
    await idempotencyRepository.update(scope, key, {
      status: "completed",
      result: JSON.stringify(value),
      updatedAt: new Date(),
    });
    return { record: null, value };
  } catch (err) {
    logger.warn("Idempotent operation failed", { scope, key, error: String(err) });
    await idempotencyRepository.update(scope, key, {
      status: "failed",
      error: String(err),
      updatedAt: new Date(),
    });
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

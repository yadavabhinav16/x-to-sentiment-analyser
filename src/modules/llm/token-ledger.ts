import { randomUUID } from "crypto";
import { getDb } from "@/db";
import { sql } from "drizzle-orm";
import { logger } from "@/lib/logger";

/**
 * Token ledger + FinOps guard: every LLM call is recorded (user, provider,
 * tokens), per-user budget caps are enforced BEFORE the call, and a global
 * kill switch can hard-disable all paid LLM paths.
 *
 * Budget caps are read from env (no redeploy needed to change via Vercel env):
 *   TOKEN_CAP_HOURLY  — max tokens/hour/user  (default 200_000)
 *   TOKEN_CAP_DAILY   — max tokens/day/user   (default 2_000_000)
 *   LLM_KILL_SWITCH   — "true" rejects every LLM call with 503-style error
 */

export interface LedgerEntry {
  userId: string;
  provider: string;
  tokensIn: number;
  tokensOut: number;
}

export class BudgetExceededError extends Error {
  constructor(public window: "hourly" | "daily", public used: number, public cap: number) {
    super(`Token budget exceeded (${window}): ${used}/${cap} tokens used this ${window}.`);
    this.name = "BudgetExceededError";
  }
}

export class KillSwitchError extends Error {
  constructor() {
    super("LLM calls are disabled by the kill switch (LLM_KILL_SWITCH=true).");
    this.name = "KillSwitchError";
  }
}

export function killSwitchActive(): boolean {
  return process.env.LLM_KILL_SWITCH === "true";
}

function caps(): { hourly: number; daily: number } {
  return {
    hourly: Number(process.env.TOKEN_CAP_HOURLY ?? 200_000),
    daily: Number(process.env.TOKEN_CAP_DAILY ?? 2_000_000),
  };
}

/** The real Neon/Drizzle handle has .execute; the test fake may not. */
function rawExec(): ((q: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }>) | null {
  const db = getDb() as unknown as {
    execute?: (q: unknown) => Promise<{ rows: unknown[] }>;
  };
  return typeof db.execute === "function" ? db.execute.bind(db) : null;
}

/**
 * Check the user's spend against hourly/daily caps. Throws
 * BudgetExceededError when over. Called BEFORE the paid call.
 *
 * Fail-open policy: if the ledger itself is unavailable (missing table, DB
 * hiccup) the check logs and ALLOWS the call — an observability/FinOps guard
 * must never take down the core generate feature. The only hard gate is the
 * explicit kill switch.
 */
export async function assertWithinBudget(userId: string): Promise<void> {
  if (killSwitchActive()) throw new KillSwitchError();
  try {
    const exec = rawExec();
    if (!exec) return; // test fake path — no enforcement possible
    const { hourly, daily } = caps();
    const rows = await exec(sql`
      SELECT
        COALESCE(SUM(CASE WHEN created_at > now() - interval '1 hour' THEN tokens_in + tokens_out ELSE 0 END), 0) AS used_hour,
        COALESCE(SUM(CASE WHEN created_at > now() - interval '24 hours' THEN tokens_in + tokens_out ELSE 0 END), 0) AS used_day
      FROM token_ledger
      WHERE user_id = ${userId}
    `);
    const usedHour = Number((rows.rows[0] as { used_hour: number })?.used_hour ?? 0);
    const usedDay = Number((rows.rows[0] as { used_day: number })?.used_day ?? 0);
    if (usedHour >= hourly) throw new BudgetExceededError("hourly", usedHour, hourly);
    if (usedDay >= daily) throw new BudgetExceededError("daily", usedDay, daily);
  } catch (err) {
    if (err instanceof BudgetExceededError || err instanceof KillSwitchError) throw err;
    logger.error("Token budget check failed; allowing generation (fail-open)", {
      userId,
      error: String(err),
    });
  }
}

/** Record a completed LLM call. Never throws — ledger failures don't break generation. */
export async function recordSpend(entry: LedgerEntry): Promise<void> {
  try {
    const exec = rawExec();
    if (!exec) return; // test fake path — no ledger table
    await exec(sql`
      INSERT INTO token_ledger (id, user_id, provider, tokens_in, tokens_out, created_at)
      VALUES (${randomUUID()}, ${entry.userId}, ${entry.provider}, ${entry.tokensIn}, ${entry.tokensOut}, now())
    `);
  } catch (err) {
    // Ledger is best-effort observability; a failed insert must not fail the request.
    logger.warn("Token ledger insert failed", { error: String(err), entry });
  }
}

/** Spend summary for a user (last 24h + last hour). */
export async function spendSummary(userId: string): Promise<{
  lastHour: number;
  last24h: number;
  caps: { hourly: number; daily: number };
  byProvider24h: Array<{ provider: string; tokens: number; calls: number }>;
}> {
  const { hourly, daily } = caps();
  const exec = rawExec();
  if (!exec) {
    return { lastHour: 0, last24h: 0, caps: { hourly, daily }, byProvider24h: [] };
  }
  const rows = await exec(sql`
    SELECT provider,
           SUM(tokens_in + tokens_out) AS tokens,
           COUNT(*) AS calls,
           COALESCE(SUM(CASE WHEN created_at > now() - interval '1 hour' THEN tokens_in + tokens_out ELSE 0 END), 0) AS last_hour
    FROM token_ledger
    WHERE user_id = ${userId} AND created_at > now() - interval '24 hours'
    GROUP BY provider
  `);
  let last24h = 0;
  let lastHour = 0;
  const byProvider24h = (rows.rows as Array<{ provider: string; tokens: string; calls: string; last_hour: string }>).map((r) => {
    last24h += Number(r.tokens);
    lastHour += Number(r.last_hour);
    return { provider: r.provider, tokens: Number(r.tokens), calls: Number(r.calls) };
  });
  return { lastHour, last24h, caps: { hourly, daily }, byProvider24h };
}

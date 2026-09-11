import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { getBreakerState } from "@/lib/circuit-breaker";
import { snapshot } from "@/lib/metrics";
import { killSwitchActive } from "@/modules/llm/token-ledger";
import { buildLlmRouter } from "@/modules/llm/router";

export const dynamic = "force-dynamic";

/**
 * Health/readiness probe: DB round-trip, breaker states, kill-switch state,
 * process uptime. 200 = healthy; 503 = DB unreachable. Also reports version
 * info for correlating incidents with deploys.
 */
export async function GET() {
  const started = Date.now();
  let dbOk = false;
  let dbError: string | null = null;
  try {
    await getDb().execute(sql`SELECT 1`);
    dbOk = true;
  } catch (err) {
    dbError = String(err);
  }

  let providers: Array<{ provider: string; state: string }> = [];
  try {
    providers = buildLlmRouter(process.env.OPENROUTER_API_KEY ?? "").health();
  } catch {
    /* router unavailable is not unhealthy per se */
  }

  const body = {
    ok: dbOk,
    db: { ok: dbOk, error: dbError, latencyMs: Date.now() - started },
    llm: {
      killSwitch: killSwitchActive(),
      breakers: Object.fromEntries(
        providers.map((p) => [p.provider, getBreakerState(p.provider)])
      ),
    },
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
    uptimeSec: Math.round(process.uptime()),
    instanceStartedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
  };
  return NextResponse.json(body, { status: dbOk ? 200 : 503 });
}

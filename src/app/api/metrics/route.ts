import { NextRequest, NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/require-user";
import { snapshot } from "@/lib/metrics";
import { spendSummary } from "@/modules/llm/token-ledger";
import { getBreakerState } from "@/lib/circuit-breaker";

export const dynamic = "force-dynamic";

/**
 * Observability snapshot (auth-scoped): process metrics (LLM latency/tokens/
 * breaker transitions, rate-limit rejections) + the caller's durable token
 * ledger spend vs caps. Consumed by the /analytics dashboard and by curl.
 */
export async function GET(_req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const metrics = snapshot();
  let spend: Awaited<ReturnType<typeof spendSummary>> | null = null;
  try {
    spend = await spendSummary(user.id);
  } catch {
    /* ledger table may not exist yet on a stale DB — degrade gracefully */
  }

  return NextResponse.json({
    ok: true,
    process: {
      // In-memory counters reset on cold start — treat as "since instance boot".
      uptimeSec: Math.round(process.uptime()),
      note: "process metrics are per-instance and reset on cold start/redeploy",
      counters: metrics.counters,
      timings: metrics.timings,
      gauges: metrics.gauges,
      breakers: {
        openrouter: getBreakerState("openrouter"),
      },
    },
    spend,
  });
}

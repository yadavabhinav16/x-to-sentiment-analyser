/**
 * In-process metrics registry (counters + timing summaries).
 *
 * Lifetime: per serverless instance — resets on cold start/redeploy. For a
 * personal app this is the right tradeoff (zero infra); durable per-call
 * spend lives in the token_ledger table, which survives restarts.
 *
 * All operations are synchronous and O(1); no locks needed in the single
 * Node event loop.
 */

export interface CounterState {
  value: number;
}

export interface TimingState {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  lastMs: number;
}

const counters = new Map<string, CounterState>();
const timings = new Map<string, TimingState>();
const gauges = new Map<string, number>();

export function inc(name: string, by = 1): void {
  const c = counters.get(name) ?? { value: 0 };
  c.value += by;
  counters.set(name, c);
}

export function observeMs(name: string, ms: number): void {
  const t = timings.get(name) ?? { count: 0, totalMs: 0, minMs: Infinity, maxMs: 0, lastMs: 0 };
  t.count += 1;
  t.totalMs += ms;
  t.minMs = Math.min(t.minMs, ms);
  t.maxMs = Math.max(t.maxMs, ms);
  t.lastMs = ms;
  timings.set(name, t);
}

/** Time an async operation, recording <name>.ms plus success/failure counters. */
export async function timed<T>(
  name: string,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    observeMs(`${name}.ms`, Date.now() - start);
    inc(`${name}.ok`);
    return result;
  } catch (err) {
    observeMs(`${name}.ms`, Date.now() - start);
    inc(`${name}.fail`);
    throw err;
  }
}

export function setGauge(name: string, value: number): void {
  gauges.set(name, value);
}

export function snapshot(): {
  counters: Record<string, number>;
  timings: Record<string, { count: number; avgMs: number; minMs: number; maxMs: number; lastMs: number }>;
  gauges: Record<string, number>;
} {
  const countersOut: Record<string, number> = {};
  for (const [k, v] of counters) countersOut[k] = v.value;
  const timingsOut: Record<string, { count: number; avgMs: number; minMs: number; maxMs: number; lastMs: number }> = {};
  for (const [k, t] of timings) {
    timingsOut[k] = {
      count: t.count,
      avgMs: t.count ? Math.round(t.totalMs / t.count) : 0,
      minMs: t.minMs === Infinity ? 0 : Math.round(t.minMs),
      maxMs: Math.round(t.maxMs),
      lastMs: Math.round(t.lastMs),
    };
  }
  const gaugesOut: Record<string, number> = {};
  for (const [k, v] of gauges) gaugesOut[k] = v;
  return { counters: countersOut, timings: timingsOut, gauges: gaugesOut };
}

/** Test isolation helper. */
export function resetMetrics(): void {
  counters.clear();
  timings.clear();
  gauges.clear();
}

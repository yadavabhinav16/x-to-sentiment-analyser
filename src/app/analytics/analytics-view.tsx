"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Analytics dashboard. Fetches the caller's observability snapshot from
 * /api/metrics and renders: LLM latency/spend, breaker health, budget
 * caps vs use, rate-limit rejections. Refreshes on demand.
 */

interface Timing {
  count: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  lastMs: number;
}

interface MetricsPayload {
  ok: boolean;
  process: {
    uptimeSec: number;
    note: string;
    counters: Record<string, number>;
    timings: Record<string, Timing>;
    gauges: Record<string, number>;
  };
  spend: {
    lastHour: number;
    last24h: number;
    caps: { hourly: number; daily: number };
    byProvider24h: Array<{ provider: string; tokens: number; calls: number }>;
  } | null;
}

const fmt = (n: number) => n.toLocaleString("en-US");

function Bar({ pct, danger }: { pct: number; danger?: boolean }) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div className="h-2 w-full rounded-full bg-neutral-800">
      <div
        className={`h-2 rounded-full ${danger ? "bg-red-500" : "bg-blue-500"}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">{title}</h2>
      {children}
    </section>
  );
}

export default function AnalyticsView() {
  const [data, setData] = useState<MetricsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/metrics", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as MetricsPayload);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const counters = data?.process.counters ?? {};
  const timings = data?.process.timings ?? {};
  const spend = data?.spend;

  const llmTimings = Object.entries(timings).filter(([k]) => k.startsWith("llm.provider."));
  const totalOk = Object.entries(counters)
    .filter(([k]) => k.startsWith("llm.provider.") && k.endsWith(".ok"))
    .reduce((a, [, v]) => a + v, 0);
  const totalFail = Object.entries(counters)
    .filter(([k]) => k.startsWith("llm.provider.") && k.endsWith(".fail"))
    .reduce((a, [, v]) => a + v, 0);
  const breakerOpened = Object.entries(counters).filter(([k]) => k.startsWith("llm.breaker.opened."));
  const breakerBlocked = Object.entries(counters).filter(([k]) => k.startsWith("llm.breaker.blocked."));
  const rlRejected = Object.entries(counters).filter(([k]) => k.startsWith("ratelimit.rejected."));

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <header className="mb-10 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-neutral-100">Analytics</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={load}
            disabled={loading}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <a href="/" className="text-sm text-neutral-400 hover:text-neutral-200">← Back</a>
        </div>
      </header>

      {error && (
        <div className="mb-6 rounded-lg border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">
          Failed to load metrics: {error}
        </div>
      )}

      {!data && !error && <p className="text-neutral-400">Loading…</p>}

      {data && (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {/* Token spend vs caps */}
          <Card title="Token spend (durable ledger)">
            {spend ? (
              <div className="space-y-4">
                <div>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="text-neutral-300">Last hour</span>
                    <span className={spend.lastHour >= spend.caps.hourly ? "text-red-400" : "text-neutral-100"}>
                      {fmt(spend.lastHour)} / {fmt(spend.caps.hourly)}
                    </span>
                  </div>
                  <Bar pct={(spend.lastHour / spend.caps.hourly) * 100} danger={spend.lastHour >= spend.caps.hourly * 0.8} />
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="text-neutral-300">Last 24h</span>
                    <span className={spend.last24h >= spend.caps.daily ? "text-red-400" : "text-neutral-100"}>
                      {fmt(spend.last24h)} / {fmt(spend.caps.daily)}
                    </span>
                  </div>
                  <Bar pct={(spend.last24h / spend.caps.daily) * 100} danger={spend.last24h >= spend.caps.daily * 0.8} />
                </div>
                {spend.byProvider24h.length > 0 && (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-neutral-500">
                        <th className="pb-1">Provider</th>
                        <th className="pb-1 text-right">Tokens</th>
                        <th className="pb-1 text-right">Calls</th>
                      </tr>
                    </thead>
                    <tbody>
                      {spend.byProvider24h.map((p) => (
                        <tr key={p.provider} className="border-t border-neutral-800">
                          <td className="py-1 text-neutral-300">{p.provider}</td>
                          <td className="py-1 text-right text-neutral-100">{fmt(p.tokens)}</td>
                          <td className="py-1 text-right text-neutral-400">{p.calls}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {spend.byProvider24h.length === 0 && (
                  <p className="text-sm text-neutral-500">No LLM calls in the last 24h.</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-neutral-500">Ledger unavailable.</p>
            )}
          </Card>

          {/* LLM health */}
          <Card title="LLM calls (this instance)">
            <div className="mb-3 flex gap-6 text-sm">
              <div>
                <p className="text-2xl font-semibold text-green-400">{fmt(totalOk)}</p>
                <p className="text-neutral-500">succeeded</p>
              </div>
              <div>
                <p className="text-2xl font-semibold text-red-400">{fmt(totalFail)}</p>
                <p className="text-neutral-500">failed</p>
              </div>
            </div>
            {llmTimings.length > 0 ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-neutral-500">
                    <th className="pb-1">Provider</th>
                    <th className="pb-1 text-right">Avg</th>
                    <th className="pb-1 text-right">Max</th>
                    <th className="pb-1 text-right">Last</th>
                  </tr>
                </thead>
                <tbody>
                  {llmTimings.map(([k, t]) => (
                    <tr key={k} className="border-t border-neutral-800">
                      <td className="py-1 text-neutral-300">{k.replace("llm.provider.", "").replace(".ms", "")}</td>
                      <td className="py-1 text-right text-neutral-100">{t.avgMs}ms</td>
                      <td className="py-1 text-right text-neutral-400">{t.maxMs}ms</td>
                      <td className="py-1 text-right text-neutral-400">{t.lastMs}ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-neutral-500">No LLM calls since this instance started.</p>
            )}
          </Card>

          {/* Breakers */}
          <Card title="Circuit breakers (this instance)">
            {breakerOpened.length === 0 && breakerBlocked.length === 0 ? (
              <p className="text-sm text-green-400">All breakers healthy — none opened this instance.</p>
            ) : (
              <div className="space-y-2 text-sm">
                {breakerOpened.map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-neutral-300">{k.replace("llm.breaker.opened.", "")}</span>
                    <span className="text-red-400">opened ×{v}</span>
                  </div>
                ))}
                {breakerBlocked.map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-neutral-300">{k.replace("llm.breaker.blocked.", "")}</span>
                    <span className="text-yellow-400">blocked calls ×{v}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Rate limits */}
          <Card title="Rate-limit rejections (this instance)">
            {rlRejected.length === 0 ? (
              <p className="text-sm text-green-400">None.</p>
            ) : (
              <div className="space-y-2 text-sm">
                {rlRejected.map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-neutral-300">{k.replace("ratelimit.rejected.", "")}</span>
                    <span className="text-yellow-400">{fmt(v)}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-3 text-xs text-neutral-600">{data.process.note}</p>
          </Card>
        </div>
      )}
    </main>
  );
}

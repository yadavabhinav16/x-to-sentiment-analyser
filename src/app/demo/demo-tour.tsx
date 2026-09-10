"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { TOUR_STAGES, type TourStage } from "@/modules/demo/tour";

type StageState = "pending" | "running" | "done" | "error";

interface Evidence {
  [k: string]: unknown;
}

const DEMO_EMAIL = "demo-evaluator@example.com";
const DEMO_PASSWORD = "demo-evaluator-2026";

/**
 * Guided Demo/Tour. Signs the evaluator into a dedicated demo account, then
 * walks the real pipeline stage-by-stage in test mode: each step calls
 * /api/demo, which executes the actual code path and returns live evidence.
 */
export default function DemoTour() {
  const [signedIn, setSignedIn] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, StageState>>({});
  const [evidence, setEvidence] = useState<Record<string, Evidence>>({});
  const [current, setCurrent] = useState<number>(0);
  const [expanded, setExpanded] = useState<string[]>([]);

  async function startDemo() {
    setSigningIn(true);
    setAuthError(null);
    try {
      // Ensure the demo account exists, then sign in (idempotent).
      await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
      });
      const res = await signIn("credentials", {
        email: DEMO_EMAIL,
        password: DEMO_PASSWORD,
        redirect: false,
      });
      if (res?.error) throw new Error("Demo sign-in failed");
      setSignedIn(true);
      runStage(TOUR_STAGES[0]);
    } catch (err) {
      setAuthError(String(err instanceof Error ? err.message : err));
    } finally {
      setSigningIn(false);
    }
  }

  async function runStage(stage: TourStage) {
    setCurrent(stage.n);
    // Open the new stage without closing ones the reader is still viewing.
    setExpanded((e) => (e.includes(stage.id) ? e : [...e, stage.id]));
    setStates((s) => ({ ...s, [stage.id]: "running" }));
    try {
      const res = await fetch("/api/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: stage.action }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `Stage ${stage.n} failed`);
      }
      setEvidence((e) => ({ ...e, [stage.id]: data.evidence ?? {} }));
      setStates((s) => ({ ...s, [stage.id]: "done" }));
      // Auto-advance to the next stage.
      const next = TOUR_STAGES[stage.n]; // stages[n] is the (n+1)th entry
      if (next && stage.n < TOUR_STAGES.length) {
        setTimeout(() => {
          setCurrent((c) => (c === stage.n ? next.n : c));
          runStage(next);
        }, 1400);
      }
    } catch (err) {
      setStates((s) => ({ ...s, [stage.id]: "error" }));
      setEvidence((e) => ({
        ...e,
        [stage.id]: { error: String(err instanceof Error ? err.message : err) },
      }));
    }
  }

  const stages = TOUR_STAGES;
  const activeStage = stages.find((s) => s.n === current);

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <header className="mb-2 flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-blue-400">
            Guided architecture tour · live test mode
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-neutral-100">
            Tweet Voice Cloner — System Walkthrough
          </h1>
        </div>
        <a href="/" className="text-sm text-neutral-500 hover:text-neutral-300">
          ← Dashboard
        </a>
      </header>
      <p className="mt-2 max-w-3xl text-sm text-neutral-400">
        Every stage below executes the real application code against the running
        server in <span className="text-emerald-400">test mode</span> (fixture data,
        zero external spend). The "live evidence" panel shows actual values returned
        by the running system — nothing on this page is scripted.
      </p>

      {!signedIn ? (
        <div className="mt-10 rounded-xl border border-neutral-800 bg-neutral-900/60 p-8 text-center">
          <p className="text-neutral-200">
            Start the tour: we&apos;ll sign you into a dedicated demo account and walk
            the full pipeline — ingestion → analysis → generation → moderation —
            stage by stage.
          </p>
          {authError && (
            <p className="mt-3 text-sm text-red-400">{authError}</p>
          )}
          <button
            onClick={startDemo}
            disabled={signingIn}
            className="mt-5 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {signingIn ? "Starting…" : "▶ Start guided demo"}
          </button>
        </div>
      ) : (
        <div className="mt-8 space-y-3">
          {stages.map((stage) => {
            const st = states[stage.id] ?? "pending";
            const ev = evidence[stage.id];
            const isExpanded = expanded.includes(stage.id);
            return (
              <div
                key={stage.id}
                className={`rounded-xl border p-5 transition ${
                  st === "running"
                    ? "border-blue-600 bg-blue-950/20 shadow-[0_0_24px_-6px] shadow-blue-800"
                    : st === "done"
                      ? "border-emerald-900/60 bg-neutral-900/60"
                      : st === "error"
                        ? "border-red-900 bg-red-950/20"
                        : "border-neutral-800 bg-neutral-900/40"
                }`}
              >
                <button
                  className="flex w-full items-center gap-3 text-left"
                  onClick={() =>
                    setExpanded((e) =>
                      e.includes(stage.id) ? e.filter((x) => x !== stage.id) : [...e, stage.id]
                    )
                  }
                >
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                      st === "done"
                        ? "bg-emerald-900 text-emerald-300"
                        : st === "running"
                          ? "animate-pulse bg-blue-600 text-white"
                          : st === "error"
                            ? "bg-red-900 text-red-300"
                            : "bg-neutral-800 text-neutral-400"
                    }`}
                  >
                    {st === "done" ? "✓" : stage.n}
                  </span>
                  <span className="flex-1">
                    <span className="font-medium text-neutral-100">{stage.title}</span>
                    <span className="ml-2 text-xs text-neutral-600">{stage.modules.join(" · ")}</span>
                  </span>
                  {st === "running" && (
                    <span className="text-xs text-blue-400">running live…</span>
                  )}
                </button>

                {isExpanded && (
                  <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <div>
                      <p className="text-sm text-neutral-300">{stage.liveAction}</p>
                      <ul className="mt-3 space-y-3">
                        {stage.decisions.map((d) => (
                          <li key={d.title} className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-blue-400">
                              {d.title}
                            </p>
                            <p className="mt-1 text-sm text-neutral-400">{d.detail}</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
                        Live evidence
                      </p>
                      <pre className="max-h-72 overflow-auto rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-xs leading-relaxed text-emerald-300">
                        {ev
                          ? JSON.stringify(ev, null, 2)
                          : st === "running"
                            ? "executing…"
                            : "waiting"}
                      </pre>
                      {st === "error" && ev?.error != null && (
                        <p className="mt-2 text-xs text-red-400">Stage failed — see evidence.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {activeStage == null && Object.values(states).every((s) => s === "done") && (
            <div className="rounded-xl border border-emerald-800 bg-emerald-950/30 p-6 text-center">
              <p className="text-sm text-emerald-300">
                Tour complete — all 10 stages executed the real pipeline live. The demo
                account&apos;s profile, corpus, generation jobs, and moderation-labeled
                drafts are persisted in Postgres and visible on the dashboard.
              </p>
              <a
                href="/"
                className="mt-4 inline-block rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
              >
                View the demo account&apos;s profiles →
              </a>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
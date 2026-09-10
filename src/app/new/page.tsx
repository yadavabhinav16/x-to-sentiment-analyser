"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const HANDLE_RE = /^@?[A-Za-z0-9_]{1,15}$/;
type Mode = "test" | "realtime";

export default function NewProfilePage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("test");
  const [handle, setHandle] = useState("");
  const [handleError, setHandleError] = useState<string | null>(null);
  const [step, setStep] = useState<"input" | "fetching" | "analyzing">("input");
  const [fetched, setFetched] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const valid = HANDLE_RE.test(handle);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) {
      setHandleError("Handle must be 1-15 letters, digits, or underscores.");
      return;
    }
    setHandleError(null);
    setError(null);
    setStep("fetching");
    const ticker = setInterval(() => setFetched((f) => Math.min(100, f + 7)), 300);
    try {
      setStep("analyzing");
      const res = await fetch("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handle: handle.replace(/^@/, ""),
          mode,
        }),
      });
      clearInterval(ticker);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Profile creation failed");
      router.push(`/profile/${data.handle}`);
    } catch (err) {
      clearInterval(ticker);
      setError(String(err instanceof Error ? err.message : err));
      setStep("input");
    }
  }

  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <a href="/" className="text-sm text-neutral-500 hover:text-neutral-300">← Back</a>
      <h1 className="mt-4 text-2xl font-semibold text-neutral-100">Analyze an X handle</h1>
      <p className="mt-1 text-sm text-neutral-400">
        We fetch recent public posts and build a style profile of the account&apos;s voice.
      </p>

      {/* Mode tabs */}
      <div className="mt-6 inline-flex rounded-lg border border-neutral-800 bg-neutral-900 p-1">
        <button
          type="button"
          onClick={() => setMode("test")}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
            mode === "test"
              ? "bg-blue-600 text-white"
              : "text-neutral-400 hover:text-neutral-200"
          }`}
        >
          Test mode
        </button>
        <button
          type="button"
          onClick={() => setMode("realtime")}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
            mode === "realtime"
              ? "bg-blue-600 text-white"
              : "text-neutral-400 hover:text-neutral-200"
          }`}
        >
          Real-time mode
        </button>
      </div>
      <p className="mt-2 text-xs text-neutral-500">
        {mode === "test"
          ? "Uses saved fixture data (Elon Musk's 100 tweets) — no X API calls, no credits spent."
          : "Makes a real X API call with your BEARER_TOKEN — costs ~$0.51 per profile (100 post reads)."}
      </p>

      {error && (
        <div className="mt-6 rounded-lg border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {step === "input" && (
        <form onSubmit={submit} className="mt-8 space-y-4">
          <div>
            <label className="text-sm text-neutral-300">X handle</label>
            <input
              value={handle}
              onChange={(e) => {
                setHandle(e.target.value);
                setHandleError(null);
              }}
              placeholder={mode === "test" ? "@elonmusk (fixture)" : "@handle"}
              className={`mt-1 w-full rounded-lg border bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-blue-600 ${
                handleError ? "border-red-800" : "border-neutral-800"
              }`}
            />
            {handleError && <p className="mt-1 text-xs text-red-400">{handleError}</p>}
            {!handleError && handle && !valid && (
              <p className="mt-1 text-xs text-neutral-500">1-15 letters, digits, or underscores.</p>
            )}
          </div>
          <button
            type="submit"
            disabled={!valid}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-40 ${
              mode === "realtime" ? "bg-blue-600 hover:bg-blue-500" : "bg-emerald-600 hover:bg-emerald-500"
            }`}
          >
            {mode === "test" ? "Analyze (test data)" : "Analyze (live X API)"}
          </button>
        </form>
      )}

      {(step === "fetching" || step === "analyzing") && (
        <div className="mt-8 space-y-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-6">
          <p className="text-sm text-neutral-200">
            {step === "fetching"
              ? mode === "test"
                ? "Loading test fixture data…"
                : `Fetching recent posts from X API… (${fetched}/100)`
              : "Analyzing voice…"}
          </p>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
            <div
              className={`h-full transition-all ${mode === "test" ? "bg-emerald-600" : "bg-blue-600"}`}
              style={{ width: step === "fetching" ? `${fetched}%` : "100%" }}
            />
          </div>
          <ul className="mt-4 space-y-1 text-xs text-neutral-500">
            <li>{step !== "fetching" ? "✓" : "·"} fetch corpus {mode === "test" ? "(fixtures)" : "(X API)"}</li>
            <li>{step === "analyzing" ? "…" : "·"} syntax ✓ lexical ✓ topics ✓ engagement ✓</li>
            <li>· merge style profile</li>
          </ul>
        </div>
      )}
    </main>
  );
}

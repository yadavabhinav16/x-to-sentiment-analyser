"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

type Tab = "signin" | "register";

export default function LoginPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (tab === "register") {
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Registration failed");
      }
      const res = await signIn("credentials", { email, password, redirect: false });
      if (res?.error) throw new Error("Sign-in failed — check your email and password.");
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-neutral-800 bg-neutral-900/60 p-8">
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-semibold text-neutral-100">Tweet Voice Cloner</h1>
          <p className="text-sm text-neutral-400">Sign in to analyze X handles and clone their voice.</p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="inline-flex w-full rounded-lg border border-neutral-800 bg-neutral-950 p-1">
          <button
            type="button"
            onClick={() => setTab("signin")}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium ${tab === "signin" ? "bg-blue-600 text-white" : "text-neutral-400 hover:text-neutral-200"}`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => setTab("register")}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium ${tab === "register" ? "bg-blue-600 text-white" : "text-neutral-400 hover:text-neutral-200"}`}
          >
            Create account
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3">
            <input
              type="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-blue-600"
            />
            <input
              type="password"
              required
              minLength={8}
              placeholder={tab === "register" ? "Password (min 8 chars)" : "Password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-blue-600"
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {busy ? "Working…" : tab === "register" ? "Create account" : "Sign in"}
            </button>
          </form>
      </div>
    </main>
  );
}
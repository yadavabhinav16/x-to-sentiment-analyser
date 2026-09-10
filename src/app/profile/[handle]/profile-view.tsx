"use client";

import { useState } from "react";

interface DraftItem {
  id: string;
  text: string;
  status: string;
  styleMatch: number;
}

interface Props {
  handle: string;
  displayName: string | null;
  sampleCount: number;
  corpusCount: number;
  profile: import("@/modules/analysis/style-profile").StyleProfile | null;
  drafts: DraftItem[];
}

export default function ProfileView({ handle, displayName, sampleCount, profile, drafts: initial }: Props) {
  const [drafts, setDrafts] = useState(initial);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [topic, setTopic] = useState("");
  const [filter, setFilter] = useState<"all" | "approved" | "rejected">("all");

  async function generate() {
    setGenerating(true);
    setGenError(null);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle, count: 5, topic: topic || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Generation failed");
      setDrafts((d) => [
        ...data.drafts.map((d: { id: string; text: string; styleMatch: number }) => ({
          id: d.id,
          text: d.text,
          status: "suggested",
          styleMatch: d.styleMatch,
        })),
        ...d,
      ]);
    } catch (err) {
      setGenError(String(err instanceof Error ? err.message : err));
    } finally {
      setGenerating(false);
    }
  }

  async function act(id: string, action: "approve" | "reject") {
    const res = await fetch(`/api/drafts/${id}/${action}`, { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, status: data.draft.status } : d)));
    }
  }

  async function edit(id: string, text: string) {
    setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, text } : d)));
    await fetch(`/api/drafts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ editedText: text }),
    });
  }

  const shown = drafts.filter((d) =>
    filter === "all" ? true : filter === "approved" ? d.status === "approved" : d.status === "rejected"
  );

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <a href="/" className="text-sm text-neutral-500 hover:text-neutral-300">← Dashboard</a>
      <header className="mt-4 mb-8">
        <h1 className="text-2xl font-semibold text-neutral-100">@{handle}</h1>
        {displayName && <p className="text-sm text-neutral-400">{displayName}</p>}
        <p className="text-xs text-neutral-500">{sampleCount} posts analyzed</p>
      </header>

      {sampleCount < 20 && (
        <div className="mb-6 rounded-lg border border-amber-900 bg-amber-950/40 px-4 py-3 text-sm text-amber-300">
          Thin corpus ({sampleCount} &lt; 20 posts) — voice will be approximate; generation stays generic-safe.
        </div>
      )}

      {profile && (
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card title="Voice">
            <p className="text-sm text-neutral-300">{profile.voice.oneParagraphSummary}</p>
          </Card>
          <Card title="Syntax">
            <ul className="space-y-1 text-sm text-neutral-300">
              <li>avg {profile.syntax.avgLengthChars} chars ({profile.syntax.lengthRange[0]}–{profile.syntax.lengthRange[1]})</li>
              <li>casing: {profile.syntax.casing}</li>
              <li>exclamations {pct(profile.syntax.punctuation.exclamationRate)} · questions {pct(profile.syntax.punctuation.questionRate)}</li>
              <li>{profile.syntax.punctuation.commaStyle}</li>
            </ul>
          </Card>
          <Card title="Tone">
            <Meter label="Formality" value={profile.tone.formality} />
            <Meter label="Assertiveness" value={profile.tone.assertiveness} />
            <p className="mt-2 text-sm text-neutral-300">{profile.tone.sentiment} · {profile.tone.humorStyle}</p>
          </Card>
          <Card title="Signature phrases">
            <div className="flex flex-wrap gap-2">
              {[...profile.lexical.signaturePhrases, ...profile.voice.signaturePhrasesInContext].slice(0, 10).map((p, i) => (
                <span key={i} className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-300">{p}</span>
              ))}
              {!profile.lexical.signaturePhrases.length && <span className="text-sm text-neutral-500">None detected</span>}
            </div>
          </Card>
          <Card title="Topics">
            <div className="flex flex-wrap gap-2">
              {profile.topics.clusters.map((c, i) => (
                <span
                  key={i}
                  className="rounded-full bg-blue-950 border border-blue-900 px-3 py-1 text-xs text-blue-300"
                  style={{ fontSize: `${11 + c.share * 10}px` }}
                >
                  {c.name} {Math.round(c.share * 100)}%
                </span>
              ))}
            </div>
            {profile.topics.obsessions.length > 0 && (
              <p className="mt-2 text-xs text-neutral-500">obsessions: {profile.topics.obsessions.join(", ")}</p>
            )}
          </Card>
          <Card title="Format">
            <ul className="space-y-1 text-sm text-neutral-300">
              <li>emoji rate {pct(profile.emojiFormat.emojiRate)} {profile.emojiFormat.typicalEmojis.join(" ")}</li>
              <li>{profile.emojiFormat.linkPolicy}</li>
              <li>{profile.emojiFormat.lineBreakStyle}</li>
              {profile.engagement.topFormats.map((f, i) => (
                <li key={i} className="text-green-400">↗ {f}</li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      <section className="mt-10 rounded-xl border border-neutral-800 bg-neutral-900/60 p-6">
        <h2 className="font-medium text-neutral-100">Generate drafts</h2>
        {genError && (
          <div className="mt-3 rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">{genError}</div>
        )}
        <div className="mt-3 flex gap-2">
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Optional: what should drafts be about?"
            className="flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-blue-600"
          />
          <button
            onClick={generate}
            disabled={generating}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {generating ? "Generating 5 drafts…" : "Generate"}
          </button>
        </div>
      </section>

      <section className="mt-8">
        <div className="mb-3 flex gap-2">
          {(["all", "approved", "rejected"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1 text-xs ${filter === f ? "bg-neutral-700 text-white" : "text-neutral-500 hover:text-neutral-300"}`}
            >
              {f}
            </button>
          ))}
        </div>
        {shown.length === 0 ? (
          <div className="rounded-xl border border-dashed border-neutral-800 p-10 text-center text-sm text-neutral-500">
            No drafts yet — generate your first set.
          </div>
        ) : (
          <div className="space-y-3">
            {shown.map((d) => (
              <div key={d.id} className={`rounded-xl border p-4 ${d.status === "approved" ? "border-green-800 bg-green-950/20" : d.status === "rejected" ? "border-neutral-900 opacity-50" : "border-neutral-800 bg-neutral-900/60"}`}>
                <textarea
                  value={d.text}
                  onChange={(e) => edit(d.id, e.target.value)}
                  rows={2}
                  className="w-full resize-none bg-transparent text-sm text-neutral-200 outline-none"
                />
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <span className={`rounded-full px-2 py-0.5 font-medium ${d.styleMatch >= 75 ? "bg-green-950 text-green-400" : d.styleMatch >= 50 ? "bg-amber-950 text-amber-400" : "bg-red-950 text-red-400"}`}>
                    {d.styleMatch}% match
                  </span>
                  <span className="flex-1" />
                  <button onClick={() => navigator.clipboard.writeText(d.text)} className="text-neutral-400 hover:text-neutral-200">Copy</button>
                  {d.status !== "approved" && <button onClick={() => act(d.id, "approve")} className="text-green-400 hover:text-green-300">Approve</button>}
                  {d.status !== "rejected" && <button onClick={() => act(d.id, "reject")} className="text-red-400 hover:text-red-300">Reject</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">{title}</h3>
      {children}
    </div>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div className="mb-2">
      <div className="flex justify-between text-xs text-neutral-400">
        <span>{label}</span>
        <span>{Math.round(value * 100)}%</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
        <div className="h-full bg-blue-600" style={{ width: `${value * 100}%` }} />
      </div>
    </div>
  );
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

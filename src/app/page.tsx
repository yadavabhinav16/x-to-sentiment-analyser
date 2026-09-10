import Link from "next/link";
import { redirect } from "next/navigation";
import { listProfiles } from "@/modules/drafts/service";
import { requireUser } from "@/lib/require-user";
import { signOut } from "@/modules/auth/auth";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const user = await requireUser();
  if (!user) redirect("/login");
  const profiles = safeList(user.id);

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <header className="mb-10 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-neutral-100">Voice Profiles</h1>
        <a
          href="/new"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          New profile
        </a>
        <a
          href="/demo"
          className="ml-2 rounded-lg border border-blue-700 px-4 py-2 text-sm font-medium text-blue-300 hover:border-blue-500 hover:text-blue-200"
        >
          ▶ Guided demo
        </a>
        <span className="ml-3 text-sm text-neutral-500">{user.email}</span>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button className="ml-2 text-sm text-neutral-500 hover:text-neutral-300">Sign out</button>
        </form>
      </header>

      {profiles.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-800 p-16 text-center">
          <p className="text-lg text-neutral-300">No voice profiles yet.</p>
          <p className="mt-1 text-sm text-neutral-500">Analyze your first X handle to get started.</p>
          <a href="/new" className="mt-6 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500">
            Analyze a handle
          </a>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {profiles.map((p) => {
            const sp = parseProfile(p.styleProfile);
            return (
              <a
                key={p.id}
                href={`/profile/${p.handle}`}
                className="block rounded-xl border border-neutral-800 bg-neutral-900/60 p-5 transition hover:border-neutral-600"
              >
                <div className="flex items-baseline justify-between">
                  <span className="font-medium text-neutral-100">@{p.handle}</span>
                  <span className="text-xs text-neutral-500">{p.sampleCount} posts</span>
                </div>
                <p className="mt-2 line-clamp-3 text-sm text-neutral-400">
                  {sp?.voice?.oneParagraphSummary ?? "Analysis pending"}
                </p>
                <p className="mt-3 text-xs text-neutral-600">
                  {p.corpusFetchedAt ? new Date(p.corpusFetchedAt).toLocaleDateString() : ""}
                </p>
              </a>
            );
          })}
        </div>
      )}
    </main>
  );
}

function safeList(userId: string) {
  try {
    return listProfiles(userId);
  } catch {
    return [];
  }
}

function parseProfile(json: unknown) {
  try {
    return JSON.parse(typeof json === "string" ? json : JSON.stringify(json));
  } catch {
    return null;
  }
}

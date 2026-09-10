import { getProfileByHandle, getCorpus, listDrafts } from "@/modules/drafts/service";
import { styleProfileSchema } from "@/modules/analysis/style-profile";
import ProfileView from "./profile-view";
import { requireUser } from "@/lib/require-user";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  params,
}: {
  params: { handle: string };
}) {
  const user = await requireUser();
  if (!user) redirect("/login");
  const handle = decodeURIComponent(params.handle).replace(/^@/, "");
  const row = safeProfile(handle, user.id);
  if (!row) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-16 text-center">
        <p className="text-neutral-300">Profile @{handle} not found.</p>
        <a href="/new" className="mt-4 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm text-white">Create it</a>
      </main>
    );
  }
  const parsed = styleProfileSchema.safeParse(
    JSON.parse(typeof row.styleProfile === "string" ? row.styleProfile : JSON.stringify(row.styleProfile))
  );
  const corpus = getCorpus(row.id);
  const drafts = listDrafts(row.id);

  return (
    <ProfileView
      handle={row.handle}
      displayName={row.displayName}
      sampleCount={row.sampleCount}
      profile={parsed.success ? parsed.data : null}
      corpusCount={corpus.length}
      drafts={drafts.map((d) => ({
        id: d.id,
        text: d.text,
        status: d.status,
        styleMatch: d.styleMatch,
      }))}
    />
  );
}

function safeProfile(handle: string, userId: string) {
  try {
    return getProfileByHandle(handle, userId);
  } catch {
    return undefined;
  }
}

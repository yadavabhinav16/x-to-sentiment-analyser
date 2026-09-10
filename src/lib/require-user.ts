import { NextResponse } from "next/server";
import { auth } from "@/modules/auth/auth";
import { getUserById } from "@/modules/auth/users";
import { getProfileById } from "@/modules/drafts/service";

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
}

/**
 * Resolve the signed-in user, backstopped against the users table.
 * Returns null when unauthenticated — call sites respond with 401.
 */
export async function requireUser(): Promise<SessionUser | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const user = await getUserById(id);
  if (!user) return null;
  return { id: user.id, email: user.email ?? session.user?.email ?? "", name: user.name };
}

export function unauthorized() {
  return NextResponse.json({ error: "Unauthorized — sign in required." }, { status: 401 });
}

/** Fetch a voice profile scoped to the given user, or null. */
export async function getProfileForUser(profileId: string, userId: string) {
  return (await getProfileById(profileId, userId)) ?? null;
}

export function assertProfileOwnership(profile: { userId: string | null } | undefined, userId: string): boolean {
  return !!profile && profile.userId === userId;
}

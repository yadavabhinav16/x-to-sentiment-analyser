import { NextResponse } from "next/server";
import { auth } from "@/modules/auth/auth";
import { getDb } from "@/db";
import { users, voiceProfiles } from "@/db/schema";
import { eq } from "drizzle-orm";

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
  const row = getDb().select().from(users).where(eq(users.id, id)).get();
  if (!row) return null;
  return { id: row.id, email: row.email ?? session.user?.email ?? "", name: row.name };
}

export function unauthorized() {
  return NextResponse.json({ error: "Unauthorized — sign in required." }, { status: 401 });
}

/** Fetch a voice profile scoped to the given user, or null. */
export function getProfileForUser(profileId: string, userId: string) {
  return getDb()
    .select()
    .from(voiceProfiles)
    .where(eq(voiceProfiles.id, profileId))
    .get();
}

export function assertProfileOwnership(profile: { userId: string | null } | undefined, userId: string): boolean {
  return !!profile && profile.userId === userId;
}
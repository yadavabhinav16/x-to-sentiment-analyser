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
  const rows = await getDb().select().from(users).where(eq(users.id, id)).limit(1);
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, email: row.email ?? session.user?.email ?? "", name: row.name };
}

export function unauthorized() {
  return NextResponse.json({ error: "Unauthorized — sign in required." }, { status: 401 });
}

/** Fetch a voice profile scoped to the given user, or null. */
export async function getProfileForUser(profileId: string, userId: string) {
  const rows = await getDb()
    .select()
    .from(voiceProfiles)
    .where(eq(voiceProfiles.id, profileId))
    .limit(1);
  return rows[0] ?? null;
}

export function assertProfileOwnership(profile: { userId: string | null } | undefined, userId: string): boolean {
  return !!profile && profile.userId === userId;
}

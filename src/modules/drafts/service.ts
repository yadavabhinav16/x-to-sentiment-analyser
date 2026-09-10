import { getDb } from "../../db";
import { drafts, tweets, voiceProfiles } from "../../db/schema";
import { eq, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { moderationMetadata } from "../voice/moderation";
import { logger } from "../../lib/logger";

export async function listDrafts(profileId: string) {
  return getDb()
    .select()
    .from(drafts)
    .where(eq(drafts.voiceProfileId, profileId))
    .orderBy(desc(drafts.createdAt));
}

export async function getDraft(id: string) {
  const rows = await getDb().select().from(drafts).where(eq(drafts.id, id)).limit(1);
  return rows[0];
}

/** Draft fetch scoped to a user (joins via voiceProfiles.userId). */
export async function getDraftForUser(id: string, userId: string) {
  const draft = await getDraft(id);
  if (!draft) return undefined;
  const profileRows = await getDb()
    .select()
    .from(voiceProfiles)
    .where(eq(voiceProfiles.id, draft.voiceProfileId))
    .limit(1);
  const profile = profileRows[0];
  if (!profile || profile.userId !== userId) return undefined;
  return draft;
}

export async function updateDraft(
  id: string,
  patch: { editedText?: string; status?: "suggested" | "approved" | "rejected" }
) {
  const db = getDb();
  const set: Record<string, unknown> = {};
  if (patch.editedText !== undefined) set.editedText = patch.editedText;
  if (patch.status !== undefined) set.status = patch.status;
  await db.update(drafts).set(set).where(eq(drafts.id, id));
  return getDraft(id);
}

export async function createDrafts(
  profileId: string,
  generationId: string,
  items: Array<{ text: string; styleMatch: number }>
) {
  const db = getDb();
  const now = new Date();
  const rows = items.map((it) => {
    const mod = moderationMetadata(it.text);
    return {
      id: randomUUID(),
      generationId,
      voiceProfileId: profileId,
      text: it.text,
      status: "suggested" as const,
      styleMatch: it.styleMatch,
      moderationFlags: mod.flags,
      moderationLabel: mod.label,
      createdAt: now,
    };
  });
  await db.insert(drafts).values(rows);
  logger.info("Drafts persisted", { profileId, count: rows.length });
  return rows;
}

export async function getCorpus(profileId: string) {
  return getDb()
    .select()
    .from(tweets)
    .where(eq(tweets.voiceProfileId, profileId))
    .orderBy(desc(tweets.likes));
}

export async function getProfileByHandle(handle: string, userId?: string) {
  const clean = handle.replace(/^@/, "").toLowerCase();
  const all = await getDb().select().from(voiceProfiles);
  return all.find(
    (p) => p.handle.toLowerCase() === clean && (userId === undefined || p.userId === userId)
  );
}

export async function getProfileById(id: string, userId?: string) {
  const rows = await getDb().select().from(voiceProfiles).where(eq(voiceProfiles.id, id)).limit(1);
  const row = rows[0];
  if (!row) return undefined;
  if (userId !== undefined && row.userId !== userId) return undefined;
  return row;
}

export async function listProfiles(userId?: string) {
  const db = getDb();
  if (userId === undefined) {
    return db.select().from(voiceProfiles).orderBy(desc(voiceProfiles.createdAt));
  }
  return db
    .select()
    .from(voiceProfiles)
    .where(eq(voiceProfiles.userId, userId))
    .orderBy(desc(voiceProfiles.createdAt));
}

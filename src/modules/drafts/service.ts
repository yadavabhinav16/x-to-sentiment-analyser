import { getDb } from "../../db";
import { drafts, tweets, voiceProfiles } from "../../db/schema";
import { eq, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { logger } from "../../lib/logger";

export function listDrafts(profileId: string) {
  return getDb()
    .select()
    .from(drafts)
    .where(eq(drafts.voiceProfileId, profileId))
    .orderBy(desc(drafts.createdAt))
    .all();
}

export function getDraft(id: string) {
  return getDb().select().from(drafts).where(eq(drafts.id, id)).get();
}

/** Draft fetch scoped to a user (joins via voiceProfiles.userId). */
export function getDraftForUser(id: string, userId: string) {
  const draft = getDraft(id);
  if (!draft) return undefined;
  const profile = getDb()
    .select()
    .from(voiceProfiles)
    .where(eq(voiceProfiles.id, draft.voiceProfileId))
    .get();
  if (!profile || profile.userId !== userId) return undefined;
  return draft;
}

export function updateDraft(
  id: string,
  patch: { editedText?: string; status?: "suggested" | "approved" | "rejected" }
) {
  const db = getDb();
  const set: Record<string, unknown> = {};
  if (patch.editedText !== undefined) set.editedText = patch.editedText;
  if (patch.status !== undefined) set.status = patch.status;
  db.update(drafts).set(set).where(eq(drafts.id, id)).run();
  return getDraft(id);
}

export function createDrafts(
  profileId: string,
  generationId: string,
  items: Array<{ text: string; styleMatch: number }>
) {
  const db = getDb();
  const now = new Date();
  const rows = items.map((it) => ({
    id: randomUUID(),
    generationId,
    voiceProfileId: profileId,
    text: it.text,
    status: "suggested" as const,
    styleMatch: it.styleMatch,
    createdAt: now,
  }));
  db.insert(drafts).values(rows).run();
  logger.info("Drafts persisted", { profileId, count: rows.length });
  return rows;
}

export function getCorpus(profileId: string) {
  return getDb()
    .select()
    .from(tweets)
    .where(eq(tweets.voiceProfileId, profileId))
    .orderBy(desc(tweets.likes))
    .all();
}

export function getProfileByHandle(handle: string, userId?: string) {
  const clean = handle.replace(/^@/, "").toLowerCase();
  const all = getDb().select().from(voiceProfiles).all();
  return all.find(
    (p) => p.handle.toLowerCase() === clean && (userId === undefined || p.userId === userId)
  );
}

export function getProfileById(id: string, userId?: string) {
  const row = getDb().select().from(voiceProfiles).where(eq(voiceProfiles.id, id)).get();
  if (!row) return undefined;
  if (userId !== undefined && row.userId !== userId) return undefined;
  return row;
}

export function listProfiles(userId?: string) {
  const q = getDb().select().from(voiceProfiles).orderBy(desc(voiceProfiles.createdAt));
  if (userId === undefined) return q.all();
  return q.where(eq(voiceProfiles.userId, userId)).all();
}

import { randomUUID } from "crypto";
import { voiceProfileRepository, tweetRepository, draftRepository } from "../../repositories";
import type { Draft } from "../../db/schema";
import { moderationMetadata } from "../voice/moderation";
import { logger } from "../../lib/logger";

/**
 * Drafts & profiles service: business logic over the VoiceProfile,
 * Tweet and Draft repositories (Drizzle impls in src/repositories).
 * No direct DB access here — persistence goes through the interfaces.
 */

export async function listDrafts(profileId: string) {
  return draftRepository.listByProfile(profileId);
}

export async function getDraft(id: string) {
  return draftRepository.findById(id);
}

/** Draft fetch scoped to a user (via the profile's userId). */
export async function getDraftForUser(id: string, userId: string) {
  const draft = await draftRepository.findById(id);
  if (!draft) return undefined;
  const profile = await voiceProfileRepository.findById(draft.voiceProfileId);
  if (!profile || profile.userId !== userId) return undefined;
  return draft;
}

export async function updateDraft(
  id: string,
  patch: { editedText?: string; status?: "suggested" | "approved" | "rejected" }
) {
  await draftRepository.update(id, patch);
  return draftRepository.findById(id);
}

export async function createDrafts(
  profileId: string,
  generationId: string,
  items: Array<{ text: string; styleMatch: number }>
) {
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
      editedText: null,
      createdAt: now,
    } as Draft;
  });
  await draftRepository.insertMany(rows);
  logger.info("Drafts persisted", { profileId, count: rows.length });
  return rows;
}

export async function getCorpus(profileId: string) {
  return tweetRepository.listByProfile(profileId);
}

export async function getProfileByHandle(handle: string, userId?: string) {
  return voiceProfileRepository.findByHandle(handle, userId);
}

export async function getProfileById(id: string, userId?: string) {
  return voiceProfileRepository.findById(id, userId);
}

export async function listProfiles(userId: string) {
  return voiceProfileRepository.listByUser(userId);
}

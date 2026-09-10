import { randomUUID } from "crypto";
import type { TweetSource } from "../ingestion/ports/tweet-source";
import { analyzeCorpus } from "../analysis/analyzer";
import { voiceProfileRepository, tweetRepository } from "../../repositories";
import { logger } from "../../lib/logger";
import { getProfileByHandle } from "../drafts/service";

/**
 * Profile creation service. Persists via the VoiceProfileRepository and
 * TweetRepository interfaces — no direct DB access in this module.
 */
export async function createProfileFromHandle(
  handle: string,
  source: { fetchUser(h: string): Promise<{ id: string; username: string; name: string }>; fetchRecentTweets(h: string, limit: number): Promise<Array<{ id: string; text: string; createdAt: string; likeCount: number; retweetCount: number; replyCount: number; quoteCount: number; impressionCount: number | null }>> },
  limit = 100,
  userId?: string
): Promise<{ profileId: string; sampleCount: number }> {
  const clean = handle.replace(/^@/, "");
  logger.info("Profile creation started", { handle: clean, limit });

  const user = await source.fetchUser(clean);
  const raw = await source.fetchRecentTweets(clean, limit);
  if (!raw.length) throw new Error(`No public posts found for @${clean}`);

  const profile = await analyzeCorpus(clean, user.name, raw);

  // Upsert: replace existing profile for this handle (scoped to this user)
  const existing = await getProfileByHandle(clean, userId);
  let profileId: string;
  if (existing) {
    profileId = existing.id;
    await tweetRepository.deleteByProfile(profileId);
    await voiceProfileRepository.update(profileId, {
      styleProfile: JSON.stringify(profile),
      sampleCount: raw.length,
      displayName: user.name,
      corpusFetchedAt: new Date(),
    });
  } else {
    profileId = randomUUID();
    await voiceProfileRepository.insert({
      id: profileId,
      userId: userId ?? null,
      handle: clean,
      displayName: user.name,
      styleProfile: JSON.stringify(profile),
      sampleCount: raw.length,
      corpusFetchedAt: new Date(),
      createdAt: new Date(),
    });
  }

  await tweetRepository.insertMany(
    raw.map((t) => ({
      id: `${profileId}:${t.id}`,
      voiceProfileId: profileId,
      text: t.text,
      postedAt: t.createdAt,
      likes: t.likeCount,
      rts: t.retweetCount,
      replies: t.replyCount,
      impressions: t.impressionCount,
      source: "mock_x_api",
    }))
  );

  logger.info("Profile created", { handle: clean, profileId, sampleCount: raw.length });
  return { profileId, sampleCount: raw.length };
}

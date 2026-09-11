import { randomUUID } from "crypto";
import type { TweetSource } from "../ingestion/ports/tweet-source";
import { analyzeCorpus } from "../analysis/analyzer";
import { voiceProfileRepository } from "../../repositories";
import { logger } from "../../lib/logger";

/**
 * Profile creation service. Persistence goes through the
 * VoiceProfileRepository interface; the upsert (corpus replace + profile
 * write) is atomic — one transaction via upsertWithCorpus(). A crash
 * mid-pipeline can never leave a stale profile/corpus pair.
 */
export async function createProfileFromHandle(
  handle: string,
  source: { fetchUser(h: string): Promise<{ id: string; username: string; name: string }>; fetchRecentTweets(h: string, limit: number): Promise<Array<{ id: string; text: string; createdAt: string; likeCount: number; retweetCount: number; replyCount: number; quoteCount: number; impressionCount: number | null }>> },
  limit = 30,
  userId?: string
): Promise<{ profileId: string; sampleCount: number }> {
  // Stored normalized (lowercase, no @) so lookups can use plain indexed
  // eq() — case handling happens once here, at the write boundary.
  const clean = handle.replace(/^@/, "").trim().toLowerCase();
  logger.info("Profile creation started", { handle: clean, limit });

  const user = await source.fetchUser(clean);
  const raw = await source.fetchRecentTweets(clean, limit);
  if (!raw.length) throw new Error(`No public posts found for @${clean}`);

  const profile = await analyzeCorpus(clean, user.name, raw);

  const profileId = await voiceProfileRepository.upsertWithCorpus({
    profile: {
      id: randomUUID(),
      userId: userId ?? null,
      handle: clean,
      displayName: user.name,
      styleProfile: JSON.stringify(profile),
      sampleCount: raw.length,
      corpusFetchedAt: new Date(),
      createdAt: new Date(),
    },
    patch: {
      styleProfile: JSON.stringify(profile),
      sampleCount: raw.length,
      displayName: user.name,
      corpusFetchedAt: new Date(),
    },
    buildTweets: (pid) =>
      raw.map((t) => ({
        id: `${pid}:${t.id}`,
        voiceProfileId: pid,
        text: t.text,
        postedAt: t.createdAt,
        likes: t.likeCount,
        rts: t.retweetCount,
        replies: t.replyCount,
        impressions: t.impressionCount,
        source: "mock_x_api",
      })),
  });

  logger.info("Profile created", { handle: clean, profileId, sampleCount: raw.length });
  return { profileId, sampleCount: raw.length };
}

import { randomUUID } from "crypto";
import type { TweetSource } from "../ingestion/ports/tweet-source";
import { analyzeCorpus } from "../analysis/analyzer";
import { getDb } from "../../db";
import { tweets, voiceProfiles, generationJobs } from "../../db/schema";
import { eq } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { getProfileByHandle } from "../drafts/service";

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

  const db = getDb();
  // Upsert: replace existing profile for this handle (scoped to this user)
  const existing = getProfileByHandle(clean, userId);
  let profileId: string;
  if (existing) {
    profileId = existing.id;
    db.delete(tweets).where(eq(tweets.voiceProfileId, profileId)).run();
    db.update(voiceProfiles)
      .set({
        styleProfile: JSON.stringify(profile),
        sampleCount: raw.length,
        displayName: user.name,
        corpusFetchedAt: new Date(),
      })
      .where(eq(voiceProfiles.id, profileId))
      .run();
  } else {
    profileId = randomUUID();
    db.insert(voiceProfiles)
      .values({
        id: profileId,
        userId,
        handle: clean,
        displayName: user.name,
        styleProfile: JSON.stringify(profile),
        sampleCount: raw.length,
        corpusFetchedAt: new Date(),
        createdAt: new Date(),
      })
      .run();
  }

  db.insert(tweets)
    .values(
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
    )
    .run();

  logger.info("Profile created", { handle: clean, profileId, sampleCount: raw.length });
  return { profileId, sampleCount: raw.length };
}

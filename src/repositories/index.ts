import {
  DrizzleDraftRepository,
  DrizzleGenerationJobRepository,
  DrizzleIdempotencyRepository,
  DrizzleTweetRepository,
  DrizzleUserRepository,
  DrizzleVoiceProfileRepository,
} from "./drizzle";

/**
 * Composition root for the repository layer. Services depend on the
 * repository interfaces; these singleton instances are the default
 * Drizzle-backed implementations used at runtime.
 */
export const userRepository = new DrizzleUserRepository();
export const voiceProfileRepository = new DrizzleVoiceProfileRepository();
export const tweetRepository = new DrizzleTweetRepository();
export const draftRepository = new DrizzleDraftRepository();
export const generationJobRepository = new DrizzleGenerationJobRepository();
export const idempotencyRepository = new DrizzleIdempotencyRepository();

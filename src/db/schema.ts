import {
  pgTable,
  text,
  integer,
  jsonb,
  timestamp,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email"),
  name: text("name"),
  passwordHash: text("password_hash"),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => ({
  usersEmailIdx: uniqueIndex("users_email_uq").on(t.email),
}));

export const voiceProfiles = pgTable("voice_profiles", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  handle: text("handle").notNull(),
  displayName: text("display_name"),
  styleProfile: text("style_profile").notNull(),
  sampleCount: integer("sample_count").notNull().default(0),
  corpusFetchedAt: timestamp("corpus_fetched_at", { mode: "date", withTimezone: true }),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => ({
  // One profile per (user, handle) — case-insensitive uniqueness is enforced
  // in app code via normalized handle; the index backs the lookup.
  userHandleIdx: uniqueIndex("voice_profiles_user_handle_uq").on(t.userId, t.handle),
  handleIdx: index("voice_profiles_handle_idx").on(t.handle),
}));

export const tweets = pgTable("tweets", {
  id: text("id").primaryKey(),
  voiceProfileId: text("voice_profile_id").notNull(),
  text: text("text").notNull(),
  postedAt: text("posted_at"),
  likes: integer("likes").notNull().default(0),
  rts: integer("rts").notNull().default(0),
  replies: integer("replies").notNull().default(0),
  impressions: integer("impressions"),
  source: text("source").notNull().default("x_api"),
}, (t) => ({
  corpusIdx: index("tweets_corpus_idx").on(t.voiceProfileId, t.likes),
}));

export const generationJobs = pgTable("generation_jobs", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  voiceProfileId: text("voice_profile_id").notNull(),
  status: text("status").$type<"pending" | "running" | "done" | "failed">().notNull().default("pending"),
  error: text("error"),
  count: integer("count").notNull().default(5),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => ({
  jobUserIdx: index("generation_jobs_user_idx").on(t.userId, t.createdAt),
  jobProfileIdx: index("generation_jobs_profile_idx").on(t.voiceProfileId),
}));

export const drafts = pgTable("drafts", {
  id: text("id").primaryKey(),
  generationId: text("generation_id").notNull(),
  voiceProfileId: text("voice_profile_id").notNull(),
  text: text("text").notNull(),
  editedText: text("edited_text"),
  status: text("status").$type<"suggested" | "approved" | "rejected">().notNull().default("suggested"),
  styleMatch: integer("style_match").notNull().default(0),
  moderationFlags: jsonb("moderation_flags").$type<string[]>(),
  moderationLabel: text("moderation_label"),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => ({
  draftProfileIdx: index("drafts_profile_idx").on(t.voiceProfileId, t.createdAt),
  draftGenerationIdx: index("drafts_generation_idx").on(t.generationId),
}));

/**
 * Idempotency keys for profile creation and LLM calls.
 * (scope, key) is the natural unique pair — one cached result per scope.
 */
export const idempotencyKeys = pgTable("idempotency_keys", {
  scope: text("scope").notNull(),
  key: text("key").notNull(),
  status: text("status").$type<"in_progress" | "completed" | "failed">().notNull().default("in_progress"),
  result: text("result"),
  error: text("error"),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.scope, t.key] }),
}));

export type User = typeof users.$inferSelect;
export type VoiceProfile = typeof voiceProfiles.$inferSelect;
export type Tweet = typeof tweets.$inferSelect;
export type Draft = typeof drafts.$inferSelect;
export type GenerationJob = typeof generationJobs.$inferSelect;

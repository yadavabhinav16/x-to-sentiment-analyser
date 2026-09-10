import { drizzle, BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import {
  sqliteTable,
  text,
  integer,
  primaryKey,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email"),
  name: text("name"),
  passwordHash: text("password_hash"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const voiceProfiles = sqliteTable("voice_profiles", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  handle: text("handle").notNull(),
  displayName: text("display_name"),
  styleProfile: text("style_profile", { mode: "json" }).notNull(),
  sampleCount: integer("sample_count").notNull().default(0),
  corpusFetchedAt: integer("corpus_fetched_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const tweets = sqliteTable("tweets", {
  id: text("id").primaryKey(),
  voiceProfileId: text("voice_profile_id").notNull(),
  text: text("text").notNull(),
  postedAt: text("posted_at"),
  likes: integer("likes").notNull().default(0),
  rts: integer("rts").notNull().default(0),
  replies: integer("replies").notNull().default(0),
  impressions: integer("impressions"),
  source: text("source").notNull().default("x_api"),
});

export const generationJobs = sqliteTable("generation_jobs", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  voiceProfileId: text("voice_profile_id").notNull(),
  status: text("status", { enum: ["pending", "running", "done", "failed"] }).notNull().default("pending"),
  error: text("error"),
  count: integer("count").notNull().default(5),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const drafts = sqliteTable("drafts", {
  id: text("id").primaryKey(),
  generationId: text("generation_id").notNull(),
  voiceProfileId: text("voice_profile_id").notNull(),
  text: text("text").notNull(),
  editedText: text("edited_text"),
  status: text("status", { enum: ["suggested", "approved", "rejected"] }).notNull().default("suggested"),
  styleMatch: integer("style_match").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export type VoiceProfile = typeof voiceProfiles.$inferSelect;
export type Tweet = typeof tweets.$inferSelect;
export type Draft = typeof drafts.$inferSelect;
export type GenerationJob = typeof generationJobs.$inferSelect;

export function getDb(): BetterSQLite3Database<Record<string, never>> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require("better-sqlite3");
  const sqlite = new Database("data/app.db");
  // Ensure data dir exists
  const fs = require("fs");
  fs.mkdirSync("data", { recursive: true });
  return drizzle(sqlite);
}

export const authTables = { users };

import { drizzle, BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email"),
  name: text("name"),
  passwordHash: text("password_hash"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
}, (t) => ({
  usersEmailIdx: uniqueIndex("users_email_uq").on(t.email),
}));

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
}, (t) => ({
  // One profile per (user, handle) — case-insensitive uniqueness is enforced
  // in app code via normalized handle; the index backs the lookup.
  userHandleIdx: uniqueIndex("voice_profiles_user_handle_uq").on(t.userId, t.handle),
  handleIdx: index("voice_profiles_handle_idx").on(t.handle),
}));

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
}, (t) => ({
  corpusIdx: index("tweets_corpus_idx").on(t.voiceProfileId, t.likes),
}));

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
}, (t) => ({
  jobUserIdx: index("generation_jobs_user_idx").on(t.userId, t.createdAt),
  jobProfileIdx: index("generation_jobs_profile_idx").on(t.voiceProfileId),
}));

export const drafts = sqliteTable("drafts", {
  id: text("id").primaryKey(),
  generationId: text("generation_id").notNull(),
  voiceProfileId: text("voice_profile_id").notNull(),
  text: text("text").notNull(),
  editedText: text("edited_text"),
  status: text("status", { enum: ["suggested", "approved", "rejected"] }).notNull().default("suggested"),
  styleMatch: integer("style_match").notNull().default(0),
  moderationFlags: text("moderation_flags", { mode: "json" }),
  moderationLabel: text("moderation_label"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
}, (t) => ({
  draftProfileIdx: index("drafts_profile_idx").on(t.voiceProfileId, t.createdAt),
  draftGenerationIdx: index("drafts_generation_idx").on(t.generationId),
}));

/**
 * Idempotency keys for profile creation and LLM calls.
 * (scope, key) is the natural unique pair — one cached result per scope.
 */
export const idempotencyKeys = sqliteTable("idempotency_keys", {
  scope: text("scope").notNull(),
  key: text("key").notNull(),
  status: text("status", { enum: ["in_progress", "completed", "failed"] }).notNull().default("in_progress"),
  result: text("result"),
  error: text("error"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
}, (t) => ({
  pk: primaryKey({ columns: [t.scope, t.key] }),
}));

export type VoiceProfile = typeof voiceProfiles.$inferSelect;
export type Tweet = typeof tweets.$inferSelect;
export type Draft = typeof drafts.$inferSelect;
export type GenerationJob = typeof generationJobs.$inferSelect;

export function getDb(): BetterSQLite3Database<Record<string, never>> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require("better-sqlite3");
  const fs = require("fs");
  fs.mkdirSync("data", { recursive: true });
  const sqlite = new Database("data/app.db");
  sqlite.pragma("journal_mode = WAL");
  applyMigrations(sqlite);
  return drizzle(sqlite);
}

/**
 * Documented migration discipline:
 *
 * - Schema lives in src/db/schema.ts (source of truth).
 * - src/db/migrations.ts holds ordered, idempotent SQL migrations. Every
 *   statement is guarded (IF NOT EXISTS / check-before-alter) so it can run
 *   repeatedly and safely against any prior state.
 * - getDb() applies pending migrations automatically on startup (dev).
 * - For deploy-time / destructive migrations (data backfills, column drops),
 *   write a numbered migration to src/db/migrations.ts, test against a copy
 *   of data/app.db, and apply explicitly with `npm run db:migrate`.
 * - Never edit an already-released migration; append a new one.
 */
export function applyMigrations(sqlite: import("better-sqlite3").Database): void {
  // Lazily required to avoid a circular import at module init.
  const { MIGRATIONS } = require("./migrations") as { MIGRATIONS: Array<{ id: string; sql: string }> };
  sqlite.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    id TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);
  const applied = new Set(
    (sqlite.prepare("SELECT id FROM _migrations").all() as Array<{ id: string }>).map((r) => r.id)
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    sqlite.transaction(() => {
      sqlite.exec(m.sql);
      // Column-level guards for migrations that ALTER TABLE.
      if (m.id === "2026-09-10-002-draft-moderation-columns") {
        const { addDraftModerationColumns } = require("./migrations") as {
          addDraftModerationColumns: typeof import("./migrations").addDraftModerationColumns;
        };
        addDraftModerationColumns(sqlite);
      }
      sqlite.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(
        m.id,
        Date.now()
      );
    })();
  }
}
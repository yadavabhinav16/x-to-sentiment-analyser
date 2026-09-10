/**
 * Ordered, idempotent SQL migrations.
 *
 * Discipline (see src/db/schema.ts docblock):
 * - Append-only: never edit a released migration; add a new one below.
 * - Every statement guarded (IF NOT EXISTS / check-before-add) so the set is
 *   safe to run against any prior DB state, repeatedly.
 * - Applied automatically on getDb(); explicit application via `npm run db:migrate`.
 */
export const MIGRATIONS: Array<{ id: string; sql: string }> = [
  {
    id: "2026-09-10-001-indexes-constraints",
    sql: `
      CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users (email);

      CREATE UNIQUE INDEX IF NOT EXISTS voice_profiles_user_handle_uq
        ON voice_profiles (user_id, handle);
      CREATE INDEX IF NOT EXISTS voice_profiles_handle_idx
        ON voice_profiles (handle);

      CREATE INDEX IF NOT EXISTS tweets_corpus_idx
        ON tweets (voice_profile_id, likes);

      CREATE INDEX IF NOT EXISTS generation_jobs_user_idx
        ON generation_jobs (user_id, created_at);
      CREATE INDEX IF NOT EXISTS generation_jobs_profile_idx
        ON generation_jobs (voice_profile_id);

      CREATE INDEX IF NOT EXISTS drafts_profile_idx
        ON drafts (voice_profile_id, created_at);
      CREATE INDEX IF NOT EXISTS drafts_generation_idx
        ON drafts (generation_id);

      CREATE TABLE IF NOT EXISTS idempotency_keys (
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'in_progress',
        result TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (scope, key)
      );
    `,
  },
  {
    id: "2026-09-10-002-draft-moderation-columns",
    sql: `
      -- SQLite has no IF NOT EXISTS for ADD COLUMN; guarded in code below via _columns check.
    `,
  },
];

/**
 * Column-level migration guard: adds moderation columns to drafts if missing.
 * (Kept as a function because SQLite ADD COLUMN lacks IF NOT EXISTS.)
 */
export function addDraftModerationColumns(
  sqlite: import("better-sqlite3").Database
): void {
  const cols = new Set(
    (sqlite.prepare("PRAGMA table_info(drafts)").all() as Array<{ name: string }>).map(
      (c) => c.name
    )
  );
  if (!cols.has("moderation_flags")) {
    sqlite.exec("ALTER TABLE drafts ADD COLUMN moderation_flags TEXT");
  }
  if (!cols.has("moderation_label")) {
    sqlite.exec("ALTER TABLE drafts ADD COLUMN moderation_label TEXT");
  }
}
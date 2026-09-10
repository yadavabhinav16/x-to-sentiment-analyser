/**
 * Ordered, idempotent SQL migrations (Postgres / Neon).
 *
 * Discipline:
 * - Append-only: never edit a released migration; add a new one below.
 * - Every statement guarded (IF NOT EXISTS) so the set is safe to run
 *   repeatedly against any prior DB state.
 * - Applied automatically by migrate.ts / npm run db:migrate.
 */
export const MIGRATIONS: Array<{ id: string; sql: string }> = [
  {
    id: "2026-09-11-001-postgres-baseline",
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT,
        name TEXT,
        password_hash TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users (email);
      CREATE TABLE IF NOT EXISTS voice_profiles (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        handle TEXT NOT NULL,
        display_name TEXT,
        style_profile TEXT NOT NULL,
        sample_count INTEGER NOT NULL DEFAULT 0,
        corpus_fetched_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS voice_profiles_user_handle_uq
        ON voice_profiles (user_id, handle);
      CREATE INDEX IF NOT EXISTS voice_profiles_handle_idx
        ON voice_profiles (handle);
      CREATE TABLE IF NOT EXISTS tweets (
        id TEXT PRIMARY KEY,
        voice_profile_id TEXT NOT NULL,
        text TEXT NOT NULL,
        posted_at TEXT,
        likes INTEGER NOT NULL DEFAULT 0,
        rts INTEGER NOT NULL DEFAULT 0,
        replies INTEGER NOT NULL DEFAULT 0,
        impressions INTEGER,
        source TEXT NOT NULL DEFAULT 'x_api'
      );
      CREATE INDEX IF NOT EXISTS tweets_corpus_idx
        ON tweets (voice_profile_id, likes);
      CREATE TABLE IF NOT EXISTS generation_jobs (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        voice_profile_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        error TEXT,
        count INTEGER NOT NULL DEFAULT 5,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS generation_jobs_user_idx
        ON generation_jobs (user_id, created_at);
      CREATE INDEX IF NOT EXISTS generation_jobs_profile_idx
        ON generation_jobs (voice_profile_id);
      CREATE TABLE IF NOT EXISTS drafts (
        id TEXT PRIMARY KEY,
        generation_id TEXT NOT NULL,
        voice_profile_id TEXT NOT NULL,
        text TEXT NOT NULL,
        edited_text TEXT,
        status TEXT NOT NULL DEFAULT 'suggested',
        style_match INTEGER NOT NULL DEFAULT 0,
        moderation_flags JSONB,
        moderation_label TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
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
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (scope, key)
      );
    `,
  },
];

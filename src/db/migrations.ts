/**
 * Ordered, idempotent SQL migrations (Postgres / Neon).
 *
 * Discipline:
 * - Append-only: never edit a released migration; add a new one below.
 * - Each migration is an ARRAY of complete statements. The runner never
 *   splits strings — a semicolon inside a string literal cannot break it.
 * - Every statement guarded (IF NOT EXISTS / IF NOT EXISTS-constraint check)
 *   so the set is safe to run repeatedly against any prior DB state.
 * - Applied automatically by migrate.ts / npm run db:migrate; each
 *   migration's statements + its ledger insert run in one db.batch()
 *   (single non-interactive transaction over Neon HTTP).
 */
export const MIGRATIONS: Array<{ id: string; statements: string[] }> = [
  {
    id: "2026-09-11-001-postgres-baseline",
    statements: [
      `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT,
        name TEXT,
        password_hash TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users (email)`,
      `CREATE TABLE IF NOT EXISTS voice_profiles (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        handle TEXT NOT NULL,
        display_name TEXT,
        style_profile TEXT NOT NULL,
        sample_count INTEGER NOT NULL DEFAULT 0,
        corpus_fetched_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS voice_profiles_user_handle_uq
        ON voice_profiles (user_id, handle)`,
      `CREATE INDEX IF NOT EXISTS voice_profiles_handle_idx
        ON voice_profiles (handle)`,
      `CREATE TABLE IF NOT EXISTS tweets (
        id TEXT PRIMARY KEY,
        voice_profile_id TEXT NOT NULL,
        text TEXT NOT NULL,
        posted_at TEXT,
        likes INTEGER NOT NULL DEFAULT 0,
        rts INTEGER NOT NULL DEFAULT 0,
        replies INTEGER NOT NULL DEFAULT 0,
        impressions INTEGER,
        source TEXT NOT NULL DEFAULT 'x_api'
      )`,
      `CREATE INDEX IF NOT EXISTS tweets_corpus_idx
        ON tweets (voice_profile_id, likes)`,
      `CREATE TABLE IF NOT EXISTS generation_jobs (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        voice_profile_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        error TEXT,
        count INTEGER NOT NULL DEFAULT 5,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS generation_jobs_user_idx
        ON generation_jobs (user_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS generation_jobs_profile_idx
        ON generation_jobs (voice_profile_id)`,
      `CREATE TABLE IF NOT EXISTS drafts (
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
      )`,
      `CREATE INDEX IF NOT EXISTS drafts_profile_idx
        ON drafts (voice_profile_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS drafts_generation_idx
        ON drafts (generation_id)`,
      `CREATE TABLE IF NOT EXISTS idempotency_keys (
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'in_progress',
        result TEXT,
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (scope, key)
      )`,
    ],
  },
  {
    id: "2026-09-11-002-shadow-validation",
    statements: [
      `ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS shadow_verdict TEXT`,
      `ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS shadow_validator TEXT`,
    ],
  },
  {
    id: "2026-09-11-003-lower-email-index",
    statements: [
      `CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uq ON users (lower(email))`,
      `CREATE INDEX IF NOT EXISTS voice_profiles_handle_lower_idx ON voice_profiles (lower(handle))`,
    ],
  },
  {
    // Foreign keys with explicit delete policies. Statements are individually
    // guarded so the migration is idempotent on any prior state; FKs are added
    // only after orphan rows are purged.
    id: "2026-09-11-004-foreign-keys",
    statements: [
      `DELETE FROM tweets t WHERE NOT EXISTS (SELECT 1 FROM voice_profiles vp WHERE vp.id = t.voice_profile_id)`,
      `DELETE FROM drafts d WHERE NOT EXISTS (SELECT 1 FROM voice_profiles vp WHERE vp.id = d.voice_profile_id)`,
      `DELETE FROM generation_jobs j WHERE NOT EXISTS (SELECT 1 FROM voice_profiles vp WHERE vp.id = j.voice_profile_id)`,
      `DELETE FROM drafts d WHERE NOT EXISTS (SELECT 1 FROM generation_jobs j WHERE j.id = d.generation_id)`,
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tweets_voice_profile_fk') THEN
           ALTER TABLE tweets ADD CONSTRAINT tweets_voice_profile_fk
             FOREIGN KEY (voice_profile_id) REFERENCES voice_profiles(id) ON DELETE CASCADE;
         END IF;
       END $$`,
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'drafts_voice_profile_fk') THEN
           ALTER TABLE drafts ADD CONSTRAINT drafts_voice_profile_fk
             FOREIGN KEY (voice_profile_id) REFERENCES voice_profiles(id) ON DELETE CASCADE;
         END IF;
       END $$`,
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'drafts_generation_fk') THEN
           ALTER TABLE drafts ADD CONSTRAINT drafts_generation_fk
             FOREIGN KEY (generation_id) REFERENCES generation_jobs(id) ON DELETE CASCADE;
         END IF;
       END $$`,
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'generation_jobs_voice_profile_fk') THEN
           ALTER TABLE generation_jobs ADD CONSTRAINT generation_jobs_voice_profile_fk
             FOREIGN KEY (voice_profile_id) REFERENCES voice_profiles(id) ON DELETE CASCADE;
         END IF;
       END $$`,
      `UPDATE voice_profiles SET user_id = NULL WHERE user_id = ''`,
      `UPDATE generation_jobs SET user_id = NULL WHERE user_id = ''`,
    ],
  },
  {
    // Token ledger for per-user spend tracking (FinOps): one row per LLM call.
    id: "2026-09-11-005-token-ledger",
    statements: [
      `CREATE TABLE IF NOT EXISTS token_ledger (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        tokens_in INTEGER NOT NULL DEFAULT 0,
        tokens_out INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS token_ledger_user_idx ON token_ledger (user_id, created_at)`,
    ],
  },
];

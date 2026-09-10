import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "fs";
import path from "path";
import * as schema from "./schema";

export function createDb() {
  const dir = path.join(process.cwd(), "data");
  mkdirSync(dir, { recursive: true });
  const sqlite = new Database(path.join(dir, "app.db"));
  sqlite.pragma("journal_mode = WAL");
  migrate(sqlite);
  return drizzle(sqlite, { schema });
}

let singleton: ReturnType<typeof createDb> | null = null;

export function getDb() {
  if (!singleton) singleton = createDb();
  return singleton;
}

function migrate(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT,
      name TEXT,
      password_hash TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS voice_profiles (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      handle TEXT NOT NULL,
      display_name TEXT,
      style_profile TEXT NOT NULL,
      sample_count INTEGER NOT NULL DEFAULT 0,
      corpus_fetched_at INTEGER,
      created_at INTEGER NOT NULL
    );
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
    CREATE TABLE IF NOT EXISTS generation_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      voice_profile_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      count INTEGER NOT NULL DEFAULT 5,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS drafts (
      id TEXT PRIMARY KEY,
      generation_id TEXT NOT NULL,
      voice_profile_id TEXT NOT NULL,
      text TEXT NOT NULL,
      edited_text TEXT,
      status TEXT NOT NULL DEFAULT 'suggested',
      style_match INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
  `);
  // Additive migration for existing databases (ALTER fails if column exists).
  try {
    sqlite.exec(`ALTER TABLE users ADD COLUMN password_hash TEXT;`);
  } catch {
    /* column already present */
  }
}

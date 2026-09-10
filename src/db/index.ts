import { drizzle, NeonHttpDatabase } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";
import { isLocal } from "./env";

/**
 * Database client: Neon Postgres via Drizzle ORM using the neon-http
 * serverless driver (HTTP fetch per query — works on Node and edge runtimes,
 * ideal for Vercel). DATABASE_URL must be a Neon *pooled* connection string.
 *
 * For long-running local scripts the same HTTP driver works unchanged — no
 * WebSocket plumbing needed.
 */

type Db = NeonHttpDatabase<typeof schema>;

let singleton: Db | null = null;

export function createDb(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Point it at a Neon pooled connection string (see .env.example)."
    );
  }
  return drizzle(neon(url), { schema });
}

export function getDb(): Db {
  if (!singleton) singleton = createDb();
  return singleton;
}

/** Test isolation helper: drop and re-create the singleton. */
export function resetDb(): void {
  singleton = null;
}

export { isLocal };
export type { Db };

import { sql } from "drizzle-orm";
import { getDb } from "./index";
import { MIGRATIONS } from "./migrations";

/**
 * Migration runner: applies any un-applied migration in order, tracked in
 * _migrations. Idempotent — safe to run at deploy time and on every boot.
 */
export async function migrate(): Promise<void> {
  const db = getDb();
  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS _migrations (
    id TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`
  );
  const appliedRows = await db.execute<{ id: string }>(
    sql`SELECT id FROM _migrations`
  );
  const applied = new Set(appliedRows.rows.map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    // neon-http executes one statement per request — split on semicolons.
    const statements = m.sql
      .split(";")
      .map((s) => s.replace(/--[^\n]*/g, "").trim())
      .filter(Boolean);
    for (const stmt of statements) {
      await db.execute(sql.raw(stmt));
    }
    await db.execute(
      sql`INSERT INTO _migrations (id) VALUES (${m.id}) ON CONFLICT DO NOTHING`
    );
  }
}

// CLI entry: npm run db:migrate
if (process.argv[1] && process.argv[1].endsWith("migrate.ts")) {
  // Load .env.local when run outside Next (Next loads it automatically).
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require("dotenv").config({ path: `${process.cwd()}/.env.local` });
  } catch {
    /* dotenv optional */
  }
  migrate()
    .then(() => {
      console.log("Migrations applied.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("Migration failed:", err);
      process.exit(1);
    });
}

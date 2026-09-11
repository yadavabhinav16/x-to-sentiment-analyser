import { sql } from "drizzle-orm";
import { getDb } from "./index";
import { MIGRATIONS } from "./migrations";

/**
 * Migration runner: applies any un-applied migration in order, tracked in
 * _migrations. Idempotent — safe to run at deploy time and on every boot.
 *
 * Atomicity: each migration's statements + its ledger insert run in ONE
 * db.batch() — the Neon HTTP driver executes a batch as a single
 * non-interactive transaction, so a migration either fully applies or not
 * at all (no half-applied state, no re-run surprises).
 *
 * Statement handling: migrations are declared as arrays of complete
 * statements — the runner never splits on semicolons, so semicolons inside
 * string literals are safe.
 */
export async function migrate(): Promise<void> {
  const db = getDb();
  await db.execute(sql`CREATE TABLE IF NOT EXISTS _migrations (
    id TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const appliedRows = await db.execute<{ id: string }>(
    sql`SELECT id FROM _migrations`
  );
  const applied = new Set(appliedRows.rows.map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    // One batch = one non-interactive transaction: all statements + the
    // ledger row commit together or not at all.
    await db.batch([
      ...m.statements.map((stmt) => sql.raw(stmt)),
      sql`INSERT INTO _migrations (id) VALUES (${m.id}) ON CONFLICT DO NOTHING`,
    ] as any);
    console.log(`Applied migration ${m.id} (${m.statements.length} statements)`);
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

import { neon } from "@neondatabase/serverless";
import { MIGRATIONS } from "./migrations";

/**
 * Migration runner: applies any un-applied migration in order, tracked in
 * _migrations. Idempotent — safe to run at deploy time and on every boot.
 *
 * Atomicity: the Neon HTTP client's .transaction([...]) executes an array of
 * tagged-template queries in a SINGLE non-interactive transaction — each
 * migration either fully applies (statements + ledger row) or not at all.
 *
 * Statement handling: migrations are declared as arrays of complete
 * statements — the runner never splits on semicolons, so semicolons inside
 * string literals are safe.
 *
 * Drizzle note: db.batch() requires drizzle query-builder objects (they carry
 * an internal _prepare); sql.raw() strings are NOT valid batch items. Running
 * migrations through the raw neon client avoids that coupling.
 */
export async function migrate(): Promise<string[]> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Point it at a Neon pooled connection string.");
  }
  const client = neon(url);
  await client`CREATE TABLE IF NOT EXISTS _migrations (
    id TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  const appliedRows = (await client`SELECT id FROM _migrations`) as Array<{ id: string }>;
  const applied = new Set(appliedRows.map((r) => r.id));
  const appliedNow: string[] = [];
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    const txn = (client as unknown as {
      transaction: (queries: unknown[]) => Promise<unknown>;
    }).transaction;
    await txn.call(client, [
      ...m.statements.map((stmt) => client.query(stmt)),
      client.query("INSERT INTO _migrations (id) VALUES ($1) ON CONFLICT DO NOTHING", [m.id]),
    ]);
    appliedNow.push(m.id);
    console.log(`Applied migration ${m.id} (${m.statements.length} statements)`);
  }
  return appliedNow;
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
    .then((applied) => {
      console.log(
        applied.length
          ? `Migrations applied: ${applied.join(", ")}`
          : "Migrations up to date."
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error("Migration failed:", err);
      process.exit(1);
    });
}

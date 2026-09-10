import { migrate } from "./migrate";

/**
 * npm run db:push — applies the schema to the configured Neon Postgres DB
 * (same idempotent migration runner as db:migrate).
 */
// CLI entry: npm run db:push
if (process.argv[1] && process.argv[1].endsWith("push.ts")) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require("dotenv").config({ path: `${process.cwd()}/.env.local` });
  } catch {
    /* dotenv optional */
  }
  migrate()
    .then(() => {
      console.log("Schema pushed.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("Push failed:", err);
      process.exit(1);
    });
}

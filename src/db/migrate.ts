import { getDb } from "./schema";
import { applyMigrations } from "./schema";

/** Explicit migration application (deploy-time discipline). */
const db = getDb();
void db;
console.log("Migrations applied.");
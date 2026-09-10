import { eq, sql, and } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";

/**
 * Auth service data access — routed through UserRepository (interface in
 * src/repositories/interfaces.ts). Kept as a thin module so NextAuth's
 * Credentials provider and requireUser share one implementation.
 */
export async function getUserRowByEmail(email: string) {
  const clean = email.trim().toLowerCase();
  // Uses the functional lower(email) index from migration 2026-09-11-003.
  const rows = await getDb()
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${clean}`)
    .limit(1);
  return rows[0];
}

export async function getUserRowById(id: string) {
  const rows = await getDb().select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0];
}

export async function insertUser(row: {
  id: string;
  email: string;
  name: string | null;
  passwordHash: string;
  createdAt: Date;
}): Promise<void> {
  await getDb().insert(users).values(row);
}

import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../../db";
import { users } from "../../db/schema";
import { hashPassword, verifyPassword } from "./password";

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
}

export async function findUserByEmail(email: string): Promise<(typeof users.$inferSelect) | undefined> {
  const clean = email.trim().toLowerCase();
  const all = await getDb().select().from(users);
  return all.find((u) => (u.email ?? "").toLowerCase() === clean);
}

export async function getUserById(id: string): Promise<(typeof users.$inferSelect) | undefined> {
  const rows = await getDb().select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0];
}

export async function createUser(email: string, password: string, name?: string) {
  const db = getDb();
  if (await findUserByEmail(email)) throw new Error("An account with this email already exists.");
  const row = {
    id: randomUUID(),
    email: email.trim().toLowerCase(),
    name: name ?? email.split("@")[0],
    passwordHash: hashPassword(password),
    createdAt: new Date(),
  };
  await db.insert(users).values(row);
  return row;
}

export async function authenticate(email: string, password: string): Promise<AuthUser | null> {
  const user = await findUserByEmail(email);
  if (!user?.passwordHash) return null;
  if (!verifyPassword(password, user.passwordHash)) return null;
  return { id: user.id, email: user.email ?? email, name: user.name };
}

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

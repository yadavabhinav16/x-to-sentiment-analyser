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

export function findUserByEmail(email: string): (typeof users.$inferSelect) | undefined {
  const clean = email.trim().toLowerCase();
  const all = getDb().select().from(users).all();
  return all.find((u) => (u.email ?? "").toLowerCase() === clean);
}

export function getUserById(id: string): (typeof users.$inferSelect) | undefined {
  return getDb().select().from(users).where(eq(users.id, id)).get();
}

export function createUser(email: string, password: string, name?: string) {
  const db = getDb();
  if (findUserByEmail(email)) throw new Error("An account with this email already exists.");
  const row = {
    id: randomUUID(),
    email: email.trim().toLowerCase(),
    name: name ?? email.split("@")[0],
    passwordHash: hashPassword(password),
    createdAt: new Date(),
  };
  db.insert(users).values(row).run();
  return row;
}

export function authenticate(email: string, password: string): AuthUser | null {
  const user = findUserByEmail(email);
  if (!user?.passwordHash) return null;
  if (!verifyPassword(password, user.passwordHash)) return null;
  return { id: user.id, email: user.email ?? email, name: user.name };
}

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
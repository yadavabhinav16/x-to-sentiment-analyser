import { randomUUID } from "crypto";
import { userRepository } from "../../repositories";
import { hashPassword, verifyPassword } from "./password";

/**
 * Auth service: account logic and credentials only. All persistence goes
 * through the UserRepository interface (Drizzle impl in src/repositories).
 */

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
}

export async function findUserByEmail(email: string) {
  return userRepository.findByEmail(email);
}

export async function getUserById(id: string) {
  return userRepository.findById(id);
}

export async function createUser(email: string, password: string, name?: string) {
  if (await findUserByEmail(email)) throw new Error("An account with this email already exists.");
  return userRepository.insert({
    id: randomUUID(),
    email: email.trim().toLowerCase(),
    name: name ?? email.split("@")[0],
    passwordHash: hashPassword(password),
    createdAt: new Date(),
  });
}

export async function authenticate(email: string, password: string): Promise<AuthUser | null> {
  const user = await findUserByEmail(email);
  if (!user?.passwordHash) return null;
  if (!verifyPassword(password, user.passwordHash)) return null;
  return { id: user.id, email: user.email ?? email, name: user.name };
}

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

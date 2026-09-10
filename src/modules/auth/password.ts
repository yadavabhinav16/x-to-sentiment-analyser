import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

/**
 * Password hashing with Node's built-in scrypt — no extra dependency.
 * Format: scrypt$<N>$<saltHex>$<hashHex>
 */
const N = 16384;
const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, { N });
  return `scrypt$${N}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, nStr, saltHex, hashHex] = stored.split("$");
    if (scheme !== "scrypt") return false;
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const actual = scryptSync(password, salt, expected.length, { N: Number(nStr) });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
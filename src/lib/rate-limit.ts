/**
 * Simple in-memory rate limiter (fixed window per key).
 * Suitable for a single-process dev/small deployment; NOT shared across
 * instances. Survives for the lifetime of the Node process only.
 */
type Entry = { count: number; windowStart: number };

const buckets = new Map<string, Entry>();

// Prevent unbounded memory growth.
function sweep() {
  const now = Date.now();
  for (const [key, e] of buckets) {
    if (now - e.windowStart > 60 * 60 * 1000) buckets.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep();
  const entry = buckets.get(key);
  if (!entry || now - entry.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: limit - 1, retryAfterSec: 0 };
  }
  if (entry.count >= limit) {
    const retryAfterSec = Math.ceil((entry.windowStart + windowMs - now) / 1000);
    return { allowed: false, remaining: 0, retryAfterSec };
  }
  entry.count += 1;
  return { allowed: true, remaining: limit - entry.count, retryAfterSec: 0 };
}

/** Test isolation helper: clear all buckets. */
export const _reset = reset;

function reset(): void {
  buckets.clear();
}

/** Best-effort client IP from proxy headers (for anonymous rate limiting). */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
/**
 * Circuit breaker (in-memory, per-key) for outbound calls (LLM providers etc.).
 * States: closed (normal) → open (failing fast) → half-open (probing) → closed.
 */
export type BreakerState = "closed" | "open" | "half-open";

export interface BreakerOptions {
  /** Failures (consecutive) before opening. */
  threshold?: number;
  /** Ms to wait before allowing a probe (half-open). */
  cooldownMs?: number;
}

interface BreakerEntry {
  state: BreakerState;
  failures: number;
  openedAt: number;
}

const breakers = new Map<string, BreakerEntry>();

const DEFAULT_THRESHOLD = 5;
const DEFAULT_COOLDOWN_MS = 60_000;

export function getBreakerState(key: string): BreakerState {
  const e = breakers.get(key);
  if (!e) return "closed";
  if (e.state === "open") {
    if (Date.now() - e.openedAt >= DEFAULT_COOLDOWN_MS) {
      e.state = "half-open";
      return "half-open";
    }
    return "open";
  }
  return e.state;
}

/** Returns true when the call may proceed (closed or half-open probe). */
export function allowRequest(key: string, opts: BreakerOptions = {}): boolean {
  const state = getBreakerState(key);
  if (state === "open") return false;
  return true;
}

export function recordSuccess(key: string): void {
  breakers.set(key, { state: "closed", failures: 0, openedAt: 0 });
}

export function recordFailure(
  key: string,
  opts: BreakerOptions = {}
): { opened: boolean } {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const cooldownMs = opts.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  let e = breakers.get(key);
  if (!e) {
    e = { state: "closed", failures: 0, openedAt: 0 };
  }
  e.failures += 1;
  if (e.failures >= threshold || e.state === "half-open") {
    e.state = "open";
    e.openedAt = Date.now();
    breakers.set(key, e);
    return { opened: true };
  }
  breakers.set(key, e);
  return { opened: false };
}

/** Test/reset helper. */
export function resetBreakers(): void {
  breakers.clear();
}
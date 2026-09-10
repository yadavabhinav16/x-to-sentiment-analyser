import { describe, it, expect, beforeEach } from "vitest";
import {
  allowRequest,
  recordFailure,
  recordSuccess,
  resetBreakers,
} from "../src/lib/circuit-breaker";

describe("circuit breaker", () => {
  beforeEach(() => resetBreakers());

  it("starts closed", () => {
    expect(allowRequest("p1")).toBe(true);
  });

  it("opens after threshold consecutive failures", () => {
    for (let i = 0; i < 5; i++) recordFailure("p1", { threshold: 5 });
    expect(allowRequest("p1")).toBe(false);
  });

  it("stays closed below threshold", () => {
    recordFailure("p1", { threshold: 5 });
    recordFailure("p1", { threshold: 5 });
    expect(allowRequest("p1")).toBe(true);
  });

  it("success resets failures", () => {
    recordFailure("p1", { threshold: 3 });
    recordFailure("p1", { threshold: 3 });
    recordSuccess("p1");
    recordFailure("p1", { threshold: 3 });
    recordFailure("p1", { threshold: 3 });
    expect(allowRequest("p1")).toBe(true);
  });

  it("keys are independent", () => {
    for (let i = 0; i < 5; i++) recordFailure("a", { threshold: 5 });
    expect(allowRequest("a")).toBe(false);
    expect(allowRequest("b")).toBe(true);
  });
});
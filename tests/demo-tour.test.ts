import { describe, it, expect } from "vitest";
import { TOUR_STAGES, TOUR_STAGE_IDS } from "../src/modules/demo/tour";

describe("guided demo tour", () => {
  it("has 8 sequential stages numbered 1..8", () => {
    expect(TOUR_STAGES.length).toBe(8);
    expect(TOUR_STAGES.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("covers every major architectural layer", () => {
    expect(TOUR_STAGE_IDS).toEqual([
      "architecture",
      "auth",
      "ingestion",
      "analysis",
      "resilience",
      "generation",
      "moderation",
      "persistence",
    ]);
  });

  it("each stage highlights at least 3 design decisions", () => {
    for (const s of TOUR_STAGES) {
      expect(s.decisions.length, `stage ${s.id} decisions`).toBeGreaterThanOrEqual(3);
      for (const d of s.decisions) {
        expect(d.title.length).toBeGreaterThan(0);
        expect(d.detail.length).toBeGreaterThan(40);
      }
    }
  });

  it("each stage maps to a real demo API action", () => {
    const validActions = [
      "auth",
      "ingest",
      "analyze",
      "resilience",
      "generate",
      "moderate",
      "persist",
      "done",
    ];
    for (const s of TOUR_STAGES) {
      expect(validActions, `stage ${s.id} action`).toContain(s.action);
      expect(s.liveAction.length).toBeGreaterThan(20);
      expect(s.modules.length).toBeGreaterThan(0);
    }
  });
});
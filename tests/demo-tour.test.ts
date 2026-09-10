import { describe, it, expect } from "vitest";
import { TOUR_STAGES, TOUR_STAGE_IDS } from "../src/modules/demo/tour";

describe("guided demo tour", () => {
  it("has 10 sequential stages numbered 1..10", () => {
    expect(TOUR_STAGES.length).toBe(10);
    expect(TOUR_STAGES.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("covers every major architectural layer", () => {
    expect(TOUR_STAGE_IDS).toEqual([
      "architecture",
      "auth",
      "ingestion",
      "analysis",
      "resilience",
      "generation",
      "quality",
      "moderation",
      "shadow",
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
      "quality",
      "moderate",
      "shadow",
      "persist",
      "done",
    ];
    for (const s of TOUR_STAGES) {
      expect(validActions, `stage ${s.id} action`).toContain(s.action);
      expect(s.liveAction.length).toBeGreaterThan(20);
      expect(s.modules.length).toBeGreaterThan(0);
    }
  });

  it("describes only the current architecture — no past-state or migration framing", () => {
    const banned = [
      /previously/i,
      /used to/i,
      /we moved/i,
      /migrated? from/i,
      /bake-?off/i,
      /legacy/i,
      /deprecated/i,
      /\bnow (blends|uses|runs)\b/i,
      /replaced/i,
      /\bsqlite\b/i,
    ];
    for (const s of TOUR_STAGES) {
      const text = [s.title, s.liveAction, ...s.decisions.map((d) => `${d.title} ${d.detail}`)].join(" ");
      for (const re of banned) {
        expect(text, `stage ${s.id}`).not.toMatch(re);
      }
    }
  });
});

import { describe, it, expect } from "vitest";
import { analyzeSyntax } from "@/modules/analysis/factors/syntax";
import type { RawTweet } from "@/modules/ingestion/ports/tweet-source";

function tw(text: string): RawTweet {
  return {
    id: Math.random().toString(),
    text,
    createdAt: new Date().toISOString(),
    likeCount: 0,
    retweetCount: 0,
    replyCount: 0,
    quoteCount: 0,
    impressionCount: null,
  };
}

describe("analyzeSyntax", () => {
  it("computes average length and range", () => {
    const s = analyzeSyntax([tw("hello world"), tw("this is a much longer tweet body indeed")]);
    expect(s.avgLengthChars).toBe(Math.round(((11 + 39) / 2) * 100) / 100);
    expect(s.lengthRange[0]).toBe(11);
    expect(s.lengthRange[1]).toBe(39);
  });

  it("computes exclamation and question rates", () => {
    const s = analyzeSyntax([tw("wow!"), tw("really?"), tw("plain"), tw("yes!")]);
    expect(s.punctuation.exclamationRate).toBe(0.5);
    expect(s.punctuation.questionRate).toBe(0.25);
  });

  it("detects ellipsis usage", () => {
    const s = analyzeSyntax([tw("hmm... ok"), tw("wait… what"), tw("no dots here")]);
    expect(s.punctuation.ellipsisUse).toBeCloseTo(2 / 3, 2);
  });

  it("handles empty corpus without crashing", () => {
    const s = analyzeSyntax([]);
    expect(s.avgLengthChars).toBe(0);
    expect(s.lengthRange).toEqual([0, 0]);
  });

  it("marks all-caps-heavy corpus as mixed/title", () => {
    const s = analyzeSyntax([tw("BIG NEWS EVERYONE"), tw("HUGE ANNOUNCEMENT TODAY")]);
    expect(["mixed", "title"]).toContain(s.casing);
  });
});

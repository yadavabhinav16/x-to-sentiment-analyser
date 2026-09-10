import { describe, it, expect } from "vitest";
import { analyzeCorpus } from "@/modules/analysis/analyzer";
import { styleProfileSchema, type StyleProfile } from "@/modules/analysis/style-profile";
import type { RawTweet } from "@/modules/ingestion/ports/tweet-source";

function tw(text: string, likes = 10): RawTweet {
  return {
    id: Math.random().toString(),
    text,
    createdAt: new Date().toISOString(),
    likeCount: likes,
    retweetCount: 2,
    replyCount: 1,
    quoteCount: 0,
    impressionCount: 10000,
  };
}

// No OPENROUTER_API_KEY in test env → deterministic PASS-1 only merge
const corpus = [
  tw("Big launch today! The future of space travel is here 🔥", 500),
  tw("Space is hard, but worth it", 200),
  tw("AI will change everything, mark my words", 300),
  tw("Watching the rocket launch tonight. Amazing engineering", 150),
  tw("The model keeps getting better. AI progress is wild", 250),
  tw("Cost per launch is dropping fast. Great for the industry", 90),
  tw("Engineering is beautiful when it works", 80),
  tw("Mars is the next step for humanity", 400),
  tw("Hardware is hard, software is eatable", 60),
  tw("Another day, another test flight 🚀", 120),
];

describe("analyzer + style-profile merge (PASS 1, no LLM)", () => {
  let profile: StyleProfile;

  it("produces a zod-valid StyleProfile", async () => {
    const out = await analyzeCorpus("testuser", "Test User", corpus);
    expect(() => styleProfileSchema.parse(out)).not.toThrow();
    profile = out;
  });

  it("carries corpus metadata", () => {
    expect(profile.handle).toBe("testuser");
    expect(profile.displayName).toBe("Test User");
    expect(profile.sampleCount).toBe(corpus.length);
  });

  it("merges deterministic pass-1 factors", () => {
    expect(profile.syntax.avgLengthChars).toBeGreaterThan(0);
    expect(profile.lexical.vocabRichness).toBeGreaterThan(0);
    expect(profile.emojiFormat.emojiRate).toBeGreaterThan(0);
    expect(profile.tone.formality).toBeGreaterThanOrEqual(0);
    expect(profile.tone.formality).toBeLessThanOrEqual(1);
  });

  it("computes topic clusters from keywords", () => {
    const names = profile.topics.clusters.map((c) => c.name);
    expect(names).toContain("Space");
    expect(names).toContain("AI");
    const shares = profile.topics.clusters.map((c) => c.share);
    expect(Math.max(...shares)).toBeLessThanOrEqual(1);
  });

  it("fills voice summary fallback without LLM", () => {
    expect(profile.voice.oneParagraphSummary).toContain("testuser");
  });

  it("rejects invalid profiles", () => {
    expect(() => styleProfileSchema.parse({ foo: "bar" })).toThrow();
  });
});

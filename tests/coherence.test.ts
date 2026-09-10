import { describe, it, expect } from "vitest";
import { checkCoherence, scoreStyleDeviation } from "../src/modules/analysis/coherence";

// A representative minimal profile built from the elonmusk fixture analysis.
const profile = {
  handle: "testuser",
  sampleCount: 100,
  syntax: {
    avgLengthChars: 80,
    lengthRange: [30, 160] as [number, number],
    casing: "standard" as const,
    punctuation: { exclamationRate: 0.08, questionRate: 0.02, ellipsisUse: 0.1, commaStyle: "light" },
  },
  lexical: { signaturePhrases: ["to be fair"], vocabRichness: 0.5, slangLevel: 0.3, profanityPolicy: "none" },
  emojiFormat: { emojiRate: 0.03, typicalEmojis: [], usesThreads: false, linkPolicy: "rare", lineBreakStyle: "single" },
  engagement: { topFormats: ["short takes"], avgEngagementRate: 0.05, lengthVsEngagement: "short wins" },
  tone: { formality: 0.5, sentiment: "neutral", assertiveness: 0.8, humorStyle: "dry" },
  topics: {
    clusters: [{ name: "Tech", share: 0.5, keywords: ["ai", "rocket", "software", "engineering"] }],
    obsessions: ["ai"],
    avoidedTopics: [],
  },
  voice: { signaturePhrasesInContext: [], rhetoricalDevices: [], oneParagraphSummary: "punchy engineer" },
};

describe("checkCoherence — structural errors, not style", () => {
  it("accepts clean, stylistically quirky drafts", () => {
    // lowercase start, no period: authentic voice, NOT an error
    expect(checkCoherence("just shipped the thing and it works lol").coherent).toBe(true);
  });

  it("flags doubled words", () => {
    const r = checkCoherence("this is is a problem with the model");
    expect(r.coherent).toBe(false);
    expect(r.flags).toContain("repeated_word");
  });

  it("flags dangling final word (truncation)", () => {
    const r = checkCoherence("heading to the launch site with");
    expect(r.coherent).toBe(false);
    expect(r.flags).toContain("dangling_word");
  });

  it("flags long unterminated drafts", () => {
    const t = "we are going to make this work no matter what it takes to get there and beyond";
    expect(checkCoherence(t).flags).toContain("unterminated");
  });

  it("flags trailing comma", () => {
    expect(checkCoherence("great progress today, more tomorrow,").flags).toContain("trailing_comma");
  });

  it("flags garbage characters", () => {
    expect(checkCoherence("great launch \uFFFD more").flags).toContain("garbage_chars");
  });

  it("flags too-short drafts", () => {
    expect(checkCoherence("ok").flags).toContain("too_short");
  });

  it("accepts short fragments as style (not errors)", () => {
    // under 40 chars with no terminal punct is a stylistic fragment — allowed
    expect(checkCoherence("not bad at all").coherent).toBe(true);
  });
});

describe("scoreStyleDeviation — distribution-aware style scoring", () => {
  it("gives 100 to an in-profile draft", () => {
    const d = "ai is moving faster than anyone predicted. rockets too. exciting times ahead for engineering";
    const r = scoreStyleDeviation(d, profile);
    expect(r.score).toBe(100);
    expect(r.deviations).toHaveLength(0);
  });

  it("penalizes extreme length deviation", () => {
    const r = scoreStyleDeviation("word ".repeat(80), profile); // 400 chars vs 30-160 range
    expect(r.score).toBeLessThan(100);
    expect(r.deviations.some((x) => x.check.startsWith("length"))).toBe(true);
  });

  it("penalizes caps shouting for a non-title-casing profile", () => {
    const r = scoreStyleDeviation("THIS IS UNACCEPTABLE from the engineering team right now", profile);
    expect(r.deviations.some((x) => x.check === "caps_shouting")).toBe(true);
  });

  it("penalizes topic drift", () => {
    const r = scoreStyleDeviation("the bakery on fifth street has wonderful sourdough bread", profile);
    expect(r.deviations.some((x) => x.check === "topic_drift")).toBe(true);
    expect(r.score).toBeLessThan(100);
  });

  it("penalizes profanity for a clean profile", () => {
    const r = scoreStyleDeviation("this rocket shit is absolutely amazing engineering honestly", profile);
    expect(r.deviations.some((x) => x.check === "profanity_deviation")).toBe(true);
  });

  it("penalizes hashtag spam", () => {
    const r = scoreStyleDeviation("ai #tech #future #rocket #space is changing everything fast now", profile);
    expect(r.deviations.some((x) => x.check === "hashtag_spam")).toBe(true);
  });

  it("penalizes question style when profile rarely asks", () => {
    const r = scoreStyleDeviation(
      "ai is rocket fuel for the rocket economy, will you be there for the ai rocket ride?",
      profile
    );
    expect(r.deviations.some((x) => x.check === "question_style")).toBe(true);
  });
});

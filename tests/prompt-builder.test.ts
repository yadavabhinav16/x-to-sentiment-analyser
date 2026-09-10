import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  buildDraftRequestPrompt,
  selectExemplars,
} from "@/modules/voice/prompt-builder";
import { styleProfileSchema } from "@/modules/analysis/style-profile";
import { analyzeCorpus } from "@/modules/analysis/analyzer";
import type { RawTweet } from "@/modules/ingestion/ports/tweet-source";

function tw(text: string, likes: number): RawTweet {
  return {
    id: Math.random().toString(),
    text,
    createdAt: new Date().toISOString(),
    likeCount: likes,
    retweetCount: 1,
    replyCount: 1,
    quoteCount: 0,
    impressionCount: 10000,
  };
}

const corpus = [
  tw("the future is now", 1000),
  tw("shipping fast beats shipping perfect", 800),
  tw("AI changes everything", 600),
  tw("cost curves only go down", 400),
  tw("build the thing", 200),
  tw("space is the final frontier", 150),
  tw("test flight tomorrow", 100),
  tw("engineering beauty", 90),
  tw("launch window opens", 50),
  tw("hello world again", 10),
  tw("the future again", 5),
  tw("more future talk", 2),
];

async function makeProfile() {
  const p = await analyzeCorpus("prompttest", null, corpus);
  return styleProfileSchema.parse(p);
}

describe("prompt-builder", () => {
  it("selects 8-12 exemplars sorted by engagement", async () => {
    const profile = await makeProfile();
    const ex = selectExemplars(corpus, profile);
    expect(ex.length).toBeGreaterThanOrEqual(8);
    expect(ex.length).toBeLessThanOrEqual(12);
    expect(ex[0].likeCount).toBeGreaterThanOrEqual(ex[ex.length - 1].likeCount);
    expect(ex[0].text).toBe("the future is now");
  });

  it("builds system prompt with hard syntax numbers", async () => {
    const profile = await makeProfile();
    const prompt = buildSystemPrompt(profile, selectExemplars(corpus, profile));
    expect(prompt).toContain("@prompttest");
    expect(prompt).toContain(`average ${profile.syntax.avgLengthChars} characters`);
    expect(prompt).toContain("VOICE SUMMARY");
    expect(prompt).toContain("EXEMPLAR POSTS");
  });

  it("adds generic-safe instruction for thin corpora", async () => {
    const thin = corpus.slice(0, 5);
    const profile = styleProfileSchema.parse(await analyzeCorpus("thinacct", null, thin));
    const prompt = buildSystemPrompt(profile, selectExemplars(thin, profile));
    expect(prompt).toContain("corpus is small");
  });

  it("prohibits emoji when emoji rate is ~0", async () => {
    const noEmoji = corpus.map((t) => ({ ...t, text: t.text.replace(/[\u{1F300}-\u{1FAFF}]/gu, "x") }));
    const profile = styleProfileSchema.parse(await analyzeCorpus("noemoji", null, noEmoji));
    const prompt = buildSystemPrompt(profile, []);
    expect(prompt).toContain("PROHIBITED: do not use emojis");
  });

  it("draft request asks for exact count as JSON", async () => {
    const profile = await makeProfile();
    const p = buildDraftRequestPrompt(profile, 5);
    expect(p).toContain('{"drafts":');
    expect(p).toContain("exactly 5");
  });

  it("includes topic nudge when given", async () => {
    const profile = await makeProfile();
    const p = buildDraftRequestPrompt(profile, 3, "space travel");
    expect(p).toContain("Write about: space travel");
  });
});

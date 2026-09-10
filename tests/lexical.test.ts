import { describe, it, expect } from "vitest";
import { analyzeLexical } from "@/modules/analysis/factors/lexical";
import { parsePastedTweets, pastedTweetsToRaw } from "@/modules/ingestion/paste-parser";
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

describe("analyzeLexical", () => {
  it("finds repeated bigrams as signature phrases", () => {
    const tweets = Array.from({ length: 10 }, (_, i) =>
      tw(`the future is now, day ${i}. the future looks bright`)
    );
    const l = analyzeLexical(tweets);
    expect(l.signaturePhrases.length).toBeGreaterThan(0);
    expect(l.signaturePhrases).toContain("the future");
  });

  it("computes vocab richness between 0 and 1", () => {
    const l = analyzeLexical([tw("cat cat cat"), tw("cat dog"), tw("bird fish mouse")]);
    expect(l.vocabRichness).toBeGreaterThan(0);
    expect(l.vocabRichness).toBeLessThanOrEqual(1);
  });

  it("detects slang level", () => {
    const slangy = analyzeLexical([tw("lol that is based ngl"), tw("lmao fr lol"), tw("ngl bruh lol"), tw("lol smh tbh"), tw("lol yikes rn")]);
    const formal = analyzeLexical([tw("Furthermore, the analysis concludes"), tw("Accordingly, we proceed"), tw("The results indicate success"), tw("Per the data, output improved"), tw("In summary, results are strong")]);
    expect(slangy.slangLevel).toBeGreaterThan(formal.slangLevel);
  });

  it("reports clean profanity policy when absent", () => {
    const l = analyzeLexical([tw("hello world"), tw("good morning")]);
    expect(l.profanityPolicy).toBe("clean");
  });
});

describe("parsePastedTweets", () => {
  it("parses newline-separated tweets", () => {
    const parsed = parsePastedTweets("first tweet\nsecond tweet\nthird tweet");
    expect(parsed).toHaveLength(3);
    expect(parsed[2].text).toBe("third tweet");
  });

  it("strips numbering and bullets", () => {
    const parsed = parsePastedTweets("1. numbered one\n- bulleted two\n• dotted three");
    expect(parsed.map((p) => p.text)).toEqual(["numbered one", "bulleted two", "dotted three"]);
  });

  it("skips link-only lines and blanks", () => {
    const parsed = parsePastedTweets("real tweet\nhttps://t.co/abc\n\n  \nanother");
    expect(parsed).toHaveLength(2);
  });

  it("round-trips to RawTweet", () => {
    const raw = pastedTweetsToRaw(parsePastedTweets("hello world"));
    expect(raw[0].text).toBe("hello world");
    expect(raw[0].likeCount).toBe(0);
  });
});

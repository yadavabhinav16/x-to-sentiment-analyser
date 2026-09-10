import { describe, it, expect } from "vitest";
import { extractJson, OpenRouterClient } from "@/modules/llm/openrouter";
import { parsePastedTweets } from "@/modules/ingestion/paste-parser";

describe("extractJson robustness", () => {
  it("parses plain JSON", () => {
    expect(extractJson('{"drafts":["a"]}')).toEqual({ drafts: ["a"] });
  });
  it("strips markdown fences", () => {
    expect(extractJson('```json\n{"drafts":["a"]}\n```')).toEqual({ drafts: ["a"] });
  });
  it("finds first balanced object in prose", () => {
    expect(extractJson('Sure! Here: {"a":{"b":1}} hope that helps')).toEqual({ a: { b: 1 } });
  });
  it("handles braces inside strings", () => {
    expect(extractJson('{"t":"curly } brace"}')).toEqual({ t: "curly } brace" });
  });
  it("throws when no JSON present", () => {
    expect(() => extractJson("no json here")).toThrow();
  });
});

describe("OpenRouterClient config", () => {
  it("constructs with model override", () => {
    const c = new OpenRouterClient("test-key", "some/model");
    expect(c).toBeTruthy();
  });
});

import {
  buildUserUrl,
  buildTweetsUrl,
  parseUserResponse,
  parseTweetsResponse,
} from "@/modules/ingestion/x-api-tweet-source";

describe("URL construction (unit-level X API, no live calls)", () => {
  it("builds user URL", () => {
    expect(buildUserUrl("elonmusk")).toBe(
      "https://api.x.com/2/users/by/username/elonmusk?user.fields=public_metrics"
    );
    expect(buildUserUrl("@elonmusk")).toBe(buildUserUrl("elonmusk"));
    expect(buildTweetsUrl("44196397", 100)).toBe(
      "https://api.x.com/2/users/44196397/tweets?max_results=100&exclude=retweets%2Creplies&tweet.fields=public_metrics%2Ccreated_at"
    );
    expect(buildTweetsUrl("44196397", 200, "tok123")).toContain("pagination_token=tok123");
  });
});

describe("parse fixtures (unit-level, from saved payloads)", () => {
  const fs = require("fs");
  const path = require("path");
  const dir = path.resolve(process.cwd(), "..", "test-fixtures");

  it("parses the real user fixture", () => {
    const body = JSON.parse(fs.readFileSync(path.join(dir, "elonmusk-user.json"), "utf8"));
    const user = parseUserResponse(body);
    expect(user.username).toBe("elonmusk");
    expect(user.id).toBe("44196397");
  });

  it("parses the real tweets fixture with metrics", () => {
    const body = JSON.parse(fs.readFileSync(path.join(dir, "elonmusk-tweets.json"), "utf8"));
    const tweets = parseTweetsResponse(body);
    expect(tweets.length).toBe(100);
    expect(tweets[0].likeCount).toBeGreaterThan(0);
    expect(typeof tweets[0].text).toBe("string");
  });
});

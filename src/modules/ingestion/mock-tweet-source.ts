import { readFileSync, existsSync } from "fs";
import path from "path";
import type { RawTweet, RawUser, TweetSource } from "./ports/tweet-source";

import {
  parseTweetsResponse,
  parseUserResponse,
} from "./x-api-tweet-source";

/**
 * Fixture-backed TweetSource. Reads the saved real X API response payloads from
 * test-fixtures/ so the full pipeline runs with ZERO live X API calls.
 * Any handle maps to the fixture data (fixture user's handle is reported as-is).
 */
export class MockTweetSource implements TweetSource {
  private user: RawUser;
  private tweets: RawTweet[];

  constructor(fixturesDir?: string) {
    // Resolution order: explicit arg > TEST_FIXTURES_DIR env > bundled
    // fixtures shipped with the repo (cwd-relative, cwd-proof fallbacks for
    // serverless where cwd can be anything).
    const dir =
      fixturesDir ??
      process.env.TEST_FIXTURES_DIR ??
      [
        path.join(process.cwd(), "test-fixtures"), // vendored: app root (Vercel)
        path.join(process.cwd(), "..", "test-fixtures"), // monorepo layout (local dev)
      ].find((p) => existsSync(path.join(p, "elonmusk-user.json"))) ??
      path.join(process.cwd(), "test-fixtures");
    const userBody = JSON.parse(
      readFileSync(path.join(dir, "elonmusk-user.json"), "utf8")
    );
    const tweetsBody = JSON.parse(
      readFileSync(path.join(dir, "elonmusk-tweets.json"), "utf8")
    );
    this.user = {
      id: userBody.data.id,
      username: userBody.data.username,
      name: userBody.data.name,
    };
    this.tweets = parseTweetsResponse(tweetsBody);
  }

  async fetchUser(_handle: string): Promise<RawUser> {
    return { ...this.user, username: _handle.replace(/^@/, "") || this.user.username };
  }

  async fetchRecentTweets(_handle: string, limit: number): Promise<RawTweet[]> {
    return this.tweets.slice(0, limit);
  }
}

export function getTweetSource(): TweetSource {
  const useMock = process.env.USE_MOCK_X === "true" || !process.env.BEARER_TOKEN;
  if (useMock) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { MockTweetSource: M } = require("./mock-tweet-source");
    return new M();
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { XApiTweetSource: X } = require("./x-api-tweet-source");
  return new X(process.env.BEARER_TOKEN!);
}

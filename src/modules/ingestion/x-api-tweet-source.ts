import type { RawTweet, RawUser, TweetSource } from "./ports/tweet-source";

interface XUserResponse {
  data: {
    id: string;
    username: string;
    name: string;
    public_metrics?: Record<string, number>;
  };
}

interface XTweetsResponse {
  data?: Array<{
    id: string;
    text: string;
    created_at: string;
    public_metrics?: {
      like_count?: number;
      retweet_count?: number;
      reply_count?: number;
      quote_count?: number;
      impression_count?: number;
    };
  }>;
  meta?: { next_token?: string; result_count?: number };
}

export function parseUserResponse(body: XUserResponse): RawUser {
  const d = body.data;
  if (!d || !d.id) throw new Error("X API user response missing data.id");
  return { id: d.id, username: d.username, name: d.name };
}

export function parseTweetsResponse(body: XTweetsResponse): RawTweet[] {
  if (!body.data) return [];
  return body.data.map((t) => ({
    id: t.id,
    text: t.text,
    createdAt: t.created_at,
    likeCount: t.public_metrics?.like_count ?? 0,
    retweetCount: t.public_metrics?.retweet_count ?? 0,
    replyCount: t.public_metrics?.reply_count ?? 0,
    quoteCount: t.public_metrics?.quote_count ?? 0,
    impressionCount: t.public_metrics?.impression_count ?? null,
  }));
}

export function buildUserUrl(handle: string): string {
  return `https://api.x.com/2/users/by/username/${encodeURIComponent(
    handle.replace(/^@/, "")
  )}?user.fields=public_metrics`;
}

export function buildTweetsUrl(
  userId: string,
  maxResults: number,
  nextToken?: string
): string {
  const params = new URLSearchParams({
    max_results: String(Math.min(100, Math.max(5, maxResults))),
    exclude: "retweets,replies",
    "tweet.fields": "public_metrics,created_at",
  });
  if (nextToken) params.set("pagination_token", nextToken);
  return `https://api.x.com/2/users/${userId}/tweets?${params.toString()}`;
}

/** Real X API v2 adapter. Never called when USE_MOCK_X=true. */
const X_TIMEOUT_MS = 30_000;
const X_MAX_ATTEMPTS = 3;

export class XApiTweetSource implements TweetSource {
  constructor(private bearerToken: string) {}

  private async xFetch(url: string): Promise<Response> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= X_MAX_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), X_TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${this.bearerToken}` },
          signal: controller.signal,
        });
        // Retry on transient server errors and rate limits; never on 4xx auth/404.
        if ((res.status === 429 || res.status >= 500) && attempt < X_MAX_ATTEMPTS) {
          const retryAfter = Number(res.headers.get("retry-after")) || 0;
          await new Promise((r) => setTimeout(r, Math.max(retryAfter * 1000, 500 * attempt)));
          continue;
        }
        return res;
      } catch (err) {
        lastErr = err;
        if (attempt === X_MAX_ATTEMPTS) break;
        await new Promise((r) => setTimeout(r, 500 * attempt));
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error(`X API request failed after ${X_MAX_ATTEMPTS} attempts: ${String(lastErr)}`);
  }

  async fetchUser(handle: string): Promise<RawUser> {
    const res = await this.xFetch(buildUserUrl(handle));
    if (res.status === 404) throw new Error(`User @${handle} not found on X`);
    if (res.status === 401 || res.status === 403)
      throw new Error("X API authentication failed — check BEARER_TOKEN");
    if (res.status === 429)
      throw new Error("X API rate limit exceeded");
    if (!res.ok) throw new Error(`X API user fetch failed: HTTP ${res.status}`);
    return parseUserResponse((await res.json()) as XUserResponse);
  }

  async fetchRecentTweets(handle: string, limit: number): Promise<RawTweet[]> {
    const user = await this.fetchUser(handle);
    const out: RawTweet[] = [];
    let nextToken: string | undefined;
    do {
      const batchSize = Math.min(100, limit - out.length);
      const res = await this.xFetch(buildTweetsUrl(user.id, batchSize, nextToken));
      if (!res.ok)
        throw new Error(`X API tweets fetch failed: HTTP ${res.status}`);
      const body = (await res.json()) as XTweetsResponse;
      out.push(...parseTweetsResponse(body));
      nextToken = body.meta?.next_token;
    } while (nextToken && out.length < limit);
    return out.slice(0, limit);
  }
}

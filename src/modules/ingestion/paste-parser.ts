import type { RawTweet } from "./ports/tweet-source";

export interface ParsedPasteTweet {
  text: string;
}

/**
 * Parse pasted tweets. Accepts one-per-line, blank-line separated blocks,
 * or "1. text" / "- text" numbering. Skips empty lines and URLs-only lines.
 */
export function parsePastedTweets(raw: string): ParsedPasteTweet[] {
  const blocks = raw
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  const source = blocks.length > 1 ? blocks : raw.split("\n");
  const out: ParsedPasteTweet[] = [];
  for (const line of source) {
    const cleaned = line
      .replace(/^\s*(?:\d+[.)]|[-•*])\s+/, "") // numbering/bullets
      .trim();
    if (!cleaned) continue;
    if (/^https?:\/\/\S+$/.test(cleaned)) continue; // link-only line
    out.push({ text: cleaned });
  }
  return out;
}

export function pastedTweetsToRaw(parsed: ParsedPasteTweet[]): RawTweet[] {
  return parsed.map((p, i) => ({
    id: `paste-${i}-${Date.now()}`,
    text: p.text,
    createdAt: new Date().toISOString(),
    likeCount: 0,
    retweetCount: 0,
    replyCount: 0,
    quoteCount: 0,
    impressionCount: null,
  }));
}

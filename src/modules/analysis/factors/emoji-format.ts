import type { RawTweet } from "../../ingestion/ports/tweet-source";
import type { EmojiFormatStats } from "../style-profile";

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F900}-\u{1F9FF}]/u;

export function analyzeEmojiFormat(tweets: RawTweet[]): EmojiFormatStats {
  const n = tweets.length || 1;
  const withEmoji = tweets.filter((t) => EMOJI_RE.test(t.text));
  const emojiRate = round(withEmoji.length / n);

  const counts = new Map<string, number>();
  for (const t of withEmoji) {
    const matches = t.text.match(new RegExp(EMOJI_RE, "gu")) ?? [];
    for (const m of matches) counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  const typicalEmojis = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([e]) => e);

  const withLinks = tweets.filter((t) => /https?:\/\/|t\.co\//.test(t.text)).length / n;
  const linkPolicy =
    withLinks > 0.4 ? "frequently shares links" : withLinks > 0.05 ? "occasionally shares links" : "rarely shares links";

  const multiLine = tweets.filter((t) => t.text.includes("\n")).length / n;
  const lineBreakStyle = multiLine > 0.3 ? "uses line breaks / lists" : "single-line posts";
  const usesThreads = multiLine > 0.3 || tweets.some((t) => /\n\n/.test(t.text));

  return {
    emojiRate,
    typicalEmojis,
    usesThreads,
    linkPolicy,
    lineBreakStyle,
  };
}

function round(x: number): number {
  return Math.round(x * 100) / 100;
}

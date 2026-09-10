import type { RawTweet } from "../../ingestion/ports/tweet-source";
import type { SyntaxStats } from "../style-profile";

export function analyzeSyntax(tweets: RawTweet[]): SyntaxStats {
  const n = tweets.length || 1;
  const lengths = tweets.map((t) => t.text.length);
  const avg = lengths.reduce((a, b) => a + b, 0) / n;
  const min = lengths.length ? Math.min(...lengths) : 0;
  const max = lengths.length ? Math.max(...lengths) : 0;

  const exclaim = tweets.filter((t) => /!/.test(t.text)).length / n;
  const question = tweets.filter((t) => /\?/.test(t.text)).length / n;
  const ellipsis = tweets.filter((t) => /\.\.\.|…/.test(t.text)).length / n;

  const commaTweets = tweets.filter((t) => t.text.includes(",")).length;
  const commaStyle =
    commaTweets / n > 0.4
      ? "uses commas frequently"
      : commaTweets / n > 0.1
        ? "occasional commas"
        : "rarely uses commas";

  // Casing: fraction of chars that are lowercase across alphabetic chars
  let lower = 0;
  let upper = 0;
  for (const t of tweets) {
    for (const ch of t.text) {
      if (ch >= "a" && ch <= "z") lower++;
      else if (ch >= "A" && ch <= "Z") upper++;
    }
  }
  const lowerRatio = lower + upper > 0 ? lower / (lower + upper) : 1;
  const upperRatio = 1 - lowerRatio;
  let casing: SyntaxStats["casing"] = "standard";
  if (upperRatio > 0.6) casing = "title";
  else if (upperRatio > 0.2) casing = "mixed";
  else if (lowerRatio > 0.97 && exclaim + question < 0.5) casing = "standard";
  if (lowerRatio > 0.995 && /^[a-z0-9\s]/.test(tweets[0]?.text ?? "a") && !/[A-Z]/.test(tweets[0]?.text ?? "")) casing = "lowercase";

  return {
    avgLengthChars: round(avg),
    lengthRange: [min, max],
    casing,
    punctuation: {
      exclamationRate: round(exclaim),
      questionRate: round(question),
      ellipsisUse: round(ellipsis),
      commaStyle,
    },
  };
}

function round(x: number): number {
  return Math.round(x * 100) / 100;
}

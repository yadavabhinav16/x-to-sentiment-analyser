import type { RawTweet } from "../../ingestion/ports/tweet-source";
import type { LexicalStats } from "../style-profile";

const PROFANITY = ["fuck", "shit", "damn", "hell", "ass", "bitch", "crap"];
const SLANG = ["lol", "lmao", "ngl", "fr", "tbh", "imo", "bruh", "yikes", "based", "sus", "vibe", "lowkey", "highkey", "rn", "smh"];

export function analyzeLexical(tweets: RawTweet[]): LexicalStats {
  const texts = tweets.map((t) => t.text.toLowerCase());
  const allWords = texts.flatMap((t) => t.split(/\s+/).map((w) => w.replace(/[^a-z0-9'’]/g, "")).filter((w) => w.length > 1));
  const total = allWords.length || 1;
  const unique = new Set(allWords);
  const vocabRichness = round(unique.size / total);

  // n-gram frequency (bigrams) for signature phrases
  const bigrams = new Map<string, number>();
  for (const t of texts) {
    const words = t.split(/\s+/).map((w) => w.replace(/[^a-z0-9'’]/g, "")).filter(Boolean);
    for (let i = 0; i < words.length - 1; i++) {
      const bg = `${words[i]} ${words[i + 1]}`;
      bigrams.set(bg, (bigrams.get(bg) ?? 0) + 1);
    }
  }
  const sigPhrases = [...bigrams.entries()]
    .filter(([, c]) => c >= Math.max(2, texts.length * 0.02))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([bg]) => bg);

  const slangHits = texts.reduce(
    (acc, t) => acc + SLANG.filter((s) => new RegExp(`\\b${s}\\b`).test(t)).length,
    0
  );
  const slangLevel = round(Math.min(1, slangHits / (texts.length || 1)));

  const profanityHits = texts.reduce(
    (acc, t) => acc + PROFANITY.filter((p) => new RegExp(`\\b${p}\\b`).test(t)).length,
    0
  );
  const profanityPolicy =
    profanityHits === 0
      ? "clean"
      : profanityHits / texts.length < 0.05
        ? "rare"
        : "occasional";

  return {
    signaturePhrases: sigPhrases,
    vocabRichness: round(vocabRichness),
    slangLevel: round(Math.min(1, slangHits / (texts.length || 1))),
    profanityPolicy,
  };
}

function round(x: number): number {
  return Math.round(x * 100) / 100;
}

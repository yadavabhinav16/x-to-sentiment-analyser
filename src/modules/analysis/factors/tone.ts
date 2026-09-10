import type { RawTweet } from "../../ingestion/ports/tweet-source";
import type { ToneStats } from "../style-profile";

/**
 * Deterministic baseline tone estimation (PASS 1 fallback).
 * Used when no LLM is available; the LLM pass refines these numbers.
 */
export function analyzeToneBaseline(tweets: RawTweet[]): ToneStats {
  const n = tweets.length || 1;
  const texts = tweets.map((t) => t.text);

  const formalMarkers = ["therefore", "however", "furthermore", "regarding", "pursuant", "accordingly", "moreover"];
  const casualMarkers = ["lol", "lmao", "haha", "!", "??", "ngl", "tbh"];
  const formalCount = texts.filter((t) => formalMarkers.some((m) => t.toLowerCase().includes(m))).length;
  const casualHits = texts.reduce((a, t) => a + casualMarkers.filter((m) => t.toLowerCase().includes(m)).length, 0);
  const formality = clamp(0.5 + (formalCount - casualHits / n) * 0.2);

  const positive = ["great", "amazing", "love", "awesome", "beautiful", "incredible", "exciting", "❤", "🔥"];
  const negative = ["bad", "terrible", "awful", "wrong", "fail", "broke", "sad", "angry", "hate"];
  let pos = 0;
  let neg = 0;
  for (const t of texts) {
    pos += positive.filter((p) => t.toLowerCase().includes(p)).length;
    neg += negative.filter((p) => t.toLowerCase().includes(p)).length;
  }
  const sentiment =
    pos > neg * 1.5 ? "positive" : neg > pos * 1.5 ? "negative" : "neutral/mixed";

  const declarative = texts.filter((t) => /^[A-Z]/.test(t) && !t.includes("?") && !t.includes("maybe") && !t.includes("perhaps")).length / n;
  const assertiveness = clamp(0.4 + (declarative - 0.5) * 0.8);

  const humorMarkers = ["lol", "lmao", "haha", "😂", "🤣", "joke", "funny"];
  const humorCount = texts.filter((t) => humorMarkers.some((m) => t.toLowerCase().includes(m))).length / n;
  const humorStyle =
    humorCount > 0.2 ? "frequently jokes around" : humorCount > 0.05 ? "occasionally humorous" : "mostly serious";

  return {
    formality: round(formality),
    sentiment,
    assertiveness: round(assertiveness),
    humorStyle,
  };
}

function formalHits(texts: string[], markers: string[]): number {
  return texts.reduce((a, t) => a + markers.filter((m) => t.toLowerCase().includes(m)).length, 0) / (texts.length || 1);
}

function clamp(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function round(x: number): number {
  return Math.round(x * 100) / 100;
}

import type { RawTweet } from "../../ingestion/ports/tweet-source";
import type { LexicalStats } from "../style-profile";

const PROFANITY = ["fuck", "shit", "damn", "hell", "ass", "bitch", "crap"];
const SLANG = ["lol", "lmao", "ngl", "fr", "tbh", "imo", "bruh", "yikes", "based", "sus", "vibe", "lowkey", "highkey", "rn", "smh"];

/**
 * Stopword bigrams: both words are function words → the phrase is grammar,
 * not voice. A signature phrase must carry content on at least one side,
 * and both-word-stoplist phrases ("is a", "this is", "if you", "want to",
 * "the global") are excluded entirely — they rank high on raw frequency
 * but carry zero identity signal.
 */
const FUNCTION_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "am", "do", "does", "did", "have", "has", "had", "will", "would", "can",
  "could", "should", "shall", "may", "might", "must", "this", "that",
  "these", "those", "it", "its", "he", "she", "they", "them", "we", "us",
  "our", "you", "your", "i", "me", "my", "of", "in", "on", "at", "to",
  "for", "with", "from", "by", "as", "if", "but", "and", "or", "so",
  "not", "no", "yes", "just", "like", "get", "got", "want", "going",
  "what", "when", "where", "who", "how", "why", "which", "there", "here",
  "than", "then", "now", "also", "very", "much", "more", "most", "some",
  "all", "about", "out", "up", "down", "over", "into", "one", "two",
]);

/** A bigram is a candidate signature phrase only if it carries content. */
function isContentBigram(bg: string): boolean {
  const [a, b] = bg.split(" ");
  // at least one word must be a content word (not a function word)
  if (FUNCTION_WORDS.has(a) || FUNCTION_WORDS.has(b)) return false;
  // single-char or numeric remnants are noise
  if (a.length < 3 || b.length < 3) return false;
  return true;
}

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
    .map(([bg]) => bg)
    .filter(isContentBigram)
    .sort((a, b) => bigrams.get(b)! - bigrams.get(a)!)
    .slice(0, 8)
    // dedupe near-duplicates already covered (e.g. "grok bot" twice)
    .filter((bg, i, arr) => arr.indexOf(bg) === i);

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

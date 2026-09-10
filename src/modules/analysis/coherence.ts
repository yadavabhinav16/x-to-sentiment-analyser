import type { StyleProfile } from "./style-profile";

/**
 * Structural coherence checks (deterministic, free — PASS-1 philosophy):
 * catch objectively broken model output — truncation, doubled words,
 * garbage tokens — without ever flagging authentic voice quirks
 * (lowercase starts, run-ons, slang are style, not errors).
 */
export interface CoherenceResult {
  coherent: boolean;
  flags: string[];
}

export function checkCoherence(draft: string): CoherenceResult {
  const flags: string[] = [];
  const text = draft.trim();

  // Non-empty sanity
  if (text.length < 3) {
    return { coherent: false, flags: ["too_short"] };
  }

  // Doubled consecutive words ("the the", "is is") — classic degradation.
  if (/\b(\w+)\s+\1\b/i.test(text)) flags.push("repeated_word");

  // Garbage tokens: replacement chars, control chars.
  if (/\uFFFD|[\u0000-\u0008\u000E-\u001F]/.test(text)) flags.push("garbage_chars");

  // Symbol-heavy text (less than half letters) — likely model degradation.
  const letters = (text.match(/[a-zA-Z]/g) ?? []).length;
  if (text.length > 10 && letters / text.length < 0.5) flags.push("symbol_heavy");

  // Trailing comma at end of text — truncation artifact.
  if (/,\s*$/.test(text)) flags.push("trailing_comma");

  // Dangling final word: text ends on a conjunction/preposition/article —
  // almost always mid-generation truncation.
  const last = text.split(/\s+/).slice(-1)[0]?.toLowerCase() ?? "";
  if (["and", "or", "but", "the", "a", "an", "to", "of", "in", "with", "for", "on", "is", "it"].includes(last)) {
    flags.push("dangling_word");
  }

  // Unterminated long draft: no terminal punctuation anywhere on a 40+ char
  // draft suggests it was cut off mid-sentence. (Short fragments are style.)
  if (text.length > 40 && !/[.!?…]/.test(text)) flags.push("unterminated");

  return { coherent: flags.length === 0, flags };
}

/**
 * Tightened style-deviation scoring: compare the draft's measurable properties
 * against the StyleProfile's actual distributions (not just hard policy flags).
 * Deterministic and free — extends the evaluateDraft gate with graduated,
 * distribution-aware checks. 0-100, 100 = perfectly in profile.
 */
export interface StyleDeviation {
  score: number;
  deviations: Array<{ check: string; detail: string }>;
}

export function scoreStyleDeviation(draft: string, profile: StyleProfile): StyleDeviation {
  const deviations: Array<{ check: string; detail: string }> = [];
  let score = 100;
  const penalize = (check: string, detail: string, amount: number) => {
    deviations.push({ check, detail });
    score -= amount;
  };

  const text = draft.trim();
  const lower = text.toLowerCase();
  const words = lower.match(/\b\w+\b/g) ?? [];

  // 1. Length deviation — graduated against the profile's actual distribution.
  const avg = profile.syntax.avgLengthChars;
  const [lo, hi] = profile.syntax.lengthRange;
  const len = text.length;
  if (len < lo * 0.5) {
    penalize("length", `${len} chars vs typical ${Math.round(lo)}-${Math.round(hi)}`, 20);
  } else if (len > hi * 2) {
    penalize("length", `${len} chars vs typical max ${Math.round(hi)}`, 20);
  } else if (Math.abs(len - avg) > hi - lo) {
    penalize("length_outlier", `far from avg ${Math.round(avg)}`, 8);
  }

  // 2. Question style: '?' from someone who never asks questions.
  if (text.endsWith("?") && profile.syntax.punctuation.questionRate < 0.05) {
    penalize("question_style", "ends in '?' but profile rarely asks questions", 10);
  }

  // 3. All-caps shouting vs the profile's casing habits. Check the ORIGINAL
  //    casing (not lowercased words): >=2 shouty tokens = deviation.
  const capsWords = (text.match(/\b[A-Z]{3,}\b/g) ?? []).length;
  if (capsWords >= 2 && profile.syntax.casing !== "title") {
    penalize("caps_shouting", `${capsWords} all-caps words vs ${profile.syntax.casing} casing`, 15);
  }

  // 4. Topic drift: no overlap with any topic-cluster keyword.
  const keywords = profile.topics.clusters
    .flatMap((c) => c.keywords.map((k) => k.toLowerCase()))
    .filter(Boolean);
  if (keywords.length > 0 && !keywords.some((k) => lower.includes(k))) {
    penalize("topic_drift", "no overlap with any topic cluster keywords", 15);
  }

  // 5. Profanity where the profile shows none.
  if (/\b(fuck|shit|bitch|damn|crap)\b/i.test(text) && profile.lexical.profanityPolicy === "none") {
    penalize("profanity_deviation", "profanity where profile shows none", 25);
  }

  // 6. Hashtag policy: heavy hashtags from a no-hashtag account.
  const hashtags = (text.match(/#\w+/g) ?? []).length;
  if (hashtags >= 2) {
    penalize("hashtag_spam", `${hashtags} hashtags vs profile usage`, 10);
  }

  return { score: Math.max(0, Math.min(100, score)), deviations };
}
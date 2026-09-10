import type { RawTweet } from "../ingestion/ports/tweet-source";
import type { StyleProfile } from "../analysis/style-profile";

/**
 * Deterministic draft quality gate (§5.5): score a draft 0-100 against the StyleProfile.
 */
export function evaluateDraft(
  draft: string,
  profile: StyleProfile
): { score: number; checks: Record<string, boolean> } {
  const checks: Record<string, boolean> = {};
  let score = 100;

  // Length in range (with generous slack: 1.5x)
  const [lo, hi] = profile.syntax.lengthRange;
  const len = draft.length;
  checks.lengthInRange = len >= Math.max(0, lo - 20) && len <= hi * 1.5 + 40;
  if (!checks.lengthInRange) score -= 25;

  // Casing: lowercase profile should not produce Title Caps starts consistently
  if (profile.syntax.casing === "lowercase" && /^[A-Z]/.test(draft.trim())) {
    checks.casingOk = false;
    score -= 15;
  } else checks.casingOk = true;

  // Emoji policy
  const hasEmoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(draft);
  if (profile.emojiFormat.emojiRate < 0.05 && hasEmoji) {
    checks.emojiPolicyOk = false;
    score -= 20;
  } else checks.emojiPolicyOk = true;

  // Exclamation rate policy
  const exclams = (draft.match(/!/g) ?? []).length;
  if (profile.syntax.punctuation.exclamationRate < 0.1 && exclams >= 2) {
    checks.exclamationPolicyOk = false;
    score -= 15;
  } else checks.exclamationPolicyOk = true;

  // Signature phrase bonus
  const phraseHit = profile.lexical.signaturePhrases.some((p) =>
    draft.toLowerCase().includes(p)
  );
  checks.signaturePhrasePresent = phraseHit;
  if (!phraseHit) score -= 5;

  return { score: Math.max(0, Math.min(100, score)), checks };
}

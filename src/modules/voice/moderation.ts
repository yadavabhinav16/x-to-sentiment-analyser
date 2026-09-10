/**
 * Content moderation layer for generated drafts.
 *
 * Applies the platform's synthetic-content policy: every AI-generated draft is
 * labeled as synthetic, and flagged for harmful-content categories. Drafts that
 * trip a hard block category are rejected; soft categories are flagged with
 * labels that surface in the UI.
 */

export type ModerationFlag =
  | "synthetic_content"
  | "self_harm"
  | "violence"
  | "hate"
  | "sexual"
  | "medical_advice"
  | "illegal_activity";

export interface ModerationVerdict {
  allowed: boolean;
  flags: ModerationFlag[];
  /** Human-readable reason when blocked. */
  reason?: string;
}

/** Every AI-generated draft is synthetic — always labeled. */
const SYNTHETIC_LABEL: ModerationFlag = "synthetic_content";

interface CategoryRule {
  flag: ModerationFlag;
  /** hard → draft rejected; soft → flagged only. */
  severity: "hard" | "soft";
  patterns: RegExp[];
}

const RULES: CategoryRule[] = [
  {
    flag: "self_harm",
    severity: "hard",
    patterns: [/\bkill (my|your)self\b/i, /\bsuicide\b/i, /\bself[- ]harm\w*\b/i],
  },
  {
    flag: "violence",
    severity: "hard",
    patterns: [/\bhow to (make|build) (a )?bomb\b/i, /\bmass shooting\b/i],
  },
  {
    flag: "hate",
    severity: "hard",
    patterns: [/\b(sub)?human (scum|vermin)\b/i, /\bethnic cleansing\b/i],
  },
  {
    flag: "sexual",
    severity: "soft",
    patterns: [/\bexplicit sexual content\b/i],
  },
  {
    flag: "medical_advice",
    severity: "soft",
    patterns: [/\bstop taking your (medication|medicine)\b/i],
  },
  {
    flag: "illegal_activity",
    severity: "soft",
    patterns: [/\bhow to (launder money|make meth)\b/i],
  },
];

export function moderateDraft(text: string): ModerationVerdict {
  const flags: ModerationFlag[] = [SYNTHETIC_LABEL];
  const blocked: string[] = [];

  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(text))) {
      flags.push(rule.flag);
      if (rule.severity === "hard") blocked.push(rule.flag);
    }
  }

  if (blocked.length) {
    return {
      allowed: false,
      flags,
      reason: `Blocked by content policy (${blocked.join(", ")}).`,
    };
  }
  return { allowed: true, flags };
}

/** Moderation metadata persisted alongside a draft. */
export interface DraftModeration {
  flags: ModerationFlag[];
  /** Short user-facing tag, e.g. "AI-generated". */
  label: string;
  blocked: boolean;
  reason?: string;
}

export function moderationMetadata(text: string): DraftModeration {
  const v = moderateDraft(text);
  return {
    flags: v.flags,
    label: "AI-generated",
    blocked: !v.allowed,
    reason: v.reason,
  };
}

/** Filter helper for the generation pipeline: returns only allowed drafts. */
export function filterModerated(
  drafts: Array<{ text: string; styleMatch: number }>
): Array<{ text: string; styleMatch: number }> {
  return drafts.filter((d) => moderateDraft(d.text).allowed);
}
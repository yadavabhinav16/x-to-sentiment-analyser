import type { StyleProfile } from "../analysis/style-profile";
import type { RawTweet } from "../ingestion/ports/tweet-source";

export interface GeneratedDraft {
  text: string;
}

export function buildSystemPrompt(profile: StyleProfile, exemplars: RawTweet[]): string {
  const s = profile.syntax;
  const lines: string[] = [];

  lines.push(
    `You are a ghostwriter who writes new posts that sound exactly like @${profile.handle}.`
  );
  lines.push("");
  lines.push(`VOICE SUMMARY: ${profile.voice.oneParagraphSummary}`);
  lines.push("");
  lines.push(
    `SYNTAX CONSTRAINTS: posts average ${s.avgLengthChars} characters (range ${s.lengthRange[0]}-${s.lengthRange[1]}). Casing: ${s.casing}. Exclamation marks in ${Math.round(s.punctuation.exclamationRate * 100)}% of posts; questions in ${Math.round(s.punctuation.questionRate)}%. ${s.punctuation.commaStyle}.`
  );
  lines.push(
    `TONE: formality ${profile.tone.formality} (0 casual, 1 formal), sentiment ${profile.tone.sentiment}, assertiveness ${profile.tone.assertiveness}. Humor: ${profile.tone.humorStyle}.`
  );
  if (profile.lexical.signaturePhrases.length)
    lines.push(
      `SIGNATURE PHRASES (weave in naturally where it fits): ${profile.lexical.signaturePhrases.join(", ")}.`
    );
  if (profile.topics.clusters.length)
    lines.push(
      `TOPIC ANCHORS: ${profile.topics.clusters.map((c) => c.name).join(", ")}.`
    );
  if (profile.topics.obsessions.length)
    lines.push(`RECURRING OBSESSIONS: ${profile.topics.obsessions.join(", ")}.`);
  if (profile.emojiFormat.emojiRate < 0.05)
    lines.push("PROHIBITED: do not use emojis (this person almost never does).");
  if (profile.emojiFormat.emojiRate >= 0.05 && profile.emojiFormat.typicalEmojis.length)
    lines.push(
      `Emoji use is rare — at most one, prefer: ${profile.emojiFormat.typicalEmojis.join(" ")}.`
    );
  if (!profile.emojiFormat.usesThreads)
    lines.push("PROHIBITED: no multi-post threads or line-break lists — single-post format.");
  lines.push(
    `LINKS: ${profile.emojiFormat.linkPolicy === "rarely shares links" ? "do not include links." : "links allowed sparingly."}`
  );
  if (profile.sampleCount < 20)
    lines.push(
      "NOTE: corpus is small — stay generic-safe, avoid niche references you cannot support."
    );
  lines.push("");
  lines.push("EXEMPLAR POSTS (match this voice exactly):");
  for (const ex of exemplars) {
    lines.push(`- ${ex.text.replace(/\n/g, " ⏎ ")}`);
  }
  return lines.join("\n");
}

export function buildDraftRequestPrompt(
  profile: StyleProfile,
  count: number,
  topicNudge?: string
): string {
  const topicLine = topicNudge
    ? `Write about: ${topicNudge}.`
    : `Draw from their topic anchors: ${profile.topics.clusters.map((c) => c.name).join(", ") || "their general interests"}.`;
  return `${topicLine}
Write ${count} new posts in this exact voice. Vary length across the person's typical range. Return ONLY JSON: {"drafts": ["<post text>", ...]} with exactly ${count} strings. No numbering, no hashtags unless the exemplars use them, no commentary.`;
}

/** Select 8-12 high-engagement exemplar tweets spanning topic clusters. */
export function selectExemplars(tweets: RawTweet[], profile: StyleProfile): RawTweet[] {
  const scored = [...tweets].sort(
    (a, b) =>
      b.likeCount + b.retweetCount * 2 - (a.likeCount + a.retweetCount * 2)
  );
  const target = Math.min(12, Math.max(8, Math.min(scored.length, 12)));
  return scored.slice(0, target);
}

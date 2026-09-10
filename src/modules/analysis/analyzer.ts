import type { RawTweet } from "../ingestion/ports/tweet-source";
import { getLlmClient, extractJson } from "../llm/openrouter";
import { logger } from "../../lib/logger";
import type { StyleProfile } from "./style-profile";
import { styleProfileSchema } from "./style-profile";
import { analyzeSyntax } from "./factors/syntax";
import { analyzeLexical } from "./factors/lexical";
import { analyzeTopics } from "./factors/topic";
import { analyzeEngagement } from "./factors/engagement";
import { analyzeEmojiFormat } from "./factors/emoji-format";
import { analyzeToneBaseline } from "./factors/tone";
import type { ToneStats, TopicStats, VoiceStats } from "./style-profile";

const PASS2_PROMPT = `You are a writing-style analyst. Given a corpus of tweets, return ONLY a JSON object (no markdown) with this exact shape:
{
  "tone": { "formality": <0-1 number>, "sentiment": "<positive|negative|neutral/mixed>", "assertiveness": <0-1 number>, "humorStyle": "<short phrase>" },
  "topics": { "clusters": [ { "name": "<topic>", "share": <0-1>, "keywords": ["<kw>"] } ], "obsessions": ["<recurring theme>"], "avoidedTopics": ["<topic they never touch>"] },
  "voice": { "signaturePhrasesInContext": ["<phrase>"], "rhetoricalDevices": ["<device>"], "oneParagraphSummary": "<one paragraph describing how this person writes>" }
}
Be specific and concrete. Formality 0 = extremely casual, 1 = very formal.`;

export async function analyzeCorpus(
  handle: string,
  displayName: string | null,
  tweets: RawTweet[]
): Promise<StyleProfile> {
  const syntax = analyzeSyntax(tweets);
  const lexical = analyzeLexical(tweets);
  const topics = analyzeTopics(tweets);
  const engagement = analyzeEngagement(tweets);
  const emojiFormat = analyzeEmojiFormat(tweets);
  const toneBaseline = analyzeToneBaseline(tweets);

  let tone: ToneStats = toneBaseline;
  let topicsFinal: TopicStats = topics;
  let voice: VoiceStats = {
    signaturePhrasesInContext: lexical.signaturePhrases.slice(0, 5),
    rhetoricalDevices: [],
    oneParagraphSummary: buildFallbackSummary(handle, syntax, lexical, toneBaseline),
  };

  const client = getLlmClient();
  if (client && tweets.length >= 5) {
    try {
      const sample = tweets
        .slice(0, 100)
        .map((t) => `- ${t.text.replace(/\n/g, " ").slice(0, 280)}`)
        .join("\n");
      const result = await client.complete(
        [
          { role: "system", content: PASS2_PROMPT },
          { role: "user", content: `Tweets by @${handle}:\n\n${sample}` },
        ],
        { jsonMode: true, maxTokens: 1500 }
      );
      const parsed = extractJson(result.content) as Partial<{
        tone: ToneStats;
        topics: TopicStats;
        voice: VoiceStats;
      }>;
      if (parsed.tone) tone = { ...toneBaseline, ...parsed.tone };
      if (parsed.topics) topicsFinal = { ...topics, ...parsed.topics };
      if (parsed.voice) voice = { ...voice, ...parsed.voice };
      logger.info("PASS2 LLM analysis complete", { handle });
    } catch (err) {
      logger.warn("PASS2 LLM analysis failed, using deterministic baseline", {
        handle,
        error: String(err),
      });
    }
  } else if (!client) {
    logger.info("No OPENROUTER_API_KEY — analysis uses deterministic PASS 1 only", { handle });
  }

  return styleProfileSchema.parse({
    handle,
    displayName,
    sampleCount: tweets.length,
    syntax,
    lexical,
    emojiFormat,
    engagement,
    tone,
    topics: topicsFinal,
    voice,
  });
}

function buildFallbackSummary(
  handle: string,
  syntax: ReturnType<typeof analyzeSyntax>,
  lexical: ReturnType<typeof analyzeLexical>,
  tone: ToneStats
): string {
  return `@${handle} writes ${tone.sentiment} posts averaging ${syntax.avgLengthChars} chars (${syntax.punctuation.exclamationRate > 0.3 ? "frequent" : "rare"} exclamation marks). Tone is ${tone.formality > 0.6 ? "fairly formal" : "casual"} and ${tone.assertiveness > 0.6 ? "assertive" : "conversational"}, ${tone.humorStyle}. Vocabulary is ${lexical.vocabRichness > 0.4 ? "varied" : "repetitive"}; profanity policy: ${lexical.profanityPolicy}.`;
}

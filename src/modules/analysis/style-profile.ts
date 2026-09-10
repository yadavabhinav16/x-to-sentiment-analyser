import { z } from "zod";

export const syntaxSchema = z.object({
  avgLengthChars: z.number(),
  lengthRange: z.tuple([z.number(), z.number()]),
  casing: z.enum(["standard", "lowercase", "title", "mixed"]),
  punctuation: z.object({
    exclamationRate: z.number(),
    questionRate: z.number(),
    ellipsisUse: z.number(),
    commaStyle: z.string(),
  }),
});
export type SyntaxStats = z.infer<typeof syntaxSchema>;

export const lexicalSchema = z.object({
  signaturePhrases: z.array(z.string()),
  vocabRichness: z.number(),
  slangLevel: z.number(),
  profanityPolicy: z.string(),
});
export type LexicalStats = z.infer<typeof lexicalSchema>;

export const emojiFormatSchema = z.object({
  emojiRate: z.number(),
  typicalEmojis: z.array(z.string()),
  usesThreads: z.boolean(),
  linkPolicy: z.string(),
  lineBreakStyle: z.string(),
});
export type EmojiFormatStats = z.infer<typeof emojiFormatSchema>;

export const engagementSchema = z.object({
  topFormats: z.array(z.string()),
  avgEngagementRate: z.number(),
  lengthVsEngagement: z.string(),
});
export type EngagementStats = z.infer<typeof engagementSchema>;

export const topicSchema = z.object({
  clusters: z.array(
    z.object({ name: z.string(), share: z.number(), keywords: z.array(z.string()) })
  ),
  obsessions: z.array(z.string()),
  avoidedTopics: z.array(z.string()),
});
export type TopicStats = z.infer<typeof topicSchema>;

export const toneSchema = z.object({
  formality: z.number(),
  sentiment: z.string(),
  assertiveness: z.number(),
  humorStyle: z.string(),
});
export type ToneStats = z.infer<typeof toneSchema>;

export const voiceSchema = z.object({
  signaturePhrasesInContext: z.array(z.string()),
  rhetoricalDevices: z.array(z.string()),
  oneParagraphSummary: z.string(),
});
export type VoiceStats = z.infer<typeof voiceSchema>;

export const styleProfileSchema = z.object({
  handle: z.string(),
  displayName: z.string().nullable().optional(),
  sampleCount: z.number(),
  syntax: syntaxSchema,
  lexical: lexicalSchema,
  emojiFormat: emojiFormatSchema,
  engagement: engagementSchema,
  tone: toneSchema,
  topics: topicSchema,
  voice: voiceSchema,
});
export type StyleProfile = z.infer<typeof styleProfileSchema>;

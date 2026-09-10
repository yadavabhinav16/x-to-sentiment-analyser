import type { RawTweet } from "../../ingestion/ports/tweet-source";
import type { EngagementStats } from "../style-profile";

export function analyzeEngagement(tweets: RawTweet[]): EngagementStats {
  const withMetrics = tweets.filter((t) => t.impressionCount && t.impressionCount > 0);
  if (!withMetrics.length) {
    return {
      topFormats: [],
      avgEngagementRate: 0,
      lengthVsEngagement: "insufficient metrics",
    };
  }
  const rates = withMetrics.map(
    (t) => (t.likeCount + t.retweetCount + t.replyCount) / (t.impressionCount || 1)
  );
  const avg = rates.reduce((a, b) => a + b, 0) / rates.length;

  // Correlate length with engagement (above/below median)
  const sorted = [...withMetrics].sort(
    (a, b) => (b.likeCount + b.retweetCount) - (a.likeCount + a.retweetCount)
  );
  const top = sorted.slice(0, Math.ceil(sorted.length / 4));
  const avgTopLen = top.reduce((a, t) => a + t.text.length, 0) / top.length;
  const overallLen =
    withMetrics.reduce((a, t) => a + t.text.length, 0) / withMetrics.length;

  const topFormats: string[] = [];
  if (avgTopLen < overallLen * 0.85)
    topFormats.push("short posts get ~2x engagement");
  else if (avgTopLen > overallLen * 1.15)
    topFormats.push("longer posts get ~2x engagement");
  const questionShare = top.filter((t) => t.text.includes("?")).length / top.length;
  const baseQuestionShare =
    withMetrics.filter((t) => t.text.includes("?")).length / withMetrics.length;
  if (questionShare > baseQuestionShare * 1.5 && questionShare > 0.1)
    topFormats.push("questions drive replies");
  if (top.filter((t) => /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(t.text)).length / top.length > 0.2)
    topFormats.push("emoji-heavy posts overperform");

  return {
    topFormats,
    avgEngagementRate: round(avg),
    lengthVsEngagement:
      avgTopLen < overallLen * 0.85
        ? "shorter-than-average posts earn above-average engagement"
        : avgTopLen > overallLen * 1.15
          ? "longer-than-average posts earn above-average engagement"
          : "no strong length/engagement correlation",
  };
}

function round(x: number): number {
  return Math.round(x * 100) / 100;
}

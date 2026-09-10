import type { RawTweet } from "../../ingestion/ports/tweet-source";
import type { TopicStats } from "../style-profile";

const STOP = new Set(
  "the a an and or but if of to in on for with at by from as is are was were be been being it its this that these those i you he she we they them his her their our your my me him us do does did not no so than then there here what which who whom when where why how all any both each few more most other some such only own same too very can will just don should now about".split(
    " "
  )
);

const TOPIC_KEYWORDS: Array<[string, string[]]> = [
  ["AI", ["ai", "artificial", "intelligence", "model", "llm", "gpt", "agi", "neural"]],
  ["Space", ["space", "spacex", "starship", "rocket", "mars", "orbit", "launch", "falcon"]],
  ["Technology", ["tech", "software", "code", "computer", "chip", "robot", "robotics", "cybertruck", "car", "tesla"]],
  ["Business", ["company", "business", "market", "money", "cost", "price", "revenue", "sell", "buy"]],
  ["Politics", ["government", "policy", "law", "election", "vote", "political", "regulation"]],
  ["Media", ["media", "news", "film", "movie", "press", "journalis"]],
];

export function analyzeTopics(tweets: RawTweet[]): TopicStats {
  const texts = tweets.map((t) => t.text.toLowerCase());
  const scores = TOPIC_KEYWORDS.map(([name, kws]) => {
    const count = texts.filter((t) => kws.some((k) => t.includes(k))).length;
    return { name, count };
  });
  const total = tweets.length || 1;
  const clusters = scores
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((s) => ({
      name: s.name,
      share: round(s.count / total),
      keywords: TOPIC_KEYWORDS.find(([n]) => n === s.name)![1].slice(0, 5),
    }));

  // Co-occurrence obsessions: most frequent content words
  const freq = new Map<string, number>();
  for (const t of texts) {
    const seen = new Set(
      t
        .split(/\s+/)
        .map((w) => w.replace(/[^a-z0-9'’]/g, ""))
        .filter((w) => w.length > 3 && !STOP.has(w))
    );
    for (const w of seen) freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  const obsessions = [...freq.entries()]
    .filter(([, c]) => c >= Math.max(3, total * 0.05))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([w]) => w);

  return {
    clusters: clusters.length
      ? clusters
      : [{ name: "General", share: 1, keywords: [] }],
    obsessions,
    avoidedTopics: [],
  };
}

function round(x: number): number {
  return Math.round(x * 100) / 100;
}

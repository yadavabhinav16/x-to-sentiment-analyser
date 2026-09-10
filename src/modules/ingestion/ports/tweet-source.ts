export interface RawTweet {
  id: string;
  text: string;
  createdAt: string;
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  quoteCount: number;
  impressionCount: number | null;
}

export interface RawUser {
  id: string;
  username: string;
  name: string;
}

export interface TweetSource {
  fetchUser(handle: string): Promise<RawUser>;
  fetchRecentTweets(handle: string, limit: number): Promise<RawTweet[]>;
}

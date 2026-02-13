import { readFileSync } from "fs";
import * as cache from "./cache";
import { recordUsage } from "./cost";

const BASE_URL = "https://api.x.com/2";
const RATE_DELAY_MS = 350; // Stay under 450 req/15min

export interface Tweet {
  id: string;
  text: string;
  author_id: string;
  username: string;
  name: string;
  created_at: string;
  conversation_id: string;
  metrics: {
    likes: number;
    retweets: number;
    replies: number;
    quotes: number;
    impressions: number;
    bookmarks: number;
  };
  urls: string[];
  mentions: string[];
  hashtags: string[];
  tweet_url: string;
  author: {
    id: string;
    username: string;
    name: string;
    verified: boolean;
    followers_count: number;
    following_count: number;
    tweet_count: number;
    created_at: string;
  };
}

export interface SearchOptions {
  sort?: "recency" | "relevancy";
  since?: string; // "1h", "6h", "24h", "7d"
  maxPages?: number;
  maxResults?: number; // per page, 10-100
  startTime?: string; // ISO 8601
  endTime?: string;
}

interface RawApiResponse {
  data?: any[];
  includes?: { users?: any[] };
  meta?: { next_token?: string; result_count?: number };
}

// --- Auth ---

function getToken(): string {
  if (process.env.X_BEARER_TOKEN) return process.env.X_BEARER_TOKEN;

  // Try global env file
  try {
    const envFile = readFileSync(
      `${process.env.HOME}/.config/env/global.env`,
      "utf-8"
    );
    const match = envFile.match(/X_BEARER_TOKEN=["']?([^"'\n]+)/);
    if (match) return match[1];
  } catch {}

  throw new Error(
    "X_BEARER_TOKEN not found. Set it as an env var or in ~/.config/env/global.env"
  );
}

// --- HTTP ---

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function apiGet(url: string): Promise<RawApiResponse> {
  const token = getToken();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 429) {
    const reset = res.headers.get("x-rate-limit-reset");
    const waitSec = reset
      ? Math.max(parseInt(reset) - Math.floor(Date.now() / 1000), 1)
      : 60;
    throw new Error(`Rate limited. Resets in ${waitSec}s. Try again later.`);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`X API error ${res.status}: ${body}`);
  }

  return res.json();
}

// --- Tweet Parsing ---

function parseTweets(response: RawApiResponse): Tweet[] {
  if (!response.data) return [];

  const usersMap = new Map<string, any>();
  if (response.includes?.users) {
    for (const u of response.includes.users) {
      usersMap.set(u.id, u);
    }
  }

  return response.data.map((t: any) => {
    const user = usersMap.get(t.author_id) || {};
    const metrics = t.public_metrics || {};
    const entities = t.entities || {};

    return {
      id: t.id,
      text: t.text,
      author_id: t.author_id,
      username: user.username || "unknown",
      name: user.name || "Unknown",
      created_at: t.created_at,
      conversation_id: t.conversation_id,
      metrics: {
        likes: metrics.like_count || 0,
        retweets: metrics.retweet_count || 0,
        replies: metrics.reply_count || 0,
        quotes: metrics.quote_count || 0,
        impressions: metrics.impression_count || 0,
        bookmarks: metrics.bookmark_count || 0,
      },
      urls: (entities.urls || []).map((u: any) => u.expanded_url || u.url).filter(Boolean),
      mentions: (entities.mentions || []).map((m: any) => m.username).filter(Boolean),
      hashtags: (entities.hashtags || []).map((h: any) => h.tag).filter(Boolean),
      tweet_url: `https://x.com/${user.username || "i"}/status/${t.id}`,
      author: {
        id: user.id || t.author_id,
        username: user.username || "unknown",
        name: user.name || "Unknown",
        verified: user.verified || false,
        followers_count: user.public_metrics?.followers_count || 0,
        following_count: user.public_metrics?.following_count || 0,
        tweet_count: user.public_metrics?.tweet_count || 0,
        created_at: user.created_at || "",
      },
    };
  });
}

// --- Core fields for all tweet requests ---

const TWEET_FIELDS = "created_at,public_metrics,author_id,conversation_id,entities";
const USER_FIELDS = "username,name,verified,public_metrics,created_at";
const EXPANSIONS = "author_id";

// --- Search ---

export async function searchRecent(
  query: string,
  opts: SearchOptions = {}
): Promise<{ tweets: Tweet[]; rawCount: number; cached: boolean }> {
  const sort = opts.sort || "relevancy";
  const maxPages = opts.maxPages || 1;
  const maxResults = Math.min(opts.maxResults || 100, 100);

  // Build time range
  let startTime = opts.startTime;
  if (!startTime && opts.since) {
    const match = opts.since.match(/^(\d+)(h|d)$/);
    if (match) {
      const val = parseInt(match[1]);
      const unit = match[2];
      const ms = unit === "h" ? val * 3600000 : val * 86400000;
      startTime = new Date(Date.now() - ms).toISOString();
    }
  }

  // Cache check
  const ck = cache.cacheKey("search", { query, sort, maxPages, maxResults, startTime });
  const cached = cache.get<{ tweets: Tweet[]; rawCount: number }>(ck);
  if (cached) {
    return { ...cached, cached: true };
  }

  // Paginated fetch
  const allTweets: Tweet[] = [];
  let rawCount = 0;
  let nextToken: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      query,
      max_results: String(maxResults),
      "tweet.fields": TWEET_FIELDS,
      "user.fields": USER_FIELDS,
      expansions: EXPANSIONS,
      sort_order: sort,
    });

    if (startTime) params.set("start_time", startTime);
    if (opts.endTime) params.set("end_time", opts.endTime);
    if (nextToken) params.set("next_token", nextToken);

    const url = `${BASE_URL}/tweets/search/recent?${params}`;
    const response = await apiGet(url);
    const tweets = parseTweets(response);
    rawCount += response.meta?.result_count || 0;
    allTweets.push(...tweets);

    nextToken = response.meta?.next_token;
    if (!nextToken) break;
    if (page < maxPages - 1) await sleep(RATE_DELAY_MS);
  }

  // Deduplicate
  const seen = new Set<string>();
  const deduped = allTweets.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });

  // Record cost
  recordUsage(rawCount, query);

  // Cache result
  const ttl = maxPages === 1 ? cache.TTL.QUICK : cache.TTL.FULL;
  cache.set(ck, { tweets: deduped, rawCount }, ttl);

  return { tweets: deduped, rawCount, cached: false };
}

// --- Thread ---

export async function getThread(
  tweetId: string
): Promise<{ tweets: Tweet[]; rootTweet: Tweet | null; partial: boolean; cached: boolean }> {
  // First get the tweet to find conversation_id
  const ck = cache.cacheKey("thread", { tweetId });
  const cached = cache.get<{ tweets: Tweet[]; rootTweet: Tweet | null; partial: boolean }>(ck);
  if (cached) return { ...cached, cached: true };

  // Fetch the root tweet
  const tweetUrl = `${BASE_URL}/tweets/${tweetId}?tweet.fields=${TWEET_FIELDS}&user.fields=${USER_FIELDS}&expansions=${EXPANSIONS}`;
  const tweetRes = await apiGet(tweetUrl);
  const rootTweets = parseTweets({ data: tweetRes.data ? [tweetRes.data] : tweetRes.data, includes: tweetRes.includes });
  const rootTweet = rootTweets[0] || null;

  if (!rootTweet) {
    return { tweets: [], rootTweet: null, partial: false, cached: false };
  }

  // Search for conversation
  const convQuery = `conversation_id:${rootTweet.conversation_id}`;
  const result = await searchRecent(convQuery, { maxPages: 2, sort: "recency", since: "7d" });

  // Check if thread is partial (conversation might extend beyond 7-day window)
  const partial = result.tweets.length >= 190; // Near pagination limit suggests more exist

  const allTweets = [rootTweet, ...result.tweets.filter(t => t.id !== rootTweet.id)];
  allTweets.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  cache.set(ck, { tweets: allTweets, rootTweet, partial }, cache.TTL.THREAD);
  return { tweets: allTweets, rootTweet, partial, cached: false };
}

// --- Profile ---

export async function getProfile(
  username: string
): Promise<{ user: Tweet["author"]; recentTweets: Tweet[]; cached: boolean }> {
  const ck = cache.cacheKey("profile", { username });
  const cached = cache.get<{ user: Tweet["author"]; recentTweets: Tweet[] }>(ck);
  if (cached) return { ...cached, cached: true };

  // User lookup
  const userUrl = `${BASE_URL}/users/by/username/${username.replace("@", "")}?user.fields=${USER_FIELDS}`;
  const userRes = await apiGet(userUrl);

  if (!userRes.data) {
    throw new Error(`User @${username} not found`);
  }

  const userData = userRes.data as any;
  const user: Tweet["author"] = {
    id: userData.id,
    username: userData.username,
    name: userData.name,
    verified: userData.verified || false,
    followers_count: userData.public_metrics?.followers_count || 0,
    following_count: userData.public_metrics?.following_count || 0,
    tweet_count: userData.public_metrics?.tweet_count || 0,
    created_at: userData.created_at || "",
  };

  // Recent tweets
  const tweetsUrl = `${BASE_URL}/users/${user.id}/tweets?max_results=20&tweet.fields=${TWEET_FIELDS}&user.fields=${USER_FIELDS}&expansions=${EXPANSIONS}`;
  const tweetsRes = await apiGet(tweetsUrl);
  const recentTweets = parseTweets(tweetsRes);

  recordUsage(recentTweets.length + 1);
  cache.set(ck, { user, recentTweets }, cache.TTL.PROFILE);
  return { user, recentTweets, cached: false };
}

// --- Utility ---

export function sortTweets(tweets: Tweet[], by: "likes" | "retweets" | "recency" | "impressions" | "bookmarks"): Tweet[] {
  const sorted = [...tweets];
  switch (by) {
    case "likes":
      return sorted.sort((a, b) => b.metrics.likes - a.metrics.likes);
    case "retweets":
      return sorted.sort((a, b) => b.metrics.retweets - a.metrics.retweets);
    case "impressions":
      return sorted.sort((a, b) => b.metrics.impressions - a.metrics.impressions);
    case "bookmarks":
      return sorted.sort((a, b) => b.metrics.bookmarks - a.metrics.bookmarks);
    case "recency":
      return sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    default:
      return sorted;
  }
}

export function dedupe(tweets: Tweet[]): Tweet[] {
  const seen = new Set<string>();
  return tweets.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
}

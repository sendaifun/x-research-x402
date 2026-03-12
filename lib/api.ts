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
  is_article: boolean;
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
  sort?: "recency" | "relevancy" | "likes" | "retweets" | "impressions" | "bookmarks";
  since?: string; // "1h", "6h", "24h", "7d"
  maxPages?: number;
  maxResults?: number; // per page, 10-100
  startTime?: string; // ISO 8601
  endTime?: string;
}

export interface RequestControls {
  forceFresh?: boolean;
  cacheTtlMs?: number;
  recordUsage?: boolean;
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

function dedupeByField(arr: any[], field: string): any[] {
  const seen = new Set<string>();
  return arr.filter((item) => {
    const val = item[field];
    if (!val || seen.has(val)) return false;
    seen.add(val);
    return true;
  });
}

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
    const noteTweet = t.note_tweet;

    // Use full article text when available (note_tweet = long-form posts > 280 chars)
    const fullText = noteTweet?.text || t.text;

    // Merge entities: note_tweet entities are more complete for long-form posts
    const noteEntities = noteTweet?.entities || {};
    const mergedUrls = dedupeByField(
      [...(noteEntities.urls || []), ...(entities.urls || [])],
      "expanded_url"
    );
    const mergedMentions = dedupeByField(
      [...(noteEntities.mentions || []), ...(entities.mentions || [])],
      "username"
    );
    const mergedHashtags = dedupeByField(
      [...(noteEntities.hashtags || []), ...(entities.hashtags || [])],
      "tag"
    );

    return {
      id: t.id,
      text: fullText,
      author_id: t.author_id,
      username: user.username || "unknown",
      name: user.name || "Unknown",
      created_at: t.created_at,
      conversation_id: t.conversation_id,
      is_article: !!noteTweet,
      metrics: {
        likes: metrics.like_count || 0,
        retweets: metrics.retweet_count || 0,
        replies: metrics.reply_count || 0,
        quotes: metrics.quote_count || 0,
        impressions: metrics.impression_count || 0,
        bookmarks: metrics.bookmark_count || 0,
      },
      urls: mergedUrls.map((u: any) => u.expanded_url || u.url).filter(Boolean),
      mentions: mergedMentions.map((m: any) => m.username).filter(Boolean),
      hashtags: mergedHashtags.map((h: any) => h.tag).filter(Boolean),
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

const TWEET_FIELDS = "created_at,public_metrics,author_id,conversation_id,entities,note_tweet";
const USER_FIELDS = "username,name,verified,public_metrics,created_at";
const EXPANSIONS = "author_id";

// --- Search ---

// API only accepts these sort values; anything else must be done locally
const API_SORT_VALUES = new Set(["recency", "relevancy"]);

function shouldRecordUsage(controls?: RequestControls): boolean {
  return controls?.recordUsage !== false;
}

export function searchRecentCacheKey(
  query: string,
  opts: SearchOptions = {}
): string {
  const requestedSort = opts.sort || "relevancy";
  const totalLimit = opts.maxResults || 100;
  const maxPages = Math.min(opts.maxPages || 1, Math.ceil(totalLimit / 10));
  const maxResults = Math.max(10, Math.min(totalLimit, 100));
  const cacheKeyTime = opts.startTime || opts.since || "";

  return cache.cacheKey("search", {
    query,
    sort: requestedSort,
    maxPages,
    maxResults,
    since: cacheKeyTime,
  });
}

export function searchAllCacheKey(
  query: string,
  opts: SearchOptions = {}
): string {
  const totalLimit = opts.maxResults || 100;
  const maxPages = Math.min(opts.maxPages || 1, Math.ceil(totalLimit / 10));
  const maxResults = Math.max(10, Math.min(totalLimit, 100));
  const sort = opts.sort || "recency";

  return cache.cacheKey("search_all", { query, sort, maxPages, maxResults });
}

export function tweetCacheKey(tweetId: string): string {
  return cache.cacheKey("tweet", { tweetId });
}

export function batchTweetsCacheKey(tweetIds: string[]): string {
  return cache.cacheKey("batch", { ids: [...tweetIds].sort().join(",") });
}

export function threadCacheKey(tweetId: string): string {
  return cache.cacheKey("thread", { tweetId });
}

export function profileCacheKey(username: string): string {
  return cache.cacheKey("profile", { username });
}

export async function searchRecent(
  query: string,
  opts: SearchOptions = {},
  controls?: RequestControls
): Promise<{ tweets: Tweet[]; rawCount: number; cached: boolean }> {
  const requestedSort = opts.sort || "relevancy";
  // Use relevancy for API call if the requested sort isn't API-supported
  const apiSort = API_SORT_VALUES.has(requestedSort) ? requestedSort : "relevancy";
  const localSort = API_SORT_VALUES.has(requestedSort) ? null : requestedSort;

  // --limit is a total cap. Compute pages and per-page size from it.
  // API requires 10-100 per page.
  const totalLimit = opts.maxResults || 100;
  const maxPages = Math.min(opts.maxPages || 1, Math.ceil(totalLimit / 10));
  const maxResults = Math.max(10, Math.min(totalLimit, 100)); // API: 10-100 per page

  // Build time range — bucket to the hour for cache stability
  const since = opts.since || "";
  let startTime = opts.startTime;
  if (!startTime && since) {
    const match = since.match(/^(\d+)(h|d)$/);
    if (match) {
      const val = parseInt(match[1]);
      const unit = match[2];
      const ms = unit === "h" ? val * 3600000 : val * 86400000;
      const raw = Date.now() - ms;
      // Round UP to next hour for cache stability + avoids X API 7-day boundary rejections
      const HOUR_MS = 3600000;
      startTime = new Date(raw - (raw % HOUR_MS) + HOUR_MS).toISOString();
    }
  }

  // Cache check — key on `since` string (not computed startTime) for stable cache hits
  const ck = searchRecentCacheKey(query, opts);
  if (!controls?.forceFresh) {
    const cached = await cache.get<{ tweets: Tweet[]; rawCount: number }>(ck);
    if (cached) {
      return { ...cached, cached: true };
    }
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
      sort_order: apiSort,
    });

    if (startTime) params.set("start_time", startTime);
    if (opts.endTime) params.set("end_time", opts.endTime);
    if (nextToken) params.set("next_token", nextToken);

    const url = `${BASE_URL}/tweets/search/recent?${params}`;
    const response = await apiGet(url);
    const tweets = parseTweets(response);
    rawCount += response.meta?.result_count || 0;
    allTweets.push(...tweets);

    // Stop if we've hit the total limit
    if (allTweets.length >= totalLimit) break;

    nextToken = response.meta?.next_token;
    if (!nextToken) break;
    if (page < maxPages - 1) await sleep(RATE_DELAY_MS);
  }

  // Trim to total limit
  if (allTweets.length > totalLimit) allTweets.length = totalLimit;

  // Deduplicate
  const seen = new Set<string>();
  const deduped = allTweets.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });

  // Local re-sort if requested sort isn't API-supported
  let finalTweets = deduped;
  if (localSort) {
    finalTweets = sortTweets(deduped, localSort as any);
  }

  // Record cost
  if (shouldRecordUsage(controls)) {
    await recordUsage(rawCount, query);
  }

  // Cache result
  const ttl =
    controls?.cacheTtlMs ?? (totalLimit <= 20 ? cache.TTL.QUICK : cache.TTL.FULL);
  await cache.set(ck, { tweets: finalTweets, rawCount }, ttl);

  return { tweets: finalTweets, rawCount, cached: false };
}

// --- Single Tweet Lookup ($0.005) ---

export async function getTweet(
  tweetId: string,
  controls?: RequestControls
): Promise<{ tweet: Tweet | null; cached: boolean }> {
  const ck = tweetCacheKey(tweetId);
  if (!controls?.forceFresh) {
    const cached = await cache.get<{ tweet: Tweet }>(ck);
    if (cached) return { ...cached, cached: true };
  }

  const url = `${BASE_URL}/tweets/${tweetId}?tweet.fields=${TWEET_FIELDS}&user.fields=${USER_FIELDS}&expansions=${EXPANSIONS}`;
  const res = await apiGet(url);
  const tweets = parseTweets({ data: res.data ? [res.data] : res.data, includes: res.includes });
  const tweet = tweets[0] || null;

  if (tweet) {
    if (shouldRecordUsage(controls)) {
      await recordUsage(1, `tweet:${tweetId}`);
    }
    await cache.set(ck, { tweet }, controls?.cacheTtlMs ?? cache.TTL.READ);
  }

  return { tweet, cached: false };
}

// --- Batch Tweet Lookup (up to 100 IDs, $0.005/tweet) ---

export async function getBatchTweets(
  tweetIds: string[],
  controls?: RequestControls
): Promise<{ tweets: Tweet[]; cached: boolean }> {
  if (tweetIds.length === 0) return { tweets: [], cached: true };
  if (tweetIds.length > 100) tweetIds = tweetIds.slice(0, 100);

  const ck = batchTweetsCacheKey(tweetIds);
  if (!controls?.forceFresh) {
    const cached = await cache.get<{ tweets: Tweet[] }>(ck);
    if (cached) return { ...cached, cached: true };
  }

  const url = `${BASE_URL}/tweets?ids=${tweetIds.join(",")}&tweet.fields=${TWEET_FIELDS}&user.fields=${USER_FIELDS}&expansions=${EXPANSIONS}`;
  const res = await apiGet(url);
  const tweets = parseTweets(res);

  if (shouldRecordUsage(controls)) {
    await recordUsage(tweets.length, `batch:${tweetIds.length}ids`);
  }
  await cache.set(ck, { tweets }, controls?.cacheTtlMs ?? cache.TTL.THREAD);

  return { tweets, cached: false };
}

// --- Full-Archive Search (no 7-day limit, $0.005/tweet) ---

export async function searchAll(
  query: string,
  opts: SearchOptions = {},
  controls?: RequestControls
): Promise<{ tweets: Tweet[]; rawCount: number; cached: boolean }> {
  const totalLimit = opts.maxResults || 100;
  const maxPages = Math.min(opts.maxPages || 1, Math.ceil(totalLimit / 10));
  const maxResults = Math.max(10, Math.min(totalLimit, 100));
  const sort = opts.sort || "recency";

  const ck = searchAllCacheKey(query, opts);
  if (!controls?.forceFresh) {
    const cached = await cache.get<{ tweets: Tweet[]; rawCount: number }>(ck);
    if (cached) return { ...cached, cached: true };
  }

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

    if (opts.startTime) params.set("start_time", opts.startTime);
    if (opts.endTime) params.set("end_time", opts.endTime);
    if (nextToken) params.set("next_token", nextToken);

    const url = `${BASE_URL}/tweets/search/all?${params}`;
    const response = await apiGet(url);
    const tweets = parseTweets(response);
    rawCount += response.meta?.result_count || 0;
    allTweets.push(...tweets);

    if (allTweets.length >= totalLimit) break;
    nextToken = response.meta?.next_token;
    if (!nextToken) break;
    if (page < maxPages - 1) await sleep(RATE_DELAY_MS);
  }

  if (allTweets.length > totalLimit) allTweets.length = totalLimit;

  const deduped = dedupe(allTweets);
  if (shouldRecordUsage(controls)) {
    await recordUsage(rawCount, query);
  }
  await cache.set(ck, { tweets: deduped, rawCount }, controls?.cacheTtlMs ?? cache.TTL.THREAD);

  return { tweets: deduped, rawCount, cached: false };
}

// --- Thread (uses full-archive search — no 7-day limit) ---

export async function getThread(
  tweetId: string,
  controls?: RequestControls
): Promise<{ tweets: Tweet[]; rootTweet: Tweet | null; partial: boolean; cached: boolean }> {
  const ck = threadCacheKey(tweetId);
  if (!controls?.forceFresh) {
    const cached = await cache.get<{ tweets: Tweet[]; rootTweet: Tweet | null; partial: boolean }>(ck);
    if (cached) return { ...cached, cached: true };
  }

  // Fetch the root tweet ($0.005)
  const rootResult = await getTweet(tweetId, controls);
  const rootTweet = rootResult.tweet;

  if (!rootTweet) {
    return { tweets: [], rootTweet: null, partial: false, cached: false };
  }

  // Search full archive for conversation thread (no 7-day limit)
  const convQuery = `conversation_id:${rootTweet.conversation_id}`;
  let result: { tweets: Tweet[]; rawCount: number; cached: boolean };
  try {
    result = await searchAll(
      convQuery,
      { maxPages: 2, sort: "recency", maxResults: 100 },
      controls
    );
  } catch (err: any) {
    // Fall back to recent search if full-archive isn't available on this tier
    if (err.message.includes("403") || err.message.includes("not available")) {
      result = await searchRecent(
        convQuery,
        { maxPages: 2, sort: "recency", since: "7d" },
        controls
      );
    } else {
      throw err;
    }
  }

  const partial = result.tweets.length >= 190;

  const allTweets = [rootTweet, ...result.tweets.filter(t => t.id !== rootTweet.id)];
  allTweets.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  await cache.set(
    ck,
    { tweets: allTweets, rootTweet, partial },
    controls?.cacheTtlMs ?? cache.TTL.THREAD
  );
  return { tweets: allTweets, rootTweet, partial, cached: false };
}

// --- Profile ---

export async function getProfile(
  username: string,
  controls?: RequestControls
): Promise<{ user: Tweet["author"]; recentTweets: Tweet[]; cached: boolean }> {
  const ck = profileCacheKey(username);
  if (!controls?.forceFresh) {
    const cached = await cache.get<{ user: Tweet["author"]; recentTweets: Tweet[] }>(ck);
    if (cached) return { ...cached, cached: true };
  }

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

  if (shouldRecordUsage(controls)) {
    await recordUsage(recentTweets.length + 1);
  }
  await cache.set(ck, { user, recentTweets }, controls?.cacheTtlMs ?? cache.TTL.PROFILE);
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

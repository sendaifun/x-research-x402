import * as cache from "./cache";
import {
  dedupe,
  getTweet,
  searchAll,
  searchAllCacheKey,
  searchRecent,
  searchRecentCacheKey,
  sortTweets,
  threadCacheKey,
  tweetCacheKey,
  type Tweet,
} from "./api";
import { applyEngagementFilter, appendNoiseFilters } from "./filters";
import {
  MAX_ACCOUNTS_PER_REQUEST,
  MAX_SEARCH_LIMIT,
  THREAD_RESULT_CAP,
  TRENDING_QUERY_CAP,
  type StandardTrendingKind,
} from "./http-pricing";

export class HttpValidationError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface UsageBreakdown {
  postsRead: number;
}

interface BaseMeta {
  cached: boolean;
  returned_count: number;
}

export interface ReadResult {
  data: Tweet | null;
  meta: BaseMeta;
  usage: UsageBreakdown;
}

export interface SearchResult {
  data: Tweet[];
  meta: BaseMeta & {
    raw_count: number;
    limit: number;
    quick: boolean;
  };
  usage: UsageBreakdown;
}

export interface ThreadResult {
  data: Tweet[];
  meta: BaseMeta & {
    partial: boolean;
  };
  usage: UsageBreakdown;
}

export interface TrendingResult {
  data: Tweet[];
  meta: BaseMeta & {
    raw_count: number;
    query_count: number;
    kind: StandardTrendingKind;
    top: number;
  };
  usage: UsageBreakdown;
}

export interface SearchRequest {
  q?: string | null;
  limit?: string | number | null;
  since?: string | null;
  sort?: string | null;
  from?: string | null;
  min_likes?: string | number | null;
  fresh?: string | boolean | null;
}

export interface AccountsFeedRequest {
  accounts: string;
  limit?: string | number | null;
  since?: string | null;
  fresh?: string | boolean | null;
}

export interface TrendingRequest {
  window?: string | null;
  top?: string | number | null;
  fresh?: string | boolean | null;
}

function parseBoolean(value: string | boolean | null | undefined): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "fresh"].includes(String(value).toLowerCase());
}

function parsePositiveInt(
  value: string | number | null | undefined,
  fallback: number,
  max: number
): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new HttpValidationError(400, "Expected a positive integer.");
  }

  return Math.min(Math.floor(parsed), max);
}

function parseNonNegativeInt(
  value: string | number | null | undefined,
  fallback: number,
  max: number
): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new HttpValidationError(400, "Expected a non-negative integer.");
  }

  return Math.min(Math.floor(parsed), max);
}

function parseSort(value: string | null | undefined): SearchRequest["sort"] {
  if (!value) {
    return undefined;
  }

  const sort = value.toLowerCase();
  const allowed = new Set([
    "relevancy",
    "recency",
    "likes",
    "retweets",
    "impressions",
    "bookmarks",
  ]);
  if (!allowed.has(sort)) {
    throw new HttpValidationError(400, `Unsupported sort "${value}".`);
  }

  return sort;
}

function parseSince(value: string | null | undefined, fallback: string): string {
  const since = value || fallback;
  if (!/^\d+(h|d)$/.test(since)) {
    throw new HttpValidationError(400, `Invalid since/window value "${since}".`);
  }
  return since;
}

function sanitizeUsername(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

function parseAccounts(accounts: string): string[] {
  const parsed = accounts
    .split(",")
    .map(sanitizeUsername)
    .filter(Boolean);

  const deduped = [...new Set(parsed)];
  if (deduped.length === 0) {
    throw new HttpValidationError(400, "At least one account is required.");
  }
  if (deduped.length > MAX_ACCOUNTS_PER_REQUEST) {
    throw new HttpValidationError(
      400,
      `A maximum of ${MAX_ACCOUNTS_PER_REQUEST} accounts is supported per request.`
    );
  }

  return deduped;
}

export function parseTweetInput(input: string): string {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/(?:x\.com|twitter\.com)\/\w+\/status\/(\d+)/);
  if (urlMatch) return urlMatch[1];
  if (/^\d+$/.test(trimmed)) return trimmed;
  throw new HttpValidationError(
    400,
    `Cannot parse tweet ID from "${input}". Use a numeric ID or status URL.`
  );
}

function buildSearchPlan(request: SearchRequest): {
  fullQuery: string;
  limit: number;
  since: string;
  sort: string;
  minLikes: number;
  quick: boolean;
  fresh: boolean;
} {
  if (!request.q?.trim()) {
    throw new HttpValidationError(400, "Query parameter q is required.");
  }

  const limit = parsePositiveInt(request.limit, 20, MAX_SEARCH_LIMIT);
  const quick = limit <= 20;
  const sort = parseSort(request.sort) || "relevancy";
  const since = parseSince(request.since, "24h");
  const minLikes = parseNonNegativeInt(request.min_likes, quick ? 3 : 0, 1_000_000);

  let fullQuery = request.q.trim();
  if (request.from) {
    const fromUsers = request.from
      .split(",")
      .map(sanitizeUsername)
      .filter(Boolean)
      .map((username) => `from:${username}`);

    if (fromUsers.length > 0) {
      fullQuery = `(${fullQuery}) (${fromUsers.join(" OR ")})`;
    }
  }

  fullQuery = appendNoiseFilters(fullQuery, quick);
  if (!/\blang:/i.test(fullQuery)) {
    fullQuery += " lang:en";
  }

  return {
    fullQuery,
    limit,
    since,
    sort,
    minLikes,
    quick,
    fresh: parseBoolean(request.fresh),
  };
}

function buildAccountsFeedPlan(request: AccountsFeedRequest): {
  accounts: string[];
  limit: number;
  since: string;
  query: string;
  fresh: boolean;
} {
  const accounts = parseAccounts(request.accounts);
  const limit = parsePositiveInt(request.limit, 20, MAX_SEARCH_LIMIT);
  const since = parseSince(request.since, "24h");
  const query = `(${accounts.map((username) => `from:${username}`).join(" OR ")}) -is:retweet lang:en`;

  return {
    accounts,
    limit,
    since,
    query,
    fresh: parseBoolean(request.fresh),
  };
}

function buildTrendingQueries(kind: StandardTrendingKind): string[] {
  if (kind === "solana") {
    return [
      `(solana OR $SOL) (alpha OR strategy OR buy OR bullish OR launch) -is:retweet lang:en`,
      `(pump.fun OR dexscreener OR birdeye) solana -is:retweet lang:en`,
    ];
  }

  return [
    `(crypto OR defi OR web3) (alpha OR trending OR bullish OR launch OR pump) -is:retweet lang:en`,
    `(pump.fun OR dexscreener OR birdeye OR uniswap) -is:retweet lang:en`,
    `(solana OR ethereum OR bitcoin) (buy OR strategy OR yield OR airdrop) -is:retweet lang:en`,
  ];
}

function buildTrendingPlan(kind: StandardTrendingKind, request: TrendingRequest): {
  queries: string[];
  window: string;
  top: number;
  fresh: boolean;
} {
  return {
    queries: buildTrendingQueries(kind),
    window: parseSince(request.window, "6h"),
    top: parsePositiveInt(request.top, 20, 20),
    fresh: parseBoolean(request.fresh),
  };
}

export function canServeReadWithoutX(tweetIdInput: string, fresh: boolean): boolean {
  if (fresh) {
    return false;
  }

  return cache.has(tweetCacheKey(parseTweetInput(tweetIdInput)));
}

export function canServeSearchWithoutX(request: SearchRequest): boolean {
  const plan = buildSearchPlan(request);
  if (plan.fresh) {
    return false;
  }

  return cache.has(
    searchRecentCacheKey(plan.fullQuery, {
      sort: plan.sort as any,
      since: plan.since,
      maxPages: 1,
      maxResults: plan.limit,
    })
  );
}

export function canServeAccountsFeedWithoutX(request: AccountsFeedRequest): boolean {
  const plan = buildAccountsFeedPlan(request);
  if (plan.fresh) {
    return false;
  }

  return cache.has(
    searchRecentCacheKey(plan.query, {
      sort: "recency",
      since: plan.since,
      maxPages: 1,
      maxResults: plan.limit,
    })
  );
}

export function canServeThreadWithoutX(tweetIdInput: string, fresh: boolean): boolean {
  if (fresh) {
    return false;
  }

  const tweetId = parseTweetInput(tweetIdInput);
  if (cache.has(threadCacheKey(tweetId))) {
    return true;
  }

  if (!cache.has(tweetCacheKey(tweetId))) {
    return false;
  }

  const cachedRoot = cache.get<{ tweet: Tweet }>(tweetCacheKey(tweetId));
  const conversationId = cachedRoot?.tweet?.conversation_id;
  if (!conversationId) {
    return false;
  }

  const conversationQuery = `conversation_id:${conversationId}`;
  return (
    cache.has(
      searchAllCacheKey(conversationQuery, {
        maxPages: 2,
        maxResults: THREAD_RESULT_CAP,
        sort: "recency",
      })
    ) ||
    cache.has(
      searchRecentCacheKey(conversationQuery, {
        maxPages: 2,
        maxResults: THREAD_RESULT_CAP,
        sort: "recency",
        since: "7d",
      })
    )
  );
}

export function canServeTrendingWithoutX(
  kind: StandardTrendingKind,
  request: TrendingRequest
): boolean {
  const plan = buildTrendingPlan(kind, request);
  if (plan.fresh) {
    return false;
  }

  return plan.queries.every((query) =>
    cache.has(
      searchRecentCacheKey(query, {
        since: plan.window,
        maxPages: 1,
        maxResults: TRENDING_QUERY_CAP,
        sort: "recency",
      })
    )
  );
}

export async function fetchRead(tweetIdInput: string, fresh: boolean): Promise<ReadResult> {
  const tweetId = parseTweetInput(tweetIdInput);
  const result = await getTweet(tweetId, {
    forceFresh: fresh,
    cacheTtlMs: cache.TTL.READ,
  });

  return {
    data: result.tweet,
    meta: {
      cached: result.cached,
      returned_count: result.tweet ? 1 : 0,
    },
    usage: {
      postsRead: result.cached || !result.tweet ? 0 : 1,
    },
  };
}

export async function fetchSearch(request: SearchRequest): Promise<SearchResult> {
  const plan = buildSearchPlan(request);
  const result = await searchRecent(
    plan.fullQuery,
    {
      sort: plan.sort as any,
      since: plan.since,
      maxPages: 1,
      maxResults: plan.limit,
    },
    {
      forceFresh: plan.fresh,
      cacheTtlMs: plan.quick ? cache.TTL.QUICK : cache.TTL.FULL,
    }
  );

  const filtered = applyEngagementFilter(result.tweets, {
    minLikes: plan.minLikes,
  });

  return {
    data: filtered,
    meta: {
      cached: result.cached,
      returned_count: filtered.length,
      raw_count: result.rawCount,
      limit: plan.limit,
      quick: plan.quick,
    },
    usage: {
      postsRead: result.cached ? 0 : result.tweets.length,
    },
  };
}

export async function fetchAccountsFeed(
  request: AccountsFeedRequest
): Promise<SearchResult> {
  const plan = buildAccountsFeedPlan(request);
  const result = await searchRecent(
    plan.query,
    {
      sort: "recency",
      since: plan.since,
      maxPages: 1,
      maxResults: plan.limit,
    },
    {
      forceFresh: plan.fresh,
      cacheTtlMs: cache.TTL.ACCOUNTS_FEED,
    }
  );

  return {
    data: result.tweets,
    meta: {
      cached: result.cached,
      returned_count: result.tweets.length,
      raw_count: result.rawCount,
      limit: plan.limit,
      quick: plan.limit <= 20,
    },
    usage: {
      postsRead: result.cached ? 0 : result.tweets.length,
    },
  };
}

export async function fetchThread(
  tweetIdInput: string,
  fresh: boolean
): Promise<ThreadResult> {
  const tweetId = parseTweetInput(tweetIdInput);
  const cachedThread = !fresh
    ? cache.get<{ tweets: Tweet[]; rootTweet: Tweet | null; partial: boolean }>(
        threadCacheKey(tweetId)
      )
    : null;

  if (cachedThread) {
    return {
      data: cachedThread.tweets,
      meta: {
        cached: true,
        returned_count: cachedThread.tweets.length,
        partial: cachedThread.partial,
      },
      usage: {
        postsRead: 0,
      },
    };
  }

  const rootResult = await getTweet(tweetId, {
    forceFresh: fresh,
    cacheTtlMs: cache.TTL.READ,
  });

  if (!rootResult.tweet) {
    return {
      data: [],
      meta: {
        cached: false,
        returned_count: 0,
        partial: false,
      },
      usage: {
        postsRead: 0,
      },
    };
  }

  const conversationQuery = `conversation_id:${rootResult.tweet.conversation_id}`;
  let searchResult: { tweets: Tweet[]; rawCount: number; cached: boolean };

  try {
    searchResult = await searchAll(
      conversationQuery,
      { maxPages: 2, sort: "recency", maxResults: THREAD_RESULT_CAP },
      {
        forceFresh: fresh,
        cacheTtlMs: cache.TTL.THREAD,
      }
    );
  } catch (error: any) {
    if (error.message?.includes("403") || error.message?.includes("not available")) {
      searchResult = await searchRecent(
        conversationQuery,
        {
          maxPages: 2,
          sort: "recency",
          since: "7d",
          maxResults: THREAD_RESULT_CAP,
        },
        {
          forceFresh: fresh,
          cacheTtlMs: cache.TTL.THREAD,
        }
      );
    } else {
      throw error;
    }
  }

  const tweets = [rootResult.tweet, ...searchResult.tweets.filter((tweet) => tweet.id !== tweetId)];
  tweets.sort(
    (left, right) =>
      new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
  );
  const partial = searchResult.tweets.length >= 190;

  cache.set(threadCacheKey(tweetId), {
    tweets,
    rootTweet: rootResult.tweet,
    partial,
  }, cache.TTL.THREAD);

  return {
    data: tweets,
    meta: {
      cached: rootResult.cached && searchResult.cached,
      returned_count: tweets.length,
      partial,
    },
    usage: {
      postsRead:
        (rootResult.cached ? 0 : 1) + (searchResult.cached ? 0 : searchResult.tweets.length),
    },
  };
}

export async function fetchTrending(
  kind: StandardTrendingKind,
  request: TrendingRequest
): Promise<TrendingResult> {
  const plan = buildTrendingPlan(kind, request);
  const allTweets: Tweet[] = [];
  let rawCount = 0;
  let postsRead = 0;
  let allCached = true;

  for (const query of plan.queries) {
    const result = await searchRecent(
      query,
      {
        since: plan.window,
        maxPages: 1,
        sort: "recency",
        maxResults: TRENDING_QUERY_CAP,
      },
      {
        forceFresh: plan.fresh,
        cacheTtlMs: cache.TTL.TRENDING,
      }
    );

    allTweets.push(...result.tweets);
    rawCount += result.rawCount;
    allCached &&= result.cached;
    if (!result.cached) {
      postsRead += result.tweets.length;
    }
  }

  const deduped = sortTweets(dedupe(allTweets), "recency").slice(0, plan.top);

  return {
    data: deduped,
    meta: {
      cached: allCached,
      returned_count: deduped.length,
      raw_count: rawCount,
      query_count: plan.queries.length,
      kind,
      top: plan.top,
    },
    usage: {
      postsRead,
    },
  };
}

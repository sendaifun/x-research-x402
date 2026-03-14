#!/usr/bin/env bun
/**
 * format — Full CLI-style formatted output from hosted API responses.
 *
 * Auto-detects response type (search, read, thread, trending) and applies
 * TweetRank + formatting to produce the same output as the local CLI.
 *
 * Usage:
 *   curl .../x402/search/20?q=alpha | bun run scripts/postprocess/format.ts
 *   curl .../x402/read?tweetId=123  | bun run scripts/postprocess/format.ts
 *   curl .../x402/thread/100?tweetId=123 | bun run scripts/postprocess/format.ts
 *
 * Flags:
 *   --extract-tickers   Also print ticker aggregation
 *   --extract-cas       Also print contract addresses and crypto URLs
 */

import { readStdin, toTweets } from "./read-stdin";
import { loadWatchlistSet } from "./watchlist";
import { rankTweets, computeTweetRank } from "../../lib/tweetrank";
import {
  formatSearchResults,
  formatRead,
  formatThread,
} from "../../lib/format";
import {
  aggregateMentions,
  extractContractAddresses,
  extractCryptoUrls,
} from "../../lib/extract";
import { formatContractAddresses, formatCryptoUrls } from "../../lib/format";
import type { RankedTweet } from "../../lib/tweetrank";

const extractTickersFlag = process.argv.includes("--extract-tickers");
const extractCasFlag = process.argv.includes("--extract-cas");

const response = await readStdin();
const tweets = toTweets(response);
const wl = loadWatchlistSet();
const meta = response.meta as Record<string, any>;

// Detect response type from meta shape
const isRead = !Array.isArray(response.data) || (meta.returned_count === 1 && !meta.partial && !meta.quick);
const isThread = meta.partial !== undefined;
const isSearch = meta.quick !== undefined || meta.limit !== undefined;

if (isThread) {
  // Thread
  const ranked = rankTweets(tweets, wl);
  // Threads display in chronological order
  ranked.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  console.log(formatThread(ranked, !!meta.partial, !!meta.cached));
} else if (isRead && tweets.length === 1) {
  // Single read
  const ranked = computeTweetRank(tweets[0], wl);
  console.log(formatRead(ranked, !!meta.cached));
} else {
  // Search / accounts-feed / trending (default)
  const ranked = rankTweets(tweets, wl);
  console.log(formatSearchResults(ranked, {
    query: (meta.query as string) || "(hosted search)",
    rawCount: (meta.raw_count as number) || tweets.length,
    cached: !!meta.cached,
    since: meta.since as string,
  }));
}

// Optional ticker extraction
if (extractTickersFlag) {
  const mentions = aggregateMentions(tweets);
  if (mentions.length > 0) {
    console.log("\n### Extracted Tickers\n");
    for (const m of mentions.slice(0, 15)) {
      const sourceTypes = m.sources.map(s => `${s.type}(${s.count})`).join(", ");
      console.log(`- **${m.ticker}** (${m.count} mentions, ${m.uniqueAuthors} authors) via ${sourceTypes}`);
    }
  }
}

// Optional CA extraction
if (extractCasFlag) {
  const allCas = tweets.flatMap(t => extractContractAddresses(t.text));
  const allUrls = tweets.flatMap(t => extractCryptoUrls(t.urls));
  if (allCas.length > 0) console.log(formatContractAddresses(allCas));
  if (allUrls.length > 0) console.log(formatCryptoUrls(allUrls));
}

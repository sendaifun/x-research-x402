#!/usr/bin/env bun
/**
 * trending — Full trending pipeline: aggregate tickers + raid detection + format.
 *
 * The hosted /x402/trending/* routes return raw tweets. This script produces
 * the full CLI-style trending output with ticker aggregation and raid flags.
 *
 * Usage:
 *   curl .../x402/trending/solana | bun run scripts/postprocess/trending.ts
 *   curl .../x402/trending/general?window=1h | bun run scripts/postprocess/trending.ts
 *
 * Flags:
 *   --min-mentions N   Minimum mentions to include (default: 3)
 *   --json             Output raw JSON
 */

import { readStdin, toTweets } from "./read-stdin";
import { loadWatchlistSet } from "./watchlist";
import { aggregateMentions } from "../../lib/extract";
import { detectRaids } from "../../lib/tweetrank";
import { formatTrending } from "../../lib/format";
import type { Tweet } from "../../lib/api";

// Parse --min-mentions
let minMentions = 3;
const mmIdx = process.argv.indexOf("--min-mentions");
if (mmIdx !== -1 && process.argv[mmIdx + 1]) {
  minMentions = parseInt(process.argv[mmIdx + 1]) || 3;
}
const jsonMode = process.argv.includes("--json");

const response = await readStdin();
const tweets = toTweets(response);
const wl = loadWatchlistSet();
const meta = response.meta as Record<string, any>;

// Aggregate tickers
let mentions = aggregateMentions(tweets);
mentions = mentions.filter(m => m.count >= minMentions);

// Build ticker -> tweets map for raid detection
const tickerTweetMap = new Map<string, Tweet[]>();
for (const m of mentions) {
  const tweetIdSet = new Set(m.tweets);
  tickerTweetMap.set(m.ticker, tweets.filter(t => tweetIdSet.has(t.id)));
}

const raidSignals = detectRaids(tickerTweetMap, wl);

if (jsonMode) {
  console.log(JSON.stringify({ mentions, raidSignals }, null, 2));
} else {
  const window = (meta.window as string) || (meta.kind as string) || "6h";
  const output = formatTrending(mentions, raidSignals, {
    window,
    cached: !!meta.cached,
    rawCount: (meta.raw_count as number) || tweets.length,
  });
  console.log(output);
}

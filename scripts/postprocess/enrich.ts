#!/usr/bin/env bun
/**
 * enrich — TweetRank scoring + source labels + confidence.
 *
 * Pipe a hosted API response to add credibility scoring and trust labels
 * to every tweet. Outputs enriched JSON to stdout.
 *
 * Usage:
 *   curl .../x402/search/20?q=... | bun run scripts/postprocess/enrich.ts
 *   curl .../x402/trending/solana | bun run scripts/postprocess/enrich.ts
 *
 * Output shape:
 *   { data: RankedTweet[], meta: { ...original, confidence }, usage }
 */

import { readStdin, toTweets } from "./read-stdin";
import { loadWatchlistSet } from "./watchlist";
import { rankTweets, computeConfidence } from "../../lib/tweetrank";

const response = await readStdin();
const tweets = toTweets(response);
const wl = loadWatchlistSet();

const ranked = rankTweets(tweets, wl);
const confidence = computeConfidence(ranked);

const output = {
  data: ranked,
  meta: { ...response.meta, confidence },
  usage: response.usage,
};

console.log(JSON.stringify(output, null, 2));

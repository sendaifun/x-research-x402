#!/usr/bin/env bun
/**
 * detect-raids — Coordinated raid detection.
 *
 * Groups tweets by ticker, computes author credibility, and flags tickers
 * where >70% of mentions come from low-credibility accounts.
 *
 * Usage:
 *   curl .../x402/trending/solana | bun run scripts/postprocess/detect-raids.ts
 *   curl .../x402/search/100?q=... | bun run scripts/postprocess/detect-raids.ts
 *
 * Flags:
 *   --json    Output raw JSON (default: formatted summary)
 */

import { readStdin, toTweets } from "./read-stdin";
import { loadWatchlistSet } from "./watchlist";
import { aggregateMentions } from "../../lib/extract";
import { detectRaids } from "../../lib/tweetrank";
import type { Tweet } from "../../lib/api";

const jsonMode = process.argv.includes("--json");
const response = await readStdin();
const tweets = toTweets(response);
const wl = loadWatchlistSet();

// Build ticker -> tweets map from aggregated mentions
const mentions = aggregateMentions(tweets);
const tickerTweetMap = new Map<string, Tweet[]>();
for (const m of mentions) {
  const tweetIdSet = new Set(m.tweets);
  tickerTweetMap.set(m.ticker, tweets.filter(t => tweetIdSet.has(t.id)));
}

const raidSignals = detectRaids(tickerTweetMap, wl);

if (jsonMode) {
  console.log(JSON.stringify(raidSignals, null, 2));
} else {
  const flagged = raidSignals.filter(r => r.flagged);
  const suspicious = raidSignals.filter(r => !r.flagged && r.raidScore > 0.4);

  if (flagged.length === 0 && suspicious.length === 0) {
    console.log("No raid signals detected.");
    process.exit(0);
  }

  if (flagged.length > 0) {
    console.log("### ⚠️ Flagged Raids\n");
    for (const r of flagged) {
      console.log(`- **${r.ticker}** — raid score ${(r.raidScore * 100).toFixed(0)}% · ${r.lowCredAuthors}/${r.totalAuthors} low-cred authors · ${r.uniqueCredAuthors} credible`);
    }
  }

  if (suspicious.length > 0) {
    console.log("\n### Suspicious (watch closely)\n");
    for (const r of suspicious) {
      console.log(`- **${r.ticker}** — raid score ${(r.raidScore * 100).toFixed(0)}% · ${r.lowCredAuthors}/${r.totalAuthors} low-cred authors`);
    }
  }
}

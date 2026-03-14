#!/usr/bin/env bun
/**
 * extract-tickers — Multi-signal ticker extraction and aggregation.
 *
 * Equivalent of CLI --extract-tickers. Extracts $CASHTAGS, name-phrases,
 * crypto URLs, and contract addresses, then aggregates by ticker.
 *
 * Usage:
 *   curl .../x402/search/20?q=... | bun run scripts/postprocess/extract-tickers.ts
 *   curl .../x402/trending/solana | bun run scripts/postprocess/extract-tickers.ts
 *
 * Flags:
 *   --json    Output raw JSON (default: formatted table)
 */

import { readStdin, toTweets } from "./read-stdin";
import { aggregateMentions } from "../../lib/extract";

const jsonMode = process.argv.includes("--json");
const response = await readStdin();
const tweets = toTweets(response);
const mentions = aggregateMentions(tweets);

if (jsonMode) {
  console.log(JSON.stringify(mentions, null, 2));
} else {
  if (mentions.length === 0) {
    console.log("No tickers detected.");
    process.exit(0);
  }

  console.log("### Extracted Tickers\n");
  for (const m of mentions.slice(0, 25)) {
    const sourceTypes = m.sources.map(s => `${s.type}(${s.count})`).join(", ");
    console.log(`- **${m.ticker}** — ${m.count} mentions, ${m.uniqueAuthors} unique authors — via ${sourceTypes}`);
  }
}

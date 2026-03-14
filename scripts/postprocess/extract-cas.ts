#!/usr/bin/env bun
/**
 * extract-cas — Contract address and crypto URL extraction.
 *
 * Equivalent of CLI --extract-cas. Extracts Solana/ETH contract addresses
 * with context-window scoring and crypto URLs (pump.fun, dexscreener, etc.).
 *
 * Usage:
 *   curl .../x402/search/20?q=... | bun run scripts/postprocess/extract-cas.ts
 *
 * Flags:
 *   --json    Output raw JSON (default: formatted table)
 */

import { readStdin, toTweets } from "./read-stdin";
import { extractContractAddresses, extractCryptoUrls } from "../../lib/extract";
import { formatContractAddresses, formatCryptoUrls } from "../../lib/format";

const jsonMode = process.argv.includes("--json");
const response = await readStdin();
const tweets = toTweets(response);

const allCas = tweets.flatMap(t => extractContractAddresses(t.text));
const allUrls = tweets.flatMap(t => extractCryptoUrls(t.urls));

if (jsonMode) {
  console.log(JSON.stringify({ addresses: allCas, urls: allUrls }, null, 2));
} else {
  if (allCas.length === 0 && allUrls.length === 0) {
    console.log("No contract addresses or crypto URLs found.");
    process.exit(0);
  }
  if (allCas.length > 0) console.log(formatContractAddresses(allCas));
  if (allUrls.length > 0) console.log(formatCryptoUrls(allUrls));
}

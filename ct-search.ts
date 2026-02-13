#!/usr/bin/env bun

/**
 * ct-search: Crypto Twitter intelligence CLI
 *
 * Usage:
 *   bun run ct-search.ts search "<query>" [flags]
 *   bun run ct-search.ts trending [flags]
 *   bun run ct-search.ts watchlist [flags]
 *   bun run ct-search.ts thread <tweet_id>
 *   bun run ct-search.ts cost [--reset]
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { searchRecent, sortTweets, dedupe, getThread, getProfile, type Tweet } from "./lib/api";
import * as cache from "./lib/cache";
import { appendNoiseFilters, applyEngagementFilter } from "./lib/filters";
import { rankTweets, detectRaids, computeTrendingScore, type RankedTweet } from "./lib/tweetrank";
import { extractTickers, extractCryptoUrls, extractContractAddresses, aggregateMentions, extractAllSignals } from "./lib/extract";
import { formatSearchResults, formatTrending, formatContractAddresses, formatCryptoUrls, formatWatchlist, formatThread } from "./lib/format";
import { getSummary, reset as resetCost, estimateCost } from "./lib/cost";

// --- Arg Parsing ---

function parseArgs(argv: string[]): { command: string; positional: string[]; flags: Record<string, string | boolean> } {
  const args = argv.slice(2); // Remove 'bun' and script path
  const command = args[0] || "help";
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  return { command, positional, flags };
}

// --- Load Watchlist ---

interface WatchlistEntry {
  username: string;
  category: string;
}

function loadWatchlist(): WatchlistEntry[] {
  const entries: WatchlistEntry[] = [];
  const dir = join(import.meta.dir, "data");

  // Load default watchlist
  for (const file of ["watchlist.default.json", "watchlist.json"]) {
    const fp = join(dir, file);
    if (!existsSync(fp)) continue;
    try {
      const data = JSON.parse(readFileSync(fp, "utf-8"));
      if (data.categories) {
        for (const [cat, info] of Object.entries(data.categories) as [string, any][]) {
          for (const account of info.accounts || []) {
            const username = typeof account === "string" ? account : account.username;
            if (username) entries.push({ username: username.toLowerCase().replace("@", ""), category: cat });
          }
        }
      }
    } catch {}
  }

  return entries;
}

function watchlistSet(): Set<string> {
  return new Set(loadWatchlist().map(e => e.username));
}

// --- Commands ---

async function cmdSearch(positional: string[], flags: Record<string, string | boolean>) {
  const query = positional[0];
  if (!query) {
    console.error("Usage: ct-search search \"<query>\" [--quick|--full] [--sort likes|recency|relevancy] [--since 24h] [--min-likes N] [--from user1,user2] [--extract-tickers] [--extract-cas]");
    process.exit(1);
  }

  const isQuick = !flags.full;
  const sort = (flags.sort as string) || "relevancy";
  const since = (flags.since as string) || "24h";
  const minLikes = flags["min-likes"] ? parseInt(flags["min-likes"] as string) : (isQuick ? 3 : 0);
  const from = flags.from as string;
  const extractTickersFlag = !!flags["extract-tickers"];
  const extractCasFlag = !!flags["extract-cas"];
  const rawOutput = !!flags.raw;

  // Build query with noise filters
  let fullQuery = query;
  if (from) {
    const users = from.split(",").map(u => `from:${u.trim().replace("@", "")}`);
    fullQuery = `(${fullQuery}) (${users.join(" OR ")})`;
  }
  fullQuery = appendNoiseFilters(fullQuery, isQuick);
  if (!fullQuery.includes("lang:")) fullQuery += " lang:en";

  // Search
  const maxPages = isQuick ? 1 : parseInt(flags.pages as string) || 3;
  const result = await searchRecent(fullQuery, {
    sort: sort as "recency" | "relevancy",
    since,
    maxPages,
    maxResults: 100,
  });

  // Apply engagement filter
  let tweets = applyEngagementFilter(result.tweets, { minLikes });

  // Rank with TweetRank
  const wl = watchlistSet();
  const ranked = rankTweets(tweets, wl);

  // Output
  if (rawOutput) {
    console.log(JSON.stringify(ranked, null, 2));
    return;
  }

  console.log(formatSearchResults(ranked, {
    query,
    rawCount: result.rawCount,
    cached: result.cached,
    since,
  }));

  // Ticker extraction
  if (extractTickersFlag) {
    const mentions = aggregateMentions(result.tweets);
    if (mentions.length > 0) {
      console.log("\n### Extracted Tickers");
      for (const m of mentions.slice(0, 15)) {
        const sourceTypes = m.sources.map(s => s.type).join(", ");
        console.log(`- **${m.ticker}** (${m.count} mentions, ${m.uniqueAuthors} authors) via ${sourceTypes}`);
      }
    }
  }

  // CA extraction
  if (extractCasFlag) {
    const allCas: ReturnType<typeof extractContractAddresses> = [];
    const allUrls: ReturnType<typeof extractCryptoUrls> = [];
    for (const t of result.tweets) {
      allCas.push(...extractContractAddresses(t.text));
      allUrls.push(...extractCryptoUrls(t.urls));
    }
    if (allCas.length > 0) console.log(formatContractAddresses(allCas));
    if (allUrls.length > 0) console.log(formatCryptoUrls(allUrls));
  }
}

async function cmdTrending(flags: Record<string, string | boolean>) {
  const window = (flags.window as string) || "6h";
  const minMentions = flags["min-mentions"] ? parseInt(flags["min-mentions"] as string) : 3;
  const solanaOnly = !!flags["solana-only"];
  const top = flags.top ? parseInt(flags.top as string) : 20;

  // Search for cashtags and crypto terms in recent window
  const queries = [
    `$ -is:retweet lang:en`,
    `(pump.fun OR dexscreener OR birdeye) -is:retweet lang:en`,
  ];

  let allTweets: Tweet[] = [];
  let totalRaw = 0;
  let anyCached = false;

  for (const q of queries) {
    const result = await searchRecent(q, { since: window, maxPages: 1, sort: "recency" });
    allTweets.push(...result.tweets);
    totalRaw += result.rawCount;
    if (result.cached) anyCached = true;
  }

  allTweets = dedupe(allTweets);

  // Aggregate mentions using multi-signal extraction
  let mentions = aggregateMentions(allTweets);

  // Filter
  mentions = mentions.filter(m => m.count >= minMentions);
  if (solanaOnly) {
    // Keep tickers commonly associated with Solana (heuristic)
    // This is imperfect but catches obvious non-Solana tokens
    mentions = mentions.filter(m => {
      const nonSol = ["BTC", "ETH", "BNB", "XRP", "ADA", "DOT", "AVAX", "MATIC", "ATOM"];
      return !nonSol.includes(m.ticker);
    });
  }
  mentions = mentions.slice(0, top);

  // Raid detection
  const wl = watchlistSet();
  const tickerTweetMap = new Map<string, Tweet[]>();
  for (const m of mentions) {
    const matchingTweets = allTweets.filter(t => m.tweets.includes(t.id));
    tickerTweetMap.set(m.ticker, matchingTweets);
  }
  const raidSignals = detectRaids(tickerTweetMap, wl);

  console.log(formatTrending(mentions, raidSignals, {
    window,
    cached: anyCached,
    rawCount: totalRaw,
  }));
}

async function cmdWatchlist(flags: Record<string, string | boolean>) {
  const since = (flags.since as string) || "24h";
  const category = flags.category as string;
  const summary = !!flags.summary;

  const entries = loadWatchlist();
  if (entries.length === 0) {
    console.error("No watchlist accounts found. Run setup or add accounts to data/watchlist.json");
    process.exit(1);
  }

  // Filter by category if specified
  const filtered = category
    ? entries.filter(e => e.category.toLowerCase() === category.toLowerCase())
    : entries;

  if (filtered.length === 0) {
    console.error(`No accounts in category "${category}". Available: ${[...new Set(entries.map(e => e.category))].join(", ")}`);
    process.exit(1);
  }

  // Smart batching by query length (X API has 1024 char limit)
  const MAX_QUERY_LEN = 900; // Leave room for operators
  const batches: string[][] = [];
  let currentBatch: string[] = [];
  let currentLen = 0;

  for (const entry of filtered) {
    const fromOp = `from:${entry.username}`;
    const addLen = fromOp.length + 4; // " OR " separator
    if (currentLen + addLen > MAX_QUERY_LEN && currentBatch.length > 0) {
      batches.push(currentBatch);
      currentBatch = [];
      currentLen = 0;
    }
    currentBatch.push(entry.username);
    currentLen += addLen;
  }
  if (currentBatch.length > 0) batches.push(currentBatch);

  // Fetch per batch
  const categoryTweets = new Map<string, RankedTweet[]>();
  let totalRaw = 0;
  let anyCached = false;
  const wl = watchlistSet();

  for (const batch of batches) {
    const fromParts = batch.map(u => `from:${u}`).join(" OR ");
    const query = `(${fromParts}) -is:retweet lang:en`;

    const result = await searchRecent(query, { since, maxPages: 1, sort: "recency" });
    totalRaw += result.rawCount;
    if (result.cached) anyCached = true;

    // Categorize tweets
    const ranked = rankTweets(result.tweets, wl);
    for (const tweet of ranked) {
      const entry = filtered.find(e => e.username === tweet.author.username.toLowerCase());
      const cat = entry?.category || "uncategorized";
      if (!categoryTweets.has(cat)) categoryTweets.set(cat, []);
      categoryTweets.get(cat)!.push(tweet);
    }
  }

  console.log(formatWatchlist(categoryTweets, { since, cached: anyCached, rawCount: totalRaw }));
}

async function cmdThread(positional: string[]) {
  const tweetId = positional[0];
  if (!tweetId) {
    console.error("Usage: ct-search thread <tweet_id>");
    process.exit(1);
  }

  const result = await getThread(tweetId);
  const wl = watchlistSet();
  const ranked = rankTweets(result.tweets, wl);

  console.log(formatThread(ranked, result.partial, result.cached));
}

async function cmdCost(flags: Record<string, string | boolean>) {
  if (flags.reset) {
    resetCost();
    cache.clear();
    console.log("Cost tracking and cache cleared.");
    return;
  }

  console.log(getSummary());
  const cacheStats = cache.stats();
  console.log(`\n📦 Cache: ${cacheStats.entries} entries (${cacheStats.totalSizeKb}KB)`);
}

function cmdHelp() {
  console.log(`
ct-search: Crypto Twitter intelligence CLI

Commands:
  search "<query>" [flags]   Search CT with TweetRank scoring
    --quick                  1 page, 100 tweets max, 1hr cache (default)
    --full                   Up to 3 pages, 15min cache
    --sort <field>           Sort: likes, retweets, recency, relevancy (default: relevancy)
    --since <duration>       Time window: 1h, 6h, 24h, 7d (default: 24h)
    --min-likes <n>          Min likes filter (default: 3 for quick)
    --from <users>           Comma-separated usernames to restrict
    --extract-tickers        Show extracted tickers from results
    --extract-cas            Show extracted contract addresses and crypto URLs
    --raw                    Output raw JSON

  trending [flags]           Detect trending tokens (multi-signal + raid detection)
    --window <duration>      Comparison window: 1h, 6h, 24h (default: 6h)
    --min-mentions <n>       Min mention count (default: 3)
    --solana-only            Only Solana ecosystem tokens
    --top <n>                Top N results (default: 20)

  watchlist [flags]          Monitor watchlist accounts
    --category <cat>         Filter by category
    --since <duration>       Time window (default: 24h)
    --summary                Narrative summary mode

  thread <tweet_id>          Hydrate a full conversation thread

  cost [--reset]             Show API credit usage (--reset clears all)

Environment:
  X_BEARER_TOKEN             Required. Set as env var or in ~/.config/env/global.env

Cost: ~$0.50 per quick search (100 tweets × $0.005). Always starts in quick mode.
`);
}

// --- Main ---

async function main() {
  // Prune cache on startup
  cache.prune();

  const { command, positional, flags } = parseArgs(process.argv);

  try {
    switch (command) {
      case "search":
        await cmdSearch(positional, flags);
        break;
      case "trending":
        await cmdTrending(flags);
        break;
      case "watchlist":
        await cmdWatchlist(flags);
        break;
      case "thread":
        await cmdThread(positional);
        break;
      case "cost":
        await cmdCost(flags);
        break;
      case "help":
      case "--help":
      case "-h":
        cmdHelp();
        break;
      default:
        console.error(`Unknown command: ${command}. Run with "help" for usage.`);
        process.exit(1);
    }
  } catch (err: any) {
    console.error(`\n❌ Error: ${err.message}`);
    if (err.message.includes("Rate limited")) {
      console.error("   Wait for the rate limit to reset, or use cached results.");
    }
    if (err.message.includes("X_BEARER_TOKEN")) {
      console.error("   Run 'bun run setup.ts' to configure your API token.");
    }
    process.exit(1);
  }
}

main();

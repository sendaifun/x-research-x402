---
name: ct-alpha
description: >
  Crypto Twitter intelligence and alpha research agent. Searches X/Twitter for
  real-time crypto narratives, trending tokens, yield strategies, smart money signals,
  and protocol research. Features TweetRank (PageRank-inspired credibility scoring),
  multi-signal token detection (cashtags + name-phrases + crypto URLs + contract addresses),
  coordinated raid detection, X article (long-form post) support, and dynamic tool
  discovery for execution suggestions.
  Use when: (1) user says "ct alpha", "what's CT saying", "trending on crypto twitter",
  "find alpha on", "search CT for", "what are people saying about [token]",
  "crypto twitter research", "/ct-alpha", "what's hot in crypto", "CT sentiment",
  (2) user wants to research crypto narratives, tokens, protocols, yield strategies,
  or market sentiment using Twitter/X data,
  (3) user wants to find trending tokens, new narratives, or smart money signals,
  (4) user asks about any specific token, protocol, or crypto topic and wants CT perspective.
  NOT for: posting tweets, account management, or non-crypto research.
  Solana-first but covers all major chains. X API is pay-per-use ($0.005/tweet) —
  always minimize API calls.
---

# CT Alpha — Crypto Twitter Intelligence

## Overview

CT Alpha turns X/Twitter into an actionable crypto intelligence layer. It searches CT for narratives, alpha, strategies, and sentiment, then ranks results using TweetRank (a PageRank-inspired credibility scoring system), extracts tokens/CAs from multiple signals, detects coordinated raids, fetches full X articles (long-form posts), and suggests execution steps using whatever tools the user has available.

**Cost awareness**: X API charges ~$0.10 per quick search (20 tweets). Relevancy sort means top results come first — fetching 20 is often better signal than 100. Always start with `--quick` mode. Never run expensive queries without user confirmation.

## Environment Setup

Before using ct-search, ensure the token is available:

```bash
source ~/.config/env/global.env 2>/dev/null
```

If setup hasn't been run yet:
```bash
bun run ~/ct-alpha/setup.ts
```

The skill directory is at `~/ct-alpha/`. All CLI commands run from there.

## CLI Reference

### search — Core research command
```bash
source ~/.config/env/global.env 2>/dev/null && bun run ~/ct-alpha/ct-search.ts search "<query>" [flags]
```

Flags:
- `--quick` — 20 tweets, 1hr cache, ~$0.10 (DEFAULT — always use this first)
- `--full` — Up to 3 pages, 15min cache, ~$0.50-1.50 (confirm cost with user first)
- `--limit N` — Override max tweets (default: 20 quick, 100 full)
- `--sort likes|recency|relevancy` — Sort order (default: relevancy)
- `--since 1h|6h|24h|7d` — Time window (default: 24h)
- `--min-likes N` — Engagement filter (default: 3 for quick)
- `--from user1,user2` — Restrict to specific accounts
- `--extract-tickers` — Show extracted tickers from results
- `--extract-cas` — Show contract addresses and crypto URLs
- `--raw` — JSON output

### trending — Multi-signal trending detection
```bash
source ~/.config/env/global.env 2>/dev/null && bun run ~/ct-alpha/ct-search.ts trending [flags]
```

Flags:
- `--window 1h|6h|24h` — Detection window (default: 6h)
- `--min-mentions N` — Minimum mentions (default: 3)
- `--solana-only` — Solana ecosystem only
- `--top N` — Number of results (default: 20)

### watchlist — Monitor CT accounts
```bash
source ~/.config/env/global.env 2>/dev/null && bun run ~/ct-alpha/ct-search.ts watchlist [flags]
```

Flags:
- `--category <cat>` — Filter by category (solana-builders, defi-researchers, etc.)
- `--since 1h|6h|24h|7d` — Time window (default: 24h)

### read — Read a specific tweet/article by URL or ID (~$0.005)
```bash
source ~/.config/env/global.env 2>/dev/null && bun run ~/ct-alpha/ct-search.ts read <tweet_url_or_id> [flags]
```

Flags:
- `--thread` — Also load the full conversation thread (replies)
- `--raw` — JSON output

Accepts x.com URLs, twitter.com URLs, or raw tweet IDs. Articles (long-form posts) are fetched in full. Uses full-archive search for threads (no 7-day limit).

### thread — Hydrate conversation thread
```bash
source ~/.config/env/global.env 2>/dev/null && bun run ~/ct-alpha/ct-search.ts thread <tweet_id>
```

### cost — Track API spending
```bash
source ~/.config/env/global.env 2>/dev/null && bun run ~/ct-alpha/ct-search.ts cost [--reset]
```

## Research Methodology

Follow this 6-step loop for every research request:

### 1. Decompose
Break the user's question into 1-3 targeted search queries.
- For token research: search both `$TICKER` and plain name with OR (e.g., `"$PENDLE" OR "pendle"`)
- For narratives: search thematic keywords, not just token names
- For strategies: include strategy/yield/APY keywords
- For sentiment: include bullish/bearish/buy/sell keywords

### 2. Pre-Filter
Before making any API call:
- **Check cache**: Run `--quick` first. If cached results exist, analyze those.
- **Add noise filters**: The CLI auto-appends crypto noise filters (-is:retweet, -airdrop, -giveaway, etc.)
- **Estimate cost**: Quick = ~$0.10, Full = ~$0.50-1.50. Tell user before full mode.
- **Narrow time window**: Default 24h for trending, 7d for research.

### 3. Search
Execute with `--quick` mode (always the first pass):
```bash
source ~/.config/env/global.env 2>/dev/null && bun run ~/ct-alpha/ct-search.ts search "$TOKEN alpha" --quick --extract-tickers
```

**CRITICAL: Query string rules**
- The query argument should contain ONLY search terms, boolean logic (`OR`, `-`, `"phrases"`), and v2 operators (`from:`, `is:retweet`, `has:links`, `lang:`, `conversation_id:`, `$cashtag`, `#hashtag`)
- **NEVER put these v1.1 operators in the query string — they do NOT exist on v2 pay-per-use and will cause 400 errors:**
  - `min_faves:N`, `min_retweets:N`, `min_replies:N` — use `--min-likes` CLI flag instead (filters client-side)
  - `place:`, `place_country:`, `point_radius:` — geo operators not available
  - `bio:`, `bio_name:`, `bio_location:` — profile operators not available
  - `sample:` — sampling not available
- **Do NOT manually include noise filters** (`-is:retweet`, `-"airdrop"`, etc.) in your query — the CLI auto-appends them
- **Do NOT use `&` in query strings** — it breaks X API v2 query parsing

### 4. Extract
Results include TweetRank scores and trust labels:
- `[WATCHLIST]` — Author is on user's watchlist (highest trust)
- `[HIGH-CRED]` — Author has high credibility score
- `[UNKNOWN]` — Unverified author
- `[SUSPICIOUS]` — Bot-like patterns detected
- `ARTICLE` — Long-form X post (full text captured)

Look for extracted tickers, contract addresses, and crypto URLs.

### 5. Deep-Dive (if needed)
If initial results are promising:
- Follow high-engagement threads: `bun run ~/ct-alpha/ct-search.ts thread <id>`
- Search specific authors: `--from author1,author2`
- Broaden with `--full` only if quick was insufficient

### 6. Synthesize
Combine findings into actionable intelligence:
- Group by theme, not by query
- Highlight tickers with strong multi-signal detection (cashtag + URL + name-phrase)
- Flag raid risks (high low-cred author ratio)
- Suggest verification and execution steps using available tools
- Cross-reference with DeFi Llama (TVL, yields, fees), Backpack (price, depth), Polymarket (prediction markets)

## Refinement Heuristics

**Too noisy?**
- Add `--min-likes 50` for higher quality
- Narrow time window: `--since 6h`
- Restrict to watchlist: `--from trusted_user1,trusted_user2`

**Too few results?**
- Broaden query: use OR with alternative terms
- Extend window: `--since 7d`
- Remove restrictive keywords
- Lower min-likes: `--min-likes 0`

**Need expert takes?**
- Use `--from` with known analysts from watchlist
- Search with `has:links` for substantive content

**Detecting spam/raids?**
- Check the TweetRank source labels
- Look for RAID flags in trending output
- Low unique-author count = suspicious

## Dynamic Tool Discovery

After completing research, check what other tools the user has available and suggest execution steps. Look for these MCP tool prefixes:

- **mcp__defillama__*** → Check TVL, yields, fees, prices, protocol comparison
- **mcp__backpack__*** → Check exchange price, depth, trades, klines
- **mcp__polymarket__*** → Check prediction markets for related narratives
- **mcp__postgres-mcp__*** → Query on-chain data if available

Common patterns:
- Token found → `get_protocol_tvl`, `get_current_prices`, `backpack_get_ticker`
- CA found → suggest verification on Solscan/Etherscan, rug check if available
- Narrative detected → `search_polymarket` for prediction market odds
- Strategy found → `get_top_yield_pools` for current APYs
- Protocol comparison → `compare_protocols` side by side

**Always frame suggestions as "verify" not "confirm"** — encourage skepticism about CT alpha.

## Output Trust Labels

Every result includes trust metadata. Never present CT findings as authoritative:
- **Confidence**: HIGH (multiple watchlist sources agree) / MED / LOW
- **Source quality**: Per-tweet labels showing author credibility
- **Verification status**: Contract addresses are always UNVERIFIED until tool-checked
- **Risk bullets**: "What could be wrong?" per finding (spoofed engagement, coordinated raid, etc.)

## Cost Protocol

1. **Always `--quick` first** (~$0.10 for 20 tweets). Relevancy sort = best results come first.
2. Only use `--limit 30` or `--limit 50` if 20 results are genuinely insufficient.
3. Display cost estimate before `--full` mode (~$0.50-1.50).
4. Cache is aggressive (1hr for quick mode) — same query is free within TTL.
5. **Two-pass strategy**: First search with 20 results. If the user needs more depth on a specific sub-topic, do a targeted follow-up rather than re-running with higher limits.
6. Show `cost` summary if user asks about spending.

## Recency Defaults

- Trending / narratives: `--since 24h`
- Research / strategies: `--since 7d`
- Older data: Only on explicit user request, never default

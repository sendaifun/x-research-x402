---
name: ct-alpha
description: >
  Crypto Twitter intelligence and alpha research agent. Searches X/Twitter for
  real-time crypto narratives, trending tokens, yield strategies, smart money signals,
  and protocol research. Features TweetRank (PageRank-inspired credibility scoring),
  multi-signal token detection (cashtags + name-phrases + crypto URLs + contract addresses),
  coordinated raid detection, and dynamic tool discovery for execution suggestions.
  Use when: (1) user says "ct alpha", "what's CT saying", "trending on crypto twitter",
  "find alpha on", "search CT for", "what are people saying about [token]",
  "crypto twitter research", "/ct-alpha", (2) user wants to research crypto narratives,
  tokens, protocols, yield strategies, or market sentiment using Twitter/X data,
  (3) user wants to find trending tokens, new narratives, or smart money signals.
  NOT for: posting tweets, account management, or non-crypto research.
  Solana-first but covers all major chains. X API is pay-per-use ($0.005/tweet) —
  always minimize API calls.
---

# CT Alpha — Crypto Twitter Intelligence

## Overview

CT Alpha turns X/Twitter into an actionable crypto intelligence layer. It searches CT for narratives, alpha, strategies, and sentiment, then ranks results using TweetRank (a PageRank-inspired credibility scoring system), extracts tokens/CAs from multiple signals, detects coordinated raids, and suggests execution steps using whatever tools the user has available.

**Cost awareness**: X API charges ~$0.50 per quick search (100 tweets). Always start with `--quick` mode. Never run expensive queries without user confirmation.

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
bun run ~/ct-alpha/ct-search.ts search "<query>" [flags]
```

Flags:
- `--quick` — 1 page, 100 tweets max, 1hr cache (DEFAULT — always use this first)
- `--full` — Up to 3 pages, 15min cache (confirm cost with user first)
- `--sort likes|recency|relevancy` — Sort order (default: relevancy)
- `--since 1h|6h|24h|7d` — Time window (default: 24h)
- `--min-likes N` — Engagement filter (default: 3 for quick)
- `--from user1,user2` — Restrict to specific accounts
- `--extract-tickers` — Show extracted tickers from results
- `--extract-cas` — Show contract addresses and crypto URLs
- `--raw` — JSON output

### trending — Multi-signal trending detection
```bash
bun run ~/ct-alpha/ct-search.ts trending [flags]
```

Flags:
- `--window 1h|6h|24h` — Detection window (default: 6h)
- `--min-mentions N` — Minimum mentions (default: 3)
- `--solana-only` — Solana ecosystem only
- `--top N` — Number of results (default: 20)

### watchlist — Monitor CT accounts
```bash
bun run ~/ct-alpha/ct-search.ts watchlist [flags]
```

Flags:
- `--category <cat>` — Filter by category (solana-builders, defi-researchers, etc.)
- `--since 1h|6h|24h|7d` — Time window (default: 24h)

### thread — Hydrate conversation thread
```bash
bun run ~/ct-alpha/ct-search.ts thread <tweet_id>
```

### cost — Track API spending
```bash
bun run ~/ct-alpha/ct-search.ts cost [--reset]
```

## Research Methodology

Follow this 6-step loop for every research request:

### 1. Decompose
Break the user's question into 1-3 targeted search queries.
- Use query templates from `references/query-templates.md`
- For token research: search both `$TICKER` and plain name with OR
- For narratives: search thematic keywords, not just token names

### 2. Pre-Filter
Before making any API call:
- **Check cache**: Run `--quick` first. If cached results exist, analyze those.
- **Add noise filters**: The CLI auto-appends crypto noise filters.
- **Estimate cost**: Quick = ~$0.50, Full = ~$1.50. Tell user before full mode.
- **Narrow time window**: Default 24h for trending, 7d for research.

### 3. Search
Execute with `--quick` mode (always the first pass):
```bash
bun run ~/ct-alpha/ct-search.ts search "$TOKEN alpha" --quick --extract-tickers
```

### 4. Extract
Results include TweetRank scores and trust labels:
- `[WATCHLIST]` — Author is on user's watchlist (highest trust)
- `[HIGH-CRED]` — Author has high credibility score
- `[UNKNOWN]` — Unverified author
- `[SUSPICIOUS]` — Bot-like patterns detected

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

## Refinement Heuristics

**Too noisy?**
- Add `--min-likes 50` for higher quality
- Narrow time window: `--since 6h`
- Restrict to watchlist: `--from trusted_user1,trusted_user2`

**Too few results?**
- Broaden query: use OR with alternative terms
- Extend window: `--since 7d`
- Remove restrictive keywords

**Need expert takes?**
- Use `--from` with known analysts from watchlist
- Search with `has:links` for substantive content

**Detecting spam/raids?**
- Check the TweetRank source labels
- Look for `⚠️ RAID` flags in trending output
- Low unique-author count = suspicious

## Dynamic Tool Discovery

After completing research, check what other tools the user has available and suggest execution steps. See `references/tool-discovery.md` for the full mapping.

Common patterns:
- Token found → check TVL/price via DeFi Llama, check exchange depth via Backpack
- CA found → suggest verification on Solscan/Etherscan, rug check if available
- Narrative detected → check related prediction markets via Polymarket
- Strategy found → check current yields via DeFi Llama yield pools

**Always frame suggestions as "verify" not "confirm"** — encourage skepticism about CT alpha.

## Output Trust Labels

Every result includes trust metadata. Never present CT findings as authoritative:
- **Confidence**: HIGH (multiple watchlist sources agree) / MED / LOW
- **Source quality**: Per-tweet labels showing author credibility
- **Verification status**: Contract addresses are always UNVERIFIED until tool-checked
- **Risk bullets**: "What could be wrong?" per finding (spoofed engagement, coordinated raid, etc.)

## Cost Protocol

1. **Always `--quick` first** (~$0.50)
2. Display cost estimate before `--full` mode (~$1.50+)
3. Watchlist scans can be expensive with many accounts — warn user
4. Cache is aggressive (1hr for quick mode) — same query is free within TTL
5. Show `cost` summary if user asks about spending

## Recency Defaults

- Trending / narratives: `--since 24h`
- Research / strategies: `--since 7d`
- Older data: Only on explicit user request, never default

# ct-alpha

Crypto Twitter intelligence skill for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Turns X/Twitter into a structured research layer for crypto narratives, tokens, and strategies.

## What it does

- **TweetRank** — PageRank-inspired credibility scoring. Weights bookmarks > quotes > likes > retweets. Detects coordinated shill raids.
- **Multi-signal token detection** — Cashtags, plain name phrases, pump.fun/dexscreener URLs, contract addresses with context-window scoring.
- **X article support** — Full text extraction for long-form posts (>280 chars) at no extra API cost.
- **Tool discovery** — Suggests follow-up actions using available MCP tools (DeFi Llama, Backpack, Polymarket).
- **Cost-optimized** — Quick mode default (~$0.10/search, 20 tweets), aggressive caching, auto noise filters.

## Install

```bash
# Recommended: installs skill + symlinks to Claude Code, Cursor, Codex, etc.
npx skills add yashhsm/ct-alpha -g

# Or: one-liner (clones repo + interactive setup)
curl -fsSL https://raw.githubusercontent.com/yashhsm/ct-alpha/main/install.sh | bash

# Or: manual
git clone https://github.com/yashhsm/ct-alpha.git ~/ct-alpha
cd ~/ct-alpha && bun run install.ts
```

X API Bearer Token is prompted on first CLI run if not set. No separate setup step needed.

## Usage

### Claude Code (auto-routed via skill)
```
"what's CT saying about Pendle?"
"trending tokens on Solana"
"find yield strategies for JTO"
```

### CLI
```bash
# Search
bun run ct-search.ts search "$SOL alpha" --quick --extract-tickers

# Trending tokens
bun run ct-search.ts trending --window 6h --solana-only

# Monitor watchlist
bun run ct-search.ts watchlist --since 24h

# Thread hydration
bun run ct-search.ts thread <tweet_id>

# API spend
bun run ct-search.ts cost
```

## Cost

X API charges $0.005/tweet via xAI pay-per-use.

| Operation | Tweets | Cost |
|---|---|---|
| Quick search (default) | 20 | ~$0.10 |
| Full search (`--full`) | up to 100 | ~$0.50 |
| Trending scan | 2-3 queries x 30 | ~$0.30-0.45 |

Quick mode is always default. Cost displayed after every operation.

## Architecture

```
ct-search.ts          CLI entry point + inline token onboarding
lib/
  api.ts              X API v2 wrapper (search, threads, profiles)
  tweetrank.ts        Credibility scoring + raid detection
  extract.ts          Multi-signal extraction (tickers, CAs, URLs, name-phrases)
  filters.ts          Crypto noise filters + engagement thresholds
  cache.ts            File-based MD5 caching with TTL tiers
  cost.ts             Credit tracking
  format.ts           Structured output with trust labels
data/
  watchlist.default.json   Default CT accounts (shipped)
  known-tokens.json        Token name-to-ticker mappings
SKILL.md              Skill definition (skills.sh compatible)
install.ts            Interactive installer
install.sh            One-line shell installer
```

## Requirements

- [Bun](https://bun.sh) v1.0+
- X API Bearer Token ([developer.x.com](https://developer.x.com), pay-per-use via xAI)

# CT Alpha

Crypto Twitter intelligence skill for Claude Code. Turns X/Twitter into an actionable research layer for crypto investment decisions.

## Features

- **TweetRank**: PageRank-inspired credibility scoring. Weights bookmarks (unfakeable) over likes (bottable). Detects coordinated shill raids.
- **Multi-signal token detection**: Catches tokens via cashtags, plain names, pump.fun/dexscreener URLs, and contract addresses.
- **Smart CA extraction**: Context-window scoring reduces false positives. Labels everything UNVERIFIED.
- **Dynamic tool discovery**: Suggests follow-up actions using whatever MCP tools you have (DeFi Llama, Backpack, Polymarket, etc.).
- **Cost-optimized**: Quick mode default (~$0.50/search), aggressive caching, auto noise filters.

## Install

```bash
# Clone to your skills directory
git clone https://github.com/<owner>/ct-alpha.git ~/.claude/skills/ct-alpha

# Or clone anywhere and symlink
git clone https://github.com/<owner>/ct-alpha.git ~/ct-alpha
ln -s ~/ct-alpha ~/.claude/skills/ct-alpha
```

## Setup

```bash
cd ~/ct-alpha  # or ~/.claude/skills/ct-alpha
bun run setup.ts
```

This will:
1. Check for Bun and X API credentials
2. Prompt for your `X_BEARER_TOKEN` if not set
3. Ask for 3 favorite CT accounts to seed your watchlist

### Manual credential setup

```bash
mkdir -p ~/.config/env
echo 'export X_BEARER_TOKEN="your_token_here"' >> ~/.config/env/global.env
```

Get your token from [X Developer Portal](https://developer.x.com) (pay-per-use via xAI).

## Usage

### In Claude Code
```
/ct-alpha what's CT saying about Pendle?
/ct-alpha trending tokens on Solana
/ct-alpha find yield strategies for JTO
```

### Direct CLI
```bash
# Search
bun run ct-search.ts search "$SOL alpha" --quick --extract-tickers

# Trending tokens
bun run ct-search.ts trending --window 6h --solana-only

# Monitor watchlist
bun run ct-search.ts watchlist --since 24h

# Thread hydration
bun run ct-search.ts thread 1234567890

# Check API spending
bun run ct-search.ts cost
```

## Cost

X API charges $0.005 per tweet read via xAI pay-per-use.

| Operation | Est. Cost |
|-----------|-----------|
| Quick search (100 tweets) | ~$0.50 |
| Full search (300 tweets) | ~$1.50 |
| Trending scan | ~$1.00 |
| Watchlist (50 accounts) | ~$2.50 |

Quick mode is always the default. The CLI displays cost after every operation.

## Requirements

- [Bun](https://bun.sh) (v1.0+)
- X API Bearer Token (xAI pay-per-use)

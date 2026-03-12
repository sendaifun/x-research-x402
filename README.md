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
npx skills add sendaifun/ct-alpha -g

# Or: one-liner (clones repo + interactive setup)
curl -fsSL https://raw.githubusercontent.com/sendaifun/ct-alpha/main/install.sh | bash

# Or: manual
git clone https://github.com/sendaifun/ct-alpha.git ~/ct-alpha
cd ~/ct-alpha && bun run install.ts
```

X API Bearer Token is prompted on first CLI run if not set. No separate setup step needed.

## X API Setup (5 min)

ct-alpha uses the X API v2 pay-per-use model — no monthly subscription, you only pay for tweets fetched. **Recommended starting credits: $50** (enough for ~500 searches in quick mode).

### Step 1: Create a developer account

1. Go to [console.x.com](https://console.x.com) and log in with your X account
2. Accept the Developer Agreement and Policy
3. Describe your use case (e.g. "Crypto market research and sentiment analysis")

### Step 2: Create an app

1. From the dashboard, click **Create App** (or "Create Project" → "Add App")
2. Give it a name (e.g. `ct-alpha`)
3. Your credentials will be generated automatically

### Step 3: Copy your Bearer Token

1. In your app settings, go to **Keys and Tokens**
2. Find the **Bearer Token** and copy it
3. **Save it somewhere safe** — it's only shown once (you can regenerate if lost)

### Step 4: Add credits

1. In the Developer Console, go to **Billing**
2. Add a payment method
3. Purchase **$50 in credits** ([pricing details](https://docs.x.com/x-api/fundamentals/post-cap#usage-and-billing))
4. Credits are deducted per tweet fetched (~$0.005/tweet). Same tweet fetched twice in 24h is only charged once.

### Step 5: Configure ct-alpha

The installer will prompt for your token automatically. Or set it manually:

```bash
mkdir -p ~/.config/env
echo 'export X_BEARER_TOKEN="YOUR_TOKEN_HERE"' >> ~/.config/env/global.env
```

That's it — you're ready to search CT.

## Usage

### Claude Code (auto-routed via skill)
```
"what's CT saying about Pendle?"
"trending tokens on Solana"
"find yield strategies for JTO"
```

### CLI
```bash
# Read a tweet/article by URL ($0.005)
bun run ct-search.ts read https://x.com/user/status/123

# Read with full thread + replies
bun run ct-search.ts read https://x.com/user/status/123 --thread

# Search
bun run ct-search.ts search "$SOL alpha" --quick --extract-tickers

# Trending tokens
bun run ct-search.ts trending --window 6h --solana-only

# Monitor watchlist
bun run ct-search.ts watchlist --since 24h

# API spend
bun run ct-search.ts cost
```

## Cost

X API charges $0.005/tweet via xAI pay-per-use.

| Operation | Tweets | Cost |
|---|---|---|
| Read tweet/article | 1 | $0.005 |
| Read + thread | 1 + replies | ~$0.005-0.10 |
| Quick search (default) | 20 | ~$0.10 |
| Full search (`--full`) | up to 100 | ~$0.50 |
| Trending scan | 2-3 queries x 30 | ~$0.30-0.45 |

Same tweet re-read within 24h (UTC) is free (X API deduplication).

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

## HTTP API

`ct-alpha` now also ships a Bun + Hono HTTP server with two API surfaces:

- `GET /x402/*`
  Fixed-price x402 endpoints for standard clients.
- `GET /metered/*`
  Session-authenticated metered endpoints for internal tooling, backed by a wallet credit ledger.

### Required env

```bash
cp .env.example .env
```

- `X_BEARER_TOKEN`
- `X402_FACILITATOR_URL`
- `X402_PAY_TO`
- `X402_NETWORK` (`mainnet` by default, or `devnet`/`testnet`)
- `PORT` (optional, defaults to `3000`)

### Run the API

```bash
bun install
bun run dev:api
```

### Standard x402 routes

- `GET /x402/read?tweetId=...`
- `GET /x402/search/20?q=...`
- `GET /x402/search/100?q=...`
- `GET /x402/accounts-feed/20?accounts=a,b,c`
- `GET /x402/accounts-feed/100?accounts=a,b,c`
- `GET /x402/thread/100?tweetId=...`
- `GET /x402/trending/solana?window=6h`
- `GET /x402/trending/general?window=6h`

All standard routes support `fresh=true`. Cache-served responses bypass x402 and return for free.

### Metered routes

- `POST /metered/auth/siwx`
- `GET /metered/credits/balance`
- `POST /metered/credits/topup/5`
- `POST /metered/credits/topup/10`
- `POST /metered/credits/topup/25`
- `POST /metered/credits/topup/50`
- `GET /metered/read?tweetId=...`
- `GET /metered/search?q=...&limit=20`
- `GET /metered/accounts-feed?accounts=a,b,c&limit=20`
- `GET /metered/thread?tweetId=...`
- `GET /metered/trending?solanaOnly=true`

Metered requests use:

1. `POST /metered/auth/siwx` with a `SIGN-IN-WITH-X` header.
2. `Authorization: Bearer <session_token>` on subsequent metered and top-up routes.
3. `402 Payment Required` on insufficient balance, with top-up suggestions in the JSON body.

### Shared metered client helper

Internal tooling can use the shared helper in `lib/metered-client.ts`. It handles:

- SIWx auth for `/metered/auth/siwx`
- bearer session headers for metered routes
- x402-paid top-ups, including the required `payment-identifier` extension
- typed convenience methods for `read`, `search`, `accounts-feed`, `thread`, and `trending`

```ts
import { readFileSync } from "fs";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { toClientSvmSigner } from "@x402/svm";
import { ApiResponseError, MeteredApiClient } from "./lib/metered-client";

const payerSecret = new Uint8Array(
  JSON.parse(readFileSync("./data/runtime/devnet-payer.json", "utf-8"))
);
const payerSigner = toClientSvmSigner(await createKeyPairSignerFromBytes(payerSecret));

const client = new MeteredApiClient({
  baseUrl: "http://localhost:3000",
  paymentSigner: payerSigner,
});

const auth = await client.authenticate();

try {
  const result = await client.search(auth.session.sessionToken, {
    q: "solana",
    limit: 20,
    since: "24h",
    fresh: true,
  });

  console.log(result.body.meta);
} catch (error) {
  if (error instanceof ApiResponseError && error.status === 402) {
    await client.topup(auth.session.sessionToken, 5);
  } else {
    throw error;
  }
}
```

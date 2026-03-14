---
name: ct-alpha-hosted-x402
description: >
  Crypto Twitter intelligence and alpha research skill, centered on the hosted
  x402 API at https://x-research.suzi.trade. Searches X/Twitter for real-time
  crypto narratives, trending tokens, yield strategies, smart money signals,
  protocol research, account feeds, threads, and single-post reads. Uses the
  hosted /x402/* routes for transport, the existing extraction and ranking
  modules for analysis, and the postprocess scripts for CLI-style formatting,
  ticker extraction, contract-address extraction, confidence labels, and raid
  detection.
  Use when: (1) user says "ct alpha", "what's CT saying", "trending on crypto twitter",
  "find alpha on", "search CT for", "what are people saying about [token]",
  "crypto twitter research", "/ct-alpha", "what's hot in crypto", "CT sentiment",
  (2) user wants crypto Twitter research, token or protocol sentiment, or
  account monitoring through the hosted endpoint,
  (3) user mentions "x402", "x-research.suzi.trade", "hosted ct-alpha",
  or "search CT over HTTP".
---

# CT Alpha Hosted x402

## Use This Skill

Use this file when the caller should consume ct-alpha through the hosted endpoint:

- Base URL: `https://x-research.suzi.trade`
- Public standard prefix: `https://x-research.suzi.trade/x402/*`

This skill is x402-first. Use hosted routes by default. Use `ct-search.ts` directly only when the task is explicitly about local-only behavior such as:

- running the local CLI
- onboarding `X_BEARER_TOKEN`
- local cache or spend inspection with `ct-search.ts cost`
- behavior that depends on the local watchlist categories without first resolving them to usernames

## What Must Stay the Same

Read these files for exact behavior:

- `lib/http-service.ts`
  Exact hosted route behavior for search, accounts-feed, read, thread, and trending.
- `lib/http-public-docs.ts`
  Public route contracts, params, example outputs, and x402 flow wording.
- `ct-search.ts`
  Search defaults, research loop, cost posture, and CLI behavior that hosted mode should mirror.
- `references/x-api.md`
  Allowed X v2 operators and invalid v1.1 operators.
- `references/query-templates.md`
  Query shapes for token research, protocol deep-dives, yield searches, risk checks, and smart-money searches.
- `references/tool-discovery.md`
  Verification and follow-up actions after CT research.
- `lib/tweetrank.ts`
  Author credibility, trust labels, confidence scoring, and raid detection logic.
- `lib/filters.ts`
  Auto-appended noise filters and quick-mode reply filtering.
- `scripts/postprocess/*.ts`
  Hosted-response enrichment, CLI-style formatting, ticker extraction, contract-address extraction, and raid detection.

Behavior to keep:

- Route CT research, token chatter, protocol research, smart-money leads, trending topics, and sentiment questions through this skill.
- Start with the cheapest useful hosted call, usually `/x402/search/20`.
- Use only valid X v2 query syntax.
- Treat CT as a lead source, not ground truth.
- Suggest verification steps after research.

Load these files only when needed:

- `README.md` for the hosted route overview, API surface, and deployment notes
- `references/query-templates.md` for reusable crypto query patterns
- `references/x-api.md` for operator rules and invalid v1.1 operators
- `references/tool-discovery.md` for follow-up verification suggestions
- `ct-search.ts` when you need exact CLI parity for defaults or workflow mapping
- `lib/http-service.ts` and `lib/http-public-docs.ts` when exact hosted route semantics matter
- `scripts/postprocess/*.ts` when you need hosted JSON turned back into CLI-like output or richer analytics

These repo entrypoint scripts are local-bootstrap only, not part of the hosted x402 flow:

- `install.sh`
- `install.ts`
- `setup.ts`

## Hosted Surface

The public hosted surface is the standard x402 API only.

- Call concrete `/x402/*` routes, not the bare `/x402` prefix.
- Do not use `/metered/*` unless the task is specifically about the internal metered flow.
- Standard responses are JSON shaped like `{ data, meta }`.
- Cached responses may be served without payment.
- Add `fresh=true` only when the user explicitly wants a live X fetch instead of cache.

## x402 Flow

Follow this flow exactly:

1. Build the exact `GET https://x-research.suzi.trade/x402/...` URL, including the final query string.
2. Send the request to that exact route.
3. If the server returns `402 Payment Required`, read the x402 challenge from the response headers and body.
4. Pay for that exact method + path + query string.
5. Retry the exact same request with the required x402 payment header(s).
6. Parse the `{ data, meta }` JSON response.

Important:

- Do not change the path or query string between the challenged request and the paid retry.
- If an x402 client is available, let it handle challenge and retry. Your job is still to construct the correct URL.
- The payment asset is determined by the server challenge, not by guesswork.

## Route Map

### 1. Search CT

Hosted equivalent of `ct-search.ts search`.

- `GET /x402/search/20`
- `GET /x402/search/100`

Use `/x402/search/20` first. It is the hosted equivalent of quick mode and should be the default first pass.

Query params:

- `q` required
- `since` optional: `1h|6h|24h|7d`, default `24h`
- `sort` optional: `relevancy|recency|likes|retweets|impressions|bookmarks`, default `relevancy`
- `from` optional: comma-separated usernames
- `min_likes` optional: non-negative integer
- `fresh` optional: `true|1|yes`

Hosted route behavior:

- `q` is the user query, not the final wire query.
- The server appends the built-in crypto noise filters automatically.
- Quick search also excludes replies.
- If `q` does not include `lang:`, the server appends `lang:en`.
- `from=user1,user2` is rewritten to `from:user1 OR from:user2`.
- `min_likes` is applied after fetch, like the CLI.
- `/20` defaults to `min_likes=3`; `/100` defaults to `min_likes=0`.

Examples:

```text
https://x-research.suzi.trade/x402/search/20?q=%24SOL%20OR%20solana&since=24h
https://x-research.suzi.trade/x402/search/20?q=pendle%20yield&from=DeFiDad,0xMert_&min_likes=10
https://x-research.suzi.trade/x402/search/100?q=stablecoin%20market%20structure&sort=relevancy&fresh=true
```

### 2. Account Feeds

Hosted equivalent of account monitoring and the practical replacement for `watchlist` when you already know the usernames.

- `GET /x402/accounts-feed/20`
- `GET /x402/accounts-feed/100`

Query params:

- `accounts` required: comma-separated usernames, max `20`
- `since` optional: `1h|6h|24h|7d`, default `24h`
- `fresh` optional

Hosted route behavior:

- The server builds a `from:user1 OR from:user2 ...` query for you.
- Retweets are excluded.
- Replies are included.
- Results are recency-sorted.

Examples:

```text
https://x-research.suzi.trade/x402/accounts-feed/20?accounts=aeyakovenko,solana,jito_sol&since=24h
https://x-research.suzi.trade/x402/accounts-feed/100?accounts=DefiIgnas,DeFiDad&fresh=true
```

If the original task is "watchlist by category", resolve the category to usernames from local watchlist data first, then call `accounts-feed`.

### 3. Read One Post

Hosted equivalent of `ct-search.ts read`.

- `GET /x402/read`

Query params:

- `tweetId` required: raw tweet ID or full `x.com` or `twitter.com` status URL
- `fresh` optional

Examples:

```text
https://x-research.suzi.trade/x402/read?tweetId=1873471977766361323
https://x-research.suzi.trade/x402/read?tweetId=https%3A%2F%2Fx.com%2Fsolana%2Fstatus%2F1873471977766361323
```

Use this when the user wants a single post or article. If they want the whole conversation, switch to `thread/100`.

### 4. Read a Thread

Hosted equivalent of `ct-search.ts thread` and `read --thread`.

- `GET /x402/thread/100`

Query params:

- `tweetId` required: raw tweet ID or full status URL
- `fresh` optional

Example:

```text
https://x-research.suzi.trade/x402/thread/100?tweetId=1873471977766361323
```

The route returns the root tweet plus up to `100` tweets from the same conversation.

### 5. Trending Feeds

Hosted equivalent of the built-in trending query plans.

- `GET /x402/trending/solana`
- `GET /x402/trending/general`

Query params:

- `window` optional: `1h|6h|24h`, default `6h`
- `top` optional: max `20`
- `fresh` optional

Examples:

```text
https://x-research.suzi.trade/x402/trending/solana?window=6h&top=10
https://x-research.suzi.trade/x402/trending/general?window=1h&top=5&fresh=true
```

Important nuance:

- These routes return recent tweet objects from the built-in trending query plans.
- They do not return the CLI's formatted ticker aggregation or raid summary directly.
- For ticker extraction, use `scripts/postprocess/extract-tickers.ts`.
- For raid detection, use `scripts/postprocess/detect-raids.ts` or `scripts/postprocess/trending.ts`.
- For ranked or formatted output, use `scripts/postprocess/enrich.ts` or `scripts/postprocess/format.ts`.

## What Is Publicly Available

Public standard hosted routes:

- `read`
- `search/20`
- `search/100`
- `accounts-feed/20`
- `accounts-feed/100`
- `thread/100`
- `trending/solana`
- `trending/general`

Not on the public standard surface:

- `/metered/*`
- local token onboarding
- `cost`
- local watchlist category resolution
- CLI-only formatter output
- CLI-only post-processing flags like `--extract-tickers` and `--extract-cas`

When those behaviors are needed, either:

- compute them client-side from the returned tweet objects, or
- use `ct-search.ts` directly for the local-only flow

## Hosted Postprocess Scripts

The hosted API returns raw tweet JSON. The repo ships a postprocess layer under `scripts/postprocess/` to restore most of the original CLI behavior on top of hosted responses.

Use these scripts when the environment already has the final hosted JSON response and you want parity with the original skill without switching back to `ct-search.ts`.

- `scripts/postprocess/format.ts`
  Full CLI-style formatter for hosted `search`, `read`, `thread`, `accounts-feed`, and `trending` responses. Supports `--extract-tickers` and `--extract-cas`.
- `scripts/postprocess/enrich.ts`
  Adds TweetRank scoring, source labels, and a confidence field to hosted responses.
- `scripts/postprocess/trending.ts`
  Rebuilds the richer trending output from hosted `/x402/trending/*` responses, including ticker aggregation and raid detection.
- `scripts/postprocess/extract-tickers.ts`
  Hosted equivalent of CLI `--extract-tickers`.
- `scripts/postprocess/extract-cas.ts`
  Hosted equivalent of CLI `--extract-cas`.
- `scripts/postprocess/detect-raids.ts`
  Standalone coordinated-raid analysis from hosted tweet batches.
- `scripts/postprocess/watchlist.ts`
  Shared watchlist loader used by the postprocess scripts.
- `scripts/postprocess/read-stdin.ts`
  Shared stdin JSON reader and response normalizer for hosted responses.

Examples:

```bash
cat hosted-response.json | bun run scripts/postprocess/format.ts --extract-tickers
cat hosted-response.json | bun run scripts/postprocess/enrich.ts
cat hosted-trending.json | bun run scripts/postprocess/trending.ts --min-mentions 3
cat hosted-response.json | bun run scripts/postprocess/detect-raids.ts --json
```

If you are implementing a client, use this split:

- hosted `/x402/*` route for transport and payment
- `scripts/postprocess/*` for local enrichment, ranking, extraction, and formatting

## Query Rules

Use `references/x-api.md` for operator rules and `lib/filters.ts` for the auto-appended noise filters:

- Put only X v2 search terms and operators in `q`.
- Use quotes for exact phrases and `OR` for variants.
- Prefer `from=` for account restriction instead of hand-writing many `from:` operators in `q`.
- Do not put `min_faves:`, `min_retweets:`, `min_replies:`, `place:`, `bio:`, `sample:`, or other v1.1-only operators in `q`.
- Do not manually add the standard built-in noise filters unless you are intentionally changing behavior.
- Do not include literal `&` inside `q`.
- URL-encode `q`, `tweetId`, and other user-supplied values.

## Research Loop

Follow this workflow against the hosted routes:

1. Decompose the user request into one to three targeted CT searches.
2. Start with `/x402/search/20`.
3. If needed, narrow with `from`, `since`, or `min_likes` before paying for larger pulls.
4. Use `read` or `thread/100` for high-signal posts worth deeper inspection.
5. Use `accounts-feed/*` for named-account monitoring and `trending/*` for broad discovery.
6. Synthesize by theme, not by raw endpoint.
7. Suggest verification steps using the tools actually available in the session.

## Refinement Heuristics

Too noisy:

- raise `min_likes`
- narrow `since`, usually to `6h`
- restrict with `from`
- use `accounts-feed/*` for explicit author sets

Too few results:

- broaden the query with `OR` variants
- extend the window to `7d`
- remove restrictive keywords
- lower `min_likes`

Need expert takes:

- use `from` with known analysts or watchlist authors
- include `has:links` in `q` when looking for substantive threads

Need spam or raid detection:

- run `scripts/postprocess/enrich.ts` for trust labels
- run `scripts/postprocess/detect-raids.ts` or `scripts/postprocess/trending.ts`
- watch for low unique-author count and high low-cred author ratio

## Result Handling

The hosted API returns stripped tweet objects and metadata, not the full CLI presentation layer.

When summarizing hosted results, do these checks:

- identify repeated narratives across independent authors
- separate signal from coordinated hype
- keep contract addresses and ticker mentions unverified until checked elsewhere
- present confidence and failure modes explicitly

If the task requires near-CLI parity, use this mapping:

- query defaults, search flow, and cost posture: `ct-search.ts`
- noise filters and quick-mode reply filtering: `lib/filters.ts`
- trust labels, confidence, ranking, and raid scoring: `lib/tweetrank.ts`
- hosted route semantics and parameter handling: `lib/http-service.ts`
- public route docs and example outputs: `lib/http-public-docs.ts`
- hosted-response formatting and enrichment: `scripts/postprocess/*.ts`

## Dynamic Tool Discovery

After completing CT research, check which tools are available in the session and suggest verification or execution follow-ups.

Common patterns:

- token found: suggest TVL, price, liquidity, or market checks
- contract address found: suggest Solscan, Etherscan, DexScreener, or rug-check style verification
- narrative found: suggest prediction-market or onchain checks
- strategy found: suggest yield or protocol comparison tools

Always frame these as ways to verify CT leads, not confirm them.

## Output Trust Labels

When using `scripts/postprocess/enrich.ts`, `format.ts`, or manual synthesis, use these labels:

- `WATCHLIST`: author is on the watchlist and gets the highest trust
- `HIGH-CRED`: strong credibility signals
- `UNKNOWN`: not enough signal to trust
- `SUSPICIOUS`: bot-like or low-credibility patterns
- `ARTICLE`: long-form X post

Always communicate:

- confidence as `HIGH`, `MED`, or `LOW`
- contract addresses as `UNVERIFIED` until checked elsewhere
- at least one risk or failure mode for each important finding

## Cost Protocol

1. Always start with `/x402/search/20`.
2. Use `/x402/search/100` only when the first pass is insufficient.
3. Prefer a targeted follow-up over a broad rerun.
4. Cache first. Add `fresh=true` only when the user explicitly wants live data.
5. If the user asks about exact local spend history, that lives in `ct-search.ts cost`, not the public hosted surface.

## Recency Defaults

- Default `since`: `24h` for trending or narratives
- Default `since`: `7d` for broader research or strategy discovery
- Default trending window: `6h`
- Default stance: cached first, `fresh=true` only when explicitly requested
- Default output posture: summarize, then suggest verification

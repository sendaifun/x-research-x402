# CT Alpha Query Templates

Pre-built search patterns for common crypto research tasks. The agent should adapt these templates to the user's specific query, substituting TOKEN/PROTOCOL as needed.

## Token Research
```
"$TOKEN" OR "token_name" -is:retweet -airdrop -giveaway lang:en
```

## Protocol Deep-Dive
```
"protocol_name" (analysis OR review OR thread OR "deep dive" OR alpha) -is:retweet -giveaway lang:en
```

## Yield / Strategy Finder
```
("$TOKEN" OR "protocol") (yield OR APY OR strategy OR farm OR stake OR LP OR vault) -is:retweet -giveaway lang:en
```

## Solana Ecosystem Pulse
```
(solana OR $SOL) (launch OR ship OR deploy OR mainnet OR update OR release) -is:retweet -giveaway lang:en
```

## Narrative Detection (Broad)
```
(crypto OR web3 OR defi OR onchain) (narrative OR thesis OR trend OR "next big" OR "meta is") -is:retweet lang:en
```

## Smart Money / Whale Signals
```
(whale OR "smart money" OR "big buy" OR accumulate OR "loading up") ($TOKEN OR token_name) -is:retweet lang:en
```

## Airdrop / Points Intel
```
("$TOKEN" OR "protocol") (airdrop OR points OR "season 2" OR "claim live" OR criteria) -is:retweet lang:en
```

## Contract Address Hunting
```
"$TOKEN" (CA OR contract OR mint OR "token address") -is:retweet -scam lang:en
```

## Protocol Comparison
```
("$TOKEN_A" OR "protocol_a") ("$TOKEN_B" OR "protocol_b") (vs OR versus OR compare OR better OR prefer) -is:retweet lang:en
```

## Risk / FUD Detection
```
("$TOKEN" OR "protocol") (hack OR exploit OR rug OR drain OR vulnerability OR warning OR audit) -is:retweet lang:en
```

## New Token Discovery (Solana)
```
(pump.fun OR dexscreener OR birdeye) (solana OR sol) (new OR launch OR just) -is:retweet lang:en
```

## MEV / Infra Research
```
(MEV OR "sandwich attack" OR "priority fee" OR "block builder" OR jito) solana -is:retweet lang:en
```

## Governance / DAO Activity
```
("$TOKEN" OR "protocol") (proposal OR governance OR vote OR DAO OR "token holders") -is:retweet lang:en
```

## Expert Opinions (with watchlist)
Use `--from` flag with watchlist accounts:
```
bun run ct-search.ts search "$TOKEN alpha" --from user1,user2,user3 --quick
```

## Query Anti-Patterns (Avoid These)

Twitter v2 search uses **AND logic by default** — every bare word in the query must appear in the tweet. Long natural-language queries silently return 0 results because no single tweet contains all the terms. The noise filters auto-appended by `lib/filters.ts` make this worse by adding even more required operators.

### Bad: Long natural-language queries
```
polymarket sure bet 90 percent free money march 2026
```
This requires a tweet to contain ALL of: "polymarket", "sure", "bet", "90", "percent", "free", "money", "march", "2026". Result: 0 tweets.

### Bad: Dumping the user's question verbatim
```
what are the best high conviction bets on polymarket right now
```
Same problem — 10 AND-ed terms, no tweet will match.

### Good: 1-2 anchor terms + OR groups for intent
```
polymarket ("free money" OR "easy bet" OR "guaranteed" OR "sure thing")
```

### Good: Separate queries for separate intents
Instead of one mega-query, run two focused searches:
```
polymarket (mispriced OR "no brainer" OR "free money")
polymarket (alpha OR edge OR "high conviction")
```

### Rule of thumb
- **Max 2-3 AND-ed terms** outside of OR groups
- **Use OR groups** `(term1 OR term2 OR term3)` for synonyms/variants
- **Use quotes** `"exact phrase"` only for multi-word phrases people actually write
- **Never pass the user's raw question** as the query string — decompose it into search terms first

## Tips for Query Optimization

1. **Start narrow**: Use specific ticker + context words. Broaden only if <10 results.
2. **Always filter noise**: The CLI auto-appends `-is:retweet -airdrop -giveaway` etc.
3. **Use OR for variants**: `"$JTO" OR "jito"` catches both cashtag and plain name.
4. **Time matters**: Default 24h for trending, 7d for research. Never go broader without asking.
5. **from: for signal**: Restrict to watchlist accounts for highest signal-to-noise.
6. **has:links for substance**: Add when you want analytical content, not hot takes.

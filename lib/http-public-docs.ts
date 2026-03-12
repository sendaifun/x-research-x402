import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import {
  POSTS_READ_MICRO_USD,
  fixedSearchPriceMicrousd,
  fixedThreadPriceMicrousd,
  fixedTrendingPriceMicrousd,
  formatUsdPrice,
} from "./http-pricing";

export type StandardRouteKey =
  | "GET /x402/read"
  | "GET /x402/search/20"
  | "GET /x402/search/100"
  | "GET /x402/accounts-feed/20"
  | "GET /x402/accounts-feed/100"
  | "GET /x402/thread/100"
  | "GET /x402/trending/solana"
  | "GET /x402/trending/general";

type QuerySchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties: false;
};

type PublicStandardRouteDoc = {
  routeKey: StandardRouteKey;
  path: string;
  title: string;
  description: string;
  priceUsd: string;
  requiredParams: string[];
  optionalParams: string[];
  input: Record<string, unknown>;
  inputSchema: QuerySchema;
  exampleOutput: unknown;
};

export const DOCS_CONTENT_TYPE = "text/markdown; charset=utf-8";

const SAMPLE_TWEET = {
  id: "1873471977766361323",
  text: "Solana builders still underestimate how quickly distribution compounds.",
  author_id: "2244994945",
  username: "solana",
  name: "Solana",
  created_at: "2026-03-12T10:00:00.000Z",
  conversation_id: "1873471977766361323",
  is_article: false,
  metrics: {
    likes: 421,
    retweets: 98,
    replies: 23,
    quotes: 11,
    impressions: 14500,
    bookmarks: 52,
  },
  urls: ["https://solana.com"],
  mentions: ["solana"],
  hashtags: ["solana"],
  tweet_url: "https://x.com/solana/status/1873471977766361323",
  author: {
    id: "2244994945",
    username: "solana",
    name: "Solana",
    verified: true,
    followers_count: 3250000,
    following_count: 287,
    tweet_count: 18845,
    created_at: "2018-02-08T18:00:00.000Z",
  },
} as const;

function baseMeta(meta: Record<string, unknown>) {
  return {
    mode: "standard" as const,
    cached: false,
    ...meta,
  };
}

export const PUBLIC_STANDARD_ROUTE_DOCS: PublicStandardRouteDoc[] = [
  {
    routeKey: "GET /x402/read",
    path: "/x402/read",
    title: "Read a single post",
    description: "Read one stripped tweet object by tweet ID or status URL.",
    priceUsd: formatUsdPrice(POSTS_READ_MICRO_USD),
    requiredParams: ["tweetId"],
    optionalParams: ["fresh"],
    input: {
      tweetId: "1873471977766361323",
    },
    inputSchema: {
      type: "object",
      properties: {
        tweetId: { type: "string", description: "Raw X tweet ID or full status URL." },
        fresh: { type: "boolean", description: "Bypass cache and fetch from X." },
      },
      required: ["tweetId"],
      additionalProperties: false,
    },
    exampleOutput: {
      data: SAMPLE_TWEET,
      meta: baseMeta({
        returned_count: 1,
      }),
    },
  },
  {
    routeKey: "GET /x402/search/20",
    path: "/x402/search/20",
    title: "Search up to 20 posts",
    description: "Run a CT search with current ct-alpha query semantics and a 20-post cap.",
    priceUsd: formatUsdPrice(fixedSearchPriceMicrousd(20)),
    requiredParams: ["q"],
    optionalParams: ["since", "sort", "from", "min_likes", "fresh"],
    input: {
      q: "solana fees",
      since: "24h",
      sort: "relevancy",
      min_likes: "3",
    },
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string" },
        since: { type: "string", enum: ["1h", "6h", "24h", "7d"] },
        sort: { type: "string", enum: ["recency", "relevancy", "likes", "retweets", "impressions", "bookmarks"] },
        from: { type: "string", description: "Restrict search to one username." },
        min_likes: { type: "string", description: "Filter after fetch using minimum likes." },
        fresh: { type: "boolean" },
      },
      required: ["q"],
      additionalProperties: false,
    },
    exampleOutput: {
      data: [SAMPLE_TWEET],
      meta: baseMeta({
        returned_count: 1,
        raw_count: 20,
        limit: 20,
        quick: true,
        cap: 20,
        price_usd: 0.1,
      }),
    },
  },
  {
    routeKey: "GET /x402/search/100",
    path: "/x402/search/100",
    title: "Search up to 100 posts",
    description: "Run a CT search with current ct-alpha query semantics and a 100-post cap.",
    priceUsd: formatUsdPrice(fixedSearchPriceMicrousd(100)),
    requiredParams: ["q"],
    optionalParams: ["since", "sort", "from", "min_likes", "fresh"],
    input: {
      q: "stablecoin market structure",
      since: "24h",
      sort: "relevancy",
      fresh: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string" },
        since: { type: "string", enum: ["1h", "6h", "24h", "7d"] },
        sort: { type: "string", enum: ["recency", "relevancy", "likes", "retweets", "impressions", "bookmarks"] },
        from: { type: "string", description: "Restrict search to one username." },
        min_likes: { type: "string", description: "Filter after fetch using minimum likes." },
        fresh: { type: "boolean" },
      },
      required: ["q"],
      additionalProperties: false,
    },
    exampleOutput: {
      data: [SAMPLE_TWEET],
      meta: baseMeta({
        returned_count: 1,
        raw_count: 73,
        limit: 100,
        quick: false,
        cap: 100,
        price_usd: 0.5,
      }),
    },
  },
  {
    routeKey: "GET /x402/accounts-feed/20",
    path: "/x402/accounts-feed/20",
    title: "Fetch up to 20 recent posts from accounts",
    description: "Fetch recent posts from caller-supplied accounts. Retweets are excluded and replies are included.",
    priceUsd: formatUsdPrice(fixedSearchPriceMicrousd(20)),
    requiredParams: ["accounts"],
    optionalParams: ["since", "fresh"],
    input: {
      accounts: "aeyakovenko,solana",
      since: "24h",
    },
    inputSchema: {
      type: "object",
      properties: {
        accounts: { type: "string", description: "Comma-separated X usernames. Max 20 accounts." },
        since: { type: "string", enum: ["1h", "6h", "24h", "7d"] },
        fresh: { type: "boolean" },
      },
      required: ["accounts"],
      additionalProperties: false,
    },
    exampleOutput: {
      data: [SAMPLE_TWEET],
      meta: baseMeta({
        returned_count: 1,
        raw_count: 14,
        limit: 20,
        quick: true,
        cap: 20,
        price_usd: 0.1,
      }),
    },
  },
  {
    routeKey: "GET /x402/accounts-feed/100",
    path: "/x402/accounts-feed/100",
    title: "Fetch up to 100 recent posts from accounts",
    description: "Fetch recent posts from caller-supplied accounts. Retweets are excluded and replies are included.",
    priceUsd: formatUsdPrice(fixedSearchPriceMicrousd(100)),
    requiredParams: ["accounts"],
    optionalParams: ["since", "fresh"],
    input: {
      accounts: "aeyakovenko,solana,jito_sol",
      since: "24h",
      fresh: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        accounts: { type: "string", description: "Comma-separated X usernames. Max 20 accounts." },
        since: { type: "string", enum: ["1h", "6h", "24h", "7d"] },
        fresh: { type: "boolean" },
      },
      required: ["accounts"],
      additionalProperties: false,
    },
    exampleOutput: {
      data: [SAMPLE_TWEET],
      meta: baseMeta({
        returned_count: 1,
        raw_count: 61,
        limit: 100,
        quick: false,
        cap: 100,
        price_usd: 0.5,
      }),
    },
  },
  {
    routeKey: "GET /x402/thread/100",
    path: "/x402/thread/100",
    title: "Read a thread",
    description: "Read the root tweet and up to 100 tweets from the same conversation.",
    priceUsd: formatUsdPrice(fixedThreadPriceMicrousd()),
    requiredParams: ["tweetId"],
    optionalParams: ["fresh"],
    input: {
      tweetId: "1873471977766361323",
    },
    inputSchema: {
      type: "object",
      properties: {
        tweetId: { type: "string", description: "Raw X tweet ID or full status URL." },
        fresh: { type: "boolean" },
      },
      required: ["tweetId"],
      additionalProperties: false,
    },
    exampleOutput: {
      data: [SAMPLE_TWEET],
      meta: baseMeta({
        returned_count: 1,
        partial: false,
        cap: 100,
        price_usd: 0.505,
      }),
    },
  },
  {
    routeKey: "GET /x402/trending/solana",
    path: "/x402/trending/solana",
    title: "Get Solana trending posts",
    description: "Run the Solana trending query plan and return the top ranked recent posts.",
    priceUsd: formatUsdPrice(fixedTrendingPriceMicrousd("solana")),
    requiredParams: [],
    optionalParams: ["window", "top", "fresh"],
    input: {
      window: "6h",
      top: "5",
    },
    inputSchema: {
      type: "object",
      properties: {
        window: { type: "string", enum: ["1h", "6h", "24h"] },
        top: { type: "string", description: "Maximum number of items to return." },
        fresh: { type: "boolean" },
      },
      additionalProperties: false,
    },
    exampleOutput: {
      data: [SAMPLE_TWEET],
      meta: baseMeta({
        returned_count: 1,
        raw_count: 60,
        query_count: 2,
        kind: "solana",
        top: 5,
        price_usd: 0.3,
      }),
    },
  },
  {
    routeKey: "GET /x402/trending/general",
    path: "/x402/trending/general",
    title: "Get general CT trending posts",
    description: "Run the general trending query plan and return the top ranked recent posts.",
    priceUsd: formatUsdPrice(fixedTrendingPriceMicrousd("general")),
    requiredParams: [],
    optionalParams: ["window", "top", "fresh"],
    input: {
      window: "6h",
      top: "5",
    },
    inputSchema: {
      type: "object",
      properties: {
        window: { type: "string", enum: ["1h", "6h", "24h"] },
        top: { type: "string", description: "Maximum number of items to return." },
        fresh: { type: "boolean" },
      },
      additionalProperties: false,
    },
    exampleOutput: {
      data: [SAMPLE_TWEET],
      meta: baseMeta({
        returned_count: 1,
        raw_count: 90,
        query_count: 3,
        kind: "general",
        top: 5,
        price_usd: 0.45,
      }),
    },
  },
];

export function getStandardRouteDiscoveryExtension(routeKey: StandardRouteKey) {
  const route = PUBLIC_STANDARD_ROUTE_DOCS.find((entry) => entry.routeKey === routeKey);
  if (!route) {
    throw new Error(`Missing public route discovery metadata for ${routeKey}`);
  }

  return declareDiscoveryExtension({
    input: route.input,
    inputSchema: route.inputSchema,
    output: {
      example: route.exampleOutput,
    },
  });
}

function queryExample(route: PublicStandardRouteDoc): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(route.input)) {
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `${route.path}?${query}` : route.path;
}

export function renderAgentDocsMarkdown(network: string): string {
  const sections = PUBLIC_STANDARD_ROUTE_DOCS.map((route) => {
    const required = route.requiredParams.length
      ? route.requiredParams.join(", ")
      : "none";
    const optional = route.optionalParams.length
      ? route.optionalParams.join(", ")
      : "none";

    return [
      `## \`${route.path}\``,
      `${route.description}`,
      ``,
      `- Method: \`GET\``,
      `- Price: \`${route.priceUsd}\``,
      `- Required query params: \`${required}\``,
      `- Optional query params: \`${optional}\``,
      `- Example: \`${queryExample(route)}\``,
    ].join("\n");
  }).join("\n\n");

  return `# ct-alpha Public API

This host exposes a public x402-protected standard API under the \`/x402/*\` prefix.

## Important

- Do not call \`/x402\` or \`/metered\` directly. They are prefixes, not endpoints.
- The public Bazaar surface includes only the standard \`/x402/*\` routes.
- The \`/metered/*\` routes are internal and intentionally omitted from Bazaar.
- Current deployment network: \`${network}\`.
- Payment asset on the deployed host is determined by the x402 challenge for each route.

## x402 Flow

1. Send the request to the target \`/x402/*\` endpoint.
2. If the response is \`402 Payment Required\`, read the \`PAYMENT-REQUIRED\` header and JSON body.
3. Create the payment payload for that exact method, path, and query string.
4. Retry the same request with the \`PAYMENT-SIGNATURE\` header.
5. On success, the route returns stripped JSON plus the \`PAYMENT-RESPONSE\` settlement header.

## Cache Behavior

- Cached standard responses may be served without payment.
- Add \`fresh=true\` to bypass cache and force a live X fetch.

## Public Standard Routes

${sections}
`;
}

export function buildServiceStatus(network: string) {
  return {
    service: "ct-alpha",
    network,
    modes: ["standard", "metered"],
    standard_prefix: "/x402",
    metered_prefix: "/metered",
  };
}

export function buildAgentDocsResponse(network: string): Response {
  return new Response(renderAgentDocsMarkdown(network), {
    headers: {
      "Content-Type": DOCS_CONTENT_TYPE,
    },
  });
}

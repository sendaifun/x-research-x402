import { Buffer } from "buffer";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { paymentIdentifierResourceServerExtension, extractAndValidatePaymentIdentifier } from "@x402/extensions/payment-identifier";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { handleSiwxAuth, requireSession, type ApiEnv } from "./lib/http-auth";
import {
  HttpValidationError,
  canServeAccountsFeedWithoutX,
  canServeReadWithoutX,
  canServeSearchWithoutX,
  canServeThreadWithoutX,
  canServeTrendingWithoutX,
  fetchAccountsFeed,
  fetchRead,
  fetchSearch,
  fetchThread,
  fetchTrending,
} from "./lib/http-service";
import { createStandardRoutes, createTopupRoutes } from "./lib/http-x402";
import {
  POSTS_READ_MICRO_USD,
  TOPUP_SKUS_USD,
  fixedSearchPriceMicrousd,
  fixedThreadPriceMicrousd,
  fixedTrendingPriceMicrousd,
  formatUsd,
  microUsdToUsdNumber,
  recommendedTopup,
  reserveForRead,
  reserveForSearch,
  reserveForThread,
  reserveForTrending,
  resolveSolanaNetwork,
  usdToMicroUsd,
  type StandardTrendingKind,
} from "./lib/http-pricing";
import {
  getTopup,
  getWalletBalance,
  recordTopup,
  releaseReservation,
  reserveWalletBalance,
  settleReservation,
} from "./lib/runtime-store";

const app = new Hono<ApiEnv>();

function requireEnv(name: string, fallbackNames: string[] = []): string {
  const candidates = [name, ...fallbackNames];
  for (const candidate of candidates) {
    const value = process.env[candidate];
    if (value) {
      return value;
    }
  }

  throw new Error(`Missing required environment variable: ${candidates.join(" or ")}`);
}

function getFresh(c: Context): boolean {
  const value = c.req.query("fresh");
  return value === "1" || value === "true" || value === "yes";
}

function getTweetId(c: Context): string {
  const tweetId = c.req.query("tweetId") || c.req.query("id");
  if (!tweetId) {
    throw new HttpValidationError(400, "Query parameter tweetId is required.");
  }
  return tweetId;
}

function getOrigin(c: Context): string {
  return new URL(c.req.url).origin;
}

function toErrorResponse(c: Context, error: unknown): Response {
  if (error instanceof HttpValidationError) {
    return c.json({ error: error.message }, { status: error.status as any });
  }

  if (error instanceof HTTPException) {
    return c.json({ error: error.message }, { status: error.status as any });
  }

  if (error instanceof Error) {
    if (error.message.startsWith("X API error 404")) {
      return c.json({ error: "Requested X resource was not found." }, { status: 404 });
    }
    if (error.message.startsWith("X API error 429") || error.message.includes("Rate limited")) {
      return c.json({ error: error.message }, { status: 429 });
    }
    return c.json({ error: error.message }, { status: 500 });
  }

  return c.json({ error: "Unknown server error." }, { status: 500 });
}

function withErrors(
  handler: (c: Context<ApiEnv>) => Promise<Response>
): (c: Context<ApiEnv>) => Promise<Response> {
  return async (c) => {
    try {
      return await handler(c);
    } catch (error) {
      return toErrorResponse(c, error);
    }
  };
}

function buildStandardMeta<T extends object>(
  meta: T,
  extra: Record<string, unknown> = {}
): T & { mode: "standard" } & Record<string, unknown> {
  return {
    mode: "standard",
    ...meta,
    ...extra,
  };
}

function buildMeteredMeta<T extends object>(
  meta: T,
  chargedMicrousd: number,
  balanceMicrousd: number
): T & { mode: "metered" } & Record<string, unknown> {
  return {
    mode: "metered",
    ...meta,
    charged_usd: microUsdToUsdNumber(chargedMicrousd),
    balance_usd: microUsdToUsdNumber(balanceMicrousd),
    charged_usd_formatted: `$${formatUsd(chargedMicrousd)}`,
    balance_usd_formatted: `$${formatUsd(balanceMicrousd)}`,
  };
}

function insufficientFundsResponse(
  c: Context<ApiEnv>,
  wallet: string,
  balanceMicrousd: number,
  requiredReserveMicrousd: number
): Response {
  const shortfall = Math.max(requiredReserveMicrousd - balanceMicrousd, 0);
  const topupSku = recommendedTopup(shortfall);

  return c.json(
    {
      payment_required: true,
      mode: "metered",
      wallet,
      balance_usd: microUsdToUsdNumber(balanceMicrousd),
      required_reserve_usd: microUsdToUsdNumber(requiredReserveMicrousd),
      shortfall_usd: microUsdToUsdNumber(shortfall),
      recommended_topup_usd: topupSku,
      topup_options: TOPUP_SKUS_USD,
      topup_url_template: `${getOrigin(c)}/metered/credits/topup/:amount`,
    },
    { status: 402 }
  );
}

function decodeBase64Json(value: string): unknown {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return JSON.parse(Buffer.from(normalized + padding, "base64").toString("utf-8"));
}

function extractPaymentIdFromRequest(c: Context): string {
  const header = c.req.header("PAYMENT-SIGNATURE") || c.req.header("X-PAYMENT");
  if (!header) {
    throw new HttpValidationError(400, "PAYMENT-SIGNATURE header is required.");
  }

  const payload = decodeBase64Json(header);
  const extracted = extractAndValidatePaymentIdentifier(payload as any);
  if (!extracted?.id) {
    throw new HttpValidationError(400, "Valid payment-identifier extension is required.");
  }

  return extracted.id;
}

async function handleStandardRead(c: Context<ApiEnv>): Promise<Response> {
  const result = await fetchRead(getTweetId(c), getFresh(c));
  if (!result.data) {
    return c.json({ error: "Tweet not found." }, { status: 404 });
  }

  return c.json({
    data: result.data,
    meta: buildStandardMeta(result.meta),
  });
}

async function handleStandardSearch(
  c: Context<ApiEnv>,
  limit: 20 | 100
): Promise<Response> {
  const result = await fetchSearch({
    q: c.req.query("q"),
    limit,
    since: c.req.query("since"),
    sort: c.req.query("sort"),
    from: c.req.query("from"),
    min_likes: c.req.query("min_likes"),
    fresh: c.req.query("fresh"),
  });

  return c.json({
    data: result.data,
    meta: buildStandardMeta(result.meta, {
      cap: limit,
      price_usd: microUsdToUsdNumber(fixedSearchPriceMicrousd(limit)),
    }),
  });
}

async function handleStandardAccountsFeed(
  c: Context<ApiEnv>,
  limit: 20 | 100
): Promise<Response> {
  const result = await fetchAccountsFeed({
    accounts: c.req.query("accounts") || "",
    limit,
    since: c.req.query("since"),
    fresh: c.req.query("fresh"),
  });

  return c.json({
    data: result.data,
    meta: buildStandardMeta(result.meta, {
      cap: limit,
      price_usd: microUsdToUsdNumber(fixedSearchPriceMicrousd(limit)),
    }),
  });
}

async function handleStandardThread(c: Context<ApiEnv>): Promise<Response> {
  const result = await fetchThread(getTweetId(c), getFresh(c));

  return c.json({
    data: result.data,
    meta: buildStandardMeta(result.meta, {
      cap: 100,
      price_usd: microUsdToUsdNumber(fixedThreadPriceMicrousd()),
    }),
  });
}

async function handleStandardTrending(
  c: Context<ApiEnv>,
  kind: StandardTrendingKind
): Promise<Response> {
  const result = await fetchTrending(kind, {
    window: c.req.query("window"),
    top: c.req.query("top"),
    fresh: c.req.query("fresh"),
  });

  return c.json({
    data: result.data,
    meta: buildStandardMeta(result.meta, {
      price_usd: microUsdToUsdNumber(fixedTrendingPriceMicrousd(kind)),
    }),
  });
}

const standardFreeCacheMiddleware: MiddlewareHandler<ApiEnv> = async (c, next) => {
  try {
    switch (c.req.path) {
      case "/x402/read":
        if (canServeReadWithoutX(getTweetId(c), getFresh(c))) {
          return await handleStandardRead(c);
        }
        break;
      case "/x402/search/20":
        if (
          canServeSearchWithoutX({
            q: c.req.query("q"),
            limit: 20,
            since: c.req.query("since"),
            sort: c.req.query("sort"),
            from: c.req.query("from"),
            min_likes: c.req.query("min_likes"),
            fresh: c.req.query("fresh"),
          })
        ) {
          return await handleStandardSearch(c, 20);
        }
        break;
      case "/x402/search/100":
        if (
          canServeSearchWithoutX({
            q: c.req.query("q"),
            limit: 100,
            since: c.req.query("since"),
            sort: c.req.query("sort"),
            from: c.req.query("from"),
            min_likes: c.req.query("min_likes"),
            fresh: c.req.query("fresh"),
          })
        ) {
          return await handleStandardSearch(c, 100);
        }
        break;
      case "/x402/accounts-feed/20":
        if (
          canServeAccountsFeedWithoutX({
            accounts: c.req.query("accounts") || "",
            limit: 20,
            since: c.req.query("since"),
            fresh: c.req.query("fresh"),
          })
        ) {
          return await handleStandardAccountsFeed(c, 20);
        }
        break;
      case "/x402/accounts-feed/100":
        if (
          canServeAccountsFeedWithoutX({
            accounts: c.req.query("accounts") || "",
            limit: 100,
            since: c.req.query("since"),
            fresh: c.req.query("fresh"),
          })
        ) {
          return await handleStandardAccountsFeed(c, 100);
        }
        break;
      case "/x402/thread/100":
        if (canServeThreadWithoutX(getTweetId(c), getFresh(c))) {
          return await handleStandardThread(c);
        }
        break;
      case "/x402/trending/solana":
        if (
          canServeTrendingWithoutX("solana", {
            window: c.req.query("window"),
            top: c.req.query("top"),
            fresh: c.req.query("fresh"),
          })
        ) {
          return await handleStandardTrending(c, "solana");
        }
        break;
      case "/x402/trending/general":
        if (
          canServeTrendingWithoutX("general", {
            window: c.req.query("window"),
            top: c.req.query("top"),
            fresh: c.req.query("fresh"),
          })
        ) {
          return await handleStandardTrending(c, "general");
        }
        break;
    }
  } catch (error) {
    return toErrorResponse(c, error);
  }

  await next();
};

async function runMetered<T extends { data: unknown; meta: object; usage: { postsRead: number } }>(
  c: Context<ApiEnv>,
  reason: string,
  reserveMicrousd: number,
  warm: boolean,
  fetcher: () => Promise<T>
): Promise<Response> {
  const wallet = c.get("wallet");

  if (warm) {
    const result = await fetcher();
    const balance = getWalletBalance(wallet);
    return c.json({
      data: (result as any).data,
      meta: buildMeteredMeta(result.meta, 0, balance),
    });
  }

  const reservation = reserveWalletBalance(wallet, reserveMicrousd, reason);
  if (!reservation.ok) {
    return insufficientFundsResponse(c, wallet, reservation.balanceMicrousd, reserveMicrousd);
  }

  try {
    const result = await fetcher();
    const chargedMicrousd = result.usage.postsRead * POSTS_READ_MICRO_USD;
    const settled = settleReservation(reservation.reservationId, chargedMicrousd);
    if (!settled) {
      throw new Error("Failed to settle metered reservation.");
    }

    return c.json({
      data: (result as any).data,
      meta: buildMeteredMeta(result.meta, settled.chargedMicrousd, settled.balanceMicrousd),
    });
  } catch (error) {
    releaseReservation(reservation.reservationId);
    throw error;
  }
}

async function handleMeteredRead(c: Context<ApiEnv>): Promise<Response> {
  const tweetId = getTweetId(c);
  const fresh = getFresh(c);
  return runMetered(c, "read", reserveForRead(), canServeReadWithoutX(tweetId, fresh), () =>
    fetchRead(tweetId, fresh)
  );
}

async function handleMeteredSearch(c: Context<ApiEnv>): Promise<Response> {
  const request = {
    q: c.req.query("q"),
    limit: c.req.query("limit"),
    since: c.req.query("since"),
    sort: c.req.query("sort"),
    from: c.req.query("from"),
    min_likes: c.req.query("min_likes"),
    fresh: c.req.query("fresh"),
  };
  const limit = Number(request.limit || 20);
  return runMetered(
    c,
    "search",
    reserveForSearch(Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 20),
    canServeSearchWithoutX(request),
    () => fetchSearch(request)
  );
}

async function handleMeteredAccountsFeed(c: Context<ApiEnv>): Promise<Response> {
  const request = {
    accounts: c.req.query("accounts") || "",
    limit: c.req.query("limit"),
    since: c.req.query("since"),
    fresh: c.req.query("fresh"),
  };
  const limit = Number(request.limit || 20);
  return runMetered(
    c,
    "accounts-feed",
    reserveForSearch(Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 20),
    canServeAccountsFeedWithoutX(request),
    () => fetchAccountsFeed(request)
  );
}

async function handleMeteredThread(c: Context<ApiEnv>): Promise<Response> {
  const tweetId = getTweetId(c);
  const fresh = getFresh(c);
  return runMetered(
    c,
    "thread",
    reserveForThread(),
    canServeThreadWithoutX(tweetId, fresh),
    () => fetchThread(tweetId, fresh)
  );
}

async function handleMeteredTrending(c: Context<ApiEnv>): Promise<Response> {
  const kind: StandardTrendingKind =
    c.req.query("solanaOnly") === "true" || c.req.query("kind") === "solana"
      ? "solana"
      : "general";
  const request = {
    window: c.req.query("window"),
    top: c.req.query("top"),
    fresh: c.req.query("fresh"),
  };

  return runMetered(
    c,
    `trending:${kind}`,
    reserveForTrending(kind),
    canServeTrendingWithoutX(kind, request),
    () => fetchTrending(kind, request)
  );
}

async function handleBalance(c: Context<ApiEnv>): Promise<Response> {
  const wallet = c.get("wallet");
  const balanceMicrousd = getWalletBalance(wallet);

  return c.json({
    data: {
      wallet,
      balance_usd: microUsdToUsdNumber(balanceMicrousd),
    },
    meta: {
      mode: "metered",
      balance_usd_formatted: `$${formatUsd(balanceMicrousd)}`,
    },
  });
}

async function handleTopup(c: Context<ApiEnv>): Promise<Response> {
  const wallet = c.get("wallet");
  const amountUsd = Number(c.req.param("amount"));
  if (!TOPUP_SKUS_USD.includes(amountUsd as any)) {
    throw new HttpValidationError(404, "Unsupported top-up SKU.");
  }

  const paymentId = extractPaymentIdFromRequest(c);
  const existing = getTopup(paymentId);
  if (existing) {
    const balanceMicrousd = getWalletBalance(existing.wallet);
    return c.json({
      data: {
        wallet: existing.wallet,
        payment_identifier: paymentId,
        credited: false,
        balance_usd: microUsdToUsdNumber(balanceMicrousd),
      },
      meta: {
        mode: "metered-topup",
        duplicate_payment: true,
      },
    });
  }

  const amountMicrousd = usdToMicroUsd(amountUsd);
  const recorded = recordTopup(paymentId, wallet, amountMicrousd, c.req.path);

  return c.json({
    data: {
      wallet,
      payment_identifier: paymentId,
      credited: recorded.created,
      credited_usd: amountUsd,
      balance_usd: microUsdToUsdNumber(recorded.balanceMicrousd),
    },
    meta: {
      mode: "metered-topup",
      credited_usd_formatted: `$${amountUsd.toFixed(2)}`,
      balance_usd_formatted: `$${formatUsd(recorded.balanceMicrousd)}`,
    },
  });
}

const facilitatorUrl = requireEnv("X402_FACILITATOR_URL", ["FACILITATOR_URL"]);
const payTo = requireEnv("X402_PAY_TO", ["X402_RECEIVING_WALLET", "RECEIVING_WALLET"]);
const network = resolveSolanaNetwork(
  process.env.X402_NETWORK || process.env.X402_SOLANA_NETWORK
);

const facilitator = new HTTPFacilitatorClient({ url: facilitatorUrl });
const resourceServer = new x402ResourceServer(facilitator)
  .register(network, new ExactSvmScheme())
  .registerExtension(paymentIdentifierResourceServerExtension);

app.onError((error, c) => {
  return toErrorResponse(c, error);
});

app.get("/", (c) =>
  c.json({
    service: "ct-alpha",
    network,
    modes: ["standard", "metered"],
    standard_prefix: "/x402",
    metered_prefix: "/metered",
  })
);

app.post("/metered/auth/siwx", withErrors((c) => handleSiwxAuth(c, network)));
app.get("/metered/credits/balance", requireSession, withErrors(handleBalance));
app.use(
  "/metered/credits/topup/*",
  requireSession,
  paymentMiddleware(createTopupRoutes(payTo, network), resourceServer)
);
app.post("/metered/credits/topup/:amount", withErrors(handleTopup));

app.use(
  "/x402/*",
  standardFreeCacheMiddleware,
  paymentMiddleware(createStandardRoutes(payTo, network), resourceServer)
);
app.get("/x402/read", withErrors(handleStandardRead));
app.get("/x402/search/20", withErrors((c) => handleStandardSearch(c, 20)));
app.get("/x402/search/100", withErrors((c) => handleStandardSearch(c, 100)));
app.get("/x402/accounts-feed/20", withErrors((c) => handleStandardAccountsFeed(c, 20)));
app.get("/x402/accounts-feed/100", withErrors((c) => handleStandardAccountsFeed(c, 100)));
app.get("/x402/thread/100", withErrors(handleStandardThread));
app.get("/x402/trending/solana", withErrors((c) => handleStandardTrending(c, "solana")));
app.get("/x402/trending/general", withErrors((c) => handleStandardTrending(c, "general")));

app.use("/metered/read", requireSession);
app.use("/metered/search", requireSession);
app.use("/metered/accounts-feed", requireSession);
app.use("/metered/thread", requireSession);
app.use("/metered/trending", requireSession);
app.get("/metered/read", withErrors(handleMeteredRead));
app.get("/metered/search", withErrors(handleMeteredSearch));
app.get("/metered/accounts-feed", withErrors(handleMeteredAccountsFeed));
app.get("/metered/thread", withErrors(handleMeteredThread));
app.get("/metered/trending", withErrors(handleMeteredTrending));

const port = Number(process.env.PORT || 3000);

if (import.meta.main) {
  Bun.serve({
    port,
    fetch: app.fetch,
  });
  console.log(`ct-alpha API listening on http://localhost:${port}`);
}

export { app };

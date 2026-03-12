import {
  PAYMENT_IDENTIFIER,
  declarePaymentIdentifierExtension,
} from "@x402/extensions/payment-identifier";
import type { RoutesConfig } from "@x402/core/server";
import { getStandardRouteDiscoveryExtension } from "./http-public-docs";
import {
  fixedSearchPriceMicrousd,
  fixedThreadPriceMicrousd,
  fixedTrendingPriceMicrousd,
  formatUsdPrice,
  POSTS_READ_MICRO_USD,
  TOPUP_SKUS_USD,
  type SupportedSolanaNetwork,
} from "./http-pricing";

function json402Body(body: Record<string, unknown>) {
  return {
    contentType: "application/json",
    body: {
      payment_required: true,
      ...body,
    },
  };
}

export function createStandardRoutes(
  payTo: string,
  network: SupportedSolanaNetwork
): RoutesConfig {
  return {
    "GET /x402/read": {
      accepts: {
        scheme: "exact",
        price: formatUsdPrice(POSTS_READ_MICRO_USD),
        network,
        payTo,
      },
      description: "Read a single stripped tweet object.",
      mimeType: "application/json",
      extensions: getStandardRouteDiscoveryExtension("GET /x402/read"),
      unpaidResponseBody: () =>
        json402Body({
          mode: "standard",
          endpoint: "/x402/read",
          price_usd: formatUsdPrice(POSTS_READ_MICRO_USD),
        }),
    },
    "GET /x402/search/20": {
      accepts: {
        scheme: "exact",
        price: formatUsdPrice(fixedSearchPriceMicrousd(20)),
        network,
        payTo,
      },
      description: "Up to 20 CT search results using current ct-alpha query semantics.",
      mimeType: "application/json",
      extensions: getStandardRouteDiscoveryExtension("GET /x402/search/20"),
      unpaidResponseBody: () =>
        json402Body({
          mode: "standard",
          endpoint: "/x402/search/20",
          cap: 20,
          price_usd: formatUsdPrice(fixedSearchPriceMicrousd(20)),
        }),
    },
    "GET /x402/search/100": {
      accepts: {
        scheme: "exact",
        price: formatUsdPrice(fixedSearchPriceMicrousd(100)),
        network,
        payTo,
      },
      description: "Up to 100 CT search results using current ct-alpha query semantics.",
      mimeType: "application/json",
      extensions: getStandardRouteDiscoveryExtension("GET /x402/search/100"),
      unpaidResponseBody: () =>
        json402Body({
          mode: "standard",
          endpoint: "/x402/search/100",
          cap: 100,
          price_usd: formatUsdPrice(fixedSearchPriceMicrousd(100)),
        }),
    },
    "GET /x402/accounts-feed/20": {
      accepts: {
        scheme: "exact",
        price: formatUsdPrice(fixedSearchPriceMicrousd(20)),
        network,
        payTo,
      },
      description: "Up to 20 recent posts from caller-supplied accounts.",
      mimeType: "application/json",
      extensions: getStandardRouteDiscoveryExtension("GET /x402/accounts-feed/20"),
      unpaidResponseBody: () =>
        json402Body({
          mode: "standard",
          endpoint: "/x402/accounts-feed/20",
          cap: 20,
          price_usd: formatUsdPrice(fixedSearchPriceMicrousd(20)),
        }),
    },
    "GET /x402/accounts-feed/100": {
      accepts: {
        scheme: "exact",
        price: formatUsdPrice(fixedSearchPriceMicrousd(100)),
        network,
        payTo,
      },
      description: "Up to 100 recent posts from caller-supplied accounts.",
      mimeType: "application/json",
      extensions: getStandardRouteDiscoveryExtension("GET /x402/accounts-feed/100"),
      unpaidResponseBody: () =>
        json402Body({
          mode: "standard",
          endpoint: "/x402/accounts-feed/100",
          cap: 100,
          price_usd: formatUsdPrice(fixedSearchPriceMicrousd(100)),
        }),
    },
    "GET /x402/thread/100": {
      accepts: {
        scheme: "exact",
        price: formatUsdPrice(fixedThreadPriceMicrousd()),
        network,
        payTo,
      },
      description: "Read a root tweet and up to 100 thread tweets.",
      mimeType: "application/json",
      extensions: getStandardRouteDiscoveryExtension("GET /x402/thread/100"),
      unpaidResponseBody: () =>
        json402Body({
          mode: "standard",
          endpoint: "/x402/thread/100",
          cap: 100,
          price_usd: formatUsdPrice(fixedThreadPriceMicrousd()),
        }),
    },
    "GET /x402/trending/solana": {
      accepts: {
        scheme: "exact",
        price: formatUsdPrice(fixedTrendingPriceMicrousd("solana")),
        network,
        payTo,
      },
      description: "Up to 60 fetched posts from the Solana trending query plan.",
      mimeType: "application/json",
      extensions: getStandardRouteDiscoveryExtension("GET /x402/trending/solana"),
      unpaidResponseBody: () =>
        json402Body({
          mode: "standard",
          endpoint: "/x402/trending/solana",
          price_usd: formatUsdPrice(fixedTrendingPriceMicrousd("solana")),
        }),
    },
    "GET /x402/trending/general": {
      accepts: {
        scheme: "exact",
        price: formatUsdPrice(fixedTrendingPriceMicrousd("general")),
        network,
        payTo,
      },
      description: "Up to 90 fetched posts from the general trending query plan.",
      mimeType: "application/json",
      extensions: getStandardRouteDiscoveryExtension("GET /x402/trending/general"),
      unpaidResponseBody: () =>
        json402Body({
          mode: "standard",
          endpoint: "/x402/trending/general",
          price_usd: formatUsdPrice(fixedTrendingPriceMicrousd("general")),
        }),
    },
  };
}

export function createTopupRoutes(
  payTo: string,
  network: SupportedSolanaNetwork
): RoutesConfig {
  return Object.fromEntries(
    TOPUP_SKUS_USD.map((amountUsd) => [
      `POST /metered/credits/topup/${amountUsd}`,
      {
        accepts: {
          scheme: "exact",
          price: `$${amountUsd.toFixed(2)}`,
          network,
          payTo,
        },
        description: `Top up ct-alpha metered balance by $${amountUsd}.`,
        mimeType: "application/json",
        extensions: {
          [PAYMENT_IDENTIFIER]: declarePaymentIdentifierExtension(true),
        },
        unpaidResponseBody: () =>
          json402Body({
            mode: "metered-topup",
            endpoint: `/metered/credits/topup/${amountUsd}`,
            topup_usd: amountUsd,
          }),
      },
    ])
  );
}

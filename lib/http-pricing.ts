export const SOLANA_MAINNET_NETWORK =
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" as const;
export const SOLANA_DEVNET_NETWORK =
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" as const;
export const SOLANA_TESTNET_NETWORK =
  "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z" as const;

export const POSTS_READ_MICRO_USD = 5_000;
export const USER_READ_MICRO_USD = 10_000;
export const USD_MICRO_MULTIPLIER = 1_000_000;

export const SEARCH_CAPS = [20, 100] as const;
export const MAX_ACCOUNTS_PER_REQUEST = 20;
export const MAX_SEARCH_LIMIT = 100;
export const THREAD_RESULT_CAP = 100;
export const THREAD_RESERVE_POSTS = 101;
export const TRENDING_QUERY_CAP = 30;
export const SESSION_TTL_MS = 60 * 60 * 1000;
export const SIWX_NONCE_TTL_MS = 10 * 60 * 1000;
export const RESERVATION_TTL_MS = 10 * 60 * 1000;

export const TOPUP_SKUS_USD = [5, 10, 25, 50] as const;

export type TopupSku = (typeof TOPUP_SKUS_USD)[number];
export type StandardTrendingKind = "solana" | "general";
export type SupportedSolanaNetwork =
  | typeof SOLANA_MAINNET_NETWORK
  | typeof SOLANA_DEVNET_NETWORK
  | typeof SOLANA_TESTNET_NETWORK;

export function resolveSolanaNetwork(
  input: string | undefined | null
): SupportedSolanaNetwork {
  const raw = (input || "mainnet").trim();
  const normalized = raw.toLowerCase();

  switch (normalized) {
    case "mainnet":
    case "mainnet-beta":
      return SOLANA_MAINNET_NETWORK;
    case "devnet":
      return SOLANA_DEVNET_NETWORK;
    case "testnet":
      return SOLANA_TESTNET_NETWORK;
    default:
      if (raw === SOLANA_MAINNET_NETWORK) {
        return SOLANA_MAINNET_NETWORK;
      }
      if (raw === SOLANA_DEVNET_NETWORK) {
        return SOLANA_DEVNET_NETWORK;
      }
      if (raw === SOLANA_TESTNET_NETWORK) {
        return SOLANA_TESTNET_NETWORK;
      }
      throw new Error(
        `Unsupported X402 network "${input}". Use mainnet, devnet, testnet, or a supported Solana CAIP-2 identifier.`
      );
  }
}

export function usdToMicroUsd(value: number): number {
  return Math.round(value * USD_MICRO_MULTIPLIER);
}

export function microUsdToUsdNumber(value: number): number {
  return value / USD_MICRO_MULTIPLIER;
}

export function formatUsd(valueMicrousd: number): string {
  return microUsdToUsdNumber(valueMicrousd).toFixed(3).replace(/\.?0+$/, (match) => {
    return match === ".000" ? "" : match;
  });
}

export function formatUsdPrice(valueMicrousd: number): string {
  const whole = microUsdToUsdNumber(valueMicrousd);
  return `$${whole.toFixed(3)}`;
}

export function fixedSearchPriceMicrousd(limit: number): number {
  return limit * POSTS_READ_MICRO_USD;
}

export function fixedThreadPriceMicrousd(): number {
  return THREAD_RESERVE_POSTS * POSTS_READ_MICRO_USD;
}

export function fixedTrendingPriceMicrousd(kind: StandardTrendingKind): number {
  return kind === "solana"
    ? 2 * TRENDING_QUERY_CAP * POSTS_READ_MICRO_USD
    : 3 * TRENDING_QUERY_CAP * POSTS_READ_MICRO_USD;
}

export function reserveForSearch(limit: number): number {
  return limit * POSTS_READ_MICRO_USD;
}

export function reserveForRead(): number {
  return POSTS_READ_MICRO_USD;
}

export function reserveForThread(): number {
  return THREAD_RESERVE_POSTS * POSTS_READ_MICRO_USD;
}

export function reserveForTrending(kind: StandardTrendingKind): number {
  return fixedTrendingPriceMicrousd(kind);
}

export function recommendedTopup(requiredMicrousd: number): TopupSku {
  const shortageUsd = microUsdToUsdNumber(requiredMicrousd);
  for (const sku of TOPUP_SKUS_USD) {
    if (sku >= shortageUsd) {
      return sku;
    }
  }
  return TOPUP_SKUS_USD[TOPUP_SKUS_USD.length - 1];
}

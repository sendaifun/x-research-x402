import { describe, expect, test } from "bun:test";
import { parseTweetInput, HttpValidationError } from "../lib/http-service";
import {
  fixedSearchPriceMicrousd,
  fixedThreadPriceMicrousd,
  fixedTrendingPriceMicrousd,
  recommendedTopup,
  resolveSolanaNetwork,
  SOLANA_DEVNET_NETWORK,
} from "../lib/http-pricing";

describe("parseTweetInput", () => {
  test("accepts raw tweet IDs", () => {
    expect(parseTweetInput("1234567890")).toBe("1234567890");
  });

  test("extracts IDs from status URLs", () => {
    expect(parseTweetInput("https://x.com/someuser/status/9876543210?s=20")).toBe(
      "9876543210"
    );
  });

  test("rejects invalid inputs", () => {
    expect(() => parseTweetInput("not-a-tweet")).toThrow(HttpValidationError);
  });
});

describe("pricing helpers", () => {
  test("computes fixed SKU prices from the X per-post rate", () => {
    expect(fixedSearchPriceMicrousd(20)).toBe(100_000);
    expect(fixedThreadPriceMicrousd()).toBe(505_000);
    expect(fixedTrendingPriceMicrousd("solana")).toBe(300_000);
    expect(fixedTrendingPriceMicrousd("general")).toBe(450_000);
  });

  test("recommends the smallest available top-up that covers the shortfall", () => {
    expect(recommendedTopup(usdToMicrousd(2.1))).toBe(5);
    expect(recommendedTopup(usdToMicrousd(24))).toBe(25);
    expect(recommendedTopup(usdToMicrousd(80))).toBe(50);
  });

  test("accepts CAIP-2 network identifiers without lowercasing away the genesis hash", () => {
    expect(resolveSolanaNetwork(SOLANA_DEVNET_NETWORK)).toBe(SOLANA_DEVNET_NETWORK);
  });
});

function usdToMicrousd(value: number): number {
  return Math.round(value * 1_000_000);
}

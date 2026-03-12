import { readFileSync } from "fs";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { toClientSvmSigner } from "@x402/svm";
import {
  ApiResponseError,
  MeteredApiClient,
  buildQueryPath,
  type ApiResult,
  type Json,
  type JsonObject,
} from "../lib/metered-client";

type RouteSummary = {
  label: string;
  status: number;
  transaction?: string;
  meta?: Json;
  details?: Json;
};

const payerPath =
  process.env.X402_PAYER_KEYPAIR ||
  `${import.meta.dir}/../data/runtime/devnet-payer.json`;
const baseUrl = (process.env.X402_E2E_BASE_URL || "http://localhost:3001").replace(/\/+$/, "");
const scope = (process.env.X402_E2E_SCOPE || "all").toLowerCase();

const payerSecret = new Uint8Array(
  JSON.parse(readFileSync(payerPath, "utf-8")) as number[]
);
const payerSigner = toClientSvmSigner(await createKeyPairSignerFromBytes(payerSecret));
const apiClient = new MeteredApiClient({
  baseUrl,
  paymentSigner: payerSigner,
});

function expectObject(value: Json, context: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context}: expected object response`);
  }

  return value as JsonObject;
}

function summarizeResult(
  label: string,
  result: ApiResult,
  details?: Json
): RouteSummary {
  const summary: RouteSummary = {
    label,
    status: result.status,
    transaction: result.transaction,
    meta: result.body.meta ?? null,
    details,
  };

  const parts = [`[pass] ${label} status=${result.status}`];
  if (result.transaction) {
    parts.push(`tx=${result.transaction}`);
  }
  if (result.body.meta) {
    parts.push(`meta=${JSON.stringify(result.body.meta)}`);
  }
  if (details !== undefined) {
    parts.push(`details=${JSON.stringify(details)}`);
  }
  console.log(parts.join(" "));

  return summary;
}

async function payProtected(
  label: string,
  path: string,
  init: RequestInit = {}
): Promise<{ body: JsonObject; summary: RouteSummary }> {
  const result = await apiClient.payProtectedJson(path, init);
  return {
    body: result.body,
    summary: summarizeResult(label, result),
  };
}

async function getJson(
  label: string,
  path: string,
  init?: RequestInit
): Promise<{ body: JsonObject; summary: RouteSummary }> {
  const result = await apiClient.requestJson(path, init);
  return {
    body: result.body,
    summary: summarizeResult(label, result),
  };
}

async function testMeteredInsufficientFunds(sessionToken: string): Promise<RouteSummary> {
  try {
    await apiClient.search(sessionToken, {
      q: "solana",
      limit: 20,
      since: "24h",
      fresh: true,
    });
  } catch (error) {
    if (!(error instanceof ApiResponseError) || error.status !== 402) {
      throw error;
    }

    const body = expectObject(error.body, "metered.search.insufficient");
    const details = {
      required_reserve_usd: body.required_reserve_usd ?? null,
      recommended_topup_usd: body.recommended_topup_usd ?? null,
    };
    console.log(
      `[pass] metered.search.insufficient status=402 details=${JSON.stringify(details)}`
    );

    return {
      label: "metered.search.insufficient",
      status: 402,
      details,
    };
  }

  throw new Error("metered.search.insufficient: expected 402 for an unfunded session");
}

async function main() {
  console.log(`payer: ${payerSigner.address}`);
  console.log(`base_url: ${baseUrl}`);
  console.log(`scope: ${scope}`);

  const summaries: RouteSummary[] = [];
  let seedTweet: JsonObject | undefined;
  let feedAccounts = "";

  if (scope === "all" || scope === "standard") {
    const standardSearch20 = await payProtected(
      "standard.search.20",
      buildQueryPath("x402/search/20", {
        q: "solana",
        since: "24h",
        fresh: true,
      })
    );
    summaries.push(standardSearch20.summary);

    const search20Data = Array.isArray(standardSearch20.body.data)
      ? (standardSearch20.body.data as JsonObject[])
      : [];
    if (search20Data.length === 0) {
      throw new Error(
        "standard.search.20 returned no tweets; cannot seed read/thread/accounts tests"
      );
    }

    seedTweet = search20Data[0];
    const uniqueAccounts = [...new Set(search20Data.map((tweet) => tweet.username).filter(Boolean))];
    feedAccounts = uniqueAccounts.slice(0, 3).join(",");
    if (!feedAccounts) {
      throw new Error("Failed to derive sample accounts from search results.");
    }

    summaries.push(
      (
        await payProtected(
          "standard.read",
          buildQueryPath("x402/read", {
            tweetId: String(seedTweet.id),
            fresh: true,
          })
        )
      ).summary
    );
    summaries.push(
      (
        await payProtected(
          "standard.search.100",
          buildQueryPath("x402/search/100", {
            q: "solana",
            since: "24h",
            fresh: true,
          })
        )
      ).summary
    );
    summaries.push(
      (
        await payProtected(
          "standard.accounts-feed.20",
          buildQueryPath("x402/accounts-feed/20", {
            accounts: feedAccounts,
            since: "24h",
            fresh: true,
          })
        )
      ).summary
    );
    summaries.push(
      (
        await payProtected(
          "standard.accounts-feed.100",
          buildQueryPath("x402/accounts-feed/100", {
            accounts: feedAccounts,
            since: "24h",
            fresh: true,
          })
        )
      ).summary
    );
    summaries.push(
      (
        await payProtected(
          "standard.thread.100",
          buildQueryPath("x402/thread/100", {
            tweetId: String(seedTweet.id),
            fresh: true,
          })
        )
      ).summary
    );
    summaries.push(
      (
        await payProtected(
          "standard.trending.solana",
          buildQueryPath("x402/trending/solana", {
            window: "6h",
            top: 5,
            fresh: true,
          })
        )
      ).summary
    );
    summaries.push(
      (
        await payProtected(
          "standard.trending.general",
          buildQueryPath("x402/trending/general", {
            window: "6h",
            top: 5,
            fresh: true,
          })
        )
      ).summary
    );
  }

  if (scope === "metered") {
    const seedSearch = await payProtected(
      "metered.seed.search.20",
      buildQueryPath("x402/search/20", {
        q: "solana",
        since: "24h",
        fresh: true,
      })
    );
    const seedSearchData = Array.isArray(seedSearch.body.data)
      ? (seedSearch.body.data as JsonObject[])
      : [];
    if (seedSearchData.length === 0) {
      throw new Error("metered.seed.search.20 returned no tweets.");
    }

    seedTweet = seedSearchData[0];
    const uniqueAccounts = [...new Set(seedSearchData.map((tweet) => tweet.username).filter(Boolean))];
    feedAccounts = uniqueAccounts.slice(0, 3).join(",");
  }

  if (!seedTweet || !feedAccounts) {
    throw new Error("Missing seed tweet/accounts for metered route tests.");
  }

  const auth = await apiClient.authenticate();
  summaries.push(
    summarizeResult("metered.auth.siwx", auth.response, {
      wallet: auth.session.wallet,
      expires_at: auth.session.expiresAt,
    })
  );

  summaries.push(
    summarizeResult(
      "metered.balance.initial",
      await apiClient.getBalance(auth.session.sessionToken)
    )
  );
  summaries.push(await testMeteredInsufficientFunds(auth.session.sessionToken));
  summaries.push(
    summarizeResult(
      "metered.topup.5",
      await apiClient.topup(auth.session.sessionToken, 5)
    )
  );
  summaries.push(
    summarizeResult(
      "metered.balance.after-topup",
      await apiClient.getBalance(auth.session.sessionToken)
    )
  );
  summaries.push(
    summarizeResult(
      "metered.read",
      await apiClient.read(auth.session.sessionToken, {
        tweetId: String(seedTweet.id),
        fresh: true,
      })
    )
  );
  summaries.push(
    summarizeResult(
      "metered.search",
      await apiClient.search(auth.session.sessionToken, {
        q: "solana",
        limit: 20,
        since: "24h",
        fresh: true,
      })
    )
  );
  summaries.push(
    summarizeResult(
      "metered.accounts-feed",
      await apiClient.accountsFeed(auth.session.sessionToken, {
        accounts: feedAccounts,
        limit: 20,
        since: "24h",
        fresh: true,
      })
    )
  );
  summaries.push(
    summarizeResult(
      "metered.thread",
      await apiClient.thread(auth.session.sessionToken, {
        tweetId: String(seedTweet.id),
        fresh: true,
      })
    )
  );
  summaries.push(
    summarizeResult(
      "metered.trending.general",
      await apiClient.trending(auth.session.sessionToken, {
        kind: "general",
        window: "6h",
        top: 5,
        fresh: true,
      })
    )
  );
  summaries.push(
    summarizeResult(
      "metered.trending.solana",
      await apiClient.trending(auth.session.sessionToken, {
        kind: "solana",
        window: "6h",
        top: 5,
        fresh: true,
      })
    )
  );
  summaries.push(
    summarizeResult(
      "metered.balance.final",
      await apiClient.getBalance(auth.session.sessionToken)
    )
  );

  console.log("\nsummary:");
  console.log(JSON.stringify(summaries, null, 2));
}

await main();

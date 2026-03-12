import { randomBytes } from "crypto";
import { generateKeyPairSigner } from "@solana/kit";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import {
  appendPaymentIdentifierToExtensions,
  createSIWxPayload,
  encodeSIWxHeader,
} from "@x402/extensions";
import { ExactSvmScheme, toClientSvmSigner } from "@x402/svm";
import {
  resolveSolanaNetwork,
  SOLANA_MAINNET_NETWORK,
  type StandardTrendingKind,
  type SupportedSolanaNetwork,
} from "./http-pricing";

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

export type JsonObject = Record<string, Json>;
export type MeteredPaymentSigner = Parameters<typeof toClientSvmSigner>[0];
export type MeteredAuthSigner = Parameters<typeof createSIWxPayload>[1];
export type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Array<string | number>;

export interface ApiResult<TBody extends JsonObject = JsonObject> {
  body: TBody;
  headers: Headers;
  status: number;
  transaction?: string;
}

export interface MeteredClientOptions {
  baseUrl: string;
  paymentSigner: MeteredPaymentSigner;
  network?: SupportedSolanaNetwork | string;
  authStatement?: string;
}

export interface MeteredSession {
  wallet: string;
  sessionToken: string;
  expiresAt: string;
  balanceUsd: number;
}

export interface AuthenticateResult {
  signer: MeteredAuthSigner;
  session: MeteredSession;
  response: ApiResult;
}

export interface MeteredReadParams {
  tweetId: string;
  fresh?: boolean;
}

export interface MeteredSearchParams {
  q: string;
  limit?: number;
  since?: string;
  sort?: "relevancy" | "recency" | "likes" | "retweets" | "impressions" | "bookmarks";
  from?: string | string[];
  minLikes?: number;
  fresh?: boolean;
}

export interface MeteredAccountsFeedParams {
  accounts: string | string[];
  limit?: number;
  since?: string;
  fresh?: boolean;
}

export interface MeteredTrendingParams {
  window?: string;
  top?: number;
  fresh?: boolean;
  kind?: StandardTrendingKind;
  solanaOnly?: boolean;
}

export class ApiResponseError extends Error {
  body: Json;
  headers: Headers;
  status: number;

  constructor(status: number, body: Json, headers: Headers, message?: string) {
    super(message || `HTTP ${status}: ${JSON.stringify(body)}`);
    this.name = "ApiResponseError";
    this.status = status;
    this.body = body;
    this.headers = headers;
  }
}

export function buildQueryPath(
  path: string,
  query: Record<string, QueryValue> = {}
): string {
  const [pathname, existingQuery = ""] = path.split("?");
  const search = new URLSearchParams(existingQuery);

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        continue;
      }
      search.set(key, value.join(","));
      continue;
    }

    search.set(key, typeof value === "boolean" ? String(value) : String(value));
  }

  const queryString = search.toString();
  return queryString ? `${pathname}?${queryString}` : pathname;
}

function assertJsonObject(value: Json, context: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context}: expected object response`);
  }

  return value as JsonObject;
}

async function parseResponseBody(response: Response): Promise<Json> {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as Json;
  } catch {
    return text;
  }
}

export class MeteredApiClient {
  readonly authStatement: string;
  readonly baseUrl: string;

  private readonly httpClient: x402HTTPClient;
  private network?: SupportedSolanaNetwork;
  private networkPromise?: Promise<SupportedSolanaNetwork>;

  constructor(options: MeteredClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.authStatement = options.authStatement || "Sign in to access ct-alpha metered API";
    this.network = options.network
      ? resolveSolanaNetwork(options.network)
      : undefined;
    this.httpClient = new x402HTTPClient(
      new x402Client().register(
        "solana:*",
        new ExactSvmScheme(toClientSvmSigner(options.paymentSigner))
      )
    );
  }

  async authenticate(authSigner?: MeteredAuthSigner): Promise<AuthenticateResult> {
    const signer =
      authSigner || ((await generateKeyPairSigner()) as unknown as MeteredAuthSigner);
    const authPath = "metered/auth/siwx";
    const authUrl = this.buildUrl(authPath);
    const payload = await createSIWxPayload(
      {
        domain: new URL(authUrl).hostname,
        uri: authUrl,
        version: "1",
        statement: this.authStatement,
        nonce: randomBytes(16).toString("hex"),
        issuedAt: new Date().toISOString(),
        resources: [authUrl],
        chainId: await this.getNetwork(),
        type: "ed25519",
      },
      signer
    );

    const response = await this.requestJson("metered/auth/siwx", {
      method: "POST",
      headers: {
        "SIGN-IN-WITH-X": encodeSIWxHeader(payload),
      },
    });

    const data = assertJsonObject(response.body.data ?? null, "metered.auth.siwx.data");
    return {
      signer,
      session: {
        wallet: String(data.wallet),
        sessionToken: String(data.session_token),
        expiresAt: String(data.expires_at),
        balanceUsd: Number(data.balance_usd),
      },
      response,
    };
  }

  async getBalance(sessionToken: string): Promise<ApiResult> {
    return this.requestJson("metered/credits/balance", {
      headers: this.withSessionHeaders(sessionToken),
    });
  }

  async topup(sessionToken: string, amountUsd: number): Promise<ApiResult> {
    return this.payProtectedJson(`metered/credits/topup/${amountUsd}`, {
      method: "POST",
      headers: this.withSessionHeaders(sessionToken),
    });
  }

  async read(sessionToken: string, params: MeteredReadParams): Promise<ApiResult> {
    return this.requestJson(
      buildQueryPath("metered/read", {
        tweetId: params.tweetId,
        fresh: params.fresh,
      }),
      {
        headers: this.withSessionHeaders(sessionToken),
      }
    );
  }

  async search(sessionToken: string, params: MeteredSearchParams): Promise<ApiResult> {
    return this.requestJson(
      buildQueryPath("metered/search", {
        q: params.q,
        limit: params.limit,
        since: params.since,
        sort: params.sort,
        from: params.from,
        min_likes: params.minLikes,
        fresh: params.fresh,
      }),
      {
        headers: this.withSessionHeaders(sessionToken),
      }
    );
  }

  async accountsFeed(
    sessionToken: string,
    params: MeteredAccountsFeedParams
  ): Promise<ApiResult> {
    return this.requestJson(
      buildQueryPath("metered/accounts-feed", {
        accounts: params.accounts,
        limit: params.limit,
        since: params.since,
        fresh: params.fresh,
      }),
      {
        headers: this.withSessionHeaders(sessionToken),
      }
    );
  }

  async thread(sessionToken: string, params: MeteredReadParams): Promise<ApiResult> {
    return this.requestJson(
      buildQueryPath("metered/thread", {
        tweetId: params.tweetId,
        fresh: params.fresh,
      }),
      {
        headers: this.withSessionHeaders(sessionToken),
      }
    );
  }

  async trending(
    sessionToken: string,
    params: MeteredTrendingParams = {}
  ): Promise<ApiResult> {
    const kind = params.kind || (params.solanaOnly ? "solana" : "general");
    return this.requestJson(
      buildQueryPath("metered/trending", {
        window: params.window,
        top: params.top,
        fresh: params.fresh,
        solanaOnly: kind === "solana" ? true : undefined,
      }),
      {
        headers: this.withSessionHeaders(sessionToken),
      }
    );
  }

  async payProtectedJson(
    path: string,
    init: RequestInit = {}
  ): Promise<ApiResult> {
    const url = this.buildUrl(path);
    const unpaid = await fetch(url, init);
    const unpaidBody = await parseResponseBody(unpaid);
    if (unpaid.status !== 402) {
      throw new ApiResponseError(
        unpaid.status,
        unpaidBody,
        unpaid.headers,
        `Expected 402 before paying ${url}, got ${unpaid.status}`
      );
    }

    const paymentRequired = this.httpClient.getPaymentRequiredResponse(
      (name) => unpaid.headers.get(name),
      unpaidBody
    );
    const paymentPayload = await this.httpClient.createPaymentPayload(paymentRequired);
    paymentPayload.extensions = appendPaymentIdentifierToExtensions(
      paymentPayload.extensions ?? {}
    ) as Record<string, unknown>;

    const paidHeaders = new Headers(init.headers);
    for (const [key, value] of Object.entries(
      this.httpClient.encodePaymentSignatureHeader(paymentPayload)
    )) {
      paidHeaders.set(key, value);
    }

    const paid = await fetch(url, {
      ...init,
      headers: paidHeaders,
    });
    const paidBody = await parseResponseBody(paid);
    if (!paid.ok) {
      throw new ApiResponseError(paid.status, paidBody, paid.headers);
    }

    return {
      body: assertJsonObject(paidBody, path),
      headers: paid.headers,
      status: paid.status,
      transaction: this.httpClient.getPaymentSettleResponse((name) =>
        paid.headers.get(name)
      ).transaction,
    };
  }

  async requestJson(path: string, init: RequestInit = {}): Promise<ApiResult> {
    const response = await fetch(this.buildUrl(path), init);
    const body = await parseResponseBody(response);
    if (!response.ok) {
      throw new ApiResponseError(response.status, body, response.headers);
    }

    return {
      body: assertJsonObject(body, path),
      headers: response.headers,
      status: response.status,
    };
  }

  private buildUrl(path: string): string {
    if (/^https?:\/\//i.test(path)) {
      return path;
    }

    const base = this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`;
    const relative = path.replace(/^\/+/, "");
    return new URL(relative, base).toString();
  }

  private async getNetwork(): Promise<SupportedSolanaNetwork> {
    if (this.network) {
      return this.network;
    }

    if (!this.networkPromise) {
      this.networkPromise = (async () => {
        const response = await this.requestJson("");
        const network = response.body.network;
        if (typeof network !== "string" || !network) {
          return SOLANA_MAINNET_NETWORK;
        }
        return resolveSolanaNetwork(network);
      })();
    }

    this.network = await this.networkPromise;
    return this.network;
  }

  private withSessionHeaders(sessionToken: string): Headers {
    return new Headers({
      Authorization: `Bearer ${sessionToken}`,
    });
  }
}

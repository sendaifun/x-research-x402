import type { Context, MiddlewareHandler } from "hono";
import {
  parseSIWxHeader,
  validateSIWxMessage,
  verifySIWxSignature,
} from "@x402/extensions/sign-in-with-x";
import {
  createSession,
  getSession,
  isSiwxNonceAvailable,
  markSiwxNonceUsed,
} from "./runtime-store";
import { formatUsd, microUsdToUsdNumber } from "./http-pricing";
import { getWalletBalance } from "./runtime-store";
import type { SupportedSolanaNetwork } from "./http-pricing";

export interface ApiEnv {
  Variables: {
    sessionToken: string;
    wallet: string;
  };
}

async function getSiwxHeader(c: Context): Promise<string | null> {
  const header = c.req.header("SIGN-IN-WITH-X");
  if (header) {
    return header;
  }

  try {
    const body = await c.req.json();
    if (body && typeof body === "object" && "siwx" in body && typeof body.siwx === "string") {
      return body.siwx;
    }
  } catch {}

  return null;
}

function getBearerToken(c: Context): string | null {
  const authHeader = c.req.header("Authorization");
  if (!authHeader) {
    return null;
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

export async function handleSiwxAuth(
  c: Context,
  expectedNetwork: SupportedSolanaNetwork
): Promise<Response> {
  const header = await getSiwxHeader(c);
  if (!header) {
    return c.json(
      { error: "SIGN-IN-WITH-X header is required for wallet authentication." },
      400
    );
  }

  let payload;
  try {
    payload = parseSIWxHeader(header);
  } catch (error: any) {
    return c.json(
      { error: error.message || "Invalid SIGN-IN-WITH-X header." },
      { status: 400 }
    );
  }

  if (payload.chainId !== expectedNetwork) {
    return c.json(
      {
        error: `Unsupported chain ${payload.chainId}. Expected ${expectedNetwork}.`,
      },
      { status: 400 }
    );
  }

  const validation = await validateSIWxMessage(payload, c.req.url, {
    checkNonce: (nonce) => isSiwxNonceAvailable(nonce),
  });
  if (!validation.valid) {
    return c.json(
      { error: validation.error || "Invalid SIWx message." },
      { status: 401 }
    );
  }

  const verification = await verifySIWxSignature(payload);
  if (!verification.valid) {
    return c.json(
      { error: verification.error || "Invalid SIWx signature." },
      { status: 401 }
    );
  }

  await markSiwxNonceUsed(payload.nonce);
  const wallet = verification.address || payload.address;
  const session = await createSession(wallet);
  const balanceMicrousd = await getWalletBalance(wallet);

  return c.json({
    data: {
      wallet,
      session_token: session.token,
      expires_at: new Date(session.expiresAt).toISOString(),
      balance_usd: microUsdToUsdNumber(balanceMicrousd),
    },
    meta: {
      authenticated: true,
      balance_usd_formatted: `$${formatUsd(balanceMicrousd)}`,
    },
  });
}

export const requireSession: MiddlewareHandler<ApiEnv> = async (c, next) => {
  const token = getBearerToken(c);
  if (!token) {
    return c.json(
      { error: "Authorization: Bearer <session> is required." },
      { status: 401 }
    );
  }

  const session = await getSession(token);
  if (!session) {
    return c.json({ error: "Session is missing or expired." }, { status: 401 });
  }

  c.set("sessionToken", session.token);
  c.set("wallet", session.wallet);
  await next();
};

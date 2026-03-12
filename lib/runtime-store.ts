import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { randomUUID } from "crypto";
import { join } from "path";
import { getRedis, hasRedisConfigured, redisKey } from "./redis";
import {
  RESERVATION_TTL_MS,
  SESSION_TTL_MS,
  SIWX_NONCE_TTL_MS,
} from "./http-pricing";

const RUNTIME_DIR = join(import.meta.dir, "..", "data", "runtime");
const STATE_FILE = join(RUNTIME_DIR, "state.json");
const RUNTIME_STATE_KEY = redisKey("runtime", "state");
const SESSION_NAMESPACE = "session";
const NONCE_NAMESPACE = "siwx-nonce";
const BALANCE_NAMESPACE = "balance";
const TOPUP_NAMESPACE = "topup";
const RESERVATION_NAMESPACE = "reservation";
const RESERVATION_EXPIRY_KEY = redisKey("reservation", "expiries");

const RESERVE_SCRIPT = `
local balanceKey = KEYS[1]
local reservationKey = KEYS[2]
local expiryKey = KEYS[3]
local wallet = ARGV[1]
local reservationId = ARGV[2]
local amount = tonumber(ARGV[3])
local createdAt = tonumber(ARGV[4])
local expiresAt = tonumber(ARGV[5])
local reason = ARGV[6]
local balance = tonumber(redis.call('GET', balanceKey) or '0')
if balance < amount then
  return {0, tostring(balance)}
end
redis.call('DECRBY', balanceKey, amount)
redis.call(
  'SET',
  reservationKey,
  cjson.encode({
    id = reservationId,
    wallet = wallet,
    amountMicrousd = amount,
    createdAt = createdAt,
    expiresAt = expiresAt,
    reason = reason
  })
)
redis.call('ZADD', expiryKey, expiresAt, reservationId)
return {1, tostring(balance - amount)}
`;

const SETTLE_SCRIPT = `
local reservationKey = KEYS[1]
local expiryKey = KEYS[2]
local balancePrefix = ARGV[1]
local reservationId = ARGV[2]
local actualCharge = tonumber(ARGV[3])
local raw = redis.call('GET', reservationKey)
if not raw then
  return {0}
end
local reservation = cjson.decode(raw)
local wallet = reservation.wallet
local reserved = tonumber(reservation.amountMicrousd) or 0
local charged = actualCharge
if charged > reserved then
  charged = reserved
end
local refund = reserved - charged
local balanceKey = balancePrefix .. wallet
local balance = tonumber(redis.call('GET', balanceKey) or '0')
if refund > 0 then
  balance = redis.call('INCRBY', balanceKey, refund)
end
redis.call('DEL', reservationKey)
redis.call('ZREM', expiryKey, reservationId)
return {1, wallet, tostring(balance), tostring(charged)}
`;

const RELEASE_SCRIPT = `
local reservationKey = KEYS[1]
local expiryKey = KEYS[2]
local balancePrefix = ARGV[1]
local reservationId = ARGV[2]
local raw = redis.call('GET', reservationKey)
if not raw then
  return {0}
end
local reservation = cjson.decode(raw)
local wallet = reservation.wallet
local amount = tonumber(reservation.amountMicrousd) or 0
local balance = redis.call('INCRBY', balancePrefix .. wallet, amount)
redis.call('DEL', reservationKey)
redis.call('ZREM', expiryKey, reservationId)
return {1, wallet, tostring(balance)}
`;

const PRUNE_RESERVATIONS_SCRIPT = `
local expiryKey = KEYS[1]
local reservationPrefix = ARGV[1]
local balancePrefix = ARGV[2]
local now = tonumber(ARGV[3])
local ids = redis.call('ZRANGEBYSCORE', expiryKey, '-inf', now)
for _, reservationId in ipairs(ids) do
  local key = reservationPrefix .. reservationId
  local raw = redis.call('GET', key)
  if raw then
    local reservation = cjson.decode(raw)
    local wallet = reservation.wallet
    local amount = tonumber(reservation.amountMicrousd) or 0
    if wallet and amount > 0 then
      redis.call('INCRBY', balancePrefix .. wallet, amount)
    end
    redis.call('DEL', key)
  end
end
if #ids > 0 then
  redis.call('ZREM', expiryKey, unpack(ids))
end
return #ids
`;

const RECORD_TOPUP_SCRIPT = `
local topupKey = KEYS[1]
local balanceKey = KEYS[2]
local paymentId = ARGV[1]
local wallet = ARGV[2]
local amount = tonumber(ARGV[3])
local createdAt = tonumber(ARGV[4])
local route = ARGV[5]
if redis.call('EXISTS', topupKey) == 1 then
  return {0, tostring(redis.call('GET', balanceKey) or '0')}
end
redis.call(
  'SET',
  topupKey,
  cjson.encode({
    paymentId = paymentId,
    wallet = wallet,
    amountMicrousd = amount,
    createdAt = createdAt,
    route = route
  })
)
local balance = redis.call('INCRBY', balanceKey, amount)
return {1, tostring(balance)}
`;

export interface SessionRecord {
  token: string;
  wallet: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
}

interface UsedNonceRecord {
  nonce: string;
  usedAt: number;
  expiresAt: number;
}

interface ReservationRecord {
  id: string;
  wallet: string;
  amountMicrousd: number;
  createdAt: number;
  expiresAt: number;
  reason: string;
}

interface TopupRecord {
  paymentId: string;
  wallet: string;
  amountMicrousd: number;
  createdAt: number;
  route: string;
}

interface RuntimeState {
  sessions: Record<string, SessionRecord>;
  usedSiwxNonces: Record<string, UsedNonceRecord>;
  walletBalances: Record<string, number>;
  reservations: Record<string, ReservationRecord>;
  topups: Record<string, TopupRecord>;
}

const EMPTY_STATE: RuntimeState = {
  sessions: {},
  usedSiwxNonces: {},
  walletBalances: {},
  reservations: {},
  topups: {},
};

function ensureRuntimeDir(): void {
  if (!existsSync(RUNTIME_DIR)) {
    mkdirSync(RUNTIME_DIR, { recursive: true });
  }
}

function pruneState(state: RuntimeState): RuntimeState {
  const now = Date.now();

  for (const [token, session] of Object.entries(state.sessions)) {
    if (session.expiresAt <= now) {
      delete state.sessions[token];
    }
  }

  for (const [nonce, record] of Object.entries(state.usedSiwxNonces)) {
    if (record.expiresAt <= now) {
      delete state.usedSiwxNonces[nonce];
    }
  }

  for (const [id, reservation] of Object.entries(state.reservations)) {
    if (reservation.expiresAt <= now) {
      state.walletBalances[reservation.wallet] =
        (state.walletBalances[reservation.wallet] || 0) + reservation.amountMicrousd;
      delete state.reservations[id];
    }
  }

  return state;
}

function loadLocalState(): RuntimeState {
  ensureRuntimeDir();

  try {
    if (!existsSync(STATE_FILE)) {
      return structuredClone(EMPTY_STATE);
    }

    const raw = readFileSync(STATE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as RuntimeState;
    return pruneState({
      sessions: parsed.sessions || {},
      usedSiwxNonces: parsed.usedSiwxNonces || {},
      walletBalances: parsed.walletBalances || {},
      reservations: parsed.reservations || {},
      topups: parsed.topups || {},
    });
  } catch {
    return structuredClone(EMPTY_STATE);
  }
}

function saveLocalState(state: RuntimeState): void {
  ensureRuntimeDir();
  writeFileSync(STATE_FILE, JSON.stringify(pruneState(state), null, 2), "utf-8");
}

function mutateLocalState<T>(fn: (state: RuntimeState) => T): T {
  const state = loadLocalState();
  const result = fn(state);
  saveLocalState(state);
  return result;
}

function sessionRedisKey(token: string): string {
  return redisKey(SESSION_NAMESPACE, token);
}

function nonceRedisKey(nonce: string): string {
  return redisKey(NONCE_NAMESPACE, nonce);
}

function balanceRedisKey(wallet: string): string {
  return redisKey(BALANCE_NAMESPACE, wallet);
}

function topupRedisKey(paymentId: string): string {
  return redisKey(TOPUP_NAMESPACE, paymentId);
}

function reservationRedisKey(reservationId: string): string {
  return redisKey(RESERVATION_NAMESPACE, reservationId);
}

function reservationRedisKeyPrefix(): string {
  return `${redisKey(RESERVATION_NAMESPACE, "")}`;
}

function balanceRedisKeyPrefix(): string {
  return `${redisKey(BALANCE_NAMESPACE, "")}`;
}

function parseJsonRecord<T>(raw: string | null): T | null {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function pruneExpiredRedisReservations(): Promise<void> {
  if (!hasRedisConfigured()) {
    return;
  }

  const redis = await getRedis();
  await redis.eval(PRUNE_RESERVATIONS_SCRIPT, {
    keys: [RESERVATION_EXPIRY_KEY],
    arguments: [
      reservationRedisKeyPrefix(),
      balanceRedisKeyPrefix(),
      String(Date.now()),
    ],
  });
}

async function getRedisBalance(wallet: string): Promise<number> {
  await pruneExpiredRedisReservations();
  const redis = await getRedis();
  const balance = await redis.get(balanceRedisKey(wallet));
  return Number(balance || 0);
}

export async function createSession(
  wallet: string,
  ttlMs: number = SESSION_TTL_MS
): Promise<SessionRecord> {
  if (!hasRedisConfigured()) {
    return mutateLocalState((state) => {
      const token = randomUUID().replace(/-/g, "");
      const now = Date.now();
      const session: SessionRecord = {
        token,
        wallet,
        createdAt: now,
        expiresAt: now + ttlMs,
        lastSeenAt: now,
      };

      state.sessions[token] = session;
      return session;
    });
  }

  const token = randomUUID().replace(/-/g, "");
  const now = Date.now();
  const session: SessionRecord = {
    token,
    wallet,
    createdAt: now,
    expiresAt: now + ttlMs,
    lastSeenAt: now,
  };

  const redis = await getRedis();
  await redis.set(sessionRedisKey(token), JSON.stringify(session), { PX: ttlMs });
  return session;
}

export async function getSession(token: string): Promise<SessionRecord | null> {
  if (!hasRedisConfigured()) {
    return mutateLocalState((state) => {
      const session = state.sessions[token];
      if (!session) {
        return null;
      }

      if (session.expiresAt <= Date.now()) {
        delete state.sessions[token];
        return null;
      }

      session.lastSeenAt = Date.now();
      return session;
    });
  }

  const redis = await getRedis();
  const key = sessionRedisKey(token);
  const raw = await redis.get(key);
  const session = parseJsonRecord<SessionRecord>(raw);
  if (!session) {
    return null;
  }

  const now = Date.now();
  if (session.expiresAt <= now) {
    await redis.del(key);
    return null;
  }

  const ttlMs = await redis.pTTL(key);
  session.lastSeenAt = now;
  if (ttlMs > 0) {
    await redis.set(key, JSON.stringify(session), { PX: ttlMs });
  } else {
    await redis.set(key, JSON.stringify(session), { PX: SESSION_TTL_MS });
  }
  return session;
}

export async function invalidateSession(token: string): Promise<void> {
  if (!hasRedisConfigured()) {
    mutateLocalState((state) => {
      delete state.sessions[token];
    });
    return;
  }

  const redis = await getRedis();
  await redis.del(sessionRedisKey(token));
}

export async function isSiwxNonceAvailable(nonce: string): Promise<boolean> {
  if (!hasRedisConfigured()) {
    const state = loadLocalState();
    return !state.usedSiwxNonces[nonce];
  }

  const redis = await getRedis();
  return (await redis.exists(nonceRedisKey(nonce))) === 0;
}

export async function markSiwxNonceUsed(
  nonce: string,
  ttlMs: number = SIWX_NONCE_TTL_MS
): Promise<void> {
  if (!hasRedisConfigured()) {
    mutateLocalState((state) => {
      const now = Date.now();
      state.usedSiwxNonces[nonce] = {
        nonce,
        usedAt: now,
        expiresAt: now + ttlMs,
      };
    });
    return;
  }

  const redis = await getRedis();
  await redis.set(
    nonceRedisKey(nonce),
    JSON.stringify({
      nonce,
      usedAt: Date.now(),
      expiresAt: Date.now() + ttlMs,
    }),
    { PX: ttlMs }
  );
}

export async function getWalletBalance(wallet: string): Promise<number> {
  if (!hasRedisConfigured()) {
    const state = loadLocalState();
    return state.walletBalances[wallet] || 0;
  }

  return getRedisBalance(wallet);
}

export async function creditWallet(wallet: string, amountMicrousd: number): Promise<number> {
  if (!hasRedisConfigured()) {
    return mutateLocalState((state) => {
      state.walletBalances[wallet] = (state.walletBalances[wallet] || 0) + amountMicrousd;
      return state.walletBalances[wallet];
    });
  }

  await pruneExpiredRedisReservations();
  const redis = await getRedis();
  return await redis.incrBy(balanceRedisKey(wallet), amountMicrousd);
}

export async function reserveWalletBalance(
  wallet: string,
  amountMicrousd: number,
  reason: string,
  ttlMs: number = RESERVATION_TTL_MS
): Promise<{ ok: true; reservationId: string; balanceMicrousd: number } | { ok: false; balanceMicrousd: number }> {
  if (!hasRedisConfigured()) {
    return mutateLocalState((state) => {
      const balance = state.walletBalances[wallet] || 0;
      if (balance < amountMicrousd) {
        return { ok: false as const, balanceMicrousd: balance };
      }

      state.walletBalances[wallet] = balance - amountMicrousd;
      const reservationId = randomUUID().replace(/-/g, "");
      state.reservations[reservationId] = {
        id: reservationId,
        wallet,
        amountMicrousd,
        createdAt: Date.now(),
        expiresAt: Date.now() + ttlMs,
        reason,
      };

      return {
        ok: true as const,
        reservationId,
        balanceMicrousd: state.walletBalances[wallet],
      };
    });
  }

  await pruneExpiredRedisReservations();
  const redis = await getRedis();
  const reservationId = randomUUID().replace(/-/g, "");
  const result = (await redis.eval(RESERVE_SCRIPT, {
    keys: [
      balanceRedisKey(wallet),
      reservationRedisKey(reservationId),
      RESERVATION_EXPIRY_KEY,
    ],
    arguments: [
      wallet,
      reservationId,
      String(amountMicrousd),
      String(Date.now()),
      String(Date.now() + ttlMs),
      reason,
    ],
  })) as Array<string | number>;

  if (Number(result?.[0]) !== 1) {
    return {
      ok: false,
      balanceMicrousd: Number(result?.[1] || 0),
    };
  }

  return {
    ok: true,
    reservationId,
    balanceMicrousd: Number(result[1] || 0),
  };
}

export async function settleReservation(
  reservationId: string,
  actualChargeMicrousd: number
): Promise<{ wallet: string; balanceMicrousd: number; chargedMicrousd: number } | null> {
  if (!hasRedisConfigured()) {
    return mutateLocalState((state) => {
      const reservation = state.reservations[reservationId];
      if (!reservation) {
        return null;
      }

      const charged = Math.min(actualChargeMicrousd, reservation.amountMicrousd);
      const refund = reservation.amountMicrousd - charged;
      state.walletBalances[reservation.wallet] =
        (state.walletBalances[reservation.wallet] || 0) + refund;
      delete state.reservations[reservationId];

      return {
        wallet: reservation.wallet,
        balanceMicrousd: state.walletBalances[reservation.wallet] || 0,
        chargedMicrousd: charged,
      };
    });
  }

  await pruneExpiredRedisReservations();
  const redis = await getRedis();
  const result = (await redis.eval(SETTLE_SCRIPT, {
    keys: [reservationRedisKey(reservationId), RESERVATION_EXPIRY_KEY],
    arguments: [
      balanceRedisKeyPrefix(),
      reservationId,
      String(actualChargeMicrousd),
    ],
  })) as Array<string | number>;

  if (Number(result?.[0]) !== 1) {
    return null;
  }

  return {
    wallet: String(result[1]),
    balanceMicrousd: Number(result[2] || 0),
    chargedMicrousd: Number(result[3] || 0),
  };
}

export async function releaseReservation(
  reservationId: string
): Promise<{ wallet: string; balanceMicrousd: number } | null> {
  if (!hasRedisConfigured()) {
    return mutateLocalState((state) => {
      const reservation = state.reservations[reservationId];
      if (!reservation) {
        return null;
      }

      state.walletBalances[reservation.wallet] =
        (state.walletBalances[reservation.wallet] || 0) + reservation.amountMicrousd;
      delete state.reservations[reservationId];

      return {
        wallet: reservation.wallet,
        balanceMicrousd: state.walletBalances[reservation.wallet] || 0,
      };
    });
  }

  await pruneExpiredRedisReservations();
  const redis = await getRedis();
  const result = (await redis.eval(RELEASE_SCRIPT, {
    keys: [reservationRedisKey(reservationId), RESERVATION_EXPIRY_KEY],
    arguments: [balanceRedisKeyPrefix(), reservationId],
  })) as Array<string | number>;

  if (Number(result?.[0]) !== 1) {
    return null;
  }

  return {
    wallet: String(result[1]),
    balanceMicrousd: Number(result[2] || 0),
  };
}

export async function getTopup(paymentId: string): Promise<TopupRecord | null> {
  if (!hasRedisConfigured()) {
    const state = loadLocalState();
    return state.topups[paymentId] || null;
  }

  const redis = await getRedis();
  return parseJsonRecord<TopupRecord>(await redis.get(topupRedisKey(paymentId)));
}

export async function recordTopup(
  paymentId: string,
  wallet: string,
  amountMicrousd: number,
  route: string
): Promise<{ created: boolean; balanceMicrousd: number }> {
  if (!hasRedisConfigured()) {
    return mutateLocalState((state) => {
      const existing = state.topups[paymentId];
      if (existing) {
        return {
          created: false,
          balanceMicrousd: state.walletBalances[existing.wallet] || 0,
        };
      }

      state.topups[paymentId] = {
        paymentId,
        wallet,
        amountMicrousd,
        createdAt: Date.now(),
        route,
      };
      state.walletBalances[wallet] = (state.walletBalances[wallet] || 0) + amountMicrousd;

      return {
        created: true,
        balanceMicrousd: state.walletBalances[wallet],
      };
    });
  }

  await pruneExpiredRedisReservations();
  const redis = await getRedis();
  const result = (await redis.eval(RECORD_TOPUP_SCRIPT, {
    keys: [topupRedisKey(paymentId), balanceRedisKey(wallet)],
    arguments: [
      paymentId,
      wallet,
      String(amountMicrousd),
      String(Date.now()),
      route,
    ],
  })) as Array<string | number>;

  return {
    created: Number(result?.[0]) === 1,
    balanceMicrousd: Number(result?.[1] || 0),
  };
}

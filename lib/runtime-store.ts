import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { randomUUID } from "crypto";
import { join } from "path";
import {
  RESERVATION_TTL_MS,
  SESSION_TTL_MS,
  SIWX_NONCE_TTL_MS,
} from "./http-pricing";

const RUNTIME_DIR = join(import.meta.dir, "..", "data", "runtime");
const STATE_FILE = join(RUNTIME_DIR, "state.json");

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

function loadState(): RuntimeState {
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

function saveState(state: RuntimeState): void {
  ensureRuntimeDir();
  writeFileSync(STATE_FILE, JSON.stringify(pruneState(state), null, 2), "utf-8");
}

function mutateState<T>(fn: (state: RuntimeState) => T): T {
  const state = loadState();
  const result = fn(state);
  saveState(state);
  return result;
}

export function createSession(wallet: string, ttlMs: number = SESSION_TTL_MS): SessionRecord {
  return mutateState((state) => {
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

export function getSession(token: string): SessionRecord | null {
  return mutateState((state) => {
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

export function invalidateSession(token: string): void {
  mutateState((state) => {
    delete state.sessions[token];
  });
}

export function isSiwxNonceAvailable(nonce: string): boolean {
  const state = loadState();
  return !state.usedSiwxNonces[nonce];
}

export function markSiwxNonceUsed(
  nonce: string,
  ttlMs: number = SIWX_NONCE_TTL_MS
): void {
  mutateState((state) => {
    const now = Date.now();
    state.usedSiwxNonces[nonce] = {
      nonce,
      usedAt: now,
      expiresAt: now + ttlMs,
    };
  });
}

export function getWalletBalance(wallet: string): number {
  const state = loadState();
  return state.walletBalances[wallet] || 0;
}

export function creditWallet(wallet: string, amountMicrousd: number): number {
  return mutateState((state) => {
    state.walletBalances[wallet] = (state.walletBalances[wallet] || 0) + amountMicrousd;
    return state.walletBalances[wallet];
  });
}

export function reserveWalletBalance(
  wallet: string,
  amountMicrousd: number,
  reason: string,
  ttlMs: number = RESERVATION_TTL_MS
): { ok: true; reservationId: string; balanceMicrousd: number } | { ok: false; balanceMicrousd: number } {
  return mutateState((state) => {
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

export function settleReservation(
  reservationId: string,
  actualChargeMicrousd: number
): { wallet: string; balanceMicrousd: number; chargedMicrousd: number } | null {
  return mutateState((state) => {
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

export function releaseReservation(
  reservationId: string
): { wallet: string; balanceMicrousd: number } | null {
  return mutateState((state) => {
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

export function getTopup(paymentId: string): TopupRecord | null {
  const state = loadState();
  return state.topups[paymentId] || null;
}

export function recordTopup(
  paymentId: string,
  wallet: string,
  amountMicrousd: number,
  route: string
): { created: boolean; balanceMicrousd: number } {
  return mutateState((state) => {
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

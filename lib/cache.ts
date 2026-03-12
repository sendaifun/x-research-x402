import {
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
  mkdirSync,
  existsSync,
} from "fs";
import { createHash } from "crypto";
import { join } from "path";
import { getRedis, hasRedisConfigured, redisKey } from "./redis";

const CACHE_DIR = join(import.meta.dir, "..", "data", "cache");
const CACHE_NAMESPACE = "cache";

export interface CacheEntry<T = any> {
  key: string;
  created_at: number;
  ttl_ms: number;
  expires_at: number;
  data: T;
  meta?: Record<string, any>;
}

export const TTL = {
  READ: 24 * 60 * 60 * 1000,
  QUICK: 60 * 60 * 1000,
  FULL: 15 * 60 * 1000,
  WATCHLIST: 4 * 60 * 60 * 1000,
  PROFILE: 24 * 60 * 60 * 1000,
  THREAD: 6 * 60 * 60 * 1000,
  TRENDING: 15 * 60 * 1000,
  ACCOUNTS_FEED: 15 * 60 * 1000,
} as const;

function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}

export function cacheKey(endpoint: string, params: Record<string, any> = {}): string {
  const sorted = JSON.stringify(params, Object.keys(params).sort());
  const raw = `${endpoint}:${sorted}`;
  return createHash("md5").update(raw).digest("hex").slice(0, 16);
}

function filePath(key: string): string {
  return join(CACHE_DIR, `${key}.json`);
}

function getLocal<T = any>(key: string): T | null {
  ensureCacheDir();
  const fp = filePath(key);
  try {
    const raw = readFileSync(fp, "utf-8");
    const entry: CacheEntry<T> = JSON.parse(raw);
    if (Date.now() > entry.expires_at) {
      try {
        unlinkSync(fp);
      } catch {}
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

function setLocal<T = any>(key: string, data: T, ttlMs: number, meta?: Record<string, any>): void {
  ensureCacheDir();
  const now = Date.now();
  const entry: CacheEntry<T> = {
    key,
    created_at: now,
    ttl_ms: ttlMs,
    expires_at: now + ttlMs,
    data,
    meta,
  };
  writeFileSync(filePath(key), JSON.stringify(entry), "utf-8");
}

function pruneLocal(): number {
  ensureCacheDir();
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000;
  let pruned = 0;

  try {
    const files = readdirSync(CACHE_DIR).filter((file) => file.endsWith(".json"));
    for (const file of files) {
      const fp = join(CACHE_DIR, file);
      try {
        const raw = readFileSync(fp, "utf-8");
        const entry: CacheEntry = JSON.parse(raw);
        if (now > entry.expires_at || now - entry.created_at > maxAge) {
          unlinkSync(fp);
          pruned++;
        }
      } catch {
        try {
          unlinkSync(fp);
          pruned++;
        } catch {}
      }
    }
  } catch {}

  return pruned;
}

function clearLocal(): number {
  ensureCacheDir();
  let cleared = 0;
  try {
    const files = readdirSync(CACHE_DIR).filter((file) => file.endsWith(".json"));
    for (const file of files) {
      try {
        unlinkSync(join(CACHE_DIR, file));
        cleared++;
      } catch {}
    }
  } catch {}
  return cleared;
}

function statsLocal(): { entries: number; totalSizeKb: number } {
  ensureCacheDir();
  try {
    const files = readdirSync(CACHE_DIR).filter((file) => file.endsWith(".json"));
    let totalSize = 0;
    for (const file of files) {
      try {
        const raw = readFileSync(join(CACHE_DIR, file), "utf-8");
        totalSize += raw.length;
      } catch {}
    }
    return { entries: files.length, totalSizeKb: Math.round(totalSize / 1024) };
  } catch {
    return { entries: 0, totalSizeKb: 0 };
  }
}

function cacheRedisKey(key: string): string {
  return redisKey(CACHE_NAMESPACE, key);
}

export async function get<T = any>(key: string): Promise<T | null> {
  if (!hasRedisConfigured()) {
    return getLocal<T>(key);
  }

  const redis = await getRedis();
  const raw = await redis.get(cacheRedisKey(key));
  if (!raw) {
    return null;
  }

  try {
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (Date.now() > entry.expires_at) {
      await redis.del(cacheRedisKey(key));
      return null;
    }
    return entry.data;
  } catch {
    await redis.del(cacheRedisKey(key));
    return null;
  }
}

export async function set<T = any>(
  key: string,
  data: T,
  ttlMs: number,
  meta?: Record<string, any>
): Promise<void> {
  if (!hasRedisConfigured()) {
    setLocal(key, data, ttlMs, meta);
    return;
  }

  const redis = await getRedis();
  const now = Date.now();
  const entry: CacheEntry<T> = {
    key,
    created_at: now,
    ttl_ms: ttlMs,
    expires_at: now + ttlMs,
    data,
    meta,
  };
  await redis.set(cacheRedisKey(key), JSON.stringify(entry), {
    PX: ttlMs,
  });
}

export async function has(key: string): Promise<boolean> {
  if (!hasRedisConfigured()) {
    return getLocal(key) !== null;
  }

  const redis = await getRedis();
  return (await redis.exists(cacheRedisKey(key))) === 1;
}

export async function prune(): Promise<number> {
  if (!hasRedisConfigured()) {
    return pruneLocal();
  }

  return 0;
}

export async function clear(): Promise<number> {
  if (!hasRedisConfigured()) {
    return clearLocal();
  }

  const redis = await getRedis();
  const keys = await redis.keys(cacheRedisKey("*"));
  if (keys.length === 0) {
    return 0;
  }
  await redis.del(keys);
  return keys.length;
}

export async function stats(): Promise<{ entries: number; totalSizeKb: number }> {
  if (!hasRedisConfigured()) {
    return statsLocal();
  }

  const redis = await getRedis();
  const keys = await redis.keys(cacheRedisKey("*"));
  let totalSize = 0;
  for (const key of keys) {
    totalSize += await redis.strLen(key);
  }

  return {
    entries: keys.length,
    totalSizeKb: Math.round(totalSize / 1024),
  };
}

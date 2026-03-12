import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { getRedis, hasRedisConfigured, redisKey } from "./redis";

const COST_FILE = join(import.meta.dir, "..", "data", "cost-tracking.json");
const COST_PER_TWEET = 0.005;
const COST_TTL_SECONDS = 14 * 24 * 60 * 60;

interface CostRecord {
  date: string;
  total_tweets_read: number;
  total_cost_usd: number;
  requests: { timestamp: number; tweets: number; cost: number; query?: string }[];
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function costRedisKey(date: string): string {
  return redisKey("cost", date);
}

function loadLocal(): CostRecord {
  try {
    if (existsSync(COST_FILE)) {
      const data: CostRecord = JSON.parse(readFileSync(COST_FILE, "utf-8"));
      if (data.date === today()) return data;
    }
  } catch {}
  return { date: today(), total_tweets_read: 0, total_cost_usd: 0, requests: [] };
}

function saveLocal(record: CostRecord): void {
  writeFileSync(COST_FILE, JSON.stringify(record, null, 2), "utf-8");
}

async function loadRedis(): Promise<CostRecord> {
  const redis = await getRedis();
  const date = today();
  const raw = await redis.get(costRedisKey(date));
  if (!raw) {
    return { date, total_tweets_read: 0, total_cost_usd: 0, requests: [] };
  }

  try {
    return JSON.parse(raw) as CostRecord;
  } catch {
    return { date, total_tweets_read: 0, total_cost_usd: 0, requests: [] };
  }
}

async function saveRedis(record: CostRecord): Promise<void> {
  const redis = await getRedis();
  await redis.set(costRedisKey(record.date), JSON.stringify(record), {
    EX: COST_TTL_SECONDS,
  });
}

export function estimateCost(pages: number, tweetsPerPage: number = 100): string {
  const tweets = pages * tweetsPerPage;
  const cost = tweets * COST_PER_TWEET;
  return `~${tweets} tweets × $${COST_PER_TWEET} = ~$${cost.toFixed(2)}`;
}

export async function recordUsage(tweetCount: number, query?: string): Promise<void> {
  const record = hasRedisConfigured() ? await loadRedis() : loadLocal();
  const cost = tweetCount * COST_PER_TWEET;
  record.total_tweets_read += tweetCount;
  record.total_cost_usd += cost;
  record.requests.push({
    timestamp: Date.now(),
    tweets: tweetCount,
    cost,
    query,
  });

  if (hasRedisConfigured()) {
    await saveRedis(record);
  } else {
    saveLocal(record);
  }
}

export async function getSummary(): Promise<string> {
  const record = hasRedisConfigured() ? await loadRedis() : loadLocal();
  const lines = [
    `📊 Cost Tracking (${record.date})`,
    `   Tweets read: ${record.total_tweets_read.toLocaleString()}`,
    `   Estimated cost: $${record.total_cost_usd.toFixed(2)}`,
    `   API calls: ${record.requests.length}`,
  ];
  if (record.requests.length > 0) {
    const last = record.requests[record.requests.length - 1];
    lines.push(
      `   Last request: ${last.tweets} tweets (~$${last.cost.toFixed(2)})${
        last.query ? ` for "${last.query}"` : ""
      }`
    );
  }
  return lines.join("\n");
}

export async function reset(): Promise<void> {
  const record = { date: today(), total_tweets_read: 0, total_cost_usd: 0, requests: [] };
  if (hasRedisConfigured()) {
    await saveRedis(record);
  } else {
    saveLocal(record);
  }
}

export function formatCostLine(tweetCount: number, cached: boolean): string {
  if (cached) return `⚡ [CACHED] 0 credits used`;
  const cost = tweetCount * COST_PER_TWEET;
  return `📊 ${tweetCount} tweets read · ~$${cost.toFixed(2)}`;
}

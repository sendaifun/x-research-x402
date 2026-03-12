import { createClient } from "redis";

type RedisClient = ReturnType<typeof createClient>;

let clientPromise: Promise<RedisClient> | null = null;
let errorHandlerAttached = false;

export function hasRedisConfigured(): boolean {
  return Boolean(process.env.REDIS_URL);
}

export function redisKey(...parts: string[]): string {
  const prefix = (process.env.REDIS_PREFIX || "ct-alpha").trim().replace(/:+$/, "");
  return [prefix, ...parts].join(":");
}

export async function getRedis(): Promise<RedisClient> {
  if (!hasRedisConfigured()) {
    throw new Error("REDIS_URL is not configured.");
  }

  if (!clientPromise) {
    const client = createClient({
      url: process.env.REDIS_URL,
      socket: {
        reconnectStrategy(retries) {
          return Math.min(retries * 50, 1_000);
        },
      },
    });

    if (!errorHandlerAttached) {
      client.on("error", (error) => {
        console.error("Redis client error:", error);
      });
      errorHandlerAttached = true;
    }

    clientPromise = client.connect().then(() => client);
  }

  return clientPromise;
}

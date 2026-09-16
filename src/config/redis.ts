import "dotenv/config";
import { createClient } from "redis";
import type { ConnectionOptions } from "bullmq";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

// Redis client for LangChain RedisVectorStore (uses node-redis)
let redisClient: ReturnType<typeof createClient> | null = null;

export async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({
      url: redisUrl,
    });

    redisClient.on("error", (err) => {
      console.error("[Redis Client Error]", err);
    });

    redisClient.on("connect", () => {
      console.log("[Redis Client] Connected to Redis");
    });
  }

  if (!redisClient.isOpen) {
    await redisClient.connect();
  }

  return redisClient;
}

// BullMQ connection options (uses ioredis under the hood)
export const redisConnection: ConnectionOptions = process.env.REDIS_URL
  ? {
      url: process.env.REDIS_URL,
      maxRetriesPerRequest: null,
      lazyConnect: true,
    }
  : {
      host: process.env.REDIS_HOST || "localhost",
      port: Number(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: null,
      lazyConnect: true,
    };
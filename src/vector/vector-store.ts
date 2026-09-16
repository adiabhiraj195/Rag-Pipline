import "dotenv/config";
import { RedisVectorStore } from "@langchain/redis";
import { embeddingModel } from "../llm/model";
import { getRedisClient } from "../config/redis";

let vectorStore: RedisVectorStore | null = null;

export async function getVectorStore() {
  if (vectorStore) {
    return vectorStore;
  }

  const client = await getRedisClient();
  const indexName = process.env.REDIS_INDEX || "rag_chunks";

  vectorStore = new RedisVectorStore(embeddingModel, {
    redisClient: client as any,
    indexName,
    keyPrefix: `doc:${indexName}:`,
  });

  return vectorStore;
}

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

export interface DeleteVectorDocumentResult {
  success: boolean;
  documentId: string;
  deletedChunks: number;
  deletedKeys: string[];
}

/**
 * Deletes all vector embeddings and chunk records associated with a documentId from the Redis Vector Store.
 */
export async function deleteDocumentFromVectorStore(
  documentId: string
): Promise<DeleteVectorDocumentResult> {
  const client = await getRedisClient();
  const indexName = process.env.REDIS_INDEX || "rag_chunks";
  const keyPrefix = `doc:${indexName}:`;

  const keysToDelete = new Set<string>();

  // 1. Fast path: scan for keys matching prefix pattern with documentId (e.g. doc:rag_chunks:<docId>:*)
  try {
    for await (const keyEntry of client.scanIterator({
      MATCH: `${keyPrefix}${documentId}:*`,
      COUNT: 200,
    })) {
      const keys = Array.isArray(keyEntry) ? keyEntry : [keyEntry];
      for (const k of keys) {
        keysToDelete.add(String(k));
      }
    }
  } catch (err: any) {
    console.warn(
      `[Vector Store] Fast scan warning for document ${documentId}:`,
      err?.message
    );
  }

  // 2. RediSearch query: search index metadata for documentId
  try {
    const cleanId = documentId.replace(/[^a-zA-Z0-9]/g, " ");
    const ftQuery = `@metadata:(${cleanId})`;
    const searchRes = await client.ft.search(indexName, ftQuery, {
      LIMIT: { from: 0, size: 500 },
      RETURN: ["metadata"],
    });

    if (searchRes && searchRes.documents) {
      for (const doc of searchRes.documents) {
        const rawMeta = (doc.value?.metadata as string) || "";
        if (rawMeta.includes(documentId)) {
          keysToDelete.add(doc.id);
        }
      }
    }
  } catch {
    // RediSearch query may fail if index is empty or syntax differs; proceed to fallback
  }

  // 3. Fallback scan: if nothing found yet, scan all doc keys and verify metadata content
  if (keysToDelete.size === 0) {
    try {
      for await (const keyEntry of client.scanIterator({
        MATCH: `${keyPrefix}*`,
        COUNT: 200,
      })) {
        const keys = Array.isArray(keyEntry) ? keyEntry : [keyEntry];
        for (const singleKey of keys) {
          try {
            const rawMeta = await client.hGet(String(singleKey), "metadata");
            if (rawMeta && rawMeta.includes(documentId)) {
              keysToDelete.add(String(singleKey));
            }
          } catch {
            // Ignore key read errors
          }
        }
      }
    } catch (scanErr: any) {
      console.warn(
        `[Vector Store] Full scan fallback warning for document ${documentId}:`,
        scanErr?.message
      );
    }
  }

  const keysArray = Array.from(keysToDelete);
  let deletedCount = 0;

  if (keysArray.length > 0) {
    // Delete in batches of 100
    for (let i = 0; i < keysArray.length; i += 100) {
      const batch = keysArray.slice(i, i + 100);
      const count = await client.del(batch);
      deletedCount += count;
    }
    console.log(
      `[Vector Store] Successfully deleted ${deletedCount} chunk keys from Redis for document ID: ${documentId}`
    );
  } else {
    console.log(
      `[Vector Store] No chunk keys found in Redis for document ID: ${documentId}`
    );
  }

  return {
    success: true,
    documentId,
    deletedChunks: deletedCount,
    deletedKeys: keysArray,
  };
}

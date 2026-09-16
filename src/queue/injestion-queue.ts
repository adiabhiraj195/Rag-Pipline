import { Queue } from "bullmq";
import { redisConnection } from "../config/redis";
export { redisConnection };

export const INGESTION_QUEUE_NAME = "txt-ingestion-queue";

export interface IngestionJobData {
  documentId: string;
  s3Key?: string;
  filename?: string;
  mimeType?: string;
  tenantId?: string;
  version?: number;
  source?: string;
  metadata?: Record<string, any>;
  chunkSize?: number;
  chunkOverlap?: number;
}

export const ingestionQueue = new Queue<IngestionJobData>(INGESTION_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: {
      age: 24 * 3600,
      count: 1000,
    },
    removeOnFail: {
      age: 7 * 24 * 3600,
    },
  },
});

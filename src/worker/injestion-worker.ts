import "dotenv/config";
import path from "path";
import fs from "fs";
import { Worker, Job } from "bullmq";
import {
  INGESTION_QUEUE_NAME,
  IngestionJobData,
  redisConnection,
} from "../queue/injestion-queue";
import {
  loadTextDocument,
  loadTextContent,
  splitLoadedTextDocument,
} from "../injestion/load-document";
import { enrichChunks } from "../injestion/enrich-chunks";
import { getVectorStore } from "../vector/vector-store";
import { downloadFileContentFromS3 } from "../config/s3";
import { prisma } from "../config/prisma";
import type { Document } from "@langchain/classic/document";

export interface IngestionJobResult {
  success: boolean;
  documentId: string;
  tenantId: string;
  version: number;
  totalChunks: number;
  processedAt: string;
  source: string;
}

export const ingestionWorker = new Worker<IngestionJobData, IngestionJobResult>(
  INGESTION_QUEUE_NAME,

  async (job: Job<IngestionJobData, IngestionJobResult>) => {
    const fileSource = job.data.s3Key || job.data.filename || "unknown";
    console.log(`[Worker] Started processing job #${job.id} for document source: "${fileSource}"`);

    const {
      documentId,
      s3Key,
      filename = "document.txt",
      mimeType = "text/plain",
      tenantId = "00000000-0000-0000-0000-000000000000",
      version = 1,
      metadata = {},
      chunkSize,
      chunkOverlap,
    } = job.data;

    if (!documentId) {
      throw new Error("Missing 'documentId' in job data.");
    }

    // Update document status in PostgreSQL to PROCESSING
    try {
      await prisma.document.update({
        where: { id: documentId },
        data: { status: "PROCESSING", updatedAt: new Date() },
      });
      console.log(`[Worker] [Job #${job.id}] Updated DB status to 'PROCESSING' for document: ${documentId}`);
    } catch (dbErr: any) {
      console.warn(`[Worker] Could not update document status to PROCESSING: ${dbErr.message}`);
    }

    try {
      // Step 1: Download / Load file content
      await job.updateProgress(15);
      let loadedDocs: Document[];

      if (s3Key) {
        console.log(`[Worker] [Job #${job.id}] Downloading file content from S3 (Key: ${s3Key})...`);
        const textContent = await downloadFileContentFromS3(s3Key);
        console.log(`[Worker] [Job #${job.id}] Successfully downloaded ${textContent.length} characters from S3.`);

        loadedDocs = loadTextContent(textContent, {
          source: filename,
          s3Key,
          mimeType,
        });
      } else {
        throw new Error("Neither 's3Key' was provided in the job data.");
      }

      // Step 2: Split into chunks
      await job.updateProgress(35);
      console.log(
        `[Worker] [Job #${job.id}] Splitting loaded document into chunks (chunkSize=${chunkSize ?? 800}, chunkOverlap=${chunkOverlap ?? 100})...`
      );
      const chunks = await splitLoadedTextDocument(loadedDocs, {
        chunkSize,
        chunkOverlap,
      });
      console.log(`[Worker] [Job #${job.id}] Split into ${chunks.length} chunks`);

      if (chunks.length === 0) {
        throw new Error(`Document splitting produced 0 chunks for source: ${fileSource}`);
      }

      // Step 3: Enrich chunks with metadata
      await job.updateProgress(55);
      console.log(`[Worker] [Job #${job.id}] Enriching chunks with metadata...`);
      const enrichedChunks = enrichChunks({
        chunks,
        tenantId,
        documentId,
        version: Number(version),
        customMetadata: {
          ...metadata,
          filename,
          s3Key: s3Key || undefined,
          mimeType,
        },
      });

      // Step 4: Embed & store into Redis Vector Store
      await job.updateProgress(75);
      console.log(`[Worker] [Job #${job.id}] Initializing Redis Vector Store...`);
      const vectorStore = await getVectorStore();

      console.log(
        `[Worker] [Job #${job.id}] Generating embeddings and indexing ${enrichedChunks.length} chunks into Redis...`
      );
      await vectorStore.addDocuments(enrichedChunks);

      // Step 5: Update document status in PostgreSQL to COMPLETED
      await job.updateProgress(90);
      try {
        await prisma.document.update({
          where: { id: documentId },
          data: { status: "COMPLETED", updatedAt: new Date() },
        });
        console.log(`[Worker] [Job #${job.id}] Updated DB status to 'COMPLETED' for document: ${documentId}`);
      } catch (dbErr: any) {
        console.warn(`[Worker] Could not update document status to COMPLETED: ${dbErr.message}`);
      }

      // Step 6: Return final job result
      await job.updateProgress(100);
      const result: IngestionJobResult = {
        success: true,
        documentId,
        tenantId,
        version: Number(version),
        totalChunks: enrichedChunks.length,
        processedAt: new Date().toISOString(),
        source: fileSource,
      };

      console.log(
        `[Worker] [Job #${job.id}] Finished successfully. Total chunks stored in Redis: ${enrichedChunks.length}`
      );
      return result;
    } catch (processingError: any) {
      console.error(`[Worker] [Job #${job.id}] Processing failed:`, processingError);

      // Update document status in PostgreSQL to FAILED
      try {
        await prisma.document.update({
          where: { id: documentId },
          data: { status: "FAILED", updatedAt: new Date() },
        });
        console.log(`[Worker] [Job #${job.id}] Updated DB status to 'FAILED' for document: ${documentId}`);
      } catch (dbErr: any) {
        console.warn(`[Worker] Could not update document status to FAILED: ${dbErr.message}`);
      }

      throw processingError;
    }
  },
  {
    connection: redisConnection,
    concurrency: 3,
  }
);

ingestionWorker.on("active", (job) => {
  console.log(`[Worker] Job #${job.id} is now active.`);
});

ingestionWorker.on("completed", (job, result) => {
  console.log(`[Worker] Job #${job.id} completed. Document ID: ${result?.documentId}`);
});

ingestionWorker.on("failed", (job, err) => {
  console.error(`[Worker] Job #${job?.id} failed:`, err.message);
});

ingestionWorker.on("error", (err) => {
  console.error("[Worker Error]", err);
});

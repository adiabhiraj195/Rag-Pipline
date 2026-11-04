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
  loadPdfFromBuffer,
  isPdfDocument,
  splitLoadedTextDocument,
} from "../rag/injestion/load-document";
import { runChunkingMethod } from "../rag/chunking";
import { enrichChunks } from "../rag/injestion/enrich-chunks";
import { getVectorStore } from "../vector/vector-store";
import { embeddingModel } from "../llm/model";
import { downloadFileContentFromS3, downloadFileBufferFromS3 } from "../config/s3";
import { prisma } from "../config/prisma";
import type { Document } from "@langchain/classic/document";

export interface IngestionJobResult {
  success: boolean;
  documentId: string;
  userId?: string;
  tenantId?: string;
  version: number;
  totalChunks: number;
  processedAt: string;
  source: string;
  chunkingStrategy?: string;
  pageCount?: number;
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
      userId,
      tenantId,
      version = 1,
      metadata = {},
      chunkSize,
      chunkOverlap,
      chunkingStrategy,
      chunkingType,
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
      // Step 1: Download / Load file content (Text or PDF)
      await job.updateProgress(15);
      let loadedDocs: Document[];
      let textContent = "";
      let pageCount = 1;

      if (s3Key) {
        console.log(`[Worker] [Job #${job.id}] Fetching file from S3 (Key: ${s3Key})...`);
        const isPdf = isPdfDocument(filename, mimeType) || isPdfDocument(s3Key);

        if (isPdf) {
          console.log(`[Worker] [Job #${job.id}] Detected PDF document. Downloading binary buffer...`);
          const buffer = await downloadFileBufferFromS3(s3Key);
          console.log(`[Worker] [Job #${job.id}] Downloaded ${buffer.length} bytes. Parsing PDF content...`);
          const pdfResult = await loadPdfFromBuffer(buffer, {
            filename,
            s3Key,
            mimeType: "application/pdf",
          });
          loadedDocs = pdfResult.documents;
          textContent = pdfResult.fullText;
          pageCount = pdfResult.pageCount;
          console.log(
            `[Worker] [Job #${job.id}] Successfully parsed PDF into ${loadedDocs.length} page document(s), ${textContent.length} total chars.`
          );
        } else {
          textContent = await downloadFileContentFromS3(s3Key);
          console.log(`[Worker] [Job #${job.id}] Successfully downloaded ${textContent.length} characters from S3.`);
          loadedDocs = loadTextContent(textContent, {
            source: filename,
            s3Key,
            mimeType,
          });
        }
      } else {
        throw new Error("Neither 's3Key' was provided in the job data.");
      }

      // Step 2: Split into chunks using selected chunking strategy
      await job.updateProgress(35);
      const chosenStrategy = chunkingStrategy || chunkingType || "recursive";
      console.log(
        `[Worker] [Job #${job.id}] Splitting loaded document into chunks using strategy='${chosenStrategy}' (chunkSize=${chunkSize ?? 800}, chunkOverlap=${chunkOverlap ?? 100})...`
      );
      const chunks = await runChunkingMethod(loadedDocs, {
        strategy: chosenStrategy,
        chunkSize,
        chunkOverlap,
      });
      console.log(`[Worker] [Job #${job.id}] Split into ${chunks.length} chunks via '${chosenStrategy}'`);

      if (chunks.length === 0) {
        throw new Error(`Document splitting produced 0 chunks for source: ${fileSource}`);
      }

      // Step 3: Enrich chunks with metadata, LLM context, summary, and embeddingText
      await job.updateProgress(55);
      console.log(`[Worker] [Job #${job.id}] Enriching chunks with metadata, context, and summary...`);
      const enrichedChunks = await enrichChunks({
        chunks,
        userId,
        tenantId,
        documentId,
        version: Number(version),
        documentContent: textContent,
        customMetadata: {
          ...metadata,
          filename,
          s3Key: s3Key || undefined,
          mimeType: isPdfDocument(filename, mimeType) ? "application/pdf" : mimeType,
          chunkingStrategy: chosenStrategy,
        },
      });

      // Step 4: Embed & store into Redis Vector Store
      await job.updateProgress(75);
      console.log(`[Worker] [Job #${job.id}] Initializing Redis Vector Store...`);
      const vectorStore = await getVectorStore();

      console.log(
        `[Worker] [Job #${job.id}] Generating embeddings from embeddingText (context + summary + content) and indexing ${enrichedChunks.length} chunks into Redis...`
      );
      const textsToEmbed = enrichedChunks.map(
        (chunk) => (chunk.metadata?.embeddingText as string) || chunk.pageContent
      );
      const vectors = await embeddingModel.embedDocuments(textsToEmbed);
      const indexName = process.env.REDIS_INDEX || "rag_chunks";
      const keyPrefix = `doc:${indexName}:`;
      const chunkKeys = enrichedChunks.map(
        (_, idx) => `${keyPrefix}${documentId}:${idx}`
      );
      await vectorStore.addVectors(vectors, enrichedChunks, { keys: chunkKeys });


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
        userId,
        tenantId,
        version: Number(version),
        totalChunks: enrichedChunks.length,
        processedAt: new Date().toISOString(),
        source: fileSource,
        chunkingStrategy: chosenStrategy,
        pageCount,
      };

      console.log(
        `[Worker] [Job #${job.id}] Finished successfully. Total chunks stored in Redis: ${enrichedChunks.length} (${chosenStrategy})`
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

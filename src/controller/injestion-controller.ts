import crypto from "crypto";
import path from "path";
import fs from "fs";
import type { Request, Response } from "express";
import { ingestionQueue, IngestionJobData } from "../queue/injestion-queue";
import { generatePresignedUploadUrl } from "../config/s3";
import { prisma } from "../config/prisma";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(str?: string): boolean {
  return typeof str === "string" && UUID_REGEX.test(str);
}

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Controller to generate a presigned S3 PUT URL for client-side file upload.
 * POST /upload-url
 * Body: { filename: string, mimeType?: string, tenantId?: string, expiresIn?: number }
 */
export async function createPresignedUrl(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const {
      filename,
      mimeType = "text/plain",
      userId,
      tenantId,
      expiresIn = 3600,
    } = req.body;

    if (!filename || typeof filename !== "string" || filename.trim() === "") {
      res.status(400).json({
        success: false,
        error: "'filename' is required and must be a non-empty string.",
      });
      return;
    }

    const sanitizedFilename = path.basename(filename.trim());
    const randomPrefix = crypto.randomUUID();
    const effectiveUserId = req.user?.userId || (isValidUuid(userId) ? userId : (isValidUuid(tenantId) ? tenantId : "general"));
    const s3Key = `uploads/${effectiveUserId}/${randomPrefix}-${sanitizedFilename}`;

    const presignedData = await generatePresignedUploadUrl({
      key: s3Key,
      contentType: mimeType,
      expiresIn: Number(expiresIn) || 3600,
    });

    res.status(200).json({
      success: true,
      message: "Presigned upload URL generated successfully.",
      data: {
        presignedUrl: presignedData.presignedUrl,
        s3Key: presignedData.s3Key,
        bucket: presignedData.bucket,
        expiresIn: presignedData.expiresIn,
        filename: sanitizedFilename,
        mimeType,
      },
    });
  } catch (error: any) {
    console.error("[Presigned URL Controller Error]", error);
    res.status(500).json({
      success: false,
      error: error?.message || "Failed to generate presigned upload URL.",
    });
  }
}

/**
 * Controller to ingest a text document.
 * Accepts s3Key and file metadata, persists document record in PostgreSQL DB via Prisma,
 * and adds the job to the BullMQ ingestion queue.
 * POST /injestTXT
 * Body: {
 *   s3Key: string,
 *   filename: string,
 *   mimeType?: string,
 *   documentId?: string (UUID),
 *   tenantId?: string (UUID),
 *   version?: number,
 *   chunkSize?: number (optional),
 *   chunkOverlap?: number (optional),
 *   metadata?: object
 * }
 */
export async function injestFileToStore(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const {
      s3Key,
      filename,
      mimeType = "text/plain",
      documentId,
      userId,
      tenantId,
      version = 1,
      metadata = {},
      chunkSize,
      chunkOverlap,
    } = req.body;

    // Validate either s3Key or local filePath is provided
    if (!s3Key) {
      res.status(400).json({
        success: false,
        error: "'s3Key' is required to ingest a document.",
      });
      return;
    }

    if (s3Key && (typeof s3Key !== "string" || s3Key.trim() === "")) {
      res.status(400).json({
        success: false,
        error: "'s3Key' must be a non-empty string.",
      });
      return;
    }

    // If s3Key is given, filename is required
    const docFilename = filename;
    if (!docFilename || typeof docFilename !== "string" || docFilename.trim() === "") {
      res.status(400).json({
        success: false,
        error: "'filename' is required when ingesting with s3Key.",
      });
      return;
    }

    // Validate optional chunkSize
    if (chunkSize !== undefined) {
      const parsedChunkSize = Number(chunkSize);
      if (isNaN(parsedChunkSize) || parsedChunkSize <= 0) {
        res.status(400).json({
          success: false,
          error: "'chunkSize' must be a positive number if provided.",
        });
        return;
      }
    }

    // Validate optional chunkOverlap
    if (chunkOverlap !== undefined) {
      const parsedChunkOverlap = Number(chunkOverlap);
      if (isNaN(parsedChunkOverlap) || parsedChunkOverlap < 0) {
        res.status(400).json({
          success: false,
          error: "'chunkOverlap' must be a non-negative number if provided.",
        });
        return;
      }
    }

    // Ensure valid UUID for document ID and tenant ID (satisfies PostgreSQL UUID constraint)
    const docId = isValidUuid(documentId) ? documentId : crypto.randomUUID();
    const effectiveUserId = req.user?.userId || (isValidUuid(userId) ? userId : null);
    const effectiveOrgId = req.user?.organisationId || (isValidUuid(tenantId) ? tenantId : null);
    const docVersion = Number(version) || 1;
    const storageKey = s3Key || docFilename;

    // 1. Persist document metadata into PostgreSQL DB via Prisma
    let dbRecord;
    try {
      dbRecord = await prisma.document.create({
        data: {
          id: docId,
          userId: effectiveUserId,
          organisationId: effectiveOrgId,
          filename: docFilename,
          mimeType,
          s3Key: storageKey,
          status: "PENDING",
          version: docVersion,
        },
      });
      console.log(`[DB] Document record created with ID: ${docId}, status: PENDING`);
    } catch (dbError: any) {
      console.error("[DB Error] Failed to persist document record:", dbError.message);
      res.status(500).json({
        success: false,
        error: `Database error while storing document: ${dbError.message}`,
      });
      return;
    }

    // 2. Queue BullMQ job
    const jobPayload: IngestionJobData = {
      documentId: docId,
      s3Key: s3Key || undefined,
      filename: docFilename,
      mimeType,
      userId: effectiveUserId || undefined,
      tenantId: effectiveOrgId || (isValidUuid(tenantId) ? tenantId : undefined),
      version: docVersion,
      source: docFilename,
      metadata: {
        ...metadata,
        ...(effectiveOrgId ? { organisationId: effectiveOrgId } : {}),
      },
      chunkSize: chunkSize ? Number(chunkSize) : undefined,
      chunkOverlap: chunkOverlap ? Number(chunkOverlap) : undefined,
    };

    const job = await ingestionQueue.add("ingest-txt-file", jobPayload);

    res.status(202).json({
      success: true,
      message: "Document ingestion job queued successfully.",
      data: {
        jobId: job.id,
        queueName: ingestionQueue.name,
        documentId: docId,
        filename: docFilename,
        mimeType,
        s3Key: storageKey,
        status: dbRecord.status,
        chunkSize: jobPayload.chunkSize,
        chunkOverlap: jobPayload.chunkOverlap,
      },
    });
  } catch (error: any) {
    console.error("[Ingestion Controller Error]", error);
    res.status(500).json({
      success: false,
      error: error?.message || "Internal server error while queueing ingestion.",
    });
  }
}

export async function getJobStatus(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const rawJobId = req.params.jobId;
    const jobId = Array.isArray(rawJobId) ? rawJobId[0] : rawJobId;

    if (!jobId) {
      res.status(400).json({
        success: false,
        error: "jobId parameter is required.",
      });
      return;
    }

    const job = await ingestionQueue.getJob(jobId);

    if (!job) {
      res.status(404).json({
        success: false,
        error: `Job with ID '${jobId}' was not found.`,
      });
      return;
    }

    const state = await job.getState();

    res.status(200).json({
      success: true,
      data: {
        jobId: job.id,
        state,
        progress: job.progress,
        data: job.data,
        result: job.returnvalue || null,
        failedReason: job.failedReason || null,
        attemptsMade: job.attemptsMade,
        timestamp: job.timestamp,
        processedOn: job.processedOn,
        finishedOn: job.finishedOn,
      },
    });
  } catch (error: any) {
    console.error("[Job Status Controller Error]", error);
    res.status(500).json({
      success: false,
      error: error?.message || "Internal server error while fetching job status.",
    });
  }
}
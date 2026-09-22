import type { Request, Response } from "express";
import { prisma } from "../config/prisma";
import {
  generatePresignedDownloadUrl,
  downloadFileContentFromS3,
  deleteFileFromS3,
} from "../config/s3";
import { deleteDocumentFromVectorStore } from "../vector/vector-store";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(str?: unknown): boolean {
  return typeof str === "string" && UUID_REGEX.test(str);
}

function getParamId(param: unknown): string {
  if (Array.isArray(param)) return String(param[0]);
  return typeof param === "string" ? param : "";
}

/**
 * Controller to list uploaded documents in the RAG pipeline.
 * GET /documents (or /rag/documents)
 * Query params:
 *   - page?: number (default 1)
 *   - limit?: number (default 20, max 100)
 *   - status?: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED"
 *   - userId?: string (UUID)
 *   - search?: string (matches filename)
 *   - all?: "true" | "false" (if authenticated, allows listing all documents across the system)
 *   - sortBy?: "createdAt" | "updatedAt" | "filename" | "status" (default "createdAt")
 *   - order?: "asc" | "desc" (default "desc")
 */
export async function listDocuments(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
    const rawLimit = parseInt(String(req.query.limit || "20"), 10) || 20;
    const limit = Math.min(100, Math.max(1, rawLimit));
    const skip = (page - 1) * limit;

    const statusParam = req.query.status
      ? String(req.query.status).trim().toUpperCase()
      : undefined;
    const searchParam = req.query.search
      ? String(req.query.search).trim()
      : undefined;
    const userIdParam = req.query.userId
      ? String(req.query.userId).trim()
      : undefined;
    const showAll = req.query.all === "true";

    const sortByParam = String(req.query.sortBy || "createdAt");
    const allowedSortFields = ["createdAt", "updatedAt", "filename", "status", "version"];
    const sortBy = allowedSortFields.includes(sortByParam)
      ? sortByParam
      : "createdAt";

    const orderParam = String(req.query.order || "desc").toLowerCase();
    const order = orderParam === "asc" ? "asc" : "desc";

    const where: any = {};

    // Filter by status if provided
    if (statusParam) {
      where.status = statusParam;
    }

    // Filter by search term on filename
    if (searchParam) {
      where.filename = {
        contains: searchParam,
        mode: "insensitive",
      };
    }

    // User filtering:
    // 1. Explicit userId in query
    // 2. Or if authenticated and not requesting all, filter by logged-in user
    if (userIdParam && isValidUuid(userIdParam)) {
      where.userId = userIdParam;
    } else if (req.user?.userId && !showAll && !userIdParam) {
      where.userId = req.user.userId;
    }

    const [documents, totalCount] = await Promise.all([
      prisma.document.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: order },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
              role: true,
            },
          },
        },
      }),
      prisma.document.count({ where }),
    ]);

    const totalPages = Math.ceil(totalCount / limit) || 1;

    res.status(200).json({
      success: true,
      data: {
        documents,
        pagination: {
          page,
          limit,
          totalCount,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      },
    });
  } catch (error: any) {
    console.error("[Document Controller Error - listDocuments]", error);
    res.status(500).json({
      success: false,
      error: error?.message || "Internal server error listing documents.",
    });
  }
}

/**
 * Controller to get metadata for a single document by ID.
 * GET /documents/:id (or /rag/documents/:id)
 */
export async function getDocumentById(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const documentId = getParamId(req.params.id);

    if (!isValidUuid(documentId)) {
      res.status(400).json({
        success: false,
        error: "Invalid document ID format. Must be a valid UUID.",
      });
      return;
    }

    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
          },
        },
      },
    });

    if (!document) {
      res.status(404).json({
        success: false,
        error: `Document with ID '${documentId}' not found.`,
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: { document },
    });
  } catch (error: any) {
    console.error("[Document Controller Error - getDocumentById]", error);
    res.status(500).json({
      success: false,
      error: error?.message || "Internal server error fetching document.",
    });
  }
}

/**
 * Controller to get raw text content of an uploaded document directly from S3.
 * Enables frontend apps to render document preview modal / inline viewer.
 * GET /documents/:id/content (or /rag/documents/:id/content)
 */
export async function getDocumentContent(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const documentId = getParamId(req.params.id);

    if (!isValidUuid(documentId)) {
      res.status(400).json({
        success: false,
        error: "Invalid document ID format. Must be a valid UUID.",
      });
      return;
    }

    const document = await prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      res.status(404).json({
        success: false,
        error: `Document with ID '${documentId}' not found.`,
      });
      return;
    }

    if (!document.s3Key) {
      res.status(400).json({
        success: false,
        error: "Document record does not contain an s3Key.",
      });
      return;
    }

    let content = "";
    try {
      content = await downloadFileContentFromS3(document.s3Key);
    } catch (s3Error: any) {
      console.error("[Document Content - S3 Fetch Error]", s3Error);
      res.status(502).json({
        success: false,
        error: `Failed to download file from S3 storage: ${s3Error.message}`,
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        id: document.id,
        filename: document.filename,
        mimeType: document.mimeType,
        status: document.status,
        version: document.version,
        s3Key: document.s3Key,
        content,
        charCount: content.length,
      },
    });
  } catch (error: any) {
    console.error("[Document Controller Error - getDocumentContent]", error);
    res.status(500).json({
      success: false,
      error: error?.message || "Internal server error fetching document content.",
    });
  }
}

/**
 * Controller to generate a presigned download/view URL for a document.
 * GET /documents/:id/view-url (or /download-url)
 * Query params:
 *   - expiresIn?: number (in seconds, default 3600)
 */
export async function getDocumentDownloadUrl(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const documentId = getParamId(req.params.id);

    if (!isValidUuid(documentId)) {
      res.status(400).json({
        success: false,
        error: "Invalid document ID format. Must be a valid UUID.",
      });
      return;
    }

    const document = await prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      res.status(404).json({
        success: false,
        error: `Document with ID '${documentId}' not found.`,
      });
      return;
    }

    if (!document.s3Key) {
      res.status(400).json({
        success: false,
        error: "Document record does not contain an s3Key.",
      });
      return;
    }

    const expiresIn = Number(req.query.expiresIn) || 3600;

    const downloadUrl = await generatePresignedDownloadUrl({
      key: document.s3Key,
      filename: document.filename,
      expiresIn,
    });

    res.status(200).json({
      success: true,
      data: {
        id: document.id,
        filename: document.filename,
        s3Key: document.s3Key,
        downloadUrl,
        expiresIn,
      },
    });
  } catch (error: any) {
    console.error("[Document Controller Error - getDocumentDownloadUrl]", error);
    res.status(500).json({
      success: false,
      error: error?.message || "Internal server error generating download URL.",
    });
  }
}

/**
 * Controller to delete a document record from the database and S3.
 * DELETE /documents/:id (or /rag/documents/:id)
 */
export async function deleteDocument(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const documentId = getParamId(req.params.id);

    if (!isValidUuid(documentId)) {
      res.status(400).json({
        success: false,
        error: "Invalid document ID format. Must be a valid UUID.",
      });
      return;
    }

    const document = await prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      res.status(404).json({
        success: false,
        error: `Document with ID '${documentId}' not found.`,
      });
      return;
    }

    // 1. Attempt to delete S3 file if key exists
    if (document.s3Key) {
      try {
        await deleteFileFromS3(document.s3Key);
        console.log(`[Document Controller] Deleted S3 object for key: ${document.s3Key}`);
      } catch (s3Error: any) {
        console.warn(`[Document Controller] S3 delete warning for key ${document.s3Key}: ${s3Error.message}`);
      }
    }

    // 2. Delete all vector embeddings and chunk records from Redis Vector Store
    let deletedVectorChunks = 0;
    try {
      const vectorRes = await deleteDocumentFromVectorStore(documentId);
      deletedVectorChunks = vectorRes.deletedChunks;
      console.log(
        `[Document Controller] Deleted ${deletedVectorChunks} chunks from vector store for doc ${documentId}`
      );
    } catch (vectorError: any) {
      console.warn(
        `[Document Controller] Vector store delete warning for doc ${documentId}: ${vectorError.message}`
      );
    }

    // 3. Delete document record from database
    await prisma.document.delete({
      where: { id: documentId },
    });

    res.status(200).json({
      success: true,
      message: `Document '${document.filename}' deleted successfully.`,
      data: {
        id: documentId,
        filename: document.filename,
        deletedVectorChunks,
      },
    });

  } catch (error: any) {
    console.error("[Document Controller Error - deleteDocument]", error);
    res.status(500).json({
      success: false,
      error: error?.message || "Internal server error deleting document.",
    });
  }
}


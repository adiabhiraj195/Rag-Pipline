import { Router } from "express";
import {
  listDocuments,
  getDocumentById,
  getDocumentContent,
  getDocumentDownloadUrl,
  deleteDocument,
} from "../controller/document-controller";
import { optionalAuthenticateToken } from "../middleware/auth-middleware";

const documentRouters = Router();

// Apply optional auth middleware across all document routes
// This automatically extracts user context if Bearer token is provided
documentRouters.use(optionalAuthenticateToken);

// List uploaded documents with pagination, filters, and search
documentRouters.get("/", listDocuments);

// Get single document metadata
documentRouters.get("/:id", getDocumentById);

// Fetch raw text content of document for inline preview
documentRouters.get("/:id/content", getDocumentContent);

// Presigned download and view URLs for file access
documentRouters.get("/:id/view-url", getDocumentDownloadUrl);
documentRouters.get("/:id/download-url", getDocumentDownloadUrl);

// Delete document record and S3 file
documentRouters.delete("/:id", deleteDocument);

export default documentRouters;


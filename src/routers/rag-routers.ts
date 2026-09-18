import { Router } from "express";
import {
  createPresignedUrl,
  injestFileToStore,
  getJobStatus,
} from "../controller/injestion-controller";
import { handleChatQuery } from "../controller/chat-controller";
import { requireAdmin } from "../middleware/auth-middleware";

const ragRouters = Router();

// Routes to generate a presigned S3 upload URL for direct client uploads (Admin only)
ragRouters.post("/upload-url", requireAdmin, createPresignedUrl);
ragRouters.post("/presigned-url", requireAdmin, createPresignedUrl);

// Route to queue a document ingestion job (Admin only)
ragRouters.post("/injestTXT", requireAdmin, injestFileToStore);

// Route to check status and progress of an ingestion job (Admin only)
ragRouters.get("/job-status/:jobId", requireAdmin, getJobStatus);

// Route for RAG chat retrieval pipeline (Accessible for query retrieval)
ragRouters.post("/chat", handleChatQuery);

export default ragRouters;
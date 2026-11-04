import { Router } from "express";
import {
  createPresignedUrl,
  injestFileToStore,
  getJobStatus,
  getChunkingStrategies,
} from "../controller/injestion-controller";
import { handleChatQuery } from "../controller/chat-controller";

import documentRouters from "./document-routers";

const ragRouters = Router();

// Route to generate a presigned S3 upload URL for direct client uploads
ragRouters.post("/upload-url", createPresignedUrl);
ragRouters.post("/presigned-url", createPresignedUrl);

// Route to inspect available chunking strategies (e.g. recursive, structure_aware)
ragRouters.get("/chunking-strategies", getChunkingStrategies);
ragRouters.get("/chunking-methods", getChunkingStrategies);

// Route to queue a document ingestion job (supports both text and PDF with user-selected chunkingStrategy)
ragRouters.post("/injestTXT", injestFileToStore);
ragRouters.post("/injest", injestFileToStore);
ragRouters.post("/ingest", injestFileToStore);
ragRouters.post("/ingest-document", injestFileToStore);

// Route to check status and progress of an ingestion job
ragRouters.get("/job-status/:jobId", getJobStatus);

// Route for RAG chat retrieval pipeline
ragRouters.post("/chat", handleChatQuery);

// Document inspection & management routes
ragRouters.use("/documents", documentRouters);

export default ragRouters;
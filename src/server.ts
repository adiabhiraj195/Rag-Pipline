import "dotenv/config";
import express from "express";
import ragRouters from "./routers/rag-routers";
import authRouters from "./routers/auth-routers";
import conversationRouters from "./routers/conversation-routers";
import cors from "cors"
import { requestLogger } from "./middleware/logger-middleware";
// Initialize BullMQ worker to process background jobs
import "./worker/injestion-worker";

const app = express();
const PORT = process.env.PORT || 8000;

app.use(cors({
  origin:"*"
}))

app.use(express.json());

// Global request logger middleware (logs every incoming request and outgoing response)
app.use(requestLogger);

// Auth routes (User registration, login, profile)
app.use("/auth", authRouters);
app.use("/api/auth", authRouters);

// Conversation routes (Start conversation, list, send message, RAG retrieval)
app.use("/conversations", conversationRouters);
app.use("/api/conversations", conversationRouters);

// Mount existing RAG routes both at /rag and root for convenience
app.use("/rag", ragRouters);
app.use("/", ragRouters);

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`[Server] Listening on port ${PORT}`);
  console.log(`[Server] Auth endpoints: POST http://localhost:${PORT}/auth/register, /auth/login`);
  console.log(`[Server] Conversation endpoints: POST/GET http://localhost:${PORT}/conversations, POST /conversations/:id/messages`);
  console.log(`[Server] Presigned upload URL: POST http://localhost:${PORT}/rag/upload-url (or /upload-url)`);
  console.log(`[Server] Ingestion endpoint: POST http://localhost:${PORT}/rag/injestTXT (or /injestTXT)`);
  console.log(`[Server] Job status endpoint: GET http://localhost:${PORT}/rag/job-status/:jobId`);
  console.log(`[Server] Chat RAG endpoint: POST http://localhost:${PORT}/rag/chat (or /chat)`);
});
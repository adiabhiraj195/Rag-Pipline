import "dotenv/config";
import express from "express";
import ragRouters from "./routers/rag-routers";
// Initialize BullMQ worker to process background jobs
import "./worker/injestion-worker";

const app = express();
const PORT = process.env.PORT || 8000;

app.use(express.json());

// Mount RAG routes both at /rag and root for convenience
app.use("/rag", ragRouters);
app.use("/", ragRouters);

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`[Server] Listening on port ${PORT}`);
  console.log(`[Server] Presigned upload URL: POST http://localhost:${PORT}/rag/upload-url (or /upload-url)`);
  console.log(`[Server] Ingestion endpoint: POST http://localhost:${PORT}/rag/injestTXT (or /injestTXT)`);
  console.log(`[Server] Job status endpoint: GET http://localhost:${PORT}/rag/job-status/:jobId`);
});
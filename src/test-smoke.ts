import path from "path";
import {
  loadTextDocument,
  loadTextContent,
  loadPdfFromBuffer,
  isPdfDocument,
  splitLoadedTextDocument,
} from "./rag/injestion/load-document";
import {
  runChunkingMethod,
  resolveChunkingStrategy,
  listChunkingMethods,
  getChunkingMethod,
} from "./rag/chunking";
import { enrichChunks } from "./rag/injestion/enrich-chunks";
import {
  createPresignedUrl,
  injestFileToStore,
  getChunkingStrategies,
} from "./controller/injestion-controller";
import { prisma } from "./config/prisma";
import { ingestionQueue } from "./queue/injestion-queue";
import type { Request, Response } from "express";

function createMockReqRes(body: Record<string, any> = {}) {
  const req = {
    body,
    params: {},
    query: {},
  } as unknown as Request;

  let statusCode = 200;
  let responseData: any = null;

  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(data: any) {
      responseData = data;
      return this;
    },
  } as unknown as Response;

  return {
    req,
    res,
    getStatus: () => statusCode,
    getData: () => responseData,
  };
}

// Minimal valid PDF binary string for testing PDF parser
const SAMPLE_MINIMAL_PDF = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 55 >> stream
BT
/F1 24 Tf
100 700 Td
(Hello PDF Structure World) Tj
ET
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000244 00000 n 
0000000350 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
426
%%EOF`;

async function main() {
  console.log("=== 1. Testing Document Loader & Splitter & Enrichment ===");
  const testFile = path.resolve("data/sample.txt");
  const docs = await loadTextDocument(testFile);
  console.log(`✓ Loaded document from file with length ${docs[0].pageContent.length} chars.`);

  // Test in-memory loadTextContent (as used by S3 downloader)
  const sampleS3Text =
    "RAG pipelines retrieve relevant passages and generate grounded answers. " +
    "Chunking and embedding allow vector databases like Redis to perform similarity search.";
  const inMemoryDocs = loadTextContent(sampleS3Text, {
    s3Key: "uploads/test.txt",
    filename: "test.txt",
    mimeType: "text/plain",
  });
  console.log(`✓ Loaded document from in-memory string with ${inMemoryDocs[0].pageContent.length} chars.`);

  // Test recursive character chunker through splitLoadedTextDocument
  const chunks = await splitLoadedTextDocument(inMemoryDocs, {
    chunkSize: 50,
    chunkOverlap: 10,
    strategy: "recursive",
  });
  console.log(`✓ Document split into ${chunks.length} chunks using custom chunkSize=50, chunkOverlap=10.`);
  if (chunks[0].metadata?.chunkingStrategy !== "recursive") {
    throw new Error("Expected chunkingStrategy 'recursive' in chunk metadata.");
  }

  const enriched = await enrichChunks({
    chunks,
    documentId: "c28f64e2-d3ab-41c3-8f0b-2200dc890288",
    tenantId: "00000000-0000-0000-0000-000000000000",
    version: 1,
    customMetadata: {
      s3Key: "uploads/test.txt",
      filename: "test.txt",
      mimeType: "text/plain",
    },
    generateContextAndSummary: false,
  });

  const ids = new Set<string>();
  for (const c of enriched) {
    if (ids.has(c.metadata.chunkId)) {
      throw new Error(`Duplicate chunkId found: ${c.metadata.chunkId}`);
    }
    ids.add(c.metadata.chunkId);
  }
  console.log(`✓ All ${ids.size} chunks have distinct chunk IDs without collision.`);

  // Verify context, summary, and embeddingText fields
  if (!enriched[0].metadata.context || typeof enriched[0].metadata.context !== "string") {
    throw new Error("Missing or invalid 'context' field in enriched chunk metadata.");
  }
  if (!enriched[0].metadata.summary || typeof enriched[0].metadata.summary !== "string") {
    throw new Error("Missing or invalid 'summary' field in enriched chunk metadata.");
  }
  if (
    !enriched[0].metadata.embeddingText ||
    !enriched[0].metadata.embeddingText.includes("Context:") ||
    !enriched[0].metadata.embeddingText.includes("Summary:") ||
    !enriched[0].metadata.embeddingText.includes("Content:")
  ) {
    throw new Error("Missing or malformed 'embeddingText' combining context, summary, and content.");
  }

  console.log(`✓ Chunk enrichment successfully generated context, summary, and embeddingText.`);

  console.log("\n=== 2. Testing Chunking Abstraction & Structure-Aware Chunking ===");

  // A. Check strategy resolution & registry
  const strategies = listChunkingMethods();
  console.log(`✓ Registered chunking methods: ${strategies.map((s) => s.name).join(", ")}`);
  if (!strategies.some((s) => s.name === "recursive") || !strategies.some((s) => s.name === "structure_aware")) {
    throw new Error("Missing expected chunking strategies in registry.");
  }

  if (resolveChunkingStrategy("structure-aware") !== "structure_aware") {
    throw new Error("Failed to resolve alias 'structure-aware' to 'structure_aware'");
  }
  if (resolveChunkingStrategy("recursive_character") !== "recursive") {
    throw new Error("Failed to resolve alias 'recursive_character' to 'recursive'");
  }
  console.log("✓ Successfully verified alias resolution for chunking strategies.");

  // B. Test Structure-Aware Chunker on structured content
  const structuredMarkdown = `# Engineering Guidelines
This document details system standards and chunking behaviors.

## Chunking Strategies
RAG pipelines require chunking to create digestible context windows for retrieval.

### Structure-Aware Ingestion
Structure-aware chunking preserves heading hierarchies, list items, and table rows.
It ensures that context is never lost during semantic search.

## Deployment & Verification
Ensure that all unit tests pass before deploying changes.
`;

  const structuredDoc = loadTextContent(structuredMarkdown, {
    filename: "guidelines.md",
    pageNumber: 1,
  });

  const structuredChunks = await runChunkingMethod(structuredDoc, {
    strategy: "structure_aware",
    chunkSize: 300,
    chunkOverlap: 50,
  });

  console.log(`✓ Structure-aware chunking generated ${structuredChunks.length} chunks.`);
  if (structuredChunks.length === 0) {
    throw new Error("Structure-aware chunking produced 0 chunks.");
  }

  const firstChunk = structuredChunks[0];
  if (firstChunk.metadata?.chunkingStrategy !== "structure_aware") {
    throw new Error("Structure-aware chunk missing chunkingStrategy in metadata.");
  }
  if (!firstChunk.metadata?.headingPath) {
    throw new Error("Structure-aware chunk missing headingPath in metadata.");
  }
  console.log(`✓ First chunk heading path: "${firstChunk.metadata.headingPath}"`);
  console.log(`✓ Chunk content preview:\n${firstChunk.pageContent.slice(0, 120)}...`);

  console.log("\n=== 3. Testing PDF Document Parsing ===");

  if (!isPdfDocument("report.pdf") || !isPdfDocument("doc.txt", "application/pdf")) {
    throw new Error("isPdfDocument failed to identify PDF file/mime.");
  }
  if (isPdfDocument("report.txt", "text/plain")) {
    throw new Error("isPdfDocument falsely identified text file as PDF.");
  }
  console.log("✓ isPdfDocument correctly detects PDF extension and MIME type.");

  const pdfBuffer = Buffer.from(SAMPLE_MINIMAL_PDF);
  const pdfResult = await loadPdfFromBuffer(pdfBuffer, {
    filename: "sample-test.pdf",
  });

  console.log(`✓ PDF parser extracted ${pdfResult.pageCount} page(s), fullText length: ${pdfResult.fullText.length}.`);
  if (!pdfResult.fullText.includes("Hello PDF Structure World")) {
    throw new Error(`Expected text 'Hello PDF Structure World' not found in PDF output: "${pdfResult.fullText}"`);
  }
  if (pdfResult.documents.length === 0 || pdfResult.documents[0].metadata?.fileType !== "pdf") {
    throw new Error("PDF parser failed to create valid Document with fileType='pdf'");
  }
  console.log("✓ PDF Document object created successfully with pageNumber and PDF metadata.");

  // Run structure-aware chunking on parsed PDF document
  const pdfChunks = await runChunkingMethod(pdfResult.documents, {
    strategy: "structure_aware",
    chunkSize: 500,
  });
  console.log(`✓ Structure-aware chunking executed on PDF documents, generated ${pdfChunks.length} chunk(s).`);

  console.log("\n=== 4. Testing Controller Validation & Presigned URL Generation ===");

  // Case A: /upload-url - missing filename
  {
    const mock = createMockReqRes({});
    await createPresignedUrl(mock.req, mock.res);
    if (mock.getStatus() === 400 && mock.getData()?.success === false) {
      console.log(`✓ /upload-url missing filename returned 400: "${mock.getData()?.error}"`);
    } else {
      throw new Error(`Case /upload-url missing filename failed: status ${mock.getStatus()}`);
    }
  }

  // Case B: /upload-url - valid request with PDF auto-detection
  {
    const mock = createMockReqRes({
      filename: "financial-statement.pdf",
    });
    await createPresignedUrl(mock.req, mock.res);
    const data = mock.getData();
    if (
      mock.getStatus() === 200 &&
      data?.success === true &&
      data.data?.presignedUrl &&
      data.data?.mimeType === "application/pdf"
    ) {
      console.log(`✓ /upload-url auto-detected PDF MIME type: ${data.data.mimeType}`);
      console.log(`  s3Key: ${data.data.s3Key}`);
    } else {
      throw new Error(`Case /upload-url PDF request failed: ${JSON.stringify(data)}`);
    }
  }

  // Case C: /injestTXT - Missing s3Key
  {
    const mock = createMockReqRes({});
    await injestFileToStore(mock.req, mock.res);
    if (mock.getStatus() === 400 && mock.getData()?.success === false) {
      console.log(`✓ /injestTXT missing s3Key correctly returned 400: "${mock.getData()?.error}"`);
    } else {
      throw new Error(`Case /injestTXT missing s3Key failed: status ${mock.getStatus()}`);
    }
  }

  // Case D: /injestTXT - s3Key provided but missing filename
  {
    const mock = createMockReqRes({ s3Key: "uploads/sample.txt" });
    await injestFileToStore(mock.req, mock.res);
    if (mock.getStatus() === 400 && mock.getData()?.success === false) {
      console.log(`✓ /injestTXT missing filename when s3Key is given returned 400: "${mock.getData()?.error}"`);
    } else {
      throw new Error(`Case /injestTXT missing filename failed: status ${mock.getStatus()}`);
    }
  }

  // Case E: /injestTXT - Invalid chunkingStrategy provided
  {
    const mock = createMockReqRes({
      s3Key: "uploads/sample.txt",
      filename: "sample.txt",
      chunkingStrategy: "unsupported_unknown_strategy",
    });
    await injestFileToStore(mock.req, mock.res);
    if (
      mock.getStatus() === 400 &&
      mock.getData()?.success === false &&
      mock.getData()?.error?.includes("Unsupported chunking strategy")
    ) {
      console.log(`✓ /injestTXT invalid chunkingStrategy returned 400: "${mock.getData()?.error}"`);
    } else {
      throw new Error(`Case /injestTXT invalid chunkingStrategy failed: status ${mock.getStatus()}`);
    }
  }

  // Case F: /injestTXT - Valid structure_aware chunkingStrategy with mocked DB & Queue
  {
    const origCreate = prisma.document.create;
    const origAdd = ingestionQueue.add;
    try {
      (prisma.document as any).create = async (args: any) => ({
        id: args.data.id,
        status: "PENDING",
      });
      (ingestionQueue as any).add = async () => ({
        id: "mock-job-999",
      });

      const mock = createMockReqRes({
        s3Key: "uploads/sample.pdf",
        filename: "sample.pdf",
        chunkingStrategy: "structure_aware",
      });
      await injestFileToStore(mock.req, mock.res);
      if (
        mock.getStatus() === 202 &&
        mock.getData()?.success === true &&
        mock.getData()?.data?.chunkingStrategy === "structure_aware" &&
        mock.getData()?.data?.mimeType === "application/pdf"
      ) {
        console.log(`✓ /injestTXT accepted structure_aware PDF ingestion job successfully.`);
        console.log(`  jobId: ${mock.getData()?.data?.jobId}, strategy: ${mock.getData()?.data?.chunkingStrategy}`);
      } else {
        throw new Error(`Case /injestTXT valid structure_aware request failed: ${JSON.stringify(mock.getData())}`);
      }
    } finally {
      (prisma.document as any).create = origCreate;
      (ingestionQueue as any).add = origAdd;
    }
  }

  // Case G: /chunking-strategies - list available strategies
  {
    const mock = createMockReqRes();
    await getChunkingStrategies(mock.req, mock.res);
    const data = mock.getData();
    if (
      mock.getStatus() === 200 &&
      data?.success === true &&
      Array.isArray(data?.data?.strategies) &&
      data.data.strategies.length >= 2
    ) {
      console.log(`✓ /chunking-strategies returned ${data.data.strategies.length} strategies.`);
    } else {
      throw new Error(`Case /chunking-strategies failed: ${JSON.stringify(data)}`);
    }
  }

  console.log("\n=== All unit, smoke, PDF, and structure-aware chunking tests passed successfully! ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});

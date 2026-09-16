import path from "path";
import {
  loadTextDocument,
  loadTextContent,
  splitLoadedTextDocument,
} from "./injestion/load-document";
import { enrichChunks } from "./injestion/enrich-chunks";
import {
  createPresignedUrl,
  injestFileToStore,
} from "./controller/injestion-controller";
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

  const chunks = await splitLoadedTextDocument(inMemoryDocs, {
    chunkSize: 50,
    chunkOverlap: 10,
  });
  console.log(`✓ Document split into ${chunks.length} chunks using custom chunkSize=50, chunkOverlap=10.`);

  const enriched = enrichChunks({
    chunks,
    documentId: "c28f64e2-d3ab-41c3-8f0b-2200dc890288",
    tenantId: "00000000-0000-0000-0000-000000000000",
    version: 1,
    customMetadata: {
      s3Key: "uploads/test.txt",
      filename: "test.txt",
      mimeType: "text/plain",
    },
  });

  const ids = new Set<string>();
  for (const c of enriched) {
    if (ids.has(c.metadata.chunkId)) {
      throw new Error(`Duplicate chunkId found: ${c.metadata.chunkId}`);
    }
    ids.add(c.metadata.chunkId);
  }
  console.log(`✓ All ${ids.size} chunks have distinct chunk IDs without collision.`);
  console.log(`✓ First chunk metadata sample:`, {
    chunkId: enriched[0].metadata.chunkId,
    chunkIndex: enriched[0].metadata.chunkIndex,
    totalChunks: enriched[0].metadata.totalChunks,
    documentId: enriched[0].metadata.documentId,
    tenantId: enriched[0].metadata.tenantId,
    s3Key: enriched[0].metadata.s3Key,
    mimeType: enriched[0].metadata.mimeType,
  });

  console.log("\n=== 2. Testing Controller Validation & Presigned URL Generation ===");

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

  // Case B: /upload-url - valid request
  {
    const mock = createMockReqRes({
      filename: "my-handbook.txt",
      mimeType: "text/plain",
    });
    await createPresignedUrl(mock.req, mock.res);
    const data = mock.getData();
    if (
      mock.getStatus() === 200 &&
      data?.success === true &&
      data.data?.presignedUrl &&
      data.data?.s3Key
    ) {
      console.log(`✓ /upload-url generated presigned URL successfully:`);
      console.log(`  s3Key: ${data.data.s3Key}`);
      console.log(`  bucket: ${data.data.bucket}`);
      console.log(`  presignedUrl prefix: ${data.data.presignedUrl.slice(0, 45)}...`);
    } else {
      throw new Error(`Case /upload-url valid request failed: ${JSON.stringify(data)}`);
    }
  }

  // Case C: /injestTXT - Missing s3Key and filePath
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

  // Case E: /injestTXT - invalid negative chunkSize
  {
    const mock = createMockReqRes({
      s3Key: "uploads/sample.txt",
      filename: "sample.txt",
      chunkSize: -10,
    });
    await injestFileToStore(mock.req, mock.res);
    if (mock.getStatus() === 400 && mock.getData()?.success === false) {
      console.log(`✓ /injestTXT invalid negative chunkSize returned 400: "${mock.getData()?.error}"`);
    } else {
      throw new Error(`Case /injestTXT invalid negative chunkSize failed: status ${mock.getStatus()}`);
    }
  }

  // Case F: /injestTXT - invalid chunkOverlap
  {
    const mock = createMockReqRes({
      s3Key: "uploads/sample.txt",
      filename: "sample.txt",
      chunkOverlap: "not-a-number",
    });
    await injestFileToStore(mock.req, mock.res);
    if (mock.getStatus() === 400 && mock.getData()?.success === false) {
      console.log(`✓ /injestTXT non-numeric chunkOverlap returned 400: "${mock.getData()?.error}"`);
    } else {
      throw new Error(`Case /injestTXT non-numeric chunkOverlap failed: status ${mock.getStatus()}`);
    }
  }

  console.log("\n=== All unit & smoke tests passed successfully! ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});

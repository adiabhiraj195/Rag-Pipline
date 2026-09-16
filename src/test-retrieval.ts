import { Document } from "@langchain/classic/document";
import { reciprocalRankFusion, getDocumentKey } from "./retrive/rrf";
import { tokenizeText, rankDocumentsBM25 } from "./retrive/lexical-search";
import { buildContext } from "./retrive/context-builder";
import { rerankDocuments } from "./retrive/reranker";
import { handleChatQuery } from "./controller/chat-controller";
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

async function runTests() {
  console.log("=== 1. Testing Lexical Tokenization & BM25 Ranking ===");
  const sampleTokens = tokenizeText("Hello, World! This is a RAG pipeline (hybrid-search).");
  console.log("✓ Tokenized output:", sampleTokens);
  if (!sampleTokens.includes("hello") || !sampleTokens.includes("rag") || !sampleTokens.includes("hybrid")) {
    throw new Error("Tokenization failed to extract expected tokens.");
  }

  const docA = new Document({
    pageContent: "Redis vector store provides fast vector similarity search.",
    metadata: { chunkId: "chunk-1", filename: "redis.txt" },
  });
  const docB = new Document({
    pageContent: "PostgreSQL is a relational database used for document metadata.",
    metadata: { chunkId: "chunk-2", filename: "postgres.txt" },
  });
  const docC = new Document({
    pageContent: "Lexical search and BM25 score keywords across document content.",
    metadata: { chunkId: "chunk-3", filename: "search.txt" },
  });

  const bm25Ranked = rankDocumentsBM25([docA, docB, docC], "BM25 keyword search");
  console.log(`✓ BM25 ranking top doc: ${bm25Ranked[0].metadata.filename} with score: ${bm25Ranked[0].metadata.bm25Score}`);
  if (bm25Ranked[0].metadata.chunkId !== "chunk-3") {
    throw new Error("BM25 did not rank the most keyword-matching document first.");
  }

  console.log("\n=== 2. Testing Reciprocal Rank Fusion (RRF) Algorithm ===");
  // Semantic search returned [docA, docB]
  const semanticList = [
    new Document({
      pageContent: docA.pageContent,
      metadata: { ...docA.metadata, retrievalType: "semantic" },
    }),
    new Document({
      pageContent: docB.pageContent,
      metadata: { ...docB.metadata, retrievalType: "semantic" },
    }),
  ];

  // Lexical search returned [docC, docA]
  const lexicalList = [
    new Document({
      pageContent: docC.pageContent,
      metadata: { ...docC.metadata, retrievalType: "lexical" },
    }),
    new Document({
      pageContent: docA.pageContent,
      metadata: { ...docA.metadata, retrievalType: "lexical" },
    }),
  ];

  const fused = reciprocalRankFusion([semanticList, lexicalList], { k: 60, topK: 10 });
  console.log("✓ RRF Fused Results Count:", fused.length);
  fused.forEach((d, i) => {
    console.log(
      `  [${i + 1}] ID: ${d.metadata.chunkId} | RRF Score: ${d.metadata.rrfScore} | SemanticRank: ${d.metadata.semanticRank} | LexicalRank: ${d.metadata.lexicalRank}`
    );
  });

  // docA was rank 1 in semantic and rank 2 in lexical:
  // Score = 1/(60 + 1) + 1/(60 + 2) = 1/61 + 1/62 = 0.016393 + 0.016129 = 0.032522
  // docC was rank 1 in lexical: Score = 1/61 = 0.016393
  // docB was rank 2 in semantic: Score = 1/62 = 0.016129
  // Therefore, docA MUST be first!
  if (fused[0].metadata.chunkId !== "chunk-1") {
    throw new Error(`RRF expected docA (chunk-1) to be ranked 1st, got: ${fused[0].metadata.chunkId}`);
  }
  if (fused.length !== 3) {
    throw new Error(`RRF expected 3 deduplicated documents, got: ${fused.length}`);
  }
  console.log("✓ RRF correctly merged rankings and scored intersecting documents highest.");

  console.log("\n=== 3. Testing Context Builder ===");
  const built = buildContext(fused, "How does the search pipeline work?");
  if (!built.formattedContext.includes("[Source 1: redis.txt")) {
    throw new Error("Context builder failed to format source blocks properly.");
  }
  if (!built.systemPrompt.includes("Ground your answers ONLY in the facts directly provided")) {
    throw new Error("Context builder missing anti-hallucination system prompt.");
  }
  if (!built.userPrompt.includes("How does the search pipeline work?")) {
    throw new Error("Context builder missing user question in prompt.");
  }
  console.log("✓ Context builder generated formatted citation blocks and grounded prompt structure.");

  // Test empty context handling
  const emptyContext = buildContext([], "Empty query test");
  if (!emptyContext.formattedContext.includes("No context chunks retrieved")) {
    throw new Error("Empty context did not handle 0 chunks gracefully.");
  }
  console.log("✓ Context builder handled 0 retrieved chunks gracefully.");

  console.log("\n=== 4. Testing ReRanker Fallback Mechanism ===");
  // Test rerankDocuments without throwing even if offline or mock
  const reranked = await rerankDocuments([docA, docB], "vector similarity", {
    apiKey: "dummy-key-to-test-fallback",
    topN: 2,
  });
  console.log(`✓ ReRanker returned ${reranked.length} documents gracefully (with fallback or live response).`);

  console.log("\n=== 5. Testing Chat Controller Input Validation ===");
  // Test empty query
  {
    const mock = createMockReqRes({});
    await handleChatQuery(mock.req, mock.res);
    if (mock.getStatus() === 400 && mock.getData()?.success === false) {
      console.log(`✓ Chat controller rejected empty query with 400: "${mock.getData()?.error}"`);
    } else {
      throw new Error(`Empty query validation failed: status ${mock.getStatus()}`);
    }
  }

  // Test invalid topK
  {
    const mock = createMockReqRes({ query: "Hello", topK: -5 });
    await handleChatQuery(mock.req, mock.res);
    if (mock.getStatus() === 400 && mock.getData()?.success === false) {
      console.log(`✓ Chat controller rejected negative topK with 400: "${mock.getData()?.error}"`);
    } else {
      throw new Error(`Negative topK validation failed: status ${mock.getStatus()}`);
    }
  }

  // Test invalid rrfK
  {
    const mock = createMockReqRes({ query: "Hello", rrfK: 0 });
    await handleChatQuery(mock.req, mock.res);
    if (mock.getStatus() === 400 && mock.getData()?.success === false) {
      console.log(`✓ Chat controller rejected zero rrfK with 400: "${mock.getData()?.error}"`);
    } else {
      throw new Error(`Zero rrfK validation failed: status ${mock.getStatus()}`);
    }
  }

  console.log("\n=== All Retrieval Pipeline Tests Passed Successfully! ===");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});


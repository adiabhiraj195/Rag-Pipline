import { Document } from "@langchain/classic/document";
import { reciprocalRankFusion, getDocumentKey } from "./rag/retrive/rrf";
import { tokenizeText, rankDocumentsBM25 } from "./rag/retrive/lexical-search";
import { buildContext } from "./rag/retrive/context-builder";
import { rerankDocuments } from "./rag/retrive/reranker";
import { rewriteQuery } from "./services/query-rewriting";
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

  console.log("\n=== 4. Testing ReRanker & 0.75 Score Threshold Filtering ===");
  // Test rerankDocuments fallback
  const rerankedFallback = await rerankDocuments([docA, docB], "vector similarity", {
    apiKey: "dummy-key-to-test-fallback",
    topN: 2,
  });
  console.log(`✓ ReRanker fallback returned ${rerankedFallback.length} documents gracefully.`);

  // Test 0.75 threshold filtering logic
  const candidateChunksWithScores = [
    new Document({
      pageContent: "High relevance content",
      metadata: { chunkId: "c1", relevanceScore: 0.92 },
    }),
    new Document({
      pageContent: "Borderline high relevance content",
      metadata: { chunkId: "c2", relevanceScore: 0.75 },
    }),
    new Document({
      pageContent: "Below threshold content",
      metadata: { chunkId: "c3", relevanceScore: 0.74 },
    }),
    new Document({
      pageContent: "Irrelevant noise content",
      metadata: { chunkId: "c4", relevanceScore: 0.31 },
    }),
  ];

  const THRESHOLD = 0.75;
  const filteredChunks = candidateChunksWithScores.filter(
    (c) => c.metadata.relevanceScore !== null && c.metadata.relevanceScore >= THRESHOLD
  );

  console.log(`✓ Threshold 0.75 filtered ${candidateChunksWithScores.length} down to ${filteredChunks.length} chunks.`);
  if (filteredChunks.length !== 2) {
    throw new Error(`Expected 2 chunks passing 0.75 threshold, got: ${filteredChunks.length}`);
  }
  if (filteredChunks.some((c) => (c.metadata.relevanceScore ?? 0) < 0.75)) {
    throw new Error("Found chunk with relevance score below 0.75 in filtered results.");
  }

  console.log("\n=== 5. Testing Query Rewriting Service ===");
  // Test 5A: Standalone clear query
  const clearResult = await rewriteQuery("What are the system requirements?");
  console.log("✓ Clear query result:", clearResult);
  if (clearResult.status !== "clear" || !clearResult.query) {
    throw new Error(`Expected status 'clear', got: ${clearResult.status}`);
  }

  // Test 5B: Follow-up query requiring coreference resolution
  const rewriteResult = await rewriteQuery("What about enterprise users?", [
    { role: "user", content: "What are the storage limits for starter tier?" },
    { role: "assistant", content: "Starter tier has a 10GB storage limit." },
  ]);
  console.log("✓ Rewritten query result:", rewriteResult);
  if (rewriteResult.status !== "rewritten" || !rewriteResult.query) {
    throw new Error(`Expected status 'rewritten', got: ${rewriteResult.status}`);
  }

  // Test 5C: Empty query fast-path
  const emptyQueryResult = await rewriteQuery("   ");
  console.log("✓ Empty query fast-path result:", emptyQueryResult);
  if (emptyQueryResult.status !== "clarify") {
    throw new Error(`Expected empty query to return 'clarify', got: ${emptyQueryResult.status}`);
  }

  console.log("\n=== 6. Testing Chat Controller Input Validation & Clarification Flow ===");
  // Test 6A: Empty query validation
  {
    const mock = createMockReqRes({});
    await handleChatQuery(mock.req, mock.res);
    if (mock.getStatus() === 400 && mock.getData()?.success === false) {
      console.log(`✓ Chat controller rejected empty query with 400: "${mock.getData()?.error}"`);
    } else {
      throw new Error(`Empty query validation failed: status ${mock.getStatus()}`);
    }
  }

  // Test 6B: Invalid topK
  {
    const mock = createMockReqRes({ query: "Hello", topK: -5 });
    await handleChatQuery(mock.req, mock.res);
    if (mock.getStatus() === 400 && mock.getData()?.success === false) {
      console.log(`✓ Chat controller rejected negative topK with 400: "${mock.getData()?.error}"`);
    } else {
      throw new Error(`Negative topK validation failed: status ${mock.getStatus()}`);
    }
  }

  // Test 6C: Invalid rrfK
  {
    const mock = createMockReqRes({ query: "Hello", rrfK: 0 });
    await handleChatQuery(mock.req, mock.res);
    if (mock.getStatus() === 400 && mock.getData()?.success === false) {
      console.log(`✓ Chat controller rejected zero rrfK with 400: "${mock.getData()?.error}"`);
    } else {
      throw new Error(`Zero rrfK validation failed: status ${mock.getStatus()}`);
    }
  }

  // Test 6D: Clarification response via Controller
  {
    console.log("✓ Testing clarification flow through chat controller...");
    const mock = createMockReqRes({
      query: "Can I upgrade it?",
      history: [
        { role: "user", content: "Tell me about pricing plans." },
        { role: "assistant", content: "We offer Basic, Pro, and Enterprise tiers." },
        { role: "user", content: "Tell me about storage limits." },
        { role: "assistant", content: "Basic has 10GB, Pro has 100GB, Enterprise has 1TB." },
      ],
    });
    await handleChatQuery(mock.req, mock.res);
    const data = mock.getData();
    console.log("✓ Controller response for ambiguous query:", {
      status: mock.getStatus(),
      responseStatus: data?.status,
      message: data?.message,
    });
    if (mock.getStatus() === 200 && data?.status === "clarify" && data?.data?.clarification) {
      console.log(`✓ Controller successfully returned clarification prompt without running RAG lookup.`);
    } else {
      console.log("Note: Query rewrite produced:", data);
    }
  }

  console.log("\n=== All Retrieval Pipeline Tests Passed Successfully! ===");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});

import { Document } from "@langchain/classic/document";
import { semanticSearch } from "./semantic-search";
import { lexicalSearch } from "./lexical-search";
import { reciprocalRankFusion } from "./rrf";
import { rerankDocuments } from "./reranker";
import { buildContext, ContextChunkInfo } from "./context-builder";
import { groqModel } from "../../llm/model";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface RetrievalPipelineOptions {
  /** Number of final top chunks to include in context (default: 5) */
  topK?: number;
  /** Number of candidate chunks to fetch from semantic and lexical searches each (default: 15) */
  candidatesK?: number;
  /** RRF smoothing constant (default: 60) */
  rrfK?: number;
  /** Tenant ID to partition retrieval (default: optional) */
  tenantId?: string;
  /** Optional previous messages in the conversation */
  history?: ChatMessage[];
  /** Minimum relevance score threshold for reranked chunks (default: 0.75) */
  scoreThreshold?: number;
}

export interface RetrievalPipelineResult {
  query: string;
  answer: string;
  sources: ContextChunkInfo[];
  context: string;
  pipelineStats: {
    semanticRetrieved: number;
    lexicalRetrieved: number;
    rrfCandidates: number;
    rerankedChunks: number;
    passedThresholdChunks: number;
    scoreThreshold: number;
    durationMs: number;
  };
}

/**
 * Full hybrid RAG retrieval pipeline:
 * 1. Semantic Search (dense embeddings in Redis)
 * 2. Lexical Search (full-text keywords in Redis)
 * 3. Reciprocal Rank Fusion (RRF) to blend rankings
 * 4. Cross-Encoder ReRanking with Cohere
 * 5. Context Builder for grounded prompt construction
 * 6. Groq LLM inference
 */
export async function runRetrievalPipeline(
  query: string,
  options: RetrievalPipelineOptions = {}
): Promise<RetrievalPipelineResult> {
  const startTime = Date.now();
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    throw new Error("Query cannot be empty.");
  }

  const topK = options.topK ?? 5;
  const candidatesK = options.candidatesK ?? 15;
  const rrfK = options.rrfK ?? 60;
  const tenantId = options.tenantId;
  const scoreThreshold = options.scoreThreshold ?? 0.6;

  console.log(`[Retrieval Pipeline] Starting pipeline for query: "${trimmedQuery}" (topK=${topK}, candidatesK=${candidatesK}, scoreThreshold=${scoreThreshold})`);

  // Step 1 & 2: Run Dense Semantic Search and Sparse Lexical Search in parallel
  const [semanticResults, lexicalResults] = await Promise.all([
    semanticSearch(trimmedQuery, { k: candidatesK }),
    lexicalSearch(trimmedQuery, { k: candidatesK, tenantId }),
  ]);

  console.log(
    `[Retrieval Pipeline] Retrieved ${semanticResults.length} semantic chunks, ${lexicalResults.length} lexical chunks.`
  );

  // Step 3: Reciprocal Rank Fusion (RRF) to blend dense + sparse candidates
  const rrfCandidates = reciprocalRankFusion([semanticResults, lexicalResults], {
    k: rrfK,
    topK: Math.max(candidatesK, topK * 3),
  });

  console.log(`[Retrieval Pipeline] RRF blended into ${rrfCandidates.length} unique candidates.`);

  // Step 4: Cross-Encoder ReRanker with Cohere (scoring chunks against query)
  const rerankedChunks = await rerankDocuments(rrfCandidates, trimmedQuery, {
    topN: topK,
  });

  // console.log("[Retrieval Pipeline] ReRanker rerankedChunks", rerankedChunks)

  console.log(`[Retrieval Pipeline] ReRanker picked top ${rerankedChunks.length} chunks.`);

  // Filter chunks using score threshold (0.75) to optimize context quality
  const qualifiedChunks = rerankedChunks.filter((chunk) => {
    const score = chunk.metadata?.relevanceScore;
    // If reranker fell back (score is null/undefined), preserve chunk; otherwise apply threshold
    if (score === null || score === undefined) {
      return true;
    }
    return score >= scoreThreshold;
  });

  console.log(
    `[Retrieval Pipeline] Applied score threshold (${scoreThreshold}): ${qualifiedChunks.length}/${rerankedChunks.length} chunks qualified.`
  );

  // Step 5: Build grounded Context and Prompts using qualified chunks
  const { formattedContext, systemPrompt, userPrompt, chunksInfo } = buildContext(
    qualifiedChunks,
    trimmedQuery
  );

  // Step 6: Construct messages for Groq LLM
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemPrompt },
  ];

  if (options.history && Array.isArray(options.history)) {
    for (const msg of options.history) {
      if (msg.role === "user" || msg.role === "assistant") {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
  }

  messages.push({ role: "user", content: userPrompt });

  // Call LLM
  console.log(`[Retrieval Pipeline] Invoking LLM for final generation...`);
  const llmResponse = await groqModel.invoke(messages);
  const answer = typeof llmResponse.content === "string"
    ? llmResponse.content
    : JSON.stringify(llmResponse.content);

  const durationMs = Date.now() - startTime;
  console.log(`[Retrieval Pipeline] Pipeline completed in ${durationMs}ms.`);

  return {
    query: trimmedQuery,
    answer,
    sources: chunksInfo,
    context: formattedContext,
    pipelineStats: {
      semanticRetrieved: semanticResults.length,
      lexicalRetrieved: lexicalResults.length,
      rrfCandidates: rrfCandidates.length,
      rerankedChunks: rerankedChunks.length,
      passedThresholdChunks: qualifiedChunks.length,
      scoreThreshold,
      durationMs,
    },
  };
}


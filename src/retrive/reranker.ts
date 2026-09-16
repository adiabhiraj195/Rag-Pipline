import { Document } from "@langchain/classic/document";
import { CohereRerank } from "@langchain/cohere";
import { cohereReranker } from "../llm/model";

export interface RerankOptions {
  topN?: number;
  model?: string;
  apiKey?: string;
}

/**
 * Re-ranks a list of candidate documents against the user query using Cohere Cross-Encoder.
 *
 * @param documents - Candidate documents (e.g. from RRF fusion).
 * @param query - User's search query.
 * @param options - Reranker configuration (topN: number of top chunks, model: Cohere model name).
 * @returns Array of Document objects sorted by cross-encoder relevanceScore.
 */
export async function rerankDocuments(
  documents: Document[],
  query: string,
  options: RerankOptions = {}
): Promise<Document[]> {
  const topN = options.topN ?? 5;

  if (!documents || documents.length === 0) {
    return [];
  }

  // If candidate count is already <= topN, and no query, return as is
  if (!query?.trim()) {
    return documents.slice(0, topN);
  }

  const apiKey = options.apiKey || process.env.COHERE_API_KEY;
  const modelName =
    options.model || process.env.COHERE_RERANK_MODEL || "rerank-v3.5";

  if (!apiKey) {
    console.warn(
      "[ReRanker] COHERE_API_KEY is not set. Falling back to top RRF candidate ranking."
    );
    return fallbackRanking(documents, topN);
  }

  try {
    const reranker = new CohereRerank({
      apiKey,
      model: modelName,
      topN,
    });

    // compressDocuments returns documents ordered by relevanceScore
    const rerankedDocs = await reranker.compressDocuments(documents, query);

    return rerankedDocs.map((doc, idx) => {
      return new Document({
        pageContent: doc.pageContent,
        metadata: {
          ...doc.metadata,
          rerankRank: idx + 1,
          relevanceScore:
            doc.metadata?.relevanceScore !== undefined
              ? Number(Number(doc.metadata.relevanceScore).toFixed(4))
              : null,
          rerankModel: modelName,
        },
      });
    });
  } catch (error: any) {
    console.error(
      `[ReRanker] Cohere rerank failed (${error.message}). Falling back to top RRF candidates.`
    );
    return fallbackRanking(documents, topN);
  }
}

/**
 * Graceful fallback when ReRanker API is unavailable.
 */
function fallbackRanking(documents: Document[], topN: number): Document[] {
  return documents.slice(0, topN).map((doc, idx) => {
    return new Document({
      pageContent: doc.pageContent,
      metadata: {
        ...doc.metadata,
        rerankRank: idx + 1,
        relevanceScore: null,
        rerankFallback: true,
      },
    });
  });
}


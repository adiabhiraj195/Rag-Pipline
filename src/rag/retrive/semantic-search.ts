import { Document } from "@langchain/classic/document";
import { getVectorStore } from "../../vector/vector-store";

export interface SemanticSearchOptions {
  k?: number;
  filter?: string | string[];
}

/**
 * Performs dense semantic vector search against the Redis vector store.
 *
 * @param query - The user's query text.
 * @param options - Configuration options (k: number of candidates, filter: optional metadata filter).
 * @returns Array of Document objects ordered by semantic similarity.
 */
export async function semanticSearch(
  query: string,
  options: SemanticSearchOptions = {}
): Promise<Document[]> {
  const trimmed = query?.trim();
  if (!trimmed) {
    return [];
  }

  const k = options.k ?? 10;
  const vectorStore = await getVectorStore();

  try {
    const resultsWithScore = await vectorStore.similaritySearchWithScore(
      trimmed,
      k,
      options.filter
    );

    return resultsWithScore.map(([doc, score]) => {
      return new Document({
        pageContent: doc.pageContent,
        metadata: {
          ...doc.metadata,
          retrievalType: "semantic",
          vectorScore: score,
        },
      });
    });
  } catch (error: any) {
    console.warn(`[Semantic Search] similaritySearchWithScore failed, falling back to similaritySearch: ${error.message}`);
    const results = await vectorStore.similaritySearch(trimmed, k, options.filter);
    return results.map((doc) => {
      return new Document({
        pageContent: doc.pageContent,
        metadata: {
          ...doc.metadata,
          retrievalType: "semantic",
        },
      });
    });
  }
}


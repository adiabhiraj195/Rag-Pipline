import { Document } from "@langchain/classic/document";
import { getRedisClient } from "../config/redis";

export interface LexicalSearchOptions {
  k?: number;
  tenantId?: string;
  indexName?: string;
}

/**
 * Unescapes special characters stored by RedisVectorStore.
 */
function unescapeRedisMetadata(str: string): string {
  if (!str) return "{}";
  return str
    .replaceAll('\\"', '"')
    .replaceAll("\\:", ":")
    .replaceAll("\\-", "-");
}

/**
 * Tokenize a text string into normalized terms.
 */
export function tokenizeText(text: string): string[] {
  if (!text) return [];
  const matches = text.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  return matches || [];
}

/**
 * BM25 Scoring algorithm on an array of documents for a given query.
 */
export function rankDocumentsBM25(
  docs: Document[],
  query: string,
  k1: number = 1.2,
  b: number = 0.75
): Document[] {
  const queryTokens = tokenizeText(query);
  if (queryTokens.length === 0 || docs.length === 0) {
    return docs;
  }

  // Pre-tokenize all documents
  const docTokensList = docs.map((doc) => tokenizeText(doc.pageContent));
  const totalDocs = docs.length;
  const avgDocLength =
    docTokensList.reduce((acc, tokens) => acc + tokens.length, 0) / (totalDocs || 1);

  // Calculate Document Frequency (DF) for each query token
  const docFreq: Record<string, number> = {};
  for (const token of queryTokens) {
    let count = 0;
    for (const docTokens of docTokensList) {
      if (docTokens.includes(token)) {
        count++;
      }
    }
    docFreq[token] = count;
  }

  // Calculate BM25 score for each document
  const scoredDocs = docs.map((doc, idx) => {
    const docTokens = docTokensList[idx];
    const docLength = docTokens.length;

    // Count term frequency in current document
    const termCounts: Record<string, number> = {};
    for (const t of docTokens) {
      termCounts[t] = (termCounts[t] || 0) + 1;
    }

    let score = 0;
    for (const qToken of queryTokens) {
      const tf = termCounts[qToken] || 0;
      if (tf === 0) continue;

      const df = docFreq[qToken] || 0;
      // Robertson-Spärck Jones IDF
      const idf = Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1);
      const numerator = tf * (k1 + 1);
      const denominator =
        tf + k1 * (1 - b + (b * docLength) / (avgDocLength || 1));

      score += idf * (numerator / denominator);
    }

    return {
      doc: new Document({
        pageContent: doc.pageContent,
        metadata: {
          ...doc.metadata,
          retrievalType: "lexical",
          bm25Score: Number(score.toFixed(4)),
        },
      }),
      score,
    };
  });

  scoredDocs.sort((a, b) => b.score - a.score);
  return scoredDocs.map((item) => item.doc);
}

/**
 * Performs lexical search across chunks stored in Redis using RediSearch FT.SEARCH.
 *
 * @param query - Keyword query string from user.
 * @param options - Lexical search options (k: max chunks to retrieve, tenantId: optional tenant filter).
 * @returns Array of Document objects ordered by lexical relevance.
 */
export async function lexicalSearch(
  query: string,
  options: LexicalSearchOptions = {}
): Promise<Document[]> {
  const trimmed = query?.trim();
  if (!trimmed) {
    return [];
  }

  const k = options.k ?? 10;
  const indexName = options.indexName || process.env.REDIS_INDEX || "rag_chunks";

  // Extract clean alphanumeric terms from user query
  const tokens = tokenizeText(trimmed);
  if (tokens.length === 0) {
    return [];
  }

  try {
    const client = await getRedisClient();

    // Build RediSearch full-text query matching content:
    // Format: @content:(term1 | term2 | term3)
    // RediSearch uses BM25 scoring for TEXT fields by default
    const escapedTerms = tokens.map((t) => t.replace(/[^a-zA-Z0-9]/g, "")).filter(Boolean);
    if (escapedTerms.length === 0) {
      return [];
    }

    // Build query with prefix matching on terms for better recall: (term1* | term2*)
    const termQuery = escapedTerms.map((t) => `${t}*`).join(" | ");
    const ftQuery = `@content:(${termQuery})`;

    const searchResults = await client.ft.search(indexName, ftQuery, {
      LIMIT: { from: 0, size: k },
      RETURN: ["content", "metadata"],
    });

    if (!searchResults || searchResults.total === 0 || !searchResults.documents) {
      return [];
    }

    const docs: Document[] = [];
    for (const item of searchResults.documents) {
      if (!item.value) continue;
      const content = (item.value.content as string) || "";
      const rawMetadata = (item.value.metadata as string) || "{}";

      let metadata: Record<string, any> = {};
      try {
        metadata = JSON.parse(unescapeRedisMetadata(rawMetadata));
      } catch {
        metadata = {};
      }

      // If tenantId filter is provided, enforce it
      if (options.tenantId && metadata.tenantId && metadata.tenantId !== options.tenantId) {
        continue;
      }

      docs.push(
        new Document({
          pageContent: content,
          metadata: {
            ...metadata,
            retrievalType: "lexical",
            redisKey: item.id,
          },
        })
      );
    }

    // Apply BM25 re-scoring to ensure accurate ranking
    return rankDocumentsBM25(docs, trimmed).slice(0, k);
  } catch (error: any) {
    console.warn(`[Lexical Search] FT.SEARCH failed (${error.message}). Returning empty or fallback.`);
    return [];
  }
}


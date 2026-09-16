import { Document } from "@langchain/classic/document";
import crypto from "crypto";

export interface RRFOptions {
  /**
   * Smoothing parameter k, standard default is 60.
   */
  k?: number;
  /**
   * Maximum number of fused documents to return.
   */
  topK?: number;
}

/**
 * Generates a unique deduplication key for a document chunk.
 */
export function getDocumentKey(doc: Document): string {
  if (doc.metadata?.chunkId) {
    return String(doc.metadata.chunkId);
  }
  if (doc.metadata?.documentId !== undefined && doc.metadata?.chunkIndex !== undefined) {
    return `doc:${doc.metadata.documentId}:chunk:${doc.metadata.chunkIndex}`;
  }
  if (doc.metadata?.redisKey) {
    return String(doc.metadata.redisKey);
  }
  // Hash content if no explicit id is present
  return crypto.createHash("sha256").update(doc.pageContent).digest("hex");
}

/**
 * Merges multiple ranked lists of documents using Reciprocal Rank Fusion (RRF).
 *
 * RRF Score formula:
 * Score(d) = SUM_{list in rankings} 1 / (k + rank(d, list))
 *
 * @param rankedLists - Array of document lists, each ordered by its own relevance rank (1st, 2nd, ...).
 * @param options - RRF configuration (k smoothing factor, topK candidates count).
 * @returns Deduplicated array of Document instances ordered by combined RRF score.
 */
export function reciprocalRankFusion(
  rankedLists: Document[][],
  options: RRFOptions = {}
): Document[] {
  const k = options.k ?? 60;
  const topK = options.topK ?? 20;

  // Map to store combined scores and representative document object
  const scoreMap = new Map<
    string,
    {
      doc: Document;
      score: number;
      semanticRank?: number;
      lexicalRank?: number;
      ranks: Record<number, number>;
    }
  >();

  rankedLists.forEach((docList, listIndex) => {
    docList.forEach((doc, rankIndex) => {
      const rank = rankIndex + 1; // 1-based rank
      const key = getDocumentKey(doc);
      const contribution = 1 / (k + rank);

      const existing = scoreMap.get(key);
      if (existing) {
        existing.score += contribution;
        existing.ranks[listIndex] = rank;
        if (doc.metadata?.retrievalType === "semantic") {
          existing.semanticRank = rank;
        } else if (doc.metadata?.retrievalType === "lexical") {
          existing.lexicalRank = rank;
        }
        // Merge metadata (keeping any richer metadata fields)
        existing.doc.metadata = {
          ...doc.metadata,
          ...existing.doc.metadata,
        };
      } else {
        const item = {
          doc: new Document({
            pageContent: doc.pageContent,
            metadata: { ...doc.metadata },
          }),
          score: contribution,
          semanticRank: doc.metadata?.retrievalType === "semantic" ? rank : undefined,
          lexicalRank: doc.metadata?.retrievalType === "lexical" ? rank : undefined,
          ranks: { [listIndex]: rank },
        };
        scoreMap.set(key, item);
      }
    });
  });

  // Convert map to sorted array
  const sortedItems = Array.from(scoreMap.values()).sort(
    (a, b) => b.score - a.score
  );

  return sortedItems.slice(0, topK).map((item, index) => {
    return new Document({
      pageContent: item.doc.pageContent,
      metadata: {
        ...item.doc.metadata,
        rrfRank: index + 1,
        rrfScore: Number(item.score.toFixed(6)),
        semanticRank: item.semanticRank ?? null,
        lexicalRank: item.lexicalRank ?? null,
      },
    });
  });
}


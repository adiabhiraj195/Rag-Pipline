import { Document } from "@langchain/classic/document";
import { z } from "zod";
import { chunkEnrichmentModel } from "../../llm/model";

// ---------------------------------------------
// Schema for Chunk Context & Summary
// ---------------------------------------------

export const ChunkEnrichmentSchema = z.object({
  context: z
    .string()
    .describe(
      "A succinct explanation (1-2 sentences) of where this chunk sits within the overall document structure, its section or topic, and its relationship to the whole text."
    ),
  summary: z
    .string()
    .describe(
      "A compact summary (strictly 1 to 3 sentences) explaining what this specific chunk itself contains, its key facts, or core message."
    ),
});

export type ChunkEnrichmentResult = z.infer<typeof ChunkEnrichmentSchema>;

export interface EnrichChunksParams {
  chunks: Document[];
  userId?: string;
  tenantId?: string;
  documentId: string;
  version: number;
  customMetadata?: Record<string, any>;
  /** The full document text content to provide global context to the LLM */
  documentContent?: string;
  /** Whether to invoke LLM to generate context and summary (defaults to true if API key is present) */
  generateContextAndSummary?: boolean;
  /** Number of chunks to enrich concurrently with the LLM (default: 3) */
  concurrency?: number;
}

/**
 * Combines content, summary, and context into a unified embedding text representation.
 */
export function createEmbeddingText({
  content,
  summary,
  context,
}: {
  content: string;
  summary: string;
  context: string;
}): string {
  return `Context: ${context.trim()}\n\nSummary: ${summary.trim()}\n\nContent:\n${content.trim()}`;
}

/**
 * Generates fallback context and summary when LLM is skipped or unavailable.
 */
export function getFallbackEnrichment(
  chunkText: string,
  index: number,
  totalChunks: number,
  source: string = "document"
): ChunkEnrichmentResult {
  const normalized = chunkText.trim().replace(/\s+/g, " ");
  const preview = normalized.slice(0, 150);
  return {
    context: `This chunk is located at section ${index + 1} of ${totalChunks} in ${source}.`,
    summary: `Contains: ${preview}${normalized.length > 150 ? "..." : ""}`,
  };
}

/**
 * Invokes LLM to generate context and a compact 1-3 sentence summary for a chunk.
 */
export async function generateChunkContextAndSummary({
  chunkText,
  documentExcerpt,
  source,
  chunkIndex,
  totalChunks,
}: {
  chunkText: string;
  documentExcerpt: string;
  source: string;
  chunkIndex: number;
  totalChunks: number;
}): Promise<ChunkEnrichmentResult> {
  if (!process.env.GROQ_API_KEY) {
    return getFallbackEnrichment(chunkText, chunkIndex, totalChunks, source);
  }

  try {
    const structuredLLM = chunkEnrichmentModel.withStructuredOutput(ChunkEnrichmentSchema);

    const systemPrompt = `You are an expert document understanding and indexing assistant in a RAG pipeline.
Your task is to analyze a specific chunk of text taken from a document and generate two fields:
1. "context": Explains where this chunk sits in the overall document (e.g. its section, topic, and position relative to the whole text).
2. "summary": A compact summary (strictly 1 to 3 sentences) explaining what the chunk itself contains (key points, definitions, data, or instructions).

RULES:
- The summary MUST be compact and concise, between 1 and 3 sentences.
- The context should succinctly situate the chunk within the document structure.
- Do NOT hallucinate or assume facts outside the provided document and chunk.`;

    const userPrompt = `<document_overview>
Source / Filename: ${source || "Document"}
Total Chunks: ${totalChunks}
Current Chunk Position: Chunk ${chunkIndex + 1} of ${totalChunks}
Document Context Excerpt:
${documentExcerpt}
</document_overview>

<chunk_content>
${chunkText}
</chunk_content>

Generate the "context" explaining where this chunk sits in the document, and the compact 1-3 sentence "summary" of what this chunk itself contains.`;

    const result = await structuredLLM.invoke([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);

    return {
      context: result.context?.trim() || `Located at chunk ${chunkIndex + 1} of ${totalChunks} in ${source}.`,
      summary: result.summary?.trim() || `Contains passage from chunk ${chunkIndex + 1}.`,
    };
  } catch (error: any) {
    console.warn(
      `[Enrich Chunks] LLM enrichment failed for chunk #${chunkIndex + 1} (${error.message}). Using fallback.`
    );
    return getFallbackEnrichment(chunkText, chunkIndex, totalChunks, source);
  }
}

/**
 * Concurrency helper to process items with a fixed pool of workers.
 */
async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < items.length) {
      const idx = currentIndex++;
      results[idx] = await fn(items[idx], idx);
    }
  }

  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Enriches document chunks with metadata, LLM-generated context and compact summary,
 * and creates embeddingText combining content, summary, and context.
 */
export async function enrichChunks({
  chunks,
  userId,
  tenantId,
  documentId,
  version,
  customMetadata = {},
  documentContent,
  generateContextAndSummary,
  concurrency = 3,
}: EnrichChunksParams): Promise<Document[]> {
  const totalChunks = chunks.length;
  const timestamp = new Date().toISOString();
  const sourceName =
    customMetadata.filename ||
    customMetadata.source ||
    customMetadata.s3Key ||
    "document.txt";

  // Build document overview/excerpt for context (cap at 12,000 characters to prevent token overflow)
  const fullDocText = documentContent || chunks.map((c) => c.pageContent).join("\n\n");
  const documentExcerpt =
    fullDocText.length > 12000
      ? `${fullDocText.slice(0, 8000)}\n\n[... middle content omitted ...]\n\n${fullDocText.slice(-4000)}`
      : fullDocText;

  const shouldGenerateWithLLM =
    generateContextAndSummary ?? Boolean(process.env.GROQ_API_KEY);

  console.log(
    `[Enrich Chunks] Enriching ${totalChunks} chunks (LLM Enrichment: ${shouldGenerateWithLLM ? "ENABLED" : "DISABLED"}, Concurrency: ${concurrency})...`
  );

  // Generate enrichment (context + summary) for each chunk
  const enrichments: ChunkEnrichmentResult[] = await mapConcurrent(
    chunks,
    shouldGenerateWithLLM ? concurrency : chunks.length,
    async (chunk, index) => {
      if (shouldGenerateWithLLM) {
        return generateChunkContextAndSummary({
          chunkText: chunk.pageContent,
          documentExcerpt,
          source: sourceName,
          chunkIndex: index,
          totalChunks,
        });
      } else {
        return getFallbackEnrichment(chunk.pageContent, index, totalChunks, sourceName);
      }
    }
  );

  return chunks.map((chunk, index) => {
    const chunkId = generateChunkId({ documentId, version, index });
    const enrichment = enrichments[index];
    const embeddingText = createEmbeddingText({
      content: chunk.pageContent,
      summary: enrichment.summary,
      context: enrichment.context,
    });

    return new Document({
      pageContent: chunk.pageContent,
      metadata: {
        ...chunk.metadata,
        ...customMetadata,
        userId,
        tenantId,
        documentId,
        version,
        chunkIndex: index,
        totalChunks,
        chunkId,
        context: enrichment.context,
        summary: enrichment.summary,
        embeddingText,
        content: chunk.pageContent,
        createdAt: timestamp,
      },
    });
  });
}

function generateChunkId({
  documentId,
  version,
  index,
}: {
  documentId: string;
  version: number;
  index: number;
}): string {
  return `chunk:${documentId}:v${version}:${index}`;
}
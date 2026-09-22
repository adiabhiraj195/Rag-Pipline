import { Document } from "@langchain/classic/document";

export interface ContextChunkInfo {
  index: number;
  chunkId?: string;
  filename?: string;
  relevanceScore?: number | null;
  content: string;
  context?: string;
  summary?: string;
}

export interface BuiltContext {
  formattedContext: string;
  systemPrompt: string;
  userPrompt: string;
  chunksInfo: ContextChunkInfo[];
}

/**
 * Builds a structured, citation-friendly context string from retrieved and reranked chunks.
 *
 * @param chunks - Top reranked documents.
 * @param query - The user's query.
 * @returns Structured context with prompts and chunk metadata summary.
 */
export function buildContext(chunks: Document[], query: string): BuiltContext {
  const chunksInfo: ContextChunkInfo[] = chunks.map((chunk, index) => {
    const filename =
      chunk.metadata?.filename ||
      chunk.metadata?.source ||
      chunk.metadata?.s3Key ||
      "Document";
    const chunkId = chunk.metadata?.chunkId || `chunk-${index + 1}`;
    const relevanceScore = chunk.metadata?.relevanceScore ?? null;

    return {
      index: index + 1,
      chunkId,
      filename,
      relevanceScore,
      content: chunk.pageContent.trim(),
      context: chunk.metadata?.context,
      summary: chunk.metadata?.summary,
    };
  });

  if (chunksInfo.length === 0) {
    const systemPrompt =
      "You are a helpful and precise assistant. Answer the user's questions truthfully and accurately.\n\nNote: No relevant documents were found in the knowledge base. Please answer with state that no specific documentation is available.";
    const userPrompt = `User Question: ${query}`;

    return {
      formattedContext: "No context chunks retrieved.",
      systemPrompt,
      userPrompt,
      chunksInfo: [],
    };
  }

  const formattedBlocks = chunksInfo.map((info) => {
    const scoreStr =
      info.relevanceScore !== null && info.relevanceScore !== undefined
        ? ` | Relevance: ${(info.relevanceScore * 100).toFixed(1)}%`
        : "";
    return `[Source ${info.index}: ${info.filename} (ID: ${info.chunkId}${scoreStr})]\n${info.content}`;
  });

  const formattedContext = formattedBlocks.join("\n\n---\n\n");

  const systemPrompt = `You are a knowledgeable, faithful AI assistant answering questions using only the provided context.

    Follow these strict rules:
    1. Ground your answers ONLY in the facts directly provided in the context below. Do not assume or extrapolate facts not present.
    2. If the context does not contain enough information to answer the question, clearly state: "Based on the provided documentation, I do not have enough information to answer this question."
    3. Cite the relevant source numbers or document names (e.g. "[Source 1]" or "according to filename.txt") when making statements.
    4. Be concise, clear, and structured in your explanations.`;

  const userPrompt = `Context information:
    ---------------------
    ${formattedContext}
    ---------------------

    Based strictly on the context above, please answer the following question:
    Question: ${query}`;

  return {
    formattedContext,
    systemPrompt,
    userPrompt,
    chunksInfo,
  };
}


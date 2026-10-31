import { Document } from "@langchain/classic/document";
import { RecursiveCharacterTextSplitter } from "@langchain/classic/text_splitter";
import type { ChunkingMethod, ChunkingOptions, ChunkingStrategy } from "../types";

/**
 * Standard Recursive Character chunking method.
 *
 * Uses LangChain's RecursiveCharacterTextSplitter to split documents
 * recursively by paragraphs, sentences, and words until chunks satisfy the target size.
 */
export class RecursiveCharacterChunker implements ChunkingMethod {
  readonly name: ChunkingStrategy = "recursive";
  readonly displayName = "Recursive Character Splitter";
  readonly description =
    "Splits text recursively by paragraphs (\\n\\n), lines (\\n), sentences, and words based on character count.";

  async chunk(
    documents: Document[],
    options?: ChunkingOptions
  ): Promise<Document[]> {
    if (!documents || documents.length === 0) {
      return [];
    }

    const chunkSize = options?.chunkSize ?? 800;
    const chunkOverlap = options?.chunkOverlap ?? 100;

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize,
      chunkOverlap,
    });

    const rawChunks = await splitter.splitDocuments(documents);

    // Ensure all chunks retain their source metadata and tag chunkingStrategy
    return rawChunks.map((chunk, index) => {
      return new Document({
        pageContent: chunk.pageContent,
        metadata: {
          ...chunk.metadata,
          chunkingStrategy: this.name,
          rawChunkIndex: index,
        },
      });
    });
  }
}

export const recursiveCharacterChunker = new RecursiveCharacterChunker();


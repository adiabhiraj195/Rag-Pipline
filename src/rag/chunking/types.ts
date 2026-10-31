import type { Document } from "@langchain/classic/document";

/**
 * Supported chunking strategies in the RAG ingestion pipeline.
 */
export type ChunkingStrategy = "recursive" | "structure_aware";

/**
 * Recognized aliases and input strings for chunking strategies.
 */
export const CHUNKING_STRATEGY_ALIASES: Record<string, ChunkingStrategy> = {
  recursive: "recursive",
  "recursive-character": "recursive",
  recursive_character: "recursive",
  recursivecharacter: "recursive",
  text_splitter: "recursive",
  structure: "structure_aware",
  "structure-aware": "structure_aware",
  structure_aware: "structure_aware",
  structureaware: "structure_aware",
  structural: "structure_aware",
  semantic_structure: "structure_aware",
  pdf_structure: "structure_aware",
};

/**
 * Options passed to configure chunking behavior.
 */
export interface ChunkingOptions {
  /**
   * The chunking strategy to use: 'recursive' or 'structure_aware'.
   * Defaults to 'recursive'.
   */
  strategy?: ChunkingStrategy | string;

  /**
   * Target or maximum chunk size in characters (default: 800).
   */
  chunkSize?: number;

  /**
   * Overlap between consecutive chunks in characters (default: 100).
   */
  chunkOverlap?: number;

  /**
   * Minimum chunk size below which tiny fragments are merged with neighbors (default: 100).
   */
  minChunkSize?: number;

  /**
   * Maximum allowed chunk size before hard splitting (default: 1200).
   */
  maxChunkSize?: number;

  /**
   * Whether to include the parent section/heading breadcrumb in chunk content (default: true).
   */
  prependHeadingContext?: boolean;

  /**
   * Any additional arbitrary options for specific chunkers.
   */
  [key: string]: any;
}

/**
 * Abstract interface that all chunking methods must implement.
 */
export interface ChunkingMethod {
  /** Strategy identifier key */
  readonly name: ChunkingStrategy;

  /** Human-readable display label */
  readonly displayName: string;

  /** Short description of the chunking approach */
  readonly description: string;

  /**
   * Chunks an array of loaded LangChain documents into smaller semantic chunks.
   *
   * @param documents - Array of loaded source documents (e.g. from text or PDF loader).
   * @param options - Chunking configuration options.
   * @returns Array of chunked Document instances with enriched metadata.
   */
  chunk(documents: Document[], options?: ChunkingOptions): Promise<Document[]>;
}


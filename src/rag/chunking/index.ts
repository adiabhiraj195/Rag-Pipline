import { Document } from "@langchain/classic/document";
import {
  ChunkingMethod,
  ChunkingOptions,
  ChunkingStrategy,
  CHUNKING_STRATEGY_ALIASES,
} from "./types";
import { recursiveCharacterChunker, RecursiveCharacterChunker } from "./methods/recursive-chunker";
import { structureAwareChunker, StructureAwareChunker } from "./methods/structure-aware-chunker";

export * from "./types";
export * from "./methods/recursive-chunker";
export * from "./methods/structure-aware-chunker";

/**
 * Registry holding the registered chunking strategy implementations.
 */
const chunkingMethodRegistry = new Map<ChunkingStrategy, ChunkingMethod>();

// Register default built-in methods
chunkingMethodRegistry.set("recursive", recursiveCharacterChunker);
chunkingMethodRegistry.set("structure_aware", structureAwareChunker);

/**
 * Registers a new or custom chunking method into the global registry.
 */
export function registerChunkingMethod(method: ChunkingMethod): void {
  chunkingMethodRegistry.set(method.name, method);
}

/**
 * Resolves any strategy alias, casing, or hyphenation into a canonical ChunkingStrategy.
 * Defaults to 'recursive' if strategy is undefined.
 */
export function resolveChunkingStrategy(rawStrategy?: string): ChunkingStrategy {
  if (!rawStrategy || typeof rawStrategy !== "string") {
    return "recursive";
  }

  const normalized = rawStrategy.trim().toLowerCase();
  const matched = CHUNKING_STRATEGY_ALIASES[normalized];

  if (matched) {
    return matched;
  }

  // Check if directly in registry
  if (chunkingMethodRegistry.has(normalized as ChunkingStrategy)) {
    return normalized as ChunkingStrategy;
  }

  const available = Array.from(chunkingMethodRegistry.keys()).join(", ");
  throw new Error(
    `Unsupported chunking strategy: '${rawStrategy}'. Available options: [${available}].`
  );
}

/**
 * Retrieves the chunking method instance corresponding to the strategy name.
 */
export function getChunkingMethod(strategy?: string): ChunkingMethod {
  const canonical = resolveChunkingStrategy(strategy);
  const method = chunkingMethodRegistry.get(canonical);

  if (!method) {
    throw new Error(`Chunking method for strategy '${canonical}' is not registered.`);
  }

  return method;
}

/**
 * Lists all registered chunking methods with metadata (for UI / API introspection).
 */
export function listChunkingMethods(): Array<{
  name: ChunkingStrategy;
  displayName: string;
  description: string;
}> {
  return Array.from(chunkingMethodRegistry.values()).map((m) => ({
    name: m.name,
    displayName: m.displayName,
    description: m.description,
  }));
}

/**
 * High-level abstracted runner function.
 * Selects the requested chunking method based on user options and executes it on documents.
 *
 * @param documents - Array of loaded LangChain documents (plain text, PDF pages, etc.)
 * @param options - Chunking options including strategy ('recursive' | 'structure_aware'), chunkSize, chunkOverlap.
 * @returns Array of chunked documents ready for enrichment and vector indexing.
 */
export async function runChunkingMethod(
  documents: Document[],
  options?: ChunkingOptions
): Promise<Document[]> {
  if (!documents || documents.length === 0) {
    return [];
  }

  const strategy = resolveChunkingStrategy(options?.strategy);
  const method = getChunkingMethod(strategy);

  console.log(
    `[Chunking] Executing '${method.displayName}' on ${documents.length} document(s) (chunkSize=${options?.chunkSize ?? 800}, chunkOverlap=${options?.chunkOverlap ?? 100})...`
  );

  const chunks = await method.chunk(documents, options);

  console.log(
    `[Chunking] '${method.displayName}' generated ${chunks.length} total chunks.`
  );

  return chunks;
}


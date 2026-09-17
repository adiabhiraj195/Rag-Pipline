import { Document } from "@langchain/classic/document";

export interface EnrichChunksParams {
  chunks: Document[];
  tenantId: string;
  documentId: string;
  version: number;
  customMetadata?: Record<string, any>;
}

export function enrichChunks({
  chunks,
  tenantId,
  documentId,
  version,
  customMetadata = {},
}: EnrichChunksParams): Document[] {
  const totalChunks = chunks.length;
  const timestamp = new Date().toISOString();

  return chunks.map((chunk, index) => {
    const chunkId = generateChunkId({ documentId, version, index });

    return new Document({
      pageContent: chunk.pageContent,
      metadata: {
        ...chunk.metadata,
        ...customMetadata,
        tenantId,
        documentId,
        version,
        chunkIndex: index,
        totalChunks,
        chunkId,
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
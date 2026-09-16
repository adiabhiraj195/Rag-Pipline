import fs from "fs";
import path from "path";
import { Document } from "@langchain/classic/document";
import { TextLoader } from "@langchain/classic/document_loaders/fs/text";
import { RecursiveCharacterTextSplitter } from "@langchain/classic/text_splitter";

export async function loadTextDocument(filePath: string): Promise<Document[]> {
  const resolvedPath = path.resolve(filePath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`File not found at path: ${resolvedPath}`);
  }

  const stats = fs.statSync(resolvedPath);
  if (!stats.isFile()) {
    throw new Error(`Path is not a regular file: ${resolvedPath}`);
  }

  const loader = new TextLoader(resolvedPath);
  const docs = await loader.load();

  if (!docs || docs.length === 0) {
    throw new Error(`Failed to load any text content from: ${resolvedPath}`);
  }

  return docs;
}

/**
 * Creates LangChain Document instances directly from text content (e.g. downloaded from S3)
 * without needing to write temporary files to the filesystem.
 */
export function loadTextContent(
  text: string,
  metadata?: Record<string, any>
): Document[] {
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new Error("Text content is empty or invalid.");
  }

  return [
    new Document({
      pageContent: text,
      metadata: metadata || {},
    }),
  ];
}

export interface SplitOptions {
  chunkSize?: number;
  chunkOverlap?: number;
}

export async function splitLoadedTextDocument(
  loadedDocument: Document[],
  options?: SplitOptions
): Promise<Document[]> {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: options?.chunkSize ?? 800,
    chunkOverlap: options?.chunkOverlap ?? 100,
  });

  const splitChunks = await splitter.splitDocuments(loadedDocument);
  return splitChunks;
}

import fs from "fs";
import path from "path";
import { Document } from "@langchain/classic/document";
import { TextLoader } from "@langchain/classic/document_loaders/fs/text";
import { PDFParse } from "pdf-parse";
import {
  runChunkingMethod,
  ChunkingOptions,
  ChunkingStrategy,
} from "../chunking";

export * from "../chunking";

/**
 * Checks whether a file or MIME type represents a PDF document.
 */
export function isPdfDocument(filename?: string, mimeType?: string): boolean {
  if (mimeType && mimeType.toLowerCase().includes("application/pdf")) {
    return true;
  }
  if (filename && filename.toLowerCase().endsWith(".pdf")) {
    return true;
  }
  return false;
}

/**
 * Loads a text document from the local filesystem.
 */
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

export interface PdfLoadResult {
  documents: Document[];
  fullText: string;
  pageCount: number;
  info?: Record<string, any>;
}

/**
 * Parses a PDF from a raw Buffer (e.g. downloaded from S3 or read from disk).
 * Generates per-page Document objects with pageNumber metadata and extracts full text.
 */
export async function loadPdfFromBuffer(
  buffer: Buffer,
  metadata?: Record<string, any>
): Promise<PdfLoadResult> {
  if (!buffer || buffer.length === 0) {
    throw new Error("PDF buffer is empty or invalid.");
  }

  let parser: PDFParse | null = null;
  try {
    parser = new PDFParse({ data: buffer });
    const textRes = await parser.getText();
    const infoRes = await parser.getInfo().catch(() => null);

    const totalPages = textRes.total || (textRes.pages ? textRes.pages.length : 1);
    const documents: Document[] = [];
    const source = metadata?.filename || metadata?.s3Key || metadata?.source || "document.pdf";

    if (textRes.pages && textRes.pages.length > 0) {
      for (const page of textRes.pages) {
        const pageText = page.text?.trim() || "";
        if (pageText.length > 0) {
          documents.push(
            new Document({
              pageContent: pageText,
              metadata: {
                ...metadata,
                source,
                page: page.num,
                pageNumber: page.num,
                totalPages,
                fileType: "pdf",
                mimeType: metadata?.mimeType || "application/pdf",
              },
            })
          );
        }
      }
    }

    // Fallback: if no individual pages were created but full text exists
    if (documents.length === 0 && textRes.text && textRes.text.trim().length > 0) {
      documents.push(
        new Document({
          pageContent: textRes.text.trim(),
          metadata: {
            ...metadata,
            source,
            page: 1,
            pageNumber: 1,
            totalPages: 1,
            fileType: "pdf",
            mimeType: metadata?.mimeType || "application/pdf",
          },
        })
      );
    }

    if (documents.length === 0) {
      throw new Error(`Failed to extract any text content from PDF: ${source}`);
    }

    return {
      documents,
      fullText: textRes.text || documents.map((d) => d.pageContent).join("\n\n"),
      pageCount: totalPages,
      info: infoRes ? { ...infoRes } : undefined,
    };
  } finally {
    if (parser) {
      await parser.destroy().catch(() => {});
    }
  }
}

/**
 * Loads and parses a PDF document from a file path on disk.
 */
export async function loadPdfDocument(
  filePath: string,
  metadata?: Record<string, any>
): Promise<PdfLoadResult> {
  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`PDF file not found at path: ${resolvedPath}`);
  }

  const buffer = fs.readFileSync(resolvedPath);
  return loadPdfFromBuffer(buffer, {
    ...metadata,
    filename: path.basename(resolvedPath),
    source: resolvedPath,
  });
}

/**
 * Unified loader that parses either PDF or text documents based on MIME type or filename.
 */
export async function loadDocumentContent({
  buffer,
  text,
  filename,
  mimeType,
  metadata = {},
}: {
  buffer?: Buffer;
  text?: string;
  filename?: string;
  mimeType?: string;
  metadata?: Record<string, any>;
}): Promise<{ documents: Document[]; fullText: string; isPdf: boolean; pageCount: number }> {
  const isPdf = isPdfDocument(filename, mimeType);

  if (isPdf) {
    if (!buffer) {
      throw new Error("Binary buffer is required to parse a PDF document.");
    }
    const result = await loadPdfFromBuffer(buffer, {
      ...metadata,
      filename,
      mimeType: mimeType || "application/pdf",
    });
    return {
      documents: result.documents,
      fullText: result.fullText,
      isPdf: true,
      pageCount: result.pageCount,
    };
  }

  // Plain text document
  let content = text;
  if (!content && buffer) {
    content = buffer.toString("utf-8");
  }

  if (!content) {
    throw new Error("No text or buffer content provided for text document loading.");
  }

  const docs = loadTextContent(content, {
    ...metadata,
    filename,
    mimeType: mimeType || "text/plain",
  });

  return {
    documents: docs,
    fullText: content,
    isPdf: false,
    pageCount: 1,
  };
}

export interface SplitOptions extends ChunkingOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  chunkingStrategy?: ChunkingStrategy;
}

/**
 * Splits loaded documents into chunks using the specified or default chunking method.
 * Delegates to the abstracted `runChunkingMethod`.
 */
export async function splitLoadedTextDocument(
  loadedDocument: Document[],
  options?: SplitOptions
): Promise<Document[]> {
  return runChunkingMethod(loadedDocument, {
    ...options,
    strategy: options?.strategy || options?.chunkingStrategy || "recursive",
  });
}

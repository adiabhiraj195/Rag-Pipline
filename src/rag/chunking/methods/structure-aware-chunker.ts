import { Document } from "@langchain/classic/document";
import type { ChunkingMethod, ChunkingOptions, ChunkingStrategy } from "../types";

interface StructuralBlock {
  type: "heading" | "paragraph" | "list" | "table" | "code" | "separator";
  level?: number;
  text: string;
  headingText?: string;
  pageNumber?: number;
}

interface SectionData {
  heading: string;
  level: number;
  hierarchy: string[];
  blocks: StructuralBlock[];
  pageNumbers: Set<number>;
  sourceMetadata: Record<string, any>;
}

/**
 * Regex patterns to detect headings and structural breaks.
 */
const MARKDOWN_HEADING_REGEX = /^(#{1,6})\s+(.+)$/;
const NUMBERED_HEADING_REGEX =
  /^((?:§|\b(?:Section|Chapter|Part|Article|Appendix)\s+)?\d+(?:\.\d+)*\.?)\s+([A-Z0-9][^\n]+)$/i;
const ALL_CAPS_HEADING_REGEX =
  /^([A-Z0-9\s,\-:;()]{3,80})$/;
const LIST_ITEM_REGEX = /^(\s*[-*•]|\s*\d+[.)]|\s*\[[ xX]\])\s+/;
const TABLE_ROW_REGEX = /^\|.+\|$/;
const CODE_FENCE_REGEX = /^```/;
const HORIZONTAL_RULE_REGEX = /^(?:---|\*\*\*|___)\s*$/;

const KNOWN_DOCUMENT_SECTIONS = new Set([
  "ABSTRACT",
  "INTRODUCTION",
  "BACKGROUND",
  "MOTIVATION",
  "RELATED WORK",
  "METHODOLOGY",
  "SYSTEM ARCHITECTURE",
  "ARCHITECTURE",
  "IMPLEMENTATION",
  "EVALUATION",
  "RESULTS",
  "DISCUSSION",
  "LIMITATIONS",
  "FUTURE WORK",
  "CONCLUSION",
  "CONCLUSIONS",
  "SUMMARY",
  "EXECUTIVE SUMMARY",
  "TABLE OF CONTENTS",
  "OVERVIEW",
  "REQUIREMENTS",
  "SPECIFICATIONS",
  "SECURITY",
  "PERFORMANCE",
  "DEPLOYMENT",
  "REFERENCES",
  "APPENDIX",
  "GLOSSARY",
]);

/**
 * Structure-Aware Chunking Method.
 *
 * Rather than blindly slicing text by character offsets, this chunker parses
 * document semantics:
 * 1. Heading hierarchy (Markdown, numbering, formal titles, section headers).
 * 2. Natural structural boundaries (paragraphs, lists, tables, code blocks).
 * 3. PDF page numbers and structural context.
 * 4. Attaches heading path / breadcrumb to chunk metadata and content for superior retrieval accuracy.
 */
export class StructureAwareChunker implements ChunkingMethod {
  readonly name: ChunkingStrategy = "structure_aware";
  readonly displayName = "Structure-Aware Chunker";
  readonly description =
    "Understands document hierarchy (headings, sections, lists, tables, and PDF pages) and preserves structural context for each chunk.";

  async chunk(
    documents: Document[],
    options?: ChunkingOptions
  ): Promise<Document[]> {
    if (!documents || documents.length === 0) {
      return [];
    }

    const targetChunkSize = options?.chunkSize ?? 800;
    const maxChunkSize = options?.maxChunkSize ?? Math.max(targetChunkSize * 1.4, 1100);
    const minChunkSize = options?.minChunkSize ?? 100;
    const chunkOverlap = options?.chunkOverlap ?? 100;
    const prependHeadingContext = options?.prependHeadingContext ?? true;

    const allChunks: Document[] = [];

    for (const doc of documents) {
      const pageNum =
        doc.metadata?.pageNumber ||
        doc.metadata?.page ||
        (typeof doc.metadata?.pageIndex === "number"
          ? doc.metadata.pageIndex + 1
          : undefined);

      const sections = this.parseDocumentIntoSections(
        doc.pageContent,
        pageNum,
        doc.metadata || {}
      );

      for (const section of sections) {
        const sectionChunks = this.chunkSection(section, {
          targetChunkSize,
          maxChunkSize,
          minChunkSize,
          chunkOverlap,
          prependHeadingContext,
          baseMetadata: doc.metadata || {},
        });

        allChunks.push(...sectionChunks);
      }
    }

    // Re-index total chunks
    return allChunks.map((chunk, index) => {
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

  /**
   * Parses raw document text into structural sections with headings and hierarchy.
   */
  private parseDocumentIntoSections(
    content: string,
    pageNumber: number | undefined,
    sourceMetadata: Record<string, any>
  ): SectionData[] {
    const rawLines = content.split(/\r?\n/);
    const sections: SectionData[] = [];

    let currentHierarchy: { title: string; level: number }[] = [];
    let currentBlocks: StructuralBlock[] = [];
    let currentHeading = "General";
    let currentLevel = 0;
    let pageNumbers = new Set<number>();
    if (pageNumber !== undefined) {
      pageNumbers.add(pageNumber);
    }

    let inCodeBlock = false;
    let codeBuffer: string[] = [];

    const flushCurrentSection = () => {
      if (currentBlocks.length > 0) {
        sections.push({
          heading: currentHeading,
          level: currentLevel,
          hierarchy: currentHierarchy.map((h) => h.title),
          blocks: [...currentBlocks],
          pageNumbers: new Set(pageNumbers),
          sourceMetadata,
        });
        currentBlocks = [];
      }
    };

    let paragraphBuffer: string[] = [];

    const flushParagraph = () => {
      if (paragraphBuffer.length > 0) {
        const text = paragraphBuffer.join(" ").trim();
        if (text.length > 0) {
          currentBlocks.push({
            type: "paragraph",
            text,
            pageNumber,
          });
        }
        paragraphBuffer = [];
      }
    };

    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      const trimmed = line.trim();

      // Check code fence
      if (CODE_FENCE_REGEX.test(trimmed)) {
        flushParagraph();
        if (inCodeBlock) {
          codeBuffer.push(line);
          currentBlocks.push({
            type: "code",
            text: codeBuffer.join("\n"),
            pageNumber,
          });
          codeBuffer = [];
          inCodeBlock = false;
        } else {
          inCodeBlock = true;
          codeBuffer.push(line);
        }
        continue;
      }

      if (inCodeBlock) {
        codeBuffer.push(line);
        continue;
      }

      // Check empty line -> paragraph boundary
      if (trimmed.length === 0) {
        flushParagraph();
        continue;
      }

      // Check horizontal rule / separator
      if (HORIZONTAL_RULE_REGEX.test(trimmed)) {
        flushParagraph();
        continue;
      }

      // Check Heading Detection
      const headingMatch = this.detectHeading(trimmed);
      if (headingMatch) {
        flushParagraph();
        flushCurrentSection();

        const { title, level } = headingMatch;
        currentHeading = title;
        currentLevel = level;

        // Update hierarchy stack
        currentHierarchy = currentHierarchy.filter((h) => h.level < level);
        currentHierarchy.push({ title, level });

        currentBlocks.push({
          type: "heading",
          level,
          text: title,
          headingText: title,
          pageNumber,
        });
        continue;
      }

      // Check Table row
      if (TABLE_ROW_REGEX.test(trimmed)) {
        flushParagraph();
        currentBlocks.push({
          type: "table",
          text: trimmed,
          pageNumber,
        });
        continue;
      }

      // Check List item
      if (LIST_ITEM_REGEX.test(trimmed)) {
        flushParagraph();
        currentBlocks.push({
          type: "list",
          text: trimmed,
          pageNumber,
        });
        continue;
      }

      // Standard prose line -> buffer into current paragraph
      paragraphBuffer.push(trimmed);
    }

    flushParagraph();
    if (inCodeBlock && codeBuffer.length > 0) {
      currentBlocks.push({
        type: "code",
        text: codeBuffer.join("\n"),
        pageNumber,
      });
    }
    flushCurrentSection();

    // If no headings found at all, create a single default section
    if (sections.length === 0 && content.trim().length > 0) {
      sections.push({
        heading: "Document Content",
        level: 1,
        hierarchy: ["Document Content"],
        blocks: [{ type: "paragraph", text: content.trim(), pageNumber }],
        pageNumbers: new Set(pageNumber !== undefined ? [pageNumber] : []),
        sourceMetadata,
      });
    }

    return sections;
  }

  /**
   * Determines if a line is a structural heading (Markdown, numbered, or section header).
   */
  private detectHeading(
    line: string
  ): { title: string; level: number } | null {
    // 1. Markdown heading (# Heading)
    const mdMatch = line.match(MARKDOWN_HEADING_REGEX);
    if (mdMatch) {
      return {
        level: mdMatch[1].length,
        title: mdMatch[2].trim(),
      };
    }

    // 2. Numbered heading (e.g., "1. Introduction", "2.3 Architecture")
    const numMatch = line.match(NUMBERED_HEADING_REGEX);
    if (numMatch && line.length < 100) {
      const dots = (numMatch[1].match(/\./g) || []).length;
      const level = Math.min(6, Math.max(1, dots + 1));
      return {
        level,
        title: line.trim(),
      };
    }

    // 3. Known uppercase document sections (e.g. "ABSTRACT", "CONCLUSION")
    const upper = line.toUpperCase().trim();
    if (KNOWN_DOCUMENT_SECTIONS.has(upper)) {
      return {
        level: 1,
        title: line.trim(),
      };
    }

    // 4. Short all-caps line (e.g. "EXECUTIVE SUMMARY", "API SPECIFICATION")
    const capsMatch = line.match(ALL_CAPS_HEADING_REGEX);
    if (
      capsMatch &&
      line === upper &&
      line.length >= 4 &&
      line.length <= 50 &&
      !line.includes(".") &&
      !line.includes(",")
    ) {
      return {
        level: 2,
        title: line.trim(),
      };
    }

    return null;
  }

  /**
   * Chunks a single section into coherent chunks respecting boundaries.
   */
  private chunkSection(
    section: SectionData,
    cfg: {
      targetChunkSize: number;
      maxChunkSize: number;
      minChunkSize: number;
      chunkOverlap: number;
      prependHeadingContext: boolean;
      baseMetadata: Record<string, any>;
    }
  ): Document[] {
    const headingPath = section.hierarchy.join(" > ");
    const sectionBreadcrumb =
      section.heading !== "General" && section.heading !== "Document Content"
        ? headingPath || section.heading
        : undefined;

    const prefix =
      cfg.prependHeadingContext && sectionBreadcrumb
        ? `[Section: ${sectionBreadcrumb}]\n`
        : "";

    const chunks: Document[] = [];
    let currentBuffer: string[] = [];
    let currentLength = prefix.length;
    let blockPages = new Set<number>();

    const flushChunk = () => {
      if (currentBuffer.length === 0) return;

      const bodyText = currentBuffer.join("\n\n").trim();
      if (bodyText.length === 0) {
        currentBuffer = [];
        currentLength = prefix.length;
        blockPages = new Set();
        return;
      }

      const fullChunkText = prefix ? `${prefix}${bodyText}` : bodyText;
      const pagesArray = Array.from(blockPages).sort((a, b) => a - b);
      const primaryPage = pagesArray.length > 0 ? pagesArray[0] : undefined;

      chunks.push(
        new Document({
          pageContent: fullChunkText,
          metadata: {
            ...cfg.baseMetadata,
            section: section.heading,
            sectionLevel: section.level,
            headingHierarchy: section.hierarchy,
            headingPath: sectionBreadcrumb || section.heading,
            pageNumber: primaryPage,
            page: primaryPage,
            pages: pagesArray.length > 0 ? pagesArray : undefined,
            structuralType: "section",
          },
        })
      );

      // Handle overlap by preserving the tail
      if (cfg.chunkOverlap > 0 && bodyText.length > cfg.chunkOverlap) {
        const sentences = bodyText.split(/(?<=[.?!])\s+/);
        let overlapText = "";
        for (let i = sentences.length - 1; i >= 0; i--) {
          const candidate = sentences.slice(i).join(" ");
          if (candidate.length <= cfg.chunkOverlap) {
            overlapText = candidate;
          } else {
            break;
          }
        }
        if (overlapText) {
          currentBuffer = [overlapText];
          currentLength = prefix.length + overlapText.length;
        } else {
          currentBuffer = [];
          currentLength = prefix.length;
        }
      } else {
        currentBuffer = [];
        currentLength = prefix.length;
      }

      blockPages = new Set();
    };

    for (const block of section.blocks) {
      if (block.type === "heading" && block.text === section.heading) {
        // Heading is represented in breadcrumb prefix
        continue;
      }

      if (block.pageNumber !== undefined) {
        blockPages.add(block.pageNumber);
      }

      const blockText = block.text.trim();
      if (!blockText) continue;

      // If single block is huge, split it internally
      if (blockText.length > cfg.maxChunkSize) {
        flushChunk();
        const subChunks = this.splitLargeBlock(blockText, cfg.targetChunkSize, cfg.chunkOverlap);
        for (const sub of subChunks) {
          const fullSubText = prefix ? `${prefix}${sub}` : sub;
          const pagesArray = Array.from(blockPages).sort((a, b) => a - b);
          const primaryPage = pagesArray.length > 0 ? pagesArray[0] : undefined;
          chunks.push(
            new Document({
              pageContent: fullSubText,
              metadata: {
                ...cfg.baseMetadata,
                section: section.heading,
                sectionLevel: section.level,
                headingHierarchy: section.hierarchy,
                headingPath: sectionBreadcrumb || section.heading,
                pageNumber: primaryPage,
                page: primaryPage,
                pages: pagesArray.length > 0 ? pagesArray : undefined,
                structuralType: block.type,
              },
            })
          );
        }
        blockPages = new Set();
        continue;
      }

      // Check if adding block exceeds targetChunkSize
      if (currentBuffer.length > 0 && currentLength + blockText.length + 2 > cfg.targetChunkSize) {
        flushChunk();
      }

      currentBuffer.push(blockText);
      currentLength += blockText.length + 2;
    }

    flushChunk();
    return chunks;
  }

  /**
   * Splits an oversized block (e.g. very long paragraph or table) on sentences or clauses.
   */
  private splitLargeBlock(
    text: string,
    targetSize: number,
    overlap: number
  ): string[] {
    const sentences = text.split(/(?<=[.?!])\s+|\n+/).filter((s) => s.trim().length > 0);
    const result: string[] = [];
    let buffer: string[] = [];
    let currentLen = 0;

    for (const sentence of sentences) {
      if (currentLen + sentence.length > targetSize && buffer.length > 0) {
        result.push(buffer.join(" "));
        // keep last sentence for overlap
        if (overlap > 0 && buffer.length > 1) {
          const last = buffer[buffer.length - 1];
          buffer = [last, sentence];
          currentLen = last.length + sentence.length + 1;
        } else {
          buffer = [sentence];
          currentLen = sentence.length;
        }
      } else {
        buffer.push(sentence);
        currentLen += sentence.length + 1;
      }
    }

    if (buffer.length > 0) {
      result.push(buffer.join(" "));
    }

    return result.length > 0 ? result : [text];
  }
}

export const structureAwareChunker = new StructureAwareChunker();


import type { Request, Response } from "express";
import { runRetrievalPipeline } from "../retrive/retrieval-pipeline";

/**
 * Controller to handle chat queries using hybrid retrieval (Dense Semantic + Lexical + RRF + ReRanker + LLM).
 * POST /rag/chat or POST /chat
 * Body: {
 *   query: string,
 *   topK?: number,
 *   rrfK?: number,
 *   tenantId?: string,
 *   history?: Array<{ role: "user" | "assistant", content: string }>
 * }
 */
export async function handleChatQuery(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { query, topK, rrfK, tenantId, history } = req.body;

    if (!query || typeof query !== "string" || query.trim() === "") {
      res.status(400).json({
        success: false,
        error: "'query' is required and must be a non-empty string.",
      });
      return;
    }

    if (topK !== undefined) {
      const parsedTopK = Number(topK);
      if (isNaN(parsedTopK) || parsedTopK <= 0) {
        res.status(400).json({
          success: false,
          error: "'topK' must be a positive number if provided.",
        });
        return;
      }
    }

    if (rrfK !== undefined) {
      const parsedRrfK = Number(rrfK);
      if (isNaN(parsedRrfK) || parsedRrfK <= 0) {
        res.status(400).json({
          success: false,
          error: "'rrfK' must be a positive number if provided.",
        });
        return;
      }
    }

    const result = await runRetrievalPipeline(query, {
      topK: topK ? Number(topK) : undefined,
      rrfK: rrfK ? Number(rrfK) : undefined,
      tenantId: tenantId ? String(tenantId) : undefined,
      history: Array.isArray(history) ? history : undefined,
    });

    res.status(200).json({
      success: true,
      message: "Chat query processed successfully.",
      data: result,
    });
  } catch (error: any) {
    console.error("[Chat Controller Error]", error);
    res.status(500).json({
      success: false,
      error: error?.message || "Internal server error while processing chat query.",
    });
  }
}


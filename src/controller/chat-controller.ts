import type { Request, Response } from "express";
import { runRetrievalPipeline } from "../rag/retrive/retrieval-pipeline";
import { rewriteQuery } from "../services/query-rewriting";
import { groqModel } from "../llm/model";

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

    const normalizedHistory = Array.isArray(history) ? history : [];

    // Step 1: Pre-process query through rewriteQuery to get optimal query or clarification
    console.log(
      `[Chat Controller] Evaluating query: "${query}" with ${normalizedHistory.length} history items.`
    );
    const rewriteResult = await rewriteQuery(query, normalizedHistory);
    console.log(
      `[Chat Controller] Query rewrite status: "${rewriteResult.status}", query: "${rewriteResult.query}"`
    );

    // If clarification is requested, immediately return response without RAG lookup
    if (rewriteResult.status === "clarify") {
      const clarificationPrompt =
        rewriteResult.response ||
        "Your query is not clear enough. Could you please clarify what you mean?";

      res.status(200).json({
        success: true,
        status: "clarify",
        message: clarificationPrompt,
        data: {
          status: "clarify",
          clarification: clarificationPrompt,
          originalQuery: query,
        },
      });
      return;
    }

    // Step 2: Use optimal rewritten or clear query for retrieval
    const optimalQuery =
      rewriteResult.status === "rewritten" && rewriteResult.query
        ? rewriteResult.query
        : (rewriteResult.query || query);

    console.log(
      `[Chat Controller] Passing optimal query to retrieval pipeline: "${optimalQuery}"`
    );

    const retrievalResult = await runRetrievalPipeline(optimalQuery, {
      topK: topK ? Number(topK) : undefined,
      rrfK: rrfK ? Number(rrfK) : undefined,
      tenantId: tenantId ? String(tenantId) : undefined,
      history: normalizedHistory,
    });

    // Step 3: Invoke LLM with retrieved grounded context and conversation history
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: retrievalResult.systemPrompt },
    ];

    for (const msg of normalizedHistory) {
      if (msg.role === "user" || msg.role === "assistant") {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    messages.push({ role: "user", content: retrievalResult.userPrompt });

    console.log(`[Chat Controller] Invoking LLM for final generation...`);
    const llmResponse = await groqModel.invoke(messages);
    const answer =
      typeof llmResponse.content === "string"
        ? llmResponse.content
        : JSON.stringify(llmResponse.content);

    res.status(200).json({
      success: true,
      message: "Chat query processed successfully.",
      data: {
        ...retrievalResult,
        answer,
        originalQuery: query,
        rewrittenQuery: optimalQuery,
        queryRewriteStatus: rewriteResult.status,
      },
    });
  } catch (error: any) {
    console.error("[Chat Controller Error]", error);
    res.status(500).json({
      success: false,
      error: error?.message || "Internal server error while processing chat query.",
    });
  }
}


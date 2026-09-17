import type { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { runRetrievalPipeline, ChatMessage } from "../rag/retrive/retrieval-pipeline";
import { rewriteQuery } from "../services/query-rewriting";

function isValidUuid(str: any): boolean {
  if (typeof str !== "string") return false;
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

function getParamId(param: unknown): string {
  if (Array.isArray(param)) return String(param[0]);
  return typeof param === "string" ? param : "";
}

/**
 * Start a new conversation for the authenticated user.
 * POST /conversations
 * Body: { title?: string }
 */
export async function createConversation(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }

    const { title } = req.body;
    const conversationTitle =
      title && typeof title === "string" && title.trim() !== ""
        ? title.trim()
        : "New Conversation";

    const conversation = await prisma.conversation.create({
      data: {
        userId,
        title: conversationTitle,
      },
    });

    res.status(201).json({
      success: true,
      message: "Conversation created successfully.",
      data: { conversation },
    });
  } catch (error: any) {
    console.error("[Conversation Controller Error - Create]", error);
    res.status(500).json({
      success: false,
      error: error?.message || "Internal server error creating conversation.",
    });
  }
}

/**
 * List all conversations for the authenticated user.
 * GET /conversations
 */
export async function listConversations(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }

    const conversations = await prisma.conversation.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      include: {
        _count: {
          select: { messages: true },
        },
      },
    });

    res.status(200).json({
      success: true,
      data: { conversations },
    });
  } catch (error: any) {
    console.error("[Conversation Controller Error - List]", error);
    res.status(500).json({
      success: false,
      error: error?.message || "Internal server error listing conversations.",
    });
  }
}

/**
 * Get details and messages of a specific conversation.
 * GET /conversations/:id
 */
export async function getConversationById(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const userId = req.user?.userId;
    const conversationId = getParamId(req.params.id);

    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }

    if (!isValidUuid(conversationId)) {
      res.status(400).json({
        success: false,
        error: "Invalid conversation ID format. Must be a valid UUID.",
      });
      return;
    }

    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        userId,
      },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!conversation) {
      res.status(404).json({
        success: false,
        error: "Conversation not found.",
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: { conversation },
    });
  } catch (error: any) {
    console.error("[Conversation Controller Error - Get]", error);
    res.status(500).json({
      success: false,
      error: error?.message || "Internal server error fetching conversation.",
    });
  }
}

/**
 * Send a message to a conversation and receive an LLM response grounded in the knowledge base.
 * POST /conversations/:id/messages
 * Body: { message?: string, query?: string, content?: string, topK?: number, rrfK?: number }
 */
export async function sendMessageToConversation(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const userId = req.user?.userId;
    const conversationId = getParamId(req.params.id);

    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }

    if (!isValidUuid(conversationId)) {
      res.status(400).json({
        success: false,
        error: "Invalid conversation ID format. Must be a valid UUID.",
      });
      return;
    }

    const rawMessage = req.body.message || req.body.content || req.body.query;
    if (!rawMessage || typeof rawMessage !== "string" || rawMessage.trim() === "") {
      res.status(400).json({
        success: false,
        error: "'message' or 'content' is required and must be a non-empty string.",
      });
      return;
    }

    const messageText = rawMessage.trim();
    const { topK, rrfK } = req.body;

    // Check conversation ownership
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        userId,
      },
    });

    if (!conversation) {
      res.status(404).json({
        success: false,
        error: "Conversation not found.",
      });
      return;
    }

    // 1. Persist the user's message to the database
    const userMessage = await prisma.message.create({
      data: {
        conversationId,
        role: "user",
        content: messageText,
      },
    });

    // 2. Fetch past conversation messages for conversational memory context
    const previousMessages = await prisma.message.findMany({
      where: {
        conversationId,
        id: { not: userMessage.id },
      },
      orderBy: { createdAt: "asc" },
      take: 20,
    });

    const history: ChatMessage[] = previousMessages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    console.log(
      `[Conversation Controller] User ${userId} sent message in conversation ${conversationId}. History length: ${history.length}`
    );

    // 3. Pre-process query with query-rewriting service
    const rewriteResult = await rewriteQuery(messageText, history);
    console.log(
      `[Conversation Controller] Query rewrite status: "${rewriteResult.status}", query: "${rewriteResult.query}"`
    );

    // If clarification is needed, save clarification assistant message and return
    if (rewriteResult.status === "clarify") {
      const clarificationText =
        rewriteResult.response ||
        "Could you please clarify what specific information you are looking for?";

      const assistantMessage = await prisma.message.create({
        data: {
          conversationId,
          role: "assistant",
          content: clarificationText,
          metadata: {
            status: "clarify",
            originalQuery: messageText,
          } as any,
        },
      });

      await prisma.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });

      res.status(200).json({
        success: true,
        status: "clarify",
        data: {
          conversationId,
          userMessage,
          assistantMessage,
          answer: clarificationText,
          status: "clarify",
        },
      });
      return;
    }

    // 4. Determine optimal query to execute RAG
    const optimalQuery =
      rewriteResult.status === "rewritten" && rewriteResult.query
        ? rewriteResult.query
        : (rewriteResult.query || messageText);

    // 5. Run hybrid RAG pipeline scoped to the authenticated user
    const pipelineResult = await runRetrievalPipeline(optimalQuery, {
      topK: topK ? Number(topK) : undefined,
      rrfK: rrfK ? Number(rrfK) : undefined,
      userId,
      history,
    });

    // 6. Persist assistant message with citations and retrieval metadata
    const assistantMessage = await prisma.message.create({
      data: {
        conversationId,
        role: "assistant",
        content: pipelineResult.answer,
        metadata: {
          sources: pipelineResult.sources,
          pipelineStats: pipelineResult.pipelineStats,
          originalQuery: messageText,
          rewrittenQuery: optimalQuery,
          queryRewriteStatus: rewriteResult.status,
        } as any,
      },
    });

    // 7. Auto-update conversation title if it is still "New Conversation"
    const updateData: { updatedAt: Date; title?: string } = {
      updatedAt: new Date(),
    };

    if (conversation.title === "New Conversation") {
      updateData.title =
        messageText.length > 40
          ? `${messageText.slice(0, 37)}...`
          : messageText;
    }

    await prisma.conversation.update({
      where: { id: conversationId },
      data: updateData,
    });

    res.status(200).json({
      success: true,
      data: {
        conversationId,
        userMessage,
        assistantMessage,
        answer: pipelineResult.answer,
        sources: pipelineResult.sources,
        pipelineStats: pipelineResult.pipelineStats,
        rewrittenQuery: optimalQuery,
      },
    });
  } catch (error: any) {
    console.error("[Conversation Controller Error - SendMessage]", error);
    res.status(500).json({
      success: false,
      error: error?.message || "Internal server error sending message.",
    });
  }
}

/**
 * Delete a conversation and all associated messages.
 * DELETE /conversations/:id
 */
export async function deleteConversation(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const userId = req.user?.userId;
    const conversationId = getParamId(req.params.id);

    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }

    if (!isValidUuid(conversationId)) {
      res.status(400).json({
        success: false,
        error: "Invalid conversation ID format.",
      });
      return;
    }

    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        userId,
      },
    });

    if (!conversation) {
      res.status(404).json({
        success: false,
        error: "Conversation not found.",
      });
      return;
    }

    await prisma.conversation.delete({
      where: { id: conversationId },
    });

    res.status(200).json({
      success: true,
      message: "Conversation deleted successfully.",
    });
  } catch (error: any) {
    console.error("[Conversation Controller Error - Delete]", error);
    res.status(500).json({
      success: false,
      error: error?.message || "Internal server error deleting conversation.",
    });
  }
}


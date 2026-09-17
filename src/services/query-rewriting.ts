import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { HumanMessage, AIMessage, BaseMessage } from "@langchain/core/messages";
import { z } from "zod";
import { queryRewriterModel } from "../llm/model";

// ---------------------------------------------
// Output schema
// ---------------------------------------------

export const QueryRewriteSchema = z.object({
  status: z
    .enum(["rewritten", "clear", "clarify"])
    .describe(
      "Status of the query rewrite: 'clear' if already standalone and complete; 'rewritten' if contextual references/pronouns were resolved; 'clarify' if ambiguous, vague, or lacking sufficient information"
    ),
  query: z
    .string()
    .nullable()
    .describe(
      "The standalone, self-contained search query for vector/lexical retrieval. Null if status is clarify"
    ),
  response: z
    .string()
    .nullable()
    .describe(
      "Helpful clarification question for the user if status is clarify. Null otherwise"
    ),
});

export type QueryRewriteResult = z.infer<typeof QueryRewriteSchema>;

export interface ChatHistoryMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

// ---------------------------------------------
// LLM with Structured Output
// ---------------------------------------------

const structuredLLM = queryRewriterModel.withStructuredOutput(QueryRewriteSchema);

// ---------------------------------------------
// Prompt Definition
// (Notice: avoid unescaped single braces in prompt body to prevent template interpolation bugs)
// ---------------------------------------------

const SYSTEM_PROMPT = `You are an expert query rewriting component for a production Retrieval-Augmented Generation (RAG) system.

Your job is to transform the user's latest query into an optimal, standalone, context-complete search query suitable for semantic vector and BM25 lexical retrieval.
You have access to the recent conversation history between the user and assistant.

CORE RULES:
1. "clear":
   - If the user's query is already complete, specific, and understandable on its own without needing prior context.
   - Keep the query as is. Do not unnecessarily rewrite or expand it.
   - Set status to "clear", set query to the user's query, and set response to null.

2. "rewritten":
   - If the user's query depends on the previous turns (e.g. uses pronouns like "it", "they", "that", "this", "the first one", or phrases like "what about it", "tell me more about that", "how much does it cost?").
   - Resolve all coreferences and elliptical questions using the conversation history.
   - Formulate a self-contained, keyword-rich query that can be retrieved directly from documentation.
   - Set status to "rewritten", set query to the rewritten query, and set response to null.

3. "clarify":
   - If the query is so ambiguous, underspecified, or disjoint that multiple conflicting interpretations exist and conversation history does not resolve it (e.g., user says just "why?", "tell me more", "how?", or references multiple contradictory entities).
   - Set status to "clarify", set query to null, and set response to a polite question asking for clarification on the previous topic.

4. SAFETY & FIDELITY:
   - NEVER invent facts, policies, or entities not mentioned in the query or conversation history.
   - NEVER answer the user's question. Your ONLY purpose is query rewriting or asking for clarification.

FEW-SHOT EXAMPLES:

Example A (Reference resolution):
History:
User: What is the refund policy?
Assistant: Customers can request a full refund within 30 days of purchase.
Current query: What about subscriptions?
Result -> status: rewritten | query: Does the 30-day refund policy apply to subscriptions? | response: null

Example B (Already clear):
History:
User: How do I create an account?
Assistant: Click the sign-up button on the top right.
Current query: What are the supported payment methods?
Result -> status: clear | query: What are the supported payment methods? | response: null

Example C (Ambiguous / needs clarification):
History:
User: Tell me about pricing plans.
Assistant: We have Starter, Pro, and Enterprise tiers.
User: And what about storage limits?
Assistant: Starter has 10GB, Pro has 100GB, Enterprise is unlimited.
Current query: Can I upgrade it later?
Result -> status: clarify | query: null | response: Could you please clarify whether you want to upgrade your subscription tier or your storage limit?
`;

const prompt = ChatPromptTemplate.fromMessages([
  ["system", SYSTEM_PROMPT],
  new MessagesPlaceholder("history"),
  ["human", "{query}"],
]);

// ---------------------------------------------
// Chain
// ---------------------------------------------

const rewriteChain = prompt.pipe(structuredLLM);

// ---------------------------------------------
// Helper: Map History to LangChain BaseMessage instances
// ---------------------------------------------

function formatHistoryMessages(
  history: ChatHistoryMessage[] = []
): BaseMessage[] {
  if (!Array.isArray(history)) return [];

  const formatted: BaseMessage[] = [];
  for (const msg of history) {
    if (!msg || typeof msg.content !== "string") continue;
    const content = msg.content.trim();
    if (!content) continue;

    if (msg.role === "user") {
      formatted.push(new HumanMessage(content));
    } else if (msg.role === "assistant") {
      formatted.push(new AIMessage(content));
    }
  }

  return formatted;
}

// ---------------------------------------------
// Main Function
// ---------------------------------------------

/**
 * Rewrites or clarifies a user query based on recent conversation history.
 *
 * @param query - The latest query from the user.
 * @param history - Array of previous chat messages.
 * @returns QueryRewriteResult with status ('clear' | 'rewritten' | 'clarify'), query, and optional response.
 */
export async function rewriteQuery(
  query: string,
  history: ChatHistoryMessage[] = []
): Promise<QueryRewriteResult> {
  const cleanedQuery = (query || "").trim();

  // Fast-path for empty or whitespace-only queries
  if (!cleanedQuery) {
    return {
      status: "clarify",
      query: null,
      response: "Please provide a question or message so I can assist you.",
    };
  }

  const safeHistory = Array.isArray(history) ? history : [];
  // Restrict history to the most recent 10 messages to limit token usage and latency
  const recentHistory = safeHistory.slice(-10);
  const formattedHistory = formatHistoryMessages(recentHistory);

  try {
    const result = await rewriteChain.invoke({
      history: formattedHistory,
      query: cleanedQuery,
    });

    // Enforce consistent schema guarantees
    if (result.status === "clarify") {
      return {
        status: "clarify",
        query: null,
        response:
          result.response ||
          "Your query is not clear enough. Could you please clarify what you mean?",
      };
    }

    if (result.status === "rewritten") {
      return {
        status: "rewritten",
        query: result.query?.trim() || cleanedQuery,
        response: null,
      };
    }

    return {
      status: "clear",
      query: result.query?.trim() || cleanedQuery,
      response: null,
    };
  } catch (error: any) {
    console.error(
      `[Query Rewriter Error] Failed to process query "${cleanedQuery}":`,
      error?.message || error
    );

    // Fallback gracefully so chat pipeline is not blocked
    return {
      status: "clear",
      query: cleanedQuery,
      response: null,
    };
  }
}
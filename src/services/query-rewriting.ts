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

export const ConversationRewriteSchema = z.object({
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

export const QueryRewriteSchema = z.object({
  status: z
    .enum(["rewritten", "clear", "clarify", "hyde"])
    .describe(
      "Status of the query rewrite: 'clear' if already standalone and complete; 'rewritten' if contextual references/pronouns were resolved; 'clarify' if ambiguous, vague, or lacking sufficient information; 'hyde' if expanded via Hypothetical Document Embeddings"
    ),
  query: z
    .string()
    .nullable()
    .describe(
      "The standalone search query or hypothetical document for vector/lexical retrieval. Null if status is clarify"
    ),
  response: z
    .string()
    .nullable()
    .describe(
      "Helpful clarification question for the user if status is clarify. Null otherwise"
    ),
  hypotheticalDocument: z
    .string()
    .nullable()
    .optional()
    .describe(
      "The generated hypothetical passage when HyDE is enabled. Null or undefined otherwise"
    ),
  standaloneQuery: z
    .string()
    .nullable()
    .optional()
    .describe(
      "The underlying standalone query before HyDE expansion"
    ),
});

export type QueryRewriteResult = z.infer<typeof QueryRewriteSchema>;

export interface ChatHistoryMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface RewriteQueryOptions {
  /**
   * If true, enables Hypothetical Document Embeddings (HyDE) rewriting
   * before searching in the knowledge base.
   */
  hyde?: boolean;
  HyDE?: boolean;
}

// ---------------------------------------------
// LLM with Structured Output
// ---------------------------------------------

const structuredLLM = queryRewriterModel.withStructuredOutput(
  ConversationRewriteSchema
);

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
// HyDE (Hypothetical Document Embeddings) Setup
// ---------------------------------------------

const HYDE_SYSTEM_PROMPT = `You are an expert technical writer and knowledge retrieval assistant.
Your task is to generate a hypothetical document passage (Hypothetical Document Embeddings - HyDE) that directly answers the given user question.

Instructions:
1. Write an authoritative, detailed, and factual passage as if it were an excerpt from an official knowledge base, documentation, guide, or policy manual.
2. Incorporate relevant domain terminology, key concepts, facts, and vocabulary that would naturally appear in a document answering this query.
3. Do NOT include greetings, conversational filler, markdown code fence blocks, introductory phrases (e.g. "Here is a hypothetical document:", "Title:", "Passage:"), or commentary. Output ONLY the raw passage text.
4. Keep the passage focused and comprehensive (around 80 to 200 words).`;

const hydePrompt = ChatPromptTemplate.fromMessages([
  ["system", HYDE_SYSTEM_PROMPT],
  ["human", "{query}"],
]);

const hydeChain = hydePrompt.pipe(queryRewriterModel);

/**
 * Generates a hypothetical document passage for a query using HyDE.
 *
 * @param query - The standalone user question.
 * @returns The hypothetical document passage string.
 */
export async function generateHypotheticalDocument(
  query: string
): Promise<string> {
  const cleaned = (query || "").trim();
  if (!cleaned) return "";

  const response = await hydeChain.invoke({ query: cleaned });
  const passage =
    typeof response.content === "string"
      ? response.content.trim()
      : JSON.stringify(response.content).trim();

  return passage;
}

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
 * When HyDE is enabled, rewrites the query into an authoritative hypothetical document
 * passage for semantic vector and lexical retrieval.
 *
 * @param query - The latest query from the user.
 * @param history - Array of previous chat messages.
 * @param options - Options object (or boolean) indicating whether HyDE rewriting is enabled.
 * @returns QueryRewriteResult with status ('clear' | 'rewritten' | 'clarify' | 'hyde'), query, and optional response.
 */
export async function rewriteQuery(
  query: string,
  history: ChatHistoryMessage[] = [],
  options: RewriteQueryOptions | boolean = false
): Promise<QueryRewriteResult> {
  const useHyde =
    typeof options === "boolean"
      ? options
      : Boolean(options?.HyDE ?? options?.hyde);

  const cleanedQuery = (query || "").trim();

  // Fast-path for empty or whitespace-only queries
  if (!cleanedQuery) {
    return {
      status: "clarify",
      query: null,
      response: "Please provide a question or message so I can assist you.",
      hypotheticalDocument: null,
    };
  }

  const safeHistory = Array.isArray(history) ? history : [];
  // Restrict history to the most recent 10 messages to limit token usage and latency
  const recentHistory = safeHistory.slice(-10);
  const formattedHistory = formatHistoryMessages(recentHistory);

  // -------------------------------------------------------------
  // Flow A: Normal flow with just conversation-aware rewriting
  // -------------------------------------------------------------
  if (!useHyde) {
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
          hypotheticalDocument: null,
        };
      }

      if (result.status === "rewritten") {
        return {
          status: "rewritten",
          query: result.query?.trim() || cleanedQuery,
          response: null,
          hypotheticalDocument: null,
        };
      }

      return {
        status: "clear",
        query: result.query?.trim() || cleanedQuery,
        response: null,
        hypotheticalDocument: null,
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
        hypotheticalDocument: null,
      };
    }
  }

  // -------------------------------------------------------------
  // Flow B: HyDE flow (Hypothetical Document Embeddings)
  // -------------------------------------------------------------
  try {
    // Step 1: Pre-process with conversation awareness to resolve pronouns/context
    // and verify if the query needs clarification before generating HyDE.
    const result = await rewriteChain.invoke({
      history: formattedHistory,
      query: cleanedQuery,
    });

    if (result.status === "clarify") {
      return {
        status: "clarify",
        query: null,
        response:
          result.response ||
          "Your query is not clear enough. Could you please clarify what you mean?",
        hypotheticalDocument: null,
      };
    }

    const standaloneQuery = result.query?.trim() || cleanedQuery;

    // Step 2: Generate hypothetical document answering the standalone query
    console.log(
      `[HyDE] Generating hypothetical document for standalone query: "${standaloneQuery}"`
    );
    const hypotheticalDoc = await generateHypotheticalDocument(standaloneQuery);

    if (!hypotheticalDoc) {
      console.warn(
        `[HyDE] Generated document was empty. Falling back to standalone query.`
      );
      return {
        status: result.status === "rewritten" ? "rewritten" : "clear",
        query: standaloneQuery,
        response: null,
        hypotheticalDocument: null,
        standaloneQuery,
      };
    }

    console.log(
      `[HyDE] Successfully generated hypothetical document (${hypotheticalDoc.length} chars).`
    );

    return {
      status: "hyde",
      query: hypotheticalDoc,
      response: null,
      hypotheticalDocument: hypotheticalDoc,
      standaloneQuery,
    };
  } catch (error: any) {
    console.error(
      `[HyDE Error] Failed to generate HyDE rewrite for "${cleanedQuery}":`,
      error?.message || error
    );

    // Fallback gracefully to raw query so chat pipeline remains functional
    return {
      status: "clear",
      query: cleanedQuery,
      response: null,
      hypotheticalDocument: null,
      standaloneQuery: cleanedQuery,
    };
  }
}
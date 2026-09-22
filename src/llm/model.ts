import "dotenv/config";
import { ChatGroq } from "@langchain/groq";
// import { OpenAIEmbeddings } from "@langchain/openai";

import { CohereEmbeddings, CohereRerank } from "@langchain/cohere";

export const groqModel = new ChatGroq({
  apiKey: process.env.GROQ_API_KEY,
  model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
});

export const queryRewriterModel = new ChatGroq({
  apiKey: process.env.GROQ_API_KEY,
  model: process.env.GROQ_REWRITE_MODEL || process.env.GROQ_MODEL || "openai/gpt-oss-120b",
  temperature: 0,
});

export const chunkEnrichmentModel = new ChatGroq({
  apiKey: process.env.GROQ_API_KEY,
  model: process.env.GROQ_CHUNK_ENRICHMENT_MODEL || process.env.GROQ_MODEL || "openai/gpt-oss-120b",
  temperature: 0.1,
});

export const embeddingModel = new CohereEmbeddings({
  model: process.env.COHERE_EMBEDDING_MODEL || "embed-english-v3.0",
  apiKey: process.env.COHERE_API_KEY,
});

export const cohereReranker = new CohereRerank({
  apiKey: process.env.COHERE_API_KEY,
  model: process.env.COHERE_RERANK_MODEL || "rerank-v3.5",
  topN: 5,
});
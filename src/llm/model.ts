import "dotenv/config";
import { ChatGroq } from "@langchain/groq";
// import { OpenAIEmbeddings } from "@langchain/openai";

import { CohereEmbeddings } from "@langchain/cohere";


export const groqModel = new ChatGroq({
  apiKey: process.env.GROQ_API_KEY,
  model: "openai/gpt-oss-120b",
});


export const embeddingModel =  new CohereEmbeddings({
  model: "embed-english-v3.0",
  apiKey: process.env.COHERE_API_KEY
});

// export const embeddingModel = new OpenAIEmbeddings({
//   apiKey: process.env.OPENAI_API_KEY,
//   model: "text-embedding-3-small",
// });
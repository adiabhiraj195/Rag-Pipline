import { embeddingModel } from "../llm/model";
import { getVectorStore } from "../vector/vector-store";


export async function searchQueryInVectorStore(query: string, k: number = 5) {
  if (!query) {
    return;
  }

  const vectorStore = await getVectorStore();
  const result = await vectorStore.similaritySearch(query, k);
  return result;
}

export * from "./semantic-search";
export * from "./lexical-search";
export * from "./rrf";
export * from "./reranker";
export * from "./context-builder";
export * from "./retrieval-pipeline";



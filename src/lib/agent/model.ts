import { ChatOpenAI } from "@langchain/openai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

/**
 * Chat model adapter. Domain analytics never import a vendor SDK — only this file does.
 */
export async function createChatModel(): Promise<BaseChatModel> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required");
  }

  const maxTokens = Number(process.env.OPENAI_MAX_TOKENS ?? "900");

  return new ChatOpenAI({
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    temperature: 0,
    apiKey: process.env.OPENAI_API_KEY,
    // Keep the post-tool answer turn short — metric cards are filled server-side.
    maxTokens: Number.isFinite(maxTokens) && maxTokens > 200 ? maxTokens : 900,
    maxRetries: 1,
  });
}

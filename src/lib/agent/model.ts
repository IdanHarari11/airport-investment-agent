import { ChatOpenAI } from "@langchain/openai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

/** Default completion budget for structured AgentResponse JSON (tool + ranking turns). */
const DEFAULT_MAX_TOKENS = 16_384;

/**
 * Resolve completion token budget. Low caps (e.g. legacy OPENAI_MAX_TOKENS=900)
 * truncate structured JSON and surface as:
 * "Could not parse response content as the length limit was reached".
 */
export function resolveMaxCompletionTokens(
  raw: string | undefined = process.env.OPENAI_MAX_TOKENS,
): number {
  if (raw == null || raw.trim() === "") {
    return DEFAULT_MAX_TOKENS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MAX_TOKENS;
  }
  // Ignore legacy latency caps that cannot finish AgentResponse JSON.
  if (parsed < 4096) {
    return DEFAULT_MAX_TOKENS;
  }
  return Math.floor(parsed);
}

/**
 * Chat model adapter. Domain analytics never import a vendor SDK — only this file does.
 */
export async function createChatModel(): Promise<BaseChatModel> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required");
  }

  return new ChatOpenAI({
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    temperature: 0,
    maxTokens: resolveMaxCompletionTokens(),
    apiKey: process.env.OPENAI_API_KEY,
  });
}

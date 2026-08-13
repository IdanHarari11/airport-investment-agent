import { createAgent, createMiddleware } from "langchain";
import { HumanMessage, AIMessage, BaseMessage } from "@langchain/core/messages";
import {
  createAviationDataProvider,
  getAviationDataProvider,
} from "../aviation/provider";
import { createChatModel } from "./model";
import { getDataCurrencySummary } from "../aviation/dataCurrency";
import { buildSystemPrompt } from "./prompt";
import { agentTools } from "./tools";
import { toolLabel } from "./toolLabels";
import { languageInstruction, toDetectedLanguage } from "../speech/language";
import { applyDeterministicConfidence } from "./confidence";
import {
  enrichAgentResponse,
  mergeAirportsFromToolMessages,
} from "./mergeToolResults";
import { messageContentToText } from "./messageContent";
import {
  AgentResponseSchema,
  type AgentResponse,
  type ChatMessage,
} from "./types";

export type ToolProgressEvent =
  | {
      type: "tool_start";
      name: string;
      label: string;
    }
  | {
      type: "tool_end";
      name: string;
      label: string;
      ok: boolean;
    }
  | {
      type: "status";
      message: string;
    };

export type AgentProgressHandler = (event: ToolProgressEvent) => void;

function configureLangSmithTracing(): void {
  if (process.env.LANGSMITH_TRACING === "true" && process.env.LANGSMITH_API_KEY) {
    process.env.LANGCHAIN_TRACING_V2 = "true";
    process.env.LANGCHAIN_API_KEY = process.env.LANGSMITH_API_KEY;
    if (process.env.LANGSMITH_PROJECT) {
      process.env.LANGCHAIN_PROJECT = process.env.LANGSMITH_PROJECT;
    }
  }
}

function toLangChainMessages(history: ChatMessage[]): BaseMessage[] {
  return history.map((message) => {
    if (message.role === "assistant") {
      return new AIMessage(message.content);
    }
    return new HumanMessage(message.content);
  });
}

function extractJsonObject(text: string): unknown | null {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function inferConfidence(answer: string): AgentResponse["confidence"] {
  const lower = answer.toLowerCase();
  if (lower.includes("confidence:** high") || lower.includes("confidence: high")) {
    return "high";
  }
  if (
    lower.includes("confidence:** medium") ||
    lower.includes("confidence: medium")
  ) {
    return "medium";
  }
  if (lower.includes("confidence:** low") || lower.includes("confidence: low")) {
    return "low";
  }
  return "medium";
}

function extractAssumptions(answer: string): string[] {
  const match = answer.match(
    /assumptions?:?\s*([\s\S]*?)(?:\n\s*\*\*confidence|\n\s*confidence:|\n\s*\*\*sources|$)/i,
  );
  if (!match?.[1]) {
    return [
      "Response synthesized from tool outputs and conversation context.",
      "Quantitative values should be verified against tool/structured fields when present.",
    ];
  }
  const lines = match[1]
    .split("\n")
    .map((line) => line.replace(/^[\s\-*0-9.]+/, "").trim())
    .filter((line) => line.length > 12)
    .slice(0, 8);
  return lines.length > 0
    ? lines
    : [
        "Response synthesized from tool outputs and conversation context.",
      ];
}

function fallbackStructured(answer: string): AgentResponse {
  const sources = createAviationDataProvider().getSources();
  return {
    answer,
    airports: null,
    congestion: null,
    longHaul: null,
    unmetDemand: null,
    assumptions: extractAssumptions(answer),
    confidence: inferConfidence(answer),
    sources: sources.map((s) => ({
      name: s.name,
      url: s.url ?? null,
      period: s.period ?? null,
      notes: s.notes ?? null,
    })),
  };
}

function createProgressMiddleware(onProgress?: AgentProgressHandler) {
  return createMiddleware({
    name: "toolProgressReporter",
    wrapToolCall: async (request, handler) => {
      const name = request.toolCall.name;
      const label = toolLabel(name);
      onProgress?.({ type: "tool_start", name, label });
      onProgress?.({
        type: "status",
        message: `Running ${label}…`,
      });
      try {
        const result = await handler(request);
        onProgress?.({ type: "tool_end", name, label, ok: true });
        // Model still needs a turn after tools to write the analyst answer.
        onProgress?.({
          type: "status",
          message: "Drafting explanation from tool results…",
        });
        return result;
      } catch (error) {
        onProgress?.({ type: "tool_end", name, label, ok: false });
        onProgress?.({
          type: "status",
          message: "Recovering from a tool error…",
        });
        throw error;
      }
    },
  });
}

function finalizeAgentResponse(
  response: AgentResponse,
  messages: BaseMessage[],
): AgentResponse {
  const merged = mergeAirportsFromToolMessages(response, messages);
  const enriched = enrichAgentResponse(merged);
  return applyDeterministicConfidence(enriched);
}

function parseAgentResult(result: {
  structuredResponse?: unknown;
  messages: BaseMessage[];
}): AgentResponse {
  const messages = result.messages;
  const structured = result.structuredResponse;
  const validatedStructured = AgentResponseSchema.safeParse(structured);
  if (validatedStructured.success) {
    return finalizeAgentResponse(validatedStructured.data, messages);
  }

  const last = messages[messages.length - 1];
  const content = messageContentToText(last?.content);
  const parsed = extractJsonObject(content);
  const validated = AgentResponseSchema.safeParse(parsed);
  if (validated.success) {
    return finalizeAgentResponse(validated.data, messages);
  }

  return finalizeAgentResponse(
    fallbackStructured(content || "No response generated."),
    messages,
  );
}

export async function runAirportAgent(params: {
  message: string;
  history?: ChatMessage[];
  /** ISO-639-1 or BCP-47 from client language detection (speech/text). */
  language?: string;
  onProgress?: AgentProgressHandler;
}): Promise<AgentResponse> {
  configureLangSmithTracing();
  params.onProgress?.({
    type: "status",
    message: "Understanding question…",
  });

  // Ensure public API disk caches are ready once per process (not per chat turn).
  await getAviationDataProvider();
  const dataCurrency = getDataCurrencySummary();

  const model = await createChatModel();
  const agent = createAgent({
    model,
    tools: agentTools,
    systemPrompt: buildSystemPrompt(dataCurrency.brief),
    responseFormat: AgentResponseSchema,
    middleware: [createProgressMiddleware(params.onProgress)],
  });

  const history = (params.history ?? []).slice(-40);
  const lang = params.language
    ? toDetectedLanguage(params.language)
    : null;
  const userContent = lang
    ? `${languageInstruction(lang)}\n\n${params.message}`
    : params.message;

  params.onProgress?.({
    type: "status",
    message: "Selecting tools…",
  });

  const result = await agent.invoke({
    messages: [
      ...toLangChainMessages(history),
      new HumanMessage(userContent),
    ],
  });

  params.onProgress?.({
    type: "status",
    message: "Drafting explanation…",
  });

  return parseAgentResult(result as {
    structuredResponse?: unknown;
    messages: BaseMessage[];
  });
}

import { createAgent, createMiddleware } from "langchain";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  BaseMessage,
} from "@langchain/core/messages";
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

/** SSE / client-facing stream events from the agent turn. */
export type AgentStreamEvent =
  | ToolProgressEvent
  | {
      type: "structured";
      response: AgentResponse;
    }
  | {
      type: "answer_delta";
      delta: string;
    }
  | {
      type: "final";
      response: AgentResponse;
    };

export type AgentProgressHandler = (event: ToolProgressEvent) => void;

const MAX_TOOL_ROUNDS = 8;

const ANSWER_STREAM_INSTRUCTION = `

Final response mode:
- Write the analyst-facing answer as markdown prose only (not JSON).
- Never invent airport metrics, scores, rankings, or percentages — use only tool results in this conversation.
- Do not paste full score tables into the answer; the UI renders score/insight cards from tools.
- Keep the answer focused (thesis + key numbers + uncertainty). Assumptions/sources/confidence are attached by the server.`;

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

function emptyStructuredSkeleton(): AgentResponse {
  return {
    answer: "",
    airports: null,
    congestion: null,
    longHaul: null,
    unmetDemand: null,
    assumptions: [],
    confidence: "medium",
    sources: [],
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

/** Deterministic cards/metadata from tool messages (answer may still be empty). */
export function buildStructuredFromToolMessages(
  messages: BaseMessage[],
  answer = "",
): AgentResponse {
  const base =
    answer.trim().length > 0
      ? fallbackStructured(answer)
      : emptyStructuredSkeleton();
  return finalizeAgentResponse(
    { ...base, answer: answer.trim().length > 0 ? answer : base.answer },
    messages,
  );
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

function resolveUserContent(params: {
  message: string;
  language?: string;
}): string {
  const lang = params.language ? toDetectedLanguage(params.language) : null;
  return lang
    ? `${languageInstruction(lang)}\n\n${params.message}`
    : params.message;
}

/**
 * Stream a turn: tool progress → structured cards (from tools) → answer deltas → final.
 * Cards are deterministic from tool JSON; the model only streams narrative prose.
 */
export async function* streamAirportAgent(params: {
  message: string;
  history?: ChatMessage[];
  language?: string;
}): AsyncGenerator<AgentStreamEvent, AgentResponse, void> {
  configureLangSmithTracing();
  yield { type: "status", message: "Understanding question…" };

  await getAviationDataProvider();
  const dataCurrency = getDataCurrencySummary();
  const history = (params.history ?? []).slice(-40);

  const model = await createChatModel();
  if (typeof model.bindTools !== "function") {
    throw new Error("Chat model does not support tool binding");
  }
  const bound = model.bindTools(agentTools);
  const toolsByName = new Map<
    string,
    { invoke: (input: unknown) => Promise<unknown> }
  >(
    agentTools.map((tool) => [
      tool.name,
      tool as { invoke: (input: unknown) => Promise<unknown> },
    ]),
  );

  const toolMessages: BaseMessage[] = [
    new SystemMessage(buildSystemPrompt(dataCurrency.brief)),
    ...toLangChainMessages(history),
    new HumanMessage(resolveUserContent(params)),
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    yield {
      type: "status",
      message: round === 0 ? "Selecting tools…" : "Selecting follow-up tools…",
    };

    const ai = await bound.invoke(toolMessages);
    const toolCalls = ai.tool_calls ?? [];
    if (toolCalls.length === 0) {
      // Model is ready to answer — discard this non-streamed completion.
      break;
    }

    toolMessages.push(ai);

    for (const call of toolCalls) {
      const name = call.name ?? "unknown_tool";
      const label = toolLabel(name);
      const toolCallId = call.id ?? `tool-${round}-${name}`;
      yield { type: "tool_start", name, label };
      yield { type: "status", message: `Running ${label}…` };

      try {
        const tool = toolsByName.get(name);
        if (!tool) {
          throw new Error(`Unknown tool: ${name}`);
        }
        const raw = await tool.invoke(call.args);
        const content = typeof raw === "string" ? raw : JSON.stringify(raw);
        toolMessages.push(
          new ToolMessage({
            content,
            tool_call_id: toolCallId,
            name,
          }),
        );
        yield { type: "tool_end", name, label, ok: true };
      } catch (error) {
        toolMessages.push(
          new ToolMessage({
            content: JSON.stringify({
              error:
                error instanceof Error ? error.message : "Tool execution failed",
            }),
            tool_call_id: toolCallId,
            name,
          }),
        );
        yield { type: "tool_end", name, label, ok: false };
        yield {
          type: "status",
          message: "Recovering from a tool error…",
        };
      }
    }

    yield {
      type: "status",
      message: "Drafting explanation from tool results…",
    };
  }

  const structured = buildStructuredFromToolMessages(toolMessages);
  yield { type: "structured", response: structured };

  yield {
    type: "status",
    message: "Drafting explanation from tool results…",
  };

  const answerMessages: BaseMessage[] = [
    new SystemMessage(
      `${buildSystemPrompt(dataCurrency.brief)}${ANSWER_STREAM_INSTRUCTION}`,
    ),
    ...toolMessages.slice(1),
  ];

  let answer = "";
  const stream = await model.stream(answerMessages);
  for await (const chunk of stream) {
    const delta = messageContentToText(chunk.content);
    if (!delta) continue;
    answer += delta;
    yield { type: "answer_delta", delta };
  }

  const finalResponse = buildStructuredFromToolMessages(
    toolMessages,
    answer.trim() || "No response generated.",
  );
  yield { type: "final", response: finalResponse };
  return finalResponse;
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
  const userContent = resolveUserContent(params);

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

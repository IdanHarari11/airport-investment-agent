import { z } from "zod";
import { runAirportAgent } from "@/lib/agent/agent";
import type { ChatMessage } from "@/lib/agent/types";
import { toPublicErrorMessage } from "@/lib/security/publicErrors";
import {
  clientKeyFromRequest,
  takeRateLimitToken,
} from "@/lib/security/rateLimit";

export const runtime = "nodejs";
export const maxDuration = 60;

const HistoryItemSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(8000),
});

const RequestSchema = z.object({
  message: z.string().min(1).max(4000),
  /** Truncated to last 40 before validation when oversized. */
  history: z.array(HistoryItemSchema).max(40).optional(),
  /** Client-only anonymous id — never used for auth; rejected if oversized. */
  clientUserId: z.string().uuid().optional(),
  /** Detected user language (ISO-639-1 or BCP-47), e.g. he / he-IL. */
  language: z.string().min(2).max(16).optional(),
});

function encodeSse(data: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

function preprocessBody(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const record = { ...(body as Record<string, unknown>) };
  if (Array.isArray(record.history) && record.history.length > 40) {
    record.history = record.history.slice(-40);
  }
  return record;
}

export async function POST(request: Request) {
  const limit = takeRateLimitToken({
    key: `chat:${clientKeyFromRequest(request)}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    return Response.json(
      { error: "Too many chat requests. Please wait a moment and try again." },
      {
        status: 429,
        headers: {
          "Retry-After": String(limit.retryAfterSec),
          "X-RateLimit-Remaining": "0",
        },
      },
    );
  }

  let body: unknown;
  try {
    body = preprocessBody(await request.json());
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request." },
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // Stateless server: each request carries its own history from the client store.
  // clientUserId is accepted only for optional future logging — never shared across users.
  void parsed.data.clientUserId;

  const history = (parsed.data.history ?? []).slice(-40) as ChatMessage[];
  const wantsStream =
    request.headers.get("accept")?.includes("text/event-stream") ?? false;

  if (!wantsStream) {
    try {
      const response = await runAirportAgent({
        message: parsed.data.message,
        history,
        language: parsed.data.language,
      });
      return Response.json({ response });
    } catch (error) {
      const publicError = toPublicErrorMessage(error);
      console.error("chat agent error", error);
      return Response.json(
        { error: publicError.error },
        { status: publicError.status },
      );
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encodeSse(payload));
      };

      try {
        const response = await runAirportAgent({
          message: parsed.data.message,
          history,
          language: parsed.data.language,
          onProgress: (event) => send(event),
        });
        send({ type: "final", response });
      } catch (error) {
        console.error("chat agent error", error);
        const publicError = toPublicErrorMessage(error);
        send({
          type: "error",
          error: publicError.error,
          status: publicError.status,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-RateLimit-Remaining": String(limit.remaining),
    },
  });
}

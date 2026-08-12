import { z } from "zod";
import {
  buildTtsAttempts,
  modelSupportsLanguageCode,
} from "@/lib/speech/ttsLanguage";
import {
  clientKeyFromRequest,
  takeRateLimitToken,
} from "@/lib/security/rateLimit";

export const runtime = "nodejs";
export const maxDuration = 60;

const BodySchema = z.object({
  text: z.string().min(1).max(5000),
  /** ISO-639-1 from detected spoken-text language (he, en, ar, …). */
  language: z.string().min(2).max(16).optional(),
});

const DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";
const DEFAULT_MODEL_ID = "eleven_multilingual_v2";
const TTS_MAX_CHARS = 2500;

async function synthesize(params: {
  apiKey: string;
  voiceId: string;
  modelId: string;
  text: string;
  language?: string;
}): Promise<{ response: Response; detail: string }> {
  const payload: Record<string, unknown> = {
    text: params.text,
    model_id: params.modelId,
    // Help numbers / codes pronounce more naturally in the target language.
    apply_text_normalization: "auto",
  };

  // language_code is ignored by multilingual_v2; required for reliable he/ar/…
  // on flash / turbo models.
  if (params.language && modelSupportsLanguageCode(params.modelId)) {
    payload.language_code = params.language;
  }

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(params.voiceId)}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": params.apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify(payload),
    },
  );

  if (response.ok) {
    return { response, detail: "" };
  }

  const detail = await response.text().catch(() => "");
  return { response, detail };
}

export async function POST(request: Request) {
  const limit = takeRateLimitToken({
    key: `tts:${clientKeyFromRequest(request)}`,
    limit: 20,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    return Response.json(
      { error: "Too many voice requests. Please wait a moment and try again." },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSec) },
      },
    );
  }

  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) {
    return Response.json(
      { error: "Voice synthesis is not configured on this server." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid TTS request." }, { status: 400 });
  }

  const voiceId =
    process.env.ELEVENLABS_VOICE_ID?.trim() || DEFAULT_VOICE_ID;
  const configuredModel =
    process.env.ELEVENLABS_MODEL_ID?.trim() || DEFAULT_MODEL_ID;
  const language = (parsed.data.language ?? "en").slice(0, 2).toLowerCase();
  const truncated = parsed.data.text.length > TTS_MAX_CHARS;
  const text = parsed.data.text.slice(0, TTS_MAX_CHARS);

  const attempts = buildTtsAttempts({
    configuredModel,
    language,
  });

  let lastStatus = 502;

  for (const attempt of attempts) {
    const { response, detail } = await synthesize({
      apiKey,
      voiceId,
      modelId: attempt.modelId,
      text,
      language: attempt.language,
    });
    if (response.ok) {
      const audio = await response.arrayBuffer();
      return new Response(audio, {
        status: 200,
        headers: {
          "Content-Type": "audio/mpeg",
          "Cache-Control": "no-store",
          "X-TTS-Model": attempt.modelId,
          "X-TTS-Language": attempt.language ?? language,
          "X-TTS-Truncated": truncated ? "true" : "false",
          "X-RateLimit-Remaining": String(limit.remaining),
        },
      });
    }
    lastStatus = response.status;
    console.error(
      "ElevenLabs TTS attempt failed",
      attempt.modelId,
      attempt.language ?? "-",
      response.status,
      detail.slice(0, 200),
    );
  }

  return Response.json(
    {
      error:
        lastStatus === 401 || lastStatus === 403
          ? "Voice synthesis credentials were rejected."
          : "Voice synthesis failed. Please try again.",
    },
    { status: lastStatus === 401 || lastStatus === 403 ? 503 : 502 },
  );
}

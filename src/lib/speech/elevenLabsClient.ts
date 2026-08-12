import { toIso639 } from "./language";
import { resolveTtsLanguage } from "./ttsLanguage";
import { plainTextForSpeech } from "./webSpeech";

let activeAudio: HTMLAudioElement | null = null;
let activeObjectUrl: string | null = null;
let activeSession: {
  resolve: () => void;
  reject: (error: Error) => void;
} | null = null;

function clearAudioElement(): void {
  if (activeAudio) {
    activeAudio.onended = null;
    activeAudio.onerror = null;
    activeAudio.pause();
    activeAudio.removeAttribute("src");
    activeAudio.load();
    activeAudio = null;
  }
  if (activeObjectUrl) {
    URL.revokeObjectURL(activeObjectUrl);
    activeObjectUrl = null;
  }
}

function endSession(
  outcome: "resolve" | "reject",
  error?: Error,
): void {
  const session = activeSession;
  activeSession = null;
  clearAudioElement();
  if (!session) return;
  if (outcome === "reject" && error) {
    session.reject(error);
    return;
  }
  session.resolve();
}

/**
 * Stop current playback. Resolves the in-flight speak promise (not an error).
 */
export function stopElevenLabsAudio(): void {
  endSession("resolve");
}

/** @deprecated use toIso639 from language.ts */
export function toLanguageCode(bcp47: string): string {
  return toIso639(bcp47);
}

/**
 * Speak via server-proxied ElevenLabs TTS (API key never leaves the server).
 * Prefer explicit user/conversation language; fall back to detecting from text.
 * Calling stopElevenLabsAudio() mid-play resolves this promise without throwing.
 */
export type SpeakResult = {
  truncated: boolean;
};

export async function speakWithElevenLabs(
  text: string,
  preferredLanguage?: string | null,
): Promise<SpeakResult> {
  const cleaned = plainTextForSpeech(text);
  if (!cleaned) return { truncated: false };

  stopElevenLabsAudio();

  // Always derive TTS language from the spoken text (Hebrew script → he),
  // not from sticky mic/UI preference (often en-US on this machine).
  const language = resolveTtsLanguage(cleaned, preferredLanguage).iso639;

  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: cleaned,
      language,
    }),
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(data.error || "ElevenLabs TTS request failed.");
  }

  const truncated = res.headers.get("X-TTS-Truncated") === "true";

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  activeObjectUrl = url;

  await new Promise<void>((resolve, reject) => {
    const audio = new Audio(url);
    activeAudio = audio;
    activeSession = { resolve, reject };

    audio.onended = () => {
      endSession("resolve");
    };
    audio.onerror = () => {
      // Intentional stop clears handlers first; ignore residual media errors.
      if (!activeSession) return;
      endSession("reject", new Error("Could not play ElevenLabs audio."));
    };
    void audio.play().catch((error: unknown) => {
      if (!activeSession) return;
      endSession(
        "reject",
        error instanceof Error
          ? error
          : new Error("Audio playback was blocked."),
      );
    });
  });

  return { truncated };
}

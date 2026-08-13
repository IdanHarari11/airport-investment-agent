import { toIso639 } from "./language";
import { resolveTtsLanguage } from "./ttsLanguage";
import { plainTextForSpeech } from "./webSpeech";

export type SpeakResult = {
  truncated: boolean;
};

export type ElevenLabsTtsStatus = "idle" | "loading" | "playing";

export type ElevenLabsTtsState = {
  status: ElevenLabsTtsStatus;
  ownerId: string | null;
};

type ActiveSession = {
  resolve: () => void;
  reject: (error: Error) => void;
};

let activeAudio: HTMLAudioElement | null = null;
let activeObjectUrl: string | null = null;
let activeAbort: AbortController | null = null;
let activeSession: ActiveSession | null = null;
let ttsState: ElevenLabsTtsState = { status: "idle", ownerId: null };
const listeners = new Set<(state: ElevenLabsTtsState) => void>();

function emitState(next: ElevenLabsTtsState): void {
  ttsState = next;
  for (const listener of listeners) {
    listener(ttsState);
  }
}

export function getElevenLabsTtsState(): ElevenLabsTtsState {
  return ttsState;
}

export function subscribeElevenLabsTts(
  listener: (state: ElevenLabsTtsState) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

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

function abortInFlightFetch(): void {
  if (!activeAbort) return;
  const controller = activeAbort;
  activeAbort = null;
  controller.abort();
}

function endSession(outcome: "resolve" | "reject", error?: Error): void {
  const session = activeSession;
  activeSession = null;
  abortInFlightFetch();
  clearAudioElement();
  emitState({ status: "idle", ownerId: null });
  if (!session) return;
  if (outcome === "reject" && error) {
    session.reject(error);
    return;
  }
  session.resolve();
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

/**
 * Stop current playback and cancel any in-flight TTS fetch.
 * Resolves the in-flight speak promise (not an error).
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
 * Only one global session at a time — a new call stops the previous one.
 * Calling stopElevenLabsAudio() mid-load/play resolves this promise without throwing.
 */
export async function speakWithElevenLabs(
  text: string,
  preferredLanguage?: string | null,
  options?: { ownerId?: string | null },
): Promise<SpeakResult> {
  const cleaned = plainTextForSpeech(text);
  if (!cleaned) return { truncated: false };

  const ownerId = options?.ownerId ?? null;

  // Cancel any prior fetch/playback before starting a new one.
  stopElevenLabsAudio();

  const controller = new AbortController();
  activeAbort = controller;
  emitState({ status: "loading", ownerId });

  try {
    const language = resolveTtsLanguage(cleaned, preferredLanguage).iso639;

    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: cleaned,
        language,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(data.error || "ElevenLabs TTS request failed.");
    }

    const truncated = res.headers.get("X-TTS-Truncated") === "true";
    const blob = await res.blob();

    // Stopped while the response body was still being read.
    if (controller.signal.aborted || activeAbort !== controller) {
      return { truncated: false };
    }

    const url = URL.createObjectURL(blob);
    activeObjectUrl = url;
    emitState({ status: "playing", ownerId });

    await new Promise<void>((resolve, reject) => {
      const audio = new Audio(url);
      activeAudio = audio;
      activeSession = { resolve, reject };

      audio.onended = () => {
        if (activeAbort === controller) {
          activeAbort = null;
        }
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
  } catch (error) {
    if (controller.signal.aborted || isAbortError(error)) {
      // stopElevenLabsAudio() already settled UI state; resolve quietly.
      if (activeAbort === controller) {
        activeAbort = null;
        clearAudioElement();
        emitState({ status: "idle", ownerId: null });
      }
      return { truncated: false };
    }

    if (activeAbort === controller) {
      activeAbort = null;
      clearAudioElement();
      activeSession = null;
      emitState({ status: "idle", ownerId: null });
    }

    throw error instanceof Error
      ? error
      : new Error("ElevenLabs TTS request failed.");
  }
}

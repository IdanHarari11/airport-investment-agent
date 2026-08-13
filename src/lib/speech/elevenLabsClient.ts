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

type CachedClip = {
  blob: Blob;
  truncated: boolean;
};

const MAX_CACHE_ENTRIES = 24;

let activeAudio: HTMLAudioElement | null = null;
let activeObjectUrl: string | null = null;
let activeAbort: AbortController | null = null;
let activeSession: ActiveSession | null = null;
let ttsState: ElevenLabsTtsState = { status: "idle", ownerId: null };
const listeners = new Set<(state: ElevenLabsTtsState) => void>();

/** LRU cache: Map insertion order — get refreshes, set trims oldest. */
const audioCache = new Map<string, CachedClip>();

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

/** Clear replay cache (tests / memory pressure). */
export function clearElevenLabsAudioCache(): void {
  audioCache.clear();
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Cache key: messageId (when present) + content hash of cleaned text + language.
 * Regenerated answers get a new messageId/content → natural miss.
 */
export function buildTtsCacheKey(params: {
  text: string;
  language: string;
  ownerId?: string | null;
}): string {
  const language = toIso639(params.language);
  const contentHash = hashString(`${language}\0${params.text}`);
  const owner = params.ownerId?.trim() || "anon";
  return `${owner}:${contentHash}`;
}

function getCachedClip(key: string): CachedClip | null {
  const entry = audioCache.get(key);
  if (!entry) return null;
  // Refresh LRU position.
  audioCache.delete(key);
  audioCache.set(key, entry);
  return entry;
}

function setCachedClip(key: string, clip: CachedClip): void {
  if (audioCache.has(key)) {
    audioCache.delete(key);
  }
  audioCache.set(key, clip);
  while (audioCache.size > MAX_CACHE_ENTRIES) {
    const oldest = audioCache.keys().next().value;
    if (oldest === undefined) break;
    audioCache.delete(oldest);
  }
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

function playBlob(
  blob: Blob,
  ownerId: string | null,
  controller: AbortController,
): Promise<void> {
  const url = URL.createObjectURL(blob);
  activeObjectUrl = url;
  emitState({ status: "playing", ownerId });

  return new Promise<void>((resolve, reject) => {
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
 * Identical text+language(+owner) replays use a client Blob cache — no new /api/tts.
 */
export async function speakWithElevenLabs(
  text: string,
  preferredLanguage?: string | null,
  options?: { ownerId?: string | null },
): Promise<SpeakResult> {
  const cleaned = plainTextForSpeech(text);
  if (!cleaned) return { truncated: false };

  const ownerId = options?.ownerId ?? null;
  const language = resolveTtsLanguage(cleaned, preferredLanguage).iso639;
  const cacheKey = buildTtsCacheKey({
    text: cleaned,
    language,
    ownerId,
  });

  // Cancel any prior fetch/playback before starting a new one.
  stopElevenLabsAudio();

  const controller = new AbortController();
  activeAbort = controller;

  const cached = getCachedClip(cacheKey);
  if (cached) {
    emitState({ status: "playing", ownerId });
    try {
      await playBlob(cached.blob, ownerId, controller);
      return { truncated: cached.truncated };
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        if (activeAbort === controller) {
          activeAbort = null;
          clearAudioElement();
          emitState({ status: "idle", ownerId: null });
        }
        return { truncated: false };
      }
      throw error instanceof Error
        ? error
        : new Error("ElevenLabs TTS request failed.");
    }
  }

  emitState({ status: "loading", ownerId });

  try {
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

    // Stopped while the response body was still being read — do not cache.
    if (controller.signal.aborted || activeAbort !== controller) {
      return { truncated: false };
    }

    setCachedClip(cacheKey, { blob, truncated });

    await playBlob(blob, ownerId, controller);

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

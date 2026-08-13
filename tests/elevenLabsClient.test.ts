import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildTtsCacheKey,
  clearElevenLabsAudioCache,
  getElevenLabsTtsState,
  speakWithElevenLabs,
  stopElevenLabsAudio,
  subscribeElevenLabsTts,
} from "@/lib/speech/elevenLabsClient";

type MockAudio = {
  onended: ((this: MockAudio, ev: Event) => void) | null;
  onerror: ((this: MockAudio, ev: Event) => void) | null;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  removeAttribute: ReturnType<typeof vi.fn>;
  load: ReturnType<typeof vi.fn>;
};

describe("elevenLabsClient TTS session", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let lastAudio: MockAudio | null;

  beforeEach(() => {
    lastAudio = null;
    stopElevenLabsAudio();
    clearElevenLabsAudioCache();

    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    function createAudioMock(_url: string): MockAudio {
      void _url;
      const audio: MockAudio = {
        onended: null,
        onerror: null,
        play: vi.fn(() => Promise.resolve()),
        pause: vi.fn(),
        removeAttribute: vi.fn(),
        load: vi.fn(),
      };
      lastAudio = audio;
      return audio;
    }

    vi.stubGlobal("Audio", createAudioMock);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:mock"),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    stopElevenLabsAudio();
    clearElevenLabsAudioCache();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function deferredFetch(signal?: AbortSignal): {
    promise: Promise<Response>;
    resolve: (value: Response) => void;
  } {
    let resolve!: (value: Response) => void;
    const promise = new Promise<Response>((res, rej) => {
      resolve = res;
      if (!signal) return;
      if (signal.aborted) {
        rej(new DOMException("Aborted", "AbortError"));
        return;
      }
      signal.addEventListener(
        "abort",
        () => rej(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    });
    return { promise, resolve };
  }

  function okAudioResponse(body = "audio-bytes"): Response {
    return new Response(new Blob([body]), {
      status: 200,
      headers: { "Content-Type": "audio/mpeg" },
    });
  }

  async function playThrough(speakPromise: Promise<{ truncated: boolean }>) {
    await vi.waitFor(() => {
      expect(getElevenLabsTtsState().status).toBe("playing");
      expect(lastAudio).not.toBeNull();
    });
    lastAudio!.onended?.call(
      lastAudio as unknown as MockAudio,
      new Event("ended"),
    );
    return speakPromise;
  }

  it("does not start a second /api/tts while the first is in flight; stop aborts it", async () => {
    let secondFetchStarted = false;
    let fetchedSignal: AbortSignal | undefined;
    let pending: ReturnType<typeof deferredFetch> | undefined;

    fetchMock.mockImplementationOnce((...args: unknown[]) => {
      const init = args[1] as RequestInit | undefined;
      fetchedSignal = init?.signal ?? undefined;
      pending = deferredFetch(fetchedSignal);
      return pending.promise;
    });
    fetchMock.mockImplementation(() => {
      secondFetchStarted = true;
      return Promise.reject(new Error("parallel fetch should not run"));
    });

    const states: string[] = [];
    const unsubscribe = subscribeElevenLabsTts((state) => {
      states.push(`${state.status}:${state.ownerId ?? "-"}`);
    });

    const speakPromise = speakWithElevenLabs("Hello runway capacity.", "en", {
      ownerId: "msg-a",
    });

    expect(getElevenLabsTtsState()).toEqual({
      status: "loading",
      ownerId: "msg-a",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    stopElevenLabsAudio();
    expect(fetchedSignal?.aborted).toBe(true);
    expect(getElevenLabsTtsState()).toEqual({
      status: "idle",
      ownerId: null,
    });

    await expect(speakPromise).resolves.toEqual({ truncated: false });
    expect(secondFetchStarted).toBe(false);
    expect(states).toContain("loading:msg-a");
    expect(states.at(-1)).toBe("idle:-");

    unsubscribe();
    void pending;
  });

  it("starting playback for message B cancels message A fetch", async () => {
    const signals: AbortSignal[] = [];

    fetchMock
      .mockImplementationOnce((...args: unknown[]) => {
        const init = args[1] as RequestInit | undefined;
        if (init?.signal) signals.push(init.signal);
        return deferredFetch(init?.signal ?? undefined).promise;
      })
      .mockImplementationOnce((...args: unknown[]) => {
        const init = args[1] as RequestInit | undefined;
        if (init?.signal) signals.push(init.signal);
        return Promise.resolve(okAudioResponse("audio-b"));
      });

    const speakA = speakWithElevenLabs("First answer about airports.", "en", {
      ownerId: "msg-a",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const speakB = speakWithElevenLabs("Second answer about hubs.", "en", {
      ownerId: "msg-b",
    });

    expect(signals[0]?.aborted).toBe(true);
    expect(getElevenLabsTtsState().ownerId).toBe("msg-b");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await expect(speakA).resolves.toEqual({ truncated: false });

    await expect(playThrough(speakB)).resolves.toEqual({ truncated: false });
    expect(getElevenLabsTtsState()).toEqual({
      status: "idle",
      ownerId: null,
    });
  });

  it("second play of the same message reuses cache and does not call fetch", async () => {
    fetchMock.mockResolvedValue(okAudioResponse("cached-audio"));

    const text = "Runway capacity at major hubs.";
    const first = speakWithElevenLabs(text, "en", { ownerId: "msg-cache" });
    await expect(playThrough(first)).resolves.toEqual({ truncated: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = speakWithElevenLabs(text, "en", { ownerId: "msg-cache" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getElevenLabsTtsState()).toEqual({
      status: "playing",
      ownerId: "msg-cache",
    });
    await expect(playThrough(second)).resolves.toEqual({ truncated: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not cache aborted in-flight fetches", async () => {
    let pending: ReturnType<typeof deferredFetch> | undefined;

    fetchMock.mockImplementationOnce((...args: unknown[]) => {
      const init = args[1] as RequestInit | undefined;
      pending = deferredFetch(init?.signal ?? undefined);
      return pending.promise;
    });

    const speakPromise = speakWithElevenLabs("Abort before cache.", "en", {
      ownerId: "msg-abort",
    });
    stopElevenLabsAudio();
    await expect(speakPromise).resolves.toEqual({ truncated: false });

    fetchMock.mockResolvedValueOnce(okAudioResponse("after-abort"));
    const replay = speakWithElevenLabs("Abort before cache.", "en", {
      ownerId: "msg-abort",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(playThrough(replay)).resolves.toEqual({ truncated: false });
    void pending;
  });

  it("different messageId or text uses a different cache key", () => {
    const a = buildTtsCacheKey({
      text: "Same words",
      language: "en",
      ownerId: "msg-1",
    });
    const b = buildTtsCacheKey({
      text: "Same words",
      language: "en",
      ownerId: "msg-2",
    });
    const c = buildTtsCacheKey({
      text: "Different words",
      language: "en",
      ownerId: "msg-1",
    });
    const d = buildTtsCacheKey({
      text: "Same words",
      language: "he",
      ownerId: "msg-1",
    });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
  });
});

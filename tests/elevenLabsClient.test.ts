import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
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
        return Promise.resolve(
          new Response(new Blob(["audio-b"]), {
            status: 200,
            headers: { "Content-Type": "audio/mpeg" },
          }),
        );
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

    await vi.waitFor(() => {
      expect(getElevenLabsTtsState()).toEqual({
        status: "playing",
        ownerId: "msg-b",
      });
      expect(lastAudio).not.toBeNull();
    });

    lastAudio!.onended?.call(
      lastAudio as unknown as MockAudio,
      new Event("ended"),
    );
    await expect(speakB).resolves.toEqual({ truncated: false });
    expect(getElevenLabsTtsState()).toEqual({
      status: "idle",
      ownerId: null,
    });
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isLikelyNetworkFetchFailure,
  isUnloadNetworkError,
} from "../src/lib/chat/isUnloadNetworkError";

describe("isLikelyNetworkFetchFailure", () => {
  it("matches common browser unload / offline fetch messages", () => {
    expect(isLikelyNetworkFetchFailure(new TypeError("Failed to fetch"))).toBe(
      true,
    );
    expect(isLikelyNetworkFetchFailure(new TypeError("network error"))).toBe(
      true,
    );
    expect(
      isLikelyNetworkFetchFailure(
        new TypeError("NetworkError when attempting to fetch resource."),
      ),
    ).toBe(true);
    expect(isLikelyNetworkFetchFailure(new TypeError("Load failed"))).toBe(
      true,
    );
    expect(isLikelyNetworkFetchFailure(new Error("fetch failed"))).toBe(true);
  });

  it("does not match ordinary application errors", () => {
    expect(isLikelyNetworkFetchFailure(new Error("Request failed"))).toBe(
      false,
    );
    expect(isLikelyNetworkFetchFailure(new Error("tool timeout"))).toBe(false);
    expect(isLikelyNetworkFetchFailure("Failed to fetch")).toBe(false);
  });
});

describe("isUnloadNetworkError", () => {
  const networkErr = new TypeError("Failed to fetch");

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("treats aborted requests as non-fatal for persistence", () => {
    expect(
      isUnloadNetworkError(networkErr, { unloading: false, aborted: true }),
    ).toBe(true);
  });

  it("treats any error during page unload as non-fatal", () => {
    expect(
      isUnloadNetworkError(networkErr, { unloading: true, aborted: false }),
    ).toBe(true);
    expect(
      isUnloadNetworkError(new Error("Request failed"), {
        unloading: true,
        aborted: false,
      }),
    ).toBe(true);
  });

  it("does not suppress real network errors while the tab stays visible", () => {
    vi.stubGlobal("document", { visibilityState: "visible" });
    expect(
      isUnloadNetworkError(networkErr, { unloading: false, aborted: false }),
    ).toBe(false);
    expect(
      isUnloadNetworkError(new TypeError("network error"), {
        unloading: false,
        aborted: false,
      }),
    ).toBe(false);
  });

  it("suppresses network TypeErrors when document is already hidden (unload race)", () => {
    vi.stubGlobal("document", { visibilityState: "hidden" });
    expect(
      isUnloadNetworkError(networkErr, { unloading: false, aborted: false }),
    ).toBe(true);
    expect(
      isUnloadNetworkError(new Error("Request failed"), {
        unloading: false,
        aborted: false,
      }),
    ).toBe(false);
  });
});

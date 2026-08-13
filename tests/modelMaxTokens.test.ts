import { describe, expect, it } from "vitest";
import { resolveMaxCompletionTokens } from "@/lib/agent/model";

describe("resolveMaxCompletionTokens", () => {
  it("defaults to 16384 when unset or empty", () => {
    expect(resolveMaxCompletionTokens(undefined)).toBe(16_384);
    expect(resolveMaxCompletionTokens("")).toBe(16_384);
    expect(resolveMaxCompletionTokens("   ")).toBe(16_384);
  });

  it("ignores legacy low caps that truncate structured JSON", () => {
    expect(resolveMaxCompletionTokens("900")).toBe(16_384);
    expect(resolveMaxCompletionTokens("2048")).toBe(16_384);
    expect(resolveMaxCompletionTokens("4095")).toBe(16_384);
  });

  it("honors generous explicit budgets", () => {
    expect(resolveMaxCompletionTokens("4096")).toBe(4096);
    expect(resolveMaxCompletionTokens("8192")).toBe(8192);
    expect(resolveMaxCompletionTokens("16384")).toBe(16_384);
  });

  it("falls back on invalid values", () => {
    expect(resolveMaxCompletionTokens("abc")).toBe(16_384);
    expect(resolveMaxCompletionTokens("-1")).toBe(16_384);
    expect(resolveMaxCompletionTokens("0")).toBe(16_384);
  });
});

import { describe, expect, it } from "vitest";
import { toPublicErrorMessage } from "../src/lib/security/publicErrors";

describe("toPublicErrorMessage", () => {
  it("does not echo API key names or secret-looking strings", () => {
    const result = toPublicErrorMessage(
      new Error("OPENAI_API_KEY is required"),
    );
    expect(result.status).toBe(503);
    expect(result.error).not.toMatch(/OPENAI_API_KEY/);
    expect(result.error).not.toMatch(/sk-/);
  });

  it("redacts bearer-like error text", () => {
    const result = toPublicErrorMessage(
      new Error("Unauthorized Bearer sk-abcdefghijklmnopqrstuvwxyz"),
    );
    expect(result.error).not.toMatch(/sk-/);
    expect(result.error).not.toMatch(/Bearer/i);
  });

  it("returns a generic failure for ordinary errors", () => {
    const result = toPublicErrorMessage(new Error("tool timeout"));
    expect(result.status).toBe(500);
    expect(result.error).toMatch(/failed/i);
  });
});

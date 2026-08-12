import { describe, expect, it } from "vitest";
import {
  buildTtsAttempts,
  resolveTtsLanguage,
} from "@/lib/speech/ttsLanguage";

describe("resolveTtsLanguage", () => {
  it("detects Hebrew from answer text even when sticky preference is English", () => {
    const detected = resolveTtsLanguage(
      "באזור ניו אינגלנד, בוסטון מוביל עם ביקוש גבוה.",
      "en-US",
    );
    expect(detected.iso639).toBe("he");
  });

  it("keeps English for Latin answers", () => {
    const detected = resolveTtsLanguage(
      "Boston leads New England on expansion opportunity.",
      "he-IL",
    );
    expect(detected.iso639).toBe("en");
  });
});

describe("buildTtsAttempts", () => {
  it("forces flash/turbo with language_code before multilingual for Hebrew", () => {
    const attempts = buildTtsAttempts({
      configuredModel: "eleven_multilingual_v2",
      language: "he",
    });
    expect(attempts[0]).toEqual({
      modelId: "eleven_flash_v2_5",
      language: "he",
    });
    expect(attempts.some((a) => a.modelId === "eleven_turbo_v2_5")).toBe(true);
  });
});

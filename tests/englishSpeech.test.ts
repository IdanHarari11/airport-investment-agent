import { describe, expect, it } from "vitest";
import {
  isEnglishSpeechText,
  isRtlLanguage,
  textDirection,
} from "@/lib/speech/language";

describe("isEnglishSpeechText", () => {
  it("returns true for English answers", () => {
    expect(
      isEnglishSpeechText(
        "Boston leads New England on expansion opportunity.",
      ),
    ).toBe(true);
  });

  it("returns false for Hebrew answers", () => {
    expect(
      isEnglishSpeechText("באזור ניו אינגלנד, בוסטון מוביל עם ביקוש גבוה."),
    ).toBe(false);
  });

  it("returns false for mixed Hebrew answers that include IATA codes", () => {
    expect(
      isEnglishSpeechText(
        "BOS מוביל את New England עם ציון גבוה יחסית ל-PVD.",
      ),
    ).toBe(false);
  });
});

describe("RTL helpers", () => {
  it("detects Hebrew as rtl", () => {
    expect(isRtlLanguage("שלום עולם")).toBe(true);
    expect(textDirection("שלום עולם")).toBe("rtl");
  });

  it("detects English as ltr", () => {
    expect(isRtlLanguage("Hello world")).toBe(false);
    expect(textDirection("Hello world")).toBe("ltr");
  });

  it("treats he-IL preference as rtl", () => {
    expect(isRtlLanguage("he-IL")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { getDataCurrencySummary } from "../src/lib/aviation/dataCurrency";
import { buildSystemPrompt } from "../src/lib/agent/prompt";

describe("dataCurrency", () => {
  it("exposes generatedAt and source periods from dataset.json", () => {
    const summary = getDataCurrencySummary();
    expect(summary.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(summary.sources.length).toBeGreaterThan(0);
    expect(summary.brief).toContain(summary.generatedAt);
    expect(summary.assumptionLines.length).toBeGreaterThan(0);
  });

  it("injects currency into the system prompt", () => {
    const prompt = buildSystemPrompt("Loaded public-data window TEST_CURRENCY");
    expect(prompt).toContain("Loaded data currency");
    expect(prompt).toContain("TEST_CURRENCY");
  });
});

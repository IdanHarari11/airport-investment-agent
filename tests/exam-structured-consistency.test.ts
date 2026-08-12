/**
 * Deterministic structured consistency for the four brief exam questions
 * (no LLM — exercises scoring / analytics / merge paths the UI relies on).
 */
import { describe, expect, it } from "vitest";
import { ToolMessage } from "@langchain/core/messages";
import { calculateLongHaulStats } from "@/lib/analytics/longHaul";
import { calculateCongestion } from "@/lib/analytics/congestion";
import { estimateUnmetDemand } from "@/lib/analytics/unmetDemand";
import { createAviationDataProvider } from "@/lib/aviation/provider";
import { mergeAirportsFromToolMessages } from "@/lib/agent/mergeToolResults";
import { applyDeterministicConfidence } from "@/lib/agent/confidence";
import type { AgentResponse } from "@/lib/agent/types";
import { rankAirports } from "@/lib/scoring/rank";
import { buildRegionalScreeningCohort } from "@/lib/scoring/regionalCohort";

function emptyResponse(): AgentResponse {
  return {
    answer: "placeholder",
    airports: null,
    congestion: null,
    longHaul: null,
    unmetDemand: null,
    assumptions: [],
    confidence: "high",
    sources: [],
  };
}

describe("exam structured consistency (deterministic)", () => {
  const provider = createAviationDataProvider();

  it("ANC long-haul share is stable across double compute", () => {
    const airport = provider.getAirport("ANC");
    expect(airport).toBeTruthy();
    const threshold = provider.getConfig().longHaulThresholdMiles;
    const a = calculateLongHaulStats(airport!, threshold);
    const b = calculateLongHaulStats(airport!, threshold);
    expect(a.longHaulShare).toEqual(b.longHaulShare);
    expect(a.longHaulShare).not.toBeNull();
    expect(a.longHaulShare!).toBeGreaterThan(0.2);
  });

  it("New England rank is deterministic with OTP filter and stable merge", () => {
    const cohort = buildRegionalScreeningCohort({
      provider,
      region: "New England",
    });
    const ranked = rankAirports(
      cohort.airports,
      undefined,
      cohort.regionLabel,
    );
    const rankedAgain = rankAirports(
      cohort.airports,
      undefined,
      cohort.regionLabel,
    );
    expect(ranked.length).toBeGreaterThanOrEqual(2);
    expect(ranked[0]?.score).not.toBeNull();
    expect(ranked[1]?.score).not.toBeNull();
    expect(ranked[0]!.score!).toBeGreaterThanOrEqual(ranked[1]!.score!);
    expect(ranked.map((r) => [r.airport, r.score])).toEqual(
      rankedAgain.map((r) => [r.airport, r.score]),
    );
    // Snapshot includes known New England commercial airports.
    expect(ranked.some((r) => r.airport === "BOS")).toBe(true);

    const toolJson = {
      ranked: ranked.slice(0, 5),
      cohortLabel: cohort.regionLabel,
    };
    const merged = applyDeterministicConfidence(
      mergeAirportsFromToolMessages(emptyResponse(), [
        new ToolMessage({
          content: JSON.stringify(toolJson),
          tool_call_id: "1",
          name: "rankAirports",
        }),
      ]),
    );
    expect(merged.airports?.[0]?.iata).toBe(ranked[0]?.airport);
    expect(merged.airports?.[1]?.iata).toBe(ranked[1]?.airport);
    expect(merged.confidence).not.toBe("low");
  });

  it("LAX vs SNA congestion cards stay numeric and labeled", () => {
    const lax = calculateCongestion(provider.getAirport("LAX")!);
    const sna = calculateCongestion(provider.getAirport("SNA")!);
    expect(lax.unavailable).toBe(false);
    expect(sna.unavailable).toBe(false);
    expect(lax.congestionScore).not.toBeNull();
    expect(sna.congestionScore).not.toBeNull();

    const merged = mergeAirportsFromToolMessages(emptyResponse(), [
      new ToolMessage({
        content: JSON.stringify({ results: [lax, sna] }),
        tool_call_id: "c",
        name: "getCongestionMetrics",
      }),
    ]);
    expect(merged.congestion?.map((r) => r.airport).sort()).toEqual([
      "LAX",
      "SNA",
    ]);
  });

  it("SFO unmet demand is labeled proxy and confidence stays honest", () => {
    const sfo = estimateUnmetDemand(provider.getAirport("SFO")!);
    expect(sfo.label).toMatch(/Proxy/i);
    const merged = applyDeterministicConfidence(
      mergeAirportsFromToolMessages(emptyResponse(), [
        new ToolMessage({
          content: JSON.stringify({ results: [sfo] }),
          tool_call_id: "u",
          name: "estimateUnmetDemand",
        }),
      ]),
    );
    expect(merged.unmetDemand?.[0]?.label).toMatch(/Proxy/i);
    expect(merged.confidence).toBe("medium");
  });
});

import { describe, expect, it } from "vitest";
import {
  applyDeterministicConfidence,
  computeDeterministicConfidence,
} from "../src/lib/agent/confidence";
import type { AgentResponse } from "../src/lib/agent/types";

function airport(
  iata: string,
  components: NonNullable<
    NonNullable<AgentResponse["airports"]>[number]["components"]
  >,
): NonNullable<AgentResponse["airports"]>[number] {
  return {
    iata,
    name: iata,
    rank: 1,
    score: 70,
    cohortLabel: "Test cohort (1 airport)",
    cohortSize: 1,
    components,
    metrics: null,
  };
}

describe("computeDeterministicConfidence", () => {
  it("returns high when top results have complete components", () => {
    const result = computeDeterministicConfidence([
      airport("BOS", {
        capacityPressure: 80,
        passengerGrowth: 60,
        congestionPressure: 90,
        marketScale: 95,
        routeOpportunity: 40,
      }),
    ]);
    expect(result.confidence).toBe("high");
    expect(result.reason).toMatch(
      /all required scoring components are available for the top-ranked airports/i,
    );
  });

  it("returns medium when congestion is missing for a top airport", () => {
    const result = computeDeterministicConfidence([
      airport("HVN", {
        capacityPressure: 80,
        passengerGrowth: 90,
        congestionPressure: null,
        marketScale: 30,
        routeOpportunity: 20,
      }),
    ]);
    expect(result.confidence).toBe("medium");
    expect(result.reason).toMatch(/Medium/i);
  });

  it("returns low when multiple critical components are missing", () => {
    const result = computeDeterministicConfidence([
      airport("AAA", {
        capacityPressure: null,
        passengerGrowth: null,
        congestionPressure: null,
        marketScale: 10,
        routeOpportunity: null,
      }),
    ]);
    expect(result.confidence).toBe("low");
  });
});

describe("applyDeterministicConfidence insight-only", () => {
  it("caps proxy-only answers at medium", () => {
    const result = applyDeterministicConfidence({
      answer: "Proxy discussion",
      airports: null,
      congestion: null,
      longHaul: null,
      unmetDemand: [
        {
          airport: "SFO",
          label: "Estimated Unmet Demand Proxy",
          proxyScore: 61,
          classification: "elevated",
          loadFactor: 0.84,
          passengerGrowthPct: 4,
          congestionScore: 50,
          caveats: ["Proxy only"],
        },
      ],
      assumptions: [],
      confidence: "high",
      sources: [],
    });
    expect(result.confidence).toBe("medium");
    expect(result.assumptions[0]).toMatch(/Proxy/i);
  });
});

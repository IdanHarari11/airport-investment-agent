import { describe, expect, it } from "vitest";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import {
  enrichAgentResponse,
  mergeAirportsFromToolMessages,
} from "@/lib/agent/mergeToolResults";
import type { AgentResponse } from "@/lib/agent/types";

const baseResponse = (): AgentResponse => ({
  answer: "Thesis text from the model.",
  airports: [
    {
      iata: "FAKE",
      name: "Invented",
      rank: 1,
      score: 99,
      components: {
        capacityPressure: 99,
        passengerGrowth: 99,
        congestionPressure: 99,
        marketScale: 99,
        routeOpportunity: 99,
      },
      metrics: null,
      cohortLabel: null,
      cohortSize: null,
    },
  ],
  congestion: null,
  longHaul: null,
  unmetDemand: null,
  assumptions: [],
  confidence: "high",
  sources: [],
});

describe("mergeAirportsFromToolMessages", () => {
  it("replaces LLM airports with deterministic rankAirports tool scores", () => {
    const toolPayload = {
      region: "New England",
      count: 2,
      ranked: [
        {
          airport: "BOS",
          name: "Boston Logan",
          rank: 1,
          score: 72.5,
          components: {
            capacityPressure: 60,
            passengerGrowth: 40,
            congestionPressure: 80,
            marketScale: 90,
            routeOpportunity: 50,
          },
          metrics: {
            enplanementsCy2024: 20_000_000,
            enplanementGrowthPct: 3.1,
            loadFactor: 0.82,
            depDelay15Rate: 0.2,
            cancellationRate: 0.01,
            longHaulDepartureShare: 0.15,
            avgDepDelayMinutes: 12,
          },
          cohortLabel: "New England (2 airports)",
          cohortSize: 2,
        },
      ],
      sources: [
        {
          name: "FAA",
          url: "https://www.faa.gov",
          period: "CY2024",
          notes: null,
        },
      ],
      assumptions: ["Min enplanements applied."],
    };

    const merged = mergeAirportsFromToolMessages(baseResponse(), [
      new HumanMessage("rank NE"),
      new AIMessage({ content: "", tool_calls: [] }),
      new ToolMessage({
        content: JSON.stringify(toolPayload),
        tool_call_id: "1",
        name: "rankAirports",
      }),
    ]);

    expect(merged.airports).toHaveLength(1);
    expect(merged.airports?.[0]?.iata).toBe("BOS");
    expect(merged.airports?.[0]?.score).toBe(72.5);
    expect(merged.airports?.[0]?.cohortLabel).toBe("New England (2 airports)");
    expect(merged.airports?.[0]?.cohortSize).toBe(2);
    expect(merged.assumptions).toContain("Min enplanements applied.");
    expect(merged.sources?.[0]?.name).toBe("FAA");
  });

  it("builds long-haul insight cards and drops empty LLM airport shells", () => {
    const llmShell: AgentResponse = {
      ...baseResponse(),
      airports: [
        {
          iata: "ANC",
          name: "Ted Stevens Anchorage International",
          rank: null,
          score: null,
          components: null,
          metrics: null,
          cohortLabel: null,
          cohortSize: null,
        },
      ],
      confidence: "medium",
    };

    const merged = mergeAirportsFromToolMessages(llmShell, [
      new ToolMessage({
        content: JSON.stringify({
          results: [
            {
              airport: "ANC",
              longHaulShare: 0.309276,
              thresholdMiles: 1500,
              definition: "Long-haul = distance >= 1500 miles",
              source: "t100",
              period: "2024-12",
            },
          ],
          sources: [
            {
              name: "BTS T-100",
              url: "https://example.com",
              period: "2024-12",
              notes: null,
            },
          ],
        }),
        tool_call_id: "3",
        name: "getLongHaulStats",
      }),
    ]);

    expect(merged.airports).toBeNull();
    expect(merged.longHaul).toHaveLength(1);
    expect(merged.longHaul?.[0]?.airport).toBe("ANC");
    expect(merged.longHaul?.[0]?.longHaulShare).toBeCloseTo(0.309276);
    expect(merged.sources?.[0]?.name).toBe("BTS T-100");
  });

  it("builds congestion and unmet-demand insight cards from tools", () => {
    const merged = mergeAirportsFromToolMessages(baseResponse(), [
      new ToolMessage({
        content: JSON.stringify({
          results: [
            {
              airport: "LAX",
              congestionScore: 72.1,
              signals: {
                depDelay15Rate: 0.22,
                cancellationRate: 0.02,
                avgDepDelayMinutes: 14,
              },
              period: "2024-12",
              unavailable: false,
            },
          ],
        }),
        tool_call_id: "c1",
        name: "getCongestionMetrics",
      }),
      new ToolMessage({
        content: JSON.stringify({
          label: "Estimated Unmet Demand Proxy",
          results: [
            {
              airport: "SFO",
              label: "Estimated Unmet Demand Proxy",
              proxyScore: 61.2,
              classification: "elevated",
              signals: {
                loadFactor: 0.84,
                passengerGrowthPct: 4.2,
                congestionScore: 55,
              },
              caveats: ["Proxy only — not official unmet demand."],
            },
          ],
        }),
        tool_call_id: "u1",
        name: "estimateUnmetDemand",
      }),
    ]);

    expect(merged.airports).toBeNull();
    expect(merged.congestion?.[0]?.airport).toBe("LAX");
    expect(merged.congestion?.[0]?.congestionScore).toBe(72.1);
    expect(merged.unmetDemand?.[0]?.airport).toBe("SFO");
    expect(merged.unmetDemand?.[0]?.label).toMatch(/Proxy/i);
  });

  it("prefers compareAirports when no rank tool ran", () => {
    const toolPayload = {
      comparison: [
        {
          airport: "LAX",
          name: "Los Angeles",
          rank: 1,
          score: 66,
          components: {
            capacityPressure: 50,
            passengerGrowth: 50,
            congestionPressure: 70,
            marketScale: 80,
            routeOpportunity: 40,
          },
          metrics: {
            enplanementsCy2024: 30_000_000,
            enplanementGrowthPct: 1,
            loadFactor: 0.85,
            depDelay15Rate: 0.22,
            cancellationRate: 0.02,
            longHaulDepartureShare: 0.2,
            avgDepDelayMinutes: 14,
          },
          cohortLabel: "Explicit compare (2 airports)",
          cohortSize: 2,
        },
      ],
    };

    const merged = mergeAirportsFromToolMessages(baseResponse(), [
      new ToolMessage({
        content: JSON.stringify(toolPayload),
        tool_call_id: "2",
        name: "compareAirports",
      }),
    ]);

    expect(merged.airports?.[0]?.iata).toBe("LAX");
    expect(merged.airports?.[0]?.iata).not.toBe("FAKE");
  });
});

describe("mergeAirportsFromToolMessages precedence", () => {
  it("does not let getAirportMetrics clobber rankAirports cards", () => {
    const rankPayload = {
      ranked: [
        {
          airport: "BOS",
          name: "Boston Logan",
          rank: 1,
          score: 85.7,
          components: {
            capacityPressure: 70,
            passengerGrowth: 50,
            congestionPressure: 80,
            marketScale: 90,
            routeOpportunity: 40,
          },
          metrics: null,
          cohortLabel: "New England (8 airports)",
          cohortSize: 8,
        },
      ],
    };
    const metricsPayload = {
      score: {
        airport: "BOS",
        name: "Boston Logan",
        rank: 1,
        score: 11.1,
        components: {
          capacityPressure: 1,
          passengerGrowth: 1,
          congestionPressure: 1,
          marketScale: 1,
          routeOpportunity: 1,
        },
        metrics: null,
        cohortLabel: "Full curated dataset",
        cohortSize: 80,
      },
      congestion: {
        airport: "BOS",
        congestionScore: 50,
        signals: { depDelay15Rate: 0.1 },
        period: "2024-12",
        unavailable: false,
      },
    };

    const merged = mergeAirportsFromToolMessages(baseResponse(), [
      new ToolMessage({
        content: JSON.stringify(rankPayload),
        tool_call_id: "r1",
        name: "rankAirports",
      }),
      new ToolMessage({
        content: JSON.stringify(metricsPayload),
        tool_call_id: "m1",
        name: "getAirportMetrics",
      }),
    ]);

    expect(merged.airports?.[0]?.score).toBe(85.7);
    expect(merged.airports?.[0]?.cohortLabel).toBe("New England (8 airports)");
    // Bundled insights from metrics are skipped when rank/compare ran.
    expect(merged.congestion).toBeNull();
  });
});

describe("enrichAgentResponse", () => {
  it("injects sources when empty, and scoring assumptions only with score cards", () => {
    const soft = enrichAgentResponse({
      answer: "Soft reply",
      airports: null,
      congestion: null,
      longHaul: null,
      unmetDemand: null,
      assumptions: [],
      confidence: "medium",
      sources: [],
    });
    expect(soft.sources.length).toBeGreaterThan(0);
    expect(
      soft.assumptions.some((item) => item.includes("percentile ranks")),
    ).toBe(false);

    const scored = enrichAgentResponse({
      ...baseResponse(),
      assumptions: [],
      sources: [],
    });
    expect(
      scored.assumptions.some((item) => item.includes("percentile ranks")),
    ).toBe(true);
    expect(
      scored.assumptions.some(
        (item) =>
          item.includes("Loaded public-data window") ||
          item.includes("snapshot generated"),
      ),
    ).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  minMaxNormalize,
  percentileRank,
} from "@/lib/analytics/normalize";
import { calculateLongHaulStats } from "@/lib/analytics/longHaul";
import { estimateUnmetDemand } from "@/lib/analytics/unmetDemand";
import { makeAirport } from "./fixtures";

describe("normalization", () => {
  it("handles identical values", () => {
    expect(percentileRank(5, [5, 5, 5])).toBe(50);
    expect(minMaxNormalize(5, [5, 5, 5])).toBe(50);
  });

  it("handles zeros and extremes", () => {
    expect(percentileRank(0, [0, 10, 20])).toBeLessThan(50);
    expect(minMaxNormalize(0, [0, 10])).toBe(0);
    expect(minMaxNormalize(10, [0, 10])).toBe(100);
  });

  it("returns null for missing values", () => {
    expect(percentileRank(null, [1, 2, 3])).toBeNull();
    expect(minMaxNormalize(undefined, [1, 2, 3])).toBeNull();
  });
});

describe("long-haul calculation", () => {
  it("uses configured threshold and percentage from T-100", () => {
    const airport = makeAirport({
      iata: "ANC",
      traffic: {
        period: "2024-12",
        passengers: 100,
        seats: 120,
        loadFactor: 0.83,
        departuresPerformed: 100,
        departuresScheduled: 100,
        performanceRatio: 1,
        longHaulDepartures: 25,
        longHaulDepartureShare: 0.25,
        avgDistanceMiles: 1400,
        longHaulThresholdMiles: 1500,
      },
    });
    const result = calculateLongHaulStats(airport, 1500);
    expect(result.thresholdMiles).toBe(1500);
    expect(result.longHaulShare).toBe(0.25);
    expect(result.definition).toContain("1500");
    expect(result.source).toBe("t100");
  });
});

describe("estimated unmet demand proxy", () => {
  it("labels output as a proxy and is deterministic", () => {
    const airport = makeAirport({
      iata: "SFO",
      enplanementGrowthPct: 8,
      traffic: {
        period: "2024-12",
        passengers: 200_000,
        seats: 230_000,
        loadFactor: 0.87,
        departuresPerformed: 2000,
        departuresScheduled: 2000,
        performanceRatio: 1,
        longHaulDepartures: 700,
        longHaulDepartureShare: 0.35,
        avgDistanceMiles: 1200,
        longHaulThresholdMiles: 1500,
      },
    });
    const a = estimateUnmetDemand(airport);
    const b = estimateUnmetDemand(airport);
    expect(a).toEqual(b);
    expect(a.label).toBe("Estimated Unmet Demand Proxy");
    expect(a.proxyScore).not.toBeNull();
    expect(a.caveats.some((c) => c.toLowerCase().includes("proxy"))).toBe(true);
  });

  it("returns unavailable classification when signals are missing", () => {
    const airport = makeAirport({
      iata: "XXX",
      enplanementGrowthPct: null,
      traffic: null,
      onTime: null,
    });
    const result = estimateUnmetDemand(airport);
    expect(result.proxyScore).toBeNull();
    expect(result.classification).toBe("unavailable");
  });
});

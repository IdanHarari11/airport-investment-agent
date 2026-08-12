import { describe, expect, it } from "vitest";
import { scoreAirport } from "@/lib/scoring/score";
import { makeAirport } from "./fixtures";

describe("capacityPressure (no growth double-count)", () => {
  it("gives equal capacityPressure when load factor matches, regardless of growth", () => {
    const highGrowth = makeAirport({
      iata: "HIG",
      enplanementGrowthPct: 25,
      traffic: {
        period: "2024-12",
        passengers: 100_000,
        seats: 120_000,
        loadFactor: 0.8,
        departuresPerformed: 1000,
        departuresScheduled: 1010,
        performanceRatio: 0.99,
        longHaulDepartures: 100,
        longHaulDepartureShare: 0.1,
        avgDistanceMiles: 800,
        longHaulThresholdMiles: 1500,
      },
    });
    const lowGrowth = makeAirport({
      iata: "LOW",
      enplanementGrowthPct: -5,
      traffic: {
        period: "2024-12",
        passengers: 100_000,
        seats: 120_000,
        loadFactor: 0.8,
        departuresPerformed: 1000,
        departuresScheduled: 1010,
        performanceRatio: 0.99,
        longHaulDepartures: 100,
        longHaulDepartureShare: 0.1,
        avgDistanceMiles: 800,
        longHaulThresholdMiles: 1500,
      },
    });
    const cohort = [highGrowth, lowGrowth];

    const high = scoreAirport({ airport: highGrowth, cohort });
    const low = scoreAirport({ airport: lowGrowth, cohort });

    expect(high.components.capacityPressure).toEqual(
      low.components.capacityPressure,
    );
    expect(high.components.passengerGrowth).toBeGreaterThan(
      low.components.passengerGrowth!,
    );
  });

  it("marks capacityPressure unavailable when load factor is missing", () => {
    const airport = makeAirport({
      iata: "NOLF",
      traffic: null,
      enplanementGrowthPct: 20,
    });
    const scored = scoreAirport({ airport, cohort: [airport] });
    expect(scored.components.capacityPressure).toBeNull();
    expect(scored.unavailableComponents).toContain("capacityPressure");
  });
});

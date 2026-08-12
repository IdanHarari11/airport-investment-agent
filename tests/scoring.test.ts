import { describe, expect, it } from "vitest";
import { scoreAirport } from "@/lib/scoring/score";
import { rankAirports } from "@/lib/scoring/rank";
import { DEFAULT_SCORING_WEIGHTS } from "@/lib/scoring/weights";
import { fixtureDataset, makeAirport } from "./fixtures";

describe("scoreAirport", () => {
  it("is deterministic for identical inputs", () => {
    const cohort = fixtureDataset.airports;
    const airport = cohort[0];
    const a = scoreAirport({ airport, cohort });
    const b = scoreAirport({ airport, cohort });
    expect(a).toEqual(b);
  });

  it("respects component weights totaling 1", () => {
    const sum = Object.values(DEFAULT_SCORING_WEIGHTS).reduce(
      (acc, value) => acc + value,
      0,
    );
    expect(sum).toBeCloseTo(1, 8);
  });

  it("does not coerce missing values to zero in a way that fabricates a score component", () => {
    const airport = makeAirport({
      iata: "ZZZ",
      enplanementGrowthPct: null,
      traffic: null,
      onTime: null,
    });
    const cohort = [airport, ...fixtureDataset.airports];
    const scored = scoreAirport({ airport, cohort });
    expect(scored.components.passengerGrowth).toBeNull();
    expect(scored.components.congestionPressure).toBeNull();
    expect(scored.unavailableComponents).toEqual(
      expect.arrayContaining(["passengerGrowth", "congestionPressure"]),
    );
  });

  it("keeps scores within 0-100 when available", () => {
    for (const airport of fixtureDataset.airports) {
      const scored = scoreAirport({
        airport,
        cohort: fixtureDataset.airports,
      });
      if (scored.score != null) {
        expect(scored.score).toBeGreaterThanOrEqual(0);
        expect(scored.score).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe("rankAirports", () => {
  it("ranks higher-pressure airports above lower-pressure peers", () => {
    const ranked = rankAirports(fixtureDataset.airports);
    expect(ranked[0].airport).toBe("AAA");
    expect(ranked.map((r) => r.airport)).toContain("BBB");
    expect(ranked.find((r) => r.airport === "AAA")!.rank).toBeLessThan(
      ranked.find((r) => r.airport === "BBB")!.rank,
    );
  });

  it("is deterministic including tie-breaking", () => {
    const a = rankAirports(fixtureDataset.airports);
    const b = rankAirports(fixtureDataset.airports);
    expect(a).toEqual(b);
  });
});

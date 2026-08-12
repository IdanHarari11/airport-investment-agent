import { describe, expect, it } from "vitest";
import { calculateCongestion } from "@/lib/analytics/congestion";
import { makeAirport } from "./fixtures";

describe("calculateCongestion missing rates", () => {
  it("does not treat null OTP rates as zero", () => {
    const airport = makeAirport({
      iata: "TEST",
      onTime: {
        period: "2024-12",
        flightCount: 100,
        cancellationRate: null,
        depDelay15Rate: null,
        arrDelay15Rate: null,
        avgDepDelayMinutes: null,
        avgArrDelayMinutes: null,
        longHaulDepartures: 0,
        longHaulDepartureShare: null,
        avgDistanceMiles: null,
        longHaulThresholdMiles: 1500,
      },
    });

    const result = calculateCongestion(airport);
    expect(result.congestionScore).toBeNull();
    expect(result.unavailable).toBe(true);
    expect(result.signals.depDelay15Rate).toBeNull();
    expect(result.signals.cancellationRate).toBeNull();
  });

  it("excludes only missing fields from the blend", () => {
    const airport = makeAirport({
      iata: "PARTIAL",
      onTime: {
        period: "2024-12",
        flightCount: 100,
        cancellationRate: 0.02,
        depDelay15Rate: 0.2,
        arrDelay15Rate: null,
        avgDepDelayMinutes: 12,
        avgArrDelayMinutes: null,
        longHaulDepartures: 0,
        longHaulDepartureShare: null,
        avgDistanceMiles: null,
        longHaulThresholdMiles: 1500,
      },
    });

    const result = calculateCongestion(airport);
    expect(result.congestionScore).not.toBeNull();
    expect(result.signals.arrDelay15Rate).toBeNull();
    expect(result.notes.some((n) => n.includes("missing"))).toBe(true);
  });
});

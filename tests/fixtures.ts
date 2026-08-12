import type { AirportRecord, AviationDataset } from "@/lib/aviation/types";

export function makeAirport(
  overrides: Partial<AirportRecord> & Pick<AirportRecord, "iata">,
): AirportRecord {
  return {
    iata: overrides.iata,
    name: overrides.name ?? `${overrides.iata} Airport`,
    city: overrides.city !== undefined ? overrides.city : "Test City",
    state: overrides.state !== undefined ? overrides.state : "MA",
    region: overrides.region ?? "New England",
    hub: overrides.hub !== undefined ? overrides.hub : "M",
    serviceLevel:
      overrides.serviceLevel !== undefined ? overrides.serviceLevel : "P",
    enplanementsCy2024:
      overrides.enplanementsCy2024 !== undefined
        ? overrides.enplanementsCy2024
        : 1_000_000,
    enplanementsCy2023:
      overrides.enplanementsCy2023 !== undefined
        ? overrides.enplanementsCy2023
        : 900_000,
    enplanementGrowthPct:
      overrides.enplanementGrowthPct !== undefined
        ? overrides.enplanementGrowthPct
        : 10,
    faaRankCy2024:
      overrides.faaRankCy2024 !== undefined ? overrides.faaRankCy2024 : 50,
    traffic:
      overrides.traffic !== undefined
        ? overrides.traffic
        : {
            period: "2024-12",
            passengers: 100_000,
            seats: 120_000,
            loadFactor: 0.83,
            departuresPerformed: 1000,
            departuresScheduled: 1010,
            performanceRatio: 0.99,
            longHaulDepartures: 200,
            longHaulDepartureShare: 0.2,
            avgDistanceMiles: 900,
            longHaulThresholdMiles: 1500,
          },
    onTime:
      overrides.onTime !== undefined
        ? overrides.onTime
        : {
            period: "2024-12",
            flightCount: 1000,
            cancellationRate: 0.01,
            depDelay15Rate: 0.2,
            arrDelay15Rate: 0.18,
            avgDepDelayMinutes: 12,
            avgArrDelayMinutes: 8,
            longHaulDepartures: 200,
            longHaulDepartureShare: 0.2,
            avgDistanceMiles: 900,
            longHaulThresholdMiles: 1500,
          },
  };
}

export const fixtureDataset: AviationDataset = {
  meta: {
    sources: [{ name: "Fixture source", period: "test" }],
    generatedAt: "2026-08-12",
  },
  config: {
    longHaulThresholdMiles: 1500,
    scoringWeights: {
      capacityPressure: 0.3,
      passengerGrowth: 0.25,
      congestionPressure: 0.2,
      marketScale: 0.15,
      routeOpportunity: 0.1,
    },
  },
  airports: [
    makeAirport({
      iata: "AAA",
      enplanementsCy2024: 5_000_000,
      enplanementGrowthPct: 12,
      traffic: {
        period: "2024-12",
        passengers: 400_000,
        seats: 450_000,
        loadFactor: 0.89,
        departuresPerformed: 3000,
        departuresScheduled: 3050,
        performanceRatio: 0.98,
        longHaulDepartures: 900,
        longHaulDepartureShare: 0.3,
        avgDistanceMiles: 1100,
        longHaulThresholdMiles: 1500,
      },
      onTime: {
        period: "2024-12",
        flightCount: 3000,
        cancellationRate: 0.02,
        depDelay15Rate: 0.28,
        arrDelay15Rate: 0.26,
        avgDepDelayMinutes: 18,
        avgArrDelayMinutes: 12,
        longHaulDepartures: 900,
        longHaulDepartureShare: 0.3,
        avgDistanceMiles: 1100,
        longHaulThresholdMiles: 1500,
      },
    }),
    makeAirport({
      iata: "BBB",
      enplanementsCy2024: 1_000_000,
      enplanementGrowthPct: 2,
      traffic: {
        period: "2024-12",
        passengers: 80_000,
        seats: 120_000,
        loadFactor: 0.67,
        departuresPerformed: 800,
        departuresScheduled: 810,
        performanceRatio: 0.99,
        longHaulDepartures: 40,
        longHaulDepartureShare: 0.05,
        avgDistanceMiles: 500,
        longHaulThresholdMiles: 1500,
      },
      onTime: {
        period: "2024-12",
        flightCount: 800,
        cancellationRate: 0.005,
        depDelay15Rate: 0.1,
        arrDelay15Rate: 0.09,
        avgDepDelayMinutes: 4,
        avgArrDelayMinutes: 1,
        longHaulDepartures: 40,
        longHaulDepartureShare: 0.05,
        avgDistanceMiles: 500,
        longHaulThresholdMiles: 1500,
      },
    }),
    makeAirport({
      iata: "CCC",
      enplanementsCy2024: 2_500_000,
      enplanementGrowthPct: 7,
    }),
  ],
};

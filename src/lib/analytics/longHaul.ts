import type { AirportRecord, LongHaulResult } from "../aviation/types";

export const DEFAULT_LONG_HAUL_THRESHOLD_MILES = 1500;

export function getLongHaulDefinition(thresholdMiles: number): string {
  return `Long-haul = nonstop route distance >= ${thresholdMiles} miles (project definition for US network analysis; not an official BTS category).`;
}

/**
 * Prefer T-100 departure-weighted share; fall back to OTP flight counts.
 */
export function calculateLongHaulStats(
  airport: AirportRecord,
  thresholdMiles: number = DEFAULT_LONG_HAUL_THRESHOLD_MILES,
): LongHaulResult {
  const definition = getLongHaulDefinition(thresholdMiles);

  if (airport.traffic?.longHaulDepartureShare != null) {
    return {
      airport: airport.iata,
      thresholdMiles,
      definition,
      longHaulDepartures: airport.traffic.longHaulDepartures,
      totalDepartures: airport.traffic.departuresPerformed,
      longHaulShare: airport.traffic.longHaulDepartureShare,
      source: "t100",
      period: airport.traffic.period,
    };
  }

  if (airport.onTime?.longHaulDepartureShare != null) {
    return {
      airport: airport.iata,
      thresholdMiles,
      definition,
      longHaulDepartures: airport.onTime.longHaulDepartures,
      totalDepartures: airport.onTime.flightCount,
      longHaulShare: airport.onTime.longHaulDepartureShare,
      source: "otp",
      period: airport.onTime.period,
    };
  }

  return {
    airport: airport.iata,
    thresholdMiles,
    definition,
    longHaulDepartures: null,
    totalDepartures: null,
    longHaulShare: null,
    source: "none",
    period: null,
  };
}

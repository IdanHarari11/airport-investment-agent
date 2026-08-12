import type { AirportRecord } from "../aviation/types";

/** Drop airports lacking OTP coverage (used for regional screens). */
export function excludeMissingOtpCoverage(airports: AirportRecord[]): {
  kept: AirportRecord[];
  excludedCount: number;
} {
  const kept = airports.filter((airport) => airport.onTime != null);
  return {
    kept,
    excludedCount: airports.length - kept.length,
  };
}

import type { AirportRecord } from "../aviation/types";
import { normalizeRegionName } from "../aviation/regions";
import type { LocalAviationDataProvider } from "../aviation/provider";
import { excludeMissingOtpCoverage } from "./regionalFilter";

/** Default commercial screen for regional rankings (CY2024 enplanements). */
export const DEFAULT_REGIONAL_MIN_ENPLANEMENTS = 250_000;

export type RegionalCohortResult = {
  airports: AirportRecord[];
  regionLabel: string;
  assumptions: string[];
  error: string | null;
};

/**
 * Build the same regional screening cohort used by rankAirports / regional compare:
 * region resolve → min enplanements → drop missing OTP.
 */
export function buildRegionalScreeningCohort(params: {
  provider: LocalAviationDataProvider;
  region: string;
  minEnplanements?: number;
}): RegionalCohortResult {
  const normalized = normalizeRegionName(params.region);
  if (!normalized) {
    return {
      airports: [],
      regionLabel: "",
      assumptions: [],
      error: `Unknown region '${params.region}'.`,
    };
  }

  const threshold =
    params.minEnplanements ?? DEFAULT_REGIONAL_MIN_ENPLANEMENTS;
  const assumptions: string[] = [];
  let airports = params.provider.getAirportsByRegion(normalized);

  if (threshold > 0) {
    const before = airports.length;
    airports = airports.filter(
      (airport) => (airport.enplanementsCy2024 ?? 0) >= threshold,
    );
    assumptions.push(
      `Regional/commercial screening applies a minimum CY2024 enplanement threshold of ${threshold.toLocaleString()} (excluded ${before - airports.length} smaller airports).`,
    );
  }

  const { kept, excludedCount } = excludeMissingOtpCoverage(airports);
  if (excludedCount > 0) {
    assumptions.push(
      `Excluded ${excludedCount} airport${excludedCount === 1 ? "" : "s"} lacking OTP coverage from regional ranking.`,
    );
  }

  return {
    airports: kept,
    regionLabel: `${normalized} (${kept.length} airports)`,
    assumptions,
    error: null,
  };
}

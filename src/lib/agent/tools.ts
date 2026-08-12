import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createAviationDataProvider } from "../aviation/provider";
import { NEW_ENGLAND_STATES, normalizeRegionName } from "../aviation/regions";
import { getDataCurrencySummary } from "../aviation/dataCurrency";
import { calculateCongestion } from "../analytics/congestion";
import { calculateLongHaulStats } from "../analytics/longHaul";
import { estimateUnmetDemand } from "../analytics/unmetDemand";
import { compareAirports, rankAirports } from "../scoring/rank";
import {
  buildRegionalScreeningCohort,
  DEFAULT_REGIONAL_MIN_ENPLANEMENTS,
} from "../scoring/regionalCohort";
import { excludeMissingOtpCoverage } from "../scoring/regionalFilter";
import { scoreAirport } from "../scoring/score";

function provider() {
  return createAviationDataProvider();
}

type SourceFilter = "all" | "otp" | "longHaul" | "scoring" | "coverage";

function filterSources(
  sources: ReturnType<ReturnType<typeof provider>["getSources"]>,
  kind: SourceFilter,
) {
  if (kind === "all" || kind === "coverage" || kind === "scoring") {
    return sources;
  }
  return sources.filter((source) => {
    const name = (source.name ?? "").toLowerCase();
    if (kind === "otp") {
      return name.includes("on-time") || name.includes("otp");
    }
    // Long-haul share is computed from T-100 segment / OTP distance fields in the ingest cache.
    return (
      name.includes("t-100") ||
      name.includes("on-time") ||
      name.includes("otp")
    );
  });
}

function sourcesPayload(
  extraAssumptions: string[] = [],
  sourceFilter: SourceFilter = "all",
) {
  const p = provider();
  const provenance = p.getProvenance();
  const currency = getDataCurrencySummary();
  return {
    sources: filterSources(p.getSources(), sourceFilter),
    config: p.getConfig(),
    assumptions: [...extraAssumptions, ...provenance.assumptions, ...currency.assumptionLines],
    dataCurrency: currency,
    dataProvenance: {
      t100Mode: provenance.t100Mode,
      facilitiesMode: provenance.facilitiesMode,
      otpMode: provenance.otpMode,
    },
  };
}

export const getAirportMetrics = tool(
  async ({ iata }) => {
    const p = provider();
    const airport = p.getAirport(iata);
    if (!airport) {
      return JSON.stringify({
        error: `Airport ${iata.toUpperCase()} not found in curated dataset.`,
        ...sourcesPayload(),
      });
    }
    const cohort = p.listAirports();
    const scored = scoreAirport({
      airport,
      cohort,
      cohortLabel: `Full curated dataset (${cohort.length} airports)`,
    });
    return JSON.stringify({
      airport,
      score: scored,
      congestion: calculateCongestion(airport),
      longHaul: calculateLongHaulStats(
        airport,
        p.getConfig().longHaulThresholdMiles,
      ),
      unmetDemandProxy: estimateUnmetDemand(airport),
      ...sourcesPayload(),
    });
  },
  {
    name: "getAirportMetrics",
    description:
      "Get structured metrics, deterministic expansion score components, congestion, long-haul share, and unmet-demand proxy for one airport IATA code (e.g. BOS, LAX).",
    schema: z.object({
      iata: z.string().describe("IATA airport code, e.g. BOS"),
    }),
  },
);

export const compareAirportsTool = tool(
  async ({ iataCodes, region }) => {
    const p = provider();
    const { found, missing } = p.resolveAirportCodes(iataCodes);
    if (found.length < 2) {
      return JSON.stringify({
        error:
          "Need at least two known airports to compare. Provide IATA codes.",
        missing,
        ...sourcesPayload(),
      });
    }

    // Regional cohort keeps percentiles aligned with a prior rankAirports call.
    if (region) {
      const cohort = buildRegionalScreeningCohort({ provider: p, region });
      if (cohort.error) {
        return JSON.stringify({ error: cohort.error, ...sourcesPayload() });
      }
      const rankedAll = rankAirports(
        cohort.airports,
        undefined,
        cohort.regionLabel,
      );
      const wanted = new Set(found.map((a) => a.iata.toUpperCase()));
      const comparison = rankedAll.filter((row) =>
        wanted.has(row.airport.toUpperCase()),
      );
      return JSON.stringify({
        comparison,
        cohortLabel: cohort.regionLabel,
        cohortSize: cohort.airports.length,
        missing,
        ...sourcesPayload([
          ...cohort.assumptions,
          `Scores use the ${cohort.regionLabel} regional cohort (same filters as rankAirports), not a 2-airport re-normalization.`,
        ]),
      });
    }

    const cohortLabel = `Explicit compare (${found.length} airports)`;
    const ranked = compareAirports(found, undefined, cohortLabel);
    return JSON.stringify({
      comparison: ranked,
      cohortLabel,
      cohortSize: found.length,
      missing,
      ...sourcesPayload([
        "Explicit compare renormalizes percentiles among only the listed airports — scores differ from regional rankings.",
      ]),
    });
  },
  {
    name: "compareAirports",
    description:
      "Compare two or more airports. Pass region (e.g. 'New England') when explaining a prior regional ranking so scores stay in that cohort. Omit region only for a fresh head-to-head (percentiles renormalize among the listed airports only).",
    schema: z.object({
      iataCodes: z
        .array(z.string())
        .min(2)
        .describe("List of IATA codes to compare, e.g. [\"LAX\",\"SNA\"]"),
      region: z
        .string()
        .nullable()
        .describe(
          "Optional region cohort for scoring (e.g. 'New England'). Use when explaining ranks from a regional screening.",
        ),
    }),
  },
);

export const rankAirportsTool = tool(
  async ({ region, states, iataCodes, limit, minEnplanements }) => {
    const p = provider();
    const assumptions: string[] = [];
    const selectedCodes = iataCodes?.filter(Boolean) ?? [];
    const selectedStates = states?.filter(Boolean) ?? [];

    let airports = p.listAirports();
    let cohortLabel = "";

    if (selectedCodes.length) {
      airports = p.resolveAirportCodes(selectedCodes).found;
      const threshold = minEnplanements ?? 0;
      if (threshold > 0) {
        const before = airports.length;
        airports = airports.filter(
          (airport) => (airport.enplanementsCy2024 ?? 0) >= threshold,
        );
        assumptions.push(
          `Explicit list screening applies a minimum CY2024 enplanement threshold of ${threshold.toLocaleString()} (excluded ${before - airports.length} airports).`,
        );
      }
      cohortLabel = `explicit IATA list (${airports.length} airports)`;
    } else if (region) {
      const cohort = buildRegionalScreeningCohort({
        provider: p,
        region,
        minEnplanements: minEnplanements ?? DEFAULT_REGIONAL_MIN_ENPLANEMENTS,
      });
      if (cohort.error) {
        return JSON.stringify({
          error: `${cohort.error} Supported aliases include 'New England', 'West', 'South', 'Midwest', 'Northeast', 'Mountain', 'Alaska'.`,
          ...sourcesPayload(),
        });
      }
      airports = cohort.airports;
      assumptions.push(...cohort.assumptions);
      cohortLabel = cohort.regionLabel;
    } else if (selectedStates.length) {
      airports = p.getAirportsByStates(selectedStates);
      const threshold =
        minEnplanements ?? DEFAULT_REGIONAL_MIN_ENPLANEMENTS;
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
      airports = kept;
      cohortLabel = `states ${selectedStates.join(", ")} (${airports.length} airports)`;
    } else {
      const threshold =
        minEnplanements ?? DEFAULT_REGIONAL_MIN_ENPLANEMENTS;
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
      airports = kept;
      cohortLabel = `Comparison cohort (${airports.length} airports)`;
    }

    if (airports.length === 0) {
      return JSON.stringify({
        error: "No airports matched the ranking filters.",
        newEnglandStates: NEW_ENGLAND_STATES,
        ...sourcesPayload(),
      });
    }

    const ranked = rankAirports(airports, undefined, cohortLabel).slice(
      0,
      limit ?? 10,
    );
    return JSON.stringify({
      region: region ? normalizeRegionName(region) : null,
      states: selectedStates.length ? selectedStates : null,
      count: airports.length,
      cohortLabel,
      cohortSize: airports.length,
      ranked,
      newEnglandStates: NEW_ENGLAND_STATES,
      ...sourcesPayload(assumptions),
    });
  },
  {
    name: "rankAirports",
    description:
      "Rank airports for terminal/capacity expansion opportunity. Filter by region (e.g. New England), US state codes, or an explicit IATA list. Uses deterministic scoring. Regional rankings exclude very small airports by default (min 250k CY2024 enplanements) so tiny seasonal fields do not dominate.",
    schema: z.object({
      region: z
        .string()
        .nullable()
        .describe("Region name such as 'New England', or null"),
      states: z
        .array(z.string())
        .nullable()
        .describe("US state codes, or null"),
      iataCodes: z
        .array(z.string())
        .nullable()
        .describe("Explicit airport list, or null"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .nullable()
        .describe("Max results to return (default 10), or null"),
      minEnplanements: z
        .number()
        .int()
        .min(0)
        .nullable()
        .describe(
          "Minimum CY2024 enplanements, or null for default (250000 regional / 0 explicit list).",
        ),
    }),
  },
);

export const getCongestionMetrics = tool(
  async ({ iataCodes }) => {
    const p = provider();
    const { found, missing } = p.resolveAirportCodes(iataCodes);
    const results = found.map((airport) => calculateCongestion(airport));
    return JSON.stringify({
      results,
      missing,
      ...sourcesPayload([], "otp"),
    });
  },
  {
    name: "getCongestionMetrics",
    description:
      "Get explainable congestion pressure metrics and underlying delay/cancellation signals for one or more airports.",
    schema: z.object({
      iataCodes: z.array(z.string()).min(1),
    }),
  },
);

export const getLongHaulStats = tool(
  async ({ iataCodes }) => {
    const p = provider();
    const threshold = p.getConfig().longHaulThresholdMiles;
    const { found, missing } = p.resolveAirportCodes(iataCodes);
    const results = found.map((airport) =>
      calculateLongHaulStats(airport, threshold),
    );
    return JSON.stringify({
      results,
      missing,
      ...sourcesPayload(
        [
          `Long-haul threshold is a fixed analytical assumption of ${threshold} miles (not chosen by the LLM).`,
        ],
        "longHaul",
      ),
    });
  },
  {
    name: "getLongHaulStats",
    description:
      "Get long-haul departure share for airports using the configured threshold. Always report the threshold definition.",
    schema: z.object({
      iataCodes: z.array(z.string()).min(1),
    }),
  },
);

export const estimateUnmetDemandTool = tool(
  async ({ iataCodes }) => {
    const p = provider();
    const { found, missing } = p.resolveAirportCodes(iataCodes);
    const results = found.map((airport) => estimateUnmetDemand(airport));
    return JSON.stringify({
      label: "Estimated Unmet Demand Proxy",
      results,
      missing,
      ...sourcesPayload(),
    });
  },
  {
    name: "estimateUnmetDemand",
    description:
      "Compute the Estimated Unmet Demand Proxy for airports. This is a proxy, not an official unmet-demand measurement.",
    schema: z.object({
      iataCodes: z.array(z.string()).min(1),
    }),
  },
);

export const listDatasetCoverage = tool(
  async ({ includeSampleAirports }) => {
    const p = provider();
    const config = p.getConfig();
    return JSON.stringify({
      airportCount: p.listAirports().length,
      regions: [...new Set(p.listAirports().map((a) => a.region))].sort(),
      newEnglandStates: NEW_ENGLAND_STATES,
      scoringWeights: config.scoringWeights,
      longHaulThresholdMiles: config.longHaulThresholdMiles,
      sampleAirports: includeSampleAirports
        ? p.listAirports().slice(0, 15).map((a) => a.iata)
        : [],
      ...sourcesPayload([], "coverage"),
    });
  },
  {
    name: "listDatasetCoverage",
    description:
      "List dataset coverage, dataCurrency (how fresh / through which periods), supported regions, exact scoringWeights, long-haul threshold, and sources. Required for methodology, weight, freshness, or assumptions questions — quote scoringWeights and dataCurrency periods from this tool, never invent them.",
    schema: z.object({
      includeSampleAirports: z
        .boolean()
        .describe("Whether to include a short sample IATA list"),
    }),
  },
);

export const agentTools = [
  getAirportMetrics,
  compareAirportsTool,
  rankAirportsTool,
  getCongestionMetrics,
  getLongHaulStats,
  estimateUnmetDemandTool,
  listDatasetCoverage,
];

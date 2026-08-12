import type {
  AirportRecord,
  AirportScore,
  ScoreComponents,
  ScoringWeights,
} from "../aviation/types";
import { calculateCongestion } from "../analytics/congestion";
import { percentileRank, weightedMean } from "../analytics/normalize";
import { DEFAULT_SCORING_WEIGHTS, assertWeightsSumToOne } from "./weights";

export type ScoreAirportInput = {
  airport: AirportRecord;
  cohort: AirportRecord[];
  weights?: ScoringWeights;
  /** Human-readable cohort scope shown on score cards (e.g. "New England"). */
  cohortLabel?: string;
};

/** Capacity / demand pressure uses load factor only (growth is a separate weight). */
function capacityPressureRaw(airport: AirportRecord): number | null {
  const lf = airport.traffic?.loadFactor;
  if (lf == null) return null;
  return Math.max(0, Math.min(100, ((lf - 0.65) / 0.3) * 100));
}

/**
 * Deterministic Expansion Opportunity Score.
 * Component scores are cohort-relative where noted; final score uses available weights only.
 */
export function scoreAirport(input: ScoreAirportInput): AirportScore {
  const weights = input.weights ?? DEFAULT_SCORING_WEIGHTS;
  assertWeightsSumToOne(weights);

  const { airport, cohort } = input;
  const congestion = calculateCongestion(airport);

  const capacityValues = cohort.map((a) => capacityPressureRaw(a));
  const growthValues = cohort.map((a) => a.enplanementGrowthPct);
  const congestionValues = cohort.map(
    (a) => calculateCongestion(a).congestionScore,
  );
  const marketValues = cohort.map((a) => a.enplanementsCy2024);
  const routeValues = cohort.map(
    (a) =>
      a.traffic?.longHaulDepartureShare ??
      a.onTime?.longHaulDepartureShare ??
      null,
  );

  const components: ScoreComponents = {
    capacityPressure: percentileRank(
      capacityPressureRaw(airport),
      capacityValues,
    ),
    passengerGrowth: percentileRank(airport.enplanementGrowthPct, growthValues),
    congestionPressure: percentileRank(
      congestion.congestionScore,
      congestionValues,
    ),
    marketScale: percentileRank(airport.enplanementsCy2024, marketValues),
    routeOpportunity: percentileRank(
      airport.traffic?.longHaulDepartureShare ??
        airport.onTime?.longHaulDepartureShare ??
        null,
      routeValues,
    ),
  };

  const unavailableComponents = Object.entries(components)
    .filter(([, v]) => v == null)
    .map(([k]) => k);

  const { score } = weightedMean([
    { weight: weights.capacityPressure, value: components.capacityPressure },
    { weight: weights.passengerGrowth, value: components.passengerGrowth },
    {
      weight: weights.congestionPressure,
      value: components.congestionPressure,
    },
    { weight: weights.marketScale, value: components.marketScale },
    { weight: weights.routeOpportunity, value: components.routeOpportunity },
  ]);

  const cohortSize = cohort.length;
  const cohortLabel =
    input.cohortLabel?.trim() ||
    `Comparison cohort (${cohortSize} airport${cohortSize === 1 ? "" : "s"})`;

  const assumptions = [
    `Scores are relative to the comparison cohort: ${cohortLabel}.`,
    "Capacity/demand pressure uses load factor only; passenger growth is a separate component.",
    "Weights are fixed configuration values and are not set by the LLM.",
    "Missing component values are excluded and remaining weights are renormalized.",
    "OTP/T-100 operational metrics use the monthly extract period recorded on each airport; enplanements are CY2023/CY2024 annual FAA totals.",
  ];

  return {
    airport: airport.iata,
    name: airport.name,
    city: airport.city,
    state: airport.state,
    region: airport.region,
    cohortLabel,
    cohortSize,
    score: score == null ? null : Math.round(score * 10) / 10,
    components: {
      capacityPressure:
        components.capacityPressure == null
          ? null
          : Math.round(components.capacityPressure * 10) / 10,
      passengerGrowth:
        components.passengerGrowth == null
          ? null
          : Math.round(components.passengerGrowth * 10) / 10,
      congestionPressure:
        components.congestionPressure == null
          ? null
          : Math.round(components.congestionPressure * 10) / 10,
      marketScale:
        components.marketScale == null
          ? null
          : Math.round(components.marketScale * 10) / 10,
      routeOpportunity:
        components.routeOpportunity == null
          ? null
          : Math.round(components.routeOpportunity * 10) / 10,
    },
    unavailableComponents,
    metrics: {
      enplanementsCy2024: airport.enplanementsCy2024,
      enplanementGrowthPct: airport.enplanementGrowthPct,
      loadFactor: airport.traffic?.loadFactor ?? null,
      depDelay15Rate: airport.onTime?.depDelay15Rate ?? null,
      cancellationRate: airport.onTime?.cancellationRate ?? null,
      longHaulDepartureShare:
        airport.traffic?.longHaulDepartureShare ??
        airport.onTime?.longHaulDepartureShare ??
        null,
      avgDepDelayMinutes: airport.onTime?.avgDepDelayMinutes ?? null,
    },
    assumptions,
  };
}

export function scoreAirports(
  airports: AirportRecord[],
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
  cohortLabel?: string,
): AirportScore[] {
  return airports.map((airport) =>
    scoreAirport({ airport, cohort: airports, weights, cohortLabel }),
  );
}

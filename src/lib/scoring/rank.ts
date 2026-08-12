import type { AirportRecord, AirportScore, ScoringWeights } from "../aviation/types";
import { scoreAirports } from "./score";
import { DEFAULT_SCORING_WEIGHTS } from "./weights";

export type RankedAirport = AirportScore & { rank: number };

/**
 * Deterministic ranking: higher score first; ties broken by IATA code for stability.
 */
export function rankAirports(
  airports: AirportRecord[],
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
  cohortLabel?: string,
): RankedAirport[] {
  const scored = scoreAirports(airports, weights, cohortLabel);

  const sorted = [...scored].sort((a, b) => {
    if (a.score == null && b.score == null) {
      return a.airport.localeCompare(b.airport);
    }
    if (a.score == null) return 1;
    if (b.score == null) return -1;
    if (b.score !== a.score) return b.score - a.score;
    return a.airport.localeCompare(b.airport);
  });

  return sorted.map((item, index) => ({ ...item, rank: index + 1 }));
}

export function compareAirports(
  airports: AirportRecord[],
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
  cohortLabel?: string,
): RankedAirport[] {
  return rankAirports(
    airports,
    weights,
    cohortLabel ??
      `Explicit compare (${airports.length} airport${airports.length === 1 ? "" : "s"})`,
  );
}

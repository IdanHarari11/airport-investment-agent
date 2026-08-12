import type { ScoringWeights } from "../aviation/types";

/**
 * Informed starting weights for terminal/capacity expansion screening.
 * Deterministic and configurable — never LLM-modified at runtime.
 */
export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  capacityPressure: 0.3,
  passengerGrowth: 0.25,
  congestionPressure: 0.2,
  marketScale: 0.15,
  routeOpportunity: 0.1,
};

export function assertWeightsSumToOne(weights: ScoringWeights): void {
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 1e-6) {
    throw new Error(`Scoring weights must sum to 1, got ${sum}`);
  }
}

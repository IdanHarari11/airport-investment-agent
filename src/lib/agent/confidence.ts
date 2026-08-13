import type { AgentResponse } from "./types";

const CRITICAL_COMPONENTS = [
  "congestionPressure",
  "capacityPressure",
  "passengerGrowth",
] as const;

/**
 * Deterministic confidence from structured airport cards.
 * Overrides LLM-assigned confidence when ranking/compare data is present.
 */
export function computeDeterministicConfidence(
  airports: AgentResponse["airports"],
): {
  confidence: AgentResponse["confidence"];
  reason: string | null;
} {
  if (!airports || airports.length === 0) {
    return { confidence: "medium", reason: null };
  }

  const focus = airports.slice(0, Math.min(3, airports.length));
  let criticalMissing = 0;
  let anyMissing = 0;
  const missingLabels: string[] = [];

  for (const airport of focus) {
    const components = airport.components;
    if (!components) {
      criticalMissing += 1;
      missingLabels.push(`${airport.iata}: components unavailable`);
      continue;
    }
    for (const key of CRITICAL_COMPONENTS) {
      if (components[key] == null) {
        criticalMissing += 1;
        missingLabels.push(`${airport.iata}: ${key} unavailable`);
      }
    }
    for (const value of Object.values(components)) {
      if (value == null) anyMissing += 1;
    }
  }

  if (criticalMissing >= 2) {
    return {
      confidence: "low",
      reason: `Overall ranking confidence: Low, because multiple critical components are missing (${missingLabels.slice(0, 3).join("; ")}).`,
    };
  }
  if (criticalMissing >= 1) {
    return {
      confidence: "medium",
      reason: `Overall ranking confidence: Medium, because a critical scoring component is unavailable (${missingLabels[0]}).`,
    };
  }
  if (anyMissing >= 1) {
    return {
      confidence: "medium",
      reason:
        "Overall ranking confidence: Medium, because at least one non-critical scoring component is unavailable in the top results.",
    };
  }
  return {
    confidence: "high",
    reason:
      "Overall ranking confidence: High — all required scoring components are available for the top-ranked airports.",
  };
}

function hasScoringCards(
  airports: NonNullable<AgentResponse["airports"]>,
): boolean {
  return airports.some(
    (airport) => airport.score != null || airport.components != null,
  );
}

function insightOnlyConfidence(response: AgentResponse): {
  confidence: AgentResponse["confidence"];
  reason: string;
} | null {
  const hasProxy = (response.unmetDemand?.length ?? 0) > 0;
  const hasCongestion = (response.congestion?.length ?? 0) > 0;
  const hasLongHaul = (response.longHaul?.length ?? 0) > 0;
  if (!hasProxy && !hasCongestion && !hasLongHaul) {
    return null;
  }

  if (hasProxy) {
    return {
      confidence: "medium",
      reason:
        "Overall confidence: Medium — unmet-demand answers use an Estimated Unmet Demand Proxy, not an official measurement.",
    };
  }
  return {
    confidence: "medium",
    reason:
      "Overall confidence: Medium — insight metrics (congestion / long-haul) are calculated from monthly extracts, not a full ranking cohort.",
  };
}

export function applyDeterministicConfidence(
  response: AgentResponse,
): AgentResponse {
  if (response.airports && response.airports.length > 0) {
    if (hasScoringCards(response.airports)) {
      const { confidence, reason } = computeDeterministicConfidence(
        response.airports,
      );
      const assumptions = [...response.assumptions];
      if (
        reason &&
        !assumptions.some((item) => item.includes("ranking confidence"))
      ) {
        assumptions.unshift(reason);
      }
      return { ...response, confidence, assumptions };
    }
  }

  const insight = insightOnlyConfidence(response);
  if (!insight) {
    // Never keep an unjustified High when there are no scoring cards.
    if (response.confidence === "high") {
      return { ...response, confidence: "medium" };
    }
    return response;
  }

  const assumptions = [...response.assumptions];
  if (!assumptions.some((item) => item.includes("Overall confidence"))) {
    assumptions.unshift(insight.reason);
  }
  return {
    ...response,
    confidence: insight.confidence,
    assumptions,
  };
}

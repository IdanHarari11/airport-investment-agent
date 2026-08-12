import type { AirportRecord, UnmetDemandResult } from "../aviation/types";
import { calculateCongestion } from "./congestion";
import { clampScore } from "./normalize";

export const UNMET_DEMAND_FORMULA =
  "0.35*loadFactorPressure + 0.30*growthPressure + 0.25*congestionPressure + 0.10*capacityGrowthLag";

/**
 * Estimated Unmet Demand Proxy — NOT an official government measurement.
 *
 * Combines high load factor, passenger growth, congestion, and a simple
 * capacity-growth-lag signal (passenger growth without proportional hub/capacity relief).
 */
export function estimateUnmetDemand(airport: AirportRecord): UnmetDemandResult {
  const caveats = [
    "This is an Estimated Unmet Demand Proxy, not an official BTS/FAA unmet-demand statistic.",
    "No public dataset in this project directly measures denied boarding due to terminal capacity constraints.",
  ];

  const loadFactor = airport.traffic?.loadFactor ?? null;
  const growth = airport.enplanementGrowthPct ?? null;
  const congestion = calculateCongestion(airport).congestionScore;

  const loadFactorPressure =
    loadFactor == null ? null : clampScore(((loadFactor - 0.7) / 0.25) * 100);
  const growthPressure =
    growth == null ? null : clampScore(((growth - 0) / 12) * 100);
  // If growth is strong while load factor is already high, capacity is lagging demand.
  const capacityGrowthLag =
    loadFactor == null || growth == null
      ? null
      : clampScore(
          ((Math.max(growth, 0) / 10) * 50 +
            Math.max(loadFactor - 0.8, 0) * 500) /
            1,
        );

  const parts = [
    { weight: 0.35, value: loadFactorPressure },
    { weight: 0.3, value: growthPressure },
    { weight: 0.25, value: congestion },
    { weight: 0.1, value: capacityGrowthLag },
  ];

  let numerator = 0;
  let weight = 0;
  for (const part of parts) {
    if (part.value == null) continue;
    numerator += part.weight * part.value;
    weight += part.weight;
  }

  const proxyScore =
    weight === 0 ? null : Math.round((numerator / weight) * 10) / 10;

  let classification: UnmetDemandResult["classification"] = "unavailable";
  if (proxyScore != null) {
    if (proxyScore >= 70) classification = "elevated";
    else if (proxyScore >= 45) classification = "moderate";
    else classification = "limited";
  }

  if (loadFactor == null) {
    caveats.push("Load factor unavailable in cached T-100 extract.");
  }
  if (growth == null) {
    caveats.push("Passenger growth unavailable in FAA enplanement extract.");
  }
  if (congestion == null) {
    caveats.push("Congestion signal unavailable (missing OTP metrics).");
  }

  return {
    airport: airport.iata,
    label: "Estimated Unmet Demand Proxy",
    proxyScore,
    classification,
    signals: {
      loadFactor,
      passengerGrowthPct: growth,
      congestionScore: congestion,
      capacityGrowthLag,
    },
    formula: UNMET_DEMAND_FORMULA,
    caveats,
  };
}

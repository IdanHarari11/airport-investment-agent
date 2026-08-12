import type { AirportRecord, CongestionResult } from "../aviation/types";
import { clampScore } from "./normalize";

function rateToComponent(
  rate: number | null | undefined,
  scale: number,
): number | null {
  if (rate == null || Number.isNaN(rate)) return null;
  return clampScore(rate * scale);
}

/**
 * Congestion score from observed BTS on-time / T-100 operational signals.
 * Higher = more congestion pressure.
 * Missing OTP rates stay null (never coerced to zero).
 */
export function calculateCongestion(airport: AirportRecord): CongestionResult {
  const otp = airport.onTime;
  const traffic = airport.traffic;
  const notes: string[] = [];

  if (!otp) {
    return {
      airport: airport.iata,
      congestionScore: null,
      signals: {
        depDelay15Rate: null,
        arrDelay15Rate: null,
        avgDepDelayMinutes: null,
        cancellationRate: null,
        performanceRatio: traffic?.performanceRatio ?? null,
      },
      period: null,
      unavailable: true,
      notes: [
        "On-time performance metrics are unavailable for this airport in the cached BTS OTP extract.",
      ],
    };
  }

  // Bounded transforms of observed rates/minutes into 0-100 component scores.
  const depDelayComponent = rateToComponent(otp.depDelay15Rate, 250); // 40% -> 100
  const arrDelayComponent = rateToComponent(otp.arrDelay15Rate, 250);
  const cancelComponent = rateToComponent(otp.cancellationRate, 1000); // 10% -> 100
  const avgDelayComponent =
    otp.avgDepDelayMinutes == null || Number.isNaN(otp.avgDepDelayMinutes)
      ? null
      : clampScore((otp.avgDepDelayMinutes / 30) * 100); // 30 min -> 100

  const parts = [
    { weight: 0.35, value: depDelayComponent },
    { weight: 0.25, value: arrDelayComponent },
    { weight: 0.25, value: avgDelayComponent },
    { weight: 0.15, value: cancelComponent },
  ].filter((p) => p.value != null);

  const weightSum = parts.reduce((s, p) => s + p.weight, 0);
  const congestionScore =
    weightSum === 0
      ? null
      : parts.reduce((s, p) => s + (p.value as number) * p.weight, 0) /
        weightSum;

  notes.push(
    `Congestion uses BTS OTP signals for ${otp.period} (reporting carriers).`,
  );
  notes.push(
    "This is a calculated congestion pressure index, not an official BTS congestion ranking.",
  );
  if (parts.length < 4) {
    notes.push(
      "One or more OTP rate fields were missing and excluded from the congestion blend (not treated as zero).",
    );
  }

  return {
    airport: airport.iata,
    congestionScore:
      congestionScore == null ? null : Math.round(congestionScore * 10) / 10,
    signals: {
      depDelay15Rate: otp.depDelay15Rate ?? null,
      arrDelay15Rate: otp.arrDelay15Rate ?? null,
      avgDepDelayMinutes: otp.avgDepDelayMinutes ?? null,
      cancellationRate: otp.cancellationRate ?? null,
      performanceRatio: traffic?.performanceRatio ?? null,
    },
    period: otp.period,
    unavailable: congestionScore == null,
    notes,
  };
}

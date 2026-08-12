/**
 * Deterministic normalization helpers.
 *
 * Ranking/scoring uses percentile ranks within the comparison cohort when possible.
 * Missing values stay null and never become zero implicitly.
 */

export function percentileRank(
  value: number | null | undefined,
  cohort: Array<number | null | undefined>,
): number | null {
  if (value == null || Number.isNaN(value)) return null;
  const values = cohort.filter(
    (v): v is number => v != null && !Number.isNaN(v),
  );
  if (values.length === 0) return null;
  if (values.length === 1) return 50;

  const sorted = [...values].sort((a, b) => a - b);
  let below = 0;
  let equal = 0;
  for (const v of sorted) {
    if (v < value) below += 1;
    else if (v === value) equal += 1;
  }
  // Mid-rank percentile in [0, 100]
  return ((below + 0.5 * equal) / sorted.length) * 100;
}

export function minMaxNormalize(
  value: number | null | undefined,
  cohort: Array<number | null | undefined>,
): number | null {
  if (value == null || Number.isNaN(value)) return null;
  const values = cohort.filter(
    (v): v is number => v != null && !Number.isNaN(v),
  );
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return 50;
  return ((value - min) / (max - min)) * 100;
}

export function clampScore(value: number | null): number | null {
  if (value == null || Number.isNaN(value)) return null;
  return Math.max(0, Math.min(100, value));
}

export function weightedMean(
  parts: Array<{ weight: number; value: number | null }>,
): { score: number | null; usedWeight: number; missing: string[] } {
  let numerator = 0;
  let usedWeight = 0;
  const missing: string[] = [];

  for (const [idx, part] of parts.entries()) {
    if (part.value == null || Number.isNaN(part.value)) {
      missing.push(String(idx));
      continue;
    }
    numerator += part.weight * part.value;
    usedWeight += part.weight;
  }

  if (usedWeight <= 0) return { score: null, usedWeight: 0, missing };
  return { score: numerator / usedWeight, usedWeight, missing };
}

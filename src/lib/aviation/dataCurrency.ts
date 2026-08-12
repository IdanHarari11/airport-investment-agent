import { createAviationDataProvider, loadDataset } from "./provider";

export type DataCurrencySummary = {
  generatedAt: string;
  coverageNotes: string | null;
  sources: Array<{
    name: string;
    period: string | null;
    notes: string | null;
  }>;
  /** One-line analyst-facing summary of loaded windows. */
  brief: string;
  /** Assumption lines to inject into structured responses. */
  assumptionLines: string[];
};

/**
 * Build a deterministic data-currency snapshot from dataset.json meta
 * (plus live provider sources after hydrate when available).
 */
export function getDataCurrencySummary(): DataCurrencySummary {
  const dataset = loadDataset();
  let sources = dataset.meta.sources.map((source) => ({
    name: source.name ?? source.source ?? "Aviation data source",
    period: source.period ?? null,
    notes: source.notes ?? null,
  }));

  try {
    const providerSources = createAviationDataProvider().getSources();
    if (providerSources.length > 0) {
      sources = providerSources.map((source) => ({
        name: source.name,
        period: source.period ?? null,
        notes: source.notes ?? null,
      }));
    }
  } catch {
    // Provider may be uninitialized in pure unit tests; fall back to file meta.
  }

  const periodBits = sources
    .filter((s) => s.period)
    .map((s) => `${shortSourceName(s.name)}=${s.period}`);

  const brief =
    periodBits.length > 0
      ? `Loaded public-data window (snapshot generated ${dataset.meta.generatedAt}): ${periodBits.join("; ")}. Not live / not arbitrary date-range query.`
      : `Loaded public-data snapshot generated ${dataset.meta.generatedAt}. Periods unavailable in meta.`;

  const assumptionLines = [
    brief,
    dataset.meta.coverageNotes?.trim() ||
      "Quote exact source periods from tool/source JSON when discussing currency.",
  ];

  return {
    generatedAt: dataset.meta.generatedAt,
    coverageNotes: dataset.meta.coverageNotes ?? null,
    sources,
    brief,
    assumptionLines,
  };
}

function shortSourceName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("on-time") || lower.includes("otp")) return "OTP";
  if (lower.includes("t-100") || lower.includes("t100")) return "T-100";
  if (lower.includes("enplanement") || lower.includes("faa")) return "FAA enplanements";
  if (lower.includes("facilit")) return "Facilities";
  return name.length > 40 ? `${name.slice(0, 37)}...` : name;
}

import type { AirportRecord, AviationDataset, DataSourceReference } from "../types";
import { regionFromState } from "../regions";
import type { FacilitiesLoadResult } from "./airportMetadataProvider";
import type { T100LoadResult } from "./t100ArcGisProvider";

export type DataProvenance = {
  t100Mode: T100LoadResult["sourceMode"] | "local-fallback";
  facilitiesMode: FacilitiesLoadResult["sourceMode"] | "local-fallback";
  otpMode: "local-ingest-cache";
  assumptions: string[];
};

/**
 * Merge public-API snapshots onto the local OTP/long-haul ingest dataset.
 * Scoring inputs that only exist in the ingest cache (OTP, long-haul share) are preserved.
 */
export function composeAviationDataset(params: {
  base: AviationDataset;
  t100: T100LoadResult;
  facilities: FacilitiesLoadResult;
}): { dataset: AviationDataset; provenance: DataProvenance } {
  const assumptions: string[] = [];
  const t100Snap = params.t100.snapshot;
  const facSnap = params.facilities.snapshot;

  const t100Mode: DataProvenance["t100Mode"] =
    t100Snap && params.t100.sourceMode !== "unavailable"
      ? params.t100.sourceMode
      : "local-fallback";
  const facilitiesMode: DataProvenance["facilitiesMode"] =
    facSnap && params.facilities.sourceMode !== "unavailable"
      ? params.facilities.sourceMode
      : "local-fallback";

  if (t100Mode === "local-fallback") {
    assumptions.push(
      "T-100 annual market metrics fell back to local dataset.json (ArcGIS REST unavailable or empty).",
    );
  } else {
    assumptions.push(
      `T-100 annual market metrics loaded from public ArcGIS REST (${t100Mode}, period ${params.t100.source.period ?? "n/a"}).`,
    );
  }
  if (facilitiesMode === "local-fallback") {
    assumptions.push(
      "Airport metadata fell back to local dataset.json (NTAD Facilities REST unavailable or empty).",
    );
  } else {
    assumptions.push(
      `Airport metadata loaded from public NTAD Aviation Facilities REST (${facilitiesMode}).`,
    );
  }
  assumptions.push(
    "BTS On-Time Performance (delays/cancellations/long-haul distance signals) continues to use the normalized local ingest cache — TranStats flight-level data is download-oriented, not a chat-time REST API.",
  );

  const airports: AirportRecord[] = params.base.airports.map((airport) => {
    const t100 = t100Snap?.byOrigin[airport.iata];
    const meta = facSnap?.byArptId[airport.iata];
    const state = meta?.state ?? airport.state;
    // Deterministic region from state codes; New England membership stays code-owned.
    const region = regionFromState(state) ?? airport.region;

    // Keep FAA-ingest enplanements/growth for scoring stability when already present.
    // T-100 API still supplies annual market evidence in sources + fills gaps only.
    const enplanementsCy2024 =
      airport.enplanementsCy2024 ?? t100?.enplanements ?? null;

    return {
      ...airport,
      name: meta?.name ?? airport.name,
      city: meta?.city ?? airport.city,
      state,
      region,
      enplanementsCy2024,
    };
  });

  const apiSources: DataSourceReference[] = [];
  if (t100Mode !== "local-fallback") {
    apiSources.push({
      name: params.t100.source.name,
      url: params.t100.source.url,
      period: params.t100.source.period ?? undefined,
      notes: params.t100.source.notes ?? undefined,
      fields: ["enplanements", "passengers", "departures", "arrivals", "year"],
    });
  }
  if (facilitiesMode !== "local-fallback") {
    apiSources.push({
      name: params.facilities.source.name,
      url: params.facilities.source.url,
      period: params.facilities.source.period ?? undefined,
      notes: params.facilities.source.notes ?? undefined,
      fields: ["ARPT_ID", "ARPT_NAME", "STATE_CODE", "CITY", "LAT_DECIMAL", "LONG_DECIMAL"],
    });
  }

  // Keep ingest sources (FAA xlsx / BTS OTP / T-100 monthly extract) and append API sources.
  const dataset: AviationDataset = {
    ...params.base,
    meta: {
      ...params.base.meta,
      generatedAt: new Date().toISOString().slice(0, 10),
      sources: [...params.base.meta.sources, ...apiSources],
    },
    airports,
  };

  return {
    dataset,
    provenance: {
      t100Mode,
      facilitiesMode,
      otpMode: "local-ingest-cache",
      assumptions,
    },
  };
}

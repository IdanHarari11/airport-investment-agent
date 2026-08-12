import {
  isCacheFresh,
  readCache,
  writeCache,
  type CacheEnvelope,
} from "../cache/fileCache";

const T100_LAYER_URL =
  "https://services.arcgis.com/xOi1kZaI0eWDREZv/ArcGIS/rest/services/T100_Domestic_Market_and_Segment_Data/FeatureServer/1/query";

const CACHE_NAME = "t100-annual.json";
/** Annual aggregates change rarely — refresh weekly by default. */
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type T100OriginRow = {
  origin: string;
  year: number;
  enplanements: number | null;
  passengers: number | null;
  departures: number | null;
  arrivals: number | null;
};

export type T100Snapshot = {
  year: number;
  byOrigin: Record<string, T100OriginRow>;
};

export type T100LoadResult = {
  snapshot: T100Snapshot | null;
  sourceMode: "api-cache" | "api-live" | "unavailable";
  source: CacheEnvelope<T100Snapshot>["source"];
};

function sourceMeta(year: number | null): CacheEnvelope<T100Snapshot>["source"] {
  return {
    name: "USDOT/BTS T-100 Domestic Market & Segment (ArcGIS REST)",
    url: "https://services.arcgis.com/xOi1kZaI0eWDREZv/ArcGIS/rest/services/T100_Domestic_Market_and_Segment_Data/FeatureServer/1",
    period: year != null ? `CY${year}` : null,
    notes:
      "Annual T-100 aggregates fetched programmatically from the public ArcGIS FeatureServer (JSON query). Cached locally; not re-fetched on every chat turn.",
  };
}

async function fetchT100Year(year: number): Promise<T100Snapshot> {
  const params = new URLSearchParams({
    where: `year=${year}`,
    outFields: "origin,year,enplanements,passengers,departures,arrivals",
    returnGeometry: "false",
    resultRecordCount: "2000",
    f: "json",
  });
  const res = await fetch(`${T100_LAYER_URL}?${params}`, {
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`T-100 ArcGIS HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    features?: Array<{ attributes?: Record<string, unknown> }>;
    error?: { message?: string };
  };
  if (json.error?.message) {
    throw new Error(json.error.message);
  }
  const byOrigin: Record<string, T100OriginRow> = {};
  for (const feature of json.features ?? []) {
    const attrs = feature.attributes ?? {};
    const origin = String(attrs.origin ?? "")
      .trim()
      .toUpperCase();
    if (!origin) continue;
    byOrigin[origin] = {
      origin,
      year: Number(attrs.year) || year,
      enplanements:
        typeof attrs.enplanements === "number" ? attrs.enplanements : null,
      passengers: typeof attrs.passengers === "number" ? attrs.passengers : null,
      departures: typeof attrs.departures === "number" ? attrs.departures : null,
      arrivals: typeof attrs.arrivals === "number" ? attrs.arrivals : null,
    };
  }
  if (Object.keys(byOrigin).length === 0) {
    throw new Error(`T-100 ArcGIS returned no rows for year ${year}`);
  }
  return { year, byOrigin };
}

/**
 * Load annual T-100 aggregates from public ArcGIS REST with disk cache.
 * Prefer CY2024 to align with the existing scoring period; fall back to latest available year on failure.
 */
export async function loadT100Snapshot(options?: {
  year?: number;
  ttlMs?: number;
  forceRefresh?: boolean;
}): Promise<T100LoadResult> {
  const year = options?.year ?? 2024;
  const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
  const cached = readCache<T100Snapshot>(CACHE_NAME);

  if (!options?.forceRefresh && isCacheFresh(cached) && cached) {
    return {
      snapshot: cached.data,
      sourceMode: "api-cache",
      source: cached.source,
    };
  }

  try {
    const snapshot = await fetchT100Year(year);
    const envelope: CacheEnvelope<T100Snapshot> = {
      fetchedAt: new Date().toISOString(),
      source: sourceMeta(snapshot.year),
      ttlMs,
      data: snapshot,
    };
    writeCache(CACHE_NAME, envelope);
    return {
      snapshot,
      sourceMode: "api-live",
      source: envelope.source,
    };
  } catch (error) {
    if (cached?.data) {
      return {
        snapshot: cached.data,
        sourceMode: "api-cache",
        source: {
          ...cached.source,
          notes: `${cached.source.notes ?? ""} Stale/failed refresh; serving disk cache. (${error instanceof Error ? error.message : "error"})`,
        },
      };
    }
    return {
      snapshot: null,
      sourceMode: "unavailable",
      source: {
        ...sourceMeta(year),
        notes: `T-100 ArcGIS unavailable; fallback to local dataset.json enplanements. (${error instanceof Error ? error.message : "error"})`,
      },
    };
  }
}

export class T100Provider {
  load(options?: {
    year?: number;
    forceRefresh?: boolean;
  }): Promise<T100LoadResult> {
    return loadT100Snapshot(options);
  }
}

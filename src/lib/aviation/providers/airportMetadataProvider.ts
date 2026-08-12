import {
  isCacheFresh,
  readCache,
  writeCache,
  type CacheEnvelope,
} from "../cache/fileCache";

const FACILITIES_QUERY_URL =
  "https://services.arcgis.com/xOi1kZaI0eWDREZv/ArcGIS/rest/services/NTAD_Aviation_Facilities/FeatureServer/0/query";

const CACHE_NAME = "airport-metadata.json";
/** FAA NASR cycle is ~28 days — refresh monthly. */
const DEFAULT_TTL_MS = 28 * 24 * 60 * 60 * 1000;

export type AirportFacilityMeta = {
  arptId: string;
  icao: string | null;
  name: string;
  city: string | null;
  state: string | null;
  lat: number | null;
  lon: number | null;
  facilityUse: string | null;
  siteType: string | null;
  effectiveDate: string | null;
};

export type FacilitiesSnapshot = {
  byArptId: Record<string, AirportFacilityMeta>;
  effectiveDate: string | null;
};

export type FacilitiesLoadResult = {
  snapshot: FacilitiesSnapshot | null;
  sourceMode: "api-cache" | "api-live" | "unavailable";
  source: CacheEnvelope<FacilitiesSnapshot>["source"];
};

function sourceMeta(
  effectiveDate: string | null,
): CacheEnvelope<FacilitiesSnapshot>["source"] {
  return {
    name: "USDOT/BTS NTAD Aviation Facilities (ArcGIS REST / FAA NASR)",
    url: "https://services.arcgis.com/xOi1kZaI0eWDREZv/ArcGIS/rest/services/NTAD_Aviation_Facilities/FeatureServer/0",
    period: effectiveDate,
    notes:
      "Airport metadata (name, state, city, coordinates) from the public NTAD Aviation Facilities FeatureServer, updated from FAA roughly every 28 days. Cached locally.",
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function fetchFacilitiesForIds(
  arptIds: string[],
): Promise<FacilitiesSnapshot> {
  const byArptId: Record<string, AirportFacilityMeta> = {};
  let effectiveDate: string | null = null;

  for (const group of chunk(arptIds, 40)) {
    const where = `ARPT_ID IN (${group.map((id) => `'${id.replace(/'/g, "")}'`).join(",")})`;
    const params = new URLSearchParams({
      where,
      outFields:
        "ARPT_ID,ICAO_ID,ARPT_NAME,CITY,STATE_CODE,LAT_DECIMAL,LONG_DECIMAL,FACILITY_USE_CODE,SITE_TYPE_CODE,EFF_DATE",
      returnGeometry: "false",
      resultRecordCount: String(group.length + 5),
      f: "json",
    });
    const res = await fetch(`${FACILITIES_QUERY_URL}?${params}`, {
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`NTAD Facilities HTTP ${res.status}`);
    }
    const json = (await res.json()) as {
      features?: Array<{ attributes?: Record<string, unknown> }>;
      error?: { message?: string };
    };
    if (json.error?.message) {
      throw new Error(json.error.message);
    }
    for (const feature of json.features ?? []) {
      const attrs = feature.attributes ?? {};
      const arptId = String(attrs.ARPT_ID ?? "")
        .trim()
        .toUpperCase();
      if (!arptId) continue;
      const eff =
        typeof attrs.EFF_DATE === "string" ? attrs.EFF_DATE : null;
      if (eff && !effectiveDate) effectiveDate = eff;
      byArptId[arptId] = {
        arptId,
        icao:
          typeof attrs.ICAO_ID === "string" && attrs.ICAO_ID.trim()
            ? attrs.ICAO_ID.trim().toUpperCase()
            : null,
        name:
          typeof attrs.ARPT_NAME === "string" && attrs.ARPT_NAME.trim()
            ? attrs.ARPT_NAME.trim()
            : arptId,
        city: typeof attrs.CITY === "string" ? attrs.CITY : null,
        state:
          typeof attrs.STATE_CODE === "string"
            ? attrs.STATE_CODE.toUpperCase()
            : null,
        lat: typeof attrs.LAT_DECIMAL === "number" ? attrs.LAT_DECIMAL : null,
        lon:
          typeof attrs.LONG_DECIMAL === "number" ? attrs.LONG_DECIMAL : null,
        facilityUse:
          typeof attrs.FACILITY_USE_CODE === "string"
            ? attrs.FACILITY_USE_CODE
            : null,
        siteType:
          typeof attrs.SITE_TYPE_CODE === "string"
            ? attrs.SITE_TYPE_CODE
            : null,
        effectiveDate: eff,
      };
    }
  }

  return { byArptId, effectiveDate };
}

/**
 * Load FAA/NTAD airport metadata for a set of airport IDs (usually IATA/LOCID).
 */
export async function loadAirportMetadata(
  arptIds: string[],
  options?: { ttlMs?: number; forceRefresh?: boolean },
): Promise<FacilitiesLoadResult> {
  const ids = [...new Set(arptIds.map((id) => id.trim().toUpperCase()).filter(Boolean))];
  const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
  const cached = readCache<FacilitiesSnapshot>(CACHE_NAME);
  const cachedCovers = cached
    ? ids.every((id) => cached.data.byArptId[id])
    : false;

  if (
    !options?.forceRefresh &&
    isCacheFresh(cached) &&
    cached &&
    cachedCovers
  ) {
    return {
      snapshot: cached.data,
      sourceMode: "api-cache",
      source: cached.source,
    };
  }

  try {
    const snapshot = await fetchFacilitiesForIds(ids);
    // Merge with previous cache so we don't drop airports not in this request.
    const merged: FacilitiesSnapshot = {
      byArptId: {
        ...(cached?.data.byArptId ?? {}),
        ...snapshot.byArptId,
      },
      effectiveDate: snapshot.effectiveDate ?? cached?.data.effectiveDate ?? null,
    };
    const envelope: CacheEnvelope<FacilitiesSnapshot> = {
      fetchedAt: new Date().toISOString(),
      source: sourceMeta(merged.effectiveDate),
      ttlMs,
      data: merged,
    };
    writeCache(CACHE_NAME, envelope);
    return {
      snapshot: merged,
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
        ...sourceMeta(null),
        notes: `NTAD Facilities unavailable; fallback to local dataset.json metadata. (${error instanceof Error ? error.message : "error"})`,
      },
    };
  }
}

export class AirportMetadataProvider {
  load(
    arptIds: string[],
    options?: { forceRefresh?: boolean },
  ): Promise<FacilitiesLoadResult> {
    return loadAirportMetadata(arptIds, options);
  }
}

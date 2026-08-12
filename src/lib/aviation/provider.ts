import { readFileSync } from "fs";
import path from "path";
import type { AirportRecord, AviationDataset } from "./types";
import { normalizeRegionName } from "./regions";
import { isCacheFresh, readCache } from "./cache/fileCache";
import {
  loadAirportMetadata,
  type FacilitiesLoadResult,
  type FacilitiesSnapshot,
} from "./providers/airportMetadataProvider";
import {
  loadT100Snapshot,
  type T100LoadResult,
  type T100Snapshot,
} from "./providers/t100ArcGisProvider";
import {
  composeAviationDataset,
  type DataProvenance,
} from "./providers/composeDataset";

const T100_CACHE = "t100-annual.json";
const FACILITIES_CACHE = "airport-metadata.json";

let cachedBaseDataset: AviationDataset | null = null;
let runtimeProvider: LocalAviationDataProvider | null = null;
let hydratePromise: Promise<LocalAviationDataProvider> | null = null;

function datasetPath(): string {
  return path.join(process.cwd(), "data", "normalized", "dataset.json");
}

export function loadDataset(): AviationDataset {
  if (cachedBaseDataset) return cachedBaseDataset;
  const raw = readFileSync(datasetPath(), "utf-8");
  cachedBaseDataset = JSON.parse(raw) as AviationDataset;
  return cachedBaseDataset;
}

/** Test helper: inject an in-memory dataset and reset runtime provider. */
export function setDatasetForTests(dataset: AviationDataset | null): void {
  cachedBaseDataset = dataset;
  runtimeProvider = dataset
    ? new LocalAviationDataProvider(dataset, {
        t100Mode: "local-fallback",
        facilitiesMode: "local-fallback",
        otpMode: "local-ingest-cache",
        assumptions: [
          "Test dataset injected in-memory (public API hydrate skipped).",
        ],
      })
    : null;
  hydratePromise = null;
}

function t100FromDisk(): T100LoadResult {
  const cached = readCache<T100Snapshot>(T100_CACHE);
  if (!cached?.data) {
    return {
      snapshot: null,
      sourceMode: "unavailable",
      source: {
        name: "USDOT/BTS T-100 Domestic Market & Segment (ArcGIS REST)",
        url: "https://services.arcgis.com/xOi1kZaI0eWDREZv/ArcGIS/rest/services/T100_Domestic_Market_and_Segment_Data/FeatureServer/1",
        period: null,
        notes: "No T-100 API disk cache present.",
      },
    };
  }
  return {
    snapshot: cached.data,
    sourceMode: "api-cache",
    source: {
      ...cached.source,
      notes: isCacheFresh(cached)
        ? cached.source.notes
        : `${cached.source.notes ?? ""} Serving stale disk cache until refresh.`,
    },
  };
}

function facilitiesFromDisk(iatas: string[]): FacilitiesLoadResult {
  const cached = readCache<FacilitiesSnapshot>(FACILITIES_CACHE);
  if (!cached?.data) {
    return {
      snapshot: null,
      sourceMode: "unavailable",
      source: {
        name: "USDOT/BTS NTAD Aviation Facilities (ArcGIS REST / FAA NASR)",
        url: "https://services.arcgis.com/xOi1kZaI0eWDREZv/ArcGIS/rest/services/NTAD_Aviation_Facilities/FeatureServer/0",
        period: null,
        notes: "No Facilities API disk cache present.",
      },
    };
  }
  const coverage = iatas.filter((id) => cached.data.byArptId[id]).length;
  return {
    snapshot: cached.data,
    sourceMode: "api-cache",
    source: {
      ...cached.source,
      notes: `${cached.source.notes ?? ""} Disk cache covers ${coverage}/${iatas.length} scoring airports.`,
    },
  };
}

function buildProviderFromDisk(): LocalAviationDataProvider {
  const base = loadDataset();
  const iatas = base.airports.map((a) => a.iata);
  const { dataset, provenance } = composeAviationDataset({
    base,
    t100: t100FromDisk(),
    facilities: facilitiesFromDisk(iatas),
  });
  return new LocalAviationDataProvider(dataset, provenance);
}

export class LocalAviationDataProvider {
  constructor(
    private readonly dataset: AviationDataset = loadDataset(),
    private readonly provenance: DataProvenance = {
      t100Mode: "local-fallback",
      facilitiesMode: "local-fallback",
      otpMode: "local-ingest-cache",
      assumptions: [
        "Using local dataset.json only (public API cache not hydrated yet).",
      ],
    },
  ) {}

  getProvenance(): DataProvenance {
    return this.provenance;
  }

  getSources(): Array<{
    name: string;
    url?: string;
    period?: string;
    notes?: string;
  }> {
    return this.dataset.meta.sources.map((source) => ({
      name: source.name ?? source.source ?? "Aviation data source",
      url: source.url,
      period: source.period,
      notes: source.notes ?? source.longHaulDefinition,
    }));
  }

  getConfig() {
    return this.dataset.config;
  }

  listAirports(): AirportRecord[] {
    return this.dataset.airports;
  }

  getAirport(iata: string): AirportRecord | null {
    const code = iata.trim().toUpperCase();
    return this.dataset.airports.find((a) => a.iata === code) ?? null;
  }

  getAirportsByRegion(regionInput: string): AirportRecord[] {
    const region = normalizeRegionName(regionInput);
    if (!region) return [];
    return this.dataset.airports.filter((a) => a.region === region);
  }

  getAirportsByStates(states: string[]): AirportRecord[] {
    const set = new Set(states.map((s) => s.toUpperCase()));
    return this.dataset.airports.filter(
      (a) => a.state != null && set.has(a.state.toUpperCase()),
    );
  }

  resolveAirportCodes(codes: string[]): {
    found: AirportRecord[];
    missing: string[];
  } {
    const found: AirportRecord[] = [];
    const missing: string[] = [];
    for (const code of codes) {
      const airport = this.getAirport(code);
      if (airport) found.push(airport);
      else missing.push(code.toUpperCase());
    }
    return { found, missing };
  }
}

/**
 * Fetch public ArcGIS REST APIs (T-100 + NTAD Facilities) into disk cache,
 * then merge onto the OTP/long-haul ingest dataset. No commercial APIs.
 */
export async function hydrateAviationDataProvider(options?: {
  forceRefresh?: boolean;
}): Promise<LocalAviationDataProvider> {
  const base = loadDataset();
  const iatas = base.airports.map((a) => a.iata);

  const [t100, facilities] = await Promise.all([
    loadT100Snapshot({
      year: 2024,
      forceRefresh: options?.forceRefresh,
    }),
    loadAirportMetadata(iatas, { forceRefresh: options?.forceRefresh }),
  ]);

  const { dataset, provenance } = composeAviationDataset({
    base,
    t100,
    facilities,
  });

  runtimeProvider = new LocalAviationDataProvider(dataset, provenance);
  return runtimeProvider;
}

/**
 * Sync accessor for tools/tests. Uses disk API cache when present (no network).
 * Background-refreshes stale/missing caches once per process.
 */
export function createAviationDataProvider(): LocalAviationDataProvider {
  if (runtimeProvider) return runtimeProvider;

  runtimeProvider = buildProviderFromDisk();

  const needsNetwork =
    runtimeProvider.getProvenance().t100Mode === "local-fallback" ||
    runtimeProvider.getProvenance().facilitiesMode === "local-fallback";

  if (!hydratePromise && needsNetwork) {
    hydratePromise = hydrateAviationDataProvider()
      .then((provider) => {
        runtimeProvider = provider;
        return provider;
      })
      .catch(() => runtimeProvider!);
  }

  return runtimeProvider;
}

/** Await a provider with fresh-enough public API caches (network if needed). */
export async function getAviationDataProvider(options?: {
  forceRefresh?: boolean;
}): Promise<LocalAviationDataProvider> {
  if (options?.forceRefresh) {
    hydratePromise = hydrateAviationDataProvider({ forceRefresh: true });
    return hydratePromise;
  }
  if (
    runtimeProvider &&
    runtimeProvider.getProvenance().t100Mode !== "local-fallback" &&
    runtimeProvider.getProvenance().facilitiesMode !== "local-fallback"
  ) {
    return runtimeProvider;
  }
  if (!hydratePromise) {
    hydratePromise = hydrateAviationDataProvider();
  }
  return hydratePromise;
}

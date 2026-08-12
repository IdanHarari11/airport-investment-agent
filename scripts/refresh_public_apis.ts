/**
 * Refresh disk caches from public ArcGIS REST APIs (T-100 + NTAD Facilities).
 * OTP remains on the BTS download → ingest → normalized cache path.
 *
 * Usage: npx tsx scripts/refresh_public_apis.ts [--force]
 */
import { hydrateAviationDataProvider } from "../src/lib/aviation/provider";

async function main() {
  const forceRefresh = process.argv.includes("--force");
  console.log(
    forceRefresh
      ? "Force-refreshing public API caches…"
      : "Refreshing public API caches if stale…",
  );
  const provider = await hydrateAviationDataProvider({ forceRefresh });
  const provenance = provider.getProvenance();
  const sources = provider.getSources();
  console.log("Airports:", provider.listAirports().length);
  console.log("Provenance:", provenance);
  console.log(
    "Sources:",
    sources.map((s) => `${s.name} [${s.period ?? "n/a"}]`),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

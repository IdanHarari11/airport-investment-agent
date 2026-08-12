/**
 * Deterministic validation of the four exam metric questions (no LLM).
 * Expected numeric values follow the currently loaded public-data snapshot.
 */
import { createAviationDataProvider } from "../src/lib/aviation/provider";
import { calculateCongestion } from "../src/lib/analytics/congestion";
import { calculateLongHaulStats } from "../src/lib/analytics/longHaul";
import { estimateUnmetDemand } from "../src/lib/analytics/unmetDemand";
import { buildRegionalScreeningCohort } from "../src/lib/scoring/regionalCohort";
import { rankAirports } from "../src/lib/scoring/rank";

function main() {
  const provider = createAviationDataProvider();
  const provenance = provider.getProvenance();
  console.log("Provenance:", provenance);

  const bos = provider.getAirport("BOS");
  const lax = provider.getAirport("LAX");
  const sna = provider.getAirport("SNA");
  const anc = provider.getAirport("ANC");
  const sfo = provider.getAirport("SFO");
  if (!bos || !lax || !sna || !anc || !sfo) {
    throw new Error("Required exam airports missing from dataset");
  }

  console.log("Periods:", {
    bosOtp: bos.onTime?.period,
    bosTraffic: bos.traffic?.period,
    sources: provider.getSources().map((s) => `${s.name} [${s.period ?? "n/a"}]`),
  });

  const ne = buildRegionalScreeningCohort({
    provider,
    region: "New England",
  });
  const ranked = rankAirports(ne.airports, undefined, ne.regionLabel);
  const rankedAgain = rankAirports(ne.airports, undefined, ne.regionLabel);
  console.log(
    "NE top:",
    ranked.slice(0, 3).map((r) => `${r.airport}=${r.score}`),
  );

  const congLax = calculateCongestion(lax);
  const congSna = calculateCongestion(sna);
  console.log(
    "Congestion LAX/SNA:",
    congLax.congestionScore,
    congSna.congestionScore,
  );

  const longHaul = calculateLongHaulStats(
    anc,
    provider.getConfig().longHaulThresholdMiles,
  );
  const longHaulAgain = calculateLongHaulStats(
    anc,
    provider.getConfig().longHaulThresholdMiles,
  );
  console.log(
    "ANC long-haul %:",
    longHaul.longHaulShare,
    "threshold:",
    longHaul.thresholdMiles,
  );

  const unmet = estimateUnmetDemand(sfo);
  const unmetAgain = estimateUnmetDemand(sfo);
  console.log("SFO unmet proxy:", unmet.proxyScore, unmet.classification);

  const neStable =
    JSON.stringify(ranked.map((r) => [r.airport, r.score])) ===
    JSON.stringify(rankedAgain.map((r) => [r.airport, r.score]));
  const ok =
    bos.onTime?.period === "2025-01..2026-06" &&
    bos.traffic?.period === "2025-01..2026-04" &&
    ranked.length >= 2 &&
    ranked[0]?.score != null &&
    neStable &&
    congLax.congestionScore != null &&
    congSna.congestionScore != null &&
    longHaul.longHaulShare != null &&
    longHaul.longHaulShare === longHaulAgain.longHaulShare &&
    longHaul.thresholdMiles === 1500 &&
    unmet.proxyScore != null &&
    unmet.proxyScore === unmetAgain.proxyScore &&
    unmet.label === "Estimated Unmet Demand Proxy" &&
    provenance.otpMode === "local-ingest-cache";

  console.log(ok ? "\nEXAM METRICS OK" : "\nEXAM METRICS FAILED");
  if (!ok) process.exit(2);
}

main();

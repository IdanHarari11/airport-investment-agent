/**
 * Examiner-style checks: same query twice + four brief questions.
 * Compares deterministic structured fields (scores / long-haul / proxy).
 *
 * Usage: npx tsx scripts/exam_consistency_check.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(path: string): void {
  try {
    const text = readFileSync(path, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const eq = trimmed.indexOf("=");
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env) || !process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // optional
  }
}

loadEnvFile(resolve(process.cwd(), ".env"));
process.env.LANGSMITH_TRACING = "true";
process.env.LANGCHAIN_TRACING_V2 = "true";
if (process.env.LANGSMITH_API_KEY) {
  process.env.LANGCHAIN_API_KEY = process.env.LANGSMITH_API_KEY;
}
process.env.LANGSMITH_PROJECT =
  process.env.LANGSMITH_PROJECT || "airport-investment-agent";
process.env.LANGCHAIN_PROJECT = process.env.LANGSMITH_PROJECT;

type Fingerprint = {
  confidence: string;
  topAirports: Array<{ iata: string; rank: number | null; score: number | null }>;
  longHaul: Array<{ airport: string; share: number | null }>;
  congestion: Array<{ airport: string; score: number | null }>;
  unmet: Array<{ airport: string; proxy: number | null; classification: string | null }>;
  answerHasProxyLabel: boolean;
  answerPreview: string;
};

function fingerprint(response: {
  confidence: string;
  answer: string;
  airports: Array<{
    iata: string;
    rank: number | null;
    score: number | null;
  }> | null;
  longHaul: Array<{ airport: string; longHaulShare: number | null }> | null;
  congestion: Array<{ airport: string; congestionScore: number | null }> | null;
  unmetDemand: Array<{
    airport: string;
    proxyScore: number | null;
    classification: string | null;
  }> | null;
}): Fingerprint {
  return {
    confidence: response.confidence,
    topAirports: (response.airports ?? []).slice(0, 5).map((a) => ({
      iata: a.iata,
      rank: a.rank,
      score: a.score,
    })),
    longHaul: (response.longHaul ?? []).map((r) => ({
      airport: r.airport,
      share: r.longHaulShare,
    })),
    congestion: (response.congestion ?? []).map((r) => ({
      airport: r.airport,
      score: r.congestionScore,
    })),
    unmet: (response.unmetDemand ?? []).map((r) => ({
      airport: r.airport,
      proxy: r.proxyScore,
      classification: r.classification,
    })),
    answerHasProxyLabel: /proxy/i.test(response.answer),
    answerPreview: response.answer.replace(/\s+/g, " ").slice(0, 160),
  };
}

function stableEqual(a: Fingerprint, b: Fingerprint): boolean {
  const strip = (f: Fingerprint) => ({
    ...f,
    answerPreview: undefined,
  });
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

async function main() {
  const { runAirportAgent } = await import("../src/lib/agent/agent");

  const questions = [
    {
      id: "NE",
      message:
        "Which airports in New England are strong candidates for terminal expansion?",
    },
    {
      id: "CONG",
      message: "Compare LAX and SNA congestion levels.",
    },
    {
      id: "ANC",
      message: "What percentage of long-haul flights depart from ANC?",
    },
    {
      id: "SFO",
      message: "What is the estimated unmet flight demand at SFO and why?",
    },
  ];

  const report: Array<Record<string, unknown>> = [];

  // Consistency: ANC twice (deterministic long-haul share must match)
  console.log("=== Consistency: ANC long-haul ×2 ===");
  const anc1 = fingerprint(
    await runAirportAgent({
      message: questions[2]!.message,
      language: "en",
    }),
  );
  const anc2 = fingerprint(
    await runAirportAgent({
      message: questions[2]!.message,
      language: "en",
    }),
  );
  const ancStable = stableEqual(anc1, anc2);
  console.log(
    JSON.stringify(
      {
        stableStructured: ancStable,
        run1: anc1,
        run2: anc2,
        proseSimilar:
          anc1.longHaul[0]?.share != null &&
          anc2.longHaul[0]?.share != null &&
          Math.abs((anc1.longHaul[0]?.share ?? 0) - (anc2.longHaul[0]?.share ?? 0)) <
            1e-9,
      },
      null,
      2,
    ),
  );
  report.push({ id: "ANC_x2", stableStructured: ancStable, anc1, anc2 });

  // Consistency: NE rank twice (top scores/ranks must match)
  console.log("\n=== Consistency: New England rank ×2 ===");
  const ne1 = fingerprint(
    await runAirportAgent({
      message: questions[0]!.message,
      language: "en",
    }),
  );
  const ne2 = fingerprint(
    await runAirportAgent({
      message: questions[0]!.message,
      language: "en",
    }),
  );
  const neStable = stableEqual(ne1, ne2);
  console.log(
    JSON.stringify({ stableStructured: neStable, run1: ne1, run2: ne2 }, null, 2),
  );
  report.push({ id: "NE_x2", stableStructured: neStable, ne1, ne2 });

  // Remaining brief questions once each
  for (const q of [questions[1]!, questions[3]!]) {
    console.log(`\n=== Brief question: ${q.id} ===`);
    const fp = fingerprint(
      await runAirportAgent({ message: q.message, language: "en" }),
    );
    console.log(JSON.stringify(fp, null, 2));
    report.push({ id: q.id, ...fp });
  }

  // Follow-up conversation — must preserve regional cohort scores (not 2-way re-rank).
  console.log("\n=== Follow-up: Why BOS above BDL? ===");
  const follow = await runAirportAgent({
    message: "Why is BOS ranked above BDL?",
    language: "en",
    history: [
      { role: "user", content: questions[0]!.message },
      {
        role: "assistant",
        content:
          ne1.answerPreview ||
          "New England ranking: BOS #1, BDL #2 in the New England cohort.",
      },
    ],
  });
  const followFp = fingerprint(follow);
  // Expected scores come from the same ranking engine — not hardcoded literals.
  const { createAviationDataProvider } = await import(
    "../src/lib/aviation/provider"
  );
  const { buildRegionalScreeningCohort } = await import(
    "../src/lib/scoring/regionalCohort"
  );
  const { rankAirports } = await import("../src/lib/scoring/rank");
  const expectedNe = rankAirports(
    buildRegionalScreeningCohort({
      provider: createAviationDataProvider(),
      region: "New England",
    }).airports,
    undefined,
    "New England",
  );
  const expectedBos = expectedNe.find((row) => row.airport === "BOS");
  const expectedBdl = expectedNe.find((row) => row.airport === "BDL");
  const followTop = followFp.topAirports.slice(0, 2);
  const followKeepsCohort =
    followTop[0]?.iata === "BOS" &&
    followTop[1]?.iata === "BDL" &&
    expectedBos?.score != null &&
    expectedBdl?.score != null &&
    Math.abs((followTop[0]?.score ?? 0) - expectedBos.score) < 0.2 &&
    Math.abs((followTop[1]?.score ?? 0) - expectedBdl.score) < 0.2;
  console.log(
    JSON.stringify({ ...followFp, followKeepsCohort }, null, 2),
  );
  report.push({ id: "FOLLOWUP", ...followFp, followKeepsCohort });

  const failures = report.filter(
    (r) => r.stableStructured === false || r.followKeepsCohort === false,
  );
  console.log("\n=== SUMMARY ===");
  console.log(
    JSON.stringify(
      {
        consistencyOk: failures.length === 0,
        failed: failures.map((f) => f.id),
        followKeepsCohort,
        langsmithProject: process.env.LANGCHAIN_PROJECT,
        tracing: process.env.LANGCHAIN_TRACING_V2,
      },
      null,
      2,
    ),
  );

  if (failures.length > 0) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

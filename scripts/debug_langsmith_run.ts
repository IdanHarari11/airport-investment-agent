/**
 * Run one agent turn with timing + LangSmith tracing enabled.
 * Usage: npx tsx scripts/debug_langsmith_run.ts
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

async function main() {
  const { runAirportAgent } = await import("../src/lib/agent/agent");
  const { calculateLongHaulStats } = await import(
    "../src/lib/analytics/longHaul"
  );
  const { createAviationDataProvider } = await import(
    "../src/lib/aviation/provider"
  );

  const provider = createAviationDataProvider();
  const anc = provider.getAirport("ANC");
  if (!anc) throw new Error("ANC missing from dataset");

  const t0 = performance.now();
  const local = calculateLongHaulStats(anc);
  const localMs = performance.now() - t0;

  console.log("--- Local deterministic tool (no LLM) ---");
  console.log(
    JSON.stringify(
      {
        airport: local.airport,
        longHaulShare: local.longHaulShare,
        thresholdMiles: local.thresholdMiles,
        source: local.source,
        durationMs: Number(localMs.toFixed(3)),
      },
      null,
      2,
    ),
  );

  const events: Array<{ t: number; event: unknown }> = [];
  const start = performance.now();

  console.log("\n--- Agent run (LangSmith tracing on) ---");
  console.log("project:", process.env.LANGCHAIN_PROJECT);
  console.log("tracing:", process.env.LANGCHAIN_TRACING_V2);

  const response = await runAirportAgent({
    message: "What percentage of long-haul flights depart from ANC?",
    language: "en",
    onProgress: (event) => {
      events.push({ t: performance.now() - start, event });
      console.log(
        `[+${(performance.now() - start).toFixed(0)}ms]`,
        JSON.stringify(event),
      );
    },
  });

  const totalMs = performance.now() - start;
  console.log("\n--- Result summary ---");
  console.log(
    JSON.stringify(
      {
        totalMs: Number(totalMs.toFixed(1)),
        confidence: response.confidence,
        answerPreview: response.answer.slice(0, 220),
        airports: response.airports?.map((a) => ({
          iata: a.iata,
          score: a.score,
        })),
      },
      null,
      2,
    ),
  );

  // Fetch latest runs from LangSmith
  const apiKey = process.env.LANGSMITH_API_KEY;
  if (!apiKey) {
    console.log("\nNo LANGSMITH_API_KEY — skip remote fetch");
    return;
  }

  await new Promise((r) => setTimeout(r, 3000));

  const project = process.env.LANGSMITH_PROJECT || "airport-investment-agent";
  const headers = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
  };

  const sessionsRes = await fetch(
    `https://api.smith.langchain.com/api/v1/sessions?limit=50&name_contains=${encodeURIComponent(project)}`,
    { headers },
  );
  if (!sessionsRes.ok) {
    console.error(
      "LangSmith sessions failed",
      sessionsRes.status,
      await sessionsRes.text(),
    );
    return;
  }
  const sessionsJson = (await sessionsRes.json()) as
    | Array<{ id: string; name: string }>
    | { rows?: Array<{ id: string; name: string }> };
  const sessions = Array.isArray(sessionsJson)
    ? sessionsJson
    : (sessionsJson.rows ?? []);
  const session =
    sessions.find((s) => s.name === project) ??
    sessions.find((s) => s.name.includes("airport")) ??
    sessions[0];
  if (!session) {
    console.error("No LangSmith session/project found for", project);
    return;
  }

  const res = await fetch("https://api.smith.langchain.com/api/v1/runs/query", {
    method: "POST",
    headers,
    body: JSON.stringify({
      session: [session.id],
      limit: 25,
    }),
  });

  if (!res.ok) {
    console.error("LangSmith query failed", res.status, await res.text());
    return;
  }

  const data = (await res.json()) as {
    runs?: Array<{
      id: string;
      name: string;
      run_type: string;
      status: string;
      start_time?: string;
      end_time?: string;
      total_tokens?: number;
      error?: string;
      parent_run_id?: string | null;
      trace_id?: string;
    }>;
  };

  const runs = data.runs ?? [];
  console.log("\n--- LangSmith recent runs ---");
  console.log("project:", session.name, session.id);
  for (const run of runs) {
    const startMs = run.start_time ? Date.parse(run.start_time) : NaN;
    const endMs = run.end_time ? Date.parse(run.end_time) : NaN;
    const dur =
      Number.isFinite(startMs) && Number.isFinite(endMs) ? endMs - startMs : null;
    console.log(
      [
        run.run_type.padEnd(8),
        (run.status || "").padEnd(8),
        dur != null ? `${dur}ms`.padStart(8) : "   n/a",
        run.name,
        run.total_tokens != null ? `tokens=${run.total_tokens}` : "",
        run.error ? `ERR=${run.error.slice(0, 80)}` : "",
      ]
        .filter(Boolean)
        .join(" | "),
    );
  }

  const root =
    runs.find((r) => !r.parent_run_id) ??
    runs.find((r) => r.run_type === "chain") ??
    runs[0];
  if (root) {
    const traceId = root.trace_id || root.id;
    console.log(
      `\nOpen in LangSmith:\nhttps://smith.langchain.com/public/${traceId}/r\n(or project UI → ${session.name} → latest run)`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

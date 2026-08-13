import type { BaseMessage } from "@langchain/core/messages";
import { ToolMessage } from "@langchain/core/messages";
import { getDataCurrencySummary } from "../aviation/dataCurrency";
import { createAviationDataProvider } from "../aviation/provider";
import { messageContentToText } from "./messageContent";
import type { AgentResponse } from "./types";

type ToolAirportCard = NonNullable<AgentResponse["airports"]>[number];
type CongestionInsight = NonNullable<AgentResponse["congestion"]>[number];
type LongHaulInsight = NonNullable<AgentResponse["longHaul"]>[number];
type UnmetDemandInsight = NonNullable<AgentResponse["unmetDemand"]>[number];

type ScoreLike = {
  airport?: string;
  iata?: string;
  name?: string | null;
  rank?: number | null;
  score?: number | null;
  components?: ToolAirportCard["components"];
  metrics?: ToolAirportCard["metrics"];
  cohortLabel?: string | null;
  cohortSize?: number | null;
};

/** Higher wins when multiple scoring tools run in one turn. */
type AirportCardPriority = 0 | 1 | 2;

function cardPriority(toolName: string): AirportCardPriority | null {
  if (toolName === "rankAirports") return 2;
  if (toolName === "compareAirports") return 1;
  if (toolName === "getAirportMetrics") return 0;
  return null;
}

function parseJson(content: unknown): unknown | null {
  const text = messageContentToText(content).trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && !Number.isNaN(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function toAirportCard(raw: ScoreLike): ToolAirportCard | null {
  const iata = (raw.airport ?? raw.iata ?? "").toUpperCase();
  if (!iata) return null;
  return {
    iata,
    name: raw.name ?? null,
    rank: raw.rank ?? null,
    score: raw.score ?? null,
    components: raw.components ?? null,
    metrics: raw.metrics ?? null,
    cohortLabel: raw.cohortLabel ?? null,
    cohortSize: raw.cohortSize ?? null,
  };
}

function normalizeSource(raw: unknown): AgentResponse["sources"][number] | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const name = String(row.name ?? row.source ?? "").trim();
  if (!name) return null;
  return {
    name,
    url: typeof row.url === "string" ? row.url : null,
    period: typeof row.period === "string" ? row.period : null,
    notes: typeof row.notes === "string" ? row.notes : null,
  };
}

/** Keep first occurrence per source name (case-insensitive). */
export function dedupeSources(
  sources: AgentResponse["sources"],
): AgentResponse["sources"] {
  const seen = new Set<string>();
  const out: AgentResponse["sources"] = [];
  for (const source of sources) {
    const key = source.name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(source);
  }
  return out;
}

function collectToolPayloads(
  messages: BaseMessage[],
): Array<{ name: string; data: Record<string, unknown> }> {
  const out: Array<{ name: string; data: Record<string, unknown> }> = [];
  for (const message of messages) {
    const isTool =
      ToolMessage.isInstance(message) ||
      message.getType?.() === "tool" ||
      (message as { type?: string }).type === "tool";
    if (!isTool) continue;

    const name =
      (message as ToolMessage).name ||
      (message as { name?: string }).name ||
      "";
    const parsed = parseJson(message.content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      continue;
    }
    out.push({ name, data: parsed as Record<string, unknown> });
  }
  return out;
}

function cardsFromPayload(
  name: string,
  data: Record<string, unknown>,
): ToolAirportCard[] {
  if (name === "rankAirports" && Array.isArray(data.ranked)) {
    return (data.ranked as ScoreLike[])
      .map(toAirportCard)
      .filter((card): card is ToolAirportCard => card != null);
  }
  if (name === "compareAirports" && Array.isArray(data.comparison)) {
    return (data.comparison as ScoreLike[])
      .map(toAirportCard)
      .filter((card): card is ToolAirportCard => card != null);
  }
  if (name === "getAirportMetrics" && data.score) {
    const card = toAirportCard(data.score as ScoreLike);
    return card ? [card] : [];
  }
  return [];
}

function congestionFromRaw(raw: Record<string, unknown>): CongestionInsight | null {
  const airport = asString(raw.airport)?.toUpperCase();
  if (!airport) return null;
  const signals =
    raw.signals && typeof raw.signals === "object"
      ? (raw.signals as Record<string, unknown>)
      : {};
  return {
    airport,
    congestionScore: asNumber(raw.congestionScore),
    depDelay15Rate: asNumber(signals.depDelay15Rate ?? raw.depDelay15Rate),
    cancellationRate: asNumber(
      signals.cancellationRate ?? raw.cancellationRate,
    ),
    avgDepDelayMinutes: asNumber(
      signals.avgDepDelayMinutes ?? raw.avgDepDelayMinutes,
    ),
    period: asString(raw.period),
    unavailable: Boolean(raw.unavailable),
  };
}

function longHaulFromRaw(raw: Record<string, unknown>): LongHaulInsight | null {
  const airport = asString(raw.airport)?.toUpperCase();
  if (!airport) return null;
  return {
    airport,
    longHaulShare: asNumber(raw.longHaulShare),
    thresholdMiles: asNumber(raw.thresholdMiles),
    definition: asString(raw.definition),
    source: asString(raw.source),
    period: asString(raw.period),
  };
}

function unmetFromRaw(raw: Record<string, unknown>): UnmetDemandInsight | null {
  const airport = asString(raw.airport)?.toUpperCase();
  if (!airport) return null;
  const signals =
    raw.signals && typeof raw.signals === "object"
      ? (raw.signals as Record<string, unknown>)
      : {};
  const caveats = Array.isArray(raw.caveats)
    ? raw.caveats.filter((item): item is string => typeof item === "string")
    : null;
  return {
    airport,
    label: asString(raw.label) ?? "Estimated Unmet Demand Proxy",
    proxyScore: asNumber(raw.proxyScore),
    classification: asString(raw.classification),
    loadFactor: asNumber(signals.loadFactor ?? raw.loadFactor),
    passengerGrowthPct: asNumber(
      signals.passengerGrowthPct ?? raw.passengerGrowthPct,
    ),
    congestionScore: asNumber(signals.congestionScore ?? raw.congestionScore),
    caveats,
  };
}

function insightsFromPayload(
  name: string,
  data: Record<string, unknown>,
  options: { includeBundledMetricsInsights: boolean },
): {
  congestion?: CongestionInsight[];
  longHaul?: LongHaulInsight[];
  unmetDemand?: UnmetDemandInsight[];
} {
  if (name === "getCongestionMetrics" && Array.isArray(data.results)) {
    return {
      congestion: (data.results as Record<string, unknown>[])
        .map(congestionFromRaw)
        .filter((row): row is CongestionInsight => row != null),
    };
  }
  if (name === "getLongHaulStats" && Array.isArray(data.results)) {
    return {
      longHaul: (data.results as Record<string, unknown>[])
        .map(longHaulFromRaw)
        .filter((row): row is LongHaulInsight => row != null),
    };
  }
  if (name === "estimateUnmetDemand" && Array.isArray(data.results)) {
    return {
      unmetDemand: (data.results as Record<string, unknown>[])
        .map(unmetFromRaw)
        .filter((row): row is UnmetDemandInsight => row != null),
    };
  }
  if (name === "getAirportMetrics" && options.includeBundledMetricsInsights) {
    const out: {
      congestion?: CongestionInsight[];
      longHaul?: LongHaulInsight[];
      unmetDemand?: UnmetDemandInsight[];
    } = {};
    if (data.congestion && typeof data.congestion === "object") {
      const row = congestionFromRaw(data.congestion as Record<string, unknown>);
      if (row) out.congestion = [row];
    }
    if (data.longHaul && typeof data.longHaul === "object") {
      const row = longHaulFromRaw(data.longHaul as Record<string, unknown>);
      if (row) out.longHaul = [row];
    }
    if (data.unmetDemandProxy && typeof data.unmetDemandProxy === "object") {
      const row = unmetFromRaw(
        data.unmetDemandProxy as Record<string, unknown>,
      );
      if (row) out.unmetDemand = [row];
    }
    return out;
  }
  return {};
}

/**
 * Prefer deterministic tool JSON for score cards and insight panels
 * over LLM-filled structured fields.
 *
 * Airport card precedence: rankAirports > compareAirports > getAirportMetrics.
 * Bundled insight cards from getAirportMetrics are skipped when a rank/compare
 * tool already ran (keeps follow-ups about ranking rationale cleaner).
 */
export function mergeAirportsFromToolMessages(
  response: AgentResponse,
  messages: BaseMessage[],
): AgentResponse {
  const payloads = collectToolPayloads(messages);
  if (payloads.length === 0) return response;

  let airports: ToolAirportCard[] | null = null;
  let airportPriority: AirportCardPriority | null = null;
  let congestion: CongestionInsight[] | null = null;
  let longHaul: LongHaulInsight[] | null = null;
  let unmetDemand: UnmetDemandInsight[] | null = null;
  const assumptions = [...response.assumptions];
  const sources = [...response.sources];
  let sawTools = false;

  const hasRankOrCompare = payloads.some(
    (p) => p.name === "rankAirports" || p.name === "compareAirports",
  );

  for (const { name, data } of payloads) {
    sawTools = true;
    const cards = cardsFromPayload(name, data);
    const priority = cardPriority(name);
    if (cards.length > 0 && priority != null) {
      if (airportPriority == null || priority >= airportPriority) {
        airports = cards;
        airportPriority = priority;
      }
    }

    const insights = insightsFromPayload(name, data, {
      includeBundledMetricsInsights: !hasRankOrCompare,
    });
    if (insights.congestion?.length) congestion = insights.congestion;
    if (insights.longHaul?.length) longHaul = insights.longHaul;
    if (insights.unmetDemand?.length) unmetDemand = insights.unmetDemand;

    if (Array.isArray(data.assumptions)) {
      for (const item of data.assumptions) {
        if (typeof item === "string" && item.trim() && !assumptions.includes(item)) {
          assumptions.push(item);
        }
      }
    }

    if (Array.isArray(data.sources)) {
      for (const raw of data.sources) {
        const source = normalizeSource(raw);
        if (
          source &&
          !sources.some(
            (existing) =>
              existing.name === source.name && existing.period === source.period,
          )
        ) {
          sources.push(source);
        }
      }
    }
  }

  return {
    ...response,
    airports: airports ?? (sawTools ? null : response.airports),
    congestion: congestion ?? (sawTools ? null : response.congestion),
    longHaul: longHaul ?? (sawTools ? null : response.longHaul),
    unmetDemand: unmetDemand ?? (sawTools ? null : response.unmetDemand),
    assumptions,
    sources: dedupeSources(sources),
  };
}

const SCORING_ASSUMPTIONS = [
  {
    text: "Scores are relative to the comparison cohort (percentile ranks).",
    alreadyCovered: (item: string) =>
      /comparison cohort|percentile ranks/i.test(item),
  },
  {
    text: "Missing score components are excluded and remaining weights are renormalized.",
    alreadyCovered: (item: string) =>
      /renormaliz/i.test(item) && /missing/i.test(item),
  },
];

function hasScoringCards(response: AgentResponse): boolean {
  return (response.airports ?? []).some(
    (airport) => airport.score != null || airport.components != null,
  );
}

function hasCachedAviationInsights(response: AgentResponse): boolean {
  return (
    hasScoringCards(response) ||
    (response.congestion?.length ?? 0) > 0 ||
    (response.longHaul?.length ?? 0) > 0 ||
    (response.unmetDemand?.length ?? 0) > 0
  );
}

/** Fill empty assumptions/sources from the data provider + contextual defaults. */
export function enrichAgentResponse(response: AgentResponse): AgentResponse {
  const assumptions = [...response.assumptions];
  if (hasCachedAviationInsights(response)) {
    for (const item of getDataCurrencySummary().assumptionLines) {
      if (!assumptions.includes(item)) {
        assumptions.push(item);
      }
    }
  }
  if (hasScoringCards(response)) {
    for (const item of SCORING_ASSUMPTIONS) {
      if (
        !assumptions.some((existing) => item.alreadyCovered(existing)) &&
        !assumptions.includes(item.text)
      ) {
        assumptions.push(item.text);
      }
    }
  }

  const provider = createAviationDataProvider();
  for (const item of provider.getProvenance().assumptions) {
    if (!assumptions.includes(item)) {
      assumptions.push(item);
    }
  }

  // Prefer authoritative provider sources for aviation answers so the LLM
  // cannot invent duplicates or stale periods.
  const providerSources = provider.getSources().map((source) => ({
    name: source.name || "Aviation data source",
    url: source.url ?? null,
    period: source.period ?? null,
    notes: source.notes ?? null,
  }));
  const sources = dedupeSources(
    hasCachedAviationInsights(response) || response.sources.length === 0
      ? providerSources
      : [...response.sources, ...providerSources],
  );

  return {
    ...response,
    congestion: response.congestion ?? null,
    longHaul: response.longHaul ?? null,
    unmetDemand: response.unmetDemand ?? null,
    assumptions,
    sources,
  };
}

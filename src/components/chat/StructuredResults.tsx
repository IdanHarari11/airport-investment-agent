"use client";

import { useState } from "react";
import type { AgentResponse } from "@/lib/agent/types";
import { textDirection } from "@/lib/speech/language";

/** Rate in [0,1] (load factor, delay share). */
function formatRate(value: unknown): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "n/a";
  const pct = Math.abs(value) <= 1 ? value * 100 : value;
  return `${pct.toFixed(1)}%`;
}

/** Already stored as percentage points (e.g. -0.62, 20.22). */
function formatGrowthPoints(value: unknown): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "n/a";
  return `${value.toFixed(1)}%`;
}

function formatScore(value: unknown): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "n/a";
  return value.toFixed(1);
}

function confidenceTone(level: AgentResponse["confidence"]): string {
  if (level === "high") return "bg-[var(--accent-soft)] text-[var(--accent)]";
  if (level === "medium") return "bg-[rgba(212,162,76,0.16)] text-[var(--warn)]";
  return "bg-[rgba(208,102,102,0.16)] text-[var(--danger)]";
}

export function StructuredResults({ data }: { data: AgentResponse }) {
  const [openDetails, setOpenDetails] = useState(true);
  const [openInsights, setOpenInsights] = useState(true);
  const [openAssumptions, setOpenAssumptions] = useState(true);
  const assumptions = data.assumptions ?? [];
  const sources = data.sources ?? [];
  const airports = data.airports ?? [];
  const congestion = data.congestion ?? [];
  const longHaul = data.longHaul ?? [];
  const unmetDemand = data.unmetDemand ?? [];
  const hasAssumptionsOrSources =
    assumptions.length > 0 || sources.length > 0;
  const hasAirports = airports.length > 0;
  const hasInsights =
    congestion.length > 0 ||
    longHaul.length > 0 ||
    unmetDemand.length > 0;

  return (
    <div className="mt-3 min-w-0 space-y-3">
      {/* Metric chips / cards stay LTR (IATA + English labels). */}
      <div dir="ltr" className="space-y-3 text-left">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide ${confidenceTone(data.confidence)}`}
        >
          Confidence · {data.confidence}
        </span>
        {hasAirports ? (
          <span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] text-[var(--muted)]">
            {airports.length} airport
            {airports.length === 1 ? "" : "s"}
          </span>
        ) : null}
        {hasInsights ? (
          <span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] text-[var(--muted)]">
            {[
              congestion.length ? "congestion" : null,
              longHaul.length ? "long-haul" : null,
              unmetDemand.length ? "unmet demand" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        ) : null}
      </div>

      {hasAirports && (
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => setOpenDetails((value) => !value)}
            className="mb-2 text-xs font-medium text-[var(--muted)] transition hover:text-[var(--text)]"
          >
            {openDetails ? "Hide score cards ▾" : "Show score cards ▸"}
          </button>
          {openDetails && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {airports.map((airport) => (
                <article
                  key={`${airport.iata}-${airport.rank ?? "x"}`}
                  className="min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--bg)]/55 p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold tracking-wide">
                        {airport.iata}
                      </h3>
                      {airport.name ? (
                        <p className="mt-0.5 break-content text-xs text-[var(--muted)] line-clamp-2">
                          {airport.name}
                        </p>
                      ) : null}
                    </div>
                    {airport.rank != null && (
                      <span className="shrink-0 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] text-[var(--accent)]">
                        #{airport.rank}
                      </span>
                    )}
                  </div>
                  {airport.score != null && (
                    <p className="mt-2 text-2xl font-semibold tabular-nums text-[var(--accent)]">
                      {airport.score.toFixed(1)}
                      <span className="ml-1 text-[11px] font-normal text-[var(--muted)]">
                        score
                      </span>
                    </p>
                  )}
                  {(airport.cohortLabel || airport.cohortSize != null) && (
                    <p className="mt-1 text-[11px] text-[var(--muted)]">
                      vs{" "}
                      {airport.cohortLabel ??
                        `${airport.cohortSize} airport${airport.cohortSize === 1 ? "" : "s"}`}
                    </p>
                  )}
                  {airport.components && (
                    <dl className="mt-2 grid grid-cols-1 gap-x-3 gap-y-1 text-[11px] min-[380px]:grid-cols-2">
                      {Object.entries(airport.components).map(([key, value]) => (
                        <div
                          key={key}
                          className="flex min-w-0 items-baseline justify-between gap-2"
                        >
                          <dt className="min-w-0 truncate text-[var(--muted)]">
                            {key}
                          </dt>
                          <dd className="shrink-0 tabular-nums">
                            {value == null ? "n/a" : Number(value).toFixed(1)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {airport.metrics && (
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-[var(--muted)]">
                      <span className="rounded-full border border-[var(--border)] px-2 py-0.5">
                        Growth{" "}
                        {formatGrowthPoints(
                          airport.metrics.enplanementGrowthPct,
                        )}
                      </span>
                      <span className="rounded-full border border-[var(--border)] px-2 py-0.5">
                        LF {formatRate(airport.metrics.loadFactor)}
                      </span>
                      <span className="rounded-full border border-[var(--border)] px-2 py-0.5">
                        Delay {formatRate(airport.metrics.depDelay15Rate)}
                      </span>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {hasInsights && (
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => setOpenInsights((value) => !value)}
            className="mb-2 text-xs font-medium text-[var(--muted)] transition hover:text-[var(--text)]"
          >
            {openInsights ? "Hide insight cards ▾" : "Show insight cards ▸"}
          </button>
          {openInsights && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {congestion.map((row) => (
                <article
                  key={`cong-${row.airport}`}
                  className="min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--bg)]/55 p-3"
                >
                  <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
                    Congestion
                  </p>
                  <h3 className="mt-0.5 text-sm font-semibold tracking-wide">
                    {row.airport}
                  </h3>
                  <p className="mt-2 text-2xl font-semibold tabular-nums text-[var(--accent)]">
                    {formatScore(row.congestionScore)}
                    <span className="ml-1 text-[11px] font-normal text-[var(--muted)]">
                      pressure
                    </span>
                  </p>
                  {row.unavailable ? (
                    <p className="mt-1 text-[11px] text-[var(--warn)]">
                      OTP unavailable
                    </p>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-[var(--muted)]">
                      <span className="rounded-full border border-[var(--border)] px-2 py-0.5">
                        Delay {formatRate(row.depDelay15Rate)}
                      </span>
                      <span className="rounded-full border border-[var(--border)] px-2 py-0.5">
                        Cancel {formatRate(row.cancellationRate)}
                      </span>
                      <span className="rounded-full border border-[var(--border)] px-2 py-0.5">
                        Avg delay{" "}
                        {row.avgDepDelayMinutes == null
                          ? "n/a"
                          : `${row.avgDepDelayMinutes.toFixed(1)}m`}
                      </span>
                    </div>
                  )}
                  {row.period ? (
                    <p className="mt-2 text-[10px] text-[var(--muted)]">
                      Period · {row.period}
                    </p>
                  ) : null}
                </article>
              ))}

              {longHaul.map((row) => (
                <article
                  key={`lh-${row.airport}`}
                  className="min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--bg)]/55 p-3"
                >
                  <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
                    Long-haul share
                  </p>
                  <h3 className="mt-0.5 text-sm font-semibold tracking-wide">
                    {row.airport}
                  </h3>
                  <p className="mt-2 text-2xl font-semibold tabular-nums text-[var(--accent)]">
                    {formatRate(row.longHaulShare)}
                  </p>
                  <p className="mt-1 text-[11px] text-[var(--muted)]">
                    Threshold ≥ {row.thresholdMiles ?? "n/a"} miles
                    {row.source ? ` · ${row.source}` : ""}
                  </p>
                  {row.definition ? (
                    <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
                      {row.definition}
                    </p>
                  ) : null}
                </article>
              ))}

              {unmetDemand.map((row) => (
                <article
                  key={`unmet-${row.airport}`}
                  className="min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--bg)]/55 p-3"
                >
                  <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
                    {row.label}
                  </p>
                  <h3 className="mt-0.5 text-sm font-semibold tracking-wide">
                    {row.airport}
                  </h3>
                  <p className="mt-2 text-2xl font-semibold tabular-nums text-[var(--accent)]">
                    {formatScore(row.proxyScore)}
                    <span className="ml-1 text-[11px] font-normal text-[var(--muted)]">
                      proxy
                    </span>
                  </p>
                  {row.classification ? (
                    <p className="mt-1 text-[11px] capitalize text-[var(--muted)]">
                      Classification · {row.classification}
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-[var(--muted)]">
                    <span className="rounded-full border border-[var(--border)] px-2 py-0.5">
                      LF {formatRate(row.loadFactor)}
                    </span>
                    <span className="rounded-full border border-[var(--border)] px-2 py-0.5">
                      Growth {formatGrowthPoints(row.passengerGrowthPct)}
                    </span>
                    <span className="rounded-full border border-[var(--border)] px-2 py-0.5">
                      Congestion {formatScore(row.congestionScore)}
                    </span>
                  </div>
                  {row.caveats && row.caveats.length > 0 ? (
                    <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px] text-[var(--muted)]">
                      {row.caveats.slice(0, 3).map((caveat) => (
                        <li key={caveat} className="break-content">
                          {caveat}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </div>
      )}
      </div>

      {hasAssumptionsOrSources && (
        <div className="min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--bg)]/35">
          <button
            type="button"
            onClick={() => setOpenAssumptions((value) => !value)}
            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-xs font-medium text-[var(--muted)] transition hover:text-[var(--text)]"
          >
            <span className="min-w-0">
              {assumptions.length > 0 && sources.length > 0
                ? `${assumptions.length} assumptions · ${sources.length} sources`
                : assumptions.length > 0
                  ? `${assumptions.length} assumptions`
                  : sources.length > 0
                    ? `${sources.length} sources`
                    : "Assumptions & data sources"}
            </span>
            <span className="shrink-0">{openAssumptions ? "▾" : "▸"}</span>
          </button>
          {openAssumptions && (
            <div className="space-y-3 border-t border-[var(--border)] px-3 py-3">
              {assumptions.length > 0 && (
                <ul className="list-disc space-y-1 ps-4 text-xs text-[var(--muted)]">
                  {assumptions.map((item) => (
                    <li
                      key={item}
                      dir={textDirection(item)}
                      className="break-content text-start [unicode-bidi:plaintext]"
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              )}
              {sources.length > 0 && (
                <ul dir="ltr" className="space-y-1 text-left text-xs">
                  {sources.map((source) => (
                    <li
                      key={`${source.name}-${source.period ?? ""}`}
                      className="break-content"
                    >
                      {source.url && /^https?:\/\//i.test(source.url) ? (
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[var(--accent)] underline-offset-2 hover:underline"
                        >
                          {source.name}
                        </a>
                      ) : (
                        <span>{source.name}</span>
                      )}
                      {source.period ? (
                        <span className="text-[var(--muted)]">
                          {" "}
                          · {source.period}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

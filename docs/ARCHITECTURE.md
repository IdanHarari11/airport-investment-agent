# Architecture — Airport Investment Intelligence Agent

Short design / architecture document for the FDE take-home deliverable.

| Exam deliverable section | Where in this doc |
|---|---|
| Scoring methodology | [Scoring methodology](#scoring-methodology) |
| Key tradeoffs | [Tradeoffs](#tradeoffs) |
| Where / how AI is used | [AI usage](#ai-usage) |

Also covers: runtime flow, public-data strategy, assumptions / uncertainty / scoping, and the voice bonus.

## Architecture

```text
Public government sources
       ↓
Data Providers (T100Provider, AirportMetadataProvider, OTP ingest)
       ↓
Normalized aviation model
       ↓
Local cache (data/cache + data/normalized)
       ↓
Deterministic analytics / scoring
       ↓
LangChain tools
       ↓
Agent → Next.js UI
```

### Runtime flow

1. User asks a question in the chat UI (`ChatApp`).
2. The client marks the user turn `pending`, persists it under that conversation in `localStorage`, and POSTs to `/api/chat` with history (≤40) + optional anonymous `clientUserId`.
3. `/api/chat` applies a small in-memory rate limit, then invokes a LangChain tool-calling agent (SSE: status / tool_start / tool_end / final).
4. The agent selects tools (`rankAirports`, `compareAirports`, `getCongestionMetrics`, `getLongHaulStats`, `estimateUnmetDemand`, etc.).
5. Scoring tools call TypeScript domain functions over the hydrated aviation provider (public REST caches + OTP ingest).
6. The agent synthesizes a structured response; server-side code overwrites `airports[]` / insight cards from tool JSON when tools ran (rank/compare take precedence over `getAirportMetrics`), injects default assumptions/sources when needed, dedupes sources, and sets deterministic confidence (including medium for proxy/insight-only answers).
7. On `final`, the client writes the assistant reply into **that conversation’s** store (`applyAssistantReply`) even if the user has switched chats; the Working card updates only for the active conversation. Assumptions & sources open by default.

### Client sessions

- **Storage:** anonymous `clientUserId` + per-user conversation map in `localStorage` (`src/lib/chat/sessionStore.ts`). Cap: 25 conversations, 200 messages each.
- **Concurrency:** AbortControllers and request generations are keyed by `conversationId`. Chat switch / New chat updates the active id immediately and leaves other conversations’ in-flight fetches running. Only a newer send in the **same** chat supersedes the previous turn.
- **Refresh:** pending user turns without an assistant reply are rediscovered after hydrate (`findPendingRetries`) and re-sent. Unload-time fetch cancellations stay `pending` (`isUnloadNetworkError`) so retry can run.
- **UI:** desktop sidebar + mobile drawer for history / New chat / Reset; list rows show an in-flight pulse when loading or still `pending`. After tools finish, `WorkingStatusLine` rotates drafting tips and stops on the last line (*Almost ready — polishing the investment framing…*).
- Closing the tab ends client-side work for that browser session (private local store; exam scope).

### Security & isolation

- API keys (`OPENAI_*`, `ELEVENLABS_*`) live only in server env / Route Handlers. No `NEXT_PUBLIC_` secrets.
- Client errors are sanitized (`toPublicErrorMessage`).
- Basic in-memory rate limits protect `/api/chat` and `/api/tts` on single-instance deploys.
- Each chat request carries history on the wire; the browser owns persistence under `airport-agent:v1:store:{userId}`.
- `clientUserId` is accepted for optional future logging; chats stay per-browser.
- “Reset local user” mints a new anonymous identity.
- Completion budget: `OPENAI_MAX_TOKENS` defaults to **16384**; values below **4096** are ignored so structured JSON can finish (`resolveMaxCompletionTokens` in `src/lib/agent/model.ts`).
- `.env` is gitignored.

Orchestration uses LangChain `createAgent` (standard tool-calling agent).

## Scoring methodology

### Factors and weights

| Factor | Weight | Why selected |
|---|---:|---|
| Capacity / demand pressure | 30% | High load factor suggests facility pressure (growth is scored separately) |
| Passenger growth | 25% | Expansion cases are often growth-led |
| Congestion pressure | 20% | Delay/cancel signals indicate operational stress |
| Market scale | 15% | Larger markets support capital projects |
| Route opportunity | 10% | Long-haul mix as a connectivity/opportunity proxy |

### Normalization

Component scores use **percentile ranks within the comparison cohort** (region filter, explicit compare set, or full curated set). Identical values map to the mid-rank (50). Missing values remain `null` and are omitted from the weighted average with weight renormalization.

### Why this model

Explainable, testable, and aligned to available public fields — a screening heuristic for analysts.

## AI usage

### LLM responsibilities

- Intent understanding
- Tool selection
- Follow-up handling via conversation history
- Synthesis of tool JSON into analyst language
- Explanation of assumptions / uncertainty

### Deterministic TypeScript responsibilities

- Official metrics, expansion scores, and rankings (UI score cards are merged from tool JSON after the model turn)
- New England membership and long-haul distance threshold
- Filling missing numeric fields (left as `null` when absent in source data)

## Data strategy (public government sources)

The assignment asks to **use public APIs to gather airport/aviation data**. Gathering is done **programmatically from public government endpoints**, then normalized and cached. Chat turns use the hydrated provider + disk cache.

### What comes from REST APIs

| Provider | Public endpoint | Cached under | Used for |
|---|---|---|---|
| `T100Provider` | USDOT/BTS ArcGIS `T100_Domestic_Market_and_Segment_Data` FeatureServer | `data/cache/t100-annual.json` (TTL ~7d) | Public-API annual T-100 snapshot + provenance; fills enplanement gaps. Scoring prefers FAA CY2024 enplanements from ingest when already present (stable cohort). |
| `AirportMetadataProvider` | USDOT/BTS ArcGIS `NTAD_Aviation_Facilities` FeatureServer (FAA NASR ~28-day cycle) | `data/cache/airport-metadata.json` (TTL ~28d) | Airport name, state, city, coordinates / facility metadata |

Refresh: `npm run refresh:apis` (or automatic hydrate when disk cache is missing). If REST is temporarily down, the app falls back to `dataset.json` and **states the actual source** in assumptions/sources.

### What comes from BTS public download → ingest

| Source | How gathered | Cached under | Used for |
|---|---|---|---|
| BTS On-Time Performance | TranStats public download (BTS documents flight-level OTP as download-oriented) via `scripts/ingest_bts.py` | `data/normalized/dataset.json` | Delays, cancellations, congestion (multi-month aggregate: **2025-01..2026-06**) |
| FAA commercial enplanements + monthly T-100 segment extract | Public HTTPS downloads in the same ingest script | `data/normalized/dataset.json` | Growth/market scale (FAA CY2023–CY2024); seats/load factor/long-haul texture (T-100 aggregate **2025-01..2026-04**) |

OTP uses the download → ingest → normalized cache path because TranStats flight-level On-Time Performance is exposed as a download-oriented extract for this use case.

### Why this architecture

- Gathers data from **public APIs** (ArcGIS REST + official BTS/FAA HTTP).
- Uses **provider + TTL disk cache** for reliable demo latency.
- Keeps scoring **deterministic** and independent of the LLM.

**Regional ranking filters:** default min CY2024 enplanements (250k) plus exclusion of airports lacking OTP coverage in the loaded extract, so ranks stay grounded in available congestion signals. New England membership is deterministic in code (`NEW_ENGLAND_STATES`); airport metadata comes from the Facilities provider when available.

**Long-haul threshold:** ≥ **1500 miles** (documented assumption), applied deterministically in TypeScript.

### Voice (bonus)

- **TTS:** ElevenLabs HTTP API via Next.js `/api/tts`. API key stays server-side. Non-English prefers flash/turbo + `language_code`; `eleven_multilingual_v2` is fallback. Speaks English-only in the UI; truncates at 2500 characters.
- **STT (mic):** Browser `SpeechRecognition` for dictation into the chat box.
- Separate from FAA/BTS aviation data APIs.

## Tradeoffs

| Choice | Alternative | Rationale |
|---|---|---|
| Multi-month OTP/T-100 window from 2025-01 | Single-month snapshot | Multi-month reduces seasonality within a practical extract size; production would typically refresh a trailing 6–12 month rolling window |
| Cached official extracts for scores | Live TranStats on every chat | Reliability + latency for demo |
| Explainable proxy score | Complex econometric model | Interview clarity, testability |
| LangChain `createAgent` | Custom LangGraph workflow | Sufficient orchestration, less ceremony |
| Client `localStorage` sessions + pending retry | Server-side chat jobs / stream resume | Private per-browser sessions; refresh retries the turn |
| Default `maxTokens` 16384 (floor 4096) | Aggressive low caps for latency | Structured `AgentResponse` JSON must finish |
| Long-haul ≥ 1500 miles | Ask LLM per flight | Deterministic, documented |
| Unmet-demand proxy | Treat as official unmet demand | Honesty about what the public data supports |

## Uncertainty

The expansion score is a **decision-support screen** for capacity/expansion screening. Multi-month OTP/T-100 windows reduce single-month seasonality but still reflect publication lag and domestic coverage limits; incomplete small-airport OTP rows also reduce precision. Material caveats are surfaced in assumptions / confidence.

### Deterministic confidence

When structured airport score cards are present, UI confidence is **set server-side** from component completeness among the top results:

- Complete components → High  
- One critical component missing (e.g. congestion) → Medium  
- Multiple critical gaps → Low  

For proxy / insight-only answers (unmet demand, congestion, long-haul) without ranking cards, confidence is capped at **Medium** with an explicit assumption line.

# Architecture

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

1. User asks a question in the chat UI.
2. `/api/chat` applies a small in-memory rate limit, truncates history to the last 40 turns, then invokes a LangChain tool-calling agent.
3. The agent selects tools (`rankAirports`, `compareAirports`, `getCongestionMetrics`, `getLongHaulStats`, `estimateUnmetDemand`, etc.).
4. Scoring tools call TypeScript domain functions over the hydrated aviation provider (public REST caches + OTP ingest).
5. The agent synthesizes a structured response; server-side code overwrites `airports[]` / insight cards from tool JSON when tools ran (rank/compare take precedence over `getAirportMetrics`), injects default assumptions/sources if empty, and sets deterministic confidence (including honest medium for proxy/insight-only answers).
6. The UI renders prose plus ranking/comparison cards and tool insight cards (congestion, long-haul share, unmet-demand proxy). Assumptions & sources open by default.

### Security & session isolation

- API keys (`OPENAI_*`, `ELEVENLABS_*`) live only in server env / Route Handlers. No `NEXT_PUBLIC_` secrets.
- Client errors are sanitized (`toPublicErrorMessage`) — never return raw provider/env messages.
- Basic in-memory rate limits protect `/api/chat` and `/api/tts` on single-instance deploys.
- The chat API is **stateless**: history is sent by the client per request (client + server keep ≤40 messages). The server does not store or merge conversations across browsers.
- Each browser gets an anonymous `clientUserId` in `localStorage`. Conversations are stored under `airport-agent:v1:store:{userId}` so users on different browsers/devices never share history. “Reset local user” mints a new identity.
- `.env` is gitignored.

No LangGraph custom graph was added: standard LangChain `createAgent` is enough for this assignment and easier to explain in an interview.

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

It is explainable, testable, and aligned to available public fields. It is a screening heuristic for analysts, not a valuation model.

## AI usage

### AI does

- Intent understanding
- Tool selection
- Follow-up handling via conversation history
- Synthesis of tool JSON into analyst language
- Explanation of assumptions / uncertainty

### AI does not do

- Calculate official metrics
- Calculate expansion scores
- Determine rankings (UI score cards are merged from tool JSON after the model turn)
- Invent missing values
- Decide New England membership
- Decide whether a flight is long-haul

## Data strategy (public government sources)

The assignment asks to **use public APIs to gather airport/aviation data**. Gathering is done **programmatically from public government endpoints**, then normalized and cached. Chat turns do **not** re-hit ArcGIS/TranStats on every message.

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

OTP stays on the download → ingest → normalized cache path by design (not a workaround): TranStats flight-level On-Time Performance is not exposed as a chat-time REST query API.

### Why this architecture

- Satisfies the exam requirement to gather data from **public APIs** (ArcGIS REST + official BTS/FAA HTTP).
- Avoids brittle/slow ArcGIS calls on every chat turn via **provider + TTL disk cache**.
- Keeps scoring **deterministic** and independent of the LLM.
- No commercial aviation APIs.
- Live ADS-B overlays were out of scope for exam scoring and are not included.

**Regional ranking filters:** default min CY2024 enplanements (250k) plus exclusion of airports lacking OTP coverage in the loaded monthly extract, so missing congestion does not inflate ranks. New England membership is deterministic in code (`NEW_ENGLAND_STATES`); airport metadata comes from the Facilities provider when available.

**Long-haul threshold:** ≥ **1500 miles** (documented assumption). The exam does not prescribe a threshold; 1500 is applied deterministically in TypeScript.

### Voice (bonus)

- **TTS:** ElevenLabs HTTP API via Next.js `/api/tts`. API key stays server-side. Non-English prefers flash/turbo + `language_code`; `eleven_multilingual_v2` is fallback. Speaks English-only in the UI; truncates at 2500 characters.
- **STT (mic):** Browser `SpeechRecognition` for dictation into the chat box.
- Separate from FAA/BTS aviation data APIs.

## Tradeoffs

| Choice | Alternative | Rationale |
|---|---|---|
| Multi-month OTP/T-100 window from 2025-01 | Single latest month only | Full CY2025 coverage + less seasonal noise; end month still table-specific |
| Cached official extracts for scores | Live TranStats on every chat | Reliability + latency for demo |
| Explainable proxy score | Complex econometric model | Interview clarity, testability |
| LangChain `createAgent` | Custom LangGraph workflow | Sufficient orchestration, less ceremony |
| Long-haul ≥ 1500 miles | Ask LLM per flight | Deterministic, documented |
| Unmet-demand proxy | Claim official unmet demand | Honesty about data limits |

## Uncertainty

The expansion score is a **decision-support screen**, not a forecast of ROI, passenger diversion, or construction feasibility. Multi-month OTP/T-100 windows reduce single-month seasonality but still reflect publication lag and domestic coverage limits; incomplete small-airport OTP rows also reduce precision. The product should surface those caveats whenever material.

### Deterministic confidence

When structured airport score cards are present, UI confidence is **overridden server-side** from missing components among the top results:

- Complete components → High  
- One critical component missing (e.g. congestion) → Medium  
- Multiple critical gaps → Low  

For proxy / insight-only answers (unmet demand, congestion, long-haul) without ranking cards, confidence is capped at **Medium** with an explicit assumption line — never an unjustified High.

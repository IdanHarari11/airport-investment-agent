# Airport Investment Intelligence Agent

FDE take-home (Deloitte Digital): AI-assisted analyst tool for screening U.S. airports where terminal/capacity expansion may be attractive.

The LLM explains findings and selects tools. **All scores, rankings, congestion indices, long-haul shares, and unmet-demand proxies are computed in deterministic TypeScript** from cached public FAA/BTS data.

**Deliverables:** source code (this repo) · design doc → [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (scoring methodology · key tradeoffs · where/how AI is used).

## What it does

- Chat about airport expansion opportunity with conversational follow-ups
- Rank / compare airports with a defined Expansion Opportunity Score
- Congestion, long-haul share (≥1500 miles), and an **Estimated Unmet Demand Proxy**
- Surfaces assumptions, data periods, sources, and confidence in the UI
- Voice bonus: mic (browser STT) + English TTS (ElevenLabs)

## How to run locally

```bash
npm install
cp .env.example .env
# add OPENAI_API_KEY to .env
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | Yes | Chat / tool-calling model |
| `OPENAI_MODEL` | No | Defaults to `gpt-4o-mini` |
| `OPENAI_MAX_TOKENS` | No | Defaults to `16384`; values below `4096` are ignored so structured replies can finish |
| `LANGSMITH_TRACING` | No | Set `true` to enable tracing |
| `LANGSMITH_API_KEY` | No | LangSmith credentials |
| `LANGSMITH_PROJECT` | No | Optional project name |
| `ELEVENLABS_API_KEY` | For TTS speaker | ElevenLabs text-to-speech (bonus) |
| `ELEVENLABS_VOICE_ID` | No | Defaults to a multilingual voice |
| `ELEVENLABS_MODEL_ID` | No | Fallback model; non-English prefers flash/turbo + `language_code` |

LangSmith and ElevenLabs are optional. Chat runs with only `OPENAI_API_KEY`; speaker buttons need the ElevenLabs key.

## Chat sessions

Sessions are **private and browser-local** — there is **no account system** and **no server-side job queue**. Conversations live under `airport-agent:v1:store:{userId}` in `localStorage` on that device.

- Each `/api/chat` request sends history from the client (last 40 turns). The UI uses SSE (`status` / tools → `structured` cards → `answer_delta` → `final`); the browser owns the transcript.
- User turns are marked `pending` and persisted. Streaming UI updates stay in memory; only `final` writes the assistant reply into the conversation that started the request (`applyAssistantReply`), including after chat switches.
- Switching chats or **New chat** leaves other in-flight requests running. Only a newer send in the **same** conversation supersedes the previous turn.
- Refresh does **not** resume an SSE stream. Pending turns are rediscovered and **retried** after hydrate (`findPendingRetries`). Cancelled unload fetches are not saved as fake assistant failures (`isUnloadNetworkError`).
- Desktop: sidebar history. Mobile (`xl` and below): drawer for history / New chat / Reset. In-flight rows show a pulse while loading or still `pending`.
- **Reset local user** mints a new anonymous identity.
- Header: **Private local session · scores deterministic**.

Closing the tab stops client processing; the server does not continue a background job for you.

## Data sources (public government HTTP)

Data is gathered programmatically from **public government APIs/downloads**, normalized, then served from local cache. Chat turns use the hydrated provider rather than re-fetching ArcGIS on every message.

### REST APIs (provider + disk cache)

| Source | Endpoint | Cache | Used for |
|---|---|---|---|
| USDOT/BTS T-100 annual market | [ArcGIS FeatureServer](https://services.arcgis.com/xOi1kZaI0eWDREZv/ArcGIS/rest/services/T100_Domestic_Market_and_Segment_Data/FeatureServer/1) | `data/cache/t100-annual.json` | Annual market aggregates + provenance |
| NTAD Aviation Facilities (FAA) | [ArcGIS FeatureServer](https://services.arcgis.com/xOi1kZaI0eWDREZv/ArcGIS/rest/services/NTAD_Aviation_Facilities/FeatureServer/0) | `data/cache/airport-metadata.json` | Name, state, city, coordinates |

```bash
npm run refresh:apis          # fetch if stale
npm run refresh:apis -- --force
```

### BTS / FAA public download → ingest cache

| Source | Period | Used for |
|---|---|---|
| [FAA CY2024 Commercial Service Enplanements](https://www.faa.gov/airports/planning_capacity/passenger_allcargo_stats/passenger) | CY2023–CY2024 | Passengers, growth, market scale |
| [BTS Airline On-Time Performance](https://www.transtats.bts.gov/DL_SelectFields.aspx?gnoyr_VQ=FGJ&QO_fu146_anzr=b0-gvzr) | 2025-01..2026-06 | Delay rates, cancellations, congestion (multi-month aggregate; download-oriented per BTS) |
| [BTS T-100 Domestic Segment](https://www.transtats.bts.gov/DL_SelectFields.aspx?gnoyr_VQ=FIM&QO_fu146_anzr=Nv4%20Pn44vr45) | 2025-01..2026-04 | Seats, load factor, long-haul share (≥1500 miles; multi-month aggregate) |

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install openpyxl requests beautifulsoup4 lxml
npm run ingest   # → data/normalized/dataset.json (only runtime aviation file)
```

The UI Assumptions & sources panel shows which REST/download path was actually used and the data period.

## Voice (bonus)

| Direction | Provider | Notes |
|---|---|---|
| **Speak answer (TTS)** | [ElevenLabs](https://elevenlabs.io) Text-to-Speech API | English speaker only in UI. Non-English synthesis prefers flash/turbo + `language_code`; `eleven_multilingual_v2` is fallback. Text truncated at 2500 chars (`X-TTS-Truncated`). |
| **Mic input (STT)** | Browser `SpeechRecognition` | Mic language follows detected/sticky locale; transcript language is passed to the agent. |
| **Reply language** | Detected from speech/text | Agent answers in that language; speaker button stays English-only. |

Add to `.env`:

```bash
ELEVENLABS_API_KEY=...
# optional:
# ELEVENLABS_VOICE_ID=JBFqnCBsd6RMkjVDRZzb
# ELEVENLABS_MODEL_ID=eleven_multilingual_v2
```

## Example questions

Aligned with the FDE exam brief (plus useful follow-ups):

- Which airports in New England are strong candidates for terminal expansion?
- Compare LA and Santa Ana airport congestion levels.
- What is the percentage of long haul flights out of Anchorage airport?
- What is the unmet flight demand in SFO airport and why?
- Compare BOS and JFK.
- Why did airport A rank higher than airport B?
- What assumptions are you making?
- Until when is your aviation data current?

## Scoring methodology summary

**Expansion Opportunity Score** (cohort percentile components):

| Component | Weight | Signals |
|---|---:|---|
| Capacity / demand pressure | 30% | Load factor (growth scored separately) |
| Passenger growth | 25% | FAA CY23→CY24 enplanement growth |
| Congestion pressure | 20% | OTP delay/cancel index |
| Market scale | 15% | CY2024 enplanements |
| Route opportunity | 10% | Long-haul departure share |

Missing components stay `null` and are excluded (remaining weights renormalized). Scores come only from TypeScript; the LLM cannot alter them.

Regional ranking screens also apply a default **minimum 250,000 CY2024 enplanements** filter so tiny seasonal fields do not dominate growth percentiles. Explicit IATA comparisons skip that filter.

## Assumptions

- New England = CT, ME, MA, NH, RI, VT (code-defined)
- Long-haul = route distance **≥ 1,500 miles** (documented project definition)
- OTP metrics aggregate **2025-01..2026-06**; T-100 aggregates **2025-01..2026-04** (full calendar 2025 through each table’s latest public month; publication lag differs). Enplanements remain annual FAA CY2023–CY2024.
- Unmet demand is an **Estimated Unmet Demand Proxy**, not an official government series
- Dataset covers curated commercial airports (all New England + large/medium hubs + comparison set)

## Working status (UI)

While tools run, the Working card shows live tool rows. After tools finish and before answer tokens stream, `WorkingStatusLine` rotates short tips and **stops on the last tip**: *Almost ready — polishing the investment framing…*

## Scope notes

- Screening heuristic for analysts (decision support), with fixed scoring weights
- Multi-month OTP/T-100 windows reduce single-month seasonality but still reflect publication lag; T-100 is domestic U.S. carrier segment data
- Some small airports lack OTP coverage (`onTime: null`)

## Testing

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run exam:metrics   # deterministic 4 exam metrics (no LLM)
npm run exam:check     # full agent consistency (needs OPENAI_API_KEY)
```

Domain scoring/analytics tests run without an LLM API key.

### LangSmith debug

```bash
# .env: LANGSMITH_TRACING=true + LANGSMITH_API_KEY + LANGSMITH_PROJECT
npm run debug:langsmith
```

This runs one ANC long-haul turn, prints tool vs LLM timings, and lists recent LangSmith runs. Tools are expected to finish in ~1ms (local JSON); most wall time is ChatOpenAI.

## Project layout

```text
src/app/                 Next.js UI + /api/chat (+ /api/tts)
src/components/chat/     Chat UI
src/lib/chat/            localStorage session store
src/lib/agent/           LangChain tools, agent, prompts
src/lib/aviation/        Data provider + types + regions
src/lib/analytics/       Congestion, long-haul, unmet-demand
src/lib/scoring/         Deterministic score + rank
data/normalized/         dataset.json (committed public-data snapshot)
docs/ARCHITECTURE.md     Exam design doc (scoring · tradeoffs · AI usage)
scripts/ingest_bts.py    Re-ingest from FAA/BTS
tests/                   Vitest coverage
```

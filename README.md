# Airport Investment Intelligence Agent

AI-assisted analyst tool for screening U.S. airports where terminal/capacity expansion may be attractive.

The LLM explains findings and selects tools. **All scores, rankings, congestion indices, long-haul shares, and unmet-demand proxies are computed in deterministic TypeScript** from cached public FAA/BTS data.

## What it does

- Chat naturally about airport expansion opportunity
- Rank airports in a region (e.g. New England)
- Compare airports (e.g. LAX vs SNA, BOS vs JFK)
- Report congestion signals from BTS on-time data
- Report long-haul departure share with an explicit distance threshold
- Provide an **Estimated Unmet Demand Proxy** (clearly labeled as a proxy)
- Preserve conversational follow-ups

## Architecture overview

```text
Public government sources
       ↓
Data Providers (ArcGIS REST + BTS download ingest)
       ↓
Normalized aviation model → local cache
       ↓
Deterministic analytics / scoring
       ↓
LangChain tools → Agent → Next.js UI
```

## Deliverables

| Deliverable | Location |
|---|---|
| Source code | this repository |
| Design / architecture doc (scoring · tradeoffs · where AI is used) | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |

See also the scoring summary and assumptions below for a short interview-ready overview.


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
| `LANGSMITH_TRACING` | No | Set `true` to enable tracing |
| `LANGSMITH_API_KEY` | No | LangSmith credentials |
| `LANGSMITH_PROJECT` | No | Optional project name |
| `ELEVENLABS_API_KEY` | For TTS speaker | ElevenLabs text-to-speech (bonus) |
| `ELEVENLABS_VOICE_ID` | No | Defaults to a multilingual voice |
| `ELEVENLABS_MODEL_ID` | No | Fallback model; non-English prefers flash/turbo + `language_code` |

The app runs without LangSmith. Chat works without ElevenLabs; speaker buttons need the key.

## Privacy of chats (no account system)

- Each browser gets an anonymous **local user id** in `localStorage`.
- Conversations are saved only under that id on the device — other browsers/users do not see them.
- The server is **stateless** (history is sent per request) and never merges chats across clients.
- Use **Reset local user** in the sidebar to mint a new anonymous identity.

## Data sources (public government HTTP)

Data is gathered programmatically from **public government APIs/downloads**, normalized, then served from local cache. Chat turns do not re-fetch ArcGIS on every message.

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
npm run ingest   # → data/normalized/dataset.json
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

- Which airports in New England are strong candidates for terminal expansion?
- Compare LAX and SNA congestion levels.
- What percentage of long-haul flights depart from ANC?
- What is the estimated unmet flight demand at SFO and why?
- Compare BOS and JFK.
- Why did airport A rank higher than airport B?
- Show me the metrics behind that score.
- What assumptions are you making?

## Scoring methodology summary

**Expansion Opportunity Score** (cohort percentile components):

| Component | Weight | Signals |
|---|---:|---|
| Capacity / demand pressure | 30% | Load factor (growth scored separately) |
| Passenger growth | 25% | FAA CY23→CY24 enplanement growth |
| Congestion pressure | 20% | OTP delay/cancel index |
| Market scale | 15% | CY2024 enplanements |
| Route opportunity | 10% | Long-haul departure share |

Missing components stay `null` and are excluded (remaining weights renormalized). The LLM cannot alter scores.

Regional ranking screens also apply a default **minimum 250,000 CY2024 enplanements** filter so tiny seasonal fields do not dominate growth percentiles. Explicit IATA comparisons skip that filter.

## Assumptions

- New England = CT, ME, MA, NH, RI, VT (code-defined, not LLM-defined)
- Long-haul = route distance **≥ 1,500 miles** (documented project definition)
- OTP metrics aggregate **2025-01..2026-06**; T-100 aggregates **2025-01..2026-04** (full calendar 2025 through each table’s latest public month; publication lag differs). Enplanements remain annual FAA CY2023–CY2024.
- Unmet demand is a **proxy**, not an official government measurement
- Dataset covers curated commercial airports (all New England + large/medium hubs + comparison set)

## Known limitations

- Not a financial forecast or investment recommendation
- Monthly operational extracts can be seasonally skewed
- T-100 extract is domestic U.S. carrier segment data
- Some small airports lack OTP coverage (`onTime: null`)
- Scoring weights are fixed configuration (follow-ups cannot invent reweighted ranks)
- Custom weight scenarios are not supported as a tool — the agent must explain the limitation

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
src/app/                 Next.js UI + /api/chat
src/components/chat/     Chat interface
src/lib/agent/           LangChain agent, tools, prompts
src/lib/aviation/        Data provider + types + regions
src/lib/analytics/       Congestion, long-haul, unmet-demand, normalization
src/lib/scoring/         Deterministic score + rank
data/normalized/         Cached public dataset
tests/                   Vitest coverage
docs/ARCHITECTURE.md     Interview-friendly design notes
scripts/ingest_bts.py    Optional re-ingest from FAA/BTS
```

# V4 Trading Terminal — Detailed Status Document

> Superseded by `docs/V4 Trading Terminal - Feature Status v2 (2026-03-22).md` for the latest feature-by-feature status.

_Last updated: March 18, 2026_

---

## Executive Snapshot

Trading Terminal is a production-approaching, multi-domain institutional intelligence cockpit built as a pnpm monorepo. It targets professional and institutional trading operators who require not just execution tooling but AI-assisted macro, micro, supply chain, congressional, and geopolitical intelligence on a single integrated desktop surface.

**Current state characterization:**

- **Product identity:** Institutional, analytics-forward, AI-assisted. Not a retail terminal clone. The design language and domain coverage target operators who think in terms of capital flow, supply chain fragility, regulatory intelligence, and multi-asset regime positioning.
- **Desktop app:** Primary operator surface. 20 distinct pages, 7 core hotkey-navigable tabs, and an extended set of overlay/detached workspaces. Multiple data-rich intelligence canvases are implemented at the page level.
- **Backend:** Structurally production-capable. Auth/session/tenant/2FA hardening, queue-backed AI orchestration, PostgreSQL migrations with 12 ordered scripts, optional Redis, Prometheus metrics, and Zod-validated environment. Currently running as a companion service for the desktop with intentional migration flags for progressive centralization.
- **AI architecture:** No longer a single LLM call. The system has a durable job queue, per-module processor registration, idempotency keys, result caching, and a flexible provider strategy spanning local Ollama, OpenAI, Anthropic, Gemini, Mistral, Groq, and xAI.
- **Data intelligence graph:** A multi-zone entity-relationship graph (candidate → validation → production) with evidence provenance, confidence scoring, freshness tracking, export tooling, and a cloud-ready adapter surface. The local graph tooling is live; a live Data Vault cloud connection is not yet active in the desktop service.
- **Release maturity:** Windows NSIS installer published at version `0.0.1`, auto-update metadata (`latest.yml`) present, native module unpacking correctly configured. The product has crossed into distributable software territory.

---

## Verified Feature State — March 18, 2026

This section reflects the code paths that are actually present now, not the intended end-state architecture.

| Area         | Verified state now                                                  | What is working                                                                                                                                                                                                        | Current limits / conditions                                                                                                                                                                                          |
| ------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TED Intel    | Implemented and cross-wired                                         | Desktop fetches TED snapshots through `tedIntel:getSnapshot`; backend serves `/api/tedintel/snapshot`; renderer panels are embedded in Intelligence, Panorama, Data Vault, Supply Chain, and GWMD                      | If backend TED is unreachable, desktop falls back to deterministic local snapshot generation. Live TED ingestion is optional and depends on saved endpoint/key config                                                |
| Data Vault   | Implemented locally, cloud-ready only                               | Full desktop page with dashboard, sections, detail drill-down, revalidation queueing, JSON/CSV export, snapshot opening, and TED Vault overlay                                                                         | `Sync` is not live in the desktop flow today. Cloud readiness is surfaced as prepared/not connected, and the current service returns a placeholder cloud status rather than an active remote adapter                 |
| Supply Chain | Implemented with local/backend dual path                            | Renderer supports strict official-only mode, hypothesis toggle, hops, edge-weight filter, multiple visual modes, shock simulation, global map window, advisor, enrichment inspector, cache refresh, and export tooling | Backend route is preferred when authenticated, but desktop can fall back to local official-source generation when allowed by runtime flags. Output quality still depends on source coverage and enrichment freshness |
| GWMD         | Implemented with persistence, display modes, and backend sync hooks | Search, scoped/all reload, parse-fail handling, degraded-cache mode, coordinate repair attempts, multi-monitor wall/analyst/mirror modes, local persistence, and backend push/pull/status sync APIs                    | Cloud sync requires backend auth plus backend DB support. Without that, status returns unavailable/auth-required. Search can degrade to cache or fail on model parse quality                                         |

### Function-by-function reality for the priority areas

- TED Intel
- `Settings & Logs` exposes live TED config for base URL, API key, auth header, timeout, and window query parameter.
- Desktop stores TED config locally and also attempts to mirror it to the backend when the backend is reachable.
- Snapshot consumption is already integrated into Intelligence (`TedRadarPanel`), Panorama (`TedDemandPulsePanel`), Data Vault (`TedDataVaultPanel`), Supply Chain overlays, and GWMD overlays.
- The system is resilient by design: local snapshot fallback keeps these panels populated even if live TED is disabled or the backend call fails.

- Data Vault
- `DataVault.tsx` is not a stub. It drives `graphMemory:getDashboard`, `getSection`, `getDetail`, `refresh`, `revalidateSelected`, `exportNow`, `getExportsManifest`, `openLatestSnapshot`, and `revealPath`.
- The nine sections are real UI sections, but `cloud` and `settings` currently resolve to the same cloud-readiness payload rather than a live cloud control plane.
- Revalidation is implemented as queue insertion into the graph enrichment repository, not immediate validation execution.
- Export is live and backed by snapshot/JSON/CSV file generation; opening the latest snapshot is wired through Electron shell APIs.
- The current cloud message is explicit in code: cloud structure is prepared, but no live Data Vault server is connected yet.

- Supply Chain
- Desktop generation prefers backend `/api/ai/supplychain/generate` when authenticated.
- If backend generation fails and local fallback is allowed, the desktop runs local `generateOfficialSupplyChain(...)` and then ingests the result into graph enrichment.
- The renderer already supports strict official filtering, hypothesis visibility, graph cache refresh, auto-refresh after stale cache hits, shock simulation, and a detached global map.
- The Supply Chain page also exposes a graph enrichment memory inspector with refresh, export, maintenance, and cached subgraph lookup actions.

- GWMD
- GWMD search is not just a front-end visualization. It calls `companyRelationshipService.generateRelationships(...)`, persists companies/relationships, broadcasts graph updates, and ingests the mapped result into graph enrichment.
- Runtime status is explicit: `ok`, `degraded_cache`, `parse_fail`, or `error`.
- `loadAll` repairs missing coordinates when possible before returning the persisted graph snapshot.
- Multi-display support is operational in the main process through display selection, monitor enumeration, wall surface open/close, and broadcast-based synchronization.
- Backend sync exists for push, pull, and status, but only works when authentication is bound and the backend has GWMD cloud storage available.

---

## Monorepo and Package Topology

The repository is organized as a typed pnpm workspace:

| Package       | Path              | Role                                                              |
| ------------- | ----------------- | ----------------------------------------------------------------- |
| `@tc/desktop` | `apps/desktop`    | Electron app — primary operator surface                           |
| `@tc/backend` | `apps/backend`    | TypeScript/ESM Express server — auth, AI orchestration, data APIs |
| `@tc/shared`  | `packages/shared` | Cross-runtime domain types, adapters, and intelligence structs    |
| `@tc/api`     | `packages/api`    | API boundary contracts                                            |

**Root workspace:** Manages dev orchestration (`pnpm --filter @tc/desktop dev`), `tsconfig.base.json` for project references, and workspace-wide dependency coherence.

All packages currently target version `0.0.1`.

---

## Desktop Application — Full Structure

### Runtime stack

| Layer                | Technology                                      |
| -------------------- | ----------------------------------------------- |
| Host process         | Electron 30.x                                   |
| Renderer bundler     | Vite (dev server with dynamic port negotiation) |
| Main/preload bundler | Custom esbuild pipeline                         |
| UI framework         | React 18 + Zustand state                        |
| Charts               | `lightweight-charts`                            |
| Maps                 | `maplibre-gl`                                   |
| 3D / fiber           | `three` + `@react-three/fiber`                  |
| Local DB             | `better-sqlite3` (asar-unpacked)                |
| Secure credentials   | `keytar` (asar-unpacked)                        |
| Auto-update          | `electron-updater`                              |
| AI worker            | `worker_threads` (`aiResearchWorker.ts`)        |

### Page and workspace roster

The renderer currently hosts 20 pages, navigated via the App-level router:

#### Core tabbed workspaces (hotkey 1–7)

| Hotkey | Tab ID         | Label           |
| ------ | -------------- | --------------- |
| 1      | `panorama`     | PANORAMA        |
| 2      | `microscape`   | MICROSCAPE      |
| 3      | `structure`    | STRUCTURE       |
| 4      | `flow`         | FLOW            |
| 5      | `execute`      | EXECUTE         |
| 6      | `journal`      | JOURNAL         |
| 7      | `settingsLogs` | SETTINGS & LOGS |

#### Extended intelligence surfaces (overlay/detached pages)

| Page file                  | Surface name            | Description                                                                            |
| -------------------------- | ----------------------- | -------------------------------------------------------------------------------------- |
| `Panorama.tsx`             | PANORAMA                | Macro overview, US large-cap panel, index futures                                      |
| `Cam.tsx`                  | CAM                     | Capital Action Monitor                                                                 |
| `Macro.tsx`                | MACRO                   | Macro regime and economic calendar                                                     |
| `Microscape.tsx`           | MICROSCAPE              | Individual stock deep-dive                                                             |
| `Structure.tsx`            | STRUCTURE               | Options/vol structure charting                                                         |
| `Flow.tsx`                 | FLOW                    | Order flow and dark pool indicators                                                    |
| `Execute.tsx`              | EXECUTE                 | Execution panel, order ticket                                                          |
| `Journal.tsx`              | JOURNAL                 | Trade journal                                                                          |
| `SettingsLogs.tsx`         | SETTINGS & LOGS         | App settings, AI config, logs viewer                                                   |
| `LocalAI.tsx`              | TERMINAL AI             | AI Research config, focus prompt, briefings, runtime control (Ollama + cloud fallback) |
| `Intelligence.tsx`         | INTELLIGENCE            | AI research briefs + Public Flow Intelligence panel                                    |
| `CongressActivity.tsx`     | CONGRESS ACTIVITY       | Congressional trade disclosures, lobbying, federal contracts, AI analysis              |
| `SupplyChainMindMap.tsx`   | SUPPLY CHAIN MIND MAP   | Multi-view interactive supply chain intelligence canvas                                |
| `DataVault.tsx`            | DATA VAULT              | Graph memory/enrichment explorer with 9 sections                                       |
| `GlobalSupplyChainMap.tsx` | GLOBAL SUPPLY CHAIN MAP | Global map view of multi-ticker supply chain graphs                                    |
| `GwmdMapPage.tsx`          | GWMD MAP                | Global World Mind-Map — multi-monitor support, wall/analyst/mirror modes               |
| `ApiHub.tsx`               | API HUB                 | Secure credential vault for all API provider integrations                              |
| `SmartRoutingOverview.tsx` | SMART ROUTING           | Visual overview of data routing from sources to intelligence destinations              |
| `CargoFlightsMap.tsx`      | CARGO FLIGHTS           | Real-time cargo flight tracking on MapLibre GL map                                     |
| `OilTankerMap.tsx`         | OIL TANKERS             | Real-time oil tanker tracking on MapLibre GL map                                       |

### App shell behavior

- **Window management:** First-class detached-tab model. Tabs can be popped out as independent windows. A `BroadcastChannel` keeps state synchronized across windows.
- **Market status display:** Live/replay/simulated stream state and heartbeat visibility in the header.
- **Update lifecycle:** `window.updates` preload API exposes `onAvailable`, `onDownloaded`, and `install` for the full electron-updater update arc.
- **Theming and profile:** `themeStore` and `uiProfile` stores control colorway and user profile rendering.
- **Layout presets:** Supported presets: `Morning Open`, `Midday Scan`, `Closing Focus`.
- **Error boundaries:** Component-level error boundary wrapping for graceful fault isolation in renderer.

### Renderer state stores (Zustand)

| Store                  | Purpose                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `streamStore`          | Stream state — live/replay/demo, heartbeat, connection health                            |
| `streamController`     | Orchestrates producer start/stop, connects stream to store                               |
| `tradingStore`         | Positions, orders, account, active symbol, market focus                                  |
| `configStore`          | Backend URL, connection state, runtime flags                                             |
| `settingsStore`        | User settings, AI engine preference, cloud AI models, external feeds config, alert rules |
| `aiResearchStore`      | AI research briefs, config, runtime status, cloud model list, focus draft                |
| `aiStewardStore`       | AI Steward config, findings, tasks, module states                                        |
| `supplyChainStore`     | Supply chain graph, mind map data, view mode, simulation state                           |
| `gwmdMapStore`         | GWMD graph, search state, companies, cloud sync state, filter state                      |
| `publicFlowIntelStore` | Public flow intelligence events, sector themes, watchlist candidates                     |
| `indicatorStore`       | Technical indicator computed values                                                      |
| `orderTicketStore`     | Order ticket draft state                                                                 |
| `riskStore`            | Risk metrics                                                                             |
| `strategyStore`        | Active strategy config                                                                   |
| `themeStore`           | Dark/light theme, colorway                                                               |

### Main process service layer

The Electron main process hosts a rich set of services that act as the local intelligence engine:

#### Streaming

| File                | Role                                                  |
| ------------------- | ----------------------------------------------------- |
| `alpacaProducer.ts` | Alpaca WebSocket market data producer                 |
| `demoProducer.ts`   | Demo/simulation data producer                         |
| `streamManager.ts`  | Manages active producer lifecycle                     |
| `eventBus.ts`       | In-process event bus between producers and IPC bridge |
| `ipcStreaming.ts`   | IPC channel connecting stream events to renderer      |

#### AI Research

| File                   | Role                                                        |
| ---------------------- | ----------------------------------------------------------- |
| `aiResearchManager.ts` | Manages research runs, brief lifecycle, config persistence  |
| `aiResearchWorker.ts`  | Dedicated `worker_threads` worker for AI LLM research calls |
| `workerHarness.ts`     | Worker setup and message handling harness                   |
| `dedupe.ts`            | Deduplication logic across brief runs                       |
| `normalize.ts`         | Brief normalization and structuring                         |
| `schemas.ts`           | Zod schemas for research I/O                                |
| `adapters/`            | Adapters translating between LLM output and domain structs  |

#### LLM Clients (Cloud)

| File                | Role                                         |
| ------------------- | -------------------------------------------- |
| `openaiClient.ts`   | OpenAI API client                            |
| `geminiClient.ts`   | Google Gemini API client                     |
| `cloudLlmClient.ts` | Generic cloud LLM client abstraction         |
| `cloudLlmConfig.ts` | Cloud LLM configuration and provider routing |

#### Supply Chain Intelligence

| File                      | Role                                               |
| ------------------------- | -------------------------------------------------- |
| `companyGeo.ts`           | Company geolocation resolution                     |
| `dataValidator.ts`        | Supply chain data validation                       |
| `mindMapEnricher.ts`      | AI-driven mind-map enrichment                      |
| `officialDocIngestion.ts` | Official document (SEC filings, IR docs) ingestion |
| `officialExtraction.ts`   | Entity/relationship extraction from official docs  |
| `officialSupplyChain.ts`  | Supply chain inference from official sources       |
| `ollamaSupplyChain.ts`    | Ollama-backed supply chain generation              |
| `data/`                   | Seed and reference data                            |

#### Graph Enrichment (Data Vault backend)

This is one of the most architecturally significant subsystems. It implements a multi-zone knowledge graph of entities and relationships:

**Entity types tracked:** `company`, `supplier`, `facility`, `warehouse`, `port`, `airport`, `regulator`, `vessel`, `route`, `product_group`, `region`, `country`, `chokepoint`

**Relationship types:** `owns`, `operates`, `supplies`, `ships_to`, `depends_on`, `located_at`, `exposed_to`, `near`, `subsidiary_of`, `linked_to`, `candidate_link`

**Evidence source types:** `sec_filing`, `annual_report`, `ir_presentation`, `press_release`, `regulator_dataset`, `other_official`, `manual`, `ai_extraction`

**Zone lifecycle:** `candidate` → `validation` → `production`

**Validation statuses:** `unvalidated` → `pending_validation` → `validated` / `contradicted` / `rejected`

**Cache temperatures:** `hot`, `warm`, `cold`

| File            | Role                                                     |
| --------------- | -------------------------------------------------------- |
| `service.ts`    | Core graph enrichment service with entity/edge lifecycle |
| `repository.ts` | SQLite-backed persistence for entities, edges, evidence  |
| `cloud.ts`      | Cloud sync for graph snapshots                           |
| `exporter.ts`   | Export to JSON/CSV snapshot formats                      |
| `config.ts`     | Enrichment configuration resolution                      |
| `types.ts`      | Full type taxonomy for graph objects                     |
| `validator.ts`  | Score clamping and integrity validation                  |

#### Graph Memory

| File         | Role                                                |
| ------------ | --------------------------------------------------- |
| `service.ts` | Graph memory service wrapping enrichment repository |
| `index.ts`   | IPC handler registration                            |

#### GWMD (Global World Mind-Map Data)

| File                            | Role                                                         |
| ------------------------------- | ------------------------------------------------------------ |
| `companyRelationshipService.ts` | Multi-hop company relationship search and graph construction |

#### Congress Intelligence

| File                     | Role                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| `congressDataService.ts` | Ingestion, staleness tracking, and data fetch for congressional trades, lobbying, contracts |
| `aiCongressIntel.ts`     | AI-driven analysis of congressional trade patterns                                          |

Shared domain models in `packages/shared/src/congress/`:

- `congressionalTrade.ts`
- `congressionalMember.ts`
- `lobbyingActivity.ts`
- `federalContract.ts`
- `companyTickerMapping.ts`
- `dataIngestionLog.ts`

#### Public Flow Intelligence

A multi-stage pipeline that transforms raw disclosure filings into structured investment signals:

| File                                    | Role                                                               |
| --------------------------------------- | ------------------------------------------------------------------ |
| `pipeline.ts`                           | Orchestrates the full ingest → enrich → score → output pipeline    |
| `connectors/liveDisclosureConnector.ts` | Live disclosure data ingestion                                     |
| `connectors/localImportConnector.ts`    | Local file import connector                                        |
| `connectors/seedConnector.ts`           | Seed data connector for testing/demo                               |
| `enrichment.ts`                         | Multi-source entity enrichment                                     |
| `normalization.ts`                      | Normalize disclosure events to canonical form                      |
| `themeEngine.ts`                        | Theme detection and sector classification                          |
| `themeExtractor.ts`                     | LLM-assisted theme extraction                                      |
| `valuation.ts`                          | Valuation tagging per disclosure/entity                            |
| `getValuations.ts`                      | Valuation retrieval with caching                                   |
| `candidateRanker.ts`                    | Scores and ranks watchlist candidates                              |
| `watchlistAggregator.ts`                | Aggregates ranked candidates into watchlist                        |
| `secondOrder.ts`                        | Second-order signal derivation (cross-symbol momentum correlation) |
| `recomputeIntel.ts`                     | Recompute pipeline with cache invalidation                         |
| `seedLoader.ts`                         | Seed data loading                                                  |
| `ingest.ts`                             | Ingestion entry point                                              |
| `service.ts`                            | Public service interface                                           |

#### Economic Calendar

| File                 | Role                                        |
| -------------------- | ------------------------------------------- |
| `insightsService.ts` | AI-driven economic event insight generation |

#### External Feeds

Government and regulatory data adapters:

| Provider                    | Adapter              | Auth    |
| --------------------------- | -------------------- | ------- |
| CFTC Commitments of Traders | `cftcCotAdapter.ts`  | None    |
| BLS JOLTS                   | `blsJoltsAdapter.ts` | API key |
| SEC EDGAR                   | `secEdgarAdapter.ts` | None    |

Each provider has a `testProbe` for live connectivity verification.

#### Capital Momentum

`CapitalMomentumService` implements a regime-aware multi-factor scoring engine:

**Input factors:**

- `price`, `atr`, `realizedVol`, `emaFast`, `emaSlow`
- `close20HighDistancePct`, `relativeStrength`, `breakoutStrength`, `volumeRatio`
- Flow composite: `publicFlowBuy`, `themeAccel`, `congressNetBuy`, `secondOrderMomentum`
- `regimeMode` (drives weight adjustment)

**Score components:** trend (30%), flow (35%), breakout (remaining) — weights are regime-adjusted.

**Risk guards:** crash kill ATR multiple (2.5×), max new positions/day (2), min thresholds for trend, vol, and breakout.

**Correlation tracking:** Tracks correlation samples across `breakout`, `theme`, and `secondOrder` for adaptive weighting.

#### AI Steward

`AiStewardService` is an EventEmitter-based compliance guardian and data health monitor:

**CFTC module:** Compares local vs. remote CFTC snapshot using `describeDelta`. Detects position divergence and recommends or auto-applies corrections.

**Congress module:** Monitors staleness of congressional trades (24h), lobbying records (7d), and federal contracts (3d). Generates findings for stale domains.

**Default model:** `deepseek-r1:14b` (overridable via global AI model setting)

**Modes:** `suggest` (finding-only) and `autoFix` (autonomous correction)

**Output types:**

- `AiStewardFinding` — a flagged anomaly or health issue
- `AiStewardTask` — an actionable remediation step
- `AiStewardModuleState` — current health (`ok` / `degraded` / `unavailable`) per module

#### AI Orchestrator

`centralAIOrchestrator.ts` — tracks cross-module AI interactions, user-scoped prediction pre-loading, and usage stats.

#### Central AI provider API

`apiHub.ts` — secure credential store for all API integrations (backed by Electron `keytar`).

`apiKeyValidator.ts` — validates provider API key format and connectivity.

**Supported provider categories (Smart Routing):**

| Category            | Providers                   |
| ------------------- | --------------------------- |
| Brokerage Execution | Alpaca, Interactive Brokers |
| Market Data         | Polygon.io, Finnhub         |
| Alternative Data    | Quiver                      |
| Crypto Access       | Coinbase Advanced           |
| Government Data     | BLS JOLTS                   |
| Custom              | Any via `other` template    |

**Routing destinations:**

- `marketDataLayer` → Charts, scanners, live surfaces
- `aiBriefings` → Research briefings, macro explainers
- `aiSteward` → Compliance guardian + monitors
- `externalFeeds` → CFTC, SEC, BLS, supply chain modules

#### Web Search

`webSearch.ts` — AI-accessible web search for context enrichment during research runs.

### Desktop persistence layer (SQLite)

| Repo                      | Tables / Data                                                      |
| ------------------------- | ------------------------------------------------------------------ |
| `aiResearchRepo.ts`       | AI research briefs, run history                                    |
| `congressRepo.ts`         | Congressional trades, members, lobbying, contracts, ingestion logs |
| `gwmdMapRepo.ts`          | GWMD graph entities and edges, peristed across sessions            |
| `publicFlowRepo.ts`       | Disclosure events, sector themes, valuations, watchlist candidates |
| `supplyChainGraphRepo.ts` | Graph enrichment entities, edges, evidence, snapshots              |
| `supplyChainRepo.ts`      | Mind-map data, AI-generated supply chain results                   |

All repos are backed by `better-sqlite3` with `db.ts` managing the connection and schema bootstrap.

---

## Backend Service — Full Structure

### Core profile

TypeScript ESM Express server with:

- CORS and JSON middleware
- `Zod`-validated environment config (`AppEnv`)
- `pino`-based structured logging
- Prometheus-compatible metrics (`prom-client`)
- Graceful shutdown path
- Process-level unhandled rejection guard
- Optional PostgreSQL (primary) and in-memory fallback
- Optional Redis (cache) with in-memory fallback

### Backend service modules

| Module            | File                                                   | Role                                                            |
| ----------------- | ------------------------------------------------------ | --------------------------------------------------------------- |
| AI Research       | `services/aiResearch/`                                 | Queue-backed research runs, brief storage, Ollama model listing |
| AI Congress       | `services/congress/aiCongressService.ts`               | AI analysis of congressional trade patterns                     |
| Supply Chain      | `services/supplyChain/supplyChainService.ts`           | Supply chain generation and cached insight retrieval            |
| GWMD Cloud        | `services/gwmd/gwmdCloudService.ts`                    | Push/pull GWMD graph snapshots with cloud storage               |
| AI Orchestrator   | `services/orchestrator/aiOrchestratorService.ts`       | Cross-module interaction tracking, prediction preload           |
| AI Steward        | `services/steward/aiStewardService.ts`                 | Findings/tasks API, module run commands                         |
| Economic Insights | `services/economicCalendar/economicInsightsService.ts` | AI-generated economic event commentary                          |
| Ollama            | `services/ollama/ollamaClient.ts`                      | Ollama server communication                                     |

### Authentication and session system

The auth system is significantly hardened beyond a demo-grade token implementation:

**Lifecycle:** signup → login → access token → refresh token rotation → me → logout

**Security features:**

- Refresh token storage with hashed reuse detection
- Defensive session revocation on refresh reuse
- `AuthSessionStore`-based token revocation checks (optional Redis-backed)
- TOTP (2FA): setup, verify, disable
- Recovery code generation with bcrypt hashing
- Auth audit event writes
- Optional auth email on signup (`authEmail.ts`)
- Role enforcement toggle (`AUTH_RBAC_ENFORCED`)
- License key validation on signup and login

### Multi-tenancy

- `attachTenantContext` middleware injects `tenantId` on every request
- Default tenant fallback for single-tenant deployments
- Tenant-scoped rate limiting and cache keys
- Tenant context propagates into AI service calls and cache layers

### AI job queue (`DurableJobQueue`)

The queue is the backbone of all async AI operations:

| Parameter       | Configured via             |
| --------------- | -------------------------- |
| Concurrency     | `AI_QUEUE_CONCURRENCY`     |
| Max queued jobs | `AI_QUEUE_MAX`             |
| Retry limit     | `AI_QUEUE_RETRY_LIMIT`     |
| Job TTL         | `AI_QUEUE_JOB_TTL_SECONDS` |

**Processor registrations:** research, congress analysis, supply chain generation, economic calendar insighting.

**Idempotency:** Optional idempotency key per job prevents duplicate expensive AI calls.

**Response semantics:** HTTP 200 for jobs completing within wait window; HTTP 202 for jobs that are still queued.

### Metrics and observability

- `httpRequestCounter` — per-route request counts
- `httpErrorCounter` — per-route error counts
- `httpRequestDurationMs` — per-route latency histogram
- `aiQueueGauge` — current queue depth
- `aiQueueRunningGauge` — currently executing AI jobs
- `/metrics/prometheus` — Prometheus scrape endpoint
- `/metrics` — JSON operational metrics
- `readWsMetrics` — WebSocket connection metrics injected at server creation

### Database migrations

12 ordered SQL migrations with automatic `schema_migrations` tracking:

| #   | Migration                   | Description                                   |
| --- | --------------------------- | --------------------------------------------- |
| 001 | `normalized_core`           | Core schema for trades, positions, account    |
| 002 | `migrate_from_user_state`   | Migrates legacy user state data               |
| 003 | `ai_research_briefs`        | Research briefs table                         |
| 004 | `ai_congress`               | AI congressional intelligence store           |
| 005 | `ai_orchestrator`           | AI interaction tracking tables                |
| 006 | `ai_steward`                | AI Steward findings and tasks                 |
| 007 | `supply_chain_cache`        | Supply chain result cache and graph data      |
| 008 | `auth_identity_foundation`  | Users, sessions, roles, auth events           |
| 009 | `auth_users_license_key`    | License key column for user records           |
| 010 | `tenant_id_foundation`      | Tenant table and tenant_id columns            |
| 011 | `tenant_unique_constraints` | Unique constraints scoped per tenant          |
| 012 | `gwmd_cloud`                | GWMD cloud sync metadata and snapshot records |

---

## API Endpoint Map

### Platform runtime

- `GET /health` — version, status, uptime, optional DB/Redis checks
- `GET /metrics/prometheus` — Prometheus scrape
- `GET /metrics` — JSON operational metrics
- `GET /runtime-flags` — Active migration toggles exposed to desktop

### Auth and identity

- `POST /auth/signup` — License key + email/password signup
- `POST /auth/login` — Login with license check
- `POST /auth/refresh` — Token rotation with reuse detection
- `GET /auth/me` — Authenticated user profile
- `POST /auth/logout` — Session invalidation
- `POST /auth/totp/setup` — TOTP secret generation
- `POST /auth/totp/verify` — TOTP code verify and enable
- `POST /auth/totp/disable` — Disable TOTP

### User and trading state

- `GET/PUT /user/settings`
- `GET/PUT /user/watchlists`
- `GET /account`, `GET /positions`, `GET /orders`
- `POST /orders` (place), `DELETE /orders/:id` (cancel)

### Congress intelligence

- `GET /congress/trades` (list/filter)
- `GET /congress/members/query`
- `GET /congress/trades/query`
- `GET /congress/lobbying/query`
- `GET /congress/contracts/query`
- `GET /congress/most-traded`
- `GET /congress/disclosure-lag`
- `POST /congress/fetch` (manual ingestion trigger)

### Public flow intelligence

- `GET /public-flow/events`
- `GET /public-flow/disclosure-events`
- `GET /public-flow/sector-themes`
- `GET /public-flow/watchlist-candidates`
- `GET /public-flow/valuation-tags`
- `POST /public-flow/refresh`

### Supply chain intelligence

- `POST /supply-chain/create` — Generate supply chain map
- `GET /supply-chain/cached-keys` — List cached company maps
- `DELETE /supply-chain/cache` — Clear all cached maps
- `POST /supply-chain/ai/generate` — Full AI-backed generation (queued)
- `GET /supply-chain/ai/insights/:company` — Retrieve AI insights
- `GET /supply-chain/ai/cache` — List AI-generated cache entries

### AI research

- `GET /ai/models` — List available Ollama models
- `POST /ai/research/run` — Queue or run research brief
- `GET /ai/research/status/:jobId` — Job status
- `DELETE /ai/research/cancel/:jobId` — Cancel job
- `GET /ai/research/briefs` — List stored briefs
- `GET/PUT /ai/research/config` — Research config
- `GET /ai/research/status` — Runtime status

### Economic calendar AI

- `POST /ai/calendar/insight` — Generate AI insight for an economic event

### AI congress

- `POST /ai/congress/analyze` — Queue AI analysis of trade records
- `GET/POST /ai/congress/watchlist` — AI watchlist management
- `DELETE /ai/congress/watchlist/:id` — Dismiss watchlist entry

### GWMD cloud sync

- `POST /gwmd/sync/push` — Push graph snapshot
- `POST /gwmd/sync/pull` — Pull snapshot (optional incremental window)
- `GET /gwmd/sync/status` — Sync status with short-lived cache

### AI orchestrator

- `POST /ai/orchestrator/interaction` — Record interaction
- `GET /ai/orchestrator/predictions` — Retrieve pre-loaded predictions
- `GET /ai/orchestrator/stats` — User-scoped stats

### AI Steward

- `GET /ai/steward/overview` — Health and module states
- `GET/PUT /ai/steward/config` — Steward configuration
- `POST /ai/steward/run-module` — Trigger specific module check
- `GET /ai/steward/findings` — List findings
- `DELETE /ai/steward/findings/:id` — Dismiss finding
- `GET /ai/steward/tasks` — List tasks
- `POST /ai/steward/tasks/:id/apply` — Apply task

### AI provider visibility

- `GET /ai/providers` — Exposes active model/provider posture to desktop settings workflows

---

## AI Architecture — Current State

The AI architecture has evolved past a simple synchronous LLM call model into a proper multi-tiered processing system:

### Provider strategy

| Provider       | Client            | Features routed                                 |
| -------------- | ----------------- | ----------------------------------------------- |
| Ollama (local) | `ollamaClient.ts` | Research, supply chain, congress, steward, CFTC |
| OpenAI         | `openaiClient.ts` | Research, supply chain (cloud fallback)         |
| Google Gemini  | `geminiClient.ts` | Research, supply chain (cloud fallback)         |
| Anthropic      | Env key           | Routable per feature                            |
| Mistral        | Env key           | Routable per feature                            |
| Groq           | Env key           | Routable per feature                            |
| xAI            | Env key           | Routable per feature                            |

**Feature routing:** Each AI feature (`research`, `supplyChain`, `congress`, `cftc`) can be independently routed to a specific provider+model via `AiFeatureRouting`.

**Engine preference modes:** `cloud-first`, `cloud-only`, `local-only` — controls fallback behavior when a provider is unavailable.

**Per-model config:** `CloudAiModelConfig` includes `provider`, `model`, `tier` (standard/advanced/expert), `temperature`, `maxTokens`, feature-specific enable flags (`useForResearch`, `useForSupplyChain`, etc.), and usage timestamps.

### Worker isolation

AI research runs execute in a dedicated `worker_threads` worker (`aiResearchWorker.ts`) to prevent LLM call latency from blocking the Electron main process IPC loop. The `workerHarness.ts` manages message passing between the worker and parent.

### Caching strategy

- Tenant-scoped and user-scoped cache layers on expensive responses
- Supply chain result cache (TTL-based) backed by SQLite
- Graph enrichment entity/edge cache with temperature tracking (hot/warm/cold)
- GWMD cloud sync status cache (short-lived in-memory)
- AI brief deduplication via `dedupe.ts` to prevent redundant research on identical subjects

---

## Supply Chain Intelligence — Detailed State

This is one of the deepest working modules in the terminal. The current implementation combines official document parsing, optional AI-assisted enrichment, graph persistence, graph-enrichment ingestion, global-map detachment, and interactive simulation controls.

### Intelligence workspace settings (per-session)

The `SupplyChainMindMap` workspace exposes a verified working control surface:

| Setting              | Verified current behavior                                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Hops                 | Slider-backed hop depth, currently 1–3                                                                                                 |
| Min edge weight      | Slider-backed edge threshold                                                                                                           |
| Strict official-only | Filters toward verified official evidence                                                                                              |
| Show hypotheses      | Reintroduces hypothesis-layer edges/nodes                                                                                              |
| View mode            | Store supports `hierarchy`, `flow`, `impact`, `radial`, `risk`, `shock`, `global`                                                      |
| Workspace settings   | Scenario, horizon, data style, confidence threshold, ranking/exposure method, and overlays are present in the workspace settings model |

### Visualization modes

The current renderer/store combination supports these active modes:

- `FlowDiagram` — directed supply chain flow graph
- `HierarchicalTree` — tree layout
- `RadialEcosystem` — radial relationship layout
- `Impact` / `Risk` views — risk and exposure analysis lenses
- `Shock` mode — node failure simulation using the shared supply-chain simulation engine
- `Global` — detached global supply chain map window

### Enrichment inspector

The page exposes a working graph-enrichment inspector showing and triggering:

- Total entities, edges, candidate/validation/production counts
- Stale entity list with confidence and freshness scores
- Low-confidence edge list with validation status
- JSON/CSV export actions
- Maintenance run action for stale/revalidation housekeeping
- Cached subgraph lookup by entity/alias
- Cloud-ready sync metadata, which is currently informational rather than a live remote session

### Data sourcing tiers

1. **Official-source pipeline** — `generateOfficialSupplyChain(...)` is the current local generation backbone and persists evidence/documents into the supply-chain graph repository.
2. **Backend preferred path** — when authenticated, desktop first attempts `/api/ai/supplychain/generate` through `BackendApiClient`.
3. **Local fallback path** — if backend generation fails and runtime flags allow fallback, desktop generates locally and still ingests the result into graph enrichment.
4. **Advisor and enrichment tooling** — the workspace also exposes advisor, export, cached graph refresh, and graph-memory inspector utilities around the generated graph.

---

## GWMD Map — Detailed State

The GWMD (Global World Mind-Map Data) map is the global geospatial view of company relationship networks.

### Multi-monitor display architecture

The map supports a professional multi-display deployment model:

| Mode       | Description                                |
| ---------- | ------------------------------------------ |
| `standard` | Single display normal operation            |
| `wall`     | Full multi-monitor trading wall projection |
| `analyst`  | Analyst workstation layout                 |
| `mirror`   | Mirrored display mode                      |

Wall sessions use `BroadcastChannel` sync (`gwmd-wall-sync` prefix) with a 20-minute session TTL. The map queries monitor enumeration (`GwmdDisplayMonitor`) including bounds, work area, scale factor, rotation, and touch support.

### Cloud sync

- `pushToCloud` — Push current graph snapshot to backend GWMD cloud endpoint
- `pullFromCloud` — Pull incremental or full snapshot
- `refreshCloudSyncStatus` — Retrieve sync status
- `syncState` — Reactive sync status shown in UI

Current operational constraint: GWMD sync is only live when the desktop has a bound auth token and the backend has GWMD cloud storage configured. If the backend database/cloud layer is absent, status is unavailable and the desktop stays local-first.

### Search and session persistence

- Incremental company search with `searchTrace` phases and explicit run status (`ok`, `degraded_cache`, `parse_fail`, `error`)
- Relationship results are persisted to `gwmdMapRepo.ts` and mapped into graph enrichment after successful search
- `loadAll` and `loadScoped` rebuild the graph from persisted GWMD company/relationship tables
- Missing-coordinate repair is attempted during `loadAll`
- Multi-monitor wall, analyst, and mirror display modes are active in the main process and synchronized with broadcast events
- There is a local fallback path in the renderer store to reuse `supplyChain:generate` if dedicated GWMD IPC is unavailable

---

## Data Vault — Detailed State

The Data Vault page (`DataVault.tsx`) is a full-featured browser for the graph enrichment database.

### Sections

| Section             | Content                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Overview            | Total entity/edge/evidence counts, zone distribution, freshness/confidence summary                                            |
| Entities            | Paginated entity table with canonical name, type, region, confidence, freshness, validation, zone, evidence count, edge count |
| Relationships       | Edge table with source, type, target, confidence, validation status, zone                                                     |
| Evidence            | Evidence items with source type, content, entity/edge links                                                                   |
| Validation          | Pending validation queue                                                                                                      |
| Usage Memory        | Access frequency, hot/warm/cold designation                                                                                   |
| Snapshots & Exports | Export to JSON/CSV, snapshot management                                                                                       |
| Cloud Readiness     | Current cloud adapter readiness payload                                                                                       |
| Settings            | Currently resolves to the same readiness/status payload as Cloud Readiness                                                    |

### Filter system

Entities and relationships are filterable across:

- `status`: unvalidated, pending_validation, validated, contradicted, rejected, hot, warm, cold
- `zone`: candidate, validation, production
- `confidenceBand`: very_low, low, medium, high, very_high
- `freshnessBand`: fresh, aging, stale

### Operational reality

- Dashboard, section browsing, detail drill-down, export, latest snapshot opening, and revalidation queueing are live today.
- `refresh` recomputes dashboard/section state from the local graph-enrichment database; it is not a remote sync.
- `Sync` is not a live feature in the current desktop flow. The button is disabled unless the cloud payload reports connected, and the service currently reports a not-connected placeholder state.
- The Data Vault is therefore operational as a local graph browser and export surface, but not yet as an active remote-synced control plane.

---

## Shared Domain Package Coverage

`packages/shared` provides the cross-runtime domain model shared between desktop and backend:

| Module                     | Key types                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| `supplyChain.ts`           | `SupplyChainGraph`, `MindMapData`, `CompanyNode`, `SupplyChainGraphEdge`, `RiskLensCell` |
| `supplyChainGraph.ts`      | Graph builder utilities, `buildSupplyChainGraph`                                         |
| `supplyChainSimulation.ts` | Scenario simulation types and helpers                                                    |
| `graphMemory.ts`           | `GraphMemoryDashboard`, `GraphMemoryDetail`, `GraphMemorySection`, `GraphMemoryFilters`  |
| `marketData.ts`            | Market data types, ticks, candles                                                        |
| `streaming.ts`             | Stream event types, producer contracts                                                   |
| `events.ts`                | Core event bus types                                                                     |
| `congress/`                | `CongressionalTrade`, `CongressionalMember`, `LobbyingActivity`, `FederalContract`       |
| `publicFlow/`              | `DisclosureEvent`, `SectorTheme`, `ValuationTag`, `WatchlistCandidate`                   |
| `aviation.ts`              | `CargoFlight`, aviation event types                                                      |
| `maritime.ts`              | `OilTanker`, maritime event types                                                        |
| `economicCalendar.ts`      | Economic event types                                                                     |
| `strategy.ts`              | Strategy config and signal types                                                         |
| `replay.ts`                | Replay session management types                                                          |
| `indicators.ts`            | Technical indicator types                                                                |
| `persistence.ts`           | Persistence adapter interfaces                                                           |
| `adapters.ts`              | Cross-runtime adapter utilities                                                          |
| `auth.ts`                  | Auth types for desktop/backend shared usage                                              |
| `env.ts`                   | Environment variable schema helpers                                                      |

---

## Build, Packaging, and Release State

### Development workflow

1. `pnpm --filter @tc/desktop dev` launches the full dev pipeline
2. Vite dev server starts with dynamic port negotiation (no collision on restart)
3. esbuild watch compiles main and preload processes
4. Electron launches pointing at the Vite dev server
5. `.env.local` values propagate backend URL and runtime config to Electron
6. Native module rebuild in dev is intentionally disabled to avoid lock issues

### Production build workflow

1. `build.mjs` script coordinates the full build
2. `esbuild.mjs` compiles main and preload
3. Vite builds renderer to dist
4. `build-installer.mjs` invokes `electron-builder`

### electron-builder configuration

- **Target:** NSIS installer, x64, Windows
- **Asar:** Enabled with selective unpack for native modules
- **Native modules unpacked:** `better-sqlite3`, `keytar`
- **Publish provider:** GitHub (configured for repo owner/name)
- **Auto-update metadata:** `latest.yml` present with SHA512 hash and file size

### Release artifacts

| Artifact                                   | Status                                       |
| ------------------------------------------ | -------------------------------------------- |
| `Trading Cockpit Setup 0.0.1.exe`          | Published 0.0.1 installer                    |
| `Trading Cockpit Setup 0.0.1.exe.blockmap` | Differential update block map                |
| `latest.yml`                               | Auto-update metadata with hash and timestamp |
| `builder-debug.yml`                        | Build debug metadata                         |
| `win-unpacked/`                            | Unpacked app directory                       |

---

## Security, Auth, and Governance Posture

### Implemented controls

- **Environment validation:** All env vars validated with Zod at startup; missing required values break the process.
- **Authentication hardening:** Full signup/login/refresh/2FA/recovery-code lifecycle with reuse detection.
- **Session revocation:** Optional Redis-backed session store enables immediate token kill.
- **Role enforcement:** RBAC role gate toggle (`AUTH_RBAC_ENFORCED`) for privileged endpoints.
- **Tenant isolation:** All data paths tenant-keyed with context injection middleware.
- **Rate limiting:** API-level rate limiter + AI-specific throttle per route group.
- **Metrics exposure:** Prometheus and JSON metrics behind their own routes.
- **Credential security:** API keys stored via Electron `keytar` (OS-native secure credential store), never plain-text in files.
- **Process isolation:** AI LLM calls run in a `worker_threads` worker, isolated from the IPC main loop.

### Active architecture transitions

- Migration flags (`/runtime-flags`) control staged desktop-to-backend routing transitions. Multiple feature areas can flip from local to backend without a full release.
- Presence of both local SQLite and backend PostgreSQL paths means configuration discipline is critical in production to avoid dual-write inconsistency.
- AI and orchestration breadth (7 provider types × 4 feature routing slots × job queue) increases surface area requiring prompt audit trails and queue observability — the foundation is present; full production hardening is ongoing.

---

## Current Product Maturity Assessment

| Area                        | Stage                             | Notes                                                                                                        |
| --------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Desktop UX surface          | Late prototype → early production | 20 pages, 7 core tabs, detached window support, full auth UX                                                 |
| Backend auth/session        | Production-ready structurally     | 2FA, refresh rotation, reuse detection, RBAC gate                                                            |
| AI architecture             | Production-approaching            | Queue, worker isolation, multi-provider, idempotency                                                         |
| Graph enrichment/Data Vault | Advanced local prototype          | 3-zone lifecycle, evidence provenance, exports, revalidation queue; cloud is prepared but not live-connected |
| Supply chain intelligence   | Advanced prototype                | Dual backend/local generation path, multi-view UI, simulation, graph-enrichment ingest                       |
| GWMD map                    | Advanced prototype                | Multi-monitor, wall mode, persistence, backend sync hooks with auth/DB dependency                            |
| Congress intelligence       | Feature-complete prototype        | Trades, lobbying, contracts, AI analysis, ingestion lag                                                      |
| Public flow intelligence    | Feature-complete prototype        | Full pipeline from ingest to ranked candidates                                                               |
| External feeds              | Integrated                        | CFTC COT, BLS JOLTS, SEC EDGAR with live probes                                                              |
| Maritime intelligence       | Basic                             | Cargo flights, oil tanker maps (real-time MapLibre)                                                          |
| Release pipeline            | Functional                        | NSIS installer, auto-update, blockmap, GitHub publish                                                        |
| Observability               | Foundation present                | Prometheus metrics, error counters, queue gauges                                                             |
| Multi-tenancy               | Foundation present                | Tenant context injection, tenant-keyed caching                                                               |

---

## What "V4" Implies Based on Current State

Given the architecture that exists today, a canonical V4 milestone would represent:

1. **Full backend authority** — migration flags fully flipped; desktop reads all data from backend; local SQLite becomes a cache layer only.
2. **Graph enrichment reaching production zone** — entities and edges promoted from candidate → validated → production via automated + manual validation pipelines.
3. **Provider governance** — explicit prompt audit logging, model version pinning per feature, and observable queue dashboards for AI job health.
4. **Maritime and aviation promoted** — cargo flights and oil tanker maps integrated into supply chain risk overlays rather than standalone pages.
5. **Capital Momentum signals wired** — `CapitalMomentumService` outputs flowing into EXECUTE workspace and AI research context inputs.
6. **GWMD wall mode hardened** — wall session sync production-ready with multi-monitor state persistence.
7. **Deployment discipline** — backend container (Dockerfile present), secrets management, and staged rollout via migration flags replacing ad-hoc env flag approach.

---

## Bottom Line

Trading Terminal today is a substantial, modular, multi-intelligence platform with a working Windows distribution, a hardened authentication backend, a multi-provider AI job system, a proprietary knowledge graph, 20 distinct UX workspaces, and real-time maritime and supply chain data pipelines.

It is not a narrow MVP. The codebase shows a system that has evolved domain by domain, with each module at a different maturity tier, unified by a coherent architectural direction: migrate state authority to the backend, grow the graph knowledge base session by session, and expose every intelligence layer through an operator-ergonomic desktop surface that can be projected across a trading wall.

The next step is not breadth — it is hardening, validation pipelines, and completing the migration flag transitions to make the already-built system production-stable.

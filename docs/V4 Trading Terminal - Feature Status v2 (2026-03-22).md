# V4 Trading Terminal - Feature Status v2

Last updated: March 22, 2026
Scope: Verified against current code paths in desktop renderer/main process and backend server.

---

## 1) Status legend used in this document

- ACTIVE: Implemented and reachable in current primary UX flow.
- ACTIVE (PHASE-1): Implemented with intentionally limited scope and/or early feature depth.
- PARTIAL: Implemented, but with known placeholders, mock/fallback logic, or missing integration depth.
- HIDDEN/DETACHED: Implemented and runnable, but not present as a primary tab in the current app shell.
- BACKEND-GATED: Feature exists but requires backend auth/session and service availability.
- LOCAL-FALLBACK: Feature has local behavior when backend path is unavailable.

---

## 2) Executive state snapshot (as of code today)

The product is a broad multi-surface terminal with strong depth in AI + intelligence modules, but uneven maturity across classic trading workspaces:

- AI/Intel stack: strong (research queueing, congress AI, supply chain AI path, TED snapshot path, steward/orchestrator APIs).
- Data graph tooling: strong local tooling (Data Vault + enrichment + exports + revalidation queueing).
- Supply chain + GWMD: deep and actively integrated; includes cloud sync hooks and display-surface workflows.
- Core trading pages: mixed maturity; some are still phase-1/placeholder compared to intelligence modules.
- UI shell evolution: current App tab model differs from legacy 7-tab definition in renderer tabs constants file.

---

## 3) Desktop app shell status

### 3.1 Current primary tab set in active app shell

Status: ACTIVE

Current visible tabs in app shell (16):

1. PANORAMA
2. CAM
3. MACRO
4. MICROSCAPE
5. STRUCTURE
6. FLOW
7. EXECUTE
8. JOURNAL
9. ECONOMIC CALENDAR
10. INTELLIGENCE
11. CONGRESS ACTIVITY
12. TERMINAL AI
13. SUPPLY CHAIN
14. DATA VAULT
15. GWMD MAP
16. SETTINGS & LOGS

Important note:

- OIL TANKERS and CARGO FLIGHTS entries are present but commented out in app tab declaration.
- Detached-tab architecture is active (drag out tab -> separate window with sync channel).

### 3.2 Special view modes (not regular tabs)

Status: ACTIVE

The app can boot into explicit non-tab modes via URL query state:

- api-hub
- smart-routing
- global-map
- gwmd-wall
- gwmd-analyst
- gwmd-mirror
- detached-tab

This means API HUB and SMART ROUTING are operational surfaces despite not being in the normal tab list.

### 3.3 Legacy tab model mismatch

Status: PARTIAL / DRIFT

A legacy 7-tab model still exists in renderer tab constants:

- panorama, microscape, structure, flow, execute, journal, settingsLogs

This does not reflect the expanded active tab shell above and indicates historical drift in navigation model.

---

## 4) Desktop feature-by-feature status (page-level)

### 4.1 PANORAMA

Status: ACTIVE (PHASE-1 + hybrid intelligence)

What is live now:

- Demo panorama snapshot refresh loop is active (periodic synthetic snapshot update).
- Economic calendar load/refresh loop is active.
- LLM summary enrichment is attempted through economic insight generation path.
- TED demand pulse panel is integrated.
- Regime/signal overlays via strategy and risk stores are integrated.

Current limitations:

- Snapshot generation currently relies on demo provider in page flow.
- Calendar enrichment behavior degrades gracefully when runtime/config unavailable.

### 4.2 CAM (Capital Momentum)

Status: ACTIVE

What is live now:

- Reads ranked CAM signals from strategy store.
- Displays pass/blocked, score decomposition, gate failures, freshness diagnostics.

Current limitations:

- UI is highly functional but depends on upstream signal availability.

### 4.3 MACRO

Status: ACTIVE (PHASE-1)

What is live now:

- BLS JOLTS series pull through external feed bridge.
- Daily refresh cadence.
- Multi-series chart rendering and latest value tiles.

Current limitations:

- Narrow domain coverage in this phase (JOLTS-focused only).

### 4.4 MICROSCAPE

Status: PARTIAL (placeholder)

What is live now:

- Page shell and unavailable-data cards.

Current limitations:

- Marked explicitly as placeholder single-symbol deep dive.
- Core chart/order-book/tape surfaces are not yet implemented in this page.

### 4.5 STRUCTURE

Status: PARTIAL

What is live now:

- Indicator display and structure chart shell.
- Symbol switching and level manager.

Current limitations:

- Includes mock indicator generation path when real indicator data is absent.
- Drawing tooling called out as stub in hints.

### 4.6 FLOW

Status: ACTIVE (PHASE-1)

What is live now:

- SEC event stream panels (Form 4 and 8-K) with filtering and periodic refresh.
- Link-out cards to source URLs.

Current limitations:

- Scope intentionally narrow in page subtitle/implementation.

### 4.7 EXECUTE

Status: ACTIVE (PHASE-1 to PARTIAL)

What is live now:

- Order ticket workflow with buy/sell, type, qty, limit, bracket logic.
- Position sizing calculator (risk-percent vs stop distance).
- Uses trading hooks and store state.

Current limitations:

- Broadly operational for terminal workflow but still resembles early integrated planner rather than full institutional OMS surface.

### 4.8 JOURNAL

Status: ACTIVE

What is live now:

- Today/all/debrief tabs.
- Trade analytics rendering per trade.
- Tagging and notes editing flows.
- Session debrief statistics pull.

Current limitations:

- Quality is tied to upstream trade persistence and capture completeness.

### 4.9 ECONOMIC CALENDAR

Status: ACTIVE

What is live now:

- Separate economic calendar component tab is in active tab list.
- Also contributes to PANORAMA intelligence context.

Current limitations:

- Advanced context generation still depends on AI runtime/routes.

### 4.10 INTELLIGENCE

Status: ACTIVE

What is live now:

- AI briefs list + detail drawer.
- Runtime status and cloud model awareness.
- TED radar panel integration.
- Public flow intel panel integration.

Current limitations:

- If AI runtime unavailable and no cloud model route, brief generation/read freshness degrades.

### 4.11 CONGRESS ACTIVITY

Status: ACTIVE

What is live now:

- Trades/lobbying/contracts tabbed experience.
- Filtering and data fetch actions.
- Most traded + disclosure lag stats.
- AI scan flow with debug payload handling and copy-out.

Current limitations:

- Feature quality depends on external fetch freshness and API rate constraints.

### 4.12 TERMINAL AI (LocalAI)

Status: ACTIVE

What is live now:

- AI runtime checks, config load/save, focus prompt, run-now, refresh briefs.
- Runtime status panel with queue and last-run status.
- Cloud fallback awareness via settings model state.

Current limitations:

- Local runtime dependency remains a hard gate for local-only mode.

### 4.13 SUPPLY CHAIN MIND MAP

Status: ACTIVE (deep)

What is live now:

- Multi-view supply chain workspace with generation/search.
- Strict mode, hypotheses, hops, edge-weight controls.
- Shock/simulation controls.
- TED overlay and exposure brief panel.
- Graph enrichment inspector and maintenance/export actions.
- Enrichment sync status surface.

Current limitations:

- Cloud sync posture appears informational in current desktop graph-enrichment flow unless connected backend path is fully available.
- Some statuses explicitly surface placeholder provider text when no live sync backend is bound.

### 4.14 DATA VAULT

Status: ACTIVE (strong local graph operations)

What is live now:

- 9 section model: overview/entities/relationships/evidence/validation/usage/snapshots/cloud/settings.
- Filter model (status/zone/type/source/confidence/freshness).
- Detail panel and record-level drill-down.
- Refresh/revalidate/export/open/reveal flows through graphMemory IPC.
- TED Data Vault panel integration.

Current limitations:

- Cloud/settings sections depend on cloud-readiness payload; live connected cloud plane is environment-dependent.

### 4.15 GWMD MAP

Status: ACTIVE (deep)

What is live now:

- Incremental search and persisted graph handling.
- Run status/search trace handling with degraded/error awareness.
- Display-surface orchestration for wall/analyst/mirror contexts.
- Cloud push/pull/status sync hooks.
- TED overlay and exposure brief support.

Current limitations:

- Sync behavior is backend/auth/database gated.
- Uses fallback and cached-path behavior when remote paths are unavailable.

### 4.16 SETTINGS & LOGS

Status: ACTIVE (control center)

What is live now:

- Runtime source/replay controls.
- AI model/routing preference controls.
- Cloud AI configurator and provider draft management.
- Backend URL management + health probing.
- TED live config management.
- External feed testing and key test status handling.
- AI steward overview/config interaction surfaces.

Current limitations:

- Breadth is high and includes many fallback branches; correctness relies on connected backend + runtime availability.

### 4.17 API HUB

Status: HIDDEN/DETACHED but ACTIVE

What is live now:

- Secure API credential listing/save/remove path through main process APIs.

Current limitations:

- Not available as standard visible tab; opened via explicit mode/window commands.

### 4.18 SMART ROUTING OVERVIEW

Status: HIDDEN/DETACHED but ACTIVE

What is live now:

- Visual routing surface and API hub snapshot-based behavior.

Current limitations:

- Not in normal tab rail; entered through dedicated view/window flow.

### 4.19 GLOBAL SUPPLY CHAIN MAP

Status: HIDDEN/DETACHED but ACTIVE

What is live now:

- Dedicated full-window global map boot mode.
- Uses supply chain store global graph load + visualization surface.

Current limitations:

- Not in primary tab navigation by default.

### 4.20 CARGO FLIGHTS MAP

Status: IMPLEMENTED PAGE, CURRENTLY NOT WIRED TO PRIMARY SHELL

What is live now:

- Real-time-ish map, filtering, marker rendering, subscription loop.

Current limitations:

- Not in active tab render path.
- Tab entries currently commented out in app tab declaration.

### 4.21 OIL TANKER MAP

Status: IMPLEMENTED PAGE, CURRENTLY NOT WIRED TO PRIMARY SHELL

What is live now:

- MapLibre surface with tanker filters and update subscriptions.

Current limitations:

- Not in active tab render path.
- Tab entries currently commented out in app tab declaration.

---

## 5) Desktop service and IPC feature status

Overall status: ACTIVE and extensive

Current state highlights:

- Main process exposes a broad IPC surface (auth, AI, public flow, congress, supply chain, graph memory, GWMD, config, stream, replay, trading, journal).
- External feeds, API Hub, smart routing window opening, detached tab windowing, and GWMD display-mode orchestration are all present.
- GraphMemory and GraphEnrichment operations are callable from renderer and visibly wired.

Risk note:

- IPC surface area is now very large; this is powerful but increases operational complexity and regression surface.

---

## 6) Backend feature status (HTTP API + modules)

### 6.1 Platform and auth

Status: ACTIVE (strong)

Live now:

- Health and runtime flags.
- Signup/login/refresh/me/logout.
- 2FA setup/verify/disable.
- Session store + refresh rotation logic paths.
- Tenant context middleware and role gating hooks.

### 6.2 User/trading state endpoints

Status: ACTIVE

Live now:

- Settings CRUD.
- Watchlist CRUD.
- Order/account/positions and order place/cancel.

### 6.3 Congress and PublicFlow endpoints

Status: ACTIVE

Live now:

- Congress list/query metrics/fetch endpoints.
- PublicFlow recent/themes/candidates/valuations/refresh.

### 6.4 TED Intel endpoints

Status: ACTIVE with LOCAL-FALLBACK behavior

Live now:

- Snapshot endpoint returns mock snapshot when live TED disabled/unavailable.
- Config get/put endpoint is present and auth-protected.

### 6.5 Supply chain endpoints

Status: ACTIVE (dual path)

Live now:

- Non-AI supplychain generate/cache/clear/advisor endpoints.
- AI supplychain queue-backed generate + cached map + insights endpoints.

### 6.6 AI research queue and jobs

Status: ACTIVE (advanced)

Live now:

- Queue-backed research run.
- Job status + job cancel.
- Briefs/config/status + brief dismiss.
- Idempotency key support and wait/202 behavior.

### 6.7 AI economic calendar

Status: ACTIVE

Live now:

- Queue-backed economic insight generation endpoint.

### 6.8 AI congress

Status: ACTIVE

Live now:

- Queue-backed congress analyze endpoint.
- Watchlist CRUD endpoints.

### 6.9 GWMD cloud sync

Status: ACTIVE but BACKEND-GATED by storage/auth availability

Live now:

- Push/pull/status endpoints.
- Cache layers for status/pull responses.

### 6.10 AI orchestrator

Status: ACTIVE

Live now:

- Track interactions.
- Predictions and stats.
- Preload endpoint with role gate.

### 6.11 AI steward

Status: ACTIVE

Live now:

- Overview/config/run module/findings/tasks/apply task endpoints.
- Role gating on mutation operations.

### 6.12 AI provider visibility + metrics

Status: ACTIVE

Live now:

- AI provider settings endpoint.
- Prometheus and JSON metrics endpoints.

---

## 7) Data and persistence status

### 7.1 Desktop local persistence

Status: ACTIVE

- SQLite-backed repos for trading/journal/public flow/congress/supply chain/gwmd/ai-research.
- Keytar-backed secure credential storage for secrets.

### 7.2 Backend persistence

Status: ACTIVE with environment gating

- PostgreSQL-backed services when pool configured.
- Optional Redis/cache-backed behavior where configured.
- Multi-tenant context propagation and cache keying active in API paths.

### 7.3 Graph enrichment/Data Vault pipeline

Status: ACTIVE (local-first operational depth)

- Candidate/validation/production concepts in live UI and service interfaces.
- Export/snapshot/revalidation operations are live and callable.

---

## 8) Build and release status

Status: ACTIVE baseline

Current known posture:

- Windows Electron build/release pipeline present.
- Installer artifacts and update metadata exist in desktop release outputs.
- Current project package versions remain 0.0.1.

---

## 9) Highest-priority current gaps (from code reality)

1. MICROSCAPE is still explicitly placeholder while intelligence pages are advanced.
2. STRUCTURE includes mock fallback/stub hints, indicating incomplete market-structure depth.
3. CARGO FLIGHTS and OIL TANKER pages are implemented but disconnected from primary shell tabs.
4. Tab model drift exists between expanded App tab list and legacy 7-tab constant model.
5. Several advanced paths are environment-dependent (backend auth, DB pool, cloud sync availability), so runtime capability can vary by deployment.

---

## 10) Practical maturity classification by feature family

- AI + Intelligence family: Advanced prototype to production-approaching.
- Graph/Data Vault family: Advanced local operational prototype.
- Supply Chain + GWMD family: Advanced integrated prototype.
- Core trading execution/journal family: Usable and active, mixed depth.
- Classical charting/microstructure family (Microscape/parts of Structure): Early to mid prototype.
- Maritime/Aviation map pages: Implemented but currently parked from primary navigation.

---

## 11) Delta versus prior status framing

Major reality changes reflected in this v2:

- The active tab rail is broader than the older 7-core-tab framing.
- Some pages previously described as fully surfaced are now hidden/detached entry points.
- Cargo/Oil map capability exists in code but is currently not main-shell navigable.
- Endpoint naming and grouping are strongly /api-prefixed and richer than older condensed summaries.

This document should be treated as the current operational truth snapshot for implementation planning, QA targeting, and release hardening priorities.

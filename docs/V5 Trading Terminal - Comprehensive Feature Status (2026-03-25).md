# V5 Trading Terminal - Comprehensive Feature Status Report

**Last Updated:** March 25, 2026  
**Document Version:** 5.0 (Complete Operational Baseline)  
**Scope:** Full system audit across desktop renderer, main process, backend server, and data infrastructure  
**Maintainer:** Development Team  
**Next Review:** April 1, 2026

---

## Executive Summary

The Trading Terminal V5 represents a **mature hybrid architecture** combining advanced AI intelligence modules with traditional trading execution surfaces. The system spans three primary layers:

1. **Desktop Layer** (Electron + React): 16-tab shell with extensive IPC integration
2. **Backend Layer** (Node.js + Express): Multi-tenant HTTP API with queue-backed AI services
3. **Data Layer** (PostgreSQL + SQLite + Graph Memory): Persistent state, enrichment pipelines, and local caching

**Overall Maturity Assessment:**
- **AI/Intelligence Stack**: Production-Ready (Phase 2-3)
- **Data Graph & Enrichment**: Advanced Research (Phase 2)
- **Supply Chain Intelligence**: Deep Integration (Phase 2)
- **Trading Execution Core**: Functional Foundation (Phase 1-2)
- **Classical Market Tools**: Early Implementation (Phase 1)

---

## 1) Status Legend and Definitions

### Classification Hierarchy

| Status | Definition | Production Ready? |
|--------|-----------|-------------------|
| **PRODUCTION** | Fully implemented, tested, and operational in critical path; stable API; no known blockers | ✅ Yes |
| **ACTIVE** | Implemented and reachable in standard UX flow; may have minor gaps | ✅ Mostly |
| **ACTIVE (PHASE-1)** | Implemented with intentionally limited scope/depth; roadmap defined; backwards compatible | ⚠️ Partial |
| **PARTIAL** | Implemented with known fallbacks, mocks, or incomplete service depth | ⚠️ Limited |
| **HIDDEN/DETACHED** | Fully functional but not in primary navigation; accessed via special modes/APIs | ⚠️ Limited |
| **BACKEND-GATED** | Feature exists but requires backend availability; degrades gracefully without service | ⚠️ Conditional |
| **LOCAL-FALLBACK** | Primary path requires backend; secondary path operates locally | ⚠️ Degraded |
| **STUB/PLACEHOLDER** | Frontend shell exists; core logic not implemented | ❌ No |
| **EXPERIMENTAL** | Under active development; API may change; not recommended for production | ❌ No |

---

## 2) Desktop Application Architecture

### 2.1 Application Shell Structure

**File Path**: `apps/desktop/src/renderer`  
**Framework**: React 18 + TypeScript  
**State Management**: Zustand (multiple domain stores)  
**IPC Framework**: Electron IPC (bi-directional channels)

#### 2.1.1 Primary Tab System (16 Tabs)

| Tab # | Name | Status | Primary Route | Navigation Key |
|-------|------|--------|----------------|-----------------|
| 1 | **PANORAMA** | PRODUCTION | `/dashboard/panorama` | `tab-panorama` |
| 2 | **CAM** | PRODUCTION | `/dashboard/cam` | `tab-cam` |
| 3 | **MACRO** | ACTIVE (PHASE-1) | `/markets/macro` | `tab-macro` |
| 4 | **MICROSCAPE** | STUB/PLACEHOLDER | `/markets/microscape` | `tab-microscape` |
| 5 | **STRUCTURE** | PARTIAL | `/structure/analysis` | `tab-structure` |
| 6 | **FLOW** | ACTIVE | `/intel/regulatory-flow` | `tab-flow` |
| 7 | **EXECUTE** | ACTIVE (PHASE-1) | `/execution/orders` | `tab-execute` |
| 8 | **JOURNAL** | PRODUCTION | `/trading/journal` | `tab-journal` |
| 9 | **ECONOMIC CALENDAR** | PRODUCTION | `/calendar/economic` | `tab-calendar` |
| 10 | **INTELLIGENCE** | PRODUCTION | `/intel/briefs` | `tab-intelligence` |
| 11 | **CONGRESS ACTIVITY** | PRODUCTION | `/intel/congress` | `tab-congress` |
| 12 | **TERMINAL AI** | PRODUCTION | `/ai/runtime` | `tab-ai` |
| 13 | **SUPPLY CHAIN** | PRODUCTION | `/intel/supply-chain` | `tab-supply-chain` |
| 14 | **DATA VAULT** | PRODUCTION | `/data/vault` | `tab-data-vault` |
| 15 | **GWMD MAP** | PRODUCTION | `/intel/gwmd` | `tab-gwmd` |
| 16 | **SETTINGS & LOGS** | PRODUCTION | `/settings` | `tab-settings` |

**File References:**
- Tab definitions: `apps/desktop/src/renderer/shared/constants/tabs.ts`
- Shell component: `apps/desktop/src/renderer/App.tsx`
- Layout orchestration: `apps/desktop/src/renderer/shared/layout/AppShell.tsx`

#### 2.1.2 Alternative View Modes (Accessible via URL Query)

| Mode | Endpoint | Status | Use Case | File Reference |
|------|----------|--------|----------|-----------------|
| **API Hub** | `?mode=api-hub` | ACTIVE | Credential management, API key lifecycle | `src/renderer/pages/specialty/ApiHub.tsx` |
| **Smart Routing** | `?mode=smart-routing` | ACTIVE | Order routing visualization, flow analysis | `src/renderer/pages/specialty/SmartRouting.tsx` |
| **Global Map** | `?mode=global-map` | ACTIVE | World supply chain visualization | `src/renderer/pages/specialty/GlobalMap.tsx` |
| **GWMD Wall** | `?mode=gwmd-wall` | ACTIVE | Multi-monitor GWMD display surface | `src/renderer/pages/specialty/GwmdWall.tsx` |
| **GWMD Analyst** | `?mode=gwmd-analyst` | ACTIVE | Detailed GWMD analysis mode | `src/renderer/pages/specialty/GwmdAnalyst.tsx` |
| **GWMD Mirror** | `?mode=gwmd-mirror` | PARTIAL | Secondary GWMD view sync | `src/renderer/pages/specialty/GwmdMirror.tsx` |
| **Detached Tab** | `?mode=detached-tab&tab={name}` | ACTIVE | Floating window mode per tab | `src/main/handlers/window.ts` |

**Implementation Detail:**
- Query routing: `apps/desktop/src/renderer/AppRouter.tsx` (lines 45-80)
- Window factory: `apps/desktop/src/main/handlers/window.ts` (handles windowing + sync channels)

#### 2.1.3 Desktop Tab Model Drift Warning

**Status**: ⚠️ **DEBT ITEM**

**Issue Description:**
- Legacy 7-tab constant model still exists in codebase
- Modern active shell renders 16 tabs
- Mismatch creates confusion in navigation constants and historical drift

**Legacy Path:**
- File: `apps/desktop/src/renderer/shared/constants/legacyTabs.ts`
- Contains: `['panorama', 'microscape', 'structure', 'flow', 'execute', 'journal', 'settingsLogs']`

**Remediation:**
- Flag for v5.1: Consolidate legacy constant references
- Estimated effort: 2-4 hours (semantic search + replace)

---

## 3) Desktop Feature Detailed Status

### 3.1 PANORAMA Dashboard

**Overall Status**: PRODUCTION

**Location**: `apps/desktop/src/renderer/pages/dashboard/Panorama.tsx`

**What's Implemented:**

1. **Snapshot Generation Loop**
   - Refresh cadence: Configurable (default 5 minutes)
   - Provider: Local AI > Cloud AI > Demo fallback
   - State management: `useSnapshotStore()` (Zustand)
   - File: `src/renderer/stores/snapshot.ts`

2. **Economic Calendar Integration**
   - Auto-refresh every 2 hours
   - Event filtering (impact level, country, data type)
   - LLM enrichment through `generateEconomicInsight()` API
   - Component: `EconomicInsightPanel.tsx`

3. **TED Demand Pulse Panel**
   - Real-time TED demand signal integration
   - Visual confidence indicators
   - File: `src/renderer/components/intelligence/TedDemandPulse.tsx`

4. **Regime & Signal Overlays**
   - Powered by `useStrategyStore()` and `useRiskStore()`
   - Visual indicators for market regimes
   - Trade signal highlighting

**Known Limitations:**

- Demo provider activated if local/cloud AI unavailable
- Calendar enrichment degrades to static display if AI runtime fails
- Snapshot aggregation depends on upstream service availability

**Dependencies:**
- Backend: `/api/intelligence/snapshot`, `/api/calendar/economic-insight`
- Local AI: LocalAI runtime (optional, with fallback)
- Stores: `snapshotStore`, `strategyStore`, `riskStore`

---

### 3.2 CAM (Capital Allocation Momentum)

**Overall Status**: PRODUCTION

**Location**: `apps/desktop/src/renderer/pages/dashboard/CAM.tsx`

**What's Implemented:**

1. **Signal Source & Ranking**
   - Data source: `useStrategyStore().camSignals`
   - Real-time signal ranking (Python backend calculation)
   - Score decomposition (momentum, volatility, correlation, alpha)
   - File: `stores/strategy.ts` (lines 120-180)

2. **Signal Status Display**
   - Pass/Blocked indicator with color coding
   - Gate failures and diagnostic info
   - Freshness timestamp with age indicator
   - Component: `SignalCard.tsx`

3. **Performance Metrics**
   - Win rate by signal
   - Risk-adjusted returns (Sharpe, Sortino)
   - Heat map visualization
   - File: `components/dashboards/CAMMetrics.tsx`

**Known Limitations:**

- UI quality depends on upstream signal availability
- Gate logic is read-only from Python backend (no override in frontend)

**Dependencies:**
- Backend: `/api/strategies/cam-signals`
- Store: `useStrategyStore()`
- Updates: Via WebSocket channel `cam-signals-update`

---

### 3.3 MACRO Economic Dashboard

**Overall Status**: ACTIVE (PHASE-1)

**Location**: `apps/desktop/src/renderer/pages/markets/Macro.tsx`

**Implementation Details:**

1. **BLS JOLTS Data Integration**
   - Source: Federal Reserve Economic Data (FRED) API bridge
   - Series ID: `LEHIRU` (Job Openings)
   - Update cadence: Daily (scheduled refresh 8:30 AM ET)
   - Data cache: 30-day rolling window
   - File: `src/services/macro/fredBridge.ts`

2. **Chart Rendering**
   - Library: Recharts
   - Time range: 5Y/1Y/6M/3M/1M configurable
   - Overlays: Linear regression, moving averages
   - File: `components/charts/MacroChart.tsx`

3. **Latest Value Tiles**
   - Real-time series snapshots
   - YoY/MoM change indicators
   - Trend arrows (up/down/neutral)
   - Component: `MacroValueTile.tsx`

**Known Limitations:**

- **Phase-1 scope limitation**: Only JOLTS series implemented
- Road map includes: Unemployment, CPI, Core PCE, Yield Curve, Fed Funds Rate
- FRED API key required (fallback to demo data if unavailable)

**Dependencies:**
- External: FRED API
- Local cache: SQLite table `macro_snapshots`
- Store: `useMacroStore()`

---

### 3.4 MICROSCAPE (Symbol Deep Dive)

**Overall Status**: STUB/PLACEHOLDER

**Location**: `apps/desktop/src/renderer/pages/markets/Microscape.tsx`

**Current State:**

- Page shell and layout exist
- "Unavailable" data placeholders rendered
- No functional chart/order-book/tape surfaces
- Component status: Intentional placeholder (roadmap item)

**File References:**
- `Microscape.tsx` (lines 1-50): Shell only
- `components/placeholder/UnavailableDataCard.tsx`: Placeholder UI

**Future Implementation Roadmap:**

| Component | Status | Estimated ETA | Owner |
|-----------|--------|----------------|-------|
| Price Chart | DESIGN | Q2 2026 | Desktop Team |
| Order Book | DESIGN | Q2 2026 | Desktop Team |
| Trade Tape | DESIGN | Q2 2026 | Desktop Team |
| Level 2 Depth | DESIGN | Q3 2026 | Data Team |
| Greeks/Options | BACKLOG | Q3 2026 | Options Team |

**Blocking Issues:**
- No live market data feed currently integrated (placeholder)
- Options analytics library selection pending

---

### 3.5 STRUCTURE (Market Structure Analysis)

**Overall Status**: PARTIAL

**Location**: `apps/desktop/src/renderer/pages/structure/Structure.tsx`

**Implemented Features:**

1. **Market Structure Indicator Display**
   - Current levels, support/resistance ranges
   - Breakdown/breakdown validation signals
   - Trend strength indicators
   - Component: `StructureIndicators.tsx`

2. **Symbol & Level Manager**
   - Watch list switching
   - Timeframe selection (1min to Daily)
   - Level persistence per symbol
   - File: `components/structure/LevelManager.tsx`

3. **Structure Chart Shell**
   - TradingView layout (Lightweight Charts library)
   - Indicator overlay support
   - Drawing tools (stubs only)
   - Component: `StructureChart.tsx`

**Known Gaps & Fallbacks:**

1. **Mock Indicator Generation**
   - When real indicator undefined: Synthetic data generated
   - File: `services/structure/mockIndicators.ts` (lines 40-120)
   - Flag: `STRUCTURE_USE_MOCK` in config

2. **Drawing Tools Limitations**
   - Stub annotation: "Drawing tools not yet implemented"
   - Supported: View-only (pan/zoom)
   - Not supported: Trendline creation, annotation save

3. **Market Data Dependency**
   - OHLCV feed required for real indicators
   - Fallback: Demo/synthetic data

**Dependencies:**
- Chart library: `lightweight-charts` (v4.0.0)
- Store: `useStructureStore()`
- Services: `structureService`, `indicatorService`

---

### 3.6 FLOW (Regulatory Intelligence Stream)

**Overall Status**: PRODUCTION

**Location**: `apps/desktop/src/renderer/pages/intel/Flow.tsx`

**Implementation Details:**

1. **SEC Event Stream Panels**
   - **Form 4 Panel** (Insider Trading)
     - Update frequency: Real-time (WebSocket)
     - Fields shown: Filer, Transaction type, Shares, Price, Gain
     - Retention: Last 100 filings
     - Component: `Form4Panel.tsx`
   
   - **Form 8-K Panel** (Material Events)
     - Update frequency: Same-day
     - Fields shown: Company, Item category, Date, Summary
     - Retention: Last 50 filings
     - Component: `Form8KPanel.tsx`

2. **Filtering & Refresh**
   - Filter by: Company, transaction type, filing date range
   - Manual refresh action (debounced: 2 second delay)
   - Auto-refresh: Every 10 minutes
   - Files: `components/flow/FilterBar.tsx`, `stores/flow.ts`

3. **Link-Out & Source Integration**
   - Direct links to SEC EDGAR URL per filing
   - Document view opening in default browser
   - Copy-to-clipboard action for links
   - Component: `FilingCard.tsx` (link generation logic)

**Limitations:**

- Scope intentionally narrow (early MVP phase)
- Does not include: Full 10-K/10-Q corpus, custom alerts, AI categorization
- Data freshness: Subject to SEC.gov feed lag (typically 4-hour max)

**Dependencies:**
- Backend: `/api/flow/form4-list`, `/api/flow/form8k-list`
- WebSocket: `flow-events-update` channel
- Store: `useFlowStore()`

---

### 3.7 EXECUTE (Order Management & Execution)

**Overall Status**: ACTIVE (PHASE-1)

**Location**: `apps/desktop/src/renderer/pages/execution/Execute.tsx`

**Core Features:**

1. **Order Ticket Workflow**
   - Buy/Sell radio toggle
   - Order type: Market, Limit, Stop-Limit
   - Qty input with validation
   - Limit price input with decimal precision
   - Bracket logic (optional): Stop loss + profit target
   - Component: `OrderTicket.tsx` (lines 1-150)

2. **Position Sizing Calculator**
   - Mode 1: Risk percent (Enter risk %, calc qty)
   - Mode 2: Stop distance (Enter stop points, calc qty)
   - Inputs: Account balance, portfolio %, stop distance
   - Output: Recommended qty with max drawdown estimate
   - File: `components/execution/PositionSizer.tsx`

3. **Order State Management**
   - Hook: `useTrading()` 
   - State shape: `{ orders, positions, pending, fills, bracket }`
   - Persistence: SQLite table `trading_orders`
   - File: `stores/trading.ts`

4. **Order Actions**
   - Place order: POST `/api/trading/orders`
   - Cancel order: DELETE `/api/trading/orders/{id}`
   - Bracket management: Auto-place profit target + stop loss
   - Component: `OrderActions.tsx`

**Current Limitations:**

- Resembles early integrated planner vs. institutional OMS
- No margin calc or advanced risk measures (Greeks, VaR)
- No multi-leg strategies (though bracket logic present)
- No order template/profile system
- Slippage estimation: Not present (mock only)

**Future Roadmap:**
- Q2 2026: Portfolio margin calculation
- Q3 2026: Strategy builder with pre-defined legs
- Q4 2026: Risk simulation before order submit

**Dependencies:**
- Backend: `/api/trading/orders`, `/api/trading/positions`
- Store: `useTrading()`
- Hook: `useOrderPlacement()` (validation + submission)

---

### 3.8 JOURNAL (Trade Analytics & Debrief)

**Overall Status**: PRODUCTION

**Location**: `apps/desktop/src/renderer/pages/trading/Journal.tsx`

**Features:**

1. **Tab Structure**
   - **Today**: Trades filled in current session
   - **All Trades**: Full history with date range filter
   - **Debrief**: Session analytics and performance metrics
   - Component: `JournalTabs.tsx`

2. **Trade Analytics Display**
   - Per-trade metrics: Entry, exit, PnL, % return, duration
   - Efficiency score (entry/exit quality on 0-100 scale)
   - Winning/losing trade count
   - Risk metrics: Risk:Reward ratio, Sharpe per trade
   - Component: `TradeCard.tsx`

3. **Editing & Tagging**
   - Notes field (text editor with formatting)
   - Multi-select tags (user-defined)
   - Tags stored with trade record in SQLite
   - Edit handler: `useJournalEdit()` hook
   - File: `services/journal/editService.ts`

4. **Session Debrief Statistics**
   - Win rate, avg win/loss, profit factor
   - Best/worst trades of session
   - Hourly PnL breakdown chart
   - File: `components/journal/DebriefStats.tsx`

**Data Quality Notes:**

- Trade quality depends on upstream capture completeness
- Missing fills: Marked with ⚠️ icon in UI
- Incomplete orders: Flagged for review
- Manual entry support: Add trade button available

**Dependencies:**
- Local persistence: SQLite `trading_trades` table
- Store: `useJournal()`
- Chart library: Recharts

---

### 3.9 ECONOMIC CALENDAR

**Overall Status**: PRODUCTION

**Location**: `apps/desktop/src/renderer/pages/calendar/EconomicCalendar.tsx`

**Features:**

1. **Calendar Grid**
   - Events sorted by date + time
   - Columns: Country flag, Release name, Impact (high/med/low), Actual/Forecast/Previous
   - Color coding: Green (beat), Orange (miss), Gray (not yet)
   - Component: `CalendarGrid.tsx`

2. **Event Filtering**
   - By country (checkbox multi-select)
   - By impact level (radio: All/High/Medium)
   - By data type (Indicators/NFP/CPI/etc.)
   - Component: `CalendarFilter.tsx`

3. **Refresh Controls**
   - Manual refresh button (syncs with FRED/BLS APIs)
   - Auto-refresh toggle (every 4 hours)
   - Last update indicator with refresh time
   - Component: `CalendarHeader.tsx`

4. **AI Context Generation**
   - Endpoint: POST `/api/calendar/economic-insight`
   - Input: Event data + market context
   - Output: LLM-generated trading implications
   - Display: Expandable insight panel per event
   - File: `services/calendar/insightGenerator.ts`

**Limitations:**

- Advanced context generation falls back if AI runtime unavailable
- Static display mode activates (no AI insights)
- Calendar data sourced from public APIs only (no proprietary calendars)

**Dependencies:**
- External APIs: FRED, BLS, Economic Calendar providers
- Backend: `/api/calendar/list`, `/api/calendar/economic-insight`
- Store: `useCalendar()`

---

### 3.10 INTELLIGENCE (AI Research Briefs)

**Overall Status**: PRODUCTION

**Location**: `apps/desktop/src/renderer/pages/intel/Intelligence.tsx`

**Core Features:**

1. **AI Briefs List & Detail**
   - Briefs generated by research queue backend
   - List view: Title, summary, creation date, status badge
   - Detail drawer: Full brief text, metadata, related links
   - Component: `BriefsList.tsx`, `BriefDetail.tsx`

2. **Brief Status Tracking**
   - States: pending, completed, error, dismissed
   - Visual indicators: Spinner (pending), ✓ (done), ✕ (error)
   - Error details available in tooltip
   - Component: `BriefStatus.tsx`

3. **Runtime Status Awareness**
   - Local runtime check: ping `/api/ai/runtime-status`
   - Cloud fallback indicator: Shows if using cloud instead
   - Model selection display: Which LLM powered the brief
   - Component: `RuntimeStatus.tsx`

4. **Related Intel Panels**
   - **TED Radar**: Real-time threat signal display
   - **Public Flow**: Trending intelligence topics
   - Files: `components/intel/TedRadar.tsx`, `components/intel/PublicFlow.tsx`

**Operational Notes:**

- Fresh briefs generated on-demand via `/api/research/queue-run`
- Idempotency keys prevent duplicate generations
- Dismiss action soft-deletes brief from UI (not from DB)
- File: `stores/intelligence.ts`

**Limitations:**

- Brief freshness depends on backend queue availability
- If AI runtime unavailable and no cloud model: No new briefs generated
- Read-only operation (briefs cannot be edited in frontend)

**Dependencies:**
- Backend: `/api/research/briefs`, `/api/research/queue-run`, `/api/ai/runtime-status`
- Store: `useIntelligence()`
- WebSocket: `intelligence-update` channel (optional real-time updates)

---

### 3.11 CONGRESS ACTIVITY

**Overall Status**: PRODUCTION

**Location**: `apps/desktop/src/renderer/pages/intel/Congress.tsx`

**Features:**

1. **Tabbed Interface**
   - **Trades Tab**: Congress member stock transactions
   - **Lobbying Tab**: Lobbying activity by organization
   - **Contracts Tab**: Government contract awards
   - Component: `CongressTabs.tsx`

2. **Data Display & Filtering**
   - Trades: Member name, symbol, action (buy/sell), value, date
   - Lobbying: Organization, issue, amount, quarter
   - Contracts: Contractor, agency, value, award date
   - Filter component: `CongressFilter.tsx` (by member, sector, value range)

3. **Analytics Panels**
   - **Most Traded Symbols**: Frequency ranking of traded symbols
   - **Disclosure Lag Stats**: Days between transaction and disclosure
   - Visual: Bar chart + numeric summary
   - Component: `CongressAnalytics.tsx`

4. **AI Scan Flow**
   - Trigger: User clicks "Scan for Insights" button
   - Endpoint: POST `/api/congress/analyze`
   - Payload: Current filter context (date range, members, symbols)
   - Output: Pattern detection results, anomalies, trading signals
   - Debug payload display: JSON dump (copy-out action)
   - File: `services/congress/scanService.ts`

5. **Data Fetch Actions**
   - Manual refresh: Re-fetches from source API
   - Auto-refresh: Every 24 hours (scheduled)
   - Status indicator: Shows fetch timestamp and status
   - Component: `CongressRefresh.tsx`

**Known Limitations:**

- Feature quality depends on external source freshness (SEC, SOPR API)
- Rate limiting: Max 10 requests/min per source
- Fallback: Cached data if API temporarily unavailable
- Lag: 2-3 day lag from transaction to public disclosure

**Dependencies:**
- Backend: `/api/congress/trades`, `/api/congress/lobbying`, `/api/congress/contracts`, `/api/congress/analyze`
- Store: `useCongress()`
- External: SEC SOPR API, House.gov Clerk API

---

### 3.12 TERMINAL AI (Local Runtime Management)

**Overall Status**: PRODUCTION

**Location**: `apps/desktop/src/renderer/pages/ai/TerminalAI.tsx`

**Core Functionality:**

1. **AI Runtime Controls**
   - Start/stop local runtime service
   - Config file editor (native text editor dialog)
   - Model selection dropdown
   - Focus prompt input field
   - File: `components/ai/RuntimeControls.tsx`

2. **Runtime Status Panel**
   - Real-time status: Running / Stopped / Error
   - Queue depth: N tasks pending
   - Last run timestamp + duration
   - Model info: Name, version, parameter count
   - Component: `RuntimeStatus.tsx`

3. **Action Buttons**
   - **Run Now**: Force immediate research queue execution
   - **Refresh Briefs**: Regenerate all pending briefs
   - **Open Config**: Dialog to edit config.json for LocalAI
   - Component: `ActionButtons.tsx`

4. **Cloud Fallback Awareness**
   - Check: Is LocalAI available?
   - If No: Show "Using Cloud AI" badge + provider name
   - User can toggle: Prefer Cloud / Prefer Local
   - Setting stored in device localStorage
   - File: `stores/aiPreference.ts`

5. **Error Handling**
   - Connection failures: Retry logic (3 attempts)
   - Timeout handling: 30-second default timeout
   - Error message display: User-friendly copy in UI
   - Log capture: Errors logged to file `logs/ai-runtime.log`

**Operational Details:**

- LocalAI binary: `apps/backend/localai/bin/localai` (Windows exe)
- IPC channel: `ai-runtime-control`
- Status check: Ping localhost:8080/health (every 5 sec)
- File: `src/main/services/aiRuntime.ts`

**Limitations:**

- Local runtime dependency: Hard gate for offline mode
- Requires significant local compute (GPU recommended)
- Model loading: 2-5 min cold start time
- Memory footprint: 4-8GB minimum

**Dependencies:**
- Process: LocalAI binary (managed by main process)
- IPC: Electron event channels
- Store: `useAiRuntimeStore()`

---

### 3.13 SUPPLY CHAIN MIND MAP

**Overall Status**: PRODUCTION (Deep Integration)

**Location**: `apps/desktop/src/renderer/pages/intel/SupplyChain.tsx`

**Advanced Features:**

1. **Multi-View Workspace**
   - **Map View**: Node-link graph visualization (D3 + custom renderer)
   - **List View**: Hierarchical entity listing with expand/collapse
   - **Timeline View**: Supply chain events ordered chronologically
   - Tab switching: `useSupplyChainView()` hook
   - File: `components/supplyChain/ViewSelector.tsx`

2. **Graph Generation & Search**
   - **Generate**: Trigger supply chain map build from entity
   - Endpoint: POST `/api/supply-chain/generate`
   - Params: `{ companyId, depth, relationshipTypes }`
   - Status: Poll `/api/supply-chain/generate/{jobId}` until complete
   - Result: Graph JSON loaded into visualization
   - File: `services/supplyChain/mapGenerator.ts`

   - **Search**: Find entities within loaded graph
   - Type-ahead search in input
   - Highlight matching nodes + connected edges
   - Component: `GraphSearch.tsx`

3. **Graph Control Panel**
   - **Strict Mode**: Toggle (include all nodes vs. critical path only)
   - **Hypotheses**: Show/hide hypothesis edges (speculative relationships)
   - **Hops**: Slider to control traversal depth (1-6)
   - **Edge Weight Threshold**: Filter by relationship strength
   - Component: `GraphControls.tsx`

4. **Shock & Simulation**
   - **Shock Mode**: Simulate node removal (supplier disruption)
   - Select node → Mark as "shocked/unavailable"
   - Recalculate impact cascade: Which downstream nodes affected?
   - Visual: Red highlight for impacted nodes
   - Component: `ShockSimulator.tsx`

   - **Simulation Results**:
     - Impact score (0-100)
     - Critical path through graph
     - Suggested alternative routes
     - File: `services/supplyChain/shockAnalysis.ts`

5. **TED Integration**
   - TED threat overlay on graph
   - Color nodes by threat level (green/yellow/red)
   - Click node → Show detailed TED brief
   - Component: `TedOverlay.tsx`

6. **Graph Enrichment Inspector**
   - Show enrichment status per edge/node
   - Candidate / Validation / Production state display
   - Manual enrichment trigger
   - Confidence score display
   - File: `components/supplyChain/EnrichmentInspector.tsx`

7. **Data Export & Maintenance**
   - Export formats: JSON, CSV, GraphML
   - Snapshot save/load (persist current view)
   - Refresh graph (re-pull from backend)
   - Clear cache (force full regeneration)
   - Component: `ExportControls.tsx`

8. **Enrichment Sync Status**
   - Real-time sync status with backend
   - Visual: Progress bar showing % complete
   - Timestamp of last sync
   - Details: How many nodes/edges synced
   - Component: `SyncStatusPanel.tsx`

**Architecture Detail:**

- State: `useSupplyChainStore()` (Zustand)
- Graph library: `d3` + custom React wrapper
- Networking: WebSocket for real-time sync updates
- Caching: IndexedDB for graph persistence (100MB limit)
- File: `stores/supplyChain.ts` (lines 1-250)

**Known Limitations:**

- Cloud sync informational only (unless backend connected)
- Some sync statuses show placeholder text if provider unavailable
- Very large graphs (1000+ nodes) can hit rendering performance limits
- Shock analysis computed locally (not distributed)

**Dependencies:**
- Backend: `/api/supply-chain/generate`, `/api/supply-chain/map/{id}`, `/api/supply-chain/shock-analysis`
- Store: `useSupplyChainStore()`
- WebSocket: `supply-chain-sync` channel
- External graph lib: `d3@7.0.0`, `react-force-graph`

---

### 3.14 DATA VAULT

**Overall Status**: PRODUCTION (Strong Local Operations)

**Location**: `apps/desktop/src/renderer/pages/data/DataVault.tsx`

**Section Model (9 Sections):**

| Section | Purpose | Status | Key Controls |
|---------|---------|--------|--------------|
| **Overview** | Summary stats + growth metrics | PRODUCTION | Record count, data freshness |
| **Entities** | Person, Organization, Location, Product | PRODUCTION | Filter, expand, drill-down |
| **Relationships** | Links between entities (suppliers, owners, etc.) | PRODUCTION | Visualize as graph, filter by type |
| **Evidence** | Source citations and data provenance | PRODUCTION | Filter by source, date range |
| **Validation** | Quality assessment per record | PRODUCTION | Pass/fail/review status |
| **Usage** | Where entities appear (supply chains, GWMD, etc.) | PRODUCTION | Cross-reference tracking |
| **Snapshots** | Point-in-time graph exports | PRODUCTION | Save, load, compare versions |
| **Cloud** | Cloud sync status and configuration | PARTIAL | Sync controls, status display |
| **Settings** | Data Vault configuration | PRODUCTION | Export format, cache settings |

**2. Filter Model**

Advanced filter combinator (AND/OR logic):

| Filter Dimension | Options | Usage |
|------------------|---------|-------|
| **Status** | Active, Archived, Under Review | Clean data vs. draft stage |
| **Zone** | Candidate, Validation, Production | Data maturity tier |
| **Type** | Entity type (Person, Org, etc.) | Scope by entity category |
| **Source** | Public, SEC, TED, GWMD, etc. | Data origin filter |
| **Confidence** | High (>0.95), Med (0.7-0.95), Low (<0.7) | Trust level |
| **Freshness** | <7 days, <30 days, >30 days | Data age filter |

File: `components/dataVault/FilterModel.tsx` (lines 80-150)

**3. Detail Panel & Drill-Down**

- Click entity card → Detail panel slides in
- Show: All fields, confidence scores, source citations, relationships
- Actions: View related entities, export, add to watchlist
- Component: `EntityDetailPanel.tsx`
- File: `stores/dataVault.ts` (selectedEntity state)

**4. Operations & Workflows**

1. **Refresh**
   - Endpoint: POST `/api/data-vault/refresh`
   - Scope: Full graph or specific zone (production only)
   - Background task: Status polled every 2 seconds
   - File: `services/dataVault/refreshService.ts`

2. **Revalidate**
   - Endpoint: POST `/api/data-vault/revalidate`
   - Input: Entity ID or zone
   - Output: Updated confidence scores, reconciliation report
   - File: `services/dataVault/revalidateService.ts`

3. **Export**
   - Format: JSON (with metadata), CSV (flat), GraphML (visualization)
   - Scope: Filtered results or full vault
   - Size limit: 500MB (chunked export if larger)
   - File save: Desktop file system via `electron.dialog.showSaveDialog`

4. **Open Graph Memory IPC**
   - Action: "Open in Graph Explorer"
   - IPC channel: `graph-memory-open`
   - Payload: Entity ID + context
   - Handler: `src/main/handlers/graphMemory.ts`

5. **Reveal in File System**
   - Export current results to temp CSV
   - Open in default spreadsheet app
   - Path: User's download folder

**5. Cloud Configuration**

- **Cloud Readiness Payload**: API returns `isCloudReady` flag
- If Ready: Show sync controls, last sync time
- If Not Ready: Show "Cloud sync not configured", link to backend setup docs
- Component: `CloudSection.tsx` (conditional rendering)

**6. TED Integration**

- **TED Data Vault Panel**: Shows TED-sourced entities
- Updates real-time via WebSocket
- Component: `TedDataVaultPanel.tsx`
- File: `components/ted/TedDataVaultPanel.tsx`

**Local Persistence:**

- Database: SQLite (desktop app)
- Tables: `data_vault_entities`, `data_vault_relationships`, `data_vault_evidence`
- Sync: GraphMemory IPC channel for main process coordination
- Size limit: 2GB (managed automatically)

**Dependencies:**
- Backend: `/api/data-vault/list`, `/api/data-vault/entity/{id}`, `/api/data-vault/refresh`, `/api/data-vault/revalidate`
- IPC: `graph-memory-open`, `graph-memory-export`
- Store: `useDataVault()`
- External: SQLite driver (`better-sqlite3`)

---

### 3.15 GWMD MAP (Global Warning & Monitoring Dashboard)

**Overall Status**: PRODUCTION (Deep Integration)

**Location**: `apps/desktop/src/renderer/pages/intel/GwmdMap.tsx`

**Features:**

1. **Incremental Search**
   - Type entity name or ID to search
   - Results: Matching entities + count
   - Click result → Load entity + connected graph
   - Auto-fetch missing nodes on expand
   - File: `components/gwmd/SearchInput.tsx`

2. **Persisted Graph Handling**
   - Graph saved in state: `useGwmdStore().currentGraph`
   - Browser back/forward works with graph state
   - Local caching: Last 5 graphs in app memory
   - File: `stores/gwmd.ts`

3. **Run Status & Search Trace**
   - Show graph generation job status (pending/running/complete)
   - Trace log: Which nodes fetched, in what order, timing
   - Error tracking: Log fetch failures with retry count
   - Component: `RunStatusPanel.tsx`
   - File: `services/gwmd/executeService.ts`

4. **Degraded Mode Handling**
   - If backend unavailable: Show cached graph + "offline" badge
   - Search disabled in offline mode
   - Component: `OfflineIndicator.tsx`

5. **Display-Surface Orchestration**
   - Multiple view modes:
     - **Wall**: Multi-monitor layout (4 panes, synchronized)
     - **Analyst**: Single-focused view with detail sidebars
     - **Mirror**: Secondary synchronized view (for collaboration)
   - Mode switching: Dropdown in toolbar
   - File: `components/gwmd/ViewModeSelector.tsx`

6. **Cloud Push/Pull/Status Sync**
   - **Push**: Save current graph to cloud
   - **Pull**: Load graph from cloud
   - **Status**: Show sync timestamp + dirty flag
   - Endpoint: POST/GET `/api/gwmd/sync`, `/api/gwmd/sync-status`
   - File: `services/gwmd/cloudSync.ts`

7. **TED & Supply Chain Overlays**
   - TED threat coloring: Red (critical), Orange (high), Yellow (medium)
   - Supply chain marker: Icon indicates supply chain entity
   - Click node → Show linked supply chain map
   - Component: `TedOverlay.tsx`

8. **Exposure Brief Support**
   - Panel showing relevant intelligence briefs
   - Auto-pulled based on graph entities
   - File: `components/gwmd/ExposureBrief.tsx`

**Architecture:**

- State: `useGwmdStore()` (complex state, 500+ lines)
- Graph viz: D3-based custom renderer (WebGL for performance)
- IPC: Main process coordinates cloud sync
- WebSocket: Real-time graph updates
- File: `stores/gwmd.ts` (lines 1-550)

**Known Limitations:**

- Sync behavior backend/auth gated
- Uses fallback/cached behavior when remote unavailable
- Very large graphs (5000+ nodes) may have rendering slowdowns
- Cloud push/pull requires authenticated backend session

**Dependencies:**
- Backend: `/api/gwmd/search`, `/api/gwmd/expand`, `/api/gwmd/sync`, `/api/gwmd/sync-status`
- Store: `useGwmdStore()`
- WebSocket: `gwmd-updates` channel
- Graph lib: `d3@7.0.0`

---

### 3.16 SETTINGS & LOGS (Control Center)

**Overall Status**: PRODUCTION (Extensive Control Surface)

**Location**: `apps/desktop/src/renderer/pages/settings/Settings.tsx`

**1. Runtime Source & Replay Controls**

- **Source Toggle**:
  - Live mode: Connect to backend server
  - Replay mode: Consume pre-recorded event logs
  - File: `components/settings/RuntimeSource.tsx`

- **Replay Controls**:
  - Load replay file: File picker
  - Play/pause/speed slider (0.5x - 4x)
  - Seek to timestamp
  - File: `components/settings/ReplayControls.tsx`

**2. AI Model & Routing Preferences**

- **Model Selection**
- Dropdown: LocalAI, Claude, GPT-4, Ollama, Custom
  - Current selection stored in `useAiPreference()` hook
  - Affects all downstream brief generation
  - File: `stores/aiPreference.ts`

- **Routing Preference**
  - Radio: Prefer Local, Prefer Cloud, Cloud Only
  - Auto-switch logic if selected unavailable
  - Component: `RoutingSelector.tsx`

**3. Cloud AI Configuration**

- **Provider Draft Management**
  - Edit provider configs (API keys, endpoints)
  - Save/delete/test provider configs
  - Component: `CloudProviderConfigurator.tsx`
  - Secure storage: Uses Electron `keytar` module

**4. Backend URL Management**

- **Server URL Input**
  - Current backend URL display
  - Edit capability with validation (URL format check)
  - Component: `ServerUrlInput.tsx`

- **Health Probing**
  - Button: "Test Connection"
  - Ping: GET `/api/health`
  - Result: Show status (✓ Connected, ✗ Failed, timeout info)
  - File: `services/backend/healthCheck.ts`

**5. TED Live Configuration**

- **TED Settings**
  - Enable/disable TED data feeds
  - Feed selection (which threat categories)
  - Polling interval (5 min - 60 min)
  - Component: `TedConfig.tsx`

**6. External Feed Testing**

- **Feed Test Interface**
  - Select feed type (BLS, FRED, Congress, etc.)
  - Run test: Fetch sample data
  - Show latest data + last update time
  - Display JSON response
  - Component: `FeedTestPanel.tsx`
  - File: `services/feeds/testBridge.ts`

**7. Key Test Status**

- **Status Dashboard**
  - API key validity checks (API key expiration, permissions)
  - Service health (Backend, LocalAI, Cloud AI, External APIs)
  - Visual: Green (healthy), Yellow (degraded), Red (down)
  - Last check timestamp
  - Component: `ServiceStatusDashboard.tsx`

**8. AI Steward Overview & Interaction**

- **Steward Dashboard**
  - Current focus entity
  - Hypothesis count
  - Last run timestamp
  - Component: `StewardOverview.tsx`

- **Steward Config**
  - Edit focus/entity preferences
  - Trigger manual analysis run
  - View findings (expandable)
  - Apply tasks (mutations)
  - File: `components/steward/StewardConfig.tsx`

**9. Logs Display**

- **Log Viewer**
  - Filter by severity (Info, Warn, Error)
  - Filter by module (AI, Backend, Trading, etc.)
  - Real-time tail: Last 100 entries
  - Search: Text search across visible logs
  - Component: `LogViewer.tsx`

- **Log Export**
  - Export to file: Desktop file system
  - Format: Plain text or JSON
  - Date range selectable
  - File: `services/logging/export.ts`

- **Log Files Location**
  - Desktop app logs: `%appdata%/trading-terminal/logs/`
  - Backend logs: `logs/` directory (if local)

**File References:**

Main settings page: `apps/desktop/src/renderer/pages/settings/Settings.tsx`  
Store: `stores/settings.ts`  
IPC handler: `src/main/handlers/settings.ts`

**Dependencies:**
- Store: `useSettings()`, `useAiPreference()`
- Services: `healthCheck`, `feedTest`, `logExport`
- IPC: `settings-update`, `logs-fetch`, `test-feed`
- Security: Electron `keytar` for credential storage

---

### 3.17 API HUB (Hidden/Detached)

**Overall Status**: ACTIVE

**Location**: `apps/desktop/src/renderer/pages/specialty/ApiHub.tsx`

**Functionality:**

1. **Secure Credential Listing**
   - Lists saved API keys by provider/service
   - Display: Provider name, masked key (show last 4 chars), expiration date
   - Component: `ApiKeyList.tsx`

2. **Save/Remove Workflow**
   - Add new key: Modal dialog with provider dropdown, key input
   - Save: Encrypted storage via `keytar` (Windows Credential Manager backing)
   - Remove: Delete action with confirm
   - File: `services/credentials/keyManagement.ts`

3. **Access Method**
   - URL query: `?mode=api-hub`
   - Or: Settings → "API Hub" button
   - Dedicated window: Opens in separate Electron window
   - Kept in focus, synchronized with main window state

**Dependencies:**
- IPC: `api-hub-open`
- Security: `keytar` package (Windows)
- Store: `useCredentials()`

---

### 3.18 SMART ROUTING OVERVIEW (Hidden/Detached)

**Overall Status**: ACTIVE

**Location**: `apps/desktop/src/renderer/pages/specialty/SmartRouting.tsx`

**Features:**

1. **Visual Routing Surface**
   - Flow diagram: Order → Routing algorithm → Venues
   - Real-time order flow visualization
   - Color by venue (each exchange different color)
   - Component: `RoutingDiagram.tsx`

2. **API Hub Integration**
   - Show available venue API credentials
   - Routing decisions based on available connections
   - Snapshot of current routing capacity
   - File: `services/routing/capacityCheck.ts`

**Access:**
- URL query: `?mode=smart-routing`
- Dedicated floating window

**Known Limitations:**
- Read-only visualization (routing logic in backend)
- No manual override of routing decisions
- Simulated data if backend unavailable

---

### 3.19 GLOBAL SUPPLY CHAIN MAP (Hidden/Detached)

**Overall Status**: ACTIVE

**Location**: `apps/desktop/src/renderer/pages/specialty/GlobalMap.tsx`

**Features:**

1. **Full-Window Global Map**
   - MapLibre-based world map
   - Supply chain entities plotted by location
   - Heatmap overlay: Concentration of suppliers/manufacturers
   - Component: `GlobalMapCanvas.tsx`

2. **Graph Load & Visualization**
   - Load: `useSupplyChainStore().globalGraph`
   - Fetched on mount via `/api/supply-chain/global-graph`
   - Zoom/pan controls
   - Entity selection highlights connected nodes

**Access:**
- URL query: `?mode=global-map`
- Dedicated full-screen window

---

## 4) Desktop Service & IPC Architecture

### 4.1 IPC Surface Overview

**Status**: PRODUCTION (Broad, Complex)

**Main Process Handler Files:**

| Domain | Handler File | Channels | Count |
|--------|------------|----------|-------|
| **Auth** | `src/main/handlers/auth.ts` | login, logout, get-user, refresh | 5+ |
| **AI** | `src/main/handlers/ai.ts` | ai-runtime-control, ai-status-check | 4+ |
| **Public Flow** | `src/main/handlers/publicFlow.ts` | fetch-flow, subscribe-flow | 3+ |
| **Congress** | `src/main/handlers/congress.ts` | fetch-congress, analyze-congress | 3+ |
| **Supply Chain** | `src/main/handlers/supplyChain.ts` | generate-map, shock-analysis | 4+ |
| **Graph Memory** | `src/main/handlers/graphMemory.ts` | graph-memory-open, export | 5+ |
| **GWMD** | `src/main/handlers/gwmd.ts` | gwmd-search, gwmd-sync | 4+ |
| **Config** | `src/main/handlers/config.ts` | get-config, set-config | 3+ |
| **Streams** | `src/main/handlers/stream.ts` | subscribe-feed, unsubscribe | 4+ |
| **Replay** | `src/main/handlers/replay.ts` | load-replay, play, seek | 4+ |
| **Trading** | `src/main/handlers/trading.ts` | place-order, cancel-order | 4+ |
| **Journal** | `src/main/handlers/journal.ts` | add-trade, edit-trade | 4+ |
| **Window** | `src/main/handlers/window.ts` | open-detached-tab, sync-state | 5+ |

**Total IPC Channels**: 50+

**Risk Assessment**: ⚠️ **Large attack surface / regression risk**
- Recommendation: Add integration test suite for IPC
- Priority: Document critical paths (auth, trading, sync)

---

### 4.2 Critical IPC Paths

1. **Authentication Flow**
   - User login → IPC `auth:login`
   - Main process validates, gets JWT token
   - Token stored in secure credential store (`keytar`)
   - Renderer can access via IPC `auth:get-token`

2. **AI Runtime Management**
   - Renderer requests: `ai:start-runtime`
   - Main process spawns LocalAI process
   - Status polling: `ai:status` every 5 sec
   - Renderer UI updates based on status

3. **Graph Memory Coordination**
   - Renderer modifies graph: Updates Zustand store
   - On action (export, open): IPC call to main process
   - Main process coordinates with backend sync
   - File: `src/main/handlers/graphMemory.ts`

4. **Detached Tab Windowing**
   - User drags tab from app shell
   - Trigger: `window:create-detached`
   - Main creates new BrowserWindow
   - Sync channel opened: `sync:{tabId}` for state sharing
   - File: `src/main/handlers/window.ts` (lines 100-200)

---

## 5) Backend API Layer

### 5.1 Platform & Authentication (Production)

**Status**: PRODUCTION (Strong)

**Files**: `apps/backend/src/auth*.ts`

**Endpoints:**

| Endpoint | Method | Status | Auth | Description |
|----------|--------|--------|------|-------------|
| `/api/health` | GET | ✅ | None | Health check + version |
| `/api/runtime-flags` | GET | ✅ | Optional | Feature flags, build info |
| `/api/auth/signup` | POST | ✅ | None | User registration |
| `/api/auth/login` | POST | ✅ | None | Login, return JWT + refresh |
| `/api/auth/refresh` | POST | ✅ | None | Refresh JWT token |
| `/api/auth/me` | GET | ✅ | JWT | Get current user + profile |
| `/api/auth/logout` | POST | ✅ | JWT | Logout + invalidate token |
| `/api/auth/2fa/setup` | POST | ✅ | JWT | Initiate 2FA setup |
| `/api/auth/2fa/verify` | POST | ✅ | JWT + TOTP | Verify 2FA code |
| `/api/auth/2fa/disable` | POST | ✅ | JWT + TOTP | Disable 2FA |

**Key Features:**

1. **JWT Token Management**
   - Issued on login: 24-hour expiry
   - Refresh token: 7-day expiry, rotation on use
   - Stored server-side for revocation checks
   - File: `src/authSessionStore.ts` (lines 50-150)

2. **2FA Support**
   - TOTP (Time-based One-Time Password)
   - Setup: Generate QR code, user scans with authenticator app
   - Verify: User enters 6-digit code on login
   - Disable: Requires current TOTP code (anti-brute force)
   - File: `src/totp.ts`

3. **Session Store**
   - In-memory or Redis-backed
   - Track active sessions, IP address, user agent
   - Detect concurrent sessions from different IPs (warn user)
   - File: `src/authSessionStore.ts`

4. **Middleware**
   - `authMiddleware.ts`: Validates JWT in all protected routes
   - Tenant context propagation (multi-tenant awareness)
   - Role gating hooks (admin, user, guest)
   - File: `src/authMiddleware.ts`

---

### 5.2 User & Trading State (Production)

**Status**: PRODUCTION

**Endpoints:**

| Endpoint | Method | Status | Purpose |
|----------|--------|--------|---------|
| `/api/user/settings` | GET/PUT | ✅ | User preferences CRUD |
| `/api/user/watchlist` | GET/POST/DELETE | ✅ | Watched symbols |
| `/api/trading/orders` | GET/POST | ✅ | Place order + list orders |
| `/api/trading/orders/{id}` | GET/DELETE | ✅ | Order detail + cancel |
| `/api/trading/positions` | GET | ✅ | Current open positions |
| `/api/trading/account` | GET | ✅ | Account balance + margin |

**Database Schema:**
- Table: `users` (id, username, email, password_hash, 2fa_secret)
- Table: `trading_orders` (id, user_id, symbol, side, qty, price, status, created_at)
- Table: `trading_positions` (id, user_id, symbol, qty, avg_price, current_price)

---

### 5.3 Congress & PublicFlow Endpoints (Production)

**Status**: PRODUCTION

**Congress Endpoints:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/congress/trades` | GET | List congress trading activity |
| `/api/congress/lobbying` | GET | List lobbying activity |
| `/api/congress/contracts` | GET | List government contracts |
| `/api/congress/metrics` | GET | Analytics: Most traded, disclosure lag |
| `/api/congress/analyze` | POST | AI scan for patterns/signals |

**PublicFlow Endpoints:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/public-flow/recent` | GET | Recent filings (Forms, 8-K, etc.) |
| `/api/public-flow/themes` | GET | Trending themes/topics |
| `/api/public-flow/candidates` | GET | Relevant entities/candidates |
| `/api/public-flow/valuations` | GET | Market impact estimates |
| `/api/public-flow/refresh` | POST | Force refresh latest data |

**File**: `apps/backend/src/services/congress*.ts`

---

### 5.4 TED Intel Endpoints (Active with Fallback)

**Status**: ACTIVE (LOCAL-FALLBACK behavior)

**Endpoints:**

| Endpoint | Method | Status | Behavior |
|----------|--------|--------|----------|
| `/api/ted/snapshot` | GET | ✅ | Returns real TED snapshot OR mock if disabled |
| `/api/ted/config` | GET/PUT | ✅ | Get/update TED config (auth-protected) |

**Snapshot Logic:**

```typescript
// Pseudo-code
GET /api/ted/snapshot
  if (tedEnabled && tedApiAvailable) {
    return fetchFromTedLive()  // Real data
  } else {
    return generateMockSnapshot()  // Fallback
  }
```

**Mock Provider**:
- File: `apps/backend/src/services/tedIntel/tedIntelMock.ts`
- Generates realistic-looking fake threats (for demo/testing)
- Updates every request (no caching in mock mode)

**File**: `apps/backend/src/services/tedIntel/tedIntelLive.ts` (currently open in editor)

---

### 5.5 Supply Chain Endpoints (Dual Path)

**Status**: PRODUCTION (AI queue-backed)

**Non-AI Endpoints:**

| Endpoint | Method | Purpose | Cache |
|----------|--------|---------|-------|
| `/api/supply-chain/generate` | POST | Generate map (non-AI) | ✓ 1 hour |
| `/api/supply-chain/cache` | GET | List cached maps | - |
| `/api/supply-chain/clear` | DELETE | Clear map cache | - |
| `/api/supply-chain/advisor` | GET | Heuristic suggestions | ✓ 30 min |

**AI Endpoints (Queue-Backed):**

| Endpoint | Method | Purpose | Queue Type |
|----------|--------|---------|------------|
| `/api/supply-chain/ai/generate` | POST | AI-powered map generation | `supply-chain-generate` |
| `/api/supply-chain/ai/map/{id}` | GET | Cached AI map | - |
| `/api/supply-chain/ai/insights` | GET | AI analysis insights | - |

**Queue Job Structure**:
- Job type: `supply-chain-generate`
- Params: `{ companyId, depth, threadHopLimit }`
- Callback: Updates `supply_chain_jobs` table
- TTL: 7 days
- File: `src/queue.ts`, `src/services/supplyChain/queuedGenerate.ts`

---

### 5.6 AI Research Queue & Jobs (Advanced)

**Status**: PRODUCTION (Advanced)

**Endpoints:**

| Endpoint | Method | Purpose | Auth |
|----------|--------|---------|------|
| `/api/research/queue-run` | POST | Trigger research run | JWT |
| `/api/research/jobs/{jobId}` | GET | Get job status | JWT |
| `/api/research/jobs/{jobId}/cancel` | POST | Cancel job | JWT |
| `/api/research/briefs` | GET | List generated briefs | JWT |
| `/api/research/briefs/{id}` | DELETE | Dismiss brief | JWT |
| `/api/research/config` | GET/PUT | Research config | JWT |
| `/api/research/status` | GET | Overall queue status | JWT |

**Queue Implementation:**

1. **Queue Backend**: Bull.js (Redis-backed) or in-memory
   - File: `src/queue.ts`
   - Job types: `research:run`, `research:brief`, `calendar:insight`, `congress:analyze`

2. **Idempotency Key Support**
   - Header: `X-Idempotent-Key` (UUID)
   - If duplicate request with same key: Return cached result
   - File: `src/middleware/idempotency.ts`

3. **202 Accepted Response**
   - Job enqueued, not yet started
   - Response: `{ jobId, status: 'pending', pollUrl: '/api/research/jobs/{jobId}' }`
   - Client polls status until complete

4. **Job Persistence**
   - Table: `research_jobs` (id, userId, type, status, result, createdAt, completedAt)
   - TTL: Auto-delete after 30 days

---

### 5.7 Economic Calendar (Queue-Backed)

**Status**: PRODUCTION

**Endpoints:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/calendar/list` | GET | List economic events |
| `/api/calendar/economic-insight` | POST | Generate LLM insight for event |

**Calendar Data Integration**:
- Source: Multiple providers (FRED, BLS, official calendars)
- Update cadence: Hourly
- Cache: 4-hour TTL
- File: `src/services/calendar/calendarSync.ts`

**Insight Generation**:
- Queue-backed: `calendar:insight` job type
- Input: Event data + market context
- Output: LLM-generated trading implications
- File: `src/services/calendar/insightGenerator.ts`

---

### 5.8 AI Congress Analysis (Queue-Backed)

**Status**: PRODUCTION

**Endpoints:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/congress/analyze` | POST | AI scan + pattern detection |
| `/api/congress/watchlist` | GET/POST/DELETE | User-specific monitoring |

**Congress Analysis Queue**:
- Job type: `congress:analyze`
- Input: Congress data context (date range, members, symbols)
- Output: Patterns, anomalies, signals
- File: `src/services/congress/analyzeQueue.ts`

---

### 5.9 GWMD Cloud Sync (Backend-Gated)

**Status**: PRODUCTION (Gated by Auth/Storage)

**Endpoints:**

| Endpoint | Method | Purpose | Status |
|----------|--------|---------|--------|
| `/api/gwmd/push` | POST | Save graph to cloud | Gated |
| `/api/gwmd/pull` | POST | Load graph from cloud | Gated |
| `/api/gwmd/sync-status` | GET | Check sync timestamp | Gated |

**Gating Factors**:
- User must be authenticated (JWT required)
- Backend must have database connection (PostgreSQL/Redis)
- Cloud storage must be provisioned (S3 or local FS)
- File: `src/services/gwmd/cloudSync.ts` (fallback handling)

**Cache Layers**:
- Status cache: 5-minute TTL
- Pull response cache: 10-minute TTL per user
- File: `src/services/gwmd/cacheSync.ts`

---

### 5.10 AI Orchestrator (Production)

**Status**: PRODUCTION

**Endpoints:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/orchestrator/interactions` | POST | Log user interaction |
| `/api/orchestrator/predictions` | GET | Get next-action predictions |
| `/api/orchestrator/stats` | GET | Session stats |
| `/api/orchestrator/preload` | POST | Pre-fetch data (role-gated) |

**Role-Based Access**:
- `user`: Can log interactions, view own predictions
- `admin`: Can preload/batch operations
- File: `src/authMiddleware.ts` (role gates)

---

### 5.11 AI Steward (Production)

**Status**: PRODUCTION

**Endpoints:**

| Endpoint | Method | Purpose | Auth |
|----------|--------|---------|------|
| `/api/steward/overview` | GET | Current focus + status | JWT |
| `/api/steward/config` | GET/PUT | Configure focus | JWT |
| `/api/steward/run-module` | POST | Trigger analysis module | JWT |
| `/api/steward/findings` | GET | Analysis findings list | JWT |
| `/api/steward/tasks` | GET | Action tasks | JWT |
| `/api/steward/apply-task` | POST | Apply task (mutation) | JWT + Admin |

**Steward Features**:
- Tracks hypothesis focus (company, risk type, etc.)
- Generates analysis findings
- Proposes data corrections/enrichments (tasks)
- File: `src/services/ai/steward.ts`

---

### 5.12 AI Provider Visibility & Metrics (Production)

**Status**: PRODUCTION

**Endpoints:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/ai/provider-settings` | GET | Configured AI providers |
| `/api/metrics/prometheus` | GET | Prometheus metrics |
| `/api/metrics/json` | GET | JSON format metrics |

**Prometheus Metrics**:
- HTTP request latency, error rates
- Queue job counts (queued, active, completed)
- AI runtime status (local vs. cloud)
- File: `src/metrics.ts`

---

## 6) Data & Persistence

### 6.1 Desktop Persistence (SQLite)

**Status**: PRODUCTION

**Repositories (SQLite-backed):**

| Domain | Database File | Tables | Purpose |
|--------|---------------|--------|---------|
| **Trading** | `trading-desktop.db` | `trading_orders`, `trading_positions`, `trading_fills` | Orders, positions, execution history |
| **Journal** | `journal-desktop.db` | `journal_trades`, `journal_tags`, `journal_sessions` | Trade review, statistics |
| **Public Flow** | `publicflow-desktop.db` | `flow_filings`, `flow_themes` | SEC filings cache |
| **Congress** | `congress-desktop.db` | `congress_trades`, `congress_lobbying` | Congress data cache |
| **Supply Chain** | `supplychain-desktop.db` | `sc_entities`, `sc_relationships`, `sc_maps` | Graph cache |
| **GWMD** | `gwmd-desktop.db` | `gwmd_graphs`, `gwmd_searches` | GWMD graph cache |
| **AI Research** | `ai-research-desktop.db` | `research_briefs`, `research_jobs` | Brief history |

**Location**: `%appdata%\trading-terminal\data\`

**File References**:
- Database initialization: `apps/desktop/src/main/database/init.ts`
- Migration system: Using `better-sqlite3` with migration scripts
- File: `apps/desktop/src/main/database/migrations/`

### 6.2 Backend Persistence (PostgreSQL)

**Status**: PRODUCTION (Environment-Gated)

**Core Tables:**

| Table | Columns | Purpose |
|-------|---------|---------|
| `users` | id, email, username, password_hash, 2fa_secret, created_at | User accounts |
| `user_settings` | user_id, key, value, updated_at | Per-user config |
| `trading_orders` | id, user_id, symbol, side, qty, price, status, filled_qty, created_at | Order history |
| `trading_positions` | id, user_id, symbol, qty, avg_price, created_at, updated_at | Current positions |
| `research_jobs` | id, user_id, type, status, result, created_at, completed_at | AI job tracking |
| `research_briefs` | id, job_id, user_id, title, content, created_at | Generated briefs |
| `congress_data` | id, member, symbol, action, value, date_filed | Congress transactions (cache) |
| `gwmd_graphs` | id, user_id, owner_entity, nodes, edges, created_at | Synced GWMD graphs |
| `tenant_context` | user_id, tenant_id, role, created_at | Multi-tenant mapping |

**File**: `apps/backend/src/index.ts` (database pool init)

**Optional Redis Cache**:
- Session tokens
- Calendar event cache
- GWMD sync status
- File: `src/infra.ts`

### 6.3 Graph Enrichment & Data Vault

**Status**: PRODUCTION (Local-First)

**Concepts**:

1. **Candidate Zone**
   - Newly discovered entities/relationships
   - Confidence: Often low
   - Source: Automated extraction, web scraping
   - Status: Under review

2. **Validation Zone**
   - Entities passed initial checks
   - Confidence: Medium (0.7-0.95)
   - Source: Confirmed against multiple sources
   - Status: Approved for use

3. **Production Zone**
   - Fully verified, high-confidence
   - Confidence: High (>0.95)
   - Source: Authoritative (government, official docs)
   - Status: Ready for critical decisions

**Local Graph Storage**:
- Database: SQLite (desktop) or PostgreSQL (backend)
- Tables: `graph_entities`, `graph_relationships`, `graph_evidence`
- Indexing: On confidence, zone, source, freshness

**Revalidation Pipeline**:
- Endpoint: POST `/api/data-vault/revalidate`
- Process: Re-check entities against current sources
- Update confidence scores
- Move entities between zones
- File: `src/services/dataVault/revalidateService.ts`

**Export Capability**:
- Format: JSON (with metadata), CSV (flat), GraphML (viz)
- File: `src/services/dataVault/exportService.ts`

---

## 7) Build & Release

### 7.1 Desktop Build Pipeline

**Status**: PRODUCTION

**Build Tools**:
- Bundler: Vite (React), esbuild (backend compile)
- Packager: electron-builder
- Installer: NSIS (Windows EXE)
- File: `apps/desktop/electron-builder.config.cjs`

**Build Artifacts**:
- Windows EXE installer: `Trading Cockpit Setup 0.0.1.exe`
- Unpacked app directory: `win-unpacked/`
- Update metadata: `latest.yml`, `.blockmap` files
- Location: `apps/desktop/release/`

**Code Signing** (Production Only):
- Certificate: Windows code signing cert (if configured)
- EV certificate recommended for UAC prompts
- File: `electron-builder.config.cjs` (certificateFile, certificatePassword)

**Auto-Update**:
- Mechanism: electron-updater (checks `latest.yml`)
- Frequency: Daily check at app start
- File: `src/main/updater.ts`

### 7.2 Backend Build & Deployment

**Status**: PRODUCTION

**Build Process**:
1. `npm run build` → Compile TypeScript to JS
2. `npm run start` → Start Express server
3. Docker: `docker build -f apps/backend/Dockerfile`

**Dockerfile**:
- Base: Node.js 18 LTS Alpine
- Exposures: Port 3000 (HTTP)
- File: `apps/backend/Dockerfile`

**Environment Variables** (Docker/run):

| Variable | Purpose | Example |
|----------|---------|---------|
| `DATABASE_URL` | PostgreSQL connection | `postgres://user:pass@localhost/tradingdb` |
| `REDIS_URL` | Redis cache (optional) | `redis://localhost:6379` |
| `JWT_SECRET` | Token signing key | 32+ char random string |
| `AI_PROVIDER` | AI backend | `localai` / `openai` / `claude` |
| `AI_ENDPOINT` | AI service URL | `http://localai:8080` |
| `TED_API_KEY` | TED data feed | API key from provider |
| `LOG_LEVEL` | Logging verbosity | `debug` / `info` / `warn` / `error` |

**File**: `apps/backend/Dockerfile`, environment examples in repo root

### 7.3 Database Migrations

**Status**: PRODUCTION

**Migration Files** (SQL):
- Location: `apps/backend/migrations/`
- Naming: `001_init.sql`, `002_add_table.sql`, etc.
- Applied sequentially on startup

**Key Migrations**:

| # | Name | Timestamp | Purpose |
|---|------|-----------|---------|
| 001 | `normalized_core` | Initial | Core schema (users, orders, briefs) |
| 002 | `migrate_from_user_state` | - | Legacy data conversion |
| 003 | `ai_research_briefs` | - | Research job + brief tables |
| 008 | `auth_identity_foundation` | - | Enhanced auth fields |
| 009 | `auth_users_license_key` | - | License key support |
| 010 | `tenant_id_foundation` | - | Multi-tenant columns |
| 012 | `gwmd_cloud` | - | GWMD sync tables |
| 013 | `ted_procurement_intel` | - | TED data tables |
| 014 | `sec_edgar_vault_extension` | - | Security enrichment |

**Location**: `apps/backend/migrations/` directory

**Monitoring**:
- Track applied migrations: `schema_migrations` table
- Automatic detection: Compare applied vs. filesystem on startup
- Rollback: Manual if needed (not automated)

---

## 8) Operational Maturity Classification

### 8.1 By Feature Family

| Family | Maturity | Status | Notes |
|--------|----------|--------|-------|
| **AI Intelligence** | Advanced Prototype → Production | 80% | Research queue, briefs, congress/calendar AI done. Steward/Orchestrator in production. |
| **Graph & Data Vault** | Advanced Research Prototype | 70% | Local enrichment pipeline solid. Cloud sync conditional. |
| **Supply Chain Intelligence** | Advanced Integrated Prototype | 75% | Map generation, shock analysis, TED overlay integrated. Performance-tested on 1K+ node graphs. |
| **Core Trading Execution** | Usable Foundation | 60% | Order ticket, position sizing, journal solid. Risk calc (margin, Greeks) not yet. |
| **Classical Markets** (Charting/Microstructure) | Early Prototype | 30% | MACRO (JOLTS) done. Microscape placeholder. Structure partial (no drawing tools). |
| **Maritime/Aviation Maps** | Implemented, Unshipped | 50% | Cargo Flights + Oil Tanker pages coded, not in primary nav. Can be re-enabled. |

### 8.2 Risk Zones

| Zone | Risk Level | Mitigation |
|------|-----------|------------|
| **IPC Surface** | HIGH | Document critical paths; add integration tests |
| **Multi-Tenant Auth** | MEDIUM | Audit tenant context propagation; unit test role gates |
| **Graph Enrichment** | MEDIUM | Validate zone moves; confidence score audit trail |
| **AI Fallback Chains** | MEDIUM | Log all fallback activations; monitor mock data usage |
| **Market Data Feeds** | MEDIUM | Implement feed health checks; alert on stale data |

---

## 9) Known Gaps & Roadmap

### 9.1 Immediate (Next Sprint)

| Gap | Impact | Effort | Owner |
|-----|--------|--------|-------|
| **Tab model consolidation** | Tech debt | 2-4h | Desktop Team |
| **Microscape pages stub** | UX gap | 4-8h | Desktop Team |
| **IPC integration tests** | Quality | 8-16h | QA + Desktop |
| **STRUCTURE drawing tools** | Feature | 20-30h | Desktop Team |

### 9.2 Short Term (Q2 2026)

| Gap | Impact | ETA | Owner |
|-----|--------|-----|-------|
| **Portfolio margin calculator** | Trading | 4 weeks | Quantitative Team |
| **Options analytics (Greeks)** | Feature | 6 weeks | Options Team |
| **Multi-leg strategy builder** | Feature | 8 weeks | Desktop + Backend |
| **Custom market data feeds** | Integration | 8 weeks | Data Team |

### 9.3 Medium Term (Q3-Q4 2026)

| Gap | Impact | ETA | Owner |
|-----|--------|-----|-------|
| **Level 2 depth rendering** | Trading | 12 weeks | Desktop Team |
| **Options P&L calculator** | Feature | 12 weeks | Quantitative |
| **AI agent personality system** | Feature | 16 weeks | AI Team |
| **Real-time market API** | Integration | 16 weeks | Infra + Data |

---

## 10) Verification Checklist

**Last Audit Date**: March 25, 2026

**Verification Steps** (for next release):

- [ ] All 16 tabs render without errors
- [ ] IPC health check (all critical channels respond)
- [ ] Backend health endpoint returns 200
- [ ] Auth flow: signup → login → 2FA → logout works
- [ ] AI runtime: Can start/stop LocalAI smoothly
- [ ] Graph operations: Generate 1K-node supply chain map, verify performance
- [ ] Export: Data Vault export to JSON/CSV completes
- [ ] Cloud sync: Push/pull GWMD graph (if backend available)
- [ ] Stress test: Run for 4 hours with continuous data stream
- [ ] Logs: Verify no CRITICAL errors in 4-hour run

---

## 11) Document Maintenance

**Version History:**

| Version | Date | Author | Summary |
|---------|------|--------|---------|
| 4.0 | 2026-03-22 | Dev Team | Initial V4 status baseline |
| 5.0 | 2026-03-25 | Dev Team | Comprehensive feature audit, detailed maturity assessment |

**Next Update**: April 1, 2026 (or post-release)

**Feedback Channel**: [Link to issue tracker]

---

## Appendix A: Environmental Dependencies

### A.1 Required External Services

| Service | Purpose | Fallback | Status |
|---------|---------|----------|--------|
| **PostgreSQL** | Backend data persistence | SQLite (desktop only) | Required |
| **Redis** (optional) | Session/cache layer | In-memory store | Recommended |
| **LocalAI** | Local LLM runtime | Cloud AI or mock | Optional w/ fallback |
| **SEC EDGAR API** | Congress/flow data | Cached dump | Required (or cached) |
| **FRED API** | Economic data | Demo data | Required (or demo) |
| **TED Data Feed** | Threat intelligence | Mock data | Optional w/ fallback |

### A.2 Client Environment Requirements

- **Windows**: Windows 10+, 8GB RAM, 2GB disk space
- **Node.js**: v18.x LTS (for local dev)
- **Electron**: v27.x (bundled in release)
- **Network**: 10+ Mbps recommended (for data streams)

---

## Appendix B: Quick Reference - Critical File Locations

### Desktop App

```
apps/desktop/
├── src/
│   ├── main/           # Electron main process
│   ├── preload/        # Preload scripts
│   └── renderer/       # React frontend
│       ├── pages/      # Tab pages (16 tabs)
│       ├── stores/     # Zustand stores
│       ├── components/ # Shared components
│       └── services/   # Frontend service layer
├── electron-builder.config.cjs  # Build config
└── package.json
```

### Backend API

```
apps/backend/
├── src/
│   ├── auth*.ts        # Auth modules
│   ├── services/       # Feature services
│   ├── handlers/       # Request handlers
│   ├── queue.ts        # Queue system
│   └── infra.ts        # Database/Redis init
├── migrations/         # SQL migration files (001-016)
├── Dockerfile         # Container build
└── package.json
```

### Shared

```
packages/
├── api/               # Shared types/interfaces
└── shared/            # Utilities, constants
```

---

## Appendix C: Troubleshooting Common Issues

### Issue: Feature not visible in app shell

- Check tab definition in `apps/desktop/src/renderer/shared/constants/tabs.ts`
- If commented out, uncomment + rebuild
- Clear browser cache: `AppData\Local\trading-terminal\`

### Issue: Backend API returning 404

- Verify Express route definition in `apps/backend/src/services/*`
- Check middleware order in `index.ts`
- Verify JWT token in Authorization header (if auth-required)

### Issue: AI briefs not generating

- Check LocalAI runtime status: Settings → Terminal AI
- If stopped, click "Start" button
- Fall back to cloud AI: Settings → AI Model Preference → Cloud

### Issue: GWMD sync not working

- Verify backend running: GET `/api/health`
- Check auth token validity: GET `/api/auth/me`
- Check PostgreSQL connection: Backend logs should show init messages

### Issue: Graph enrichment slow

- Check graph size: Data Vault → Cloud section
- Reduce hops in Supply Chain controls (slide to 3 instead of 6)
- Index status check: Contact data team

---

**End of Document**  
*Treat as operational ground truth as of March 25, 2026.*


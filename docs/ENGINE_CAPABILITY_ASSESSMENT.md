# Engine Capability Assessment

**Date:** March 29, 2026

**Question:** Is the current engine capable of supporting the STRATEGY_RESEARCH_TAB_REWORK_PLAN.md?

**Answer:** **Yes, substantially yes.** The current engine has most of the core infrastructure in place. However, there are critical gaps in the UI layer and artifact generation layer that must be addressed.

---

## Executive Summary

| Layer                    | Status                   | Readiness                                                                              |
| ------------------------ | ------------------------ | -------------------------------------------------------------------------------------- |
| **Data layer**           | ✅ Complete              | Snapshot naming, checksums, symbol management, corporate actions                       |
| **Simulation engine**    | ✅ Complete              | Backtest simulation, fills, costs, positions, trades                                   |
| **Metrics**              | ✅ Most metrics complete | CAGR, Sortino, Calmar, tail risk, alpha/beta, attribution — all computed               |
| **Metadata & lineage**   | ✅ Mostly complete       | Run metadata table exists; strategy/version hash tracking in place                     |
| **Hybridcloud fallback** | ✅ Complete              | Desktop local + cloud backend pattern established                                      |
| **Governance framework** | ✅ Complete              | Paper/live promotion, forward profiles, drift monitoring, alerts                       |
| **Validation/preflight** | ✅ Complete              | Pre-run diagnostics gate exists                                                        |
| **Artifact generation**  | ⚠️ Partial               | Equity curve, trades stored; **missing:** manifests, full artifact bundle, CSV exports |
| **Manifest rendering**   | ❌ Missing               | No human-readable manifest generation or display                                       |
| **UI layout**            | ❌ Missing               | Current flat four-tab layout; needs seven-panel workspace restructure                  |
| **Report panel**         | ❌ Missing               | Metrics block exists; needs full structured report with all sections                   |
| **CLI drawer**           | ❌ Missing               | No embedded CLI within tab; commands exist in backend only                             |
| **Run Composer modal**   | ❌ Missing               | No modal gate before run; runs start from button click                                 |
| **Compare panel**        | ✅ Partial               | Comparison APIs exist; **missing:** UI for side-by-side metric delta, assumption diff  |
| **Dataset inspector**    | ❌ Missing               | Not scoped to Strategy Research tab; needs lightweight variant                         |

---

## What Works (Do Not Rebuild)

### 1. Simulation Engine (Advanced)

**Status:** ✅ Complete

- **File:** `apps/backend/src/services/backtesting/advancedBacktestEngine.ts`
- **Capabilities:**
  - Cash + position tracking
  - Full order state machine (market, limit, stop, stop-limit)
  - Partial fills and fill queueing
  - Gap handling, rejects, cancels
  - Slippage and commission modeling
  - Position flips with explicit accounting
  - Multi-asset portfolio tracking
  - Leverage and borrowing constraints

**Ready to use as-is.**

### 2. Metrics Computation

**Status:** ✅ ~95% complete

- **File:** `apps/backend/src/services/backtesting/backtestAnalytics.ts`
- **Computed metrics:**
  - Total return, Sharpe, max drawdown (basic)
  - **CAGR** ✅
  - **Annualized volatility** ✅
  - **Sortino ratio** ✅
  - **Calmar ratio** ✅
  - **Turnover %** ✅
  - **Win rate, profit factor, expectancy** ✅
  - **Long/short decomposition** ✅
  - **Tail risk metrics (VaR95, expected shortfall)** ✅
  - **Alpha/beta vs benchmark** ✅
  - **Sector and factor attribution** ✅
  - **Monthly returns** ✅
- **Missing metrics:**
  - Tracking error (easy add)
  - Information ratio (easy add)
  - Skew/kurtosis (straightforward)
  - Payoff ratio, avg win/loss (straightforward)

**Missing metrics are trivial additions to existing analytics layer.**

### 3. Run Metadata & Lineage

**Status:** ✅ Complete foundation

- **File:** `apps/backend/src/services/backtesting/backtestingRepo.ts`
- **Stored on runs:**
  - Strategy ID + version ID
  - Dataset snapshot ID
  - Assumptions hash (deterministic JSON hash)
  - Strategy code hash (SHA256)
  - Dataset snapshot checksum
  - Engine version tag
  - Run timestamp, duration, status
  - Full metrics JSON
  - Equity curve, trades, positions

- **Stored per run record:**
  - `run_metadata` JSONB column with: mode, assumptions_hash, strategy_hash, dataset_hash, engine_version
  - All required for reproducibility and lineage diff

**Ready to use. No changes needed.**

### 4. Hybrid Cloud/Local Fallback

**Status:** ✅ Complete

- **Desktop local:** SQLite persistence, local engine via `localStrategyResearchService.ts`
- **Cloud backend:** Queue-backed execution via `backtestingService.ts`
- **Store logic:** `apps/desktop/src/renderer/store/strategyResearchStore.ts` handles fallback
  - Tries cloud API first
  - Falls back to local SQLite on auth failure
  - Normalizes cloud and local payloads for shared UI

**No changes needed. This pattern is stable.**

### 5. Historical Data Download & Cache

**Status:** ✅ Complete

- **Source:** Stooq EOD (daily bars, US + international symbols)
- **Local cache:** Desktop userData directory with TTL
- **Logic:** `localStrategyResearchService.ts` handles download/cache/refresh
- **Format:** JSON cache files per symbol

**Ready to use as-is.**

### 6. Governance Framework (Paper/Live Bridge Foundations)

**Status:** ✅ Complete

- **Connectors:** `strategy_provider_connectors` table with CRUD APIs
- **Governance profiles:** `strategy_governance_profiles` with transition rules, OOS minimums, replay tolerances
- **Acceptance packs:** `strategy_acceptance_packs` with checklist and definition-of-done
- **Forward profiles:** `strategy_forward_profiles` with drift monitoring and alerts
- **Promotion validation:** Metrics thresholds, governance gates, audit trail
- **Readiness API:** `/api/strategy/governance/readiness` checks prerequisites

**Backend implementation is complete. UI is not integrated yet.**

---

## What Is Partially Done (Needs Completion)

### 1. Artifact Generation

**Status:** ⚠️ Partial — 60% done

- **Currently captured:**
  - Equity curve: `Array<{timestamp, value}>`
  - Trades: `Array<{symbol, side, quantity, price, fees, slippage}>`
  - Positions: Available from engine state
  - Drawdown: Computable from equity curve
  - Monthly returns: Already in metrics
  - All metrics: `metrics.json` format

- **Not yet generated:**
  - ❌ **Manifest file** (human-readable run document)
  - ❌ **CSV exports** (equity curve CSV, trades CSV, monthly returns CSV, drawdown CSV)
  - ❌ **Artifact registry** (run_artifacts table linkage)
  - ❌ **PDF report** (export report as PDF)
  - ❌ **Warnings JSON** (pre-run and runtime diagnostics)
  - ❌ **Structured report JSON** (report.json format for rendering)

**Effort to complete:** Low–Medium. These are mostly file I/O and formatting tasks layered on existing metrics.

### 2. Comparison and Diff APIs

**Status:** ⚠️ Partial — 70% done

- **Backend:**
  - `compareRunMetrics()` exists and calculates metric deltas
  - Lineage diff API exists for code/data/assumptions diff

- **Missing:**
  - ❌ UI for side-by-side metric delta table
  - ❌ Assumption diff visual (table with changed/unchanged badges)
  - ❌ Equity curve overlay (A vs B)
  - ❌ Mode comparison view (paper-spec vs runnable vs robust)

**Effort to complete:** Medium. Backend logic exists; need UI components.

---

## What Is Missing (Must Build)

### 1. UI Layout Restructure

**Status:** ❌ Not started

**Current:** Four horizontal tabs (Strategies | Editor | Run History | Details)

**Target:** Seven-panel workspace:

- Left rail (Library, Studio, Runs, Reports, Compare, Data, Settings)
- Center workspace (primary content)
- Right inspector (context-sensitive)
- Bottom drawer (CLI, logs, queue, warnings)

**Effort:** High. Requires redesigning the entire tab layout. ~350–500 LOC for layout shell.

### 2. Strategy Studio Tabs

**Status:** ❌ Not started (current Editor tab must be restructured)

**Target tabs:**

- Overview (metadata)
- Logic (code editor — mostly exists)
- Parameters (structured parameter table)
- Assumptions (assumption table with source/note/last-changed)
- Validation (checklist of pre-run gates)
- Notes (free text)

**Current state:** Code editor exists; parameters and assumptions are ad-hoc or missing.

**Effort:** Medium–High. Requires component refactoring and schema changes. ~400–600 LOC.

### 3. Run Composer Modal

**Status:** ❌ Not started

**Required before any run can execute:**

- Strategy version (locked)
- Dataset snapshot (picker)
- Universe (locked or picker)
- Benchmark (locked or picker)
- Date range
- Initial capital
- Fee/slippage preset
- Random seed
- Output tags
- Run notes

**Effort:** Medium. ~300–400 LOC for modal + validation.

### 4. Report Panel

**Status:** ⚠️ Partial — 20% done (metrics block exists)

**Currently has:** Basic metrics display in Details view

**Target sections:**

1. Header block (IDs, timestamp, gross/net label)
2. Equity curve with benchmark
3. Drawdown pane
4. Performance summary (all required metrics)
5. Trade distribution chart
6. Monthly return heatmap
7. Exposure profile chart
8. Turnover profile chart
9. Benchmark comparison
10. Assumption block
11. Data lineage block
12. Notes and verdict

**Effort:** High. ~800–1200 LOC for full report panel with all sections. Charts will be the main work.

### 5. Manifest Generation & Display

**Status:** ❌ Not started

**Required manifest contents:**

- Run metadata (IDs, timestamps)
- Strategy definition (ID, version, code hash, notes)
- Dataset definition (ID, snapshot, checksum, calendar, timezone)
- Assumptions (every assumption value)
- Execution mode (desktop-local, backend, or paper/live)
- Engine version
- Metrics (summary of key metrics)
- Artifacts (list of files generated)
- Warnings (if any)

**Format:** Human-readable Markdown-style document + JSON structure

**Effort:** Medium. ~300–400 LOC for generation + display tab.

### 6. Manifest Tab

**Status:** ❌ Not started

**Rendering:** Human-readable formatted document (not raw JSON)

**Effort:** Low–Medium. ~200 LOC for tab component + markdown renderer.

### 7. Artifacts Tab

**Status:** ❌ Not started

**Shows:** Registered artifacts with download/open buttons

**Requires:** `run_artifacts` table integration (backend has it; UI does not use it)

**Effort:** Low. ~150–200 LOC.

### 8. CLI Drawer

**Status:** ❌ Not started

**Required features:**

- Command input
- Command history (up/down arrow navigation)
- Pinned commands
- Real-time log stream
- Output rendering with clickable artifact links

**Backend has:** CLI command support via Python Typer; not exposed to UI

**Effort:** High. ~600–800 LOC for drawer + command bridge + log streaming.

### 9. Embedded Dataset Inspector

**Status:** ❌ Not started

**Lightweight variant of Data Vault tab, scoped to Strategy Research:**

- Dataset table with key columns
- Dataset detail view with metadata
- Symbol grid with filters
- Universe summary metrics

**Effort:** Medium. ~400–500 LOC. Can reuse Data Vault components if available.

### 10. Missing Metrics (Final 5%)

**Status:** ⚠️ Almost there

**Missing computations:**

- Tracking error vs benchmark
- Information ratio
- Skew/kurtosis
- Payoff ratio (avg win / avg loss)

**Effort:** Very Low. ~100 LOC add to `backtestAnalytics.ts`.

---

## What Should NOT Be Rebuilt

❌ **Do not touch:**

1. Desktop local backtest engine (`localStrategyResearchService.ts`) — working
2. Backend simulation engine (`advancedBacktestEngine.ts`) — solid
3. Metrics computation (`backtestAnalytics.ts`) — comprehensive
4. Hybrid fallback logic (`strategyResearchStore.ts`) — stable
5. Governance framework (backend slices 1–8) — production-ready
6. Historical data download/cache — functional
7. Database schema (migrations 001–025) — established
8. Run metadata foundation — in place
9. Lineage diff APIs — working

**Only rebuild:** UI layer and artifact/manifest generation layer.

---

## Build Roadmap (Scoped to Engine Capability)

### Phase 1A: Artifact & Manifest (Prerequisite)

- Generate manifest JSON and human-readable manifest format
- Register artifacts in `run_artifacts` table
- Generate CSV exports (equity curve, trades, drawdown, monthly returns)
- Generate warnings JSON from pre-run diagnostics
- Effort: ~400 LOC backend, ~100 LOC IPC bridge

### Phase 1B: UI Layout Restructure (Shell)

- Implement seven-panel layout (left rail, center, right, drawer)
- Wire up left rail navigation
- Effort: ~400 LOC

### Phase 2: Strategy Studio Tabs

- Refactor current Editor into six-tab structure
- Implement Assumptions tab (structured table)
- Implement Validation tab (checklist)
- Effort: ~500 LOC

### Phase 3: Run Composer Modal

- Build modal with all required fields
- Enforce prerequisites gate
- Effort: ~350 LOC

### Phase 4: Report Panel

- Migrate current Details metrics to Report section
- Add all remaining report sections (curves, heatmap, attribution, etc.)
- Add export buttons (PDF, CSV)
- Effort: ~1000 LOC

### Phase 5: Compare & Diff

- Build side-by-side metric delta table
- Implement assumption diff view
- Add equity curve overlay
- Effort: ~400 LOC

### Phase 6: CLI Drawer & Dataset Inspector

- Implement embedded CLI drawer with log streaming
- Build lightweight dataset/universe inspector
- Effort: ~700 LOC

---

## Critical Dependencies

### For Phase 1 (Artifacts & Manifests)

✅ **Already met:**

- Run metadata schema exists
- Metrics are computed
- Lineage tracking is in place

❌ **New work only:**

- Manifest template + generation logic
- CSV export format + generation
- run_artifacts table population

### For Phase 2+ (UI)

✅ **Already met:**

- Desktop IPC bridge (exists)
- State management (Zustand store in place)
- API contracts (backend routes exist)
- Validation logic (pre-run diagnostics in place)

❌ **New work only:**

- React component hierarchy
- Layout CSS/styling
- Modal and drawer components
- Chart/visualization components

---

## Risk Assessment

| Risk                            | Probability | Impact | Mitigation                                                |
| ------------------------------- | ----------- | ------ | --------------------------------------------------------- |
| Chart rendering performance     | Low         | Medium | Use lightweight chart lib (recharts, Plotly lite)         |
| Complex assumption diff display | Medium      | Low    | Start simple, iterate on visual design                    |
| Manifest format bloat           | Low         | Low    | Keep manifest text-based and minimal                      |
| CLI command bridge complexity   | Medium      | Medium | Leverage existing IPC infrastructure                      |
| PDF export dependency           | Low         | Medium | Use lightweight PDF lib (jsPDF) or server-side generation |

---

## Conclusion

**The current engine IS capable of supporting the rework plan.**

The backend and simulation layers are mature. The main work is UI/UX restructuring and artifact generation — not engine changes.

**Go/No-Go:** ✅ **GO** — Proceed with Phase 1A (artifact/manifest generation) immediately, then Phase 1B (UI layout).

The plan is achievable without engine refactors.

---

_End of assessment._

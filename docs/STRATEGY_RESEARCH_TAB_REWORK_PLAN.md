# Strategy Research Tab — Rework Plan

**Date:** March 29, 2026
**Replaces:** BACKTESTING_TAB_STATE.txt, STRATEGY_RESEARCH_STRATEGY_TESTER_ENGINE.txt, BACKTESTING_PRODUCTION_GAP_CHECKLIST.md, BACKTESTING_PRODUCTION_IMPLEMENTATION_CHECKLIST.md
**Scope:** Full rework of the Strategy Research tab (`StrategyResearch.tsx`) and its supporting engine stack into a local-first research operating system for strategies.

---

## Product Thesis

Stop thinking of this tab as a "backtester with charts."
Redesign it as a **research operating system** whose primary job is to preserve context:

- What strategy ran
- On what dataset
- Under which assumptions
- With which costs and execution convention
- From which code version
- Producing which artifacts

That is the difference between a hobby backtester and a serious research tool.

The existing workflow already points here: the three strategy modes (`paper-spec`, `minimal-runnable`, `robust-research`) are first-class differentiators and must be treated as structural features — not file-naming conventions.

---

## Design Target

> Feel like a cleaner, stricter hybrid of TradingView Strategy Report clarity, AmiBroker workflow discipline, and a local LEAN-style research engine — running inside the existing terminal shell.

**Copy from TradingView:** Report clarity. Separate surfaces for overview, equity, performance summary, trade list, strategy properties.

**Copy from AmiBroker:** Analysis workflow. Watchlist/universe filtering, result list discipline, desk-style floating/undocked panel thinking.

**Copy from LEAN:** Research discipline. Explicit data conventions, timestamped output directories, checksummed manifests, streaming logs.

**Do not copy:** TradingView chart-first dependence, AmiBroker UI density, LEAN cloud complexity.

---

## Scope Constraints (v1 of this rework)

### In scope

- US equities and ETFs
- Daily bars (EOD)
- Local data only (Stooq-style EOD source, local Parquet/CSV cache)
- Local-first runs (desktop SQLite + Electron main process engine)
- Backend cloud runs when authenticated (queue-backed, existing architecture)
- Backtest only — no live trading
- Single-user desktop app
- Reproducible runs with full manifest and artifact capture

### Out of scope for this rework

- Minute / tick data
- Options, futures
- Broker execution / live trading bridge changes
- Multi-user or collaboration features
- AI strategy generation
- Complex intraday fill models

---

## New Tab Layout

The Strategy Research tab replaces its current four-tab layout (`Strategies | Editor | Run History | Details`) with a **seven-panel workspace** that matches the product thesis.

### Left Rail (persistent within tab)

Vertical icon navigation:

| Icon     | Panel                      |
| -------- | -------------------------- |
| Library  | Strategy library           |
| Studio   | Strategy Studio (editor)   |
| Runs     | Run history                |
| Reports  | Report viewer              |
| Compare  | Run comparison             |
| Data     | Dataset/universe inspector |
| Settings | Strategy Research settings |

### Center Workspace

Primary content panel, changes based on rail selection.

### Right Inspector

Context-sensitive panel showing:

- Dataset info and snapshot metadata
- Strategy version metadata
- Parameter set
- Run status and duration
- Artifact list with links
- Notes field

### Bottom Drawer (within tab, not global)

Collapsible drawer containing:

- Embedded CLI surface (command input + output)
- Real-time log stream from active run
- Task queue and download progress
- Warnings and preflight notices

This drawer makes the tab feel like a workstation, not a dashboard.

---

## Panel Designs

### A. Strategy Library Panel

Replaces the existing Strategies sidebar.

**Left column — strategy list:**
Each strategy card shows:

- Name and ID
- Mode badge: `paper-spec` / `minimal-runnable` / `robust-research`
- Status badge: `draft` / `validated` / `pinned` / `archived`
- Last run date
- Best Sharpe / Max DD from most recent run

**Actions:**

- New Strategy
- Clone
- Archive
- Pin

---

### B. Strategy Studio Panel

Replaces the existing Editor tab. Tabbed structure:

#### Overview tab

| Field       | Notes                                           |
| ----------- | ----------------------------------------------- |
| Strategy ID | Auto-assigned, immutable                        |
| Version ID  | Auto-incremented per save                       |
| Thesis      | Free text                                       |
| Family      | e.g. cross-sectional momentum                   |
| Asset class | US Equities                                     |
| Frequency   | Daily                                           |
| Benchmark   | e.g. SPY                                        |
| Tags        | Freeform                                        |
| Mode        | paper-spec / minimal-runnable / robust-research |

#### Logic tab

- Code editor with syntax highlighting
- `onBar(ctx)` contract (existing)
- Validate / lint button
- Code hash displayed (matches what is stored in run manifest)

#### Parameters tab

Structured table — not free text:

| Parameter | Value | Type | Bounds | Default | Locked | Note |
| --------- | ----- | ---- | ------ | ------- | ------ | ---- |

Locked parameters cannot be changed without creating a new version.

#### Assumptions tab

Every assumption is explicit and recorded per version:

| Assumption             | Value                       | Source | Note | Last Changed |
| ---------------------- | --------------------------- | ------ | ---- | ------------ |
| Ranking signal         |                             |        |      |              |
| Data adjustment        | adjusted / raw              |        |      |              |
| Fill convention        | EOD close / next open       |        |      |              |
| Missing data policy    | skip / forward-fill / error |        |      |              |
| Universe policy        | fixed / dynamic             |        |      |              |
| Transaction cost (bps) |                             |        |      |              |
| Slippage (bps)         |                             |        |      |              |
| Rebalance timing       | month-end-next-open / etc   |        |      |              |
| Warmup bars            |                             |        |      |              |
| Benchmark              |                             |        |      |              |

This is the most important tab. No assumption may be implicit.

#### Validation tab

Checklist surfaced before any run:

| Item                             | Status               |
| -------------------------------- | -------------------- |
| Has dataset / universe           | green / yellow / red |
| Has benchmark defined            |                      |
| Has transaction costs defined    |                      |
| Has slippage defined             |                      |
| Has rebalance timing defined     |                      |
| Has warmup period defined        |                      |
| Has comparable prior run         |                      |
| Code has no lookahead constructs |                      |
| Script syntax valid              |                      |

Status is green / yellow / red. Red items block run.

#### Notes tab

Free text. Persisted per version. Shown in report and manifest.

---

### C. Run Composer

Opens as a confirmation modal before any run execute. Currently the "Run Backtest" action skips this — that must change.

**Sections:**

1. Strategy version (auto-selected, locked to saved version)
2. Dataset snapshot (select from available local snapshots or download)
3. Universe (from strategy assumptions or override)
4. Benchmark (from strategy assumptions or override)
5. Date range (start / end)
6. Initial capital
7. Fee / slippage preset (or custom bps)
8. Random seed (for any stochastic steps)
9. Output tags (freeform tokens)
10. Run notes (free text, appears in manifest)

**Summary line at bottom:**

> You are about to run `momentum_v3.robust` on `us_equities_daily_2026-03-29.snap01` from 2014-01-01 to 2025-12-31 with 20 bps + slippage 5 bps, EOD rebalance, benchmark SPY.

**Actions:**

- Run Now
- Save as Preset
- Queue (add to queue, do not start immediately)

No run may execute without passing all red items in the Validation tab.

---

### D. Runs Panel

Replaces the existing Run History tab. Full table view.

**Main table columns:**

| Column           | Notes                                         |
| ---------------- | --------------------------------------------- |
| Run ID           | Clickable                                     |
| Strategy         |                                               |
| Version          |                                               |
| Dataset snapshot |                                               |
| Period           |                                               |
| Started At       |                                               |
| Duration         |                                               |
| Status           | success / failed / warning / running / queued |
| Net Return       |                                               |
| Sharpe           |                                               |
| Max DD           |                                               |
| Artifact count   |                                               |

**Filters:**

- Status
- Strategy name
- Dataset
- Tag
- Date range
- Pinned only

**Selecting a run opens the Run Detail view (right inspector expands or center panel changes).**

Run Detail tabs:

| Tab       | Content                                              |
| --------- | ---------------------------------------------------- |
| Summary   | Key metrics block                                    |
| Equity    | Equity curve chart                                   |
| Drawdown  | Drawdown chart separate pane                         |
| Trades    | Trade log table                                      |
| Positions | Position timeline                                    |
| Turnover  | Turnover chart                                       |
| Logs      | Streaming or captured log output                     |
| Manifest  | Human-readable manifest document (not just raw JSON) |
| Artifacts | Linked artifact files with download/open buttons     |

**Failed runs are first-class objects — never hidden.**

---

### E. Report Panel

Replaces the current Details tab metric block. A structured, exportable report view.

**Report sections:**

1. Header block: Strategy ID, version ID, dataset ID, run ID, generated timestamp, gross/net label
2. Equity curve (labeled with dataset + date range, gross and net lines, benchmark dotted)
3. Drawdown curve (separate pane)
4. Performance Summary (see metrics below)
5. Trade distribution chart
6. Monthly return heatmap
7. Exposure profile chart
8. Turnover profile chart
9. Benchmark comparison block
10. Assumption block (every assumption surfaced inline)
11. Data lineage block (dataset snapshot ID, checksum, corporate action mode, calendar)
12. Notes and verdict (from run notes + strategy notes)

**Required performance metrics:**

| Metric                    |     |
| ------------------------- | --- |
| CAGR                      |     |
| Annualized volatility     |     |
| Sharpe ratio              |     |
| Sortino ratio             |     |
| Calmar ratio              |     |
| Max drawdown              |     |
| Avg drawdown              |     |
| Turnover                  |     |
| Exposure %                |     |
| Win rate                  |     |
| Avg win / avg loss        |     |
| Payoff ratio              |     |
| Profit factor             |     |
| Best month / worst month  |     |
| Return skew / kurtosis    |     |
| Benchmark-relative return |     |
| Tracking error            |     |
| Information ratio         |     |
| Sample length (years)     |     |

**Visual rules:**

- Every chart has: title, subtitle (dataset + date range), gross/net label, benchmark label, export button
- No orphaned charts saved to random folders
- Charts use: dark base, muted panels, one accent color, green/red only for true performance, amber for warnings

**Export actions:**

- Export report as PDF
- Export metrics as CSV
- Export trades as CSV
- Export equity curve as CSV

---

### F. Compare Panel

Side-by-side run comparison. Answers: _Did performance change because of code, data, or assumptions?_

**Layout:**

- Left: Run A picker (from run history)
- Right: Run B picker (from run history)
- Center: metric delta table
- Bottom: synchronized equity curve overlay and drawdown overlay

**Comparison views:**

| View                   | Description                                |
| ---------------------- | ------------------------------------------ |
| A vs B                 | Direct run comparison                      |
| Best in family         | Best run per strategy family               |
| paper-spec vs runnable | Mode comparison within same strategy       |
| Fee model comparison   | Same strategy, different cost assumptions  |
| Data source comparison | Same strategy, different dataset snapshots |
| Assumption diff        | Side-by-side assumption block diff         |

**Assumption diff** is displayed as a table where each row shows the assumption name, value in A, value in B, and a changed / unchanged badge.

---

### G. Dataset / Universe Inspector Panel

Surfaces data provenance within the Strategy Research context. Lighter version of the full Data Vault tab, scoped to what the strategy can actually use.

**Dataset table columns:**

- Dataset ID
- Name
- Source
- Coverage dates
- Adjusted / raw
- Last refreshed
- Symbol count
- Status

**Dataset detail (right inspector):**

- Description, source, timezone, calendar
- Corporate action mode
- Missing-data policy
- Benchmark mapping
- Storage path + checksum / snapshot hash
- Dependent runs (runs that used this snapshot)

**Actions:**

- Validate dataset
- Refresh data
- Freeze snapshot (immutable snapshot for reproducibility)
- Export manifest

**Universe panel** (below or tabbed):

- Symbol grid: ticker, name, sector, exchange, avg volume, data coverage %
- Filters: price, volume, exchange, sector, custom blacklist
- Universe summary: symbol count, sector concentration, missing coverage count

---

## Storage Design

### Metadata (SQLite — existing tables extended)

No new tables needed beyond what is already migrated. The key discipline is **using what exists correctly**:

| Table                  | Purpose                                        |
| ---------------------- | ---------------------------------------------- |
| `strategy_definitions` | Strategy library entries                       |
| `strategy_versions`    | Immutable per-save code + assumption snapshots |
| `backtest_runs`        | Run records with full manifest linkage         |
| `run_metrics`          | Per-run metric rows                            |
| `run_artifacts`        | Artifact file registry per run                 |
| `dataset_snapshots`    | Dataset snapshot registry with checksum        |
| `dataset_symbols`      | Symbol membership per snapshot                 |

**Rule:** A run record must never exist without a corresponding manifest entry. Manifests are generated, not hand-written.

### Artifact Folder Layout (local desktop, per run)

```
{userData}/strategyResearch/runs/{run_id}/
  manifest.json          — human-readable run manifest
  metrics.json           — all computed metrics
  equity_curve.csv       — timestamped equity values (gross and net)
  drawdown.csv           — drawdown series
  monthly_returns.csv    — month-by-month return matrix
  trade_log.csv          — every trade: date, symbol, direction, qty, price, pnl
  positions.csv          — daily position snapshot
  turnover.csv           — daily turnover series
  report.json            — full structured report object
  logs.txt               — captured run log
  warnings.json          — preflight and runtime warnings
  charts/                — exported chart images (PDF/PNG on export)
```

**Rule:** Every artifact in this folder must be registered in `run_artifacts` table. No orphaned files.

### Dataset Cache Layout

```
{userData}/strategyResearch/data/
  {snapshot_id}/
    manifest.json        — snapshot manifest with checksum + coverage
    prices.csv           — or prices.parquet if Parquet support added
    symbols.json         — symbol list with metadata
    issues.json          — gaps, missing prints, delisting events
```

---

## CLI Surface (Bottom Drawer)

The embedded CLI drawer is not cosmetic. It is a first-class control surface.

**Supported commands (phase 1):**

```
data pull --symbols AAPL,MSFT,SPY --start 2015-01-01
data validate --snapshot {snapshot_id}
data freeze --snapshot {snapshot_id}

universe build --name liquid_us_largecaps --filter "price>5 adv>1000000"
universe inspect --name liquid_us_largecaps

strategy validate --id {strategy_id}
strategy clone --from {id} --to {new_name}

run backtest --strategy {id}.{mode} --snapshot {snapshot_id} --from 2014-01-01 --to 2025-12-31
run compare --a {run_id} --b {run_id}

report build --run {run_id}
report export --run {run_id} --format pdf
```

**CLI drawer behavior:**

- Command history (up/down arrow)
- Pinned commands (star a command to keep it accessible)
- Re-run last command button
- Real-time log stream during active run
- Clickable artifact links in output (open file or navigate to report panel)

---

## Visual Style (within tab)

Consistent with the terminal's existing dark theme.

| Element                          | Style                                                                                                                   |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Base                             | Dark graphite                                                                                                           |
| Panels                           | Muted slate (slightly lighter than base)                                                                                |
| Accent                           | Single accent color (matches terminal's existing accent)                                                                |
| Performance positive             | Green only for confirmed positive return states                                                                         |
| Performance negative             | Red only for confirmed negative return states                                                                           |
| Warnings                         | Amber                                                                                                                   |
| Info / artifact links            | Blue                                                                                                                    |
| Typography — UI                  | Inter (existing terminal font)                                                                                          |
| Typography — metrics / IDs / CLI | JetBrains Mono                                                                                                          |
| Spacing                          | 8px grid, dense but breathable                                                                                          |
| Borders                          | Thin, low contrast, slightly rounded                                                                                    |
| Charts                           | Plain, no 3D, no gradients. Benchmark dotted, strategy solid, drawdown separate pane. Hover tooltip with full metadata. |

---

## UX Rules (non-negotiable)

**Rule 1 — No run without prerequisites.**
A run cannot start without: strategy version, dataset snapshot, benchmark, cost model, execution convention. These are enforced in the Run Composer and by the Validation tab gate.

**Rule 2 — Every report shows provenance.**
Every report surface must display: strategy ID, version ID, dataset ID, run ID, gross/net label, generation timestamp.

**Rule 3 — No orphaned artifacts.**
Every file in a run folder must be registered in `run_artifacts`.

**Rule 4 — Every assumption is explicit.**
Every assumption in the Assumptions tab has: value, source note, last changed at. No silent defaults.

**Rule 5 — Failed runs are first-class.**
Do not hide or auto-delete failed runs. Surface them in the Runs panel with their logs and partial artifacts.

**Rule 6 — The manifest is human-readable.**
The Manifest tab in Run Detail must render a formatted document, not raw JSON (raw JSON is also available but not the default view).

**Rule 7 — Answer "what produced this number" in under 2 seconds.**
Any metric shown anywhere in the tab must be traceable to a run ID, version ID, dataset ID, and assumptions block within two clicks.

---

## Three Strategy Modes (first-class feature)

| Mode               | Meaning                                                                                                         | Use case                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `paper-spec`       | Exactly what the paper/source describes. Intentionally not optimized for running. May have missing assumptions. | Capture the original idea without drift |
| `minimal-runnable` | Smallest set of assumptions needed to actually run. Minimal cost model, simple universe.                        | Sanity-check the core logic             |
| `robust-research`  | Conservative real-world variant. Full cost model, liquidity filters, realistic execution convention.            | Evaluate real-world viability           |

These modes are displayed as badges throughout the tab. The Compare panel supports mode comparison as a first-class view (paper-spec vs runnable, runnable vs robust).

This prevents silent drift from research idea to runnable implementation — the most common failure mode in strategy development.

---

## Build Phases

### Phase 1 — Structural rework (spine)

Rework the tab shell: implement the seven-panel layout, left rail navigation, right inspector zone, and bottom CLI drawer.

Replace the current flat four-tab layout with the Strategy Studio tabbed editor (Overview / Logic / Parameters / Assumptions / Validation / Notes).

Implement the Run Composer modal (required before any run can execute).

Enforce Rule 1 (run prerequisites) and Rule 2 (report provenance) at the component level.

**No new backend work required in Phase 1.** Existing engines are sufficient.

### Phase 2 — Artifact and manifest hardening

Generate full artifact bundle per run (all files listed in the artifact folder layout above).

Register every artifact in `run_artifacts` table.

Implement the Manifest tab as a human-readable formatted document.

Implement the Artifacts tab with open/download buttons.

### Phase 3 — Report panel

Replace the current Details metric block with the full structured Report panel.

Implement all required metrics.

Implement equity curve showing gross and net lines with labeled benchmark.

Implement drawdown pane (separate from equity).

Implement monthly returns heatmap.

Implement export PDF and export CSV actions.

### Phase 4 — Compare panel

Implement the Compare panel with A vs B metric delta table.

Implement synchronized equity curve overlay.

Implement assumption diff view.

Add mode comparison view (paper-spec vs runnable vs robust).

### Phase 5 — CLI drawer and Dataset panel

Implement the embedded CLI bottom drawer with command history, log streaming, pinned commands.

Implement the Dataset / Universe Inspector panel within the tab.

Implement `data freeze` command for immutable snapshots.

### Phase 6 — Advanced analytics

Add Sortino, Calmar, information ratio, tracking error, alpha/beta to metrics.

Add trade distribution chart.

Add exposure and turnover profile charts.

Add benchmark-relative return block.

---

## What Already Exists (Do Not Rebuild)

The following are implemented and must be preserved:

- Hybrid cloud/local run architecture (existing `strategyResearchStore.ts` fallback logic)
- Desktop local SQLite persistence (`strategyResearchRepo.ts`)
- Local `onBar(ctx)` engine (`localStrategyResearchService.ts`)
- Backend queue-backed run path (existing backend services)
- Pre-run validation / preflight gate (existing backend + local)
- Governance / connector / acceptance-pack foundation (existing backend slices 1-8)
- Run metadata with assumptions hash, strategy hash, dataset hash, engine version
- Forward profile lifecycle, drift monitoring, alerts (existing backend slices 5-8)
- Historical data download and cache (Stooq-style EOD path)
- Equity curve SVG rendering (existing Details view — migrate to Report panel)
- Trade list rendering (existing Details view — migrate to Report panel)

**Core instruction:** This rework is a UI and workflow restructuring layered on top of the existing engine. Do not rebuild the engine unless a specific gap is identified.

---

## First Screen to Build

Start with the **Run Composer modal** and the **Report panel**.

Reason: fixing the run flow (Run Composer) immediately enforces reproducibility discipline. Building the Report panel immediately surfaces what metadata is missing. These two pieces reveal all remaining gaps faster than anything else.

Do not start with charts or data downloading first — that risks rebuilding the same chaos in a better-looking shell.

---

## The Single Most Important Differentiator

Not faster backtests. Not prettier charts. Not AI.

**Explicit research lineage.**

When a user clicks any result anywhere in this tab, the app must answer in under two seconds:

> _What exactly produced this number?_

If the tab can do that cleanly, it is already more serious than most backtesting tools.

---

_End of plan._

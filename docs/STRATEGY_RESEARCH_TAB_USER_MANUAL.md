# Strategy Research Tab User Manual

Date: 2026-03-29
Audience: Traders, researchers, and operators using the desktop terminal
Scope: How to use the current Strategy Research tab implementation end to end

---

## 1) What This Tab Is For

Strategy Research is your in-terminal workspace for:

- Managing strategy drafts and versions
- Editing strategy code and assumptions
- Running local or cloud backtests
- Reviewing report metrics and run history
- Comparing run outcomes
- Managing data source context
- Exporting reproducible run artifacts

Think of it as a research operating desk: strategy setup, run execution, validation, and export in one place.

---

## 2) Open the Tab

1. Launch the desktop app.
2. In top navigation, select STRATEGY RESEARCH.
3. The page opens with:
   - Left rail navigation
   - Center workspace panel
   - Right context inspector
   - Optional bottom CLI/log drawer

---

## 3) Workspace Layout At A Glance

### Left Rail

Panels available:

- Library
- Studio
- Runs
- Reports
- Compare
- Data
- Settings

### Center Workspace

Main work surface for the active rail panel.

### Right Inspector

Quick context and action area, including:

- Selected strategy summary
- Selected run summary
- Open Run Composer button
- Save Strategy button

### Bottom Drawer

CLI and logs surface. Hidden by default and can be toggled open.

---

## 4) First-Run Quick Start (Recommended)

Use this flow when setting up a strategy from scratch.

1. Go to Library.
2. Create a new strategy.
3. Select that strategy to move into Studio.
4. In Studio:
   - Edit strategy code
   - Set universe symbols
   - Set assumptions (capital, position size, commission, slippage, date range, benchmark)
   - Save strategy
5. Open Run Composer (from Runs panel or right inspector).
6. Confirm execution settings and queue the backtest.
7. Review results in Runs and Reports.
8. Optionally compare with another run in Compare.
9. Export an artifact for reproducibility.

---

## 5) Panel-by-Panel Instructions

## Library Panel

Use Library to manage the strategy catalog.

What you can do:

- Browse available strategies
- Search and filter strategy list
- View status and summary metrics
- Select a strategy for editing/running
- Create a new strategy

Typical workflow:

1. Search or filter until you find the target strategy.
2. Click strategy row/card.
3. Continue in Studio for edits.

## Studio Panel

Use Studio to prepare a strategy for execution.

Sections include:

- Strategy code editor
- Universe settings (including custom symbol list)
- Assumption fields

Important behavior:

- Data source selection in Studio influences execution mode:
  - local-cache -> desktop-local mode
  - non-local source -> backend mode

Best practice:

1. Confirm universe list is non-empty.
2. Ensure assumptions are realistic and complete.
3. Save before running.

## Runs Panel

Use Runs to monitor and manage backtest executions.

What you can do:

- View run list and statuses
- Select a run to inspect details
- Start a new run via Run Backtest (opens Run Composer)
- Download/export artifacts for selected run

Run statuses:

- queued
- running
- completed
- failed
- cancelled

## Reports Panel

Use Reports to inspect a selected run's analysis output.

What you can do:

- View selected run report summary and metrics
- Export report-related artifact

If report content appears empty, first select a run in Runs.

## Compare Panel

Use Compare to evaluate runs side by side.

What you can do:

- Select up to 3 runs in compare set
- Trigger comparison refresh
- Review deltas and comparative metrics

Notes:

- Compare uses currently selected run context.
- For richer comparison payloads, backend run pairs provide remote compare data.

## Data Panel

Use Data to control run data context.

What you can do:

- View data sources and status
- Expand a source to inspect sync details
- Trigger source sync
- Trigger validation checks
- Switch toward backend mode by adding/selecting backend sources

Current source pattern:

- Local cache source is shown
- Backend snapshots appear when backend mode is active and snapshots are available

## Settings Panel

Use Settings for workspace behavior and display preferences.

Tabs:

- General
- Display
- Notifications
- Advanced

What you can do:

- Set defaults (universe, data source)
- Configure metrics detail level
- Configure time/decimal format
- Toggle notifications
- Export settings JSON
- Reset settings to defaults

## CLI Drawer Panel

Use CLI drawer for quick commands and log inspection.

How to open:

- Click the drawer toggle at bottom of Strategy Research layout.

Built-in commands:

- help: show command list
- runs: switch to Runs panel
- report: switch to Reports panel
- composer: open Run Composer
- save: save current strategy
- clear: clear logs

Tips:

- Use log level filter to focus on errors/warnings.
- Store and runtime notices are mirrored into this log stream.

---

## 6) Run Composer: Confirm Before Queue

Run Composer opens before queueing a run.

It summarizes:

- Strategy name
- Strategy version
- Execution mode (Cloud Backend or Desktop Local)
- Dataset snapshot (backend mode)
- Universe symbols
- Assumptions snapshot

Actions:

- Cancel
- Confirm and Queue Backtest

Recommendation:

Always verify strategy version and assumptions before confirming.

---

## 7) Cloud vs Local Mode

## Backend (Cloud)

Use when authenticated and cloud endpoints are available.

Capabilities include:

- Backend dataset snapshot selection
- Cloud run queue and retrieval
- Backend run extras such as:
  - Artifact listing
  - Experiment metadata read/write
  - Robustness report endpoint
  - Remote compare payload

## Desktop-Local

Automatically used when cloud is unavailable or explicitly selected through data source behavior.

Capabilities include:

- Local strategy persistence
- Local run execution
- Downloadable historical daily data caching
- Local run and comparison note persistence

Local pre-run checks enforce:

- Non-empty script
- onBar(ctx) function present
- Non-empty universe
- Valid assumption ranges for key fields

---

## 8) Exporting Artifacts

From Runs or Reports, export creates a JSON artifact that includes:

- Export timestamp
- Strategy metadata
- Version metadata
- Selected run payload
- Optional comparison summary
- Manifest signature metadata (SHA-256)

Use artifact exports for reproducibility, audit trail, and offline sharing.

---

## 9) Advanced Backend Actions

When selected run is backend execution:

- Run robustness analysis
- Save experiment metadata (name, tags, notes, comparison parameters)

If selected run is local, these backend-only actions are not available.

---

## 10) Troubleshooting

## I cannot see cloud strategies or runs

- The workspace may be in local fallback mode.
- Check page notices and CLI logs for cloud auth/unavailable messages.
- Sign in and retry to restore cloud sync.

## Run queue action does nothing

- Ensure a strategy is selected.
- Save strategy so a version exists.
- Confirm universe and assumptions are valid.
- Check error/notice banners and CLI logs.

## Reports panel is empty

- Select a run in Runs first.
- Ensure run status is completed.

## Data snapshots do not appear

- Backend snapshots load only in backend mode.
- Trigger refresh by syncing a source in Data panel.

## I need to clear noisy logs

- Open CLI drawer and use Clear.
- Optionally filter by level to only show warnings/errors.

---

## 11) Operator Best Practices

- Save strategy after meaningful edits before queueing runs.
- Keep universe definitions explicit and versioned through saves.
- Use consistent assumption presets for apples-to-apples comparisons.
- Record comparison notes for major run deltas.
- Export artifacts for any run used in a decision memo.

---

## 12) Current Implementation Notes

This manual reflects the current tab behavior in the live codebase as of the date above.

Known implementation characteristics:

- The new seven-panel workspace is active.
- Legacy tab-era UI code still exists in file history/code paths but is not the active render surface.
- Some backend snapshot defaults still use a fallback snapshot id when needed.

These do not block day-to-day use but are useful to know during support/debug sessions.

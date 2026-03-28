# Backtesting Production Implementation Checklist

Date: 2026-03-25
Owner: Strategy Research / Backtesting

## Status Legend

- [x] Implemented
- [~] In progress
- [ ] Not started

## Non-Negotiables

- [~] Correct data
- [ ] Realistic fills
- [~] Reproducible runs
- [ ] Strong risk controls
- [x] Robust validation
- [~] Auditable artifacts
- [x] Realistic fills
- [x] Strong risk controls

## 1) Canonical Market Data Layer

- [x] Versioned datasets with immutable IDs
- [x] Symbol mapping with historical alias changes
- [x] Corporate actions pipeline (splits/dividends)
- [x] Delistings and survivorship-bias controls
- [x] Exchange calendars and holidays per venue
- [x] Time-zone normalized bars and event timestamps
- [x] Point-in-time data access guarantees
- [x] Snapshot manifest + checksum lineage

## 2) Deterministic Research Model

- [x] Immutable strategy versions (backend)
- [x] Frozen assumptions per run
- [x] Engine version tagging per run
- [x] Dataset version tagging per run
- [x] Full lineage diff API (code/config/data/engine)

## 3) Simulation Engine Completeness

- [x] Cash and positions
- [x] Full order state machine
- [x] Order types: market/limit/stop/stop-limit
- [x] Partial fills and fill queueing
- [x] Gap handling, rejects, cancels
- [x] Slippage and commissions
- [x] Position flips with explicit accounting
- [x] Multi-asset portfolio accounting
- [x] Leverage and borrowing rules

## 4) Execution Realism

- [x] Signal tradability timing policy
- [x] Fill policy abstraction (close/open/VWAP/custom)
- [x] Spread and market-impact modeling
- [x] Liquidity caps and participation limits
- [x] Short borrow constraints
- [x] Venue/session constraints
- [x] Stale bars / missing print behavior

## 5) Portfolio and Risk Layer

- [x] Max position size policy
- [x] Max sector/industry exposure
- [x] Gross/net exposure limits
- [x] Turnover limits
- [x] Drawdown throttles
- [x] Factor neutrality/tilt constraints
- [x] Benchmark-relative constraints
- [x] Cash buffers
- [x] Portfolio-level stop conditions

## 6) Multi-Timeframe and Frequency

- [x] Daily/hourly/minute/event-driven unified abstraction
- [x] Multi-timeframe strategy context support
- [x] Frequency-aware validation and calendar checks

## 7) Validation and Robustness Tooling

- [x] Pre-run validation and diagnostics
- [x] Walk-forward testing
- [x] Train/test and rolling OOS windows
- [x] Parameter sensitivity sweeps
- [x] Regime slicing
- [x] Benchmark comparison harness
- [x] Monte Carlo/bootstrap analysis
- [x] Stress tests for cost/slippage/missing data

## 8) Metrics and Analytics Layer

- [x] Return/sharpe/max drawdown/basic trade stats
- [x] CAGR/annualized vol/Sortino/Calmar
- [x] Turnover and avg holding period
- [x] Exposure utilization
- [x] Profit factor and expectancy
- [x] Long/short decomposition
- [x] Sector/factor attribution
- [x] Tail risk metrics
- [x] Alpha/beta vs benchmark
- [x] Parameter comparison tables
- [x] Run-to-run diff metrics

## 9) Run Comparison and Experiment Management

- [x] Run history listing
- [x] Side-by-side run comparison UX
- [x] Assumption/code/data lineage diff viewer
- [x] Equity curve delta overlays
- [x] Experiment tags and notes

## 10) Strong Pre-Run Validation

- [x] Backend pre-run validation gate
- [x] Desktop-local pre-run validation gate
- [x] Lookahead-prone construct analyzer
- [x] Unsupported function detection matrix
- [x] Timeframe/calendar mismatch diagnostics

## 11) Proper Persistence

- [x] Migrate local strategy workspace from localStorage to SQLite
- [x] Persist local strategies/versions/runs/artifacts/logs
- [x] Comparison tables and notes persistence

## 12) Artifact Export and Auditability

- [x] Run artifacts persisted in backend tables
- [x] Export run package from desktop details view
- [x] Signed manifest (code/config/data refs/results/diagnostics)
- [x] Re-import/replay workflow for audit

## 13) Backend/Local Parity Testing

- [x] Golden scenarios with expected fills
- [x] Automated parity test suite
- [x] Drift thresholds and failure diagnostics

## 14) Script Sandboxing and Safety

- [x] VM sandbox and timeout
- [x] Memory quotas and deterministic RNG controls
- [x] Static pre-run script checks (deeper AST-based)
- [x] Explicit fs/network denial policy assertions

## 15) Job Orchestration and Queueing

- [x] Backend queue-backed execution mode
- [x] Priority queues and resource controls
- [x] Progress reporting stream for run lifecycle
- [x] Retry policy configurability and observability

## 16) Live Handoff Capability

- [x] Research-to-paper profile handoff workflow
- [ ] Monitoring and alert lifecycle for handoff object
- [ ] Rebalance generation and broker simulation adapters
- [ ] Audit snapshots at handoff boundary

## This Iteration (Implemented)

- [x] Backend pre-run validation gate before enqueue
- [x] Dataset snapshot existence checks in backend repo/service
- [x] Desktop-local backtest hardening (validation + metadata + export + compare)
- [x] Desktop local workspace migrated from localStorage to SQLite (strategies/versions/runs)
- [x] Local comparison notes persisted in SQLite and editable from Run Comparison UI
- [x] Local run logs persisted with run artifacts for audit trails
- [x] Backend lookahead-prone script analyzer with warning and blocking patterns
- [x] Backend unsupported-function matrix (network/timer APIs) in pre-run diagnostics
- [x] Backend timeframe/calendar mismatch diagnostics in run preflight checks
- [x] Backend/local parity harness with deterministic golden scenarios and drift diagnostics tests
- [x] Signed artifact manifest plus import/replay workflow for local audit rehydration
- [x] Script sandbox hardening with memory quota guard and deterministic seeded RNG
- [x] AST-based blocked API checks with explicit fs/network denial assertions and tests
- [x] Backend SSE run lifecycle progress stream endpoint for strategy backtests
- [x] Queue priority lanes + run-level resource controls with retry telemetry in run status/stream
- [x] Forward-profile handoff guardrails (completed run + strategy stage validation) for research-to-paper workflow
- [x] Canonical market data layer: versioned datasets with immutable IDs (migration 019 + marketDataLayer.ts)
- [x] Symbol mapping with historical alias changes and point-in-time resolution
- [x] Corporate actions pipeline (splits/reverse-splits/dividends) with backward price adjustment
- [x] Delistings registry and survivorship-bias-free universe filtering
- [x] Exchange calendars with holidays per venue (NYSE/NASDAQ 2023–2026 pre-seeded)
- [x] Time-zone normalized bars with UTC ISO-8601 output and session-close reference
- [x] Point-in-time data access guarantees (PIT cutoff filter + survivorship bias filter)
- [x] Snapshot manifest + SHA-256 checksum lineage with verification API
- [x] Full lineage diff API across code/config/data/engine/universe dimensions (lineageDiffService.ts)
- [x] GET /api/strategy/backtest/runs/:runId/lineage/diff endpoint
- [x] Full order state machine (pending → open → partial → filled / rejected / cancelled)
- [x] Order types: market, limit, stop-market, stop-limit with bar-level matching
- [x] Partial fills with fill-queueing across bars (liquidity cap enforcement)
- [x] Gap handling: fill at open when gap passes through limit/stop price
- [x] Order rejects (leverage limit) and end-of-simulation cancel with reason
- [x] Position flips with explicit realized P&L accounting (long ↔ short crossing zero)
- [x] Multi-asset portfolio accounting (per-symbol PositionRecord with avg cost basis)
- [x] Leverage and borrowing rules (gross leverage cap + daily short borrow rate accrual)
- [x] Accurate trade metrics: win/loss counts, avg win/loss, profit factor, win rate, fees, slippage, borrow charges
- [x] Advanced execution realism engine introduced with configurable signal timing, fill policy, spread, impact, liquidity and borrow constraints
- [x] Portfolio/risk constraint layer added for sector, industry, gross/net, turnover, factor and benchmark-relative exposure control
- [x] Multi-timeframe utilities and sandbox helpers added for daily/hourly/minute/event-driven research flows
- [x] Pre-run validation widened to enforce advanced execution, calendar, benchmark and factor assumptions before enqueue
- [x] Robustness suite implemented: walk-forward windows, rolling OOS slices, parameter sweeps, regime slicing, bootstrap and stress scenarios
- [x] Advanced analytics implemented: CAGR, annualized volatility, Sortino, Calmar, turnover, holding period, exposure utilization, expectancy, tail risk, attribution and alpha/beta
- [x] Backend artifact persistence now stores payload JSON for equity curves, trades, and compiled reports
- [x] Run comparison endpoint added with backend metric deltas and optional lineage payload
- [x] Equity curve overlay chart added for selected-vs-baseline run comparison in Strategy Research
- [x] Experiment metadata persistence added with tags, notes and parameter payloads per run
- [x] Strategy Research UI upgraded to display advanced metrics, backend artifacts, experiment metadata, robustness reports and backend comparison details

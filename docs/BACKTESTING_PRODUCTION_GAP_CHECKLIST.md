Finished Production-Grade Backtesting / Strategy Research Plan
Adjusted for Maximum User Configurability

Use this as the authoritative implementation plan for the backtesting tab, backend engine, desktop integration, and future paper/live bridge.

Implementation Progress Log

Date: 2026-03-26

[x] Slice 1 implemented (backend foundation):

- Extended execution mode contract to include local/backend/paper/live while preserving existing local/backend behavior.
- Added explicit paper/live safety gating in pre-run validation so paper/live architecture exists but remains inactive until connectors/governance are configured.
- Added persisted run metadata (`run_metadata`) for reproducibility/provenance foundations (mode classification, assumptions hash, strategy hash, dataset hash, engine version wiring).
- Added worker-side metadata updates so run lifecycle records execution engine/provider provenance over time.
- Added migration: `021_backtesting_run_mode_and_metadata.sql`.
- This is a partial implementation kickoff, not full completion of sections 7/14/17.

[x] Slice 2 implemented (connectors + governance baseline):

- Added migration: `022_backtesting_connectors_and_governance.sql` with tenant-scoped provider connector registry, governance profiles, and acceptance packs.
- Added backend repository persistence APIs for connector upsert/list/get and governance/acceptance upsert/list/default resolution.
- Added service-layer validation gates so paper/live now require configured connectors (instead of fixed hard-block stubs).
- Added promotion governance enforcement requiring default governance profile + acceptance pack and checklist/autogate compliance.
- Added strategy API contracts and endpoints for managing/listing connectors, governance profiles, and acceptance packs.

[x] Slice 3 implemented (governance operations hardening):

- Added migration: `023_backtesting_governance_audit_columns.sql` to persist promotion governance profile/acceptance pack IDs and governance validation payload in promotion events.
- Extended promotion requests to optionally target specific governance profile and acceptance pack IDs, while still supporting default profile behavior.
- Added stricter promotion gate enforcement: transition disallow rules, manual approval requirement support, and required report-section checklist enforcement.
- Added governance readiness endpoint for paper/live bridge checks (`/api/strategy/governance/readiness`) with connector/default-profile readiness diagnostics.
- Extended upsert contracts/flows to support idempotent updates by explicit connector/profile/pack IDs.

[x] Slice 4 implemented (promotion threshold enforcement):

- Promotion contract now supports run-context inputs (`sourceRunId`, `baselineRunId`) so governance gates can evaluate measurable outcomes.
- Added OOS minimum threshold enforcement using governance profile `oosMinimums` against completed source run metrics.
- Added replay tolerance enforcement using merged governance/acceptance replay tolerances against baseline run deltas.
- Added detailed promotion error mapping for run-not-found/strategy-mismatch/not-completed and threshold violations.
- Persisted governance evaluation context in promotion event `governance_validation` payload for audit traceability.

[x] Slice 5 implemented (forward activation governance gates):

- Added migration: `024_backtesting_forward_profile_governance.sql` to persist forward profile execution mode, governance profile/acceptance pack IDs, activation checklist, and governance validation payload.
- Extended forward profile API contract to include activation governance context (`executionMode`, optional governance IDs, checklist, auto-gate/manual approval, optional baseline run).
- Added service-layer activation enforcement so paper/live forward profile creation now requires transition-rule compliance, acceptance checklist completion, report-section requirements, and definition-of-done checks.
- Added OOS minimum and replay tolerance enforcement at forward activation time (including required baseline run when replay tolerances are configured).
- Extended forward-profile route error mapping for governance conflicts and profile/pack readiness failures.

[x] Slice 6 implemented (forward lifecycle operations):

- Added forward profile lifecycle contracts for list and status transitions (`active`/`paused`/`stopped`).
- Added repository methods to list forward profiles, fetch a specific profile by user/tenant scope, and persist lifecycle status updates.
- Added service-level lifecycle transition guardrails (terminal-state handling for stopped profiles and metadata transition audit patching).
- Added API endpoints for forward profile lifecycle management:
  - `GET /api/strategy/forward-profiles`
  - `PATCH /api/strategy/forward-profiles/:profileId/status`
- Added detailed route-level lifecycle error mapping for not-found and invalid transition cases.

[x] Slice 7 implemented (forward drift monitoring):

- Added migration: `025_backtesting_forward_profile_drift_index.sql` to optimize strategy-run lookup for forward drift analysis.
- Added forward-profile drift response contract with metric deltas, per-metric tolerance checks, and violation reporting.
- Added service-level drift diagnostics comparing source-run metrics against candidate run metrics with governance/acceptance replay tolerances.
- Added API endpoint: `GET /api/strategy/forward-profiles/:profileId/drift` with optional `runId` selector and strict error mapping.
- Forward drift checks now provide a concrete paper/live bridge monitor surface aligned with checklist drift-monitor requirements.

[x] Slice 8 implemented (forward alert diagnostics):

- Added forward-profile alerts response contract with normalized severity/code/message/context shape.
- Added service-level forward alert generation combining lifecycle state alerts and drift-monitor signals.
- Added API endpoint: `GET /api/strategy/forward-profiles/:profileId/alerts` with optional candidate run selector.
- Added robust fallback behavior so drift-unavailable conditions are surfaced as warning alerts instead of hard API failure.

Progress Estimate (after Slice 8): ~90% complete, ~10% remaining.

Core instruction to the AI

Do not rebuild parts that already exist unless necessary.
For every subsystem, first:

inspect what is already implemented,
verify whether it already satisfies this plan,
if it does, keep it and leave it as is,
if it partially satisfies the plan, extend or modify it,
only create new components where required gaps remain.

Do not replace working infrastructure just because a cleaner rewrite is possible. Prefer re-check, adapt, and preserve.

1. Goal

Turn the current strategy research / backtesting tab into a production-grade, reproducible, auditable, highly user-configurable research and deployment pipeline that supports:

quick local approximation runs,
backend-grade point-in-time research runs,
paper trading through user-supplied broker/data connectors,
future live deployment using the same versioned strategy and assumptions framework.

The design must maximize user configurability for normal research controls while keeping system integrity controls protected and non-destructive. This matches the approved direction in the checklist: editable strategy, portfolio, risk, and execution settings; locked integrity components; grouped schema; provenance; presets; explainability; and phased rollout.

2. Guiding principle

The platform is not a single “backtest screen.”
It is a versioned strategy execution laboratory with four modes:

A. Local Quick Mode

Fast desktop-local approximation mode for convenience and exploration.

B. Backend Research-Grade Mode

Authoritative historical engine using real point-in-time snapshots, reproducible run bundles, diagnostics, and full auditability.

C. Paper Bridge Mode

Forward simulation / paper trading mode using user-supplied or later-entered paper broker/data APIs.

D. Live Deployment Mode

Future live mode using the same validated strategy versions, limits, run metadata, monitoring, and drift tracking.

The UI must clearly distinguish these modes so users never confuse a quick approximation with a research-grade result. Your checklist explicitly requires removal of ambiguity between local and backend-grade modes.

3. Current-state handling

Treat the current codebase as a scaffold, not as a greenfield rewrite.

The file already indicates:

the backend worker is still using mock provider wiring,
the historical provider path currently returns incomplete real bars behavior,
an advanced engine already exists,
the desktop fallback engine exists but is simplified,
the UI already exposes some assumptions but not enough depth.

Therefore the implementation approach is:

keep existing advanced engine where usable,
upgrade real data plumbing first,
preserve existing desktop quick mode as a separate approximation mode,
expand schema/UI/reporting around the current backbone,
connect paper/live later through adapter interfaces rather than rewrites. 4. Product architecture
4.1 Main modules
Strategy Definition Layer

Stores strategy logic, portfolio rules, risk controls, execution assumptions, benchmark selection, output preferences, and provenance.

Data Contract Layer

Resolves instruments, universes, point-in-time snapshots, corporate actions, delistings, and calendar logic.

Execution Simulation Layer

Handles fills, cost assumptions, slippage, spread, participation caps, borrow availability, no-fill logic, and benchmark-relative enforcement.

Run Orchestration Layer

Creates run manifests, run IDs, config snapshots, engine version references, data snapshot references, diagnostics, artifacts, and replay packages.

Reporting Layer

Builds metrics, tear sheets, side-by-side comparisons, regime reports, explainability traces, and export bundles.

Forward Bridge Layer

Creates future rebalance jobs, paper broker simulation adapters, monitoring hooks, alerts, and handoff audit snapshots.

Governance Layer

Applies promotion gates, OOS thresholds, kill-switch rules, status transitions, and definition-of-done checks.

5. Maximum user configurability model

The system must expose user-editable settings exactly through structured groups, which your file already approved.

5.1 Settings groups
Strategy Logic
formation/lookback window
skip period
holding period
ranking signal
top_n / bottom_n
long-only / long-short
rebalance frequency
signal smoothing
signal confirmation
ranking tie-break rules
rebalance offset
formation window alignment rule
Portfolio Construction
equal weight
volatility weight
inverse volatility
rank weight
custom weight rule
volatility exponent
volatility window
max position size
max holdings
min holdings
sector cap
country cap
industry cap
cash buffer
leverage cap
gross exposure cap
net exposure cap
rebalance turnover preference
weight rounding policy
Risk Controls
drawdown kill switch
stop trading threshold
turnover cap
liquidity threshold
ADV participation cap
concentration limit
exposure constraints
volatility target
beta target
single-name risk limit
factor exposure bound
sector drift cap
correlation cap if supported
Execution Assumptions
transaction cost bps
fixed per-order costs if supported
slippage model
spread assumptions
market impact model
rebalance timing
execution timing convention
fill assumptions
participation assumptions
no-fill behavior
partial-fill behavior
open/close/next-bar execution rule
halt/suspension behavior
short-borrow assumptions if shorting enabled
Data / Universe
universe definition
static vs historical membership where supported
required minimum history
missing data policy
benchmark selection
benchmark-relative metrics toggle
corporate-action display mode
currency handling
exchange calendar selection
timezone display preference
delisting treatment visibility
survivorship sensitivity option for diagnostics
Reporting / Output
output detail level
save run bundle
save debug traces
save selection rationale
save pre/post-constraint weights
save order/fill log
save comparison against previous version
save HTML/PDF/JSON outputs
report sections toggles
benchmark comparison sections
regime comparison sections
5.2 Three-level UX

Use the already approved three-level settings UX: Basic, Advanced, Locked/System.

Basic

Common research controls most users touch often.

Advanced

Deeper research realism, execution, and robustness parameters.

Locked / System

Protected integrity controls not editable as normal strategy settings.

5.3 Locked / system integrity controls

These must not be freely editable as normal user settings, in line with the file.

Keep protected:

point-in-time enforcement rules
lookahead protection logic
symbol identity mapping internals
corporate action engine internals
audit logging rules
run versioning/storage rules
benchmark integrity rules
calendar/timezone integrity rules
deterministic replay framework internals
dataset snapshot hashing rules
run bundle integrity requirements

They may be viewable, inspectable, and sometimes admin-configurable, but not casual strategy toggles.

6. Setting schema contract

Every setting must store:

name
stable key
description
type
allowed range or enum values
default value
validation rule
provenance tag
visibility level: basic / advanced / locked
mutability: editable / restricted / system
category
unit
current value
previous value
effective value
source of effective value
changed_by
changed_at
version applicability
notes

This extends the approved setting architecture rather than replacing it.

7. Provenance and reproducibility

Every run must persist the approved reproducibility metadata plus expanded implementation detail. Your checklist already requires run ID, strategy version, config snapshot, setting values, provenance, timestamp, data snapshot reference, and engine version.

For every run, save:

run ID
strategy ID
strategy version
parent strategy version if forked
full config snapshot
effective setting values
provenance of all key settings
engine version
strategy code hash
assumptions hash
dataset snapshot hash
benchmark reference
timestamp
user identity if available
mode: local / backend / paper / live
diagnostics and warnings
artifacts paths
metrics bundle
exact data snapshot reference
selection and exclusion reasons
order generation trace
fill reasoning trace
pre/post-constraint portfolio weights
comparison against previous run if requested

Required provenance states:

explicit from source
inferred assumption
system default
user override
optimizer-selected 8. Data contract architecture

The file says the owner inputs were still needed, but you asked for a finished plan without blocking questions. So this plan resolves that by making provider/business decisions configurable inputs instead of hardcoded assumptions.

8.1 Provider abstraction

Implement a provider registry with empty-slottable connectors.

Data providers

User can later enter:

primary vendor by asset class
fallback vendor by asset class
authentication details
endpoint configuration
symbol mapping mode
rate-limit profile
freshness expectation
data quality priority
Paper trading providers

User can later enter:

paper broker name
API credentials
account identifier
venue routing preferences
paper account profile
order capability flags
supported asset classes
supported order types

These must be configurable after deployment from settings/admin, not hardcoded in source.

8.2 Default system behavior when user has not entered provider details

If paper-trade broker/data API is not yet supplied:

the architecture remains fully complete,
paper mode exists but is inactive,
the UI shows connector slots as “Not Configured,”
the rest of the research pipeline still works,
no code rewrite is required later to activate provider connections.
8.3 Data contract placeholders

Support configurable entries for:

primary vendor by asset class
fallback vendor by asset class
v1 production asset-class scope
corporate-action policy
point-in-time policy boundaries
symbol identity master source
conflict-resolution policy

The system must treat these as organization-level deployment settings, not as ad hoc backtest fields.

9. Research-grade historical data requirements

As required by your checklist, the backend-grade engine must stop using mock execution data and consume real point-in-time snapshot data end-to-end.

Implement or verify:

canonical PIT bars store
corporate actions table
delistings table
identity master table
calendar table
universe snapshot table
benchmark series table
optional fundamentals/macro/news timestamped tables

Each snapshot load must return:

non-empty bars where expected
identity metadata
snapshot checksum
row counts
cutoff timestamp
calendar metadata
corporate action applicability
benchmark availability status 10. Validation engine

Before every run, validate:

holding period > 0
top_n <= universe size
bottom_n <= universe size
max position size in valid bounds
leverage cap coherent with mode
volatility window fits available history
ADV cap in valid bounds
cost assumptions non-negative
benchmark exists if benchmark-relative logic is enabled
required history exists
universe is not empty
selected execution timing is compatible with signal timing
same-bar close execution after close-formed signal warns or blocks
short settings cannot activate without short support and borrow model
paper bridge cannot activate until broker connector is configured
live bridge cannot activate until promotion gate requirements are satisfied

Warnings must exist for:

zero cost assumptions
zero slippage
unrealistic liquidity assumptions
extreme leverage
insufficient history
current constituents applied to older periods
missing benchmark with benchmark-relative output disabled
unsupported asset-class/provider combinations 11. Explainability

For every run, the system must explain:

what settings were used
what changed from prior version
why assets were selected
why assets were excluded
what constraints altered raw weights
what execution assumptions changed results
what costs and slippage reduced returns
whether benchmark-relative checks were active
whether the run is approximate or research-grade

This is already aligned with the approved explainability requirement in your file.

12. Presets

Support the approved minimum set:

Research Default
Conservative Real-World
Paper-Faithful Replication
Custom User Strategy

Extend with:

Quick Approximation
Backend PIT Research
Paper Bridge Ready
Capacity-Constrained Variant
Benchmark-Relative Variant

Users must be able to:

load preset
inspect preset
modify preset
save as new version
compare preset vs current
fork strategy from preset 13. Reporting

Implement full tear sheet generation and comparison outputs, matching the checklist direction.

Required report package:

summary metrics
equity curve
drawdown curve
monthly heatmap
rolling Sharpe
rolling beta
exposure summary
turnover
cost drag
benchmark comparison
regime comparison
selection rationale
exclusion rationale
fill reasoning summary
diagnostics/warnings
provenance summary
config diff vs prior version
run integrity metadata

Export:

JSON package
HTML report
PDF report if already supported or practical
CSV artifact files
immutable run bundle 14. Paper bridge design

Paper trading broker/data API must be user-provided later or entered through configuration, exactly as you requested.

Implementation rule:

do not hardcode a paper broker,
do not block the architecture because broker choice is pending,
build adapter interfaces now,
allow later user entry of credentials/provider configuration,
keep paper bridge inactive until configured.

Paper bridge must support:

connector registry
broker capability detection
order translation layer
paper fills ingestion
position sync
rebalance job generation
alert rules
handoff snapshots
drift monitoring vs research expectations

If a generic simulator already exists, verify it first and reuse it if sufficient. Otherwise extend it.

15. Governance and promotion

The checklist says governance thresholds were still needed. In this finished plan, implement them as configurable deployment thresholds rather than hardcoded constants.

Create configurable governance profiles with:

candidate -> validation thresholds
validation -> paper thresholds
paper -> live thresholds
OOS minimums
drawdown halt rules
recovery rules
replay tolerance requirements
mandatory report sections
benchmark pass requirements

No specific numeric thresholds need to be hardcoded at this stage.
The system must support them and require them before activation.

16. Acceptance framework

Support configurable acceptance packs containing:

golden benchmark strategy list
expected outputs
replay tolerance by metric
required report sections
promotion checklist
definition of done for paper
definition of done for live

Backtests should not be promoted until the selected acceptance pack passes.

17. Rollout order

This should follow the sequence already suggested by your file.

Phase 1
true PIT data plumbing
remove mock dependency from backend-grade path
anti-leakage diagnostics
immutable run bundle
deterministic replay
clear mode separation
Phase 2
full schema expansion
advanced UI assumption editor
provenance everywhere
explainability panel
robustness experiments
reporting/tear sheets/comparison tools
Phase 3
paper broker/data adapter framework
connector settings screens
forward rebalance lifecycle
alerts
handoff snapshots
paper drift monitor
Phase 4
multi-asset extension
institutional execution realism upgrades
queue/fill probability
advanced capacity analysis
live drift monitoring 18. Final implementation directive to the AI

Use this exact operating rule:

Build the backtesting / strategy research tab into a production-grade, maximum-configurability research and deployment system. Reuse existing implementation wherever possible. Do not redo working components unnecessarily. First inspect what already exists, verify whether it satisfies the required behavior, then modify or extend only where gaps remain. Preserve current working infrastructure if it already meets the standard.

The system must separate Local Quick Mode from Backend Research-Grade Mode. Backend-grade mode must run on real point-in-time snapshots end-to-end, with reproducibility, diagnostics, auditability, and immutable run bundles. The advanced engine and existing tab/backend scaffolding should be reused if adequate, not replaced by default. The current checklist indicates the main remaining issue is real data wiring and full bridge completion, not lack of overall architecture.

Expose maximum user configurability for:

strategy logic,
portfolio construction,
risk controls,
execution assumptions,
data/universe selection,
reporting/output.

Keep system integrity controls protected, including PIT enforcement, lookahead protection, symbol identity internals, corporate action engine internals, audit logging, versioning rules, benchmark integrity, and calendar/timezone integrity.

Implement a strict settings schema where every setting has metadata, validation, provenance, defaults, visibility level, and mutability class. Support Basic, Advanced, and Locked/System UX tiers.

Implement preset support, version comparison, explainability, reproducibility, acceptance packs, deterministic replay, and immutable run bundles.

For paper trading and future live trading, do not hardcode broker or data API decisions. Build connector interfaces and configuration slots so the user can supply or later enter the paper broker and data provider. Paper bridge functionality should exist architecturally now, but remain inactive until connectors are configured.

If a subsystem is already implemented, re-check it and either leave it as is or modify it. Do not rebuild it just because another structure might be cleaner.

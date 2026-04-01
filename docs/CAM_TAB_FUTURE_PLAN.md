# CAM Tab Future Plan (Research-Grounded)

Date: March 30, 2026
Scope: Directional plan for where CAM should go next, based on current product state plus web research (with emphasis on SSRN-related literature and adjacent public sources).

Update (March 31, 2026): Extended with user-collected SSRN evidence pack (10 empirical papers + legal/commentary set).

---

## 1) What CAM Is Today (in this repo)

Current CAM implementation is a live Capital Momentum surface with:

- Ranked CAM signals (top 12)
- Composite scoring with sub-scores (trend, flow, volatility, breakout)
- Pass/blocked gate diagnostics
- Freshness telemetry including Congress-related staleness fields

Primary files:

- apps/desktop/src/renderer/pages/Cam.tsx
- apps/desktop/src/renderer/store/strategyStore.ts
- packages/shared/src/strategy.ts

Key takeaway: CAM already has a strong scoring core, but it is mostly a signal board. The next leap is to become a decision system with event context, explainability, and policy-aware risk framing.

---

## 2) External Research Snapshot (SSRN-first intent)

### SSRN access status

Direct SSRN scraping was blocked by anti-bot verification at request time for this environment. This plan now incorporates a manually collected SSRN evidence set provided by the user:

- 10 empirical papers (including post-STOCK, committee/leadership, timing/disclosure, and political-favor channels)
- 7 legal/commentary papers (kept separate from empirical modeling inputs)

### Research themes repeatedly supported by the literature

1. Broad averages can hide concentrated edge

- Some post-STOCK studies show little average outperformance by Congress as a whole.
- Newer work suggests edge can concentrate in smaller, high-influence subsets (especially leadership roles).

2. Timing and context matter more than raw PnL

- Value is often linked to event windows, committee influence, procurement/regulatory exposure, and policy cycles.

3. Disclosure lag is a first-class modeling variable

- STOCK Act timing rules create delayed visibility. Systems should model lag explicitly, not treat disclosures as real-time intent.

4. Governance constraints shape product design

- Senate disclosure terms restrict unlawful/commercial misuse and must be reflected in product controls.

Reference URLs used for this planning pass:

- https://www.govinfo.gov/link/plaw/112/public/105?link-type=html
- https://efdsearch.senate.gov/search/
- https://disclosures-clerk.house.gov/FinancialDisclosure
- https://www.sciencedirect.com/science/article/pii/S0047272722000044
- https://cepr.org/voxeu/columns/political-power-and-profitable-trades-us-congress
- https://en.wikipedia.org/wiki/STOCK_Act

Primary empirical SSRN inputs are summarized in Section 9.

---

## 3) CAM Product Direction (where it is going)

### North Star

Move CAM from a score feed to a policy-intelligence execution panel:

- "What changed"
- "Why it matters now"
- "How reliable it is"
- "What to do next"

### Product Pillars

1. Event-Linked Signal Intelligence

- Tie each CAM signal to concrete policy events, committee activity, and disclosure records.
- Add event windows (pre-event, event, post-event) to every symbol view.

2. Disclosure-Lag Aware Confidence

- Split confidence into:
  - Model confidence
  - Data staleness penalty
  - Disclosure-lag adjustment
- Show confidence decomposition in UI.

3. Influence-Aware Scoring

- Add role-weighted and committee-weighted factors (leadership, committee jurisdiction, sector relevance).
- Separate "broad congressional flow" from "high-influence cohort flow".

4. Explainability and Auditability

- For each signal, display top contributors with signed direction and weight.
- Persist a "why this signal" card and versioned scoring manifest.

5. Actionability Layer

- Add watchlist actions, scenario notes, and alert policies by signal state transitions.
- Add "state changed" alerts (PASS->BLOCKED, confidence drop, stale data threshold breach).

6. Structural Uncertainty Layer

- Add uncertainty-regime modifiers (market stress, firm uncertainty, policy-calendar congestion).
- Explicitly down-weight buy-side edge under high-herding regimes.

---

## 4) Feature Roadmap by Phase

### Phase 0 - Research hardening (1-2 weeks)

Goal: Lock an evidence-backed design baseline before broad UI changes.

Deliverables:

- CAM literature digest (using Section 9 evidence set)
- Definitions for influence tiers and event categories
- Data usage policy note (Senate/House restrictions)
- Empirical vs legal/commentary split in all research notes
- Evidence confidence tags per feature (high/medium/exploratory)

Exit criteria:

- Approved feature taxonomy
- Approved compliance guardrails for data use and exports

### Phase 1 - Data and model foundation (2-4 weeks)

Goal: Upgrade CAM data contracts and scoring inputs.

Deliverables:

- Extend shared CAM schema with:
  - influenceTierBreakdown
  - eventWindowFeatures
  - lagAdjustedConfidence
  - explainability payload
  - herdingState
  - networkProximityScore
  - committeePowerScore
  - politicalConnectionFlags
- Add ingestion metadata for source timestamp vs disclosure timestamp
- Add role/committee enrichment for actors
- Add separate fields for transactionDate and disclosureDate everywhere in pipeline
- Add trade archetype tags: repeatedSameStock, speculativePattern, conflictedTradeFlag

Exit criteria:

- Signals produced with new fields in dev
- Unit and contract tests for lag and influence calculations
- Tests for buy/sell asymmetry and herding-regime penalty behavior

### Phase 2 - UI upgrade (2-3 weeks)

Goal: Make CAM explainable and decision-oriented.

Deliverables:

- New CAM card sections:
  - Why now
  - Event context
  - Confidence decomposition
  - Signal change history
  - Structural uncertainty and herding state
- Filters:
  - Influence tier
  - Event type
  - Freshness threshold
  - Buy vs sell channel
  - Committee power / leadership exposure
  - Connection type (home-state, contributor-linked, procurement-linked)
- State transition badges and alert controls

Exit criteria:

- Users can explain every top signal from UI alone
- Alert preview works for all transition types
- Users can distinguish transaction-time signal from disclosure-time tradability signal

### Phase 3 - Workflow integration (2 weeks)

Goal: Connect CAM to the rest of the terminal workflow.

Deliverables:

- Send-to-watchlist and send-to-notes actions
- Panorama cross-link for CAM pulse detail drill-in
- Strategy Research export payload for CAM context snapshots
- Add "copycat risk" flag for disclosures that historically trigger noisy follower flow
- Add policy-calendar hooks (hearings, committee exits, major votes) into CAM context payload

Exit criteria:

- CAM context can be carried into research and execution workflows

### Phase 4 - Validation and production hardening (1-2 weeks)

Goal: Reduce false confidence and improve trust.

Deliverables:

- Backfill analysis by market regime and event class
- Drift monitor for CAM factor behavior
- Incident playbook for stale/partial source outages
- Precision-recall diagnostics by archetype:
  - leadership-connected
  - committee-connected
  - repeated-trade archetypes
  - procurement/regulatory-event linked
- False-positive control for disclosure-chasing behavior

Exit criteria:

- Defined quality gates for release
- Post-release telemetry dashboard for CAM health
- Stable performance when evaluated on disclosure-date tradability, not only transaction-date alignment

### Phase 5 - Advanced alpha and controls (2-4 weeks)

Goal: Add high-upside features with tighter guardrails after core trust layer is stable.

Deliverables:

- Network-aware feature stack (committee ties, fundraising ties, co-membership structure)
- Optional graph model track for congressperson-ticker-time interactions
- Episodic informed-trade detector (rare-event model)
- Compliance-friendly export templates (research-only, no prohibited use support)

Exit criteria:

- Advanced model outperforms baseline on out-of-sample disclosure-date metrics
- Compliance guardrails validated in UI flows and export surfaces

---

## 5) Initial Backlog (highest value first)

1. Split all timing fields into transactionDate vs disclosureDate and enforce in scoring.
2. Add lag-adjusted confidence plus disclosure-tradability score.
3. Add influence features (leadership/committee power) and buy/sell asymmetry logic.
4. Add repeated same-stock and speculative-pattern detection features.
5. Add procurement/regulatory event-link context in explainability payload.
6. Add CAM card "Why now" + confidence decomposition + uncertainty state.
7. Add state-transition alerts with copycat-risk suppression rules.
8. Add signal audit trail and score-contribution manifest per version.

---

## 6) Evidence-to-Feature Matrix

1. Mind the Trade (2024)

- Evidence: post-disclosure return concentration; repeated same-stock trades informative.
- CAM features: disclosureDate alpha channel, repeatedTradePattern, copycatRiskScore.

2. Congressional Herding (2024/2026)

- Evidence: own-trade herding dominates; uncertainty increases follower behavior; buy alpha shrinks with herding.
- CAM features: herdingState, uncertaintyRegimePenalty, buy-side confidence dampener.

3. Change in Capitol (2017/2018)

- Evidence: pre-STOCK sell-side edge, stronger for senior/powerful committee members.
- CAM features: sellSignalWeighting, committeePowerScore, seniority/leadership modifiers.

4. Trading Political Favors (2016/2023)

- Evidence: pre-STOCK abnormal returns and political-favor channels; post-STOCK contraction; connected-firm effects.
- CAM features: politicalConnectionFlags, procurementLinkScore, regime-split calibration.

5. Political Insider Trading: Narrow vs Comprehensive (2021)

- Evidence: significant return association and elevated idiosyncratic volatility around filed trades.
- CAM features: informationAsymmetryProxy (AIV-style), abnormal-volatility context panel.

6. Social Networks and Strategic Behavior (2023)

- Evidence: network-linked dissemination and event/news-linked behavior.
- CAM features: networkProximityScore, tie-type attribution (committee/fundraising/donation links).

7. Should the Public be Concerned (2025)

- Evidence: episodic rare informed trades; heterogeneity across actors/trade types.
- CAM features: episodicInformedTradeProbability, actor-level heterogeneity priors.

8. Decoding Congressional Stock Trades (2025)

- Evidence: committee and industry features are pivotal at trade-level granularity.
- CAM features: congressperson-ticker-time graph features, committee-industry interaction terms.

9. Political Capital (2014, pre-STOCK sample)

- Evidence: connected investments (local/contributor) outperform own non-connected investments.
- CAM features: localityLink, contributorLink, connected-vs-nonconnected decomposition.

10. Role of Stock Ownership in Political Favors (2010/2014)

- Evidence: ownership-contribution-contract channel and lag effects.
- CAM features: contractChannelIndicators, ownership-lag adjustments, divestment shock flags.

---

## 7) Risks and Mitigations

1. SSRN access instability

- Mitigation: maintain a manual SSRN bibliography file checked into docs; refresh quarterly.

2. Data timeliness mismatch across sources

- Mitigation: dual timestamps and explicit freshness budget in scoring.

3. Overfitting to headline events

- Mitigation: regime-sliced backtests and out-of-sample validation windows.

4. Mistaking disclosure effects for execution edge

- Mitigation: evaluate separately on transaction-date explanatory power vs disclosure-date tradability.

5. Compliance misuse risk for disclosure data

- Mitigation: add usage disclaimers, export controls, and audit logs for data exports.

6. Causal over-interpretation from non-causal studies

- Mitigation: tag each feature by evidence strength and keep exploratory factors behind feature flags.

---

## 8) Definition of Done for "CAM 2.0"

CAM is considered successfully featured when:

- Every signal has explainable contributors and event context.
- Confidence reflects both model quality and disclosure lag.
- Users can filter by influence, freshness, and event class.
- Alerting covers meaningful state transitions.
- Data use constraints are documented and enforced in product behavior.
- Disclosure-date tradability metrics are reported alongside transaction-date diagnostics.
- Buy/sell asymmetry and herding-state effects are visible and testable.

---

## 9) SSRN Evidence Pack (Provided March 31, 2026)

### Empirical core

1. Mind the Trade: Senators' Disclosure and Stock Returns (2024)
2. Congressional Herding (posted 2024, revised 2026)
3. Change in Capitol: How a 60 Minutes Expose and the STOCK Act Affected the Investment Activity of U.S. Senators (2017/2018)
4. "Trading" Political Favors: Evidence from the Impact of the STOCK Act (2016/2023)
5. Political Insider Trading: A Narrow versus Comprehensive Approach (2021)
6. Social Networks and Strategic Behavior: Case of Political Inside Information (2023)
7. Should the Public be Concerned about Congressional Stock Trading? (2025)
8. Decoding Congressional Stock Trades: An Industry and Committee-Focused Analysis with Graph Neural Network and Large Language Model (2025)
9. Political Capital: Corporate Connections and Stock Investments in the U.S. Congress, 2004-2008 (2014 revision)
10. The Role of Stock Ownership by US Members of Congress on the Market for Political Favors (2010/2014)

Notes:

- Several SSRN abstract pages do not expose full sample windows; treat those fields as provisional until full-text extraction.
- Pre-STOCK papers are used for mechanism discovery, not direct live calibration.

### Legal/commentary set (separate from model calibration)

1. Cashing in on Capitol Hill: Insider Trading and the Use of Political Intelligence for Profit (2010)
2. Insider Trading Inside the Beltway (2010)
3. Taking STOCK: Insider and Outsider Trading by Congress (2013/2014)
4. Selective Disclosure by Federal Officials and the Case for an FD-Like Regime (2012)
5. Plugging Leaks and Lowering Levees in the Federal Government (2014)
6. Congressional Securities Trading (2020)
7. Regulating Congressional Insider Trading: The Rotten Egg Approach (2023/2025 revision)

---

## 10) Suggested Follow-Up Docs

- docs/CAM_SSRN_BIBLIOGRAPHY.md (manual paper list + notes)
- docs/CAM_SIGNAL_SPEC_V2.md (field-level technical spec)
- docs/CAM_COMPLIANCE_GUARDRAILS.md (usage and export policy)

---

## 11) CAM Live-Data Implementation Plan (Execution Split)

Date: March 31, 2026
Purpose: Convert CAM from partially manual upstream freshness to automated, auditable live-data ingestion and scoring support.

### Confirmed Operating Constraints (locked for this plan)

1. Host and scheduler: OpenClaw Ubuntu server only (no desktop ingestion worker in scope).
2. Phase 1 source scope: Congressional trades + USAspending contracts.
3. Source policy: public/free sources only.
4. Compliance posture: hard enforcement in Phase 1 (not soft warnings).
5. Freshness target: under 4 hours after source publication.
6. Raw data landing: PostgreSQL JSONB first.
7. CAM scoring quality gate: high-confidence entity matches only.
8. Rollout policy: auto-enable after first successful ingest cycle.

---

## 12) What VS Code Agents Must Do

### A. Repository and architecture audit

1. Inspect current backend paths before adding new systems:

- Congress activity services
- Congress persistence/repo layer
- Existing enrichment and logging patterns
- Existing scheduler/cron pattern in backend

2. Produce a short architecture delta report:

- what is reused
- what is added
- what is intentionally deferred

### B. Backend ingestion pipeline implementation

1. Implement source fetchers for:

- Congressional trades source family already used/referenced by the product
- USAspending contracts APIs

2. Add normalization layer for canonical records:

- trade records
- actor records
- organization/company records
- contract records
- source metadata records

3. Add persistence and lineage structure (if equivalent does not already exist):

- ingest runs
- raw payloads
- normalized records
- source cursors
- ingest errors

4. Enforce idempotent upsert behavior using stable source keys/checksums.
5. Add cursor-based incremental fetch where possible, full refresh fallback where not.

### C. Compliance and controls (hard enforcement)

1. Add source-level compliance metadata propagation into normalized records.
2. Enforce restricted-use behavior in export/read flows where required.
3. Add audit logging for data export and sensitive disclosure-derived reads.
4. Ensure all disclosure-derived records carry provenance fields.

### D. CAM feature wiring

1. Materialize CAM-ready live-data features from normalized tables:

- transaction vs disclosure timing fields
- lag and freshness inputs
- procurement-linked context fields
- connection flags with confidence gate

2. Gate CAM scoring path to high-confidence links only.
3. Keep low/medium confidence records queryable but excluded from scoring.

### E. Scheduler and operations

1. Register recurring jobs on OpenClaw cron:

- every 4h ingest for trades/contracts
- daily integrity sweep
- weekly schema and terms drift check

2. Add structured logs and health endpoints/diagnostics.
3. Add retry/backoff and dead-letter style capture for parse failures.

### F. Integration into existing terminal surfaces

1. Ensure Congress tab consumes newly normalized/fresh data.
2. Ensure Data Vault receives new entities/relationships from normalized outputs.
3. Ensure CAM computation and payload surfaces reflect live-data freshness and provenance.

### G. Testing and docs

1. Add scripts for:

- API connectivity tests
- dry-run fetches
- normalization validation
- one end-to-end ingest test

2. Add operator docs covering:

- env vars
- schedules
- data flow
- adding a new source
- rollback/disable steps

3. Keep TypeScript strict-mode clean and avoid secret hardcoding.

---

## 13) What You Must Do (Owner Responsibilities)

### A. Environment and access readiness

1. Provide and validate all required source credentials (public/free tier where needed).
2. Confirm `.env` completeness on OpenClaw for ingestion and backend DB connectivity.
3. Confirm backend service account has migration + write permissions in PostgreSQL.
4. Confirm OpenClaw scheduler permissions for recurring jobs.

### B. Product and policy decisions

1. Keep Phase 1 scope constrained to:

- Congress trades
- USAspending contracts

2. Approve compliance policy language and enforcement behavior.
3. Approve confidence threshold definitions for "high-confidence" scoring gate.
4. Approve auto-enable behavior after first successful ingest run.

### C. Operational governance

1. Define who monitors failures and who acknowledges incidents.
2. Define acceptable downtime/freshness breach window.
3. Approve alerting channels for ingest failures and stale-data breaches.
4. Approve rollback trigger criteria (when to disable auto ingestion).

### D. Acceptance and sign-off

1. Review initial dry-run and first production ingest report.
2. Validate that CAM fields are populated as expected (not placeholder-heavy).
3. Validate Congress/Data Vault/CAM consistency on sample symbols.
4. Sign off Phase 1 before adding lobbying/network layer.

---

## 14) Phase Order (No Overbuild)

### Phase 1A - Foundation (backend only)

1. Env and connectivity checks
2. Migration scaffolding and ingest run/error/cursor structure
3. Logging and health scaffolding

### Phase 1B - Congress trades ingestion

1. Fetch -> normalize -> persist
2. Idempotent upsert + cursors
3. Dry-run + first end-to-end test

### Phase 1C - USAspending enrichment

1. Contract fetch -> normalize -> persist
2. Company linkage and procurement context fields
3. Feature staging updates

### Phase 1D - CAM/Congress/Data Vault integration

1. CAM reads enriched fields
2. Congress tab uses fresher normalized data
3. Data Vault receives relationships and provenance

### Phase 1E - Hardening

1. Compliance enforcement checks
2. Alerting and stale-data controls
3. Docs, runbook, and handoff

---

## 15) Definition of Done for CAM Live Data (Phase 1)

CAM live-data Phase 1 is done only when all items below are true:

1. Ingestion runs automatically on OpenClaw every 4 hours.
2. Freshness SLO is met for target sources under normal operation.
3. No duplicate normalized records across reruns.
4. High-confidence gate is enforced in CAM scoring path.
5. Compliance constraints are enforced, not advisory.
6. Congress tab and Data Vault read from same canonical normalized sources.
7. CAM payload includes provenance/freshness fields from automated ingestion.
8. End-to-end test and dry-run scripts pass in CI/local backend checks.
9. Operator docs and rollback/runbook are present and verified.

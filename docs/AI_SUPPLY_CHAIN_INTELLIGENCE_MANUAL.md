# AI Supply Chain Intelligence Manual

## 1. Purpose

AI Supply Chain Intelligence converts supply-chain relationship data into market-intelligence outputs suitable for institutional trading workflows.

Primary outcomes:

- Identify dependency structure (who depends on whom).
- Surface weak points and concentration risk.
- Connect live events to network exposure.
- Quantify first-order and second-order impact.
- Translate disruptions into trade-relevant implications.

## 2. Product Identity

The module operates inside Trading Terminal as a professional intelligence workspace.

Positioning:

- Institutional
- Analytical
- Evidence-driven
- Configurable
- AI-enhanced (not chatbot-forward)

## 3. Workspace Layout

### 3.1 Command Bar

Always displays current analytical context:

- Selected company/ticker
- Active mode
- Scenario
- Time horizon
- Data style
- Confidence floor
- Active overlays

### 3.2 Left Settings Panel

Core controls:

- Upstream and downstream depth
- Total visible tiers
- Relation scope (suppliers/customers/both)
- Facilities/routes visibility
- Confidence threshold
- Data style and point-in-time mode
- Ranking and exposure method
- Scenario and horizon
- Overlay selection

### 3.3 Main Intelligence Canvas

Connected visual modes over the same graph state:

- Graph view
- Map view
- Flow-oriented ecosystem view
- Risk lens
- Top dependency paths

### 3.4 Right Evidence and Intelligence Panel

Includes:

- Node/edge inspection
- Shock simulation controls
- Contributing path evidence
- Institutional briefing summary
- Quant model cards
- Trade relevance section

## 4. Relationship and Evidence Standards

Relationship classes include:

- Supplier
- Customer
- Facility
- Route/logistics
- Commodity dependency
- Chokepoint dependency
- Confirmed/inferred/historical variants

Evidence states are explicit and visible:

- Reported / verified official
- Estimated
- Inferred (hypothesis)
- User-confirmed (future extension)

Required metadata for AI-derived outputs:

- Confidence level
- Evidence count
- Freshness
- Source quality

## 5. Risk Overlay Model

Supported overlay families:

- Geopolitical and sanctions
- Tariff and regulatory
- Shipping and route disruption
- Commodity and energy dependency
- Weather and climate
- Labor and congestion
- Counterparty default and financial stress

Overlays should remain legible and non-cluttering.

## 6. Mathematical Intelligence Layer

The module surfaces the following formulas as production model cards:

1. Exposure Weight  
   w_ij = R_ij / sum_k R_ik

2. Concentration Risk  
   HHI_i = sum_j w_ij^2

3. Shock Propagation (first order)  
   Impact_i = sum_j w_ij \* Delta_j

4. Supply Chain Default Spillover  
   PD_i_SC = 1 - product_j (1 - w_ij \* PD_j)

5. Margin Sensitivity  
   Delta_GM_i ~= -sum_j w_ij \* Delta_C_j

6. Geographic Diversification / Fragility  
   Entropy_i = -sum_r p_ir \* ln(p_ir)

Each card should include:

- Model title
- Formula
- Current value
- Interpretation text
- Trend/sensitivity hook

## 7. Scenario Analysis

Scenario presets and custom shocks should support:

- Supplier disruption
- Multi-supplier disruption
- Country shutdown
- Sanctions event
- Tariff increase
- Commodity shock
- Shipping delay
- Facility outage
- Port closure
- Regional conflict escalation

Outputs should include:

- Directly affected nodes
- Indirectly affected nodes
- Severity ranking
- Time sensitivity
- Financial impact classification
- Related securities and second-order implications

## 8. Alerting and Monitoring

Alert triggers should include:

- New relationship discovery
- Confidence shift
- Risk score shift
- Critical facility proximity event
- Supplier default deterioration
- Concentration worsening
- Route blockage
- Sanctions exposure increase
- Evidence update
- Scenario threshold breach

## 9. AI Output Style

Language standard for generated intelligence:

- Concise
- Factual
- Prioritized
- Evidence-aware
- Institutional tone

Example phrasing style:

- "High supplier concentration detected in East Asian semiconductor packaging."
- "Second-order exposure likely through logistics dependency rather than direct sourcing."
- "Current disruption appears moderate in first-order terms but high in propagation potential."

## 10. Fast-Read Objective

Within seconds, users should understand:

- Most important dependency
- Largest current risk
- Risk location
- Concentration status
- Direct vs indirect channel
- Confidence quality
- Immediate trading relevance

## 11. Current Implementation Notes

The current desktop implementation includes:

- Command-context chips in the top bar
- Configurable left settings panel
- Multi-view canvas with graph/map/flow/risk/path modes
- Right panel with simulation and evidence
- Institutional briefing and model cards

Planned next extensions:

- Point-in-time replay controls
- Persisted user profile settings
- Alert subscription workflow
- User-confirmed relationship state
- Dedicated trade ideas output panel

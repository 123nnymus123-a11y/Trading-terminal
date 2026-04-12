# GWMD Supply Chain Data Vault: Complete Guide

**Date:** April 12, 2026  
**Purpose:** Comprehensive explanation of the AI evaluation model powering the GWMD Data Vault system, organized documentation index, and system architecture reference.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [System Architecture Overview](#system-architecture-overview)
3. [AI Model Tasks & Capabilities](#ai-model-tasks--capabilities)
4. [Data Flow & Request Lifecycle](#data-flow--request-lifecycle)
5. [Zone-Based Safety Model](#zone-based-safety-model)
6. [Documentation Index & Navigation](#documentation-index--navigation)
7. [Implementation Status](#implementation-status)

---

## Executive Summary

The **GWMD Data Vault** is a multi-layered AI supply chain intelligence system that converts raw relationship data into institutional trading insights. It operates as a pipeline:

- **Generate** supply chain relationships using LLM (Ollama/Cloud models)
- **Enrich** relationships with evidence, confidence scores, and provenance
- **Validate** relationships through zone-based classification (candidate → validation → production)
- **Syndicate** intelligence briefs to traders with market impact analysis
- **Persist** canonical data to backend PostgreSQL SoR (system-of-record) for tenant-scoped sharing

The system maintains local-first resilience (works offline via SQLite cache) while pushing/pulling canonical facts to backend when available.

---

## System Architecture Overview

### Layer Model

```
┌─────────────────────────────────────────────────────────────────────┐
│ LAYER 1: USER INTERACTION (Renderer)                               │
├─────────────────────────────────────────────────────────────────────┤
│ • GwmdMapPage.tsx — Map visualization, controls                     │
│ • gwmdMapStore.ts — State orchestration, fallback logic             │
│ • DataVault.tsx — Inspector panel, analytics, export UI             │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ LAYER 2: ORCHESTRATION (Desktop Main Process)                       │
├─────────────────────────────────────────────────────────────────────┤
│ • CentralAIOrchestrator — Manages AI pipelines, preload logic       │
│ • AiResearchManager — Research brief coordination                   │
│ • companyRelationshipService — Graph generation (multi-hop)         │
│ • graphMemory/service.ts — Data Vault dashboard & queries           │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ LAYER 3: LLM INFERENCE (Ollama/Cloud Models)                        │
├─────────────────────────────────────────────────────────────────────┤
│ • generateSupplyChainInsights() — Relationship extraction           │
│ • generateResearchBriefs() — Market event synthesis                 │
│ • analyzeSupplyChainShocks() — Scenario propagation                 │
│ • OllamaCloudClient — Model abstraction, fallback routing           │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ LAYER 4: LOCAL PERSISTENCE (Desktop SQLite)                         │
├─────────────────────────────────────────────────────────────────────┤
│ • graph_enrichment_entity — Entity nodes (zone, confidence)         │
│ • graph_enrichment_edge — Relationships (supplier/customer/route)   │
│ • graph_enrichment_evidence — Source citations & provenance         │
│ • graph_enrichment_validation_event — Zone promotion audit trail    │
│ • graph_enrichment_usage — Query frequency & optimization hints     │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ LAYER 5: CANONICAL BACKEND (PostgreSQL SoR)                         │
├─────────────────────────────────────────────────────────────────────┤
│ • graph_entity_sor — Canonical entities (tenant-scoped)             │
│ • graph_relationship_sor — Canonical relationships (dedup)          │
│ • graph_evidence_sor — Provenance & quality tracking                │
│ • graph_validation_event_sor — Zone promotion history               │
│ • graph_scenario_run_sor — Shock propagation results                │
└─────────────────────────────────────────────────────────────────────┘
```

### Cross-Layer Communication

| From | To | Protocol | Purpose |
|------|-----|----------|---------|
| Renderer | Main Process | IPC (gwmdMap:*, supplyChain:*) | Search, generate, display |
| Main Process | Ollama | HTTP (localhost:11434) | LLM inference |
| Main Process | Local SQLite | Direct SQL | Persistence, cache |
| Desktop | Backend | HTTP/REST + Auth | Cloud sync, tenant isolation |
| Backend | PostgreSQL | pg driver | Canonical SoR persistence |

---

## AI Model Tasks & Capabilities

### Task 1: Supply Chain Relationship Generation

**Objective:** Given a company ticker, generate a comprehensive supply chain graph.

**Flow:**
```
User enters ticker → companyRelationshipService.generateRelationships()
  → OllamaCloudClient.generateSupplyChainInsights()
  → LLM receives system + user prompt
  → Raw JSON response parsed (malformed-JSON tolerance)
  → Relationships normalized: (subject, predicate, object)
  → Coordinates resolved/repaired (geospatial enrichment)
  → Data merged with vault/candidate pipeline
  → Results persisted to local SQLite
  → Graph update broadcast to all renderer windows
```

**LLM Instrumentation:**

```
System Prompt:
"You are a supply chain analyst. Analyze company relationships and 
return strict JSON only."

User Prompt:
"Generate a comprehensive supply chain mind-map for {ticker}.
Include:
- Major suppliers (chips, components, materials)
- Customers (industries, companies)
- Facilities (manufacturing, distribution, HQ)
- Routes (logistics, transportation)
Criticality scale: 1 (minor) to 5 (critical/irreplaceable).
Output JSON with: companies (array of {id, name, role, criticality, since, 
revenueImpact, confidence, verified, source}), categories (array of 
{name, icon, color, companies})."
```

**Configuration:**
- Hop depth: 1–3 (user-configurable, clamped)
- Seed limits decrease with depth (e.g., 20 → 10 → 5)
- Model fallback: if primary model fails, retry with secondary
- Malformed-JSON tolerance: code fence stripping, balanced bracket extraction, trailing comma cleanup

**Output:**
```json
{
  "categories": [
    {
      "name": "Direct Suppliers",
      "icon": "🔧",
      "color": "#FF6B6B",
      "companies": [
        {
          "id": "TICKER1",
          "name": "Company A",
          "role": "Semiconductor supplier",
          "criticality": 5,
          "since": 2018,
          "revenueImpact": 500000000,
          "confidence": 0.92,
          "verified": true,
          "source": "SEC 10-K filing"
        }
      ]
    }
  ]
}
```

---

### Task 2: Evidence Ingestion & Zone Classification

**Objective:** Ingest relationships into the Data Vault and classify by validation zone.

**Zones:**

| Zone | Definition | Risk | Use Case |
|------|-----------|------|----------|
| `candidate` | Newly inferred (unvalidated) | High | Pre-validation pool, hypothesis testing |
| `validation` | Pending expert review | Medium | Waiting for analyst decision |
| `production` | Promoted, trusted facts | Low | Distribution to traders, downstream analytics |

**Process:**

1. **Ingest:** Relationship added with initial confidence score from LLM
2. **Evidence Attach:** Raw snippet, source URL, retrieval timestamp stored
3. **Classify:** Zone assigned based on confidence thresholds:
   - confidence ≥ 0.85 → candidate
   - 0.70 ≤ confidence < 0.85 → validation
   - confidence < 0.70 → quarantine (optional re-generation)

4. **Validate:** Human analyst reviews in Data Vault inspector panel
5. **Promote/Reject:**
   - Analyst clicks "Promote" → zone advances (candidate → validation → production)
   - Analyst clicks "Reject" → event logged, relationship archived
   - Contradiction detected → event logged (for future model improvement)

**Key Fields Tracked:**

```typescript
{
  entityId: string;
  entityType: "company" | "supplier" | "customer" | "facility";
  zone: "candidate" | "validation" | "production";
  confidence: number; // 0..1
  freshnessScore: number; // 0..1
  firstSeenAt: Date;
  lastSeenAt: Date;
  ttl: number; // days before stale
  provenanceHash: string; // deduplicate identical sources
  lineage: string; // "llama3.1:8b @ 2026-04-12T10:30Z"
}
```

---

### Task 3: Research Brief Generation

**Objective:** Monitor market events (news, filings, earnings) and synthesize institutional briefs.

**Flow:**

```
Poll Timer fires → AiResearchManager.runNow()
  → RSS feed fetch + SEC filing query + Earnings calendar lookup
  → Text extraction & deduplication (SHA256 hash)
  → Pass to Ollama for analysis
  → LLM generates structured briefs
  → Briefs stored in PostgreSQL (backend) or SQLite (desktop)
  → Renderer displays in Research Brief tab
```

**LLM System Prompt:**

```
"You are a financial intelligence analyst specializing in 
supply chain risk and geopolitical impact on trading positions. 
Generate institutional-quality research briefs. Return JSON array only."
```

**Brief Schema:**

```typescript
{
  id: string; // UUID
  headline: string; // Problem/opportunity summary
  summaryBullets: string[]; // 1-6 actionable points
  tickers: string[]; // Affected symbols
  whyItMatters: string; // Trading relevance
  whatToWatch: string[]; // Leading indicators
  impactScore: number; // 0-100 (1 = minor, 100 = major market event)
  confidence: number; // 0..1 (analyst conviction)
  sources: Array<{ title, url, source, publishedAt }>;
  createdAt: string; // ISO timestamp
}
```

**Example:**

```json
{
  "headline": "TSMC Taiwan facility disruption could cut Apple supply by 15-20%",
  "summaryBullets": [
    "TSMC announced 3-week production halt for geopolitical tensions",
    "AAPL exposure: ~30% of semiconductor sourcing via Taiwan",
    "Lead time recovery: 60+ days after restart",
    "Secondary suppliers (Samsung, Intel) cannot offset volume",
    "Margin compression expected Q2 2026"
  ],
  "tickers": ["AAPL", "TSMC", "INTC", "AMD"],
  "whyItMatters": "AAPL margin compression + supply chain reversal narrative",
  "whatToWatch": ["AAPL guidance revision", "Backorder levels", "Taiwan political developments"],
  "impactScore": 78,
  "confidence": 0.88
}
```

---

### Task 4: Supply Chain Shock Propagation & Risk Analysis

**Objective:** Model disruption scenarios and quantify downstream impact.

**Mathematical Models:**

**1. Exposure Weight**
```
w_ij = R_ij / Σ_k R_ik

Where w_ij = proportion of company i's supply dependent on supplier j
      R_ij = normalized relationship strength to supplier j
```

**2. Concentration Risk (Herfindahl–Hirschman Index)**
```
HHI_i = Σ_j w_ij²

Interpretation:
  HHI < 1500 = low concentration (competitive)
  1500 ≤ HHI ≤ 2500 = moderate concentration (merged market)
  HHI > 2500 = high concentration (concentrated supplier base)
```

**3. First-Order Shock Propagation**
```
Impact_i = Σ_j w_ij × ΔP_j

Where Impact_i = total margin/revenue impact to company i
      w_ij = exposure to supplier j
      ΔP_j = price/availability shock to supplier j
```

**4. Multi-Tier Spillover (Second-Order)**
```
PD_i_SC = 1 - ∏_j (1 - w_ij × PD_j)

Where PD_i_SC = probability of default spread through supply chain
      PD_j = default probability of supplier j
```

**5. Margin Sensitivity**
```
ΔGM_i ≈ -Σ_j w_ij × ΔC_j

Where ΔGM_i = change in gross margin %
      ΔC_j = cost change at supplier j (% of COGS)
```

**6. Geographic Diversification / Fragility (Entropy)**
```
Entropy_i = -Σ_r p_ir × ln(p_ir)

Where p_ir = proportion of supply from region r
  Higher entropy = safer (diversified)
  Lower entropy = riskier (concentrated geography)
```

**Scenario Templates:**

| Scenario | Parameters | Output |
|----------|-----------|--------|
| Supplier Disruption | Supplier outage duration | Impact by downstream customer |
| Tariff Shock | Region + tariff % | Cost increase propagation |
| Shipping Delay | Route disruption + duration | Lead time extension + penalty cost |
| Currency Shock | Currency pair + % move | Margin impact (unhedged exposure) |
| Labor Strike | Facility outage duration | Revenue loss + margin compression |

---

## Data Flow & Request Lifecycle

### Scenario: User Searches for Apple (AAPL) Supply Chain

**Time: T0 - Search Initiated**

```
User: "Search AAPL supply chain"
  ↓
Renderer Store: gwmdMapStore.search('AAPL', { model: 'llama3.1:8b', hops: 2 })
```

**T1 - Fallback Evaluation (50ms)**

Store attempts in order:
1. Check scoped local cache → **MISS** (not in recent searches)
2. Load full local snapshot → **MISS** (AAPL not previously searched)
3. Skip to IPC generation

**T2 - IPC Generation (150ms)**

```
ipcMain.handle('gwmdMap:search', async (ticker, options) => {
  const service = companyRelationshipService;
  const result = await service.generateRelationships(
    'AAPL',
    { hops: 2, model: 'llama3.1:8b' }
  );
});
```

**T3 - LLM Inference (2–5s, depending on hop depth)**

```
OllamaCloudClient.generateSupplyChainInsights('llama3.1:8b', 'AAPL', {
  globalTickers: ['TSM', 'SAM', 'INTC', ...],
  includeHypothesis: true
})
  ↓
POST http://localhost:11434/api/generate
  body: {
    model: 'llama3.1:8b',
    system: "You are a supply chain analyst...",
    prompt: "Generate comprehensive supply chain mind-map for AAPL...",
    temperature: 0.6,
    max_tokens: 8000
  }
  ↓
Raw Response (JSON + code fences + comments + trailing commas)
```

**T4 - Parser Robustness (200ms)**

```
try {
  const parsed = JSON.parse(raw);
} catch (e) {
  // Attempt recovery:
  1. Strip code fences (```json ... ```)
  2. Extract balanced JSON brackets
  3. Remove trailing commas
  4. Remove line comments
  5. Re-parse
  ↓ still fails?
  6. Fallback to partial parse (extract array)
  7. Emit parse_fail status to renderer
}
```

**T5 - Persistence to Local SQLite (100ms)**

```
gwmdMapRepo.upsertCompany('AAPL', { ... });
gwmdMapRepo.upsertRelationship('AAPL', 'TSM', 'supplier', { 
  confidence: 0.92,
  since: 2015,
  criticality: 5
});
```

**T6 - Graph Enrichment Ingestion (200ms)**

```
graphEnrichmentService.ingestMindMapResult({
  mindMapData: { categories: [...] },
  queryUsage: { queryText: 'gwmdmap:AAPL', queryCluster: [...] }
})
  ↓
Ingest entities: zone = 'candidate', confidence from LLM
Ingest relationships: linked via evidence
Ingest evidence: source = 'gwmdmap LLM', provenance hash
Update usage counters: request count ↑, cluster association ↑
```

**T7 - Broadcast to Renderer (50ms)**

```
ipcMain.emit('gwmdMap:graph:updated', {
  graph: { nodes, edges },
  companies: [...],
  metadata: { searchTime: '2.5s', hops: 2, count: 47 }
});
```

**T8 - Renderer Update (React reconciliation)**

```
GwmdMapPage displays:
  • Map with nodes clustered by category
  • Edge labels (supplier/customer/route)
  • Node color-coded by confidence level
  • Search trace: "Generated 47 relationships in 2.5s"
```

**Total Latency:** ~3–6 seconds (LLM dominates)

---

## Zone-Based Safety Model

### Promotion Workflow

```
CANDIDATE (Unvalidated)
    ↓ [Analyst Reviews]
    ├→ VALID → VALIDATION (Pending→Approved)
    ├→ REJECT → ARCHIVED
    └→ CONTRADICT → ARCHIVED + EVENT LOGGED

VALIDATION (Under Review)
    ↓ [Analyst Promotes]
    ├→ PRODUCTION (Distributed to traders)
    └→ REJECT → ARCHIVED

PRODUCTION (Trusted)
    ↓ [Continuous Monitoring]
    ├→ STALE [Evidence aging] → Revalidation Queue
    └→ CONTRADICT [New data conflicts] → Investigation
```

### Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| False relationships | Zone gates; require human validation before trader distribution |
| Stale data | Freshness tracking; mark old relationships as "warm" or "cold"; queue revalidation |
| Duplicate ingestion | Provenance-based deduplication (SHA256 hash of source + content) |
| Hallucinated tickers | Ticker normalization + cross-reference against known universe |
| High false-positive rate | Multi-model ensemble; combine Ollama + OpenAI confidence scores |

---

## Documentation Index & Navigation

This repository maintains comprehensive documentation. Below is a structured index to help you navigate:

### Core GWMD & Data Vault Documentation

**AI/ML Operating Model:**
- **[GWMD_FEATURES_DEEP_DIVE.md](GWMD_FEATURES_DEEP_DIVE.md)** — Full feature set, caching, fallback ladder, sync architecture
- **[GWMD_AI_HUMAN_ONBOARDING.md](GWMD_AI_HUMAN_ONBOARDING.md)** — Quick start for engineers, 15-min orientation, mental model
- **[GWMD_OPERATIONS_RUNBOOK.md](GWMD_OPERATIONS_RUNBOOK.md)** — Failure scenarios, debugging, contention handling
- **[DATA_VAULT_WORKSPACE.md](DATA_VAULT_WORKSPACE.md)** — Data Vault UI, local-first behavior, inspector panel
- **[GRAPH_ENRICHMENT_MEMORY_SYSTEM.md](GRAPH_ENRICHMENT_MEMORY_SYSTEM.md)** — Local SQLite schema, evidence tracking, 3-zone model

### Supply Chain Intelligence

- **[AI_SUPPLY_CHAIN_INTELLIGENCE_MANUAL.md](AI_SUPPLY_CHAIN_INTELLIGENCE_MANUAL.md)** — Purpose, workspace layout, relationship standards, risk overlays, mathematical models
- **[STRATEGY_RESEARCH_TAB_USER_MANUAL.md](STRATEGY_RESEARCH_TAB_USER_MANUAL.md)** — Strategy research workspace, library, studio, runs, reports, data panel

### System & Integration Planning

- **[CAM_TAB_FUTURE_PLAN.md](CAM_TAB_FUTURE_PLAN.md)** — Congress/CAM/Data Vault consistency, integration phases
- **[OPENCLAW_BACKEND_SERVER_PLANFILE.md](OPENCLAW_BACKEND_SERVER_PLANFILE.md)** — Backend architecture, orchestrator, queues, migrations

### Feature Status & Roadmap

- **[V4 Trading Terminal.md](V4%20Trading%20Terminal.md)** — v4 status snapshot, API endpoints, feature checklist
- **[V5 Trading Terminal - Comprehensive Feature Status (2026-03-25).md](V5%20Trading%20Terminal%20-%20Comprehensive%20Feature%20Status%20(2026-03-25).md)** — Latest v5 status, feature matrix, known issues
- **[ENGINE_CAPABILITY_ASSESSMENT.md](ENGINE_CAPABILITY_ASSESSMENT.md)** — AI engine evaluation, model availability, fallback logic

### Specialized Topics

- **[TED_FEATURE_README.md](TED_FEATURE_README.md)** — TED (Tool for Evidence Discovery) feature details
- **[STRATEGY_RESEARCH_TAB_REWORK_PLAN.md](STRATEGY_RESEARCH_TAB_REWORK_PLAN.md)** — Research tab evolution, new features, migration plan

### Master Index

- **[GWMD_DOCUMENTATION_INDEX.md](GWMD_DOCUMENTATION_INDEX.md)** — Official doc index with brief descriptions

---

## Documentation Navigation by Role

### For Product Managers

**Quick Start (30 min):**
1. [AI_SUPPLY_CHAIN_INTELLIGENCE_MANUAL.md](AI_SUPPLY_CHAIN_INTELLIGENCE_MANUAL.md) — Understand the product vision
2. [GWMD_FEATURES_DEEP_DIVE.md](GWMD_FEATURES_DEEP_DIVE.md) — Feature inventory
3. [V5 Trading Terminal - Comprehensive Feature Status (2026-03-25).md](V5%20Trading%20Terminal%20-%20Comprehensive%20Feature%20Status%20(2026-03-25).md) — Current roadmap

---

### For Frontend Engineers

**Setup Guide (1 hour):**
1. [GWMD_AI_HUMAN_ONBOARDING.md](GWMD_AI_HUMAN_ONBOARDING.md) — 15-min orientation
2. [DATA_VAULT_WORKSPACE.md](DATA_VAULT_WORKSPACE.md) — UI/IPC integration points
3. Code files:
   - `apps/desktop/src/renderer/pages/GwmdMapPage.tsx`
   - `apps/desktop/src/renderer/store/gwmdMapStore.ts`

---

### For Backend Engineers

**Setup Guide (1 hour):**
1. [GWMD_AI_HUMAN_ONBOARDING.md](GWMD_AI_HUMAN_ONBOARDING.md) — Architecture overview
2. [GWMD_FEATURES_DEEP_DIVE.md](GWMD_FEATURES_DEEP_DIVE.md) — Section 3.2 (Sync Path)
3. Code files:
   - `apps/backend/src/server.ts` (GWMD endpoints)
   - `apps/backend/src/services/gwmd/gwmdCloudRepo.ts`
   - `apps/backend/migrations/012_gwmd_cloud.sql`

---

### For DevOps / Infrastructure

**Deployment & Monitoring:**
1. [GWMD_OPERATIONS_RUNBOOK.md](GWMD_OPERATIONS_RUNBOOK.md) — Failure scenarios, debugging
2. [BACKEND_DEPLOYMENT.md](../BACKEND_DEPLOYMENT.md) — Backend deployment
3. [PM2_CONFIGURATION.md](../PM2_CONFIGURATION.md) — Process management

---

### For AI/ML Engineers

**Full Depth (2 hours):**
1. This document (GWMD_DATA_VAULT_COMPLETE_GUIDE.md)
2. [GRAPH_ENRICHMENT_MEMORY_SYSTEM.md](GRAPH_ENRICHMENT_MEMORY_SYSTEM.md) — Zone model, evidence tracking
3. [ENGINE_CAPABILITY_ASSESSMENT.md](ENGINE_CAPABILITY_ASSESSMENT.md) — Model selection, fallback logic
4. Code files:
   - `apps/desktop/src/main/services/GWMD/companyRelationshipService.ts`
   - `apps/backend/src/services/ollama/ollamaClient.ts`
   - `apps/desktop/src/main/workers/aiResearchWorker.ts`

---

## Implementation Status

### ✅ Completed

- **Supply Chain Graph Generation:** Ollama-backed relationship extraction with multi-hop support
- **Research Brief Pipeline:** Market event ingestion and synthesis
- **Local SQLite Persistence:** Full graph enrichment schema with zone classification
- **GWMD Map UI:** Interactive visualization, search, multi-monitor display
- **Cache-First Fallback:** Renderer -> Local Cache -> Offline generation
- **Data Vault Inspector:** Summary metrics, entity/relationship/evidence browsing
- **Backend SoR (Phase 3):** Canonical PostgreSQL tables with tenant isolation, fact ingestion endpoint

### ⏳ In Progress / Planned

- **Promotion Workflow Endpoints:** Candidate → Validation → Production transitions
- **Desktop ↔ Backend Sync:** Full bidirectional graph sync with conflict resolution
- **Scenario Persistence:** Store shock propagation results in backend
- **Multi-Model Ensemble:** Combine Ollama + OpenAI + Anthropic for confidence scoring
- **Lineage & Audit Trail:** Full replay capability for graph evolution

### 🎯 Next Steps

1. Implement promotion workflow endpoints (GET candidates, POST promote, GET history)
2. Integrate desktop reads with backend SoR (fallback ladder: backend → local → offline)
3. Wire scenario execution to persist results in `graph_scenario_run_sor` table
4. Add multi-model ensemble evaluation for relationship quality scoring

---

## Quick Reference: Key Files

| Component | File | Purpose |
|-----------|------|---------|
| Renderer GWMD | `apps/desktop/src/renderer/pages/GwmdMapPage.tsx` | Map UI, controls |
| Renderer Store | `apps/desktop/src/renderer/store/gwmdMapStore.ts` | Search orchestration, fallback |
| Main Service | `apps/desktop/src/main/services/GWMD/companyRelationshipService.ts` | Graph generation |
| LLM Client | `apps/backend/src/services/ollama/ollamaClient.ts` | Ollama/cloud abstraction |
| Local Repo | `apps/desktop/src/main/persistence/gwmdMapRepo.ts` | SQLite GWMD layer |
| Backend Repo | `apps/backend/src/services/gwmd/gwmdCloudRepo.ts` | PostgreSQL cloud sync |
| Data Vault UI | `apps/desktop/src/renderer/pages/DataVault.tsx` | Inspector panel |
| Graph Enrichment | `apps/desktop/src/main/services/graphEnrichment/` | Evidence & validation |
| AI Research | `apps/desktop/src/main/services/aiResearch/aiResearchManager.ts` | Brief coordination |
| Backend SoR (New) | `apps/backend/src/services/graphSor/` | Canonical graph persistence |

---

**Document Version:** 1.0  
**Last Updated:** April 12, 2026  
**Maintainers:** Engineering Team

# TED Feature README

## Overview

The TED feature in Trading Terminal is a generic procurement intelligence subsystem, not a sector-specific dashboard.

It ingests TED procurement notices into a reusable pipeline and exposes outputs that can be consumed by:

- Intelligence
- Panorama
- Data Vault
- Supply Chain
- GWMD

The implementation keeps provider-specific format handling in backend services and exposes stable API contracts to clients.

## Design Goals

- Generic procurement pipeline, not one-sector logic
- Source abstraction for current and future procurement providers
- Raw payload preservation for deterministic reprocessing
- Neutral normalized schema with dynamic metadata tags
- CPV-first classification with extendable internal taxonomy
- Deterministic baseline enrichment (AI optional)
- Graph-compatible output generation
- Strong provenance and diagnostics for operations

## Current Architecture

The subsystem is implemented as layered flow:

1. Source ingestion
2. Raw persistence
3. Normalization
4. Classification and enrichment
5. Scoring and graph relation generation
6. Dynamic query, aggregation, and integration feeds

### Main Backend Components

- Service implementation:
  - apps/backend/src/services/procurementIntel/procurementIntelService.ts
- HTTP routes:
  - apps/backend/src/server.ts
- Shared type contracts:
  - packages/shared/src/procurementIntel.ts
- Database schema migration:
  - apps/backend/migrations/014_procurement_intel_generic.sql

### Existing TED Snapshot Compatibility Layer

The procurement subsystem currently uses TED snapshot input from:

- apps/backend/src/services/tedIntel/tedIntelLive.ts
- apps/backend/src/services/tedIntel/tedIntel.ts

This enables live TED or deterministic fallback snapshot operation while keeping procurement pipeline behavior stable.

## Data Model

### Raw Layer

Table: procurement_notice_raw

Purpose:

- Preserve full source fidelity
- Keep payload reprocessable with newer enrichment logic

Core fields:

- raw_id
- tenant_id
- provider
- provider_notice_id
- source_url
- language
- payload (jsonb)
- source_hash
- ingested_at

### Normalized Layer

Table: procurement_notice_normalized

Purpose:

- Store provider-neutral procurement records

Core fields include:

- notice_id
- provider_notice_id
- provider
- title
- description
- buyer
- supplier
- country
- region
- city
- publication_date
- deadline
- contract_value
- currency
- procedure_type
- contract_type
- cpv_codes (jsonb)
- source_url
- raw_source_ref
- language
- completeness

### Enriched Layer

Table: procurement_notice_enriched

Purpose:

- Hold interpreted metadata, inferred fields, scores, and versioning

Key fields:

- tags (jsonb)
- interpreted_categories
- unmapped_cpv_codes
- inferred
- entity_refs
- scores
- enrichment_version
- classification_version
- reprocessed_at

### Graph Layer

Table: procurement_notice_graph_rel

Purpose:

- Persist graph-ready relationships for downstream graph systems

### Diagnostics Layer

Table: procurement_pipeline_events

Purpose:

- Track ingestion and enrichment pipeline health and uncertainty

Event types include:

- ingestion_success
- ingestion_failure
- normalization_error
- enrichment_failure
- unmapped_cpv
- entity_match_uncertain
- graph_generation_issue

## Classification and Enrichment

### Multi-label Metadata

The system supports simultaneous tags per notice:

- sector_tags
- theme_tags
- commodity_tags
- risk_tags
- geography_tags
- entity_tags

No single-sector bucket is required.

### CPV-first Taxonomy

- CPV remains official base classification
- Internal interpreted category mapping is maintained in service logic
- Unmapped CPV values are recorded to diagnostics

### Inferred Fields

The service enriches notices with:

- likely_sector_exposure
- supply_chain_relevance
- strategic_importance
- buyer_type
- public_spending_theme
- geopolitical_relevance
- procurement_scale_category
- event_significance_score

### Explainable Scoring Engine

Scores are modular and decomposed into factors:

- macro_significance
- supply_chain_relevance
- market_moving_potential
- strategic_infrastructure_relevance
- geopolitical_sensitivity

Each score includes:

- score value
- factor list with weight, value, contribution

## Graph Compatibility

Generated relationship patterns include:

- buyer -> procures -> commodity
- buyer -> awards -> supplier
- supplier -> operates_in -> geography
- notice -> relates_to -> tag
- contract -> implies_demand_for -> product category

All graph relation output remains generic and reusable.

## API Endpoints

### Legacy TED Snapshot and Config

- GET /api/tedintel/snapshot
- GET /api/tedintel/config
- PUT /api/tedintel/config

### Generic Procurement Intelligence

- POST /api/procurement/intel/ingest
- POST /api/procurement/intel/reprocess
- GET /api/procurement/intel/notices
- GET /api/procurement/intel/summary
- GET /api/procurement/intel/graph
- GET /api/procurement/intel/integrations
- GET /api/procurement/intel/raw/:rawId
- GET /api/procurement/intel/diagnostics

### Auth and Role Notes

- Auth is required for all routes above
- Ingest, reprocess, raw access, and diagnostics require operator/admin role

## Environment Configuration

TED live input behavior is controlled by backend env:

- TED_LIVE_ENABLED
- TED_LIVE_BASE_URL
- TED_LIVE_API_KEY
- TED_LIVE_AUTH_HEADER
- TED_LIVE_TIMEOUT_MS
- TED_LIVE_WINDOW_QUERY_PARAM

Reference:

- apps/backend/src/config.ts

## Reprocessing and Versioning

Reprocessing support is built in:

- Re-runs classification and enrichment without deleting historical raw records
- Updates enriched output using enrichment_version and classification_version
- Stores reprocessed_at for auditability

This allows taxonomy and scoring evolution without data loss.

## Integration Outputs

The integrations endpoint emits generic feeds for downstream systems:

- data_vault_evidence
- gwmd_signals
- supply_chain_overlays
- intelligence_panorama aggregations

This keeps TED procurement as platform substrate rather than a single UI feature.

## AI Agent Technical Guide

This section is optimized for coding agents working in this repository.

### Source of Truth Files

- apps/backend/src/services/procurementIntel/procurementIntelService.ts
- apps/backend/migrations/014_procurement_intel_generic.sql
- apps/backend/src/server.ts
- packages/shared/src/procurementIntel.ts

### Agent-safe Change Strategy

When extending this feature, preserve these invariants:

1. Keep raw, normalized, and enriched as separate layers
2. Do not add sector-specific tables or endpoint branching
3. Keep provider format parsing isolated in ingestion adapters
4. Preserve CPV official values alongside interpreted taxonomy
5. Keep scoring explainable and deterministic by default
6. Record uncertainty and mapping misses in diagnostics events
7. Keep graph relation generation generic and typed
8. Do not couple frontend components to provider payload format

### How to Add a New Provider

1. Add provider parser function that outputs raw-input shape used by normalize stage
2. Keep provider payload in procurement_notice_raw payload unchanged
3. Map parser output into normalized schema fields only
4. Reuse shared classification, enrichment, scoring, and graph logic
5. Add provider-specific tests and diagnostics event coverage

### How to Extend Taxonomy

1. Update CPV mapping table/object in procurementIntelService
2. Keep existing CPV values untouched
3. Add new interpreted tags/categories as additive change
4. Validate unmapped CPV diagnostics still works
5. Reprocess existing notices via reprocess endpoint

### How to Debug Pipeline Quickly

1. Call diagnostics endpoint and inspect counts
2. Inspect unmapped CPV list and entity uncertainty
3. Pull affected raw notice via raw endpoint
4. Compare normalized and enriched output via notices endpoint
5. Validate graph relation shape via graph endpoint

### Expected Failure Modes

- Source fetch failure: returns explicit TED error codes (for example ted_upstream_unreachable) with no mock data fallback
- Missing supplier: pipeline still succeeds, emits entity_match_uncertain
- Unknown CPV: pipeline still succeeds, emits unmapped_cpv
- DB unavailable: service uses in-memory fallback path, useful for tests/dev

## Testing

Current endpoint coverage includes procurement routes in:

- apps/backend/src/server.test.ts

Recommended command:

- pnpm --filter @tc/backend test src/server.test.ts

## Operational Notes

- Migration 014 must be applied in database-backed environments
- Tenant context is respected in persistence and API access
- Keep diagnostics endpoint enabled for observability and steward integration

## Future Work Suggestions

- Move CPV mappings to dedicated editable taxonomy storage
- Add additional procurement providers beyond TED
- Add dedicated frontend Procurement Intelligence explorer page
- Add stronger provenance links from graph nodes back to raw notices

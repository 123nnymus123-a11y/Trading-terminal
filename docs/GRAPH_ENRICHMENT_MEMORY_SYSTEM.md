# Graph Enrichment Memory System

## Overview

This implementation adds a structured, local-first, cloud-ready memory system for GWMD and Supply Chain graph enrichment.

Design goals met:

- local SQLite working store
- normalized schema with migrations and indexes
- evidence-first provenance
- strict candidate -> validation -> production safety zones
- confidence and freshness tracking
- usage memory for hot/warm/cold optimization
- selective revalidation queue
- JSON + CSV human-readable exports
- in-app inspector panel
- cloud adapter interfaces in not-connected mode

## Where It Lives

Main module:

- `apps/desktop/src/main/services/graphEnrichment/`

SQLite migration:

- `apps/desktop/src/main/persistence/db.ts` (schema version 2)

UI inspector integration:

- `apps/desktop/src/renderer/pages/SupplyChainMindMap.tsx`

IPC + preload bridge:

- `apps/desktop/src/main/index.ts`
- `apps/desktop/src/preload/index.ts`
- `apps/desktop/src/renderer/global.d.ts`

Repository-side readable data contract:

- `data/README.md`
- `data/schema/graph_enrichment_schema.sql`
- `data/schema/cloud_model.json`
- `data/cloud/sync_contracts.json`

## Runtime Folder Strategy

At runtime (Electron `userData`), the system ensures:

- `data/local/`
- `data/exports/json/`
- `data/exports/csv/`
- `data/snapshots/`
- `data/schema/`
- `data/migrations/`
- `data/cloud/`
- `logs/enrichment/`
- `logs/validation/`

## Core Domains Stored

1. Entities

- canonical identity, aliases, type, zone, provenance, validation metadata

2. Edges

- normalized relationship records with zone, confidence/freshness, provenance

3. Evidence

- source references, snippets, extraction metadata, quality score

4. Validation

- validation state on entities/edges and event history for promotion/rejection/contradiction

5. Confidence + Freshness

- score, confidence band, first/last seen timestamps, TTL expiry, stale flag

6. Usage Memory

- request counts, query clusters, speed-up indicators, hot/warm/cold temperature

## 3-Zone Truth Model

- `candidate`: newly inferred / unvalidated facts
- `validation`: pending review or intermediate confidence facts
- `production`: promoted, trusted graph facts

Promotion and contradiction history is tracked in `graph_enrichment_validation_event`.

## Request Flow Implemented

During supply-chain generation:

1. generate or load graph
2. ingest nodes/edges into enrichment store
3. classify into zone based on evidence status
4. attach evidence and provenance
5. update usage counters
6. enqueue offline sync payload for future cloud push

Additional flow methods:

- cached subgraph lookup for quick local reuse
- stale detection and maintenance revalidation queue generation

## Inspector & Human Visibility

In `SUPPLY CHAIN` page, click `MEM` to open the inspector panel.

The panel supports:

- summary metrics (candidate/validation/production, stale, low-confidence)
- stale entities and low-confidence edge preview
- cloud sync readiness status (not connected mode)
- cached subgraph lookup by alias/entity
- maintenance action to queue selective revalidation
- JSON/CSV export trigger

## Cloud-Ready (No Live Backend Required)

Cloud is abstracted behind interfaces in:

- `graphEnrichment/cloud.ts`

Current adapter:

- `NotConnectedCloudGraphRepository`

Behavior:

- full local functionality works without cloud credentials
- sync queue persists pending operations
- `getSyncStatus` reports not-connected mode and queue size

## Environment Placeholders

Added to `apps/desktop/.env.example`:

- `LOCAL_DB_PATH`
- `EXPORT_PATH`
- `CLOUD_ENABLED=false`
- `CLOUD_PROVIDER=placeholder`
- `CLOUD_DB_URL=`
- `CLOUD_BUCKET=`
- `CLOUD_SYNC_MODE=manual`
- `CLOUD_PROJECT_ID=`

## Future Server Connection Plan

When a cloud backend is available:

1. implement a concrete `CloudGraphRepository` adapter (Postgres/Supabase/etc.)
2. map local schema to cloud schema contract (`data/schema/cloud_model.json`)
3. process `graph_enrichment_sync_queue` in manual or scheduled batches
4. apply conflict strategy (`latest_timestamp` or policy-specific)
5. keep local-first writes and continue offline operation

No business-logic rewrite is required; only adapter + sync worker activation.

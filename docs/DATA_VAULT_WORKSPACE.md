# DATA VAULT Workspace (graphMemory)

## Purpose

The DATA VAULT workspace is a premium, operator-facing inspection and control surface for graph enrichment memory.

It is designed to:

- Expose canonical graph entities, edges, evidence, and validation state.
- Keep the workflow local-first using existing SQLite graph enrichment tables.
- Provide cloud-ready placeholders without requiring active cloud credentials.
- Support analyst operations: filter, inspect, export, and queue selective revalidation.

## Internal Module Name

- graphMemory

## Workspace Integration

The tab is integrated into the existing terminal workspace shell and not mounted as a standalone view.

### Tab Wiring

- Renderer tab registration and render switch:
  - apps/desktop/src/renderer/App.tsx
- Tab label:
  - DATA VAULT

## Layered Architecture

### Shared Contracts

- packages/shared/src/graphMemory.ts
- packages/shared/src/index.ts
- packages/shared/package.json (subpath export)

Defines:

- section model (overview/entities/relationships/evidence/validation/usage/snapshots/cloud/settings)
- filters and query payloads
- dashboard payload
- detail payload
- revalidation payloads/results
- export manifest payload
- cloud readiness payload

### Desktop Main Service

- apps/desktop/src/main/services/graphMemory/service.ts
- apps/desktop/src/main/services/graphMemory/index.ts

Responsibilities:

- build dashboard metrics from local graph tables
- serve paginated/sorted section queries
- return record-level detail and linked data
- queue selective revalidation jobs
- trigger local export snapshots and list manifests
- provide cloud readiness placeholder status

### IPC Endpoints (Main Process)

- apps/desktop/src/main/index.ts

Channels:

- graphMemory:getDashboard
- graphMemory:getSection
- graphMemory:getDetail
- graphMemory:refresh
- graphMemory:revalidateSelected
- graphMemory:exportNow
- graphMemory:getExportsManifest
- graphMemory:openLatestSnapshot
- graphMemory:revealPath

### Preload Bridge + Typing

- apps/desktop/src/preload/index.ts
- apps/desktop/src/renderer/global.d.ts

Adds typed renderer-safe bridge methods under:

- window.cockpit.graphMemory

### Renderer Workspace UI

- apps/desktop/src/renderer/pages/DataVault.tsx

Layout:

- top operations header (refresh/export/revalidate/open snapshot/sync placeholder)
- summary KPI row
- left section and filter rail
- center data grid for the active section
- right record inspector with sub-tabs

## Local-First Behavior

All primary DATA VAULT operations execute against local SQLite-backed graph enrichment data.

No cloud credentials are required to:

- browse data
- inspect details
- export snapshots
- queue local revalidation

## Cloud-Ready Placeholder Behavior

Cloud panel and Sync control expose readiness state without forced coupling.

Current behavior:

- shows provider/config placeholders and connection state
- disables sync action when not connected
- returns non-destructive status messaging

## Known Gaps / TODO

1. Add dedicated cloud adapter(s) and signed sync pipeline when backend cloud config is finalized.
2. Add section-specific typed table renderers for richer per-column formatting and stronger compile-time safety.
3. Add deep link navigation between related records in inspector tabs.
4. Add CSV export options and format selection (CSV/JSONL/parquet-ready metadata).
5. Add audit trail persistence for user-triggered actions (manual revalidation, export requests).
6. Add Playwright or renderer integration tests covering key workflows.

## Verification Commands

From workspace root:

- pnpm --filter @tc/desktop typecheck

Expected:

- TypeScript completes with no errors for touched graphMemory files.

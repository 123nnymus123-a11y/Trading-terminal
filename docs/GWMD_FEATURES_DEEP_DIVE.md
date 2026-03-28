# GWMD Features Deep Dive

## 1. What GWMD Is

GWMD (Global World Mind-Map Data) is the platform's relationship intelligence subsystem for building, storing, visualizing, validating, and optionally cloud-syncing company relationship graphs.

In this repository, GWMD is not only a map widget. It is a full pipeline:

1. AI relationship generation and normalization.
2. Local persistence and cache-first retrieval.
3. Graph enrichment ingestion into broader memory systems.
4. Multi-monitor display orchestration (wall, analyst, mirror).
5. Tenant-scoped cloud sync with push/pull/status endpoints.

---

## 2. Feature Catalog (No-Compromise Inventory)

### 2.1 Search and Relationship Generation

- Search entrypoint: renderer store action `search(ticker, { model, hops })`.
- Main process IPC handler: `gwmdMap:search`.
- Core service: `companyRelationshipService.generateRelationships(...)`.
- Multi-hop expansion with bounded depth and seed limits:
  - hop depth clamped to 1..3
  - seed limit policy decreases with depth
- Relationship parsing with robust malformed-JSON tolerance:
  - code fence stripping
  - balanced bracket extraction
  - trailing comma cleanup
  - comment removal
- Parse error classification to support renderer status handling (`parse_fail`).

### 2.2 Cache-First Behavior and Fallback Ladder

GWMD renderer search follows a layered fallback strategy:

1. Scoped local cache (`gwmdMap:loadScoped`) when available.
2. Full local snapshot hydrate (`gwmdMap:loadAll`) if needed.
3. Primary IPC search (`gwmdMap:search`).
4. Supply chain IPC fallback (`supplyChain:generate`) when GWMD IPC is unavailable.
5. Backend HTTP fallback (web mode path).

This strategy minimizes user-visible blank states and keeps partial functionality alive even under degraded runtime conditions.

### 2.3 Local Persistence (Desktop SQLite)

- Repository: `gwmdMapRepo`.
- Tables (desktop local DB):
  - `gwmd_company`
  - `gwmd_relationship`
  - `gwmd_search_history`
- Company upsert behavior merges nullables with `COALESCE`.
- Relationship upsert uses semantic uniqueness on `(from_ticker, to_ticker, relation_type)`.
- Graph build helpers:
  - full graph (`buildGraph`)
  - focal ticker scoped connected component (`buildScopedGraph`, `getScopedSnapshot`).

### 2.4 Geospatial Coverage and Repair

- Missing coordinate repair is supported both proactively and reactively.
- `gwmdMap:loadAll` attempts repair prior to returning full data.
- `gwmdMap:loadScoped` can trigger background repair and graph update broadcast.
- Dedicated manual repair IPC exists: `gwmdMap:repairGeo` with bounded limit.
- Repair failures are non-fatal; pipeline continues with partial coordinates.

### 2.5 Graph Enrichment Integration

After search generation, GWMD can feed graph enrichment memory:

- GWMD-to-mind-map mapping via `gwmdToMindMap`.
- Candidate persistence via `gwmdCandidateWriter`.
- Optional AI validation pipeline via `gwmdValidationPipeline`.
- Vault bridge and merge behavior via `gwmdVaultBridge`.

This means GWMD is integrated with broader intelligence memory, not siloed.

### 2.6 Cloud Sync (Backend-Tenant Scoped)

Backend endpoints:

- `POST /api/ai/gwmd/sync/push`
- `GET /api/ai/gwmd/sync/pull`
- `GET /api/ai/gwmd/sync/status`

Key properties:

- Auth-protected endpoints via auth guard.
- Tenant-aware data partitioning.
- Request/response validation through Zod schemas.
- Cache behavior:
  - status cache short TTL
  - pull responses cached per tenant and `since` key.
- Graceful unavailable response when DB-backed GWMD cloud service is not present.

### 2.7 Multi-Monitor Display Surface Modes

Supported display modes:

- `standard`
- `wall`
- `analyst`
- `mirror`

Core capabilities:

- monitor enumeration and stable sorting
- persisted display selection in app settings (`gwmdWallMode`)
- per-monitor window creation for selected displays
- source window hide/restore lifecycle
- topology change handling for display added/removed/metrics-changed events
- cross-window state broadcast (`gwmdMap:display:changed`)

### 2.8 Renderer Experience Layer

Renderer GWMD page integrates:

- map visualization (`GwmdWorldMap`)
- context detail panel
- TED overlay panel
- exposure brief panel
- cloud sync controls
- display surface controls

Store capabilities include:

- graph and company state
- selected node/edge state
- run status and metadata (`ok`, `degraded_cache`, `parse_fail`, `error`)
- search trace phases for diagnostics
- cloud sync state with status, version, counts, timestamps

---

## 3. End-to-End Architecture

## 3.1 Request to Graph Path

1. User submits ticker on GWMD page.
2. Store hydrates scoped/local cache if possible.
3. IPC search invokes main process GWMD service.
4. Service resolves model, generates relationships, expands hops.
5. Service resolves/repairs coordinates and normalizes entities.
6. Data is merged with vault/candidate pipeline when enabled.
7. Results persist to local GWMD repository.
8. Graph update broadcast emitted to all renderer windows.
9. Renderer store normalizes and merges graph/companies.

## 3.2 Sync Path

Push path:

1. Renderer builds normalized cloud payload from local graph/companies.
2. IPC call to main process sync route.
3. Backend validates payload and writes tenant-scoped cloud tables.
4. Sync status/version update and cache refresh.
5. Renderer sync state updated.

Pull path:

1. Renderer requests pull (optional `since`, optional replace mode).
2. Backend returns tenant-scoped snapshot (or incremental window).
3. Renderer replaces or merges local state.
4. Sync status fields updated.

## 3.3 Display Surface Path

1. Renderer picks monitors and mode.
2. Main process sanitizes selection against active displays.
3. Main process persists selection and opens per-monitor windows.
4. Session and state broadcasts keep UI surfaces consistent.
5. Topology changes trigger runtime resync and selection correction.

---

## 4. Data Contracts and Models

## 4.1 Cloud Company Contract

`GwmdCloudCompany` fields:

- ticker (required)
- name (required)
- hq_lat, hq_lon (optional nullable with bounded ranges)
- hq_city, hq_country (optional nullable)
- industry (optional nullable)
- health_score (optional nullable, integer 0..100)

## 4.2 Cloud Relationship Contract

`GwmdCloudRelationship` fields:

- id (required)
- from_ticker (required)
- to_ticker (required)
- relation_type in:
  - supplier
  - customer
  - partner
  - competitor
  - financing
  - license
- weight optional nullable in [0,1]
- confidence optional nullable in [0,1]
- evidence optional nullable

## 4.3 Sync Status Contract

`GwmdSyncStatus` fields:

- cloudVersion
- lastSyncAt
- companiesCount
- relationshipsCount
- syncStatus in: idle, syncing, ok, error

## 4.4 Run Status and Metadata (Renderer)

Common run statuses:

- `idle`
- `ok`
- `degraded_cache`
- `parse_fail`
- `error`

Representative run metadata includes:

- source classification
- degraded marker
- unlocated company count
- relationship hypothesis ratio
- requested hops
- expanded ticker count

---

## 5. Failure Modes and Degradation Strategy

## 5.1 Parse and AI Failures

- Parser can still fail if upstream format quality is too poor.
- Service emits parse-specific errors that renderer maps to `parse_fail`.
- If scoped cache exists, service can return degraded cache result instead of hard fail.

## 5.2 Coordinate Resolution Failures

- Coordinate repair is best-effort.
- Transient geocode errors are treated as non-fatal.
- Graph can still render partially with unresolved nodes.

## 5.3 Sync Availability Failures

- If backend GWMD cloud service is unavailable, endpoints return explicit unavailable codes.
- Renderer remains local-first and keeps operating in desktop cache mode.

## 5.4 Display Surface Runtime Failures

- Destroyed windows and topology changes are handled with state reconciliation.
- Lost monitor selections are sanitized, and sessions can be closed/reopened safely.

---

## 6. Source-of-Truth File Map

Desktop main process:

- `apps/desktop/src/main/index.ts`
- `apps/desktop/src/main/persistence/gwmdMapRepo.ts`
- `apps/desktop/src/main/services/GWMD/companyRelationshipService.ts`
- `apps/desktop/src/main/services/GWMD/gwmdToMindMap.ts`
- `apps/desktop/src/main/services/GWMD/gwmdCandidateWriter.ts`
- `apps/desktop/src/main/services/GWMD/gwmdValidationPipeline.ts`
- `apps/desktop/src/main/services/GWMD/gwmdVaultBridge.ts`

Desktop renderer:

- `apps/desktop/src/renderer/pages/GwmdMapPage.tsx`
- `apps/desktop/src/renderer/store/gwmdMapStore.ts`
- `apps/desktop/src/renderer/components/supplyChain/GwmdWorldMap.tsx`
- `apps/desktop/src/renderer/components/supplyChain/GwmdPathsPanel.tsx`

IPC surface:

- `apps/desktop/src/preload/index.ts`

Backend and contracts:

- `apps/backend/src/server.ts`
- `apps/backend/src/contracts.ts`
- `apps/backend/src/services/gwmd/gwmdCloudService.ts`
- `apps/backend/src/services/gwmd/gwmdCloudRepo.ts`
- `apps/backend/migrations/012_gwmd_cloud.sql`

Shared package surface:

- `packages/api/src/index.ts`
- `packages/shared/src/exposureBrief.ts`

---

## 7. Engineering Guardrails for Future GWMD Work

1. Keep relation type enums aligned across:
   - backend contracts
   - backend migration checks
   - cloud repo
   - renderer normalization.
2. Preserve cache-first semantics in search path.
3. Do not make geocode and validation failures fatal to primary graph visibility.
4. Preserve display selection sanitization and topology event handling.
5. When changing sync contracts, update both desktop preload typings and backend validators.
6. Keep tenant isolation in all backend GWMD cloud operations.
7. Validate changes with GWMD tests before release:
   - `gwmdMapRepo.test.ts`
   - `companyRelationshipService.test.ts`
   - `gwmdCandidateWriter.test.ts`

---

## 8. Quick Navigation

- For user-facing behavior: start in `GwmdMapPage.tsx` and `gwmdMapStore.ts`.
- For data persistence: `gwmdMapRepo.ts`.
- For generation logic and quality handling: `companyRelationshipService.ts`.
- For cloud synchronization: backend `server.ts` + `gwmdCloudRepo.ts` + migration `012_gwmd_cloud.sql`.
- For multi-display behavior: `main/index.ts` GWMD display section.

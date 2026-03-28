# GWMD Operations Runbook

## 1. Scope

This runbook is for operating, debugging, and maintaining GWMD in desktop and backend contexts.

It covers:

- Search and generation issues
- Local persistence issues
- Cloud sync issues
- Multi-monitor display issues
- Validation and post-change checks

---

## 2. Operational Model

GWMD is local-first on desktop.

- Baseline functionality (search cache, graph visualization, local persistence) works without cloud sync.
- Cloud sync requires backend auth + DB-backed GWMD cloud service.
- Display surface operations are desktop runtime capabilities and do not depend on backend.

---

## 3. Runtime Components and Responsibilities

Desktop main process:

- Owns GWMD IPC handlers.
- Owns local persistence repository calls.
- Owns display mode orchestration and window lifecycle.

Desktop renderer:

- Owns user interaction and graph display state.
- Owns fallback logic between IPC and HTTP paths.

Backend:

- Owns authenticated GWMD cloud sync endpoints.
- Owns tenant-scoped cloud persistence.
- Owns sync status tracking and caching.

---

## 4. Common Symptoms, Root Causes, and Actions

## 4.1 Symptom: Search returns error quickly

Likely causes:

- IPC GWMD search path failing in main process.
- Model/provider errors during relationship generation.
- JSON parse failure from upstream model output.

Actions:

1. Inspect renderer run status and search trace phase.
2. Confirm fallback path was attempted (`supplyChain` IPC or HTTP mode when applicable).
3. Check main process logs around `gwmdMap:search` and `CompanyRelationshipService`.
4. If parse quality is the issue, verify parser tolerances in `companyRelationshipService.ts`.
5. If cache exists, ensure degraded cache path is not blocked by recent logic changes.

## 4.2 Symptom: Search works but map coverage is sparse

Likely causes:

- Missing coordinates in source data.
- Coordinate repair or geocoding degradation.

Actions:

1. Trigger `gwmdMap:repairGeo` with bounded limit.
2. Re-run load scoped/full after repair.
3. Verify unresolved node count in run metadata.
4. Confirm geocode errors are non-fatal and not aborting graph updates.

## 4.3 Symptom: Cloud sync push/pull/status unavailable

Likely causes:

- Backend GWMD cloud service unavailable (no DB pool/migration/state).
- Auth token missing or invalid.

Actions:

1. Check backend response for `gwmd_sync_unavailable_no_database`.
2. Validate authentication state and token binding.
3. Verify migration `012_gwmd_cloud.sql` is applied.
4. Verify backend route handlers for:
   - `/api/ai/gwmd/sync/push`
   - `/api/ai/gwmd/sync/pull`
   - `/api/ai/gwmd/sync/status`
5. Confirm status cache behavior is not masking stale state.

## 4.4 Symptom: Pull succeeds but renderer state does not reflect expected graph

Likely causes:

- Replace vs merge expectations mismatch.
- Normalization mismatch for edge/company keys.

Actions:

1. Check `replace` option in pull invocation.
2. Verify normalization in `normalizeCloudSnapshot` and merge routines.
3. Confirm semantic edge key dedupe behavior in store.

## 4.5 Symptom: Wall/analyst/mirror mode unstable on monitor changes

Likely causes:

- Topology changed while wall session active.
- Stored monitor selection no longer valid.

Actions:

1. Verify `sanitizeGwmdDisplaySelection` behavior still enforces valid monitor IDs.
2. Confirm listeners are active for display add/remove/metrics changes.
3. Validate `synchronizeGwmdDisplayWallWindows` removes stale windows and recreates required ones.
4. Exit and re-enter display surface after major monitor topology changes.

## 4.6 Symptom: Map updates in one window but not others

Likely causes:

- Broadcast events not wired or lost in one window.
- Wall session sync channel mismatch.

Actions:

1. Confirm main process emits `gwmdMap:graph:updated` and `gwmdMap:display:changed`.
2. Confirm preload subscriptions are active in renderer instances.
3. Confirm wall session query params are set for satellite windows.

---

## 5. Operational Checklists

## 5.1 Pre-Release GWMD Checklist

1. Search path:
   - scoped cache hydrate works
   - fresh search works
   - parse fail handled gracefully
2. Persistence path:
   - loadAll and loadScoped return valid graph
   - clear operation resets data cleanly
3. Cloud path:
   - push updates status/version/counts
   - pull replaces/merges as expected
   - status endpoint returns stable shape
4. Display path:
   - enter/exit all modes
   - monitor picker and persisted selection work
   - topology changes handled without hard crash

## 5.2 Incident Triage Checklist

1. Identify layer of failure:
   - renderer only
   - main process IPC
   - backend sync
2. Capture status artifacts:
   - runStatus, runMeta, searchTrace
   - syncState fields
3. Capture logs from:
   - main process around GWMD IPC handlers
   - backend around GWMD sync routes
4. Validate schema compatibility:
   - contracts enums and payload shape
   - migration constraints

---

## 6. Contract and Schema Drift Controls

When relation types are changed:

1. Update backend Zod contract enums.
2. Update backend SQL check constraints or migration strategy.
3. Update renderer/store normalization and cloud mapping.
4. Update any dependent relation color or filter UI behavior.

When sync payload changes:

1. Update backend contracts and routes.
2. Update preload API typings and renderer use sites.
3. Update shared API package schema exports.

---

## 7. Known Good File Anchors

Use these files first when diagnosing GWMD behavior:

- `apps/desktop/src/main/index.ts`
- `apps/desktop/src/renderer/store/gwmdMapStore.ts`
- `apps/desktop/src/renderer/pages/GwmdMapPage.tsx`
- `apps/desktop/src/main/persistence/gwmdMapRepo.ts`
- `apps/desktop/src/main/services/GWMD/companyRelationshipService.ts`
- `apps/backend/src/server.ts`
- `apps/backend/src/services/gwmd/gwmdCloudRepo.ts`
- `apps/backend/src/contracts.ts`
- `apps/backend/migrations/012_gwmd_cloud.sql`

---

## 8. Post-Change Validation Commands

Use repository-standard validation before shipping GWMD changes.

Suggested minimum:

1. typecheck desktop package
2. run GWMD-focused tests
3. verify backend build for contract/migration changes

Target tests:

- `apps/desktop/src/main/persistence/gwmdMapRepo.test.ts`
- `apps/desktop/src/main/services/GWMD/companyRelationshipService.test.ts`
- `apps/desktop/src/main/services/GWMD/gwmdCandidateWriter.test.ts`

---

## 9. Non-Negotiable Stability Principles

1. Local-first behavior must remain intact.
2. Degraded modes are better than blank-screen failure.
3. Parse/geocode quality failures must not crash renderer UX.
4. Display topology changes must be treated as normal runtime conditions.
5. Tenant isolation is mandatory for backend GWMD cloud data.

# GWMD AI and Human Onboarding Guide

## 1. Purpose

This guide is designed to get a new engineer or AI coding agent productive on GWMD fast, without losing critical architectural context.

If you read only one page first, read this one, then jump to the deep dive.

---

## 2. 15-Minute Orientation Path

1. Read `docs/GWMD_FEATURES_DEEP_DIVE.md` sections 1 to 3.
2. Open these code files in order:
   - `apps/desktop/src/renderer/pages/GwmdMapPage.tsx`
   - `apps/desktop/src/renderer/store/gwmdMapStore.ts`
   - `apps/desktop/src/main/index.ts`
   - `apps/desktop/src/main/services/GWMD/companyRelationshipService.ts`
   - `apps/desktop/src/main/persistence/gwmdMapRepo.ts`
   - `apps/backend/src/server.ts`
   - `apps/backend/src/services/gwmd/gwmdCloudRepo.ts`
   - `apps/backend/src/contracts.ts`
3. Skim runbook `docs/GWMD_OPERATIONS_RUNBOOK.md` for failure behavior.

---

## 3. Mental Model for GWMD

Use this compact model:

- GWMD is a pipeline, not only a map.
- Renderer store is the orchestration brain for user flow and fallbacks.
- Main process is the runtime authority for generation, persistence, and display windows.
- Backend only governs cloud sync and tenant-scoped persistence.
- Local data and UI should still be useful when cloud sync is unavailable.

---

## 4. Where to Change What

## 4.1 If You Need to Change User Interaction

Start in:

- `GwmdMapPage.tsx`
- `gwmdMapStore.ts`

Typical changes:

- controls and page behavior
- search lifecycle UX
- cloud sync button behavior
- display mode UX

## 4.2 If You Need to Change Graph Generation

Start in:

- `companyRelationshipService.ts`

Typical changes:

- prompts and parsing
- hop expansion
- quality gating
- geocode or coordinate enrichment behavior

## 4.3 If You Need to Change Persistence

Start in:

- local: `gwmdMapRepo.ts`
- cloud: `gwmdCloudRepo.ts` + migration/contracts

Typical changes:

- new fields in company/relationship records
- dedupe or semantic key behavior
- retention or query behavior

## 4.4 If You Need to Change Sync Contracts

You must update all of:

1. backend contracts (`contracts.ts`)
2. backend routes (`server.ts`)
3. preload GWMD API shape (`preload/index.ts`)
4. renderer store payload handling (`gwmdMapStore.ts`)
5. shared package schemas if used cross-package

## 4.5 If You Need to Change Multi-Monitor Display Behavior

Start in:

- `main/index.ts` GWMD display block

Critical responsibilities there:

- monitor discovery
- persisted selection
- display window lifecycle
- topology change reconciliation

---

## 5. Guardrails for AI Agents

1. Keep ticker normalization consistent (uppercase semantic keys).
2. Preserve cache-first behavior before expensive generation.
3. Do not remove degraded modes (`degraded_cache`, parse resilience).
4. Avoid making geocode/validation failures fatal.
5. Keep relation type enums aligned across layers.
6. Keep tenant scope in cloud sync queries.
7. Preserve monitor selection sanitization when editing display code.

---

## 6. Fast Debugging Cheat Sheet

Search issues:

- Check store `runStatus`, `runMeta`, `searchTrace`.
- Check main process logs for `gwmdMap:search` and parser errors.

Sync issues:

- Check backend endpoint availability and auth context.
- Verify migration `012_gwmd_cloud.sql` is active.
- Confirm response shape still matches Zod contracts.

Display issues:

- Validate monitor list and selection state.
- Confirm display lifecycle events and source window restore logic.

Graph mismatch issues:

- Verify normalization and semantic edge dedupe in store/repo.
- Verify replace vs merge expectations during pull.

---

## 7. Contribution Checklist for GWMD Changes

Before opening PR:

1. Confirm behavior in normal and degraded paths.
2. Confirm existing GWMD tests still pass.
3. Confirm no schema drift between frontend/backend contracts.
4. Confirm display mode changes were tested on multi-monitor and single-monitor setups.
5. Update docs when adding or changing GWMD features.

---

## 8. Suggested Reading Order by Role

For product/ops:

1. `docs/GWMD_FEATURES_DEEP_DIVE.md`
2. `docs/GWMD_OPERATIONS_RUNBOOK.md`

For frontend engineers:

1. `GwmdMapPage.tsx`
2. `gwmdMapStore.ts`
3. `GwmdWorldMap.tsx`

For desktop main process engineers:

1. `main/index.ts` GWMD block
2. `gwmdMapRepo.ts`
3. `companyRelationshipService.ts`

For backend engineers:

1. `server.ts` GWMD endpoints
2. `contracts.ts`
3. `gwmdCloudRepo.ts`
4. `012_gwmd_cloud.sql`

For AI agents:

1. this onboarding guide
2. deep dive doc
3. repository memory files under `/memories/repo/` for compressed high-signal reminders

---

## 9. Canonical GWMD Documentation Set

This repository now treats these as the GWMD doc core:

- `docs/GWMD_AI_HUMAN_ONBOARDING.md`
- `docs/GWMD_FEATURES_DEEP_DIVE.md`
- `docs/GWMD_OPERATIONS_RUNBOOK.md`

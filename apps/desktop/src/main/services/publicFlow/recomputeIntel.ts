import type { DisclosureEvent } from "@tc/shared";
import { PublicFlowRepo } from "../../persistence/publicFlowRepo";
import { enrichEvents } from "./enrichment";
import { ThemeEngine, type ThemeComputationResult, type ThemeDetail } from "./themeEngine";
import { SecondOrder } from "./secondOrder";

const DAY_MS = 24 * 60 * 60 * 1000;
const EVENT_LOOKBACK_DAYS = 35;
const SECOND_ORDER_PRIMARY_LIMIT = 5;
const SECOND_ORDER_SECONDARY_LIMIT = 3;

export interface RecomputeIntelSummary {
  eventsConsidered: number;
  enrichmentApplied: number;
  windows: Array<{ windowDays: 7 | 30; themeCount: number }>;
  secondOrder: {
    themesProcessed: number;
    hotTickers: number;
    candidatesUpserted: number;
  };
}

function selectThemesForSecondOrder(
  sevenDay: ThemeComputationResult,
  thirtyDay: ThemeComputationResult
): ThemeDetail[] {
  const targets: ThemeDetail[] = [];
  const seen = new Set<number>();

  for (const detail of sevenDay.themes.slice(0, SECOND_ORDER_PRIMARY_LIMIT)) {
    if (!detail.id || seen.has(detail.id)) continue;
    targets.push(detail);
    seen.add(detail.id);
  }

  if (targets.length < SECOND_ORDER_PRIMARY_LIMIT) {
    for (const detail of thirtyDay.themes) {
      if (!detail.id || seen.has(detail.id)) continue;
      targets.push(detail);
      seen.add(detail.id);
      if (targets.length >= SECOND_ORDER_PRIMARY_LIMIT + SECOND_ORDER_SECONDARY_LIMIT) break;
    }
  }

  return targets;
}

function collectEnrichmentUpdates(original: DisclosureEvent[], enriched: DisclosureEvent[]): Array<{
  id: number;
  sector: string | null;
  industry: string | null;
}> {
  const updates: Array<{ id: number; sector: string | null; industry: string | null }> = [];
  for (let i = 0; i < original.length; i++) {
    const base = original[i];
    const next = enriched[i];
    if (!base || !next) continue;
    if (!base.id) continue;
    const sectorChanged = !base.sector && !!next.sector;
    const industryChanged = !base.industry && !!next.industry;
    if (sectorChanged || industryChanged) {
      updates.push({ id: base.id, sector: next.sector ?? base.sector, industry: next.industry ?? base.industry });
    }
  }
  return updates;
}

export async function recomputePublicFlowIntel(): Promise<RecomputeIntelSummary> {
  console.log("[RecomputeIntel] Starting recompute for Public Flow Intel...");
  const since = new Date(Date.now() - EVENT_LOOKBACK_DAYS * DAY_MS).toISOString();
  const recentEvents = PublicFlowRepo.queryRecentDisclosureEvents(5000, since) as DisclosureEvent[];

  if (recentEvents.length === 0) {
    console.log("[RecomputeIntel] No disclosure events available for recompute.");
    return {
      eventsConsidered: 0,
      enrichmentApplied: 0,
      windows: [
        { windowDays: 7, themeCount: 0 },
        { windowDays: 30, themeCount: 0 },
      ],
      secondOrder: { themesProcessed: 0, hotTickers: 0, candidatesUpserted: 0 },
    };
  }

  const enriched = enrichEvents(recentEvents as any) as DisclosureEvent[];
  const updates = collectEnrichmentUpdates(recentEvents, enriched as DisclosureEvent[]);
  const enrichmentApplied = updates.length ? PublicFlowRepo.updateDisclosureEventClassification(updates) : 0;
  if (enrichmentApplied > 0) {
    console.log(`[RecomputeIntel] Applied enrichment to ${enrichmentApplied} disclosure events.`);
  }

  const sevenDay = ThemeEngine.computeThemes(7, { events: enriched as DisclosureEvent[] });
  const thirtyDay = ThemeEngine.computeThemes(30, { events: enriched as DisclosureEvent[] });

  const targets = selectThemesForSecondOrder(sevenDay, thirtyDay);
  const secondOrderSummary = SecondOrder.generateCandidates(targets);

  console.log(
    `[RecomputeIntel] Themes -> 7d: ${sevenDay.themes.length}, 30d: ${thirtyDay.themes.length}; Second-order candidates: ${secondOrderSummary.inserted}`
  );

  return {
    eventsConsidered: recentEvents.length,
    enrichmentApplied,
    windows: [
      { windowDays: 7, themeCount: sevenDay.themes.length },
      { windowDays: 30, themeCount: thirtyDay.themes.length },
    ],
    secondOrder: {
      themesProcessed: secondOrderSummary.themeCount,
      hotTickers: secondOrderSummary.hotTickerCount,
      candidatesUpserted: secondOrderSummary.inserted,
    },
  };
}

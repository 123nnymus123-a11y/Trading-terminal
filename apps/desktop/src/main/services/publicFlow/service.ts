import type { DisclosureEvent, SectorTheme, WatchlistCandidate, ValuationTag } from "@tc/shared";
import { createLogger } from "@tc/shared";
import { PublicFlowRepo } from "../../persistence/publicFlowRepo";
import { ingestAll } from "./ingest";
import { recomputePublicFlowIntel, type RecomputeIntelSummary } from "./recomputeIntel";
import { getValuationTags as computeValuationTags } from "./getValuations";

const logger = createLogger({ scope: "publicFlow.service" });
const DEFAULT_INGEST_SINCE = "1970-01-01T00:00:00.000Z"; // full-history ingest; safe due to dedupe

export interface RefreshPublicFlowResult {
  ts: number;
  ingest: Awaited<ReturnType<typeof ingestAll>>;
  recompute: RecomputeIntelSummary;
}

/**
 * Run full Public Flow ingest + intel recompute.
 * Returns timing and summaries for renderer display.
 */
export async function refreshPublicFlowIntel(): Promise<RefreshPublicFlowResult> {
  const startedAt = Date.now();
  logger.info("[publicFlow] Refresh starting (ingest + recompute)...");

  const ingest = await ingestAll(DEFAULT_INGEST_SINCE);
  const recompute = await recomputePublicFlowIntel();
  const ts = Date.now();

  logger.info(
    `[publicFlow] Refresh complete in ${ts - startedAt}ms (fetched=${ingest.totals.fetched}, inserted=${ingest.totals.inserted}, events=${recompute.eventsConsidered})`
  );

  return { ts, ingest, recompute };
}

export function getRecentDisclosureEvents(limit = 50): DisclosureEvent[] {
  return PublicFlowRepo.queryRecentDisclosureEvents(limit);
}

export function getTopSectorThemes(windowDays: 7 | 30, limit = 10): SectorTheme[] {
  return PublicFlowRepo.queryTopSectorThemes(windowDays, limit);
}

export function getWatchlistCandidates(themeId: number): WatchlistCandidate[] {
  if (!themeId || Number.isNaN(themeId)) return [];
  return PublicFlowRepo.queryWatchlistCandidates(themeId);
}

export async function getValuationTags(tickers: string[]): Promise<Record<string, ValuationTag>> {
  if (!tickers || tickers.length === 0) return {};
  return computeValuationTags(Array.from(new Set(tickers)));
}

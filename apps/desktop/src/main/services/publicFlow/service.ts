import type {
  DisclosureEvent,
  SectorTheme,
  WatchlistCandidate,
  ValuationTag,
} from "@tc/shared";
import { createLogger } from "@tc/shared";
import { PublicFlowRepo } from "../../persistence/publicFlowRepo";
import { ingestAll } from "./ingest";
import {
  recomputePublicFlowIntel,
  type RecomputeIntelSummary,
} from "./recomputeIntel";
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
    `[publicFlow] Refresh complete in ${ts - startedAt}ms (fetched=${ingest.totals.fetched}, inserted=${ingest.totals.inserted}, events=${recompute.eventsConsidered})`,
  );

  return { ts, ingest, recompute };
}

export function getRecentDisclosureEvents(limit = 50): DisclosureEvent[] {
  return PublicFlowRepo.queryRecentDisclosureEvents(limit);
}

export function getTopSectorThemes(
  windowDays: 7 | 30,
  limit = 10,
): SectorTheme[] {
  return PublicFlowRepo.queryTopSectorThemes(windowDays, limit);
}

export function getWatchlistCandidates(
  themeId: number,
  options?: {
    minPriority?: "critical" | "high" | "medium" | "low";
    minConfidence?: number;
  },
): WatchlistCandidate[] {
  if (!themeId || Number.isNaN(themeId)) return [];
  const priorityRank = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  } as const;
  const relationWeight: Record<WatchlistCandidate["relation_type"], number> = {
    peer: 1,
    supplier: 0.8,
    customer: 0.65,
    "etf-constituent": 0.5,
  };
  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value));
  const toPriority = (
    score: number,
  ): "critical" | "high" | "medium" | "low" => {
    if (score >= 80) return "critical";
    if (score >= 65) return "high";
    if (score >= 45) return "medium";
    return "low";
  };

  const rows = PublicFlowRepo.queryWatchlistCandidates(themeId);
  const theme = PublicFlowRepo.queryTopSectorThemes(7, 100)
    .concat(PublicFlowRepo.queryTopSectorThemes(30, 100))
    .find((item) => item.id === themeId);
  const themeMomentum = clamp((theme?.score ?? 50) / 100, 0, 1);
  const allRows = PublicFlowRepo.queryAllWatchlistCandidates(2000);
  const countByTicker = allRows.reduce<Record<string, number>>((acc, item) => {
    const key = item.ticker.toUpperCase();
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const minPriorityRank = options?.minPriority
    ? priorityRank[options.minPriority]
    : 0;
  const minConfidence =
    typeof options?.minConfidence === "number"
      ? clamp(options.minConfidence, 0, 1)
      : undefined;

  return rows
    .map((item) => {
      const relationStrength = relationWeight[item.relation_type] ?? 0.5;
      const themeCount = countByTicker[item.ticker.toUpperCase()] ?? 1;
      const diversityBonus = clamp(themeCount / 4, 0, 1);
      const freshnessDays = Math.max(
        0,
        (Date.now() - Date.parse(item.created_at)) / (24 * 60 * 60 * 1000),
      );
      const freshnessBoost = clamp(Math.exp(-freshnessDays / 30), 0, 1);
      const score = clamp(
        themeMomentum * 0.45 +
          relationStrength * 0.3 +
          diversityBonus * 0.15 +
          freshnessBoost * 0.1,
        0,
        1,
      );
      const importanceScore = Number((score * 100).toFixed(1));
      const confidenceScore = Number(
        clamp(
          themeMomentum * 0.45 + relationStrength * 0.4 + freshnessBoost * 0.15,
          0,
          1,
        ).toFixed(3),
      );
      return {
        ...item,
        importance_score: importanceScore,
        confidence_score: confidenceScore,
        priority: toPriority(importanceScore),
        theme_count: themeCount,
        freshness_days: Number(freshnessDays.toFixed(1)),
        score_components: {
          theme_momentum: Number(themeMomentum.toFixed(3)),
          relation_strength: Number(relationStrength.toFixed(3)),
          diversity_bonus: Number(diversityBonus.toFixed(3)),
          freshness_boost: Number(freshnessBoost.toFixed(3)),
        },
      } as WatchlistCandidate;
    })
    .filter((item) => {
      const rank = item.priority ? priorityRank[item.priority] : 0;
      if (rank < minPriorityRank) return false;
      if (
        typeof minConfidence === "number" &&
        typeof item.confidence_score === "number" &&
        item.confidence_score < minConfidence
      ) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      const scoreDelta = (b.importance_score ?? 0) - (a.importance_score ?? 0);
      if (scoreDelta !== 0) return scoreDelta;
      const confidenceDelta =
        (b.confidence_score ?? 0) - (a.confidence_score ?? 0);
      if (confidenceDelta !== 0) return confidenceDelta;
      return Date.parse(b.created_at) - Date.parse(a.created_at);
    });
}

export async function getValuationTags(
  tickers: string[],
): Promise<Record<string, ValuationTag>> {
  if (!tickers || tickers.length === 0) return {};
  return computeValuationTags(Array.from(new Set(tickers)));
}

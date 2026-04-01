import type { DisclosureEvent, InsertSectorTheme } from "@tc/shared";
import { PublicFlowRepo } from "../../persistence/publicFlowRepo";
import { enrichEvents } from "./enrichment";

export interface HotTicker {
  ticker: string;
  netFlow: number;
  totalValue: number;
  buyCount: number;
  sellCount: number;
  score: number;
  topEntities: string[];
}

export interface ThemeDetail {
  id: number;
  sector: string;
  window_days: 7 | 30;
  window_start: string;
  window_end: string;
  score: number;
  summary: string;
  eventCount: number;
  totalValue: number;
  hotTickers: HotTicker[];
}

export interface ThemeComputationResult {
  windowDays: 7 | 30;
  windowStart: string;
  windowEnd: string;
  themes: ThemeDetail[];
}

interface ThemeEngineOptions {
  events?: DisclosureEvent[];
  limit?: number;
}

const DEFAULT_LIMIT = 5000;
const MAX_HOT_TICKERS = 3;

function formatDollars(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value === 0) return "$0";
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function midpoint(event: DisclosureEvent): number {
  const min = typeof event.amount_min === "number" ? event.amount_min : null;
  const max = typeof event.amount_max === "number" ? event.amount_max : null;
  if (min !== null && max !== null) return (min + max) / 2;
  if (min !== null) return min;
  if (max !== null) return max;
  return 500_000; // fallback so we still weight the event
}

function calcScore(sectorEvents: DisclosureEvent[]): {
  score: number;
  summary: string;
  stats: {
    buyValue: number;
    sellValue: number;
    totalValue: number;
    buyCount: number;
    sellCount: number;
    repeatCount: number;
    uniqueEntities: number;
    topHotTickers: HotTicker[];
  };
} {
  if (sectorEvents.length === 0) {
    return {
      score: 0,
      summary: "No activity",
      stats: {
        buyValue: 0,
        sellValue: 0,
        totalValue: 0,
        buyCount: 0,
        sellCount: 0,
        repeatCount: 0,
        uniqueEntities: 0,
        topHotTickers: [],
      },
    };
  }

  let buyValue = 0;
  let sellValue = 0;
  let buyCount = 0;
  let sellCount = 0;
  const entityCounts = new Map<string, number>();

  for (const event of sectorEvents) {
    const value = midpoint(event);
    if (event.action === "BUY") {
      buyValue += value;
      buyCount += 1;
    } else {
      sellValue += value;
      sellCount += 1;
    }
    const entity = event.entity_name ?? "Unknown";
    entityCounts.set(entity, (entityCounts.get(entity) ?? 0) + 1);
  }

  const repeatCount = Array.from(entityCounts.values()).reduce((acc, count) => acc + Math.max(0, count - 1), 0);
  const uniqueEntities = entityCounts.size;
  const totalValue = buyValue + sellValue;
  const netValue = buyValue - sellValue;
  const directionScore = totalValue === 0 ? 0.5 : (netValue / totalValue + 1) / 2; // 0..1
  const magnitudeScore = totalValue <= 0 ? 0 : Math.min(1, Math.log10(Math.max(totalValue, 1)) / 9); // 1B -> ~1
  const repeatScore = uniqueEntities === 0 ? 0 : Math.min(1, repeatCount / uniqueEntities);
  const blendedScore = Math.max(0, Math.min(1, directionScore * 0.55 + magnitudeScore * 0.3 + repeatScore * 0.15));
  const score = Math.round(blendedScore * 100);

  const topHotTickers = computeHotTickers(sectorEvents).slice(0, MAX_HOT_TICKERS);
  const sentiment = netValue > 0 ? "net buying" : netValue < 0 ? "net selling" : "balanced flow";
  const summary = [
    `${sentiment} (${buyCount}B/${sellCount}S)`,
    `${formatDollars(totalValue)} disclosed`,
    repeatCount > 0 ? `${repeatCount} repeat filers` : `${uniqueEntities} unique filers`,
    topHotTickers.length ? `Hot tickers: ${topHotTickers.map((t) => t.ticker).join(", ")}` : "No standout tickers",
  ].join(" • ");

  return {
    score,
    summary,
    stats: {
      buyValue,
      sellValue,
      totalValue,
      buyCount,
      sellCount,
      repeatCount,
      uniqueEntities,
      topHotTickers,
    },
  };
}

function computeHotTickers(events: DisclosureEvent[]): HotTicker[] {
  const perTicker = new Map<
    string,
    {
      buyValue: number;
      sellValue: number;
      buyCount: number;
      sellCount: number;
      entities: Set<string>;
    }
  >();

  for (const event of events) {
    if (!event.ticker) continue;
    const stats = perTicker.get(event.ticker) ?? {
      buyValue: 0,
      sellValue: 0,
      buyCount: 0,
      sellCount: 0,
      entities: new Set<string>(),
    };
    const value = midpoint(event);
    if (event.action === "BUY") {
      stats.buyValue += value;
      stats.buyCount += 1;
    } else {
      stats.sellValue += value;
      stats.sellCount += 1;
    }
    stats.entities.add(event.entity_name ?? "Unknown");
    perTicker.set(event.ticker, stats);
  }

  const hotTickers: HotTicker[] = [];
  for (const [ticker, stats] of perTicker.entries()) {
    const netFlow = stats.buyValue - stats.sellValue;
    const totalValue = stats.buyValue + stats.sellValue;
    if (netFlow <= 0 || totalValue <= 0) continue; // focus on heating up (net positive)
    const score = Math.round(Math.min(1, netFlow / totalValue) * 100);
    hotTickers.push({
      ticker,
      netFlow,
      totalValue,
      buyCount: stats.buyCount,
      sellCount: stats.sellCount,
      score,
      topEntities: Array.from(stats.entities).slice(0, 3),
    });
  }

  return hotTickers.sort((a, b) => {
    if (b.score === a.score) {
      return b.netFlow - a.netFlow;
    }
    return b.score - a.score;
  });
}

function windowBounds(windowDays: 7 | 30): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date(end.getTime() - windowDays * 24 * 60 * 60 * 1000);
  return { start, end };
}

export const ThemeEngine = {
  computeThemes(windowDays: 7 | 30, options?: ThemeEngineOptions): ThemeComputationResult {
    const { start, end } = windowBounds(windowDays);
    const windowStart = start.toISOString();
    const windowEnd = end.toISOString();

    const sourceEvents = options?.events
      ? options.events
      : PublicFlowRepo.queryRecentDisclosureEvents(options?.limit ?? DEFAULT_LIMIT, windowStart);

    const windowEvents = sourceEvents.filter((evt) => evt.report_date >= windowStart && evt.report_date <= windowEnd);
    const enriched = enrichEvents(windowEvents as any) as DisclosureEvent[];

    const grouped = new Map<string, DisclosureEvent[]>();
    for (const event of enriched) {
      const sector = event.sector ?? "Unknown";
      if (!grouped.has(sector)) {
        grouped.set(sector, []);
      }
      grouped.get(sector)!.push(event);
    }

    const inserts: InsertSectorTheme[] = [];
    const perSectorStats: Array<{ sector: string; metrics: ReturnType<typeof calcScore> }> = [];

    for (const [sector, sectorEvents] of grouped.entries()) {
      const metrics = calcScore(sectorEvents);
      inserts.push({
        window_days: windowDays,
        window_start: windowStart,
        window_end: windowEnd,
        sector,
        score: metrics.score,
        summary: `${sector}: ${metrics.summary}`,
        created_at: new Date().toISOString(),
      });
      perSectorStats.push({ sector, metrics });
    }

    const ids = inserts.length ? PublicFlowRepo.upsertSectorThemes(inserts) : [];
    const themes: ThemeDetail[] = perSectorStats.map((entry, idx) => ({
      id: ids[idx] ?? 0,
      sector: entry.sector,
      window_days: windowDays,
      window_start: windowStart,
      window_end: windowEnd,
      score: entry.metrics.score,
      summary: `${entry.sector}: ${entry.metrics.summary}`,
      eventCount: grouped.get(entry.sector)?.length ?? 0,
      totalValue: entry.metrics.stats.totalValue,
      hotTickers: entry.metrics.stats.topHotTickers,
    }));

    console.log(
      `[ThemeEngine] Computed ${themes.length} sector themes for ${windowDays}d window (events: ${windowEvents.length}).`
    );

    return {
      windowDays,
      windowStart,
      windowEnd,
      themes: themes.sort((a, b) => b.score - a.score),
    };
  },
};

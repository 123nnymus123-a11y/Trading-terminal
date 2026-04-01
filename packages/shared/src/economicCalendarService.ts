/**
 * Economic Calendar Service
 * Orchestrates data fetching from multiple sources, deduplication, and AI enrichment
 */

import { getMainEnv } from "./env.js";
import type { MainEnv } from "./env.js";
import {
  AdapterConfidence,
  EconomicEvent,
  CalendarFilters,
  FetcherConfig,
  EventSource,
} from "./economicCalendar.js";
import type { FetcherResult } from "./economicCalendar.js";
import {
  fredAdapter,
  blsAdapter,
  beaAdapter,
  censusAdapter,
  tradingEconomicsAdapter,
  finnhubAdapter,
  alphaVantageAdapter,
} from "./economicCalendarAdapters.js";
import { createLogger } from "./logger.js";

const logger = createLogger({ scope: "EconomicCalendarService" });

// In-memory cache (consider upgrading to Redis/DB for production)
const eventCache = new Map<string, EconomicEvent>();
const lastFetchTime = new Map<string, number>();

const SOURCE_CONFIDENCE: Record<EventSource["name"], number> = {
  FRED: 0.92,
  BLS: 0.9,
  BEA: 0.88,
  Census: 0.8,
  TradingEconomics: 0.75,
  Finnhub: 0.7,
  AlphaVantage: 0.65,
  ECB: 0.85,
  Other: 0.5,
};

interface AdapterConfig {
  name: string;
  enabled: boolean;
  fetcher: (config: FetcherConfig) => Promise<FetcherResult>;
}

/**
 * Generate unique event ID based on content (for deduplication)
 */
function generateEventId(event: EconomicEvent): string {
  const key = `${event.country}-${event.title}-${event.releaseDateTime.toISOString()}`;
  return `event-${Buffer.from(key).toString("base64").slice(0, 16)}`;
}

/**
 * Fetch and normalize events from all enabled sources
 */
export async function fetchEconomicEvents(): Promise<EconomicEvent[]> {
  const env = getMainEnv();
  logger.info("🔑 API Keys loaded:", {
    fred: !!env.FRED_API_KEY,
    bls: !!env.BLS_API_KEY,
    bea: !!env.BEA_API_KEY,
    census: !!env.CENSUS_API_KEY,
    tradingEconomics: !!env.TRADING_ECONOMICS_KEY,
    finnhub: !!env.FINNHUB_API_KEY,
    alphaVantage: !!env.ALPHA_VANTAGE_API_KEY,
  });

  // Define all adapters with config from env
  const adapters: AdapterConfig[] = [
    {
      name: "FRED",
      enabled: !!env.FRED_API_KEY,
      fetcher: (cfg) => fredAdapter.fetch(cfg),
    },
    {
      name: "BLS",
      enabled: !!env.BLS_API_KEY,
      fetcher: (cfg) => blsAdapter.fetch(cfg),
    },
    {
      name: "BEA",
      enabled: !!env.BEA_API_KEY,
      fetcher: (cfg) => beaAdapter.fetch(cfg),
    },
    {
      name: "Census",
      enabled: !!env.CENSUS_API_KEY,
      fetcher: (cfg) => censusAdapter.fetch(cfg),
    },
    {
      name: "TradingEconomics",
      enabled: !!env.TRADING_ECONOMICS_KEY,
      fetcher: (cfg) => tradingEconomicsAdapter.fetch(cfg),
    },
    {
      name: "Finnhub",
      enabled: !!env.FINNHUB_API_KEY,
      fetcher: (cfg) => finnhubAdapter.fetch(cfg),
    },
    {
      name: "AlphaVantage",
      enabled: !!env.ALPHA_VANTAGE_API_KEY,
      fetcher: (cfg) => alphaVantageAdapter.fetch(cfg),
    },
  ];

  const allEvents: EconomicEvent[] = [];
  const fetchErrors: string[] = [];

  // Fetch from each enabled source
  for (const adapter of adapters) {
    if (!adapter.enabled) {
      logger.debug(`${adapter.name} adapter disabled (no API key)`);
      continue;
    }

    try {
      const lastFetch = lastFetchTime.get(adapter.name) || 0;
      const now = Date.now();

      // Skip if fetched recently (rate limiting)
      if (now - lastFetch < 60000) {
        logger.debug(`${adapter.name} rate limited, skipping`);
        continue;
      }

      const config = getAdapterConfig(adapter.name, env);
      const result = await adapter.fetcher(config);

      lastFetchTime.set(adapter.name, now);

      if (result.errors) {
        fetchErrors.push(`${adapter.name}: ${result.errors.join(", ")}`);
      }

      allEvents.push(...result.events);
      logger.info(
        `Fetched ${result.events.length} events from ${adapter.name}`,
      );
    } catch (error) {
      const msg = `${adapter.name} fetch failed: ${error}`;
      fetchErrors.push(msg);
      logger.error(msg);
    }
  }

  if (fetchErrors.length > 0) {
    logger.warn(`Fetch errors: ${fetchErrors.join("; ")}`);
  }

  // Deduplicate events
  const deduped = deduplicateEvents(allEvents);
  const enriched = deduped.map(applyEventPostProcessing);

  // Cache events
  for (const event of enriched) {
    eventCache.set(event.id, event);
  }

  logger.info(`Cached ${enriched.length} events total after deduplication`);

  return enriched;
}

/**
 * Deduplicate events by (country, title, datetime)
 * Prefers sources with more data (e.g., Trading Economics over generic US data)
 */
function deduplicateEvents(events: EconomicEvent[]): EconomicEvent[] {
  const seen = new Map<string, EconomicEvent>();

  for (const event of events) {
    const key = `${event.country}-${event.title}-${event.releaseDateTime.toISOString()}`;

    if (!seen.has(key)) {
      event.id = generateEventId(event);
      seen.set(key, event);
    } else {
      const existing = seen.get(key)!;
      // Prefer event with more data (forecast + previous + actual)
      const existingDataPoints = [
        existing.forecastValue,
        existing.previousValue,
        existing.actualValue,
      ].filter((v) => v !== null && v !== undefined).length;
      const newDataPoints = [
        event.forecastValue,
        event.previousValue,
        event.actualValue,
      ].filter((v) => v !== null && v !== undefined).length;

      if (newDataPoints > existingDataPoints) {
        event.id = generateEventId(event);
        existing.sources.push(...event.sources);
        seen.set(key, event);
      } else {
        existing.sources.push(...event.sources);
      }
    }
  }

  return Array.from(seen.values());
}

/**
 * Get adapter configuration from environment
 */
function getAdapterConfig(adapterName: string, env: MainEnv): FetcherConfig {
  const configs: Record<string, FetcherConfig> = {
    FRED: {
      enabled: !!env.FRED_API_KEY,
      ...(env.FRED_API_KEY ? { apiKey: env.FRED_API_KEY } : {}),
    },
    BLS: {
      enabled: !!env.BLS_API_KEY,
      ...(env.BLS_API_KEY ? { apiKey: env.BLS_API_KEY } : {}),
    },
    BEA: {
      enabled: !!env.BEA_API_KEY,
      ...(env.BEA_API_KEY ? { apiKey: env.BEA_API_KEY } : {}),
    },
    Census: {
      enabled: !!env.CENSUS_API_KEY,
      ...(env.CENSUS_API_KEY ? { apiKey: env.CENSUS_API_KEY } : {}),
    },
    TradingEconomics: {
      enabled: !!env.TRADING_ECONOMICS_KEY,
      ...(env.TRADING_ECONOMICS_KEY
        ? { apiKey: env.TRADING_ECONOMICS_KEY }
        : {}),
      ...(env.TRADING_ECONOMICS_SECRET
        ? { secret: env.TRADING_ECONOMICS_SECRET }
        : {}),
    },
    Finnhub: {
      enabled: !!env.FINNHUB_API_KEY,
      ...(env.FINNHUB_API_KEY ? { apiKey: env.FINNHUB_API_KEY } : {}),
      ...(env.FINNHUB_SECRET ? { secret: env.FINNHUB_SECRET } : {}),
    },
    AlphaVantage: {
      enabled: !!env.ALPHA_VANTAGE_API_KEY,
      ...(env.ALPHA_VANTAGE_API_KEY
        ? { apiKey: env.ALPHA_VANTAGE_API_KEY }
        : {}),
    },
  };

  return configs[adapterName] || { enabled: false };
}

/**
 * Query cached events by filters
 */
export function queryEconomicEvents(
  filters?: CalendarFilters,
): EconomicEvent[] {
  let events = Array.from(eventCache.values());

  if (!filters) {
    return events.sort(
      (a, b) => b.releaseDateTime.getTime() - a.releaseDateTime.getTime(),
    );
  }

  if (filters.startDate) {
    events = events.filter((e) => e.releaseDateTime >= filters.startDate!);
  }
  if (filters.endDate) {
    events = events.filter((e) => e.releaseDateTime <= filters.endDate!);
  }
  if (filters.countries && filters.countries.length > 0) {
    events = events.filter((e) => filters.countries!.includes(e.country));
  }
  if (filters.categories && filters.categories.length > 0) {
    events = events.filter((e) =>
      filters.categories!.includes(e.eventCategory),
    );
  }
  if (filters.importance) {
    events = events.filter((e) => e.importance >= filters.importance!);
  }
  if (filters.status) {
    events = events.filter((e) => e.status === filters.status!);
  }

  return events.sort(
    (a, b) => b.releaseDateTime.getTime() - a.releaseDateTime.getTime(),
  );
}

/**
 * Enrich event with AI-generated summary (e.g., using Claude, GPT)
 * Placeholder for LLM integration
 */
export async function enrichEventWithAI(
  event: EconomicEvent,
): Promise<EconomicEvent> {
  // TODO: Integrate with LLM (Claude, GPT, etc.)
  // For now, generate simple text summary

  if (
    typeof event.actualValue === "number" &&
    typeof event.forecastValue === "number"
  ) {
    const change = event.actualValue - event.forecastValue;
    const verb = change > 0 ? "beat" : change < 0 ? "missed" : "met";
    event.summary = `${event.title} ${verb} forecast by ${Math.abs(change).toFixed(2)} ${event.unit || ""}`;
    event.changeVsForcast = change;
  }

  if (
    typeof event.actualValue === "number" &&
    typeof event.previousValue === "number"
  ) {
    event.changeVsPrevious = event.actualValue - event.previousValue;
  }

  return event;
}

function applyEventPostProcessing(event: EconomicEvent): EconomicEvent {
  if (
    typeof event.actualValue === "number" &&
    typeof event.forecastValue === "number" &&
    typeof event.changeVsForcast !== "number"
  ) {
    event.changeVsForcast = event.actualValue - event.forecastValue;
  }
  if (
    typeof event.actualValue === "number" &&
    typeof event.previousValue === "number" &&
    typeof event.changeVsPrevious !== "number"
  ) {
    event.changeVsPrevious = event.actualValue - event.previousValue;
  }

  const adapterConfidence = buildAdapterConfidence(event);
  const completenessBoost =
    (typeof event.actualValue === "number" ? 0.25 : 0) +
    (typeof event.forecastValue === "number" ? 0.15 : 0) +
    (typeof event.previousValue === "number" ? 0.1 : 0);
  const statusBoost =
    event.status === "released" ? 0.1 : event.status === "revised" ? 0.05 : 0;
  const importanceBoost = (event.importance / 3) * 0.2;
  const sourceBoost =
    adapterConfidence.reduce((sum, entry) => sum + entry.score, 0) /
    Math.max(adapterConfidence.length, 1);
  const multiSourceBoost = event.sources.length > 1 ? 0.05 : 0;

  const rawScore =
    0.2 +
    completenessBoost +
    statusBoost +
    importanceBoost +
    multiSourceBoost +
    sourceBoost * 0.3;

  const clamped = clamp(rawScore, 0, 0.99);
  event.confidenceScore = Number(clamped.toFixed(3));
  event.confidenceLabel = describeConfidence(clamped);
  event.adapterConfidence = adapterConfidence;

  return event;
}

function buildAdapterConfidence(event: EconomicEvent): AdapterConfidence[] {
  return event.sources.map((source: EventSource) => {
    const base: number =
      SOURCE_CONFIDENCE[source.name] ?? SOURCE_CONFIDENCE.Other;
    const latencyFactor = source.latencyMs
      ? clamp(1 - Math.min(source.latencyMs / 120000, 1), 0.2, 1)
      : 0.85;
    const hint =
      typeof source.confidenceHint === "number" ? source.confidenceHint : 1;
    const score = clamp(base * 0.6 + latencyFactor * 0.3 + hint * 0.1, 0, 1);
    const reason = `Feed ${source.name} refreshed ${source.latencyMs ? `${Math.round(source.latencyMs)}ms` : "recently"}`;
    return {
      source: source.name,
      score: Number(score.toFixed(3)),
      reason,
    };
  });
}

function describeConfidence(
  score: number,
): "critical" | "high" | "medium" | "low" {
  if (score >= 0.85) return "critical";
  if (score >= 0.65) return "high";
  if (score >= 0.45) return "medium";
  return "low";
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Force refresh cached events (bypass TTL)
 */
export async function refreshEconomicEvents(): Promise<EconomicEvent[]> {
  logger.info("Forcing refresh of all economic events");
  eventCache.clear();
  lastFetchTime.clear();
  return fetchEconomicEvents();
}

/**
 * Get event by ID
 */
export function getEventById(id: string): EconomicEvent | undefined {
  return eventCache.get(id);
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
  return {
    cachedEvents: eventCache.size,
    lastUpdates: Object.fromEntries(lastFetchTime),
  };
}

// Initialize: fetch on module load (optional, can be triggered manually)
let initialized = false;

export async function initializeEconomicCalendar() {
  if (initialized) {
    logger.debug("Economic calendar already initialized");
    return;
  }

  logger.info("Initializing economic calendar service");
  try {
    await fetchEconomicEvents();
    initialized = true;
  } catch (error) {
    logger.error("Failed to initialize economic calendar:", error);
    throw error;
  }
}

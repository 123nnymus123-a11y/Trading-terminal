import type { ValuationTag, PriceProvider, FundamentalsProvider, Fundamentals } from "@tc/shared";
import { computeValuationTag } from "./valuation";
import { createLogger } from "@tc/shared";
import * as path from "node:path";
import * as fs from "node:fs";

const logger = createLogger({ scope: "valuation" });

/**
 * Seed data structure for valuation fundamentals.
 */
interface SeedValuationData {
  comment: string;
  tickers: Record<string, {
    ticker: string;
    price: number;
    eps_ttm?: number;
    fcf_per_share?: number;
    revenue_growth_yoy?: number;
  }>;
}

/**
 * In-memory cache for valuation tags.
 */
interface ValuationCache {
  tags: Record<string, ValuationTag>;
  timestamp: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let cache: ValuationCache | null = null;
let providerCache: ProviderSet | null = null;

interface ProviderSet {
  priceProvider: PriceProvider;
  fundamentalsProvider: FundamentalsProvider;
  mode: "seed" | "live";
}

/**
 * Load seed valuation data from JSON file.
 */
function loadSeedData(): SeedValuationData {
  const seedPath = path.join(__dirname, "data", "seed_valuation.json");
  
  if (!fs.existsSync(seedPath)) {
    logger.warn(`[valuation] Seed data not found at ${seedPath}`);
    return { comment: "", tickers: {} };
  }

  const raw = fs.readFileSync(seedPath, "utf-8");
  return JSON.parse(raw) as SeedValuationData;
}

/**
 * Seed price provider - uses local seed data.
 */
class SeedPriceProvider implements PriceProvider {
  private data: SeedValuationData;

  constructor() {
    this.data = loadSeedData();
  }

  async getLatestPrice(ticker: string): Promise<number | null> {
    const entry = this.data.tickers[ticker];
    return entry?.price ?? null;
  }
}

/**
 * Seed fundamentals provider - uses local seed data.
 */
class SeedFundamentalsProvider implements FundamentalsProvider {
  private data: SeedValuationData;

  constructor() {
    this.data = loadSeedData();
  }

  async getFundamentals(ticker: string): Promise<Fundamentals | null> {
    const entry = this.data.tickers[ticker];
    if (!entry) return null;

    const fundamentals: Fundamentals = { ticker: entry.ticker };
    if (entry.eps_ttm != null) fundamentals.eps_ttm = entry.eps_ttm;
    if (entry.fcf_per_share != null) fundamentals.fcf_per_share = entry.fcf_per_share;
    if (entry.revenue_growth_yoy != null) fundamentals.revenue_growth_yoy = entry.revenue_growth_yoy;
    return fundamentals;
  }
}

function splitPath(pathValue: string): string[] {
  const parts: string[] = [];
  const raw = pathValue.split(".");
  for (const chunk of raw) {
    const match = chunk.match(/^([^[\]]+)(\[(\d+)\])?$/);
    if (!match) {
      parts.push(chunk);
      continue;
    }
    parts.push(match[1]!);
    if (match[3] !== undefined) parts.push(match[3]);
  }
  return parts.filter((p) => p.length > 0);
}

function getByPath(value: unknown, pathValue?: string): unknown {
  if (!pathValue) return value;
  const parts = splitPath(pathValue);
  let current: unknown = value;
  for (const key of parts) {
    if (current == null) return undefined;
    const index = Number(key);
    if (Number.isFinite(index) && Array.isArray(current)) {
      current = current[index];
      continue;
    }
    if (typeof current === "object" && current !== null && key in current) {
      current = (current as Record<string, unknown>)[key];
      continue;
    }
    return undefined;
  }
  return current;
}

function resolveNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

async function fetchJson(url: string, timeoutMs = 12_000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText} - ${body.slice(0, 500)}`);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

function interpolate(template: string, ticker: string): string {
  return template.replaceAll("{ticker}", ticker.toUpperCase());
}

class LivePriceProvider implements PriceProvider {
  private endpoint = process.env.PUBLIC_FLOW_PRICE_ENDPOINT ?? "";
  private valuePath = process.env.PUBLIC_FLOW_PRICE_JSON_PATH ?? "";

  async getLatestPrice(ticker: string): Promise<number | null> {
    if (!this.endpoint) return null;
    try {
      const url = interpolate(this.endpoint, ticker);
      const json = await fetchJson(url);
      const raw = this.valuePath ? getByPath(json, this.valuePath) : json;
      return resolveNumber(raw);
    } catch (err) {
      logger.warn(`[valuation] live price failed for ${ticker}: ${(err as Error).message}`);
      return null;
    }
  }
}

class LiveFundamentalsProvider implements FundamentalsProvider {
  private endpoint = process.env.PUBLIC_FLOW_FUNDAMENTALS_ENDPOINT ?? "";
  private epsPath = process.env.PUBLIC_FLOW_FUNDAMENTALS_EPS_PATH ?? "";
  private fcfPath = process.env.PUBLIC_FLOW_FUNDAMENTALS_FCF_PATH ?? "";
  private revenueGrowthPath = process.env.PUBLIC_FLOW_FUNDAMENTALS_REVENUE_GROWTH_PATH ?? "";

  async getFundamentals(ticker: string): Promise<Fundamentals | null> {
    if (!this.endpoint) return null;
    try {
      const url = interpolate(this.endpoint, ticker);
      const json = await fetchJson(url);
      const eps = resolveNumber(this.epsPath ? getByPath(json, this.epsPath) : getByPath(json, "eps_ttm"));
      const fcf = resolveNumber(this.fcfPath ? getByPath(json, this.fcfPath) : getByPath(json, "fcf_per_share"));
      const growth = resolveNumber(
        this.revenueGrowthPath ? getByPath(json, this.revenueGrowthPath) : getByPath(json, "revenue_growth_yoy")
      );

      if (eps == null && fcf == null && growth == null) return null;

      const fundamentals: Fundamentals = { ticker };
      if (eps != null) fundamentals.eps_ttm = eps;
      if (fcf != null) fundamentals.fcf_per_share = fcf;
      if (growth != null) fundamentals.revenue_growth_yoy = growth;
      return fundamentals;
    } catch (err) {
      logger.warn(`[valuation] live fundamentals failed for ${ticker}: ${(err as Error).message}`);
      return null;
    }
  }
}

function resolveProviders(): ProviderSet {
  if (providerCache) return providerCache;

  const provider = (process.env.PUBLIC_FLOW_VALUATION_PROVIDER ?? "").toLowerCase();
  const mode = (process.env.PUBLIC_FLOW_VALUATION_MODE ?? (provider ? "live" : "seed")).toLowerCase() === "live" ? "live" : "seed";

  if (provider === "finnhub" && !process.env.PUBLIC_FLOW_PRICE_ENDPOINT && process.env.FINNHUB_API_KEY) {
    const token = process.env.FINNHUB_API_KEY;
    process.env.PUBLIC_FLOW_PRICE_ENDPOINT = `https://finnhub.io/api/v1/quote?symbol={ticker}&token=${token}`;
    process.env.PUBLIC_FLOW_PRICE_JSON_PATH = "c";
    process.env.PUBLIC_FLOW_FUNDAMENTALS_ENDPOINT = `https://finnhub.io/api/v1/stock/metric?symbol={ticker}&metric=all&token=${token}`;
    process.env.PUBLIC_FLOW_FUNDAMENTALS_EPS_PATH = "metric.epsTTM";
    process.env.PUBLIC_FLOW_FUNDAMENTALS_FCF_PATH = "metric.freeCashFlowPerShareTTM";
    process.env.PUBLIC_FLOW_FUNDAMENTALS_REVENUE_GROWTH_PATH = "metric.revenueGrowthTTM";
  }

  if (mode === "live" && process.env.PUBLIC_FLOW_PRICE_ENDPOINT && process.env.PUBLIC_FLOW_FUNDAMENTALS_ENDPOINT) {
    providerCache = {
      priceProvider: new LivePriceProvider(),
      fundamentalsProvider: new LiveFundamentalsProvider(),
      mode,
    };
    logger.info("[valuation] Using live price + fundamentals providers");
    return providerCache;
  }

  if (mode === "live") {
    logger.warn("[valuation] Live mode requested but endpoints missing; falling back to seed data");
  }

  providerCache = {
    priceProvider: new SeedPriceProvider(),
    fundamentalsProvider: new SeedFundamentalsProvider(),
    mode: "seed",
  };
  return providerCache;
}

/**
 * Check if cache is valid.
 */
function isCacheValid(): boolean {
  if (!cache) return false;
  const age = Date.now() - cache.timestamp;
  return age < CACHE_TTL_MS;
}

/**
 * Get valuation tags for a list of tickers.
 * Results are cached for a short TTL to avoid redundant computation.
 * 
 * @param tickers - Array of ticker symbols
 * @returns Record mapping ticker to ValuationTag (only includes tickers with data)
 */
export async function getValuationTags(tickers: string[]): Promise<Record<string, ValuationTag>> {
  const { priceProvider, fundamentalsProvider } = resolveProviders();
  // Check cache first
  if (isCacheValid() && cache) {
    const result: Record<string, ValuationTag> = {};
    for (const ticker of tickers) {
      if (cache.tags[ticker]) {
        result[ticker] = cache.tags[ticker];
      }
    }
    
    // If we have all requested tickers in cache, return immediately
    if (Object.keys(result).length === tickers.length) {
      logger.debug(`[valuation] Returning ${Object.keys(result).length} tags from cache`);
      return result;
    }
  }

  // Compute fresh tags
  logger.debug(`[valuation] Computing tags for ${tickers.length} tickers`);
  const results = await Promise.all(
    tickers.map((ticker) => computeValuationTag(ticker, priceProvider, fundamentalsProvider))
  );

  const tags: Record<string, ValuationTag> = {};
  results.forEach((tag) => {
    if (tag) {
      tags[tag.ticker] = tag;
    }
  });

  // Update cache
  cache = {
    tags,
    timestamp: Date.now(),
  };

  logger.info(`[valuation] Computed ${Object.keys(tags).length} valuation tags`);
  return tags;
}

/**
 * Get all supported tickers from seed data.
 */
export function getSupportedTickers(): string[] {
  const providers = resolveProviders();
  if (providers.mode === "live") {
    const envTickers = process.env.PUBLIC_FLOW_VALUATION_TICKERS ?? "";
    return envTickers
      .split(",")
      .map((t) => t.trim().toUpperCase())
      .filter((t) => t.length > 0);
  }
  const data = loadSeedData();
  return Object.keys(data.tickers);
}

/**
 * Clear the valuation cache (useful for testing or forced refresh).
 */
export function clearValuationCache(): void {
  cache = null;
  providerCache = null;
  logger.debug("[valuation] Cache cleared");
}

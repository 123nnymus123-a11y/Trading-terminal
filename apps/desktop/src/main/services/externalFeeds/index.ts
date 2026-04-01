import { app } from "electron";
import path from "node:path";
import fs from "node:fs";
import { CacheStore } from "./cacheStore";
import {
  buildPositioningSeries,
  loadCotMapping,
} from "./adapters/cftcCotAdapter";
import { fetchJoltsSeries } from "./adapters/blsJoltsAdapter";
import { fetchSecEvents } from "./adapters/secEdgarAdapter";
import {
  defaultExternalFeedsConfig,
  runProviderTest,
} from "./providerRegistry";
import type {
  ExternalFeedsConfig,
  EventStreamItem,
  MacroSeries,
  PositioningSeries,
} from "./types";
import { getSecret } from "../../secrets";
import { getMainEnv } from "@tc/shared/env";
type SettingsRepo = {
  get(): Record<string, unknown>;
  set(next: Record<string, unknown>): void;
};

const JOLTS_SERIES = [
  "JTS000000000000000JOL",
  "JTS000000000000000HIL",
  "JTS000000000000000QUL",
  "JTS000000000000000LDL",
];

export class ExternalFeedsService {
  private cache: CacheStore;
  private config: ExternalFeedsConfig;

  constructor(private settingsRepo: SettingsRepo) {
    const cacheDir = path.join(app.getPath("userData"), "external-feeds");
    this.cache = new CacheStore(cacheDir);
    this.config = this.loadConfig();
  }

  getConfig() {
    return this.config;
  }

  setConfig(next: ExternalFeedsConfig) {
    this.config = { ...defaultExternalFeedsConfig(), ...next };
    const settings = this.settingsRepo.get();
    this.settingsRepo.set({ ...settings, externalFeeds: this.config });
    return this.config;
  }

  async testProvider(
    providerId: "CFTC_COT" | "BLS_JOLTS" | "SEC_EDGAR",
    credentials?: Record<string, string>,
  ) {
    return runProviderTest(providerId, { config: this.config, credentials });
  }

  async getCotSummary(symbols: string[]): Promise<PositioningSeries[]> {
    if (!this.config.enabled.cftc) return [];
    const cacheKey = "cftc:summary";
    const cached = this.cache.get<PositioningSeries[]>(cacheKey);
    if (cached) return filterSymbols(cached, symbols);

    const mapping = await loadCotMapping(this.config.cftc?.mappingPath);
    const series = await buildPositioningSeries({
      mapping,
      samplePath: this.config.cftc?.sampleZipPath,
    });
    this.cache.set(cacheKey, series, 24 * 60 * 60 * 1000);
    return filterSymbols(series, symbols);
  }

  async getJoltsSeries(opts?: {
    forceRefresh?: boolean;
  }): Promise<MacroSeries[]> {
    const apiKey = await this.resolveBlsKey();
    // Run whenever a key is available — env key works even if enabled.bls is false
    if (!apiKey) return [];
    const cacheKey = "bls:jolts";
    if (!opts?.forceRefresh) {
      const cached = this.cache.get<MacroSeries[]>(cacheKey);
      if (cached) return cached;
    }

    const series = await fetchJoltsSeries({
      apiKey,
      seriesIds: JOLTS_SERIES,
    });

    this.cache.set(cacheKey, series, 4 * 60 * 60 * 1000); // 4-hour cache
    return series;
  }

  async getSecEvents(params: {
    tickers?: string[];
    limit?: number;
  }): Promise<EventStreamItem[]> {
    if (!this.config.enabled.sec) return [];

    const cacheKey = "sec:events";
    const cached = this.cache.get<EventStreamItem[]>(cacheKey);
    if (cached) return filterEvents(cached, params);

    const processedKey = "sec:processedUrls";
    const processedList = this.cache.get<string[]>(processedKey) ?? [];
    const processed = new Set(processedList);

    const events = await fetchSecEvents({
      forms: ["4", "8-K"],
      // Use a robust default User-Agent to avoid SEC blocking generic clients
      userAgent:
        this.config.sec?.userAgent ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 TradingCockpit/1.0",
      cikMappingPath: this.config.sec?.cikMappingPath,
      limit: params.limit ?? 100,
      tickers: params.tickers,
    });

    const fresh = events.filter((e) => !processed.has(e.url));
    fresh.forEach((e) => processed.add(e.url));

    const merged = [...fresh, ...(cached ?? [])].sort((a, b) =>
      b.filedAt.localeCompare(a.filedAt),
    );

    this.cache.set(cacheKey, merged, 5 * 60 * 1000);
    this.cache.set(
      processedKey,
      Array.from(processed).slice(0, 1000),
      7 * 24 * 60 * 60 * 1000,
    );
    return filterEvents(merged, params);
  }

  private loadConfig(): ExternalFeedsConfig {
    const settings = this.settingsRepo.get();
    const saved = (settings?.externalFeeds ??
      null) as ExternalFeedsConfig | null;
    const base = saved
      ? { ...defaultExternalFeedsConfig(), ...saved }
      : defaultExternalFeedsConfig();
    const detected = this.detectRepoTradingDataPaths(base);
    // If we detected new paths not present before, persist them for next launch
    if (JSON.stringify(base) !== JSON.stringify(detected)) {
      this.settingsRepo.set({ ...settings, externalFeeds: detected });
    }
    return detected;
  }

  // Auto-detect repo-local TradingData files if paths are missing.
  // This helps when the user moves data into the repository.
  private detectRepoTradingDataPaths(
    cfg: ExternalFeedsConfig,
  ): ExternalFeedsConfig {
    try {
      // repoRoot: ../../ from apps/desktop working dir
      const repoRoot = path.resolve(process.cwd(), "..", "..");
      const dataDir = path.join(repoRoot, "TradingData");

      const next: ExternalFeedsConfig = { ...cfg };

      // CFTC mapping (set if missing OR broken)
      const currentMapping = next.cftc?.mappingPath;
      if (
        !currentMapping ||
        (typeof currentMapping === "string" && !fs.existsSync(currentMapping))
      ) {
        const mapping = path.join(dataDir, "cot_mapping.csv");
        if (fs.existsSync(mapping)) {
          next.cftc = {
            ...(next.cftc ?? {}),
            mappingPath: mapping,
            sampleZipPath: next.cftc?.sampleZipPath,
          };
        }
      }

      // CFTC sample ZIP (set if missing OR broken)
      const currentZip = next.cftc?.sampleZipPath;
      if (
        !currentZip ||
        (typeof currentZip === "string" && !fs.existsSync(currentZip))
      ) {
        const zipPath = path.join(dataDir, "cftc_latest.zip");
        if (fs.existsSync(zipPath)) {
          next.cftc = {
            ...(next.cftc ?? {}),
            mappingPath: next.cftc?.mappingPath,
            sampleZipPath: zipPath,
          };
        }
      }

      // SEC CIK mapping (set if missing OR broken)
      const currentCik = next.sec?.cikMappingPath;
      if (
        !currentCik ||
        (typeof currentCik === "string" && !fs.existsSync(currentCik))
      ) {
        const cik = path.join(dataDir, "cik_ticker_mapping.csv");
        if (fs.existsSync(cik)) {
          next.sec = { ...(next.sec ?? {}), cikMappingPath: cik };
        }
      }

      return next;
    } catch {
      // If anything fails, return original config
      return cfg;
    }
  }

  private async resolveBlsKey(): Promise<string | null> {
    // 1. Try configured secrets-store account
    const account = this.config.bls?.apiKeyAccount;
    if (account) {
      const secret = await getSecret(account);
      if (secret) return secret;
    }
    // 2. Fall back to BLS_API_KEY env var (set in .env.local)
    return getMainEnv().BLS_API_KEY ?? null;
  }
}

function filterSymbols(series: PositioningSeries[], symbols: string[]) {
  if (!symbols.length) return series;
  const set = new Set(symbols.map((s) => s.toUpperCase()));
  return series.filter((s) => set.has(s.symbol.toUpperCase()));
}

function filterEvents(
  events: EventStreamItem[],
  params: { tickers?: string[]; limit?: number },
) {
  let filtered = events;
  if (params.tickers && params.tickers.length) {
    const set = new Set(params.tickers.map((t) => t.toUpperCase()));
    filtered = filtered.filter(
      (e) => e.ticker && set.has(e.ticker.toUpperCase()),
    );
  }
  if (typeof params.limit === "number") {
    filtered = filtered.slice(0, params.limit);
  }
  return filtered;
}

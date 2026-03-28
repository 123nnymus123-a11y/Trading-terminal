// Historical market data provider abstraction
// For v1, we support CSV/JSON based snapshots stored in filesystem
// Can be extended to support live feeds, databases, etc.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { isAbsolute, resolve } from "node:path";
import type { Pool } from "pg";

export type OHLCVBar = {
  timestamp: string;
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type HistoricalDataSnapshot = {
  snapshotId: string;
  name: string;
  version: string;
  createdAt: string;
  bars: Map<string, OHLCVBar[]>;
  symbols: Set<string>;
};

export interface IHistoricalDataProvider {
  loadSnapshot(snapshotId: string): Promise<HistoricalDataSnapshot | null>;
  getAvailableSnapshots(): Promise<string[]>;
  getBarsForSymbol(
    snapshot: HistoricalDataSnapshot,
    symbol: string,
  ): OHLCVBar[];
}

export class FileSystemHistoricalDataProvider implements IHistoricalDataProvider {
  constructor(private readonly dataDir: string) {}

  async loadSnapshot(
    snapshotId: string,
  ): Promise<HistoricalDataSnapshot | null> {
    try {
      const filePath = join(this.dataDir, `${snapshotId}.json`);
      if (!existsSync(filePath)) {
        return null;
      }

      const content = readFileSync(filePath, "utf-8");
      const data = JSON.parse(content);

      const bars = new Map<string, OHLCVBar[]>();
      const symbols = new Set<string>();

      if (Array.isArray(data.bars)) {
        for (const bar of data.bars) {
          symbols.add(bar.symbol);
          if (!bars.has(bar.symbol)) {
            bars.set(bar.symbol, []);
          }
          bars.get(bar.symbol)!.push(bar);
        }
        // Sort each symbol's bars by timestamp
        for (const barList of bars.values()) {
          barList.sort(
            (a, b) =>
              new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
          );
        }
      }

      return {
        snapshotId,
        name: data.name ?? snapshotId,
        version: data.version ?? "1.0",
        createdAt: data.createdAt ?? new Date().toISOString(),
        bars,
        symbols,
      };
    } catch (error) {
      throw new Error(
        `Failed to load snapshot ${snapshotId}: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }

  async getAvailableSnapshots(): Promise<string[]> {
    // For v1, return empty - snapshots are referenced by ID
    // In future, this could list available files in dataDir
    return [];
  }

  getBarsForSymbol(
    snapshot: HistoricalDataSnapshot,
    symbol: string,
  ): OHLCVBar[] {
    return snapshot.bars.get(symbol) ?? [];
  }
}

export class DatabaseHistoricalDataProvider implements IHistoricalDataProvider {
  constructor(
    private readonly pool: Pool,
    private readonly dataDir: string,
  ) {}

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private toNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private normalizeBar(
    value: unknown,
    fallbackSymbol?: string,
  ): OHLCVBar | null {
    const row = this.asRecord(value);
    const symbolRaw =
      (typeof row.symbol === "string" && row.symbol.trim().length > 0
        ? row.symbol
        : fallbackSymbol) ?? "";
    const symbol = symbolRaw.trim().toUpperCase();
    const timestampRaw = row.timestamp ?? row.ts ?? row.date;
    const timestamp =
      typeof timestampRaw === "string" && timestampRaw.trim().length > 0
        ? timestampRaw.trim()
        : "";

    const open = this.toNumber(row.open);
    const high = this.toNumber(row.high);
    const low = this.toNumber(row.low);
    const close = this.toNumber(row.close);
    const volume = this.toNumber(row.volume);

    if (
      !symbol ||
      !timestamp ||
      open == null ||
      high == null ||
      low == null ||
      close == null ||
      volume == null
    ) {
      return null;
    }

    return {
      symbol,
      timestamp,
      open,
      high,
      low,
      close,
      volume,
    };
  }

  private parseBars(value: unknown): OHLCVBar[] {
    if (Array.isArray(value)) {
      return value
        .map((item) => this.normalizeBar(item))
        .filter((item): item is OHLCVBar => item !== null);
    }

    const record = this.asRecord(value);
    const directBars =
      record.bars ??
      record.inlineBars ??
      this.asRecord(record.inline).bars ??
      this.asRecord(record.data).bars;
    if (directBars !== undefined) {
      return this.parseBars(directBars);
    }

    const mapLike =
      record.barsBySymbol ??
      record.inlineBarsBySymbol ??
      this.asRecord(record.inline).barsBySymbol ??
      this.asRecord(record.data).barsBySymbol;
    if (mapLike && typeof mapLike === "object") {
      const bars: OHLCVBar[] = [];
      for (const [symbol, list] of Object.entries(mapLike)) {
        if (!Array.isArray(list)) {
          continue;
        }
        for (const item of list) {
          const normalized = this.normalizeBar(item, symbol);
          if (normalized) {
            bars.push(normalized);
          }
        }
      }
      return bars;
    }

    return [];
  }

  private resolveCandidatePaths(rawPath: string): string[] {
    if (isAbsolute(rawPath)) {
      return [rawPath];
    }
    return [resolve(this.dataDir, rawPath), resolve(process.cwd(), rawPath)];
  }

  private loadBarsFromFile(rawPath: string): OHLCVBar[] {
    for (const candidate of this.resolveCandidatePaths(rawPath)) {
      if (!existsSync(candidate)) {
        continue;
      }
      const content = readFileSync(candidate, "utf-8");
      const parsed = JSON.parse(content);
      const bars = this.parseBars(parsed);
      if (bars.length > 0) {
        return bars;
      }
    }
    return [];
  }

  private gatherBarsFromManifestAndLineage(
    sourceManifest: Record<string, unknown>,
    lineage: Record<string, unknown>,
  ): OHLCVBar[] {
    const candidates: unknown[] = [
      sourceManifest,
      sourceManifest.inline,
      sourceManifest.data,
      lineage,
      lineage.inline,
      lineage.data,
    ];

    const bars: OHLCVBar[] = [];
    for (const candidate of candidates) {
      const parsed = this.parseBars(candidate);
      if (parsed.length > 0) {
        bars.push(...parsed);
      }
    }

    const pathKeys = [
      "barsFile",
      "barsPath",
      "filePath",
      "path",
      "jsonPath",
      "uri",
    ] as const;

    const pathRecords = [
      sourceManifest,
      this.asRecord(sourceManifest.inline),
      lineage,
    ];
    for (const record of pathRecords) {
      for (const key of pathKeys) {
        const rawValue = record[key];
        if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
          continue;
        }
        if (/^(memory|http|https):\/\//i.test(rawValue)) {
          continue;
        }
        bars.push(...this.loadBarsFromFile(rawValue.trim()));
      }
    }

    return bars;
  }

  async loadSnapshot(
    snapshotId: string,
  ): Promise<HistoricalDataSnapshot | null> {
    try {
      const metaResult = await this.pool.query(
        `SELECT snapshot_id, dataset_name, dataset_version, snapshot_at, source_manifest
         FROM strategy_dataset_snapshots
         WHERE snapshot_id = $1`,
        [snapshotId],
      );

      const metaRow = metaResult.rows[0];
      if (!metaRow) {
        return null;
      }

      const manifestResult = await this.pool.query(
        `SELECT pit_cutoff_ts, lineage
         FROM market_snapshot_manifests
         WHERE snapshot_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [snapshotId],
      );
      const manifestRow = manifestResult.rows[0];

      const sourceManifest = this.asRecord(metaRow.source_manifest);
      const lineage = this.asRecord(manifestRow?.lineage);
      const allBars = this.gatherBarsFromManifestAndLineage(
        sourceManifest,
        lineage,
      );

      const pitCutoffTs =
        manifestRow?.pit_cutoff_ts != null
          ? new Date(String(manifestRow.pit_cutoff_ts)).getTime()
          : null;

      const filteredBars =
        pitCutoffTs == null
          ? allBars
          : allBars.filter(
              (bar) => new Date(bar.timestamp).getTime() <= pitCutoffTs,
            );

      const bars = new Map<string, OHLCVBar[]>();
      const symbols = new Set<string>();
      for (const bar of filteredBars) {
        symbols.add(bar.symbol);
        const existing = bars.get(bar.symbol) ?? [];
        existing.push(bar);
        bars.set(bar.symbol, existing);
      }
      for (const perSymbolBars of bars.values()) {
        perSymbolBars.sort(
          (a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        );
      }

      return {
        snapshotId: metaRow.snapshot_id,
        name: metaRow.dataset_name,
        version: metaRow.dataset_version,
        createdAt: metaRow.snapshot_at,
        bars,
        symbols,
      };
    } catch (error) {
      throw new Error(
        `Failed to load snapshot from database: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }

  async getAvailableSnapshots(): Promise<string[]> {
    const result = await this.pool.query(
      `SELECT snapshot_id FROM strategy_dataset_snapshots ORDER BY snapshot_at DESC LIMIT 10`,
    );
    return result.rows.map((row) => row.snapshot_id);
  }

  getBarsForSymbol(
    snapshot: HistoricalDataSnapshot,
    symbol: string,
  ): OHLCVBar[] {
    // Database provider stores bars in memory from loadSnapshot
    return snapshot.bars.get(symbol) ?? [];
  }
}

export class MockHistoricalDataProvider implements IHistoricalDataProvider {
  /**
   * Mock provider for testing - generates synthetic OHLCV data
   */
  async loadSnapshot(snapshotId: string): Promise<HistoricalDataSnapshot> {
    const bars = new Map<string, OHLCVBar[]>();
    const symbols = new Set(["AAPL", "MSFT", "GOOGL", "AMZN", "TSLA"]);

    // Generate 252 trading days of data (1 year)
    const barCount = 252;
    const startDate = new Date("2023-01-01");

    for (const symbol of symbols) {
      const symbolBars: OHLCVBar[] = [];
      let price = 100 + Math.random() * 200; // Starting price 100-300

      for (let i = 0; i < barCount; i++) {
        const date = new Date(startDate);
        date.setDate(date.getDate() + i);

        // Skip weekends
        if (date.getDay() === 0 || date.getDay() === 6) {
          continue;
        }

        // Generate realistic OHLCV values
        const dailyReturn = (Math.random() - 0.5) * 0.02; // ±1% daily return
        const openPrice = price;
        const closePrice = price * (1 + dailyReturn);
        const highPrice =
          Math.max(openPrice, closePrice) * (1 + Math.random() * 0.01);
        const lowPrice =
          Math.min(openPrice, closePrice) * (1 - Math.random() * 0.01);
        const volume = Math.floor(Math.random() * 10000000) + 1000000;

        symbolBars.push({
          timestamp: date.toISOString().split("T")[0]!,
          symbol,
          open: Math.round(openPrice * 100) / 100,
          high: Math.round(highPrice * 100) / 100,
          low: Math.round(lowPrice * 100) / 100,
          close: Math.round(closePrice * 100) / 100,
          volume,
        });

        price = closePrice;
      }

      bars.set(symbol, symbolBars);
    }

    return {
      snapshotId,
      name: "mock-data",
      version: "1.0",
      createdAt: new Date().toISOString(),
      bars,
      symbols,
    };
  }

  async getAvailableSnapshots(): Promise<string[]> {
    return ["mock-snapshot-1", "mock-snapshot-2"];
  }

  getBarsForSymbol(
    snapshot: HistoricalDataSnapshot,
    symbol: string,
  ): OHLCVBar[] {
    return snapshot.bars.get(symbol) ?? [];
  }
}

export function createHistoricalDataProvider(
  type: "filesystem" | "database" | "mock",
  config?: { dataDir?: string; pool?: Pool },
): IHistoricalDataProvider {
  if (type === "filesystem") {
    return new FileSystemHistoricalDataProvider(config?.dataDir ?? "./data");
  }
  if (type === "database" && config?.pool) {
    return new DatabaseHistoricalDataProvider(
      config.pool,
      config.dataDir ?? "./data",
    );
  }
  return new MockHistoricalDataProvider();
}

// Canonical Market Data Layer
//
// Implements all 8 requirements of the Canonical Market Data Layer checklist:
//   1. Versioned datasets with immutable IDs
//   2. Symbol mapping with historical alias changes
//   3. Corporate actions pipeline (splits / dividends)
//   4. Delistings and survivorship-bias controls
//   5. Exchange calendars and holidays per venue
//   6. Time-zone normalized bars and event timestamps
//   7. Point-in-time data access guarantees
//   8. Snapshot manifest + checksum lineage

import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { createLogger } from "../../logger.js";

const logger = createLogger("market-data-layer");

// ---------------------------------------------------------------------------
// 1) Versioned datasets with immutable IDs
// ---------------------------------------------------------------------------

export type DatasetVersionRecord = {
  datasetVersionId: string;
  tenantId: string;
  datasetName: string;
  versionTag: string;
  description: string;
  sourceUri: string;
  rowCount: number | null;
  dateRangeStart: string | null;
  dateRangeEnd: string | null;
  symbols: string[];
  checksums: Record<string, string>;
  isImmutable: boolean;
  createdAt: string;
};

export type CreateDatasetVersionInput = {
  tenantId?: string;
  datasetName: string;
  versionTag: string;
  description?: string;
  sourceUri?: string;
  rowCount?: number;
  dateRangeStart?: string;
  dateRangeEnd?: string;
  symbols: string[];
  checksums?: Record<string, string>;
};

// ---------------------------------------------------------------------------
// 2) Symbol mapping with historical alias changes
// ---------------------------------------------------------------------------

export type SymbolMappingRecord = {
  mappingId: string;
  tenantId: string;
  canonicalSymbol: string;
  alias: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  exchange: string | null;
  changeReason: string;
  createdAt: string;
};

export type CreateSymbolMappingInput = {
  tenantId?: string;
  canonicalSymbol: string;
  alias: string;
  effectiveFrom: string;
  effectiveTo?: string;
  exchange?: string;
  changeReason?: string;
};

// ---------------------------------------------------------------------------
// 3) Corporate actions pipeline (splits / dividends)
// ---------------------------------------------------------------------------

export type CorporateActionType =
  | "split"
  | "reverse_split"
  | "dividend"
  | "special_dividend"
  | "spinoff"
  | "merger"
  | "rights_issue";

export type CorporateActionRecord = {
  actionId: string;
  tenantId: string;
  datasetVersionId: string | null;
  symbol: string;
  actionType: CorporateActionType;
  effectiveDate: string;
  exDate: string | null;
  ratio: number | null;
  amount: number | null;
  currency: string;
  adjustedFlag: boolean;
  notes: string;
  source: string;
  createdAt: string;
};

export type CreateCorporateActionInput = {
  tenantId?: string;
  datasetVersionId?: string;
  symbol: string;
  actionType: CorporateActionType;
  effectiveDate: string;
  exDate?: string;
  ratio?: number;
  amount?: number;
  currency?: string;
  adjustedFlag?: boolean;
  notes?: string;
  source?: string;
};

// ---------------------------------------------------------------------------
// 4) Delistings and survivorship-bias controls
// ---------------------------------------------------------------------------

export type DelistingReason =
  | "bankruptcy"
  | "acquisition"
  | "merger"
  | "voluntary"
  | "regulatory"
  | "other";

export type DelistingRecord = {
  delistingId: string;
  tenantId: string;
  datasetVersionId: string | null;
  symbol: string;
  exchange: string | null;
  delistedOn: string;
  reason: DelistingReason;
  successorSymbol: string | null;
  notes: string;
  createdAt: string;
};

export type CreateDelistingInput = {
  tenantId?: string;
  datasetVersionId?: string;
  symbol: string;
  exchange?: string;
  delistedOn: string;
  reason: DelistingReason;
  successorSymbol?: string;
  notes?: string;
};

// ---------------------------------------------------------------------------
// 5) Exchange calendars and holidays per venue
// ---------------------------------------------------------------------------

export type EarlyClose = {
  date: string;
  close_time: string;
};

export type ExchangeCalendarRecord = {
  calendarId: string;
  tenantId: string;
  exchangeCode: string;
  calendarYear: number;
  timezone: string;
  sessionOpen: string;
  sessionClose: string;
  holidays: string[];
  earlyCloses: EarlyClose[];
  notes: string;
  createdAt: string;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// 6) Time-zone normalized bars and event timestamps (utility types)
// ---------------------------------------------------------------------------

export type NormalizedBar = {
  timestamp: string; // ISO-8601 UTC timestamp
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjustedClose?: number; // set after corporate-action adjustment
  timezone: string; // source timezone before normalization
  tradingDate: string; // YYYY-MM-DD in source exchange timezone
};

// ---------------------------------------------------------------------------
// 7) Point-in-time data access guarantees
// ---------------------------------------------------------------------------

export type PointInTimeQuery = {
  snapshotId: string;
  symbols: string[];
  asOfTimestamp: string; // Only return data knowable at this timestamp
  exchangeCode?: string;
  includeSurvivors?: boolean; // false = survivorship-bias-free (default)
};

// ---------------------------------------------------------------------------
// 8) Snapshot manifest + checksum lineage
// ---------------------------------------------------------------------------

export type SnapshotManifestRecord = {
  manifestId: string;
  tenantId: string;
  snapshotId: string;
  datasetVersionId: string | null;
  manifestVersion: number;
  symbols: string[];
  barCount: number | null;
  dateRangeStart: string | null;
  dateRangeEnd: string | null;
  timezone: string;
  checksumSha256: string;
  checksumAlgorithm: string;
  pitCutoffTs: string | null;
  lineage: Record<string, unknown>;
  createdAt: string;
};

export type CreateSnapshotManifestInput = {
  tenantId?: string;
  snapshotId: string;
  datasetVersionId?: string;
  symbols: string[];
  barCount?: number;
  dateRangeStart?: string;
  dateRangeEnd?: string;
  timezone?: string;
  bars: Array<{ timestamp: string; symbol: string; close: number }>;
  pitCutoffTs?: string;
  lineage?: Record<string, unknown>;
};

export type ManifestVerificationResult = {
  valid: boolean;
  expectedChecksum: string;
  actualChecksum: string;
  symbolCount: number;
  barCount: number | null;
};

// ---------------------------------------------------------------------------
// Market Data Layer class
// ---------------------------------------------------------------------------

export class MarketDataLayer {
  constructor(private readonly pool: Pool) {}

  private resolveTenant(tenantId?: string): string {
    return tenantId && tenantId.trim().length > 0 ? tenantId.trim() : "default";
  }

  // -------------------------------------------------------------------------
  // 1) Dataset versioning
  // -------------------------------------------------------------------------

  async createDatasetVersion(
    input: CreateDatasetVersionInput,
  ): Promise<DatasetVersionRecord> {
    const id = `dv-${randomUUID()}`;
    const tenantId = this.resolveTenant(input.tenantId);

    await this.pool.query(
      `INSERT INTO market_dataset_versions
         (dataset_version_id, tenant_id, dataset_name, version_tag,
          description, source_uri, row_count,
          date_range_start, date_range_end, symbols, checksums)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb)`,
      [
        id,
        tenantId,
        input.datasetName,
        input.versionTag,
        input.description ?? "",
        input.sourceUri ?? "",
        input.rowCount ?? null,
        input.dateRangeStart ?? null,
        input.dateRangeEnd ?? null,
        JSON.stringify(input.symbols),
        JSON.stringify(input.checksums ?? {}),
      ],
    );

    const record = await this.getDatasetVersion(id, tenantId);
    if (!record) throw new Error("dataset_version_create_failed");
    return record;
  }

  async getDatasetVersion(
    datasetVersionId: string,
    tenantId?: string,
  ): Promise<DatasetVersionRecord | null> {
    const tid = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `SELECT * FROM market_dataset_versions
       WHERE dataset_version_id = $1 AND tenant_id = $2`,
      [datasetVersionId, tid],
    );
    const row = result.rows[0];
    if (!row) return null;
    return this.mapDatasetVersionRow(row);
  }

  async listDatasetVersions(
    datasetName: string,
    tenantId?: string,
  ): Promise<DatasetVersionRecord[]> {
    const tid = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `SELECT * FROM market_dataset_versions
       WHERE tenant_id = $1 AND dataset_name = $2
       ORDER BY created_at DESC`,
      [tid, datasetName],
    );
    return result.rows.map((r) => this.mapDatasetVersionRow(r));
  }

  private mapDatasetVersionRow(
    row: Record<string, unknown>,
  ): DatasetVersionRecord {
    return {
      datasetVersionId: row["dataset_version_id"] as string,
      tenantId: row["tenant_id"] as string,
      datasetName: row["dataset_name"] as string,
      versionTag: row["version_tag"] as string,
      description: row["description"] as string,
      sourceUri: row["source_uri"] as string,
      rowCount: row["row_count"] != null ? Number(row["row_count"]) : null,
      dateRangeStart: row["date_range_start"]
        ? String(row["date_range_start"]).slice(0, 10)
        : null,
      dateRangeEnd: row["date_range_end"]
        ? String(row["date_range_end"]).slice(0, 10)
        : null,
      symbols: Array.isArray(row["symbols"])
        ? (row["symbols"] as string[])
        : JSON.parse(String(row["symbols"])),
      checksums:
        typeof row["checksums"] === "object" && row["checksums"] !== null
          ? (row["checksums"] as Record<string, string>)
          : JSON.parse(String(row["checksums"])),
      isImmutable: Boolean(row["is_immutable"]),
      createdAt: String(row["created_at"]),
    };
  }

  // -------------------------------------------------------------------------
  // 2) Symbol mapping with historical alias changes
  // -------------------------------------------------------------------------

  async createSymbolMapping(
    input: CreateSymbolMappingInput,
  ): Promise<SymbolMappingRecord> {
    const id = `sm-${randomUUID()}`;
    const tid = this.resolveTenant(input.tenantId);

    await this.pool.query(
      `INSERT INTO market_symbol_mappings
         (mapping_id, tenant_id, canonical_symbol, alias,
          effective_from, effective_to, exchange, change_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        tid,
        input.canonicalSymbol.toUpperCase(),
        input.alias.toUpperCase(),
        input.effectiveFrom,
        input.effectiveTo ?? null,
        input.exchange ?? null,
        input.changeReason ?? "",
      ],
    );

    const result = await this.pool.query(
      `SELECT * FROM market_symbol_mappings WHERE mapping_id = $1`,
      [id],
    );
    return this.mapSymbolMappingRow(result.rows[0]);
  }

  /**
   * Resolve the canonical symbol for a given alias on a specific date.
   * Point-in-time aware: only returns the mapping active on `asOfDate`.
   */
  async resolveSymbolAtDate(
    alias: string,
    asOfDate: string,
    tenantId?: string,
  ): Promise<string | null> {
    const tid = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `SELECT canonical_symbol FROM market_symbol_mappings
       WHERE tenant_id = $1
         AND alias = $2
         AND effective_from <= $3
         AND (effective_to IS NULL OR effective_to >= $3)
       ORDER BY effective_from DESC
       LIMIT 1`,
      [tid, alias.toUpperCase(), asOfDate],
    );
    return result.rows[0]?.canonical_symbol ?? null;
  }

  async getSymbolHistory(
    canonicalSymbol: string,
    tenantId?: string,
  ): Promise<SymbolMappingRecord[]> {
    const tid = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `SELECT * FROM market_symbol_mappings
       WHERE tenant_id = $1 AND canonical_symbol = $2
       ORDER BY effective_from ASC`,
      [tid, canonicalSymbol.toUpperCase()],
    );
    return result.rows.map((r) => this.mapSymbolMappingRow(r));
  }

  private mapSymbolMappingRow(
    row: Record<string, unknown>,
  ): SymbolMappingRecord {
    return {
      mappingId: row["mapping_id"] as string,
      tenantId: row["tenant_id"] as string,
      canonicalSymbol: row["canonical_symbol"] as string,
      alias: row["alias"] as string,
      effectiveFrom: String(row["effective_from"]).slice(0, 10),
      effectiveTo: row["effective_to"]
        ? String(row["effective_to"]).slice(0, 10)
        : null,
      exchange: row["exchange"] as string | null,
      changeReason: row["change_reason"] as string,
      createdAt: String(row["created_at"]),
    };
  }

  // -------------------------------------------------------------------------
  // 3) Corporate actions pipeline
  // -------------------------------------------------------------------------

  async createCorporateAction(
    input: CreateCorporateActionInput,
  ): Promise<CorporateActionRecord> {
    const id = `ca-${randomUUID()}`;
    const tid = this.resolveTenant(input.tenantId);

    await this.pool.query(
      `INSERT INTO market_corporate_actions
         (action_id, tenant_id, dataset_version_id, symbol, action_type,
          effective_date, ex_date, ratio, amount, currency,
          adjusted_flag, notes, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        id,
        tid,
        input.datasetVersionId ?? null,
        input.symbol.toUpperCase(),
        input.actionType,
        input.effectiveDate,
        input.exDate ?? null,
        input.ratio ?? null,
        input.amount ?? null,
        input.currency ?? "USD",
        input.adjustedFlag ?? false,
        input.notes ?? "",
        input.source ?? "",
      ],
    );

    const result = await this.pool.query(
      `SELECT * FROM market_corporate_actions WHERE action_id = $1`,
      [id],
    );
    return this.mapCorporateActionRow(result.rows[0]);
  }

  async getCorporateActions(
    symbol: string,
    fromDate: string,
    toDate: string,
    tenantId?: string,
  ): Promise<CorporateActionRecord[]> {
    const tid = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `SELECT * FROM market_corporate_actions
       WHERE tenant_id = $1
         AND symbol = $2
         AND effective_date >= $3
         AND effective_date <= $4
       ORDER BY effective_date ASC`,
      [tid, symbol.toUpperCase(), fromDate, toDate],
    );
    return result.rows.map((r) => this.mapCorporateActionRow(r));
  }

  /**
   * Adjust an array of bars (oldest → newest) for corporate actions.
   * Applies backward adjustment: older prices multiplied by the cumulative
   * adjustment factor so that all prices are expressed in current-day terms.
   */
  adjustBarsForCorporateActions(
    bars: Array<{
      timestamp: string;
      symbol: string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }>,
    actions: CorporateActionRecord[],
  ): NormalizedBar[] {
    if (bars.length === 0) return [];

    // Build a list of split/reverse_split adjustments sorted newest first
    const splitActions = actions
      .filter(
        (a) =>
          (a.actionType === "split" || a.actionType === "reverse_split") &&
          a.ratio != null,
      )
      .sort(
        (x, y) =>
          new Date(y.effectiveDate).getTime() -
          new Date(x.effectiveDate).getTime(),
      );

    return bars.map((bar): NormalizedBar => {
      let adjustedClose = bar.close;
      let priceFactor = 1;

      // For each split that occurred AFTER this bar's date, adjust backward
      for (const action of splitActions) {
        if (action.effectiveDate > bar.timestamp.slice(0, 10)) {
          const ratio = action.ratio!;
          if (action.actionType === "split") {
            priceFactor *= 1 / ratio;
          } else {
            priceFactor *= ratio;
          }
        }
      }

      adjustedClose = bar.close * priceFactor;

      return {
        timestamp: bar.timestamp,
        symbol: bar.symbol,
        open: Math.round(bar.open * priceFactor * 1e6) / 1e6,
        high: Math.round(bar.high * priceFactor * 1e6) / 1e6,
        low: Math.round(bar.low * priceFactor * 1e6) / 1e6,
        close: Math.round(bar.close * priceFactor * 1e6) / 1e6,
        volume: action_adjustVolume(
          bar.volume,
          splitActions,
          bar.timestamp.slice(0, 10),
        ),
        adjustedClose: Math.round(adjustedClose * 1e6) / 1e6,
        timezone: "UTC",
        tradingDate: bar.timestamp.slice(0, 10),
      };
    });
  }

  private mapCorporateActionRow(
    row: Record<string, unknown>,
  ): CorporateActionRecord {
    return {
      actionId: row["action_id"] as string,
      tenantId: row["tenant_id"] as string,
      datasetVersionId: row["dataset_version_id"] as string | null,
      symbol: row["symbol"] as string,
      actionType: row["action_type"] as CorporateActionType,
      effectiveDate: String(row["effective_date"]).slice(0, 10),
      exDate: row["ex_date"] ? String(row["ex_date"]).slice(0, 10) : null,
      ratio: row["ratio"] != null ? Number(row["ratio"]) : null,
      amount: row["amount"] != null ? Number(row["amount"]) : null,
      currency: row["currency"] as string,
      adjustedFlag: Boolean(row["adjusted_flag"]),
      notes: row["notes"] as string,
      source: row["source"] as string,
      createdAt: String(row["created_at"]),
    };
  }

  // -------------------------------------------------------------------------
  // 4) Delistings and survivorship-bias controls
  // -------------------------------------------------------------------------

  async createDelisting(input: CreateDelistingInput): Promise<DelistingRecord> {
    const id = `dl-${randomUUID()}`;
    const tid = this.resolveTenant(input.tenantId);

    await this.pool.query(
      `INSERT INTO market_delistings
         (delisting_id, tenant_id, dataset_version_id, symbol, exchange,
          delisted_on, reason, successor_symbol, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id,
        tid,
        input.datasetVersionId ?? null,
        input.symbol.toUpperCase(),
        input.exchange ?? null,
        input.delistedOn,
        input.reason,
        input.successorSymbol?.toUpperCase() ?? null,
        input.notes ?? "",
      ],
    );

    const result = await this.pool.query(
      `SELECT * FROM market_delistings WHERE delisting_id = $1`,
      [id],
    );
    return this.mapDelistingRow(result.rows[0]);
  }

  /**
   * Returns all symbols from `candidates` that were delisted on or before
   * `asOfDate`, enabling survivorship-bias-free universe construction.
   */
  async getDelistedSymbols(
    candidates: string[],
    asOfDate: string,
    tenantId?: string,
  ): Promise<DelistingRecord[]> {
    if (candidates.length === 0) return [];
    const tid = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `SELECT * FROM market_delistings
       WHERE tenant_id = $1
         AND symbol = ANY($2::text[])
         AND delisted_on <= $3
       ORDER BY delisted_on DESC`,
      [tid, candidates.map((s) => s.toUpperCase()), asOfDate],
    );
    return result.rows.map((r) => this.mapDelistingRow(r));
  }

  /**
   * Filters `symbols` to only those that were alive (not delisted) on `asOfDate`.
   * Drop delisted symbols unless `includeSurvivors` is explicitly true.
   */
  async filterSurvivorshipBias(
    symbols: string[],
    asOfDate: string,
    tenantId?: string,
  ): Promise<{ survivors: string[]; delisted: DelistingRecord[] }> {
    const delisted = await this.getDelistedSymbols(symbols, asOfDate, tenantId);
    const delistedSet = new Set(delisted.map((d) => d.symbol));
    return {
      survivors: symbols.filter((s) => !delistedSet.has(s.toUpperCase())),
      delisted,
    };
  }

  private mapDelistingRow(row: Record<string, unknown>): DelistingRecord {
    return {
      delistingId: row["delisting_id"] as string,
      tenantId: row["tenant_id"] as string,
      datasetVersionId: row["dataset_version_id"] as string | null,
      symbol: row["symbol"] as string,
      exchange: row["exchange"] as string | null,
      delistedOn: String(row["delisted_on"]).slice(0, 10),
      reason: row["reason"] as DelistingReason,
      successorSymbol: row["successor_symbol"] as string | null,
      notes: row["notes"] as string,
      createdAt: String(row["created_at"]),
    };
  }

  // -------------------------------------------------------------------------
  // 5) Exchange calendars and holidays per venue
  // -------------------------------------------------------------------------

  async getExchangeCalendar(
    exchangeCode: string,
    calendarYear: number,
    tenantId?: string,
  ): Promise<ExchangeCalendarRecord | null> {
    const tid = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `SELECT * FROM market_exchange_calendars
       WHERE tenant_id = $1 AND exchange_code = $2 AND calendar_year = $3`,
      [tid, exchangeCode.toUpperCase(), calendarYear],
    );
    const row = result.rows[0];
    if (!row) return null;
    return this.mapCalendarRow(row);
  }

  /**
   * Returns true if `dateStr` (YYYY-MM-DD) is a trading day for the exchange.
   * Checks for weekends first, then holidays, then delegates to calendar.
   */
  async isTradingDay(
    dateStr: string,
    exchangeCode: string,
    tenantId?: string,
  ): Promise<boolean> {
    const date = new Date(dateStr + "T12:00:00Z");
    const dow = date.getUTCDay(); // 0=Sun, 6=Sat
    if (dow === 0 || dow === 6) return false;

    const year = date.getUTCFullYear();
    const calendar = await this.getExchangeCalendar(
      exchangeCode,
      year,
      tenantId,
    );
    if (!calendar) {
      // No calendar registered – treat all weekdays as trading days
      return true;
    }

    return !calendar.holidays.includes(dateStr);
  }

  /**
   * Returns the list of non-trading dates (holidays) for a year/exchange.
   */
  async getHolidaysForYear(
    exchangeCode: string,
    year: number,
    tenantId?: string,
  ): Promise<string[]> {
    const calendar = await this.getExchangeCalendar(
      exchangeCode,
      year,
      tenantId,
    );
    return calendar?.holidays ?? [];
  }

  /**
   * Filter an array of dates to only trading days for the given exchange.
   */
  async filterTradingDays(
    dates: string[],
    exchangeCode: string,
    tenantId?: string,
  ): Promise<string[]> {
    const results: string[] = [];
    for (const d of dates) {
      if (await this.isTradingDay(d, exchangeCode, tenantId)) {
        results.push(d);
      }
    }
    return results;
  }

  private mapCalendarRow(row: Record<string, unknown>): ExchangeCalendarRecord {
    const parseJsonArray = (val: unknown): string[] => {
      if (Array.isArray(val)) return val as string[];
      try {
        return JSON.parse(String(val)) as string[];
      } catch {
        return [];
      }
    };
    const parseEarlyCloses = (val: unknown): EarlyClose[] => {
      if (Array.isArray(val)) return val as EarlyClose[];
      try {
        return JSON.parse(String(val)) as EarlyClose[];
      } catch {
        return [];
      }
    };
    return {
      calendarId: row["calendar_id"] as string,
      tenantId: row["tenant_id"] as string,
      exchangeCode: row["exchange_code"] as string,
      calendarYear: Number(row["calendar_year"]),
      timezone: row["timezone"] as string,
      sessionOpen: row["session_open"] as string,
      sessionClose: row["session_close"] as string,
      holidays: parseJsonArray(row["holidays"]),
      earlyCloses: parseEarlyCloses(row["early_closes"]),
      notes: (row["notes"] as string) ?? "",
      createdAt: String(row["created_at"]),
      updatedAt: String(row["updated_at"]),
    };
  }

  // -------------------------------------------------------------------------
  // 6) Time-zone normalized bars and event timestamps
  // -------------------------------------------------------------------------

  /**
   * Normalize a bar timestamp to UTC ISO-8601 from a source timezone.
   * `sourceTz` should be an IANA timezone string e.g. "America/New_York".
   * Since JS lacks native TZ conversion without Intl tricks, we use the
   * standard approach of Intl.DateTimeFormat to determine UTC offset.
   */
  normalizeBarTimestamp(
    dateStr: string,
    timeStr: string,
    sourceTz: string,
  ): string {
    // Combine into a local datetime string
    const localIso = `${dateStr}T${timeStr}`;

    try {
      // Get UTC offset for this time in sourceTz using Intl
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: sourceTz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZoneName: "shortOffset",
      }).formatToParts(new Date(localIso));

      void parts; // used below indirectly

      // Reference approach: parse as UTC, then adjust using Date object
      const refDate = new Date(`${localIso}Z`);
      const inTz = new Date(
        refDate.toLocaleString("en-US", { timeZone: sourceTz }),
      );
      const offsetMs = refDate.getTime() - inTz.getTime();
      const utcMs = new Date(localIso).getTime() + offsetMs;
      return new Date(utcMs).toISOString();
    } catch (err) {
      logger.warn("timezone_normalization_fallback", {
        dateStr,
        timeStr,
        sourceTz,
        error: err instanceof Error ? err.message : "unknown",
      });
      // Fall back: treat as UTC
      return new Date(`${localIso}Z`).toISOString();
    }
  }

  /**
   * Normalize a batch of bars to UTC timestamps.
   */
  normalizeBars(
    bars: Array<{
      timestamp: string;
      symbol: string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }>,
    sourceTz: string,
    sessionCloseTime = "16:00:00",
  ): NormalizedBar[] {
    return bars.map((bar): NormalizedBar => {
      const tradingDate = bar.timestamp.slice(0, 10);
      const utcTimestamp = bar.timestamp.includes("T")
        ? bar.timestamp
        : this.normalizeBarTimestamp(tradingDate, sessionCloseTime, sourceTz);

      return {
        timestamp: utcTimestamp,
        symbol: bar.symbol,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        timezone: sourceTz,
        tradingDate,
      };
    });
  }

  // -------------------------------------------------------------------------
  // 7) Point-in-time data access guarantees
  // -------------------------------------------------------------------------

  /**
   * Returns bars that would have been knowable at `query.asOfTimestamp`.
   * Strips any bars with timestamps after the PIT cutoff. Also filters
   * survivorship bias if `includeSurvivors` is false (default).
   */
  async getBarsPointInTime(
    allBars: NormalizedBar[],
    query: PointInTimeQuery,
    tenantId?: string,
  ): Promise<NormalizedBar[]> {
    const pitCutoff = new Date(query.asOfTimestamp).getTime();

    // 1) Filter to requested symbols
    const symbolSet = new Set(query.symbols.map((s) => s.toUpperCase()));

    // 2) Apply PIT cutoff (only bars knowable at asOfTimestamp)
    let filtered = allBars.filter((b) => {
      if (!symbolSet.has(b.symbol.toUpperCase())) return false;
      const barTs = new Date(b.timestamp).getTime();
      return barTs <= pitCutoff;
    });

    // 3) Survivorship-bias filtering (default: bias-free)
    if (query.includeSurvivors !== true) {
      const asOfDate = query.asOfTimestamp.slice(0, 10);
      const symbols = Array.from(symbolSet);
      const { survivors } = await this.filterSurvivorshipBias(
        symbols,
        asOfDate,
        tenantId,
      );
      const survivorSet = new Set(survivors.map((s) => s.toUpperCase()));
      filtered = filtered.filter((b) =>
        survivorSet.has(b.symbol.toUpperCase()),
      );
    }

    return filtered;
  }

  // -------------------------------------------------------------------------
  // 8) Snapshot manifest + checksum lineage
  // -------------------------------------------------------------------------

  /**
   * Build a SHA-256 checksum over the canonical bar content of a snapshot.
   */
  computeSnapshotChecksum(
    bars: Array<{ timestamp: string; symbol: string; close: number }>,
  ): string {
    const material = bars
      .slice()
      .sort(
        (a, b) =>
          a.symbol.localeCompare(b.symbol) ||
          a.timestamp.localeCompare(b.timestamp),
      )
      .map((b) => `${b.symbol}|${b.timestamp}|${b.close}`)
      .join("\n");
    return createHash("sha256").update(material, "utf8").digest("hex");
  }

  async createSnapshotManifest(
    input: CreateSnapshotManifestInput,
  ): Promise<SnapshotManifestRecord> {
    const manifestId = `mf-${randomUUID()}`;
    const tid = this.resolveTenant(input.tenantId);
    const checksum = this.computeSnapshotChecksum(input.bars);

    const dates = input.bars.map((b) => b.timestamp.slice(0, 10)).sort();
    const dateRangeStart = input.dateRangeStart ?? dates[0] ?? null;
    const dateRangeEnd = input.dateRangeEnd ?? dates[dates.length - 1] ?? null;

    await this.pool.query(
      `INSERT INTO market_snapshot_manifests
         (manifest_id, tenant_id, snapshot_id, dataset_version_id,
          symbols, bar_count, date_range_start, date_range_end, timezone,
          checksum_sha256, checksum_algorithm, pit_cutoff_ts, lineage)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
      [
        manifestId,
        tid,
        input.snapshotId,
        input.datasetVersionId ?? null,
        JSON.stringify(input.symbols),
        input.barCount ?? input.bars.length,
        dateRangeStart,
        dateRangeEnd,
        input.timezone ?? "UTC",
        checksum,
        "sha256",
        input.pitCutoffTs ?? null,
        JSON.stringify(input.lineage ?? {}),
      ],
    );

    const result = await this.pool.query(
      `SELECT * FROM market_snapshot_manifests WHERE manifest_id = $1`,
      [manifestId],
    );
    return this.mapManifestRow(result.rows[0]);
  }

  async getSnapshotManifest(
    snapshotId: string,
    tenantId?: string,
  ): Promise<SnapshotManifestRecord | null> {
    const tid = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `SELECT * FROM market_snapshot_manifests
       WHERE tenant_id = $1 AND snapshot_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [tid, snapshotId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return this.mapManifestRow(row);
  }

  /**
   * Verify that the manifest checksum matches a recomputed checksum
   * over the supplied bars. Returns a detailed verification result.
   */
  verifyManifest(
    manifest: SnapshotManifestRecord,
    bars: Array<{ timestamp: string; symbol: string; close: number }>,
  ): ManifestVerificationResult {
    const actual = this.computeSnapshotChecksum(bars);
    return {
      valid: actual === manifest.checksumSha256,
      expectedChecksum: manifest.checksumSha256,
      actualChecksum: actual,
      symbolCount: manifest.symbols.length,
      barCount: manifest.barCount,
    };
  }

  private mapManifestRow(row: Record<string, unknown>): SnapshotManifestRecord {
    const parseJsonArray = (val: unknown): string[] => {
      if (Array.isArray(val)) return val as string[];
      try {
        return JSON.parse(String(val)) as string[];
      } catch {
        return [];
      }
    };
    const parseLineage = (val: unknown): Record<string, unknown> => {
      if (typeof val === "object" && val !== null)
        return val as Record<string, unknown>;
      try {
        return JSON.parse(String(val)) as Record<string, unknown>;
      } catch {
        return {};
      }
    };
    return {
      manifestId: row["manifest_id"] as string,
      tenantId: row["tenant_id"] as string,
      snapshotId: row["snapshot_id"] as string,
      datasetVersionId: row["dataset_version_id"] as string | null,
      manifestVersion: Number(row["manifest_version"]),
      symbols: parseJsonArray(row["symbols"]),
      barCount: row["bar_count"] != null ? Number(row["bar_count"]) : null,
      dateRangeStart: row["date_range_start"]
        ? String(row["date_range_start"]).slice(0, 10)
        : null,
      dateRangeEnd: row["date_range_end"]
        ? String(row["date_range_end"]).slice(0, 10)
        : null,
      timezone: row["timezone"] as string,
      checksumSha256: row["checksum_sha256"] as string,
      checksumAlgorithm: row["checksum_algorithm"] as string,
      pitCutoffTs: row["pit_cutoff_ts"] ? String(row["pit_cutoff_ts"]) : null,
      lineage: parseLineage(row["lineage"]),
      createdAt: String(row["created_at"]),
    };
  }
}

// ---------------------------------------------------------------------------
// Module-level helper (avoids closure over `this` in adjustBarsForCorporateActions)
// ---------------------------------------------------------------------------

function action_adjustVolume(
  volume: number,
  splitActions: CorporateActionRecord[],
  barDate: string,
): number {
  let factor = 1;
  for (const action of splitActions) {
    if (action.effectiveDate > barDate && action.ratio != null) {
      if (action.actionType === "split") {
        factor *= action.ratio;
      } else {
        factor *= 1 / action.ratio;
      }
    }
  }
  return Math.round(volume * factor);
}

export function createMarketDataLayer(pool: Pool): MarketDataLayer {
  return new MarketDataLayer(pool);
}

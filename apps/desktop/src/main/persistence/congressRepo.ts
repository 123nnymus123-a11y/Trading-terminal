import { getDb } from "./db";
import type {
  CongressionalTrade,
  InsertCongressionalTrade,
  CongressionalMember,
  InsertCongressionalMember,
  LobbyingActivity,
  InsertLobbyingActivity,
  FederalContract,
  InsertFederalContract,
  CompanyTickerMapping,
  InsertCompanyTickerMapping,
  CongressDataIngestionLog,
  InsertCongressDataIngestionLog,
} from "@tc/shared";

/**
 * Congress Activity DAO - manages congressional trading disclosures, member metadata,
 * lobbying activity, and federal contracts.
 * 
 * IMPORTANT: These are PUBLIC, DELAYED disclosures from official sources.
 * They are NOT real-time trading signals.
 */

export const CongressRepo = {
  getTickerCongressNetBuyAsOf(
    ticker: string,
    asOfIso: string,
    lookbackDays = 180
  ): {
    congressNetBuy: number;
    observedAt: string | null;
  } {
    const db = getDb();

    const asOfDate = asOfIso.slice(0, 10);
    const lookbackStart = new Date(Date.parse(asOfIso) - lookbackDays * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const agg = db.prepare(`
      SELECT
        SUM(
          CASE
            WHEN LOWER(transaction_type) IN ('buy', 'purchase')
            THEN COALESCE((amount_range_low + amount_range_high) / 2, amount_range_low, amount_range_high, 1)
            ELSE 0
          END
        ) AS buy_notional,
        SUM(
          CASE
            WHEN LOWER(transaction_type) IN ('sell', 'sale')
            THEN COALESCE((amount_range_low + amount_range_high) / 2, amount_range_low, amount_range_high, 1)
            ELSE 0
          END
        ) AS sell_notional,
        MAX(ingestion_timestamp) AS observed_at
      FROM congressional_trade
      WHERE ticker_normalized = ?
        AND disclosure_date >= ?
        AND disclosure_date <= ?
        AND ingestion_timestamp <= ?
    `).get(ticker, lookbackStart, asOfDate, asOfIso) as {
      buy_notional: number | null;
      sell_notional: number | null;
      observed_at: string | null;
    };

    const buyNotional = agg?.buy_notional ?? 0;
    const sellNotional = agg?.sell_notional ?? 0;
    const totalNotional = buyNotional + sellNotional;
    const net = totalNotional > 0 ? (buyNotional - sellNotional) / totalNotional : 0;

    return {
      congressNetBuy: Math.max(0, Math.min(1, 0.5 + 0.5 * net)),
      observedAt: agg?.observed_at ?? null,
    };
  },

  // ============================================
  // CONGRESSIONAL TRADES
  // ============================================

  /**
   * Insert multiple congressional trade records in a single transaction.
   */
  insertCongressionalTrades(trades: InsertCongressionalTrade[]): number[] {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO congressional_trade (
        record_id, person_name, chamber, transaction_date, disclosure_date,
        transaction_type, asset_name_raw, ticker_normalized, asset_type,
        amount_range_low, amount_range_high, amount_currency, comments_raw,
        source_document_id, source_url, quality_flag_ticker_match,
        quality_flag_amount, ingestion_timestamp, last_updated_timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((trades: InsertCongressionalTrade[]) => {
      const ids: number[] = [];
      for (const t of trades) {
        const info = stmt.run(
          t.record_id,
          t.person_name,
          t.chamber,
          t.transaction_date,
          t.disclosure_date,
          t.transaction_type,
          t.asset_name_raw,
          t.ticker_normalized,
          t.asset_type,
          t.amount_range_low,
          t.amount_range_high,
          t.amount_currency,
          t.comments_raw,
          t.source_document_id,
          t.source_url,
          t.quality_flag_ticker_match,
          t.quality_flag_amount,
          t.ingestion_timestamp,
          t.last_updated_timestamp
        );
        ids.push(Number(info.lastInsertRowid));
      }
      return ids;
    });

    return insertMany(trades);
  },

  /**
   * Query congressional trades with optional filters.
   */
  queryCongressionalTrades(filters: {
    person_name?: string;
    chamber?: "House" | "Senate";
    party?: string;
    ticker?: string;
    asset_type?: string;
    transaction_type?: string;
    transaction_date_start?: string;
    transaction_date_end?: string;
    disclosure_date_start?: string;
    disclosure_date_end?: string;
    limit?: number;
  }): CongressionalTrade[] {
    const db = getDb();
    const params: (string | number)[] = [];
    let sql = `
      SELECT 
        t.id, t.record_id, t.person_name, t.chamber, t.transaction_date,
        t.disclosure_date, t.transaction_type, t.asset_name_raw,
        t.ticker_normalized, t.asset_type, t.amount_range_low,
        t.amount_range_high, t.amount_currency, t.comments_raw,
        t.source_document_id, t.source_url, t.quality_flag_ticker_match,
        t.quality_flag_amount, t.ingestion_timestamp, t.last_updated_timestamp
      FROM congressional_trade t
      WHERE 1=1
    `;

    if (filters.person_name) {
      sql += ` AND t.person_name LIKE ?`;
      params.push(`%${filters.person_name}%`);
    }

    if (filters.chamber) {
      sql += ` AND t.chamber = ?`;
      params.push(filters.chamber);
    }

    if (filters.ticker) {
      sql += ` AND t.ticker_normalized = ?`;
      params.push(filters.ticker);
    }

    if (filters.asset_type) {
      sql += ` AND t.asset_type = ?`;
      params.push(filters.asset_type);
    }

    if (filters.transaction_type) {
      sql += ` AND t.transaction_type = ?`;
      params.push(filters.transaction_type);
    }

    if (filters.transaction_date_start) {
      sql += ` AND t.transaction_date >= ?`;
      params.push(filters.transaction_date_start);
    }

    if (filters.transaction_date_end) {
      sql += ` AND t.transaction_date <= ?`;
      params.push(filters.transaction_date_end);
    }

    if (filters.disclosure_date_start) {
      sql += ` AND t.disclosure_date >= ?`;
      params.push(filters.disclosure_date_start);
    }

    if (filters.disclosure_date_end) {
      sql += ` AND t.disclosure_date <= ?`;
      params.push(filters.disclosure_date_end);
    }

    sql += ` ORDER BY t.transaction_date DESC`;

    if (filters.limit) {
      sql += ` LIMIT ?`;
      params.push(filters.limit);
    }

    return db.prepare(sql).all(...params) as CongressionalTrade[];
  },

  /**
   * Query congressional trades with member party information (requires join).
   */
  queryCongressionalTradesWithParty(filters: {
    party?: string;
    ticker?: string;
    transaction_date_start?: string;
    transaction_date_end?: string;
    limit?: number;
  }): Array<CongressionalTrade & { party?: string | null }> {
    const db = getDb();
    const params: (string | number)[] = [];
    let sql = `
      SELECT 
        t.id, t.record_id, t.person_name, t.chamber, t.transaction_date,
        t.disclosure_date, t.transaction_type, t.asset_name_raw,
        t.ticker_normalized, t.asset_type, t.amount_range_low,
        t.amount_range_high, t.amount_currency, t.comments_raw,
        t.source_document_id, t.source_url, t.quality_flag_ticker_match,
        t.quality_flag_amount, t.ingestion_timestamp, t.last_updated_timestamp,
        m.party
      FROM congressional_trade t
      LEFT JOIN congressional_member m ON t.person_name = m.full_name AND t.chamber = m.chamber
      WHERE 1=1
    `;

    if (filters.party) {
      sql += ` AND m.party = ?`;
      params.push(filters.party);
    }

    if (filters.ticker) {
      sql += ` AND t.ticker_normalized = ?`;
      params.push(filters.ticker);
    }

    if (filters.transaction_date_start) {
      sql += ` AND t.transaction_date >= ?`;
      params.push(filters.transaction_date_start);
    }

    if (filters.transaction_date_end) {
      sql += ` AND t.transaction_date <= ?`;
      params.push(filters.transaction_date_end);
    }

    sql += ` ORDER BY t.transaction_date DESC`;

    if (filters.limit) {
      sql += ` LIMIT ?`;
      params.push(filters.limit);
    }

    return db.prepare(sql).all(...params) as Array<CongressionalTrade & { party?: string | null }>;
  },

  /**
   * Get aggregated trade statistics by ticker.
   */
  getTradeStatsByTicker(ticker: string, dateStart?: string, dateEnd?: string): {
    ticker: string;
    total_buys: number;
    total_sells: number;
    buy_volume_min: number;
    buy_volume_max: number;
    sell_volume_min: number;
    sell_volume_max: number;
    unique_traders: number;
  } | null {
    const db = getDb();
    const params: (string | number)[] = [ticker];
    let sql = `
      SELECT
        ticker_normalized as ticker,
        SUM(CASE WHEN transaction_type IN ('buy', 'purchase') THEN 1 ELSE 0 END) as total_buys,
        SUM(CASE WHEN transaction_type IN ('sell', 'sale') THEN 1 ELSE 0 END) as total_sells,
        SUM(CASE WHEN transaction_type IN ('buy', 'purchase') THEN COALESCE(amount_range_low, 0) ELSE 0 END) as buy_volume_min,
        SUM(CASE WHEN transaction_type IN ('buy', 'purchase') THEN COALESCE(amount_range_high, 0) ELSE 0 END) as buy_volume_max,
        SUM(CASE WHEN transaction_type IN ('sell', 'sale') THEN COALESCE(amount_range_low, 0) ELSE 0 END) as sell_volume_min,
        SUM(CASE WHEN transaction_type IN ('sell', 'sale') THEN COALESCE(amount_range_high, 0) ELSE 0 END) as sell_volume_max,
        COUNT(DISTINCT person_name) as unique_traders
      FROM congressional_trade
      WHERE ticker_normalized = ?
    `;

    if (dateStart) {
      sql += ` AND transaction_date >= ?`;
      params.push(dateStart);
    }

    if (dateEnd) {
      sql += ` AND transaction_date <= ?`;
      params.push(dateEnd);
    }

    sql += ` GROUP BY ticker_normalized`;

    return db.prepare(sql).get(...params) as {
      ticker: string;
      total_buys: number;
      total_sells: number;
      buy_volume_min: number;
      buy_volume_max: number;
      sell_volume_min: number;
      sell_volume_max: number;
      unique_traders: number;
    } | null;
  },

  /**
   * Get most traded tickers by Congress.
   */
  getMostTradedTickers(dateStart?: string, dateEnd?: string, limit = 20): Array<{
    ticker: string;
    trade_count: number;
    buy_count: number;
    sell_count: number;
  }> {
    const db = getDb();
    const params: (string | number)[] = [];
    let sql = `
      SELECT
        ticker_normalized as ticker,
        COUNT(*) as trade_count,
        SUM(CASE WHEN transaction_type IN ('buy', 'purchase') THEN 1 ELSE 0 END) as buy_count,
        SUM(CASE WHEN transaction_type IN ('sell', 'sale') THEN 1 ELSE 0 END) as sell_count
      FROM congressional_trade
      WHERE ticker_normalized IS NOT NULL
    `;

    if (dateStart) {
      sql += ` AND transaction_date >= ?`;
      params.push(dateStart);
    }

    if (dateEnd) {
      sql += ` AND transaction_date <= ?`;
      params.push(dateEnd);
    }

    sql += ` GROUP BY ticker_normalized ORDER BY trade_count DESC LIMIT ?`;
    params.push(limit);

    return db.prepare(sql).all(...params) as Array<{
      ticker: string;
      trade_count: number;
      buy_count: number;
      sell_count: number;
    }>;
  },

  /**
   * Calculate average disclosure lag (days between transaction and disclosure).
   */
  getDisclosureLagStats(): {
    avg_lag_days: number;
    median_lag_days: number;
    max_lag_days: number;
  } | null {
    const db = getDb();
    const sql = `
      WITH lag_calc AS (
        SELECT
          CAST((julianday(disclosure_date) - julianday(transaction_date)) AS INTEGER) as lag_days
        FROM congressional_trade
        WHERE transaction_date IS NOT NULL AND disclosure_date IS NOT NULL
      )
      SELECT
        AVG(lag_days) as avg_lag_days,
        MAX(lag_days) as max_lag_days
      FROM lag_calc
    `;

    const result = db.prepare(sql).get() as { avg_lag_days: number; max_lag_days: number } | null;

    if (!result) return null;

    // Calculate median separately
    const medianSql = `
      WITH lag_calc AS (
        SELECT
          CAST((julianday(disclosure_date) - julianday(transaction_date)) AS INTEGER) as lag_days
        FROM congressional_trade
        WHERE transaction_date IS NOT NULL AND disclosure_date IS NOT NULL
      ),
      ordered AS (
        SELECT lag_days, ROW_NUMBER() OVER (ORDER BY lag_days) as row_num, COUNT(*) OVER () as total_count
        FROM lag_calc
      )
      SELECT AVG(lag_days) as median_lag_days
      FROM ordered
      WHERE row_num IN ((total_count + 1) / 2, (total_count + 2) / 2)
    `;

    const medianResult = db.prepare(medianSql).get() as { median_lag_days: number } | null;

    return {
      avg_lag_days: result.avg_lag_days,
      median_lag_days: medianResult?.median_lag_days || 0,
      max_lag_days: result.max_lag_days,
    };
  },

  // ============================================
  // CONGRESSIONAL MEMBERS
  // ============================================

  /**
   * Upsert congressional member records (insert or update).
   */
  upsertCongressionalMembers(members: InsertCongressionalMember[]): number[] {
    const db = getDb();

    const upsertMany = db.transaction((members: InsertCongressionalMember[]) => {
      const ids: number[] = [];
      for (const m of members) {
        const existing = db.prepare(`
          SELECT id FROM congressional_member WHERE member_id = ?
        `).get(m.member_id) as { id: number } | undefined;

        if (existing) {
          db.prepare(`
            UPDATE congressional_member
            SET full_name = ?, chamber = ?, party = ?, state = ?, district = ?,
                committee_memberships = ?, leadership_roles = ?, seniority_indicator = ?,
                office_term_start = ?, office_term_end = ?, bioguide_id = ?,
                last_updated_timestamp = ?
            WHERE id = ?
          `).run(
            m.full_name,
            m.chamber,
            m.party,
            m.state,
            m.district,
            m.committee_memberships,
            m.leadership_roles,
            m.seniority_indicator,
            m.office_term_start,
            m.office_term_end,
            m.bioguide_id,
            m.last_updated_timestamp,
            existing.id
          );
          ids.push(existing.id);
        } else {
          const info = db.prepare(`
            INSERT INTO congressional_member (
              member_id, full_name, chamber, party, state, district,
              committee_memberships, leadership_roles, seniority_indicator,
              office_term_start, office_term_end, bioguide_id, last_updated_timestamp
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            m.member_id,
            m.full_name,
            m.chamber,
            m.party,
            m.state,
            m.district,
            m.committee_memberships,
            m.leadership_roles,
            m.seniority_indicator,
            m.office_term_start,
            m.office_term_end,
            m.bioguide_id,
            m.last_updated_timestamp
          );
          ids.push(Number(info.lastInsertRowid));
        }
      }
      return ids;
    });

    return upsertMany(members);
  },

  /**
   * Query congressional members.
   */
  queryCongressionalMembers(filters: {
    chamber?: "House" | "Senate";
    party?: string;
    state?: string;
    limit?: number;
  }): CongressionalMember[] {
    const db = getDb();
    const params: (string | number)[] = [];
    let sql = `
      SELECT id, member_id, full_name, chamber, party, state, district,
             committee_memberships, leadership_roles, seniority_indicator,
             office_term_start, office_term_end, bioguide_id, last_updated_timestamp
      FROM congressional_member
      WHERE 1=1
    `;

    if (filters.chamber) {
      sql += ` AND chamber = ?`;
      params.push(filters.chamber);
    }

    if (filters.party) {
      sql += ` AND party = ?`;
      params.push(filters.party);
    }

    if (filters.state) {
      sql += ` AND state = ?`;
      params.push(filters.state);
    }

    sql += ` ORDER BY full_name`;

    if (filters.limit) {
      sql += ` LIMIT ?`;
      params.push(filters.limit);
    }

    return db.prepare(sql).all(...params) as CongressionalMember[];
  },

  // ============================================
  // LOBBYING ACTIVITY
  // ============================================

  /**
   * Insert multiple lobbying activity records.
   */
  insertLobbyingActivities(activities: InsertLobbyingActivity[]): number[] {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO lobbying_activity (
        record_id, reporting_entity_name, client_name, lobbying_amount,
        period_start, period_end, issues_topics_raw, naics_code,
        ticker_normalized, filing_reference_id, filing_url,
        ingestion_timestamp, last_updated_timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((activities: InsertLobbyingActivity[]) => {
      const ids: number[] = [];
      for (const a of activities) {
        const info = stmt.run(
          a.record_id,
          a.reporting_entity_name,
          a.client_name,
          a.lobbying_amount,
          a.period_start,
          a.period_end,
          a.issues_topics_raw,
          a.naics_code,
          a.ticker_normalized,
          a.filing_reference_id,
          a.filing_url,
          a.ingestion_timestamp,
          a.last_updated_timestamp
        );
        ids.push(Number(info.lastInsertRowid));
      }
      return ids;
    });

    return insertMany(activities);
  },

  /**
   * Query lobbying activities.
   */
  queryLobbyingActivities(filters: {
    client_name?: string;
    ticker?: string;
    period_start?: string;
    period_end?: string;
    limit?: number;
  }): LobbyingActivity[] {
    const db = getDb();
    const params: (string | number)[] = [];
    let sql = `
      SELECT id, record_id, reporting_entity_name, client_name, lobbying_amount,
             period_start, period_end, issues_topics_raw, naics_code,
             ticker_normalized, filing_reference_id, filing_url,
             ingestion_timestamp, last_updated_timestamp
      FROM lobbying_activity
      WHERE 1=1
    `;

    if (filters.client_name) {
      sql += ` AND client_name LIKE ?`;
      params.push(`%${filters.client_name}%`);
    }

    if (filters.ticker) {
      sql += ` AND ticker_normalized = ?`;
      params.push(filters.ticker);
    }

    if (filters.period_start) {
      sql += ` AND period_start >= ?`;
      params.push(filters.period_start);
    }

    if (filters.period_end) {
      sql += ` AND period_end <= ?`;
      params.push(filters.period_end);
    }

    sql += ` ORDER BY period_start DESC`;

    if (filters.limit) {
      sql += ` LIMIT ?`;
      params.push(filters.limit);
    }

    return db.prepare(sql).all(...params) as LobbyingActivity[];
  },

  // ============================================
  // FEDERAL CONTRACTS
  // ============================================

  /**
   * Insert multiple federal contract records.
   */
  insertFederalContracts(contracts: InsertFederalContract[]): number[] {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO federal_contract (
        record_id, recipient_name, contractor_name, award_amount,
        award_currency, agency_name, award_date, period_start, period_end,
        naics_code, category_description, ticker_normalized,
        contract_reference_id, source_url, ingestion_timestamp, last_updated_timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((contracts: InsertFederalContract[]) => {
      const ids: number[] = [];
      for (const c of contracts) {
        const info = stmt.run(
          c.record_id,
          c.recipient_name,
          c.contractor_name,
          c.award_amount,
          c.award_currency,
          c.agency_name,
          c.award_date,
          c.period_start,
          c.period_end,
          c.naics_code,
          c.category_description,
          c.ticker_normalized,
          c.contract_reference_id,
          c.source_url,
          c.ingestion_timestamp,
          c.last_updated_timestamp
        );
        ids.push(Number(info.lastInsertRowid));
      }
      return ids;
    });

    return insertMany(contracts);
  },

  /**
   * Query federal contracts.
   */
  queryFederalContracts(filters: {
    recipient_name?: string;
    contractor_name?: string;
    agency_name?: string;
    ticker?: string;
    award_date_start?: string;
    award_date_end?: string;
    limit?: number;
  }): FederalContract[] {
    const db = getDb();
    const params: (string | number)[] = [];
    let sql = `
      SELECT id, record_id, recipient_name, contractor_name, award_amount,
             award_currency, agency_name, award_date, period_start, period_end,
             naics_code, category_description, ticker_normalized,
             contract_reference_id, source_url, ingestion_timestamp, last_updated_timestamp
      FROM federal_contract
      WHERE 1=1
    `;

    if (filters.recipient_name) {
      sql += ` AND recipient_name LIKE ?`;
      params.push(`%${filters.recipient_name}%`);
    }

    if (filters.contractor_name) {
      sql += ` AND contractor_name LIKE ?`;
      params.push(`%${filters.contractor_name}%`);
    }

    if (filters.agency_name) {
      sql += ` AND agency_name LIKE ?`;
      params.push(`%${filters.agency_name}%`);
    }

    if (filters.ticker) {
      sql += ` AND ticker_normalized = ?`;
      params.push(filters.ticker);
    }

    if (filters.award_date_start) {
      sql += ` AND award_date >= ?`;
      params.push(filters.award_date_start);
    }

    if (filters.award_date_end) {
      sql += ` AND award_date <= ?`;
      params.push(filters.award_date_end);
    }

    sql += ` ORDER BY award_date DESC`;

    if (filters.limit) {
      sql += ` LIMIT ?`;
      params.push(filters.limit);
    }

    return db.prepare(sql).all(...params) as FederalContract[];
  },

  // ============================================
  // COMPANY TICKER MAPPING
  // ============================================

  /**
   * Upsert company-to-ticker mappings.
   */
  upsertCompanyTickerMappings(mappings: InsertCompanyTickerMapping[]): number[] {
    const db = getDb();

    const upsertMany = db.transaction((mappings: InsertCompanyTickerMapping[]) => {
      const ids: number[] = [];
      for (const m of mappings) {
        const existing = db.prepare(`
          SELECT id FROM company_ticker_mapping
          WHERE company_name_normalized = ? AND ticker = ?
        `).get(m.company_name_normalized, m.ticker) as { id: number } | undefined;

        if (existing) {
          db.prepare(`
            UPDATE company_ticker_mapping
            SET match_confidence = ?, match_method = ?, valid_from_date = ?,
                valid_to_date = ?, last_verified_timestamp = ?
            WHERE id = ?
          `).run(
            m.match_confidence,
            m.match_method,
            m.valid_from_date,
            m.valid_to_date,
            m.last_verified_timestamp,
            existing.id
          );
          ids.push(existing.id);
        } else {
          const info = db.prepare(`
            INSERT INTO company_ticker_mapping (
              mapping_id, company_name_raw, company_name_normalized, ticker,
              match_confidence, match_method, valid_from_date, valid_to_date,
              last_verified_timestamp
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            m.mapping_id,
            m.company_name_raw,
            m.company_name_normalized,
            m.ticker,
            m.match_confidence,
            m.match_method,
            m.valid_from_date,
            m.valid_to_date,
            m.last_verified_timestamp
          );
          ids.push(Number(info.lastInsertRowid));
        }
      }
      return ids;
    });

    return upsertMany(mappings);
  },

  /**
   * Find ticker for a company name.
   */
  findTickerByCompanyName(companyName: string): CompanyTickerMapping | null {
    const db = getDb();
    return db.prepare(`
      SELECT id, mapping_id, company_name_raw, company_name_normalized, ticker,
             match_confidence, match_method, valid_from_date, valid_to_date,
             last_verified_timestamp
      FROM company_ticker_mapping
      WHERE company_name_normalized LIKE ?
      ORDER BY match_confidence DESC
      LIMIT 1
    `).get(`%${companyName}%`) as CompanyTickerMapping | null;
  },

  // ============================================
  // DATA INGESTION LOGS
  // ============================================

  /**
   * Insert a data ingestion log entry.
   */
  insertIngestionLog(log: InsertCongressDataIngestionLog): number {
    const db = getDb();
    const info = db.prepare(`
      INSERT INTO congress_data_ingestion_log (
        log_id, domain, operation_type, records_processed, records_inserted,
        records_updated, records_skipped_duplicate, timestamp_start,
        timestamp_end, status, error_messages
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      log.log_id,
      log.domain,
      log.operation_type,
      log.records_processed,
      log.records_inserted,
      log.records_updated,
      log.records_skipped_duplicate,
      log.timestamp_start,
      log.timestamp_end,
      log.status,
      log.error_messages
    );
    return Number(info.lastInsertRowid);
  },

  /**
   * Query recent ingestion logs.
   */
  queryIngestionLogs(domain?: string, limit = 50): CongressDataIngestionLog[] {
    const db = getDb();
    const params: (string | number)[] = [];
    let sql = `
      SELECT id, log_id, domain, operation_type, records_processed,
             records_inserted, records_updated, records_skipped_duplicate,
             timestamp_start, timestamp_end, status, error_messages
      FROM congress_data_ingestion_log
      WHERE 1=1
    `;

    if (domain) {
      sql += ` AND domain = ?`;
      params.push(domain);
    }

    sql += ` ORDER BY timestamp_start DESC LIMIT ?`;
    params.push(limit);

    return db.prepare(sql).all(...params) as CongressDataIngestionLog[];
  },
};

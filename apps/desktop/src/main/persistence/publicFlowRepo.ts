import { getDb } from "./db";
import type { DisclosureEvent, InsertDisclosureEvent, SectorTheme, InsertSectorTheme, WatchlistCandidate, InsertWatchlistCandidate } from "@tc/shared";

/**
 * Public Flow Intel DAO - manages disclosure events, sector themes, and watchlist candidates.
 * 
 * IMPORTANT: These are PUBLIC, DELAYED disclosures (e.g., 13F filings).
 * They are NOT real-time trading signals.
 */

export const PublicFlowRepo = {
  getTickerFlowSnapshotAsOf(
    ticker: string,
    asOfIso: string,
    lookbackDays = 90
  ): {
    publicFlowBuy: number;
    themeAccel: number;
    secondOrderMomentum: number;
    observedAt: {
      publicFlow: string | null;
      theme: string | null;
      secondOrder: string | null;
    };
  } {
    const db = getDb();

    const asOfDate = asOfIso.slice(0, 10);
    const lookbackStart = new Date(Date.parse(asOfIso) - lookbackDays * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const disclosureAgg = db.prepare(`
      SELECT
        SUM(
          CASE
            WHEN action = 'BUY' THEN COALESCE(amount_max, amount_min, 1)
            ELSE 0
          END
        ) AS buy_notional,
        SUM(
          CASE
            WHEN action = 'SELL' THEN COALESCE(amount_max, amount_min, 1)
            ELSE 0
          END
        ) AS sell_notional,
        MAX(created_at) AS observed_at
      FROM disclosure_event
      WHERE ticker = ?
        AND report_date >= ?
        AND report_date <= ?
        AND created_at <= ?
    `).get(ticker, lookbackStart, asOfDate, asOfIso) as {
      buy_notional: number | null;
      sell_notional: number | null;
      observed_at: string | null;
    };

    const buyNotional = disclosureAgg?.buy_notional ?? 0;
    const sellNotional = disclosureAgg?.sell_notional ?? 0;
    const totalNotional = buyNotional + sellNotional;
    const disclosureNet = totalNotional > 0 ? (buyNotional - sellNotional) / totalNotional : 0;
    const publicFlowBuy = Math.max(0, Math.min(1, 0.5 + 0.5 * disclosureNet));

    const themeAgg = db.prepare(`
      SELECT
        AVG(CASE WHEN st.window_days = 7 THEN st.score END) AS score_7,
        AVG(CASE WHEN st.window_days = 30 THEN st.score END) AS score_30,
        MAX(st.created_at) AS observed_at
      FROM watchlist_candidate wc
      JOIN sector_theme st ON st.id = wc.theme_id
      WHERE wc.ticker = ?
        AND wc.created_at <= ?
        AND st.created_at <= ?
        AND st.window_end <= ?
    `).get(ticker, asOfIso, asOfIso, asOfDate) as {
      score_7: number | null;
      score_30: number | null;
      observed_at: string | null;
    };

    const score7 = themeAgg?.score_7 ?? 50;
    const score30 = themeAgg?.score_30 ?? 50;
    const accel = (score7 - score30) / 25;
    const themeAccel = Math.max(0, Math.min(1, 0.5 + 0.5 * accel));

    const secondOrderAgg = db.prepare(`
      SELECT
        AVG(
          CASE relation_type
            WHEN 'peer' THEN 1.0
            WHEN 'supplier' THEN 0.8
            WHEN 'customer' THEN 0.65
            WHEN 'etf-constituent' THEN 0.5
            ELSE 0.5
          END
        ) AS relation_score,
        COUNT(DISTINCT theme_id) AS theme_diversity,
        MAX(created_at) AS observed_at
      FROM watchlist_candidate
      WHERE ticker = ?
        AND created_at <= ?
    `).get(ticker, asOfIso) as {
      relation_score: number | null;
      theme_diversity: number | null;
      observed_at: string | null;
    };

    const relationScore = secondOrderAgg?.relation_score ?? 0.5;
    const diversity = secondOrderAgg?.theme_diversity ?? 0;
    const diversityScore = Math.max(0, Math.min(1, diversity / 5));
    const secondOrderMomentum = Math.max(
      0,
      Math.min(1, relationScore * 0.7 + diversityScore * 0.3)
    );

    return {
      publicFlowBuy,
      themeAccel,
      secondOrderMomentum,
      observedAt: {
        publicFlow: disclosureAgg?.observed_at ?? null,
        theme: themeAgg?.observed_at ?? null,
        secondOrder: secondOrderAgg?.observed_at ?? null,
      },
    };
  },

  /**
   * Insert multiple disclosure events in a single transaction.
   */
  insertDisclosureEvents(events: InsertDisclosureEvent[]): number[] {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO disclosure_event (
        source, source_url, entity_name, entity_type, owner_type,
        ticker, asset_name, action, tx_date, report_date,
        amount_min, amount_max, sector, industry, confidence, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((events: InsertDisclosureEvent[]) => {
      const ids: number[] = [];
      for (const e of events) {
        const info = stmt.run(
          e.source,
          e.source_url,
          e.entity_name,
          e.entity_type,
          e.owner_type,
          e.ticker,
          e.asset_name,
          e.action,
          e.tx_date,
          e.report_date,
          e.amount_min,
          e.amount_max,
          e.sector,
          e.industry,
          e.confidence,
          e.raw_json
        );
        ids.push(Number(info.lastInsertRowid));
      }
      return ids;
    });

    return insertMany(events);
  },

  /**
   * Query recent disclosure events, optionally filtered by date.
   */
  queryRecentDisclosureEvents(limit = 50, sinceISO?: string): DisclosureEvent[] {
    const db = getDb();
    let sql = `
      SELECT 
        id, source, source_url, entity_name, entity_type, owner_type,
        ticker, asset_name, action, tx_date, report_date,
        amount_min, amount_max, sector, industry, confidence, raw_json, created_at
      FROM disclosure_event
    `;
    const params: (string | number)[] = [];

    if (sinceISO) {
      sql += ` WHERE report_date >= ?`;
      params.push(sinceISO);
    }

    sql += ` ORDER BY report_date DESC LIMIT ?`;
    params.push(limit);

    return db.prepare(sql).all(...params) as DisclosureEvent[];
  },

  /**
   * Upsert sector themes (insert or replace based on window/sector).
   * Returns the inserted/updated theme IDs.
   */
  upsertSectorThemes(themes: InsertSectorTheme[]): number[] {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO sector_theme (window_days, window_start, window_end, sector, score, summary)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING
    `);

    // For simplicity, we'll check if a theme exists and update or insert accordingly
    const upsertMany = db.transaction((themes: InsertSectorTheme[]) => {
      const ids: number[] = [];
      for (const t of themes) {
        // Check if theme exists with same window and sector
        const existing = db.prepare(`
          SELECT id FROM sector_theme 
          WHERE window_days = ? AND sector = ? AND window_start = ? AND window_end = ?
        `).get(t.window_days, t.sector, t.window_start, t.window_end) as { id: number } | undefined;

        if (existing) {
          // Update existing
          db.prepare(`
            UPDATE sector_theme 
            SET score = ?, summary = ?
            WHERE id = ?
          `).run(t.score, t.summary, existing.id);
          ids.push(existing.id);
        } else {
          // Insert new
          const info = stmt.run(t.window_days, t.window_start, t.window_end, t.sector, t.score, t.summary);
          ids.push(Number(info.lastInsertRowid));
        }
      }
      return ids;
    });

    return upsertMany(themes);
  },

  /**
   * Query top sector themes by score for a given window.
   */
  queryTopSectorThemes(windowDays: 7 | 30, limit = 10): SectorTheme[] {
    const db = getDb();
    return db.prepare(`
      SELECT id, window_days, window_start, window_end, sector, score, summary, created_at
      FROM sector_theme
      WHERE window_days = ?
      ORDER BY score DESC
      LIMIT ?
    `).all(windowDays, limit) as SectorTheme[];
  },

  /**
   * Upsert watchlist candidates for a theme.
   */
  upsertWatchlistCandidates(candidates: InsertWatchlistCandidate[]): number[] {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO watchlist_candidate (theme_id, ticker, rationale, relation_type)
      VALUES (?, ?, ?, ?)
    `);

    const insertMany = db.transaction((candidates: InsertWatchlistCandidate[]) => {
      const ids: number[] = [];
      for (const c of candidates) {
        // Check if candidate already exists for this theme/ticker
        const existing = db.prepare(`
          SELECT id FROM watchlist_candidate
          WHERE theme_id = ? AND ticker = ?
        `).get(c.theme_id, c.ticker) as { id: number } | undefined;

        if (existing) {
          // Update existing
          db.prepare(`
            UPDATE watchlist_candidate
            SET rationale = ?, relation_type = ?
            WHERE id = ?
          `).run(c.rationale, c.relation_type, existing.id);
          ids.push(existing.id);
        } else {
          // Insert new
          const info = stmt.run(c.theme_id, c.ticker, c.rationale, c.relation_type);
          ids.push(Number(info.lastInsertRowid));
        }
      }
      return ids;
    });

    return insertMany(candidates);
  },

  /**
   * Query watchlist candidates for a specific theme.
   */
  queryWatchlistCandidates(themeId: number): WatchlistCandidate[] {
    const db = getDb();
    return db.prepare(`
      SELECT id, theme_id, ticker, rationale, relation_type, created_at
      FROM watchlist_candidate
      WHERE theme_id = ?
      ORDER BY ticker
    `).all(themeId) as WatchlistCandidate[];
  },

  /**
   * Query all watchlist candidates (across all themes).
   */
  queryAllWatchlistCandidates(limit = 100): WatchlistCandidate[] {
    const db = getDb();
    return db.prepare(`
      SELECT id, theme_id, ticker, rationale, relation_type, created_at
      FROM watchlist_candidate
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as WatchlistCandidate[];
  },

  getDisclosureEventKeys(sinceISO?: string): Array<{
    source: string;
    entity_name: string;
    ticker: string | null;
    action: "BUY" | "SELL";
    tx_date: string;
    report_date: string;
  }> {
    const db = getDb();
    const params: string[] = [];
    let sql = `SELECT source, entity_name, ticker, action, tx_date, report_date FROM disclosure_event`;
    if (sinceISO) {
      sql += " WHERE report_date >= ?";
      params.push(sinceISO);
    }
    return db.prepare(sql).all(...params) as Array<{
      source: string;
      entity_name: string;
      ticker: string | null;
      action: "BUY" | "SELL";
      tx_date: string;
      report_date: string;
    }>;
  },

  updateDisclosureEventClassification(updates: Array<{ id: number; sector: string | null; industry: string | null }>): number {
    if (updates.length === 0) return 0;
    const db = getDb();
    const stmt = db.prepare(`
      UPDATE disclosure_event
      SET sector = ?, industry = ?
      WHERE id = ?
    `);

    const runMany = db.transaction((rows: Array<{ id: number; sector: string | null; industry: string | null }>) => {
      let count = 0;
      for (const row of rows) {
        stmt.run(row.sector, row.industry, row.id);
        count += 1;
      }
      return count;
    });

    return runMany(updates);
  },
};

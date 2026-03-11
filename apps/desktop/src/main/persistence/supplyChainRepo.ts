/**
 * Supply Chain Repository
 * Manages caching of Llama AI generated supply chain mind-maps
 */

import { getDb } from "./db";
import type { MindMapData } from "@tc/shared/supplyChain";

export const SupplyChainRepo = {
  /**
   * Retrieve cached mind-map data for a company ticker
   * Returns null if not found or expired
   */
  getCached(ticker: string): MindMapData | null {
    const db = getDb();
    const row = db
      .prepare(
        `
      SELECT mind_map_data 
      FROM supply_chain_cache 
      WHERE company_ticker = ? 
        AND expires_at > datetime('now')
    `
      )
      .get(ticker.toUpperCase()) as { mind_map_data: string } | undefined;

    if (!row) return null;

    try {
      return JSON.parse(row.mind_map_data) as MindMapData;
    } catch {
      return null;
    }
  },

  /**
   * Store mind-map data in cache with expiration
   * @param ticker - Company ticker symbol
   * @param data - Mind-map data structure
   * @param ttlDays - Time to live in days (default: 30)
   */
  setCached(ticker: string, data: MindMapData, ttlDays = 30): void {
    const db = getDb();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + ttlDays);

    db.prepare(
      `
      INSERT OR REPLACE INTO supply_chain_cache 
      (company_ticker, mind_map_data, generated_at, expires_at)
      VALUES (?, ?, datetime('now'), ?)
    `
    ).run(ticker.toUpperCase(), JSON.stringify(data), expiresAt.toISOString());
  },

  /**
   * Delete cached data for a specific ticker (force refresh)
   */
  deleteCached(ticker: string): void {
    const db = getDb();
    db.prepare("DELETE FROM supply_chain_cache WHERE company_ticker = ?").run(
      ticker.toUpperCase()
    );
  },

  /**
   * Clean up expired cache entries
   */
  cleanupExpired(): number {
    const db = getDb();
    const result = db
      .prepare("DELETE FROM supply_chain_cache WHERE expires_at < datetime('now')")
      .run();
    return result.changes;
  },

  /**
   * Get all cached tickers (for UI/debugging)
   */
  getAllCachedTickers(): string[] {
    const db = getDb();
    const rows = db
      .prepare("SELECT company_ticker FROM supply_chain_cache ORDER BY generated_at DESC")
      .all() as { company_ticker: string }[];
    return rows.map((r) => r.company_ticker);
  },
};

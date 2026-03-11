import { getDb } from "./db";

// Define types locally since they're not exported from @tc/shared
type WatchlistItem = { id: number; symbol: string; note: string };
type Layout = { id: number; symbol: string; preset: string; data?: unknown };
type Trade = { id: number; symbol: string; side: string; qty: number; price: number; ts: number };
type AuditLog = { id: number; ts: number; actor: string; action: string; detail: string };

export const WatchlistsRepo = {
  list(): WatchlistItem[] {
    const db = getDb();
    return db.prepare("SELECT id, symbol, note FROM watchlists ORDER BY symbol").all();
  },
  add(symbol: string, note = ""): WatchlistItem {
    const db = getDb();
    const info = db.prepare("INSERT INTO watchlists (symbol, note) VALUES (?, ?)").run(symbol, note);
    return { id: Number(info.lastInsertRowid), symbol, note };
  },
  update(id: number, fields: Partial<Pick<WatchlistItem, "symbol" | "note">>): WatchlistItem | null {
    const db = getDb();
    const current = db.prepare("SELECT id, symbol, note FROM watchlists WHERE id = ?").get(id) as WatchlistItem | undefined;
    if (!current) return null;
    const symbol = fields.symbol ?? current.symbol;
    const note = fields.note ?? current.note;
    db.prepare("UPDATE watchlists SET symbol = ?, note = ? WHERE id = ?").run(symbol, note, id);
    return { id, symbol, note };
  },
  remove(id: number): boolean {
    const db = getDb();
    const info = db.prepare("DELETE FROM watchlists WHERE id = ?").run(id);
    return info.changes > 0;
  },
};

export const LayoutsRepo = {
  list(symbol?: string): Layout[] {
    const db = getDb();
    if (symbol) {
      return db.prepare("SELECT id, symbol, preset, data FROM layouts WHERE symbol = ? ORDER BY id DESC").all(symbol);
    }
    return db.prepare("SELECT id, symbol, preset, data FROM layouts ORDER BY id DESC").all();
  },
  setPreset(symbol: string, preset: string, data: unknown = null): Layout {
    const db = getDb();
    const info = db.prepare("INSERT INTO layouts (symbol, preset, data) VALUES (?, ?, ?)").run(symbol, preset, data ? JSON.stringify(data) : null);
    return { id: Number(info.lastInsertRowid), symbol, preset, data };
  },
};

export const TradesRepo = {
  record(trade: Omit<Trade, "id">): Trade {
    const db = getDb();
    const info = db
      .prepare("INSERT INTO trades (symbol, side, qty, price, ts) VALUES (?, ?, ?, ?, ?)")
      .run(trade.symbol, trade.side, trade.qty, trade.price, trade.ts);
    return { id: Number(info.lastInsertRowid), ...trade };
  },
  list(): Trade[] {
    const db = getDb();
    return db.prepare("SELECT id, symbol, side, qty, price, ts FROM trades ORDER BY ts DESC").all();
  },
};

export const AuditRepo = {
  record(action: string, detail = "", actor = "system"): AuditLog {
    const db = getDb();
    const ts = Date.now();
    const info = db
      .prepare("INSERT INTO audit_log (ts, actor, action, detail) VALUES (?, ?, ?, ?)")
      .run(ts, actor, action, detail);
    return { id: Number(info.lastInsertRowid), ts, actor, action, detail };
  },
  list(): AuditLog[] {
    const db = getDb();
    return db.prepare("SELECT id, ts, actor, action, detail FROM audit_log ORDER BY ts DESC").all();
  },
};

export const AppSettingsRepo = {
  get(): Record<string, unknown> {
    const db = getDb();
    const row = db.prepare("SELECT data FROM app_settings WHERE id = 1").get() as
      | { data: string }
      | undefined;
    try {
      return JSON.parse(row?.data ?? "{}");
    } catch {
      return {};
    }
  },
  set(next: Record<string, unknown>): void {
    const db = getDb();
    db.prepare("INSERT OR REPLACE INTO app_settings (id, data) VALUES (1, ?)").run(
      JSON.stringify(next),
    );
  },
};

export interface PaperTrade {
  id: number;
  order_id_entry: string;
  order_id_exit?: string;
  symbol: string;
  side: "buy" | "sell";
  entry_qty: number;
  entry_price: number;
  entry_ts: number;
  exit_price?: number;
  exit_ts?: number;
  entry_screenshot_path?: string;
  exit_screenshot_path?: string;
  setup?: string;
  regime?: string;
  catalyst?: string;
  execution_type?: string;
  mistakes?: string;
  notes?: string;
  mae?: number;
  mfe?: number;
  time_in_trade?: number;
  slippage?: number;
  costs?: number;
  adherence_score?: number;
  created_at: number;
  updated_at: number;
  tags?: { tag_type: string; tag_value: string }[];
}

export interface TradeTag {
  id: number;
  trade_id: number;
  tag_type: "setup" | "regime" | "catalyst" | "execution" | "mistake";
  tag_value: string;
}

export const TradesJournalRepo = {
  // Create entry trade (filled on entry)
  createEntry(
    orderIdEntry: string,
    symbol: string,
    side: "buy" | "sell",
    entryQty: number,
    entryPrice: number,
    entryTs: number,
    entryScreenshotPath?: string
  ): PaperTrade {
    const db = getDb();
    const now = Date.now();
    const info = db
      .prepare(`
        INSERT INTO paper_trades (
          order_id_entry, symbol, side, entry_qty, entry_price, entry_ts,
          entry_screenshot_path, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(orderIdEntry, symbol, side, entryQty, entryPrice, entryTs, entryScreenshotPath || null, now, now);

    return this.getById(Number(info.lastInsertRowid))!;
  },

  // Update exit trade
  recordExit(
    tradeId: number,
    orderIdExit: string,
    exitPrice: number,
    exitTs: number,
    exitScreenshotPath?: string
  ): PaperTrade | null {
    const db = getDb();
    const now = Date.now();

    const existing = db.prepare("SELECT * FROM paper_trades WHERE id = ?").get(tradeId) as PaperTrade | undefined;
    if (!existing) return null;

    // Calculate MAE/MFE
    const mae = this.calculateMAE(existing.side, existing.entry_price, exitPrice);
    const mfe = this.calculateMFE(existing.side, existing.entry_price, exitPrice);
    const timeInTrade = exitTs - existing.entry_ts;
    const slippage = Math.abs(exitPrice - existing.entry_price);

    db.prepare(`
      UPDATE paper_trades SET
        order_id_exit = ?, exit_price = ?, exit_ts = ?,
        exit_screenshot_path = ?, mae = ?, mfe = ?,
        time_in_trade = ?, slippage = ?,
        updated_at = ?
      WHERE id = ?
    `).run(orderIdExit, exitPrice, exitTs, exitScreenshotPath || null, mae, mfe, timeInTrade, slippage, now, tradeId);

    return this.getById(tradeId);
  },

  // Get trade by ID with tags
  getById(id: number): PaperTrade | null {
    const db = getDb();
    const trade = db.prepare("SELECT * FROM paper_trades WHERE id = ?").get(id) as PaperTrade | undefined;
    if (!trade) return null;

    const tags = db.prepare("SELECT tag_type, tag_value FROM trade_tags WHERE trade_id = ?").all(id) as { tag_type: string; tag_value: string }[];
    trade.tags = tags;

    return trade;
  },

  // Get trades by date range
  listByDateRange(startTs: number, endTs: number): PaperTrade[] {
    const db = getDb();
    const trades = db
      .prepare(`
        SELECT * FROM paper_trades
        WHERE entry_ts >= ? AND entry_ts <= ?
        ORDER BY entry_ts DESC
      `)
      .all(startTs, endTs) as PaperTrade[];

    // Attach tags
    for (const trade of trades) {
      const tags = db.prepare("SELECT tag_type, tag_value FROM trade_tags WHERE trade_id = ?").all(trade.id) as { tag_type: string; tag_value: string }[];
      trade.tags = tags;
    }

    return trades;
  },

  // Get today's trades
  getTodayTrades(): PaperTrade[] {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const endOfDay = startOfDay + 24 * 60 * 60 * 1000;
    return this.listByDateRange(startOfDay, endOfDay);
  },

  // Get all closed trades (with exit)
  getClosedTrades(limit = 100): PaperTrade[] {
    const db = getDb();
    const trades = db
      .prepare(`
        SELECT * FROM paper_trades
        WHERE exit_ts IS NOT NULL
        ORDER BY exit_ts DESC
        LIMIT ?
      `)
      .all(limit) as PaperTrade[];

    for (const trade of trades) {
      const tags = db.prepare("SELECT tag_type, tag_value FROM trade_tags WHERE trade_id = ?").all(trade.id) as { tag_type: string; tag_value: string }[];
      trade.tags = tags;
    }

    return trades;
  },

  // Add tags to trade
  addTags(tradeId: number, tags: { tag_type: "setup" | "regime" | "catalyst" | "execution" | "mistake"; tag_value: string }[]): void {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO trade_tags (trade_id, tag_type, tag_value)
      VALUES (?, ?, ?)
    `);

    for (const tag of tags) {
      stmt.run(tradeId, tag.tag_type, tag.tag_value);
    }
  },

  // Update trade metadata
  updateMetadata(
    tradeId: number,
    metadata: Partial<Pick<PaperTrade, "setup" | "regime" | "catalyst" | "execution_type" | "mistakes" | "notes" | "adherence_score" | "costs">>
  ): PaperTrade | null {
    const db = getDb();
    const now = Date.now();
    const current = this.getById(tradeId);
    if (!current) return null;

    const updates: string[] = [];
    const values: unknown[] = [];

    if (metadata.setup !== undefined) {
      updates.push("setup = ?");
      values.push(metadata.setup);
    }
    if (metadata.regime !== undefined) {
      updates.push("regime = ?");
      values.push(metadata.regime);
    }
    if (metadata.catalyst !== undefined) {
      updates.push("catalyst = ?");
      values.push(metadata.catalyst);
    }
    if (metadata.execution_type !== undefined) {
      updates.push("execution_type = ?");
      values.push(metadata.execution_type);
    }
    if (metadata.mistakes !== undefined) {
      updates.push("mistakes = ?");
      values.push(metadata.mistakes);
    }
    if (metadata.notes !== undefined) {
      updates.push("notes = ?");
      values.push(metadata.notes);
    }
    if (metadata.adherence_score !== undefined) {
      updates.push("adherence_score = ?");
      values.push(metadata.adherence_score);
    }
    if (metadata.costs !== undefined) {
      updates.push("costs = ?");
      values.push(metadata.costs);
    }

    updates.push("updated_at = ?");
    values.push(now);
    values.push(tradeId);

    if (updates.length > 1) {
      const sql = `UPDATE paper_trades SET ${updates.join(", ")} WHERE id = ?`;
      db.prepare(sql).run(...values);
    }

    return this.getById(tradeId);
  },

  // Get session stats
  getSessionStats(startTs: number, endTs: number): {
    totalTrades: number;
    closedTrades: number;
    winningTrades: number;
    losingTrades: number;
    totalPnl: number;
    winRate: number;
    avgMae: number;
    avgMfe: number;
    avgTimeInTrade: number;
  } {
    const trades = this.listByDateRange(startTs, endTs);
    const closed = trades.filter((t) => t.exit_ts);

    let totalPnl = 0;
    let winningTrades = 0;
    let losingTrades = 0;
    let totalMae = 0;
    let totalMfe = 0;
    let totalTime = 0;

    for (const trade of closed) {
      if (!trade.exit_price) continue;
      const pnl = this.calculatePnL(trade.side, trade.entry_qty, trade.entry_price, trade.exit_price);
      totalPnl += pnl;

      if (pnl > 0) winningTrades++;
      else if (pnl < 0) losingTrades++;

      if (trade.mae) totalMae += trade.mae;
      if (trade.mfe) totalMfe += trade.mfe;
      if (trade.time_in_trade) totalTime += trade.time_in_trade;
    }

    const closedCount = closed.length;
    return {
      totalTrades: trades.length,
      closedTrades: closedCount,
      winningTrades,
      losingTrades,
      totalPnl,
      winRate: closedCount > 0 ? (winningTrades / closedCount) * 100 : 0,
      avgMae: closedCount > 0 ? totalMae / closedCount : 0,
      avgMfe: closedCount > 0 ? totalMfe / closedCount : 0,
      avgTimeInTrade: closedCount > 0 ? totalTime / closedCount : 0,
    };
  },

  // Helpers
  calculateMAE(side: string, entry: number, exit: number): number {
    if (side === "buy") {
      return Math.max(0, entry - exit);
    } else {
      return Math.max(0, exit - entry);
    }
  },

  calculateMFE(side: string, entry: number, exit: number): number {
    if (side === "buy") {
      return Math.max(0, exit - entry);
    } else {
      return Math.max(0, entry - exit);
    }
  },

  calculatePnL(side: string, qty: number, entryPrice: number, exitPrice: number): number {
    if (side === "buy") {
      return (exitPrice - entryPrice) * qty;
    } else {
      return (entryPrice - exitPrice) * qty;
    }
  },
};

// Re-export PublicFlowRepo
export { PublicFlowRepo } from "./publicFlowRepo";

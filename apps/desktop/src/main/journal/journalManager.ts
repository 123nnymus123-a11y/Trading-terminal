import { BrowserWindow } from "electron";
import type { Fill } from "../adapters/paperTradingAdapter";
import { TradesJournalRepo, type PaperTrade } from "../persistence/repos";
import { captureScreenshot, getScreenshotDir } from "./screenshotCapture";

export interface JournalEntry {
  tradeId: number;
  symbol: string;
  side: string;
  entryPrice: number;
  entryTs: number;
  exitPrice?: number;
  exitTs?: number;
  entryScreenshot?: string;
  exitScreenshot?: string;
}

export class JournalManager {
  private pendingEntries: Map<string, { tradeId: number; fill: Fill }> = new Map();
  private window: BrowserWindow | null = null;
  private screenshotDir: string;

  constructor() {
    this.screenshotDir = getScreenshotDir();
  }

  setWindow(window: BrowserWindow): void {
    this.window = window;
  }

  /**
   * Handle a fill event - create or update journal entry
   */
  async handleFill(fill: Fill): Promise<PaperTrade | null> {
    const { orderId, symbol, side, qty, price, ts } = fill;

    try {
      // Check if this completes an existing position
      const existingEntry = this.findExistingEntryForSymbol(symbol);

      if (!existingEntry) {
        // This is a new entry - capture entry screenshot
        console.log(`[JournalManager] Recording entry fill: ${orderId} ${side} ${qty} ${symbol} @ ${price}`);

        let entryScreenshot: string | undefined;
        if (this.window) {
          try {
            entryScreenshot = await captureScreenshot(this.window, this.screenshotDir);
          } catch (err) {
            console.error("[JournalManager] Failed to capture entry screenshot:", err);
          }
        }

        const trade = TradesJournalRepo.createEntry(orderId, symbol, side.toLowerCase() as "buy" | "sell", qty, price, ts, entryScreenshot);
        this.pendingEntries.set(symbol, { tradeId: trade.id, fill });

        console.log(`[JournalManager] Created journal entry: trade_id=${trade.id}`);
        return trade;
      } else {
        // This is an exit - capture exit screenshot and record
        console.log(`[JournalManager] Recording exit fill: ${orderId} ${side} ${qty} ${symbol} @ ${price}`);

        let exitScreenshot: string | undefined;
        if (this.window) {
          try {
            exitScreenshot = await captureScreenshot(this.window, this.screenshotDir);
          } catch (err) {
            console.error("[JournalManager] Failed to capture exit screenshot:", err);
          }
        }

        const { tradeId } = existingEntry;
        const trade = TradesJournalRepo.recordExit(tradeId, orderId, price, ts, exitScreenshot);
        this.pendingEntries.delete(symbol);

        console.log(`[JournalManager] Recorded trade exit: trade_id=${tradeId}`);
        return trade;
      }
    } catch (err) {
      console.error("[JournalManager] Error handling fill:", err);
      return null;
    }
  }

  /**
   * Add tags to a trade
   */
  addTags(
    tradeId: number,
    tags: { tag_type: "setup" | "regime" | "catalyst" | "execution" | "mistake"; tag_value: string }[]
  ): void {
    TradesJournalRepo.addTags(tradeId, tags);
  }

  /**
   * Update trade metadata
   */
  updateTradeMetadata(
    tradeId: number,
    metadata: {
      setup?: string;
      regime?: string;
      catalyst?: string;
      execution_type?: string;
      mistakes?: string;
      notes?: string;
      adherence_score?: number;
      costs?: number;
    }
  ): PaperTrade | null {
    return TradesJournalRepo.updateMetadata(tradeId, metadata);
  }

  /**
   * Get today's trades
   */
  getTodayTrades(): PaperTrade[] {
    return TradesJournalRepo.getTodayTrades();
  }

  /**
   * Get session statistics
   */
  getSessionStats(startTs: number, endTs: number) {
    return TradesJournalRepo.getSessionStats(startTs, endTs);
  }

  /**
   * Get closed trades
   */
  getClosedTrades(limit = 100): PaperTrade[] {
    return TradesJournalRepo.getClosedTrades(limit);
  }

  /**
   * Get trade by ID
   */
  getTradeById(tradeId: number): PaperTrade | null {
    return TradesJournalRepo.getById(tradeId);
  }

  /**
   * Find existing entry for a symbol (for exit matching)
   */
  private findExistingEntryForSymbol(symbol: string): { tradeId: number; fill: Fill } | null {
    return this.pendingEntries.get(symbol) || null;
  }
}

// Singleton instance
let journalManagerInstance: JournalManager | null = null;

export function getJournalManager(): JournalManager {
  if (!journalManagerInstance) {
    journalManagerInstance = new JournalManager();
  }
  return journalManagerInstance;
}

import { WatchlistAggregator } from "./watchlistAggregator";
import { PublicFlowRepo } from "../../persistence/publicFlowRepo";
import { recomputePublicFlowIntel } from "./recomputeIntel";

/**
 * Public Flow Pipeline Runner
 * 
 * Orchestrates the complete Public Flow Intel pipeline:
 * 1. Extract themes from recent disclosure events
 * 2. Rank candidates for each theme
 * 3. Aggregate into final watchlist
 *
 * This runs on app startup (or can be triggered manually for refresh).
 */

let pipelineRunning = false;

export const PublicFlowPipeline = {
  /**
   * Run the complete Public Flow Intel pipeline.
   * Safe to call repeatedly; will skip if already running.
   */
  async run(): Promise<void> {
    if (pipelineRunning) {
      console.log("[PublicFlowPipeline] Pipeline already running, skipping...");
      return;
    }

    pipelineRunning = true;
    console.log("[PublicFlowPipeline] Starting pipeline execution...");

    try {
      const startTime = Date.now();

      // Step 1: Recompute intel (themes + second-order candidates)
      console.log("[PublicFlowPipeline] Step 1: Recomputing intel...");
      const recomputeSummary = await recomputePublicFlowIntel();

      // Step 2: Generate final watchlist from latest candidates
      console.log("[PublicFlowPipeline] Step 2: Aggregating watchlist...");
      const watchlist = WatchlistAggregator.generateWatchlist(50);
      const summary = WatchlistAggregator.getSummary(watchlist);

      const elapsed = Date.now() - startTime;
      console.log(
        `[PublicFlowPipeline] Pipeline complete in ${elapsed}ms. ${summary} | events=${recomputeSummary.eventsConsidered}, themes=${recomputeSummary.windows.map((w) => `${w.windowDays}d:${w.themeCount}`).join("/")}, candidates=${recomputeSummary.secondOrder.candidatesUpserted}`
      );
    } catch (error) {
      console.error("[PublicFlowPipeline] Pipeline execution failed:", error);
    } finally {
      pipelineRunning = false;
    }
  },

  /**
   * Get current watchlist (without re-running pipeline).
   */
  getWatchlist() {
    return WatchlistAggregator.generateWatchlist(50);
  },

  /**
   * Check pipeline status.
   */
  isRunning(): boolean {
    return pipelineRunning;
  },

  /**
   * Get stats about current data in database.
   */
  getStats() {
    const db = require("../../persistence/db").getDb();
    const disclosures = (db.prepare("SELECT COUNT(*) as count FROM disclosure_event").get() as { count: number })
      .count;
    const themes = (db.prepare("SELECT COUNT(*) as count FROM sector_theme").get() as { count: number }).count;
    const candidates = (db.prepare("SELECT COUNT(*) as count FROM watchlist_candidate").get() as { count: number })
      .count;

    return {
      disclosures,
      themes,
      candidates,
    };
  },
};

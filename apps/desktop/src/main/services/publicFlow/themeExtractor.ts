import { PublicFlowRepo } from "../../persistence/publicFlowRepo";
import type { InsertSectorTheme, DisclosureEvent } from "@tc/shared";

/**
 * Theme Extractor: Analyzes disclosure events and extracts sector themes.
 * Groups events by sector/window and calculates theme scores based on:
 * - Count of BUY actions (positive signal)
 * - Count of SELL actions (negative signal)
 * - Average confidence of events
 * - Dollar amount of transactions
 */

/**
 * Extract themes for a specific window (7 or 30 days).
 */
function extractThemesForWindow(events: DisclosureEvent[], windowDays: 7 | 30): InsertSectorTheme[] {
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const windowStartISO = windowStart.toISOString();
  const windowEndISO = now.toISOString();

  // Filter events within the window
  const windowEvents = events.filter((e) => e.report_date >= windowStartISO);

  // Group by sector
  const sectorGroups = new Map<string, DisclosureEvent[]>();
  for (const event of windowEvents) {
    const sector = event.sector || "Unknown";
    if (!sectorGroups.has(sector)) {
      sectorGroups.set(sector, []);
    }
    sectorGroups.get(sector)!.push(event);
  }

  // Calculate theme scores
  const themes: InsertSectorTheme[] = [];
  for (const [sector, sectorEvents] of sectorGroups) {
    const score = calculateThemeScore(sectorEvents);
    const summary = generateThemeSummary(sectorEvents, sector);

    themes.push({
      window_days: windowDays,
      window_start: windowStartISO,
      window_end: windowEndISO,
      sector,
      score,
      summary,
      created_at: new Date().toISOString(),
    });
  }

  return themes;
}

/**
 * Calculate theme score based on event characteristics.
 * Score range: 0.0 to 1.0
 *
 * Factors:
 * - Buy/Sell ratio (more buys = higher score)
 * - Average confidence
 * - Event count (more activity = more signal)
 * - Transaction size (larger = more significant)
 */
function calculateThemeScore(events: DisclosureEvent[]): number {
  if (events.length === 0) return 0;

  // Buy/Sell sentiment
  const buys = events.filter((e) => e.action === "BUY").length;
  const sells = events.filter((e) => e.action === "SELL").length;
  const total = buys + sells;
  const sentimentScore = total > 0 ? (buys - sells) / total : 0;

  // Average confidence
  const avgConfidence = events.reduce((sum, e) => sum + e.confidence, 0) / events.length;

  // Volume factor (normalized transaction count)
  const volumeFactor = Math.min(events.length / 10, 1);

  // Combine factors: sentiment (40%) + confidence (40%) + volume (20%)
  const score = sentimentScore * 0.4 + avgConfidence * 0.4 + volumeFactor * 0.2;

  // Normalize to 0..1 range
  return Math.max(0, Math.min(1, (score + 1) / 2));
}

/**
 * Generate a brief summary of the theme.
 */
function generateThemeSummary(events: DisclosureEvent[], sector: string): string {
  const buys = events.filter((e) => e.action === "BUY").length;
  const sells = events.filter((e) => e.action === "SELL").length;
  const totalAmount = events.reduce((sum, e) => (e.amount_max || 0) + (e.amount_min || 0), 0);
  const avgConfidence = (events.reduce((sum, e) => sum + e.confidence, 0) / events.length * 100).toFixed(0);

  const sentiment = buys > sells ? "bullish" : sells > buys ? "bearish" : "neutral";
  const amountStr =
    totalAmount > 1e9
      ? `$${(totalAmount / 1e9).toFixed(1)}B`
      : totalAmount > 1e6
        ? `$${(totalAmount / 1e6).toFixed(1)}M`
        : `$${totalAmount.toLocaleString()}`;

  return `${sector}: ${sentiment} sentiment (${buys}B/${sells}S) • ${amountStr} activity • ${avgConfidence}% avg confidence`;
}

export const ThemeExtractor = {
  /**
   * Extract themes from recent disclosure events.
   * Processes both 7-day and 30-day windows.
   */
  extractThemesFromRecentEvents(): void {
    console.log("[ThemeExtractor] Starting theme extraction...");

    // Get recent events (past 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const events = PublicFlowRepo.queryRecentDisclosureEvents(1000, thirtyDaysAgo);

    if (events.length === 0) {
      console.log("[ThemeExtractor] No recent disclosure events found.");
      return;
    }

    // Extract themes for both 7-day and 30-day windows
    const sevenDayThemes = extractThemesForWindow(events, 7);
    const thirtyDayThemes = extractThemesForWindow(events, 30);

    // Upsert themes
    const allThemes = [...sevenDayThemes, ...thirtyDayThemes];
    if (allThemes.length > 0) {
      const ids = PublicFlowRepo.upsertSectorThemes(allThemes);
      console.log(`[ThemeExtractor] Extracted and upserted ${ids.length} themes.`);
    } else {
      console.log("[ThemeExtractor] No themes extracted.");
    }
  },
};

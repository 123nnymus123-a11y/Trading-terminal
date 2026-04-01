import { PublicFlowRepo } from "../../persistence/publicFlowRepo";
import type { } from "@tc/shared";

/**
 * Watchlist Aggregator: Combines themes and candidates into a ranked watchlist.
 * 
 * Creates a consolidated view of the most promising investment opportunities
 * based on:
 * - Theme strength (sector score)
 * - Candidate relevance (relation type)
 * - Data recency
 */

export interface WatchlistEntry {
  ticker: string;
  themeId: number;
  themeSector: string;
  themeScore: number;
  themeWindow: 7 | 30;
  candidateId: number;
  relationType: "peer" | "supplier" | "customer" | "etf-constituent";
  rationale: string;
  overallScore: number;
  rank: number;
}

/**
 * Get scoring weight for relation type.
 * Peer relationships are weighted highest, then suppliers, then customers.
 */
function getRelationTypeScore(relationType: string): number {
  switch (relationType) {
    case "peer":
      return 1.0; // Highest weight: direct competitors/peers
    case "supplier":
      return 0.75; // Good: upside from sector strength
    case "customer":
      return 0.6; // Moderate: indirect exposure
    case "etf-constituent":
      return 0.5; // Lower: broad exposure
    default:
      return 0.5;
  }
}

/**
 * Get human-readable watchlist summary.
 */
function getSummary(watchlist: WatchlistEntry[]): string {
  if (watchlist.length === 0) {
    return "No watchlist entries available.";
  }

  const topEntries = watchlist.slice(0, 5);
  const sectors = new Set(topEntries.map((e) => e.themeSector));
  const relationTypes = new Map<string, number>();

  for (const entry of watchlist) {
    relationTypes.set(entry.relationType, (relationTypes.get(entry.relationType) || 0) + 1);
  }

  const relationStr = Array.from(relationTypes.entries())
    .map(([type, count]) => `${count}x ${type}`)
    .join(", ");

  return `Watchlist: ${watchlist.length} candidates from ${sectors.size} sectors (${relationStr}) | Top: ${topEntries.map((e) => e.ticker).join(", ")}`;
}

export const WatchlistAggregator = {
  /**
   * Generate a consolidated watchlist from current themes and candidates.
   * Returns top candidates ranked by a combination of theme strength and relation type.
   */
  generateWatchlist(limit = 50): WatchlistEntry[] {
    console.log("[WatchlistAggregator] Generating consolidated watchlist...");

    // Get top themes (7-day window for freshness, limit to top 10)
    const topThemes = PublicFlowRepo.queryTopSectorThemes(7, 10);

    if (topThemes.length === 0) {
      console.log("[WatchlistAggregator] No themes available. Run theme extraction first.");
      return [];
    }

    // For each theme, get its candidates
    const entries: WatchlistEntry[] = [];
    for (const theme of topThemes) {
      const candidates = PublicFlowRepo.queryWatchlistCandidates(theme.id);
      for (const candidate of candidates) {
        // Calculate overall score: blend of theme strength + relation quality
        const relationScore = getRelationTypeScore(candidate.relation_type);
        const normalizedThemeScore = theme.score > 1 ? theme.score / 100 : theme.score;
        const overallScore = normalizedThemeScore * 0.7 + relationScore * 0.3;

        entries.push({
          ticker: candidate.ticker,
          themeId: theme.id,
          themeSector: theme.sector,
          themeScore: theme.score,
          themeWindow: theme.window_days,
          candidateId: candidate.id,
          relationType: candidate.relation_type as "peer" | "supplier" | "customer" | "etf-constituent",
          rationale: candidate.rationale,
          overallScore,
          rank: 0, // Will be set after sorting
        });
      }
    }

    // Sort by overall score descending
    entries.sort((a, b) => b.overallScore - a.overallScore);

    // Assign ranks
    entries.forEach((entry, index) => {
      entry.rank = index + 1;
    });

    // Return top N
    const result = entries.slice(0, limit);
    console.log(`[WatchlistAggregator] Generated watchlist with ${result.length} entries.`);
    return result;
  },

  /**
   * Get human-readable watchlist summary.
   */
  getSummary(watchlist: WatchlistEntry[]): string {
    return getSummary(watchlist);
  },
};

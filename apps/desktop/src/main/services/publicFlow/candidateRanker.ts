import { PublicFlowRepo } from "../../persistence/publicFlowRepo";
import type { InsertWatchlistCandidate, SectorTheme } from "@tc/shared";

/**
 * Candidate Ranker: Identifies related companies for each sector theme.
 * 
 * Uses heuristic relationships:
 * - Peer companies (same sector/industry)
 * - Suppliers (related industries that support this sector)
 * - Customers (industries that consume from this sector)
 * - ETF constituents (broad index exposure)
 *
 * This is a simplified implementation using hardcoded sector relationships.
 * In production, this would use company relationship data from external sources.
 */

interface CompanyInfo {
  ticker: string;
  industry: string;
  sector: string;
}

// Simplified company database
const COMPANY_MAP: Record<string, CompanyInfo> = {
  // Semiconductors
  NVDA: { ticker: "NVDA", industry: "Semiconductors", sector: "Technology" },
  AMD: { ticker: "AMD", industry: "Semiconductors", sector: "Technology" },
  INTC: { ticker: "INTC", industry: "Semiconductors", sector: "Technology" },
  QCOM: { ticker: "QCOM", industry: "Semiconductors", sector: "Technology" },
  AVGO: { ticker: "AVGO", industry: "Semiconductors", sector: "Technology" },

  // Semiconductor Equipment
  ASML: { ticker: "ASML", industry: "Semiconductor Equipment", sector: "Technology" },
  LRCX: { ticker: "LRCX", industry: "Semiconductor Equipment", sector: "Technology" },

  // Cloud/Software
  MSFT: { ticker: "MSFT", industry: "Cloud Computing", sector: "Technology" },
  GOOGL: { ticker: "GOOGL", industry: "Cloud Computing", sector: "Technology" },
  AMZN: { ticker: "AMZN", industry: "Cloud Computing", sector: "Consumer Cyclical" },
  CRM: { ticker: "CRM", industry: "Software", sector: "Technology" },
  NFLX: { ticker: "NFLX", industry: "Streaming", sector: "Communication Services" },

  // EV/Auto
  TSLA: { ticker: "TSLA", industry: "Electric Vehicles", sector: "Consumer Cyclical" },
  F: { ticker: "F", industry: "Automotive", sector: "Consumer Cyclical" },
  GM: { ticker: "GM", industry: "Automotive", sector: "Consumer Cyclical" },
  LCID: { ticker: "LCID", industry: "Electric Vehicles", sector: "Consumer Cyclical" },

  // Battery/Materials
  LI: { ticker: "LI", industry: "Battery/EV", sector: "Consumer Cyclical" },
  CATL: { ticker: "CATL", industry: "Battery", sector: "Consumer Cyclical" },

  // Financials
  JPM: { ticker: "JPM", industry: "Banking", sector: "Financials" },
  BAC: { ticker: "BAC", industry: "Banking", sector: "Financials" },
  GS: { ticker: "GS", industry: "Banking", sector: "Financials" },
  BLK: { ticker: "BLK", industry: "Asset Management", sector: "Financials" },

  // Energy
  XOM: { ticker: "XOM", industry: "Oil & Gas", sector: "Energy" },
  CVX: { ticker: "CVX", industry: "Oil & Gas", sector: "Energy" },
  COP: { ticker: "COP", industry: "Oil & Gas", sector: "Energy" },

  // Healthcare
  JNJ: { ticker: "JNJ", industry: "Pharma", sector: "Healthcare" },
  PFE: { ticker: "PFE", industry: "Pharma", sector: "Healthcare" },
  ABBV: { ticker: "ABBV", industry: "Pharma", sector: "Healthcare" },
  UNH: { ticker: "UNH", industry: "Healthcare", sector: "Healthcare" },
};

// Sector relationship map: who supplies, who consumes
const SECTOR_RELATIONSHIPS: Record<string, { peers: string[]; suppliers: string[]; customers: string[] }> = {
  Technology: {
    peers: ["Technology"],
    suppliers: ["Consumer Cyclical"],
    customers: ["Financials", "Healthcare", "Energy"],
  },
  "Consumer Cyclical": {
    peers: ["Consumer Cyclical"],
    suppliers: ["Technology", "Energy"],
    customers: ["Technology", "Financials"],
  },
  Financials: {
    peers: ["Financials"],
    suppliers: ["Technology"],
    customers: ["Consumer Cyclical", "Healthcare", "Energy"],
  },
  Energy: {
    peers: ["Energy"],
    suppliers: ["Technology", "Consumer Cyclical"],
    customers: ["Financials", "Consumer Cyclical"],
  },
  Healthcare: {
    peers: ["Healthcare"],
    suppliers: ["Technology"],
    customers: ["Financials"],
  },
};

/**
 * Generate candidates for a single theme.
 */
function generateCandidatesForTheme(theme: SectorTheme): InsertWatchlistCandidate[] {
  const _candidates: InsertWatchlistCandidate[] = [];

  // Get sector relationships
  const relationships = SECTOR_RELATIONSHIPS[theme.sector] || {
    peers: [theme.sector],
    suppliers: [],
    customers: [],
  };

  // Find companies matching each relationship type
  const peerCandidates = findCompaniesByIndustry(relationships.peers);
  const supplierCandidates = findCompaniesByIndustry(relationships.suppliers);
  const customerCandidates = findCompaniesByIndustry(relationships.customers);

  // Add candidates with diverse rationales
  const allCandidates = [
    ...peerCandidates.map((ticker) => ({
      ticker,
      relationType: "peer" as const,
      rationale: `Direct peer in ${theme.sector} with correlated dynamics`,
    })),
    ...supplierCandidates.map((ticker) => ({
      ticker,
      relationType: "supplier" as const,
      rationale: `Supplier to ${theme.sector}; benefits from positive sector momentum`,
    })),
    ...customerCandidates.map((ticker) => ({
      ticker,
      relationType: "customer" as const,
      rationale: `Customer of ${theme.sector}; exposed to sector-specific opportunities`,
    })),
  ];

  // Convert to InsertWatchlistCandidate
  const now = new Date().toISOString();
  const result: InsertWatchlistCandidate[] = allCandidates.map((c) => ({
    theme_id: theme.id,
    ticker: c.ticker,
    rationale: c.rationale,
    relation_type: c.relationType,
    created_at: now,
  }));

  return result;
}

/**
 * Find companies in specified industries.
 */
function findCompaniesByIndustry(sectors: string[]): string[] {
  const result: string[] = [];
  for (const [ticker, info] of Object.entries(COMPANY_MAP)) {
    if (sectors.includes(info.sector)) {
      result.push(ticker);
    }
  }
  return result;
}

export const CandidateRanker = {
  /**
   * Generate watchlist candidates for themes.
   * For each theme, identifies related companies.
   */
  rankCandidatesForThemes(themes: SectorTheme[]): void {
    console.log(`[CandidateRanker] Ranking candidates for ${themes.length} themes...`);

    for (const theme of themes) {
      const candidates = generateCandidatesForTheme(theme);
      if (candidates.length > 0) {
        const ids = PublicFlowRepo.upsertWatchlistCandidates(candidates);
        console.log(`[CandidateRanker] Created ${ids.length} candidates for theme "${theme.sector}" (${theme.window_days}d)`);
      }
    }
  },
};

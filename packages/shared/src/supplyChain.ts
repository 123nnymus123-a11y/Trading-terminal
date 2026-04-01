/**
 * Supply Chain Mind-Map Types
 * Defines the data structure for company business relationships
 */

export type RiskSeverity = "low" | "medium" | "high" | "critical";

export type SupplyChainRiskType =
  | "geopolitical"
  | "regulatory"
  | "capacity"
  | "single-supplier"
  | "logistics"
  | "financial"
  | "cyber"
  | "other";

export type SupplyChainEntityType =
  | "company"
  | "facility"
  | "infrastructure"
  | "region";

export type SupplyChainTier = "direct" | "indirect" | "systemic";

export type DependencyKind =
  | "supplies"
  | "manufactures"
  | "assembles"
  | "hosts"
  | "distributes"
  | "transports"
  | "regulates"
  | "finances"
  | "licenses"
  | "supports"
  | "supplier"
  | "customer"
  | "partner"
  | "license"
  | "litigation"
  | "financing"
  | "competitor"
  | "regulatory"
  | "other";

export type SupplyChainStatus = "normal" | "degraded" | "failed";

export type OfficialSourceKind =
  | "sec_filing"
  | "annual_report"
  | "ir_presentation"
  | "press_release"
  | "regulator_dataset"
  | "other_official";

export type SupplyChainEvidenceStatus = "verified_official" | "hypothesis";

export interface CompanyNode {
  /** Company ticker or unique identifier */
  id: string;
  /** Company full name */
  name: string;
  /** Canonical name (normalized for entity resolution) */
  canonicalName?: string;
  /** Known ticker symbols for the company */
  tickers?: string[];
  /** Common identifiers (CIK/LEI/ISIN/etc.) */
  identifiers?: {
    cik?: string;
    lei?: string;
    isin?: string;
    cusip?: string;
  };
  /** Short description of role/relationship */
  role: string;
  /** Optional: Estimated annual revenue impact in USD */
  revenueImpact?: number;
  /** Relationship strength/criticality: 1-5 (5 = critical) */
  criticality: 1 | 2 | 3 | 4 | 5;
  /** Year the relationship started */
  since?: number;
  /** Confidence in this relationship data: 0.0 (guess) to 1.0 (verified fact) */
  confidence: number;
  /** Whether this data is from a verified source vs AI estimate */
  verified: boolean;
  /** Data source/attribution (e.g., "10-K filing 2023", "AI estimate") */
  source?: string;
  /** Last time this company entity was updated */
  lastUpdated?: string;
  /** Additional metadata */
  metadata?: {
    hqCity?: string;
    hqState?: string;
    hqCountry?: string;
    hqRegion?: string;
    hqLat?: number;
    hqLon?: number;
    hqSource?: string;
    industry?: string;
    foundedYear?: number;
    subsidiaries?: string[];
    products?: string[];
    alternativeSuppliers?: string[];
    recentDevelopments?: string[];
  };

  // Supply chain enrichment data (populated by mindMapEnricher)
  /** Supply chain risks detected for this supplier */
  supplyChainRisks?: Array<{
    risk: string;
    severity: RiskSeverity;
    source: string;
  }>;
  /** Recent supply chain news about this supplier */
  recentSupplyChainNews?: Array<{
    title: string;
    url: string;
    date?: string;
  }>;
  /** Supply chain health score 0-100 (100=best, 0=critical risks) */
  healthScore?: number;
  /** Geopolitical risk warnings specific to supplier region */
  geopoliticalRisk?: string;
  /** Alternative suppliers recommended as backup */
  backupSuppliers?: string[];
}

export interface RelationCategory {
  /** Category unique identifier */
  id: string;
  /** Display name (e.g., "Suppliers", "Manufacturers") */
  name: string;
  /** Emoji or icon identifier */
  icon: string;
  /** Hex color for visualization */
  color: string;
  /** Companies in this category */
  companies: CompanyNode[];

  // Supply chain enrichment data
  /** Average health score for all companies in category */
  categoryHealthScore?: number;
  /** Key supply chain insights for this category */
  categoryInsights?: string[];
}

export interface SupplyChainGraphNode {
  id: string;
  label: string;
  entityType: SupplyChainEntityType;
  tier: SupplyChainTier;
  role?: string;
  criticality?: number;
  confidence: number;
  verified?: boolean;
  healthScore?: number;
  status?: SupplyChainStatus;
  explanation?: string;
  metadata?: Record<string, unknown>;
  canonicalName?: string;
  tickers?: string[];
  identifiers?: CompanyNode["identifiers"];
  lastUpdated?: string;
}

export interface SupplyChainGraphEdge {
  id: string;
  from: string;
  to: string;
  kind: DependencyKind;
  weight?: number;
  weightRange?: { min: number; max: number };
  criticality?: number;
  confidence: number;
  status?: SupplyChainStatus;
  evidenceStatus?: SupplyChainEvidenceStatus;
  explanation?: string;
  source?: string;
  evidence?: SupplyChainEvidence[];
  metadata?: Record<string, unknown>;
}

export interface SupplyChainGraph {
  nodes: SupplyChainGraphNode[];
  edges: SupplyChainGraphEdge[];
}

export interface SupplyChainEvidence {
  evidenceId: string;
  edgeId: string;
  sourceKind: OfficialSourceKind;
  sourceUriOrRef: string;
  docDate: string;
  locationPointer: string;
  snippet: string;
  retrievalHash: string;
  docId?: string;
}

export interface SupplyChainDocument {
  docId: string;
  sourceKind: OfficialSourceKind;
  officialOrigin: string;
  fetchedAt: string;
  docDate: string;
  contentHash: string;
  rawContentLocation: string;
  parsedTextLocation: string;
  tickers?: string[];
}

export interface RiskLensCell {
  id: string;
  category: string;
  riskType: SupplyChainRiskType;
  severity: RiskSeverity;
  affectedNodes: string[];
  explanation: string;
}

export interface MindMapData {
  /** Central company ticker */
  centerTicker: string;
  /** Central company name */
  centerName: string;
  /** Optional: Center node id in the graph */
  centerNodeId?: string;
  /** Timestamp when generated */
  generatedAt: string;
  /** Categories of business relationships */
  categories: RelationCategory[];
  /** Optional: Overall supply chain health score */
  healthScore?: number;
  /** Optional: Key insights from Llama AI */
  insights?: string[];
  /** Canonical graph derived from categories */
  graph?: SupplyChainGraph;
  /** Risk lens overlay cells */
  riskLens?: RiskLensCell[];
  /** Tickers included in global/merged graphs */
  focalTickers?: string[];
  /** Strict official-source mode used for this graph */
  strictMode?: boolean;
  /** Include hypothesis edges in view */
  includeHypothesis?: boolean;
  /** Number of hops used for ego-graph generation */
  hops?: number;
  /** Minimum edge weight threshold */
  minEdgeWeight?: number;
  /** True if hypothesis layer exists in store */
  hypothesisAvailable?: boolean;
  /** Data freshness metadata */
  dataFreshness?: {
    lastIngestedDocDate?: string;
    lastExtractionAt?: string;
    verifiedEdges?: number;
    hypothesisEdges?: number;
    documentsUsed?: number;
  };
}

export interface SupplyChainAdvisorRequest {
  /** User question for the Llama advisor */
  question: string;
  /** Current mind-map data to ground the answer */
  mindMapData?: MindMapData | null;
  /** Optional screenshot encoded as base64 data URL */
  imageBase64?: string;
  /** Filename for the uploaded screenshot */
  imageName?: string;
  /** Optional cockpit context data (market data, positions, orders, etc.) */
  cockpitContext?: Record<string, unknown>;
}

export interface SupplyChainAdvisorResponse {
  success: boolean;
  /** Natural-language answer from the advisor */
  answer?: string;
  /** Source hints or citations returned by the model */
  sources?: string[];
  /** Suggested follow-up questions */
  followups?: string[];
  /** Model identifier used */
  model?: string;
  error?: string;
}

/** Response from Llama AI generation */
export interface SupplyChainGenerationResponse {
  success: boolean;
  data?: MindMapData;
  error?: string;
  /** Whether data came from cache */
  fromCache: boolean;
  /** Whether cached data is stale and refresh is recommended */
  needsRefresh?: boolean;
}

export interface SupplyChainGenerationOptions {
  ticker: string;
  strictMode?: boolean;
  includeHypothesis?: boolean;
  hops?: number;
  minEdgeWeight?: number;
  refresh?: boolean;
  /** Optional list of tickers to merge into a global graph */
  globalTickers?: string[];
}

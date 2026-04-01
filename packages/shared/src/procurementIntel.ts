export type ProcurementProvider = "ted" | "other";

export type ProcurementNoticeZone = "raw" | "normalized" | "enriched";

export type ProcurementTagBucket =
  | "sector_tags"
  | "theme_tags"
  | "commodity_tags"
  | "risk_tags"
  | "geography_tags"
  | "entity_tags";

export type ProcurementTags = {
  sector_tags: string[];
  theme_tags: string[];
  commodity_tags: string[];
  risk_tags: string[];
  geography_tags: string[];
  entity_tags: string[];
};

export type ProcurementClassification = {
  cpv_codes: string[];
  interpreted_categories: string[];
  unmapped_cpv_codes: string[];
};

export type ProcurementScoreName =
  | "macro_significance"
  | "supply_chain_relevance"
  | "market_moving_potential"
  | "strategic_infrastructure_relevance"
  | "geopolitical_sensitivity";

export type ProcurementScoreBreakdown = {
  score: number;
  factors: Array<{
    factor: string;
    weight: number;
    value: number;
    contribution: number;
  }>;
};

export type ProcurementScores = Record<
  ProcurementScoreName,
  ProcurementScoreBreakdown
>;

export type ProcurementEntityRef = {
  entity_type:
    | "buyer"
    | "supplier"
    | "commodity"
    | "geography"
    | "notice"
    | "contract";
  name: string;
  confidence: number;
  source: "raw" | "inferred";
};

export type ProcurementGraphRelation = {
  relation_id: string;
  subject_type: string;
  subject_key: string;
  predicate: string;
  object_type: string;
  object_key: string;
  confidence: number;
  evidence: string[];
};

export type ProcurementNoticeNormalized = {
  notice_id: string;
  provider_notice_id: string;
  provider: ProcurementProvider;
  title: string;
  description: string;
  buyer: string;
  supplier?: string;
  country: string;
  region: string;
  city?: string;
  publication_date: string;
  deadline?: string;
  contract_value?: number;
  currency?: string;
  procedure_type?: string;
  contract_type?: string;
  cpv_codes: string[];
  source_url?: string;
  raw_source_ref: string;
  language?: string;
  completeness: number;
};

export type ProcurementNoticeEnriched = ProcurementNoticeNormalized & {
  tags: ProcurementTags;
  classification: ProcurementClassification;
  inferred: {
    likely_sector_exposure: string[];
    supply_chain_relevance: string;
    strategic_importance: string;
    buyer_type: string;
    public_spending_theme: string[];
    geopolitical_relevance: string;
    procurement_scale_category: "micro" | "small" | "medium" | "large" | "mega";
    event_significance_score: number;
  };
  entity_refs: ProcurementEntityRef[];
  scores: ProcurementScores;
  graph_relations: ProcurementGraphRelation[];
  enrichment_version: string;
  classification_version: string;
  reprocessed_at?: string;
};

export type ProcurementNoticeFilters = {
  country?: string[];
  region?: string[];
  cpv?: string[];
  sector_tag?: string[];
  theme_tag?: string[];
  commodity_tag?: string[];
  buyer?: string[];
  supplier?: string[];
  min_value?: number;
  max_value?: number;
  min_confidence?: number;
  strategic_importance?: string[];
  from_date?: string;
  to_date?: string;
  limit?: number;
};

export type ProcurementDiagnostics = {
  ingestion_success: number;
  ingestion_failure: number;
  normalization_errors: number;
  enrichment_failures: number;
  unmapped_cpv_codes: Array<{ cpv: string; count: number }>;
  entity_matching_uncertainty: number;
  graph_generation_issues: number;
  last_run_at?: string;
};

export type ProcurementAggregations = {
  rising_activity_by_region: Array<{
    region: string;
    country: string;
    notice_count: number;
    total_value: number;
  }>;
  unusual_demand_clusters: Array<{
    key: string;
    notice_count: number;
    total_value: number;
  }>;
  contract_concentration_by_buyer: Array<{
    buyer: string;
    notice_count: number;
    total_value: number;
  }>;
  supplier_win_momentum: Array<{
    supplier: string;
    wins: number;
    total_value: number;
  }>;
  public_spending_surges: Array<{
    theme: string;
    notice_count: number;
    total_value: number;
  }>;
};

export type ProcurementIntegrationFeeds = {
  data_vault_evidence: Array<{
    notice_id: string;
    title: string;
    raw_source_ref: string;
    source_url?: string;
  }>;
  gwmd_signals: Array<{
    entity: string;
    signal: string;
    score: number;
    notice_ids: string[];
  }>;
  supply_chain_overlays: Array<{
    entity: string;
    demand_signal: string;
    confidence: number;
    notice_ids: string[];
  }>;
  intelligence_panorama: ProcurementAggregations;
};

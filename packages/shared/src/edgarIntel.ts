export type EdgarFormType = "8-K" | "10-K" | "10-Q" | "4";

export type EdgarLayerType =
  | "raw_source"
  | "structured_intelligence"
  | "interpretation";

export type EdgarSignalCategory = "explicit" | "implicit";

export type EdgarTimeHorizon = "immediate" | "medium_term" | "long_term";

export type EdgarFilingMetadata = {
  company_name: string;
  cik: string;
  ticker?: string;
  accession_number: string;
  filing_date: string;
  accepted_at?: string;
  period_of_report?: string;
  form_type: EdgarFormType;
  primary_document_url?: string;
  filing_detail_url?: string;
  source_links?: string[];
  metadata?: Record<string, unknown>;
};

export type EdgarIngestFiling = EdgarFilingMetadata & {
  raw_content: string;
};

export type EdgarDerivedRecord = {
  record_type:
    | "insider_transaction"
    | "event_disclosure"
    | "business_intelligence"
    | "risk_intelligence"
    | "financial_intelligence"
    | "management_change"
    | "financing_event"
    | "legal_risk"
    | "credit_deterioration"
    | "supplier_dependency"
    | "macro_signal";
  title: string;
  value: Record<string, unknown>;
  confidence?: number;
  provenance: {
    section?: string;
    snippet?: string;
  };
};

export type EdgarLayerRecord = {
  layer_type: EdgarLayerType;
  layer_version: string;
  produced_by: string;
  payload: Record<string, unknown>;
  payload_sha256: string;
  confidence?: number;
  lineage?: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
};

export type EdgarSignalRecord = {
  signal_id?: string;
  parser_version: string;
  signal_type: string;
  signal_category: EdgarSignalCategory;
  title: string;
  confidence: number;
  signal_payload: Record<string, unknown>;
  provenance: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

export type EdgarEntityMention = {
  entity_name: string;
  entity_type: string;
  relationship_type?: string;
  mention_context?: string;
  confidence: number;
  provenance?: Record<string, unknown>;
};

export type EdgarDeltaRecord = {
  delta_id?: string;
  delta_version: string;
  previous_filing_id?: string;
  language_diff: Record<string, unknown>;
  risk_factor_diff: Record<string, unknown>;
  tone_diff: Record<string, unknown>;
  financial_direction_diff: Record<string, unknown>;
  entity_relationship_diff: Record<string, unknown>;
  created_at?: string;
};

export type EdgarMaterialityScore = {
  scoring_version: string;
  overall_score: number;
  form_weight_score: number;
  company_importance_score: number;
  detected_event_score: number;
  unusual_language_score: number;
  historical_deviation_score: number;
  time_horizon: EdgarTimeHorizon;
  score_breakdown: Record<string, unknown>;
};

export type EdgarRoutingDecision = {
  routing_version: string;
  route_flow: boolean;
  route_intelligence: boolean;
  route_gwmd: boolean;
  route_reasoning: string[];
  source_layers: Record<string, string>;
  route_priority: number;
};

export type EdgarParsedPayload = {
  form_type: EdgarFormType;
  parser_version: string;
  sections: Record<string, string>;
  derived_records: EdgarDerivedRecord[];
};

export type EdgarRelevanceScore = {
  score_version: string;
  overall: number;
  market_impact: number;
  urgency: number;
  novelty: number;
  entity_linkage_strength: number;
  rationale: string[];
};

export type EdgarAiAnnotation = {
  model: string;
  prompt_version: string;
  summary: string;
  importance_assessment: string;
  thematic_tags: string[];
  terminal_intelligence: {
    headline: string;
    bullets: string[];
    watch_items: string[];
  };
  confidence: number;
};

export type EdgarFilingRecord = EdgarFilingMetadata & {
  filing_id: string;
  ingested_at: string;
  updated_at: string;
  source_type?: "sec_filing";
  vault_record_version?: string;
  source_tracking?: Record<string, unknown>;
  parse?: EdgarParsedPayload;
  relevance?: EdgarRelevanceScore;
  layers?: EdgarLayerRecord[];
  signals?: EdgarSignalRecord[];
  entity_mentions?: EdgarEntityMention[];
  delta?: EdgarDeltaRecord;
  materiality?: EdgarMaterialityScore;
  routing?: EdgarRoutingDecision;
  ai_annotation?: EdgarAiAnnotation & {
    gate_status: "pending" | "published" | "suppressed";
  };
};

export type EdgarVaultInspectionRecord = {
  filing: EdgarFilingRecord;
  raw_layer?: EdgarLayerRecord;
  structured_layer?: EdgarLayerRecord;
  interpretation_layer?: EdgarLayerRecord;
  signals: EdgarSignalRecord[];
  delta?: EdgarDeltaRecord;
  materiality?: EdgarMaterialityScore;
  routing?: EdgarRoutingDecision;
  linked_entities: EdgarEntityMention[];
};

export type EdgarFlowGraphMode =
  | "filings_timeline"
  | "entity_relationship"
  | "anomaly_heatmap"
  | "sector_pattern";

export type EdgarFlowEventPoint = {
  filing_id: string;
  ticker?: string;
  company_name: string;
  form_type: EdgarFormType;
  filing_date: string;
  materiality_score: number;
  unusual_language_score: number;
  route_priority: number;
  anomaly_score: number;
  is_anomaly: boolean;
  filing_url?: string;
};

export type EdgarFlowEntityNode = {
  id: string;
  label: string;
  type: "company" | "signal";
  filing_count: number;
  anomaly_count: number;
  avg_materiality: number;
};

export type EdgarFlowEntityEdge = {
  id: string;
  source: string;
  target: string;
  relation_type: "co_filed" | "supplier_dependency" | "theme_cluster";
  weight: number;
};

export type EdgarFlowHeatmapCell = {
  row_label: string;
  column_label: string;
  value: number;
  anomaly_count: number;
};

export type EdgarFlowSectorCluster = {
  id: string;
  label: string;
  tickers: string[];
  event_count: number;
  anomaly_count: number;
  avg_anomaly_score: number;
  top_signals: string[];
};

export type EdgarFlowAnomalyFinding = {
  id: string;
  filing_id: string;
  ticker?: string;
  company_name: string;
  severity: "info" | "warning" | "critical";
  anomaly_score: number;
  triggers: string[];
  rationale: string;
  filed_at: string;
};

export type EdgarFlowAdvice = {
  headline: string;
  synopsis: string;
  recommendation: "do" | "watch" | "avoid";
  confidence: number;
  why_it_matters: string[];
  what_to_watch: string[];
};

export type EdgarFlowIntelPayload = {
  generated_at: string;
  window_days: number;
  summary: {
    total_filings: number;
    anomaly_count: number;
    critical_count: number;
    routed_to_flow: number;
  };
  timeline: EdgarFlowEventPoint[];
  entity_graph: {
    nodes: EdgarFlowEntityNode[];
    edges: EdgarFlowEntityEdge[];
  };
  anomaly_heatmap: EdgarFlowHeatmapCell[];
  sector_patterns: EdgarFlowSectorCluster[];
  anomalies: EdgarFlowAnomalyFinding[];
  advice: EdgarFlowAdvice;
  intelligence_digest: {
    title: string;
    bullets: string[];
  };
};

export type EdgarFlowIntelDigest = {
  scopeId: string;
  items: EdgarFlowAnomalyFinding[];
  total: number;
  generatedAt: string;
};

export type GraphZone = "candidate" | "validation" | "production";

export type ValidationStatus =
  | "unvalidated"
  | "pending_validation"
  | "validated"
  | "contradicted"
  | "rejected";

export type ValidatorType = "human" | "rule" | "model" | "hybrid";

export type ConfidenceBand =
  | "very_low"
  | "low"
  | "medium"
  | "high"
  | "very_high";

export type CacheTemperature = "hot" | "warm" | "cold";

export type GraphEntityType =
  | "company"
  | "supplier"
  | "facility"
  | "warehouse"
  | "port"
  | "airport"
  | "regulator"
  | "vessel"
  | "route"
  | "product_group"
  | "region"
  | "country"
  | "chokepoint"
  | "other";

export type GraphRelationType =
  | "owns"
  | "operates"
  | "supplies"
  | "ships_to"
  | "depends_on"
  | "located_at"
  | "exposed_to"
  | "near"
  | "subsidiary_of"
  | "linked_to"
  | "candidate_link"
  | "other";

export type EvidenceSourceType =
  | "sec_filing"
  | "annual_report"
  | "ir_presentation"
  | "press_release"
  | "regulator_dataset"
  | "other_official"
  | "manual"
  | "ai_extraction"
  | "other";

export type SyncMode = "manual" | "pull" | "push" | "bidirectional";

export type SyncConflictStrategy =
  | "prefer_local"
  | "prefer_cloud"
  | "latest_timestamp"
  | "manual_review";

export type QueryUsageInput = {
  queryText: string;
  queryCluster?: string;
  responseMs?: number;
  cacheHit?: boolean;
  staleItemsDetected?: number;
  enrichmentDeltaCount?: number;
};

export type EntityRecordInput = {
  id: string;
  canonicalName: string;
  entityType: GraphEntityType;
  zone: GraphZone;
  sourceType: string;
  sourceRef: string;
  sourceTitle?: string;
  sourceUrl?: string;
  aiInferred: boolean;
  confidenceScore: number;
  freshnessScore: number;
  firstSeenAt: string;
  lastSeenAt: string;
  ttlDays?: number;
  validationStatus: ValidationStatus;
  validationMethod?: string;
  validatorType?: ValidatorType;
  contradictionFlag?: boolean;
  staleFlag?: boolean;
  promotionEligible?: boolean;
  metadataJson?: string;
};

export type EdgeRecordInput = {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  relationType: GraphRelationType;
  zone: GraphZone;
  sourceType: string;
  sourceRef: string;
  sourceTitle?: string;
  sourceUrl?: string;
  aiInferred: boolean;
  confidenceScore: number;
  freshnessScore: number;
  firstSeenAt: string;
  lastSeenAt: string;
  ttlDays?: number;
  validationStatus: ValidationStatus;
  validationMethod?: string;
  validatorType?: ValidatorType;
  contradictionFlag?: boolean;
  staleFlag?: boolean;
  promotionEligible?: boolean;
  metadataJson?: string;
};

export type EvidenceRecordInput = {
  evidenceId: string;
  sourceType: EvidenceSourceType;
  sourceReference: string;
  sourceTitle?: string;
  sourceUrl?: string;
  sourceKey?: string;
  snippet?: string;
  extractedSummary?: string;
  extractionMethod?: string;
  extractedAt: string;
  fingerprintHash?: string;
  qualityScore: number;
};

export type LinkEvidenceInput = {
  targetType: "entity" | "edge";
  targetId: string;
  evidenceId: string;
};

export type GraphEnrichmentSummary = {
  totalEntities: number;
  totalEdges: number;
  candidateItems: number;
  validationItems: number;
  productionItems: number;
  staleItems: number;
  lowConfidenceItems: number;
  pendingRevalidation: number;
  queuedSyncJobs: number;
  lastQueryAt: string | null;
  hotTargets: number;
  warmTargets: number;
  coldTargets: number;
};

export type InspectorData = {
  summary: GraphEnrichmentSummary;
  staleEntities: Array<{
    id: string;
    canonicalName: string;
    entityType: string;
    confidenceScore: number;
    freshnessScore: number;
    zone: GraphZone;
    lastSeenAt: string;
  }>;
  lowConfidenceEdges: Array<{
    id: string;
    relationType: string;
    fromEntityId: string;
    toEntityId: string;
    confidenceScore: number;
    freshnessScore: number;
    zone: GraphZone;
    validationStatus: ValidationStatus;
  }>;
  recentPromotionEvents: Array<{
    id: number;
    targetType: "entity" | "edge";
    targetId: string;
    fromZone: GraphZone | null;
    toZone: GraphZone;
    eventType: string;
    reason: string;
    createdAt: string;
  }>;
};

export type SyncStatus = {
  cloudEnabled: boolean;
  connected: boolean;
  provider: string;
  mode: SyncMode;
  lastSyncAt: string | null;
  queueSize: number;
  message: string;
};

export type ExportResult = {
  jsonPath: string;
  csvPaths: string[];
  exportedAt: string;
};

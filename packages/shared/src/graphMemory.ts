export type GraphMemorySection =
  | "overview"
  | "entities"
  | "relationships"
  | "evidence"
  | "validation"
  | "usage"
  | "snapshots"
  | "cloud"
  | "settings";

export type GraphMemorySortDirection = "asc" | "desc";

export type GraphMemoryFilters = {
  search?: string;
  zone?: "candidate" | "validation" | "production" | "all";
  status?: string;
  type?: string;
  sourceType?: string;
  confidenceBand?: "very_low" | "low" | "medium" | "high" | "very_high" | "all";
  freshnessBand?: "stale" | "aging" | "fresh" | "all";
};

export type GraphMemorySectionQuery = {
  section: GraphMemorySection;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDirection?: GraphMemorySortDirection;
  filters?: GraphMemoryFilters;
  source?: "cloud" | "device";
};

export type GraphMemoryEntityRow = {
  id: string;
  canonicalName: string;
  entityType: string;
  aliasesCount: number;
  region: string | null;
  confidence: number;
  confidenceBand: string;
  freshness: number;
  validationStatus: string;
  zone: "candidate" | "validation" | "production";
  evidenceCount: number;
  relatedEdgesCount: number;
  lastSeenAt: string;
  updatedAt: string;
};

export type GraphMemoryRelationshipRow = {
  id: string;
  fromEntityId: string;
  fromEntityName: string;
  relationType: string;
  toEntityId: string;
  toEntityName: string;
  confidence: number;
  confidenceBand: string;
  freshness: number;
  validationStatus: string;
  zone: "candidate" | "validation" | "production";
  evidenceCount: number;
  contradictionFlag: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  updatedAt: string;
};

export type GraphMemoryEvidenceRow = {
  evidenceId: string;
  sourceType: string;
  sourceTitle: string | null;
  extractionMethod: string | null;
  linkedCount: number;
  qualityScore: number;
  extractedAt: string;
  snippetPreview: string;
  sourceReference: string;
};

export type GraphMemoryValidationRow = {
  recordId: string;
  recordType: "entity" | "edge";
  validationStatus: string;
  validatorType: string | null;
  staleFlag: boolean;
  contradictionFlag: boolean;
  promotionEligible: boolean;
  lastValidatedAt: string | null;
  validationMethod: string | null;
  expiresAt: string | null;
  zone: "candidate" | "validation" | "production";
};

export type GraphMemoryUsageRow = {
  recordId: string;
  recordType: "entity" | "edge";
  requestCount: number;
  lastRequestedAt: string;
  queryCluster: string | null;
  temperature: "hot" | "warm" | "cold";
  speedupBenefitMs: number | null;
  improvedResponseSpeed: boolean;
  popularityRank: number;
};

export type GraphMemorySnapshotRow = {
  kind: "json" | "csv" | "snapshot";
  fileName: string;
  fullPath: string;
  bytes: number;
  modifiedAt: string;
};

export type GraphMemoryCloudReadiness = {
  cloudEnabled: boolean;
  connected: boolean;
  provider: string;
  projectId: string;
  dbUrl: string;
  bucket: string;
  syncMode: "manual" | "pull" | "push" | "bidirectional";
  queuedRecords: number;
  unsyncedChanges: number;
  adapterStatus: string;
  conflictStrategy:
    | "prefer_local"
    | "prefer_cloud"
    | "latest_timestamp"
    | "manual_review";
  message: string;
  lastSyncAt: string | null;
};

export type GraphMemoryOverview = {
  entityTypes: Array<{ label: string; count: number }>;
  relationshipTypes: Array<{ label: string; count: number }>;
  confidenceBands: Array<{ label: string; count: number }>;
  freshnessBands: Array<{ label: string; count: number }>;
  zoneSplit: Array<{
    label: "candidate" | "validation" | "production";
    count: number;
  }>;
  latestIngested: Array<{
    id: string;
    kind: "entity" | "edge";
    label: string;
    at: string;
  }>;
  latestValidated: Array<{
    id: string;
    kind: "entity" | "edge";
    label: string;
    at: string;
  }>;
  latestRejected: Array<{
    id: string;
    kind: "entity" | "edge";
    label: string;
    at: string;
  }>;
  mostRequested: Array<{
    id: string;
    kind: "entity" | "edge";
    requestCount: number;
    temperature: string;
  }>;
  hottestSubgraphs: Array<{ queryCluster: string; requests: number }>;
  staleWatchlist: Array<{
    id: string;
    kind: "entity" | "edge";
    score: number;
    zone: string;
  }>;
};

export type GraphMemorySummaryCards = {
  totalEntities: number;
  totalRelationships: number;
  totalEvidenceRecords: number;
  validationQueuePending: number;
  lowConfidenceItems: number;
  staleItems: number;
  recentlyAdded: number;
  productionCount: number;
  candidateCount: number;
};

export type GraphMemorySectionResponse<TItem> = {
  section: GraphMemorySection;
  items: TItem[];
  total: number;
  page: number;
  pageSize: number;
};

export type GraphMemoryDashboard = {
  title: string;
  subtitle: string;
  localDbStatus: "ready" | "unavailable";
  lastLocalRefreshAt: string;
  cloud: GraphMemoryCloudReadiness;
  summaryCards: GraphMemorySummaryCards;
  overview: GraphMemoryOverview;
};

export type GraphMemoryDetailRequest = {
  section: GraphMemorySection;
  id: string;
  recordType?: "entity" | "edge";
  source?: "cloud" | "device";
};

export type GraphMemoryDetail = {
  summary: Record<string, unknown>;
  provenance: Record<string, unknown>;
  related: Record<string, unknown>;
  raw: Record<string, unknown>;
  timeline: Array<Record<string, unknown>>;
};

export type GraphMemoryRevalidateRequest = {
  records: Array<{ recordType: "entity" | "edge"; id: string }>;
};

export type GraphMemoryRevalidateResult = {
  queued: number;
  skipped: number;
};

export type GraphMemoryExportsManifest = {
  latestSnapshotPath: string | null;
  files: GraphMemorySnapshotRow[];
};

import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("trading-cockpit-backend"),
  version: z.string(),
  now: z.string().datetime(),
});

export const loginRequestSchema = z
  .object({
    email: z.string().email().optional(),
    username: z.string().min(3).optional(),
    password: z.string().min(8),
    licenseKey: z.string().min(1),
  })
  .refine((value) => Boolean(value.email || value.username), {
    message: "email_or_username_required",
    path: ["email"],
  });

export const signupRequestSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3),
  password: z.string().min(8),
  licenseKey: z.string().min(1),
});

export const tenantContextSchema = z.object({
  tenantId: z.string().min(1),
  source: z.enum(["header", "default", "user"]),
});

export const runtimeFeatureFlagsSchema = z.object({
  backendOnlyProcessing: z.boolean(),
  desktopLocalFallback: z.boolean(),
  webPrimaryRouting: z.boolean(),
  requireTenantHeader: z.boolean(),
});

export const runtimeFlagsResponseSchema = z.object({
  flags: runtimeFeatureFlagsSchema,
  tenant: tenantContextSchema,
});

export const refreshTokenRequestSchema = z.object({
  refreshToken: z.string().min(12),
});

export const logoutRequestSchema = z
  .object({
    refreshToken: z.string().min(12).optional(),
    allSessions: z.boolean().optional(),
  })
  .default({});

export const totpVerifyRequestSchema = z.object({
  code: z.string().min(6).max(12),
});

export const totpDisableRequestSchema = z
  .object({
    code: z.string().min(6).max(12).optional(),
    recoveryCode: z.string().min(6).max(24).optional(),
  })
  .refine((value) => Boolean(value.code || value.recoveryCode), {
    message: "code_or_recovery_code_required",
    path: ["code"],
  });

export const authUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  username: z.string(),
  tier: z.enum(["starter", "pro", "enterprise"]),
  roles: z
    .array(z.enum(["admin", "operator", "analyst", "viewer", "service"]))
    .default(["viewer"]),
  licenseKey: z.string(),
});

export const loginResponseSchema = z.object({
  token: z.string(),
  refreshToken: z.string(),
  expiresInSeconds: z.number().int().positive(),
  user: authUserSchema,
});

export const meResponseSchema = z.object({
  user: authUserSchema,
});

export const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
});

export const congressTradeSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  member: z.string(),
  chamber: z.enum(["house", "senate"]),
  side: z.enum(["buy", "sell"]),
  amountBand: z.string(),
  disclosedAt: z.string().datetime(),
  tradedAt: z.string().datetime(),
});

export const congressTradesResponseSchema = z.object({
  items: z.array(congressTradeSchema),
  total: z.number().int().nonnegative(),
});

export const publicFlowEventSchema = z.object({
  id: z.string(),
  ticker: z.string(),
  filingType: z.string(),
  theme: z.string(),
  impactScore: z.number(),
  happenedAt: z.string().datetime(),
});

export const publicFlowEventsResponseSchema = z.object({
  items: z.array(publicFlowEventSchema),
  total: z.number().int().nonnegative(),
});

export const aiResearchManualItemSchema = z.object({
  title: z.string().min(1),
  text: z.string().min(1),
});

export const aiResearchRunRequestSchema = z.object({
  manualItems: z.array(aiResearchManualItemSchema).max(100).optional(),
  model: z.string().min(1).optional(),
});

export const aiBriefSchema = z.object({
  headline: z.string(),
  summaryBullets: z.array(z.string()),
  whyItMatters: z.string(),
  whatToWatch: z.array(z.string()),
  tickers: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

export const aiResearchRunResponseSchema = z.object({
  briefs: z.array(aiBriefSchema),
  model: z.string(),
  provider: z.literal("ollama-cloud"),
});

export const aiModelsListResponseSchema = z.object({
  models: z.array(
    z.object({
      name: z.string(),
      modified_at: z.string().optional(),
      size: z.number().optional(),
    }),
  ),
});

export const aiResearchConfigRequestSchema = z.object({
  enabled: z.boolean().optional(),
  model: z.string().min(1).optional(),
  pollIntervalSec: z.number().int().min(60).max(3600).optional(),
  rssFeeds: z.array(z.string().url()).optional(),
  secForms: z.array(z.string()).optional(),
  watchlistTickers: z.array(z.string()).optional(),
  watchlistKeywords: z.array(z.string()).optional(),
  useX: z.boolean().optional(),
  xApiKey: z.string().optional(),
  focusPrompt: z.string().optional(),
});

const gwmdRelationTypeSchema = z.enum([
  "supplier",
  "customer",
  "partner",
  "competitor",
  "financing",
  "license",
]);

export const gwmdCloudCompanySchema = z.object({
  ticker: z.string().min(1),
  name: z.string().min(1),
  hq_lat: z.number().min(-90).max(90).nullable().optional(),
  hq_lon: z.number().min(-180).max(180).nullable().optional(),
  hq_city: z.string().nullable().optional(),
  hq_country: z.string().nullable().optional(),
  industry: z.string().nullable().optional(),
  health_score: z.number().int().min(0).max(100).nullable().optional(),
});

export const gwmdCloudRelationshipSchema = z.object({
  id: z.string().min(1),
  from_ticker: z.string().min(1),
  to_ticker: z.string().min(1),
  relation_type: gwmdRelationTypeSchema,
  weight: z.number().min(0).max(1).nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  evidence: z.string().nullable().optional(),
});

export const gwmdSyncPushRequestSchema = z.object({
  companies: z.array(gwmdCloudCompanySchema),
  relationships: z.array(gwmdCloudRelationshipSchema),
  replace: z.boolean().optional(),
});

export const gwmdSyncStatusSchema = z.object({
  cloudVersion: z.number().int().nonnegative(),
  lastSyncAt: z.string().datetime().nullable(),
  companiesCount: z.number().int().nonnegative(),
  relationshipsCount: z.number().int().nonnegative(),
  syncStatus: z.enum(["idle", "syncing", "ok", "error"]),
});

export const gwmdSyncPushResponseSchema = z.object({
  ok: z.literal(true),
  applied: z.object({
    companies: z.number().int().nonnegative(),
    relationships: z.number().int().nonnegative(),
  }),
  status: gwmdSyncStatusSchema,
});

export const gwmdSyncPullResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    companies: z.array(gwmdCloudCompanySchema),
    relationships: z.array(gwmdCloudRelationshipSchema),
  }),
  status: gwmdSyncStatusSchema,
});

export const gwmdSyncStatusResponseSchema = z.object({
  ok: z.literal(true),
  status: gwmdSyncStatusSchema,
});

export const graphSorStatusSchema = z.object({
  tenantId: z.string().min(1),
  entitiesCount: z.number().int().nonnegative(),
  relationshipsCount: z.number().int().nonnegative(),
  evidenceCount: z.number().int().nonnegative(),
  validationEventsCount: z.number().int().nonnegative(),
  scenarioRunsCount: z.number().int().nonnegative(),
  latestEntityUpdateAt: z.string().datetime().nullable(),
  latestRelationshipUpdateAt: z.string().datetime().nullable(),
});

export const graphSorStatusResponseSchema = z.object({
  ok: z.literal(true),
  status: graphSorStatusSchema,
});

const graphSorEntityTypeSchema = z.enum([
  "company",
  "facility",
  "country",
  "commodity",
  "route",
  "event",
  "other",
]);

const graphSorZoneSchema = z.enum(["candidate", "validation", "production"]);

const graphSorEvidenceQualitySchema = z.enum([
  "reported",
  "verified",
  "estimated",
  "inferred",
]);

export const graphSorEntityInputSchema = z.object({
  entityId: z.string().min(1),
  entityType: graphSorEntityTypeSchema,
  canonicalName: z.string().min(1),
  ticker: z.string().nullable().optional(),
  isin: z.string().nullable().optional(),
  countryCode: z.string().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  freshnessScore: z.number().min(0).max(1).optional(),
  zone: graphSorZoneSchema.optional(),
  seenAt: z.string().datetime().optional(),
});

export const graphSorRelationshipInputSchema = z.object({
  relationshipId: z.string().min(1),
  predicate: z.string().min(1),
  relationType: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
  freshnessScore: z.number().min(0).max(1).optional(),
  evidenceQuality: graphSorEvidenceQualitySchema.optional(),
  zone: graphSorZoneSchema.optional(),
  firstSeenAt: z.string().datetime().optional(),
  lastSeenAt: z.string().datetime().optional(),
});

export const graphSorEvidenceInputSchema = z.object({
  evidenceId: z.string().min(1),
  sourceId: z.string().min(1),
  sourceType: z.string().min(1),
  retrievedAt: z.string().datetime(),
  rawSnippet: z.string().optional(),
  provenanceHash: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
  freshnessScore: z.number().min(0).max(1).optional(),
  lineage: z.record(z.unknown()).optional(),
});

export const graphSorFactUpsertRequestSchema = z.object({
  subjectEntity: graphSorEntityInputSchema,
  objectEntity: graphSorEntityInputSchema,
  relationship: graphSorRelationshipInputSchema,
  evidence: graphSorEvidenceInputSchema.optional(),
});

export const graphSorFactUpsertResponseSchema = z.object({
  ok: z.literal(true),
  applied: z.object({
    tenantId: z.string().min(1),
    relationshipId: z.string().min(1),
    entityUpserts: z.number().int().nonnegative(),
    relationshipUpserted: z.boolean(),
    evidenceUpserted: z.boolean(),
  }),
});

export const calendarInsightRequestEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  releaseDateTime: z.string(),
  status: z.enum(["upcoming", "released", "revised"]),
  importance: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  eventCategory: z.enum([
    "inflation",
    "employment",
    "growth",
    "trade",
    "housing",
    "confidence",
    "other",
  ]),
  country: z.string(),
  confidenceScore: z.number().optional(),
  summary: z.string().optional(),
});

export const calendarInsightRequestSchema = z.object({
  focus: z.enum(["upcoming", "released"]),
  windowHours: z.number().int().positive(),
  events: z.array(calendarInsightRequestEventSchema),
  model: z.string().optional(),
});

export const calendarInsightResponseSchema = z.object({
  aiEngine: z.enum(["cloud", "heuristic"]),
  generatedAt: z.string(),
  headline: z.string(),
  synopsis: z.string(),
  bullets: z.array(z.string()),
  riskSignals: z.array(
    z.object({
      label: z.string(),
      detail: z.string(),
      severity: z.enum(["low", "medium", "high"]),
    }),
  ),
  focusEvents: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      eta: z.string(),
      status: z.enum(["upcoming", "released", "revised"]),
      importance: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      aiView: z.string(),
    }),
  ),
});

export const aiJobStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const aiJobSchema = z.object({
  id: z.string(),
  queue: z.string(),
  status: aiJobStatusSchema,
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  idempotencyKey: z.string().optional(),
  result: z.unknown().optional(),
  error: z.string().optional(),
  createdAtIso: z.string().datetime(),
  updatedAtIso: z.string().datetime(),
  completedAtIso: z.string().datetime().optional(),
});

export const aiJobEnqueueResponseSchema = z.object({
  jobId: z.string(),
  status: aiJobStatusSchema,
});

export const aiJobStatusResponseSchema = z.object({
  job: aiJobSchema,
});

export const aiBriefDetailSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  headline: z.string(),
  summaryBullets: z.array(z.string()),
  tickers: z.array(z.string()),
  whyItMatters: z.array(z.string()),
  whatToWatch: z.array(z.string()),
  impactScore: z.number().int().min(0).max(100),
  confidence: z.number().int().min(0).max(100),
  sources: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      source: z.string(),
      publishedAt: z.string(),
    }),
  ),
});

// ============================================================================
// STRATEGY CRUD AND VERSIONING
// ============================================================================

export const strategyStageSchema = z.enum([
  "candidate",
  "validation",
  "production",
  "retired",
]);

export const strategyDefinitionSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  stage: strategyStageSchema,
  tags: z.array(z.string()).default([]),
  description: z.string().default(""),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const strategyVersionSchema = z.object({
  id: z.string(),
  strategyId: z.string(),
  version: z.string(),
  scriptLanguage: z.enum(["javascript", "typescript"]),
  scriptSource: z.string(),
  scriptChecksum: z.string(),
  universe: z.array(z.string()),
  assumptions: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string().datetime(),
});

export const createStrategyRequestSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
});

export const createStrategyResponseSchema = z.object({
  strategy: strategyDefinitionSchema,
});

export const listStrategiesResponseSchema = z.object({
  strategies: z.array(strategyDefinitionSchema),
});

export const getStrategyResponseSchema = z.object({
  strategy: strategyDefinitionSchema,
  version: strategyVersionSchema,
});

export const updateStrategyRequestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  stage: strategyStageSchema.optional(),
  tags: z.array(z.string()).optional(),
});

export const createStrategyVersionRequestSchema = z.object({
  scriptLanguage: z.enum(["javascript", "typescript"]).optional(),
  scriptEntrypoint: z.string().min(1).default("onBar"),
  scriptSource: z.string().min(1),
  universe: z.array(z.string().min(1)).min(1),
  assumptions: z.record(z.string(), z.unknown()).default({}),
  notes: z.string().max(1000).optional(),
});

export const createStrategyVersionResponseSchema = z.object({
  version: strategyVersionSchema,
});

export const getLatestVersionResponseSchema = z.object({
  version: strategyVersionSchema,
});

// ============================================================================
// STRATEGY BACKTESTING
// ============================================================================

export const strategyBacktestRunRequestSchema = z.object({
  strategyId: z.string().min(1),
  strategyVersion: z.string().min(1),
  datasetSnapshotId: z.string().min(1),
  executionMode: z
    .enum(["desktop-local", "backend", "paper", "live"])
    .default("backend"),
  queuePriority: z.enum(["low", "normal", "high"]).default("normal"),
  queueResourceClass: z.enum(["standard", "heavy"]).default("standard"),
  maxAttempts: z.number().int().min(1).max(10).default(3),
  assumptions: z
    .object({
      transactionCostBps: z.number().min(0).optional(),
      slippageBps: z.number().min(0).optional(),
      borrowCostBps: z.number().min(0).optional(),
      spreadBps: z.number().min(0).optional(),
      marketImpactBpsPer10PctADV: z.number().min(0).optional(),
      liquidityCapPct: z.number().min(0).max(100).optional(),
      maxParticipationPct: z.number().min(0).max(100).optional(),
      fillPolicy: z.enum(["open", "close", "vwap", "custom"]).optional(),
      customPriceFormula: z.enum(["hl2", "hlc3", "ohlc4"]).optional(),
      benchmarkSymbol: z.string().min(1).optional(),
      benchmarkWeights: z.record(z.string(), z.number()).optional(),
      allowShorts: z.boolean().optional(),
      hardToBorrowSymbols: z.array(z.string()).optional(),
      borrowAvailableSymbols: z.array(z.string()).optional(),
      shortBorrowRateBps: z.number().min(0).optional(),
      shortBorrowMaxBps: z.number().min(0).optional(),
      blockedDates: z.array(z.string()).optional(),
      allowedTradingWeekdays: z
        .array(z.number().int().min(0).max(6))
        .optional(),
      staleBarMaxGapDays: z.number().int().min(1).optional(),
      staleBarPolicy: z.enum(["warn", "skip", "block"]).optional(),
      missingBarPolicy: z.enum(["warn", "skip", "block"]).optional(),
      symbolClassification: z
        .record(
          z.string(),
          z.object({
            sector: z.string().optional(),
            industry: z.string().optional(),
          }),
        )
        .optional(),
      factorExposureMap: z
        .record(z.string(), z.record(z.string(), z.number()))
        .optional(),
      executionTiming: z
        .enum(["open", "close", "next-open", "next-close"])
        .optional(),
      rebalancingFrequency: z
        .enum(["daily", "weekly", "monthly", "custom"])
        .optional(),
      customRebalanceDays: z
        .array(z.number().int().positive())
        .max(31)
        .optional(),
      riskControls: z
        .object({
          maxGrossExposurePct: z.number().min(0).max(1).optional(),
          maxNetExposurePct: z.number().min(0).max(1).optional(),
          maxPositionWeightPct: z.number().min(0).max(1).optional(),
          maxSectorExposurePct: z.number().min(0).max(1).optional(),
          maxIndustryExposurePct: z.number().min(0).max(1).optional(),
          maxTurnoverPct: z.number().min(0).max(1).optional(),
          stopLossPct: z.number().min(0).max(1).optional(),
          maxDrawdownPct: z.number().min(0).max(1).optional(),
          haltTradingOnDrawdownPct: z.number().min(0).max(1).optional(),
          minCashBufferPct: z.number().min(0).max(1).optional(),
          maxActiveWeightPct: z.number().min(0).max(1).optional(),
          factorConstraints: z
            .record(
              z.string(),
              z.object({
                min: z.number().optional(),
                max: z.number().optional(),
              }),
            )
            .optional(),
          maxConcurrentPositions: z.number().int().positive().optional(),
        })
        .optional(),
    })
    .passthrough()
    .default({}),
  idempotencyKey: z.string().min(1).max(256).optional(),
});

export const strategyRunStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const strategyBacktestRunSummarySchema = z.object({
  runId: z.string(),
  strategyId: z.string(),
  strategyVersion: z.string(),
  datasetSnapshotId: z.string(),
  executionMode: z.enum(["desktop-local", "backend", "paper", "live"]),
  queueJobId: z.string().optional(),
  queuePriority: z.enum(["low", "normal", "high"]).default("normal"),
  queueResourceClass: z.enum(["standard", "heavy"]).default("standard"),
  retryCount: z.number().int().nonnegative().default(0),
  maxAttempts: z.number().int().positive().default(1),
  lastRetryAt: z.string().nullable().optional(),
  lastError: z.string().nullable().optional(),
  status: strategyRunStatusSchema,
  requestedAt: z.string(),
  startedAt: z.string().nullable().optional(),
  finishedAt: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  metrics: z.record(z.string(), z.unknown()).default({}),
  runMetadata: z.record(z.string(), z.unknown()).default({}),
});

export const strategyBacktestRunEnqueueResponseSchema = z.object({
  runId: z.string(),
  status: strategyRunStatusSchema,
});

export const strategyDatasetSnapshotSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  snapshotAtIso: z.string(),
  rowCount: z.number().int().nonnegative().nullable().optional(),
  sourceManifest: z.record(z.string(), z.unknown()).default({}),
  checksumSha256: z.string().min(16),
});

export const strategyDatasetSnapshotsResponseSchema = z.object({
  snapshots: z.array(strategyDatasetSnapshotSchema),
});

export const strategyBacktestRunStatusResponseSchema = z.object({
  run: strategyBacktestRunSummarySchema,
});

export const strategyRunArtifactSchema = z.object({
  artifactId: z.string(),
  runId: z.string(),
  artifactKind: z.string(),
  artifactUri: z.string(),
  checksumSha256: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string(),
});

export const strategyBacktestArtifactsResponseSchema = z.object({
  artifacts: z.array(strategyRunArtifactSchema),
});

export const strategyBacktestRobustnessRequestSchema = z
  .object({
    persistExperimentName: z.string().min(1).max(200).optional(),
    tags: z.array(z.string().min(1)).max(32).optional(),
    notes: z.string().max(4000).optional(),
  })
  .default({});

export const strategyBacktestRobustnessResponseSchema = z.object({
  report: z.record(z.string(), z.unknown()),
});

export const strategyBacktestCompareResponseSchema = z.object({
  comparison: z.object({
    runId: z.string(),
    baselineRunId: z.string(),
    deltas: z.record(z.string(), z.number()),
    improved: z.array(z.string()),
    degraded: z.array(z.string()),
  }),
  lineage: z.record(z.string(), z.unknown()).optional(),
});

export const strategyRunExperimentRequestSchema = z.object({
  experimentName: z.string().min(1).max(200),
  tags: z.array(z.string().min(1)).max(32).default([]),
  notes: z.string().max(4000).default(""),
  parameters: z.record(z.string(), z.unknown()).default({}),
});

export const strategyRunExperimentResponseSchema = z.object({
  experiment: z
    .object({
      experimentId: z.string(),
      runId: z.string(),
      strategyId: z.string(),
      experimentName: z.string(),
      tags: z.array(z.string()),
      notes: z.string(),
      parameters: z.record(z.string(), z.unknown()),
      createdAt: z.string(),
      updatedAt: z.string(),
    })
    .nullable(),
});

export const strategyPromotionRequestSchema = z.object({
  strategyId: z.string().min(1),
  fromStage: z.enum(["candidate", "validation", "production", "retired"]),
  toStage: z.enum(["candidate", "validation", "production", "retired"]),
  sourceRunId: z.string().min(1).optional(),
  baselineRunId: z.string().min(1).optional(),
  governanceProfileId: z.string().min(1).optional(),
  acceptancePackId: z.string().min(1).optional(),
  autoGatePassed: z.boolean(),
  manualApprovedBy: z.string().min(1).optional(),
  checklist: z.record(z.string(), z.boolean()).default({}),
  rationale: z.string().max(4000).default(""),
});

export const strategyConnectorTypeSchema = z.enum([
  "data-provider",
  "paper-broker",
]);

export const strategyConnectorStatusSchema = z.enum([
  "not_configured",
  "configured",
  "disabled",
]);

export const strategyConnectorUpsertRequestSchema = z.object({
  connectorId: z.string().min(1).optional(),
  connectorType: strategyConnectorTypeSchema,
  status: strategyConnectorStatusSchema,
  displayName: z.string().max(120).default(""),
  config: z.record(z.string(), z.unknown()).default({}),
  capabilities: z.record(z.string(), z.unknown()).default({}),
});

export const strategyConnectorSummarySchema = z.object({
  connectorId: z.string(),
  tenantId: z.string(),
  connectorType: strategyConnectorTypeSchema,
  status: strategyConnectorStatusSchema,
  displayName: z.string(),
  config: z.record(z.string(), z.unknown()).default({}),
  capabilities: z.record(z.string(), z.unknown()).default({}),
  updatedAt: z.string(),
});

export const strategyConnectorListResponseSchema = z.object({
  connectors: z.array(strategyConnectorSummarySchema),
});

export const strategyGovernanceProfileUpsertRequestSchema = z.object({
  profileId: z.string().min(1).optional(),
  profileName: z.string().min(1).max(120),
  isDefault: z.boolean().default(false),
  transitionRules: z.record(z.string(), z.unknown()).default({}),
  requiredReportSections: z.array(z.string().min(1)).max(256).default([]),
  benchmarkRequired: z.boolean().default(false),
  oosMinimums: z.record(z.string(), z.number()).default({}),
  drawdownHaltRules: z.record(z.string(), z.unknown()).default({}),
  replayTolerance: z.record(z.string(), z.number()).default({}),
});

export const strategyGovernanceProfileSummarySchema = z.object({
  profileId: z.string(),
  tenantId: z.string(),
  profileName: z.string(),
  isDefault: z.boolean(),
  transitionRules: z.record(z.string(), z.unknown()).default({}),
  requiredReportSections: z.array(z.string()),
  benchmarkRequired: z.boolean(),
  oosMinimums: z.record(z.string(), z.number()),
  drawdownHaltRules: z.record(z.string(), z.unknown()),
  replayTolerance: z.record(z.string(), z.number()),
  updatedAt: z.string(),
});

export const strategyGovernanceProfileListResponseSchema = z.object({
  profiles: z.array(strategyGovernanceProfileSummarySchema),
});

export const strategyAcceptancePackUpsertRequestSchema = z.object({
  packId: z.string().min(1).optional(),
  packName: z.string().min(1).max(120),
  isDefault: z.boolean().default(false),
  goldenStrategies: z.array(z.string().min(1)).max(500).default([]),
  requiredReportSections: z.array(z.string().min(1)).max(256).default([]),
  replayTolerance: z.record(z.string(), z.number()).default({}),
  promotionChecklist: z.record(z.string(), z.boolean()).default({}),
  definitionOfDone: z.record(z.string(), z.unknown()).default({}),
});

export const strategyAcceptancePackSummarySchema = z.object({
  packId: z.string(),
  tenantId: z.string(),
  packName: z.string(),
  isDefault: z.boolean(),
  goldenStrategies: z.array(z.string()),
  requiredReportSections: z.array(z.string()),
  replayTolerance: z.record(z.string(), z.number()),
  promotionChecklist: z.record(z.string(), z.boolean()),
  definitionOfDone: z.record(z.string(), z.unknown()),
  updatedAt: z.string(),
});

export const strategyAcceptancePackListResponseSchema = z.object({
  packs: z.array(strategyAcceptancePackSummarySchema),
});

export const strategyGovernanceReadinessResponseSchema = z.object({
  executionMode: z.enum(["paper", "live"]),
  ready: z.boolean(),
  checks: z.array(
    z.object({
      code: z.string(),
      passed: z.boolean(),
      message: z.string(),
    }),
  ),
  connectorStatuses: z.object({
    dataProvider: strategyConnectorStatusSchema.optional(),
    paperBroker: strategyConnectorStatusSchema.optional(),
  }),
  defaults: z.object({
    governanceProfileId: z.string().nullable(),
    acceptancePackId: z.string().nullable(),
  }),
});

export const strategyForwardProfileCreateRequestSchema = z.object({
  strategyId: z.string().min(1),
  sourceRunId: z.string().min(1),
  baselineRunId: z.string().min(1).optional(),
  executionMode: z.enum(["paper", "live"]).default("paper"),
  governanceProfileId: z.string().min(1).optional(),
  acceptancePackId: z.string().min(1).optional(),
  autoGatePassed: z.boolean().default(false),
  manualApprovedBy: z.string().min(1).optional(),
  checklist: z.record(z.string(), z.boolean()).default({}),
  benchmark: z.string().min(1).default("SPY"),
  rebalanceFrozenAt: z.string(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const strategyForwardProfileStatusSchema = z.enum([
  "active",
  "paused",
  "stopped",
]);

export const strategyForwardProfileSummarySchema = z.object({
  profileId: z.string(),
  strategyId: z.string(),
  sourceRunId: z.string(),
  executionMode: z.enum(["paper", "live"]),
  status: strategyForwardProfileStatusSchema,
  benchmark: z.string(),
  rebalanceFrozenAt: z.string(),
  startedAt: z.string(),
  stoppedAt: z.string().nullable(),
  governanceProfileId: z.string().nullable(),
  acceptancePackId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const strategyForwardProfileListResponseSchema = z.object({
  profiles: z.array(strategyForwardProfileSummarySchema),
});

export const strategyForwardProfileStatusUpdateRequestSchema = z.object({
  status: strategyForwardProfileStatusSchema,
  reason: z.string().max(1000).optional(),
});

export const strategyForwardProfileDriftResponseSchema = z.object({
  profileId: z.string(),
  sourceRunId: z.string(),
  candidateRunId: z.string(),
  withinTolerance: z.boolean(),
  tolerance: z.record(z.string(), z.number()),
  metrics: z.array(
    z.object({
      key: z.string(),
      source: z.number(),
      candidate: z.number(),
      absoluteDelta: z.number(),
      tolerance: z.number().nullable(),
      withinTolerance: z.boolean(),
    }),
  ),
  violations: z.array(z.string()),
});

export const strategyForwardProfileAlertsResponseSchema = z.object({
  profileId: z.string(),
  generatedAt: z.string(),
  alerts: z.array(
    z.object({
      severity: z.enum(["info", "warning", "critical"]),
      code: z.string(),
      message: z.string(),
      context: z.record(z.string(), z.unknown()).default({}),
    }),
  ),
});

export const wsClientSubscribeSchema = z.object({
  type: z.literal("subscribe"),
  symbols: z.array(z.string().min(1)).max(50),
});

export const wsClientUnsubscribeSchema = z.object({
  type: z.literal("unsubscribe"),
  symbols: z.array(z.string().min(1)).max(50),
});

export const wsServerMarketQuoteSchema = z.object({
  symbol: z.string(),
  price: z.number(),
  ts: z.number().int(),
});

export const wsServerMarketBatchSchema = z.object({
  type: z.literal("market.batch"),
  quotes: z.array(wsServerMarketQuoteSchema),
  dropped: z.number().int().nonnegative().default(0),
});

export const wsServerAckSchema = z.object({
  type: z.enum(["subscribed", "unsubscribed"]),
  symbols: z.array(z.string()),
});

export const wsServerErrorSchema = z.object({
  type: z.literal("error"),
  reason: z.string(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type RefreshTokenRequest = z.infer<typeof refreshTokenRequestSchema>;
export type LogoutRequest = z.infer<typeof logoutRequestSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
export type RuntimeFeatureFlags = z.infer<typeof runtimeFeatureFlagsSchema>;
export type TenantContext = z.infer<typeof tenantContextSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
export type CongressTrade = z.infer<typeof congressTradeSchema>;
export type CongressTradesResponse = z.infer<
  typeof congressTradesResponseSchema
>;
export type PublicFlowEvent = z.infer<typeof publicFlowEventSchema>;
export type PublicFlowEventsResponse = z.infer<
  typeof publicFlowEventsResponseSchema
>;
export type AiBrief = z.infer<typeof aiBriefSchema>;
export type AiJob = z.infer<typeof aiJobSchema>;
export type GwmdCloudCompany = z.infer<typeof gwmdCloudCompanySchema>;
export type GwmdCloudRelationship = z.infer<typeof gwmdCloudRelationshipSchema>;
export type GwmdSyncPushRequest = z.infer<typeof gwmdSyncPushRequestSchema>;
export type GwmdSyncPushResponse = z.infer<typeof gwmdSyncPushResponseSchema>;
export type GwmdSyncPullResponse = z.infer<typeof gwmdSyncPullResponseSchema>;
export type GwmdSyncStatusResponse = z.infer<
  typeof gwmdSyncStatusResponseSchema
>;
export type WsClientSubscribe = z.infer<typeof wsClientSubscribeSchema>;
export type WsClientUnsubscribe = z.infer<typeof wsClientUnsubscribeSchema>;
export type WsServerMarketBatch = z.infer<typeof wsServerMarketBatchSchema>;
export type WsServerAck = z.infer<typeof wsServerAckSchema>;
export type WsServerError = z.infer<typeof wsServerErrorSchema>;

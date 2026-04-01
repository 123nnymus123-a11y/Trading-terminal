import { z } from "zod";

export const StrategyResearchStageSchema = z.enum([
  "candidate",
  "validation",
  "production",
  "retired",
]);
export type StrategyResearchStage = z.infer<typeof StrategyResearchStageSchema>;

export const StrategyScriptLanguageSchema = z.enum([
  "javascript",
  "typescript",
]);
export type StrategyScriptLanguage = z.infer<
  typeof StrategyScriptLanguageSchema
>;

export const StrategyExecutionModeSchema = z.enum(["desktop-local", "backend"]);
export type StrategyExecutionMode = z.infer<typeof StrategyExecutionModeSchema>;

export const StrategyRiskControlsSchema = z.object({
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
});
export type StrategyRiskControls = z.infer<typeof StrategyRiskControlsSchema>;

export const StrategyAssumptionsSchema = z
  .object({
    transactionCostBps: z.number().min(0).default(0),
    slippageBps: z.number().min(0).default(0),
    borrowCostBps: z.number().min(0).default(0),
    spreadBps: z.number().min(0).default(0),
    marketImpactBpsPer10PctADV: z.number().min(0).default(0),
    liquidityCapPct: z.number().min(0).max(100).optional(),
    maxParticipationPct: z.number().min(0).max(100).optional(),
    fillPolicy: z.enum(["open", "close", "vwap", "custom"]).default("close"),
    customPriceFormula: z.enum(["hl2", "hlc3", "ohlc4"]).default("ohlc4"),
    benchmarkSymbol: z.string().min(1).optional(),
    benchmarkWeights: z.record(z.string(), z.number()).optional(),
    allowShorts: z.boolean().default(true),
    hardToBorrowSymbols: z.array(z.string()).default([]),
    borrowAvailableSymbols: z.array(z.string()).optional(),
    shortBorrowRateBps: z.number().min(0).optional(),
    shortBorrowMaxBps: z.number().min(0).optional(),
    blockedDates: z.array(z.string()).default([]),
    allowedTradingWeekdays: z.array(z.number().int().min(0).max(6)).optional(),
    staleBarMaxGapDays: z.number().int().positive().optional(),
    staleBarPolicy: z.enum(["warn", "skip", "block"]).default("warn"),
    missingBarPolicy: z.enum(["warn", "skip", "block"]).default("warn"),
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
    executionTiming: z.enum(["open", "close", "next-open", "next-close"]),
    rebalancingFrequency: z.enum(["daily", "weekly", "monthly", "custom"]),
    customRebalanceDays: z
      .array(z.number().int().positive())
      .max(31)
      .optional(),
    riskControls: StrategyRiskControlsSchema.default({}),
  })
  .passthrough();
export type StrategyAssumptions = z.infer<typeof StrategyAssumptionsSchema>;

export const StrategyScriptSchema = z.object({
  language: StrategyScriptLanguageSchema,
  entrypoint: z.string().min(1),
  checksumSha256: z.string().min(16),
  source: z.string().min(1),
});
export type StrategyScript = z.infer<typeof StrategyScriptSchema>;

export const StrategyDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  version: z.string().min(1),
  stage: StrategyResearchStageSchema.default("candidate"),
  tags: z.array(z.string()).max(64).default([]),
  universe: z.array(z.string().min(1)).max(5000),
  script: StrategyScriptSchema,
  assumptions: StrategyAssumptionsSchema,
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type StrategyDefinition = z.infer<typeof StrategyDefinitionSchema>;

export const DatasetSnapshotSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  snapshotAtIso: z.string().datetime(),
  rowCount: z.number().int().nonnegative().optional(),
  sourceManifest: z.record(z.string(), z.unknown()).default({}),
  checksumSha256: z.string().min(16),
});
export type DatasetSnapshot = z.infer<typeof DatasetSnapshotSchema>;

export const StrategyRunStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type StrategyRunStatus = z.infer<typeof StrategyRunStatusSchema>;

export const StrategyRunArtifactSchema = z.object({
  kind: z.enum([
    "manifest",
    "equity_curve",
    "monthly_returns",
    "turnover",
    "positions",
    "trades",
    "report",
    "other",
  ]),
  uri: z.string().min(1),
  checksumSha256: z.string().min(16).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
});
export type StrategyRunArtifact = z.infer<typeof StrategyRunArtifactSchema>;

export const StrategyRunManifestSchema = z.object({
  runId: z.string().min(1),
  strategyId: z.string().min(1),
  strategyVersion: z.string().min(1),
  datasetSnapshotId: z.string().min(1),
  executionMode: StrategyExecutionModeSchema,
  requestedAtIso: z.string().datetime(),
  startedAtIso: z.string().datetime().optional(),
  finishedAtIso: z.string().datetime().optional(),
  status: StrategyRunStatusSchema,
  assumptions: StrategyAssumptionsSchema,
  metrics: z.record(z.string(), z.unknown()).default({}),
  artifacts: z.array(StrategyRunArtifactSchema).default([]),
  notes: z.array(z.string()).max(64).default([]),
});
export type StrategyRunManifest = z.infer<typeof StrategyRunManifestSchema>;

export const StrategyPromotionDecisionSchema = z.object({
  strategyId: z.string().min(1),
  fromStage: StrategyResearchStageSchema,
  toStage: StrategyResearchStageSchema,
  autoGatePassed: z.boolean(),
  manualApprovedBy: z.string().min(1).optional(),
  checklist: z.record(z.string(), z.boolean()).default({}),
  rationale: z.string().default(""),
  decidedAtIso: z.string().datetime(),
});
export type StrategyPromotionDecision = z.infer<
  typeof StrategyPromotionDecisionSchema
>;

export const StrategyForwardProfileSchema = z.object({
  id: z.string().min(1),
  strategyId: z.string().min(1),
  sourceRunId: z.string().min(1),
  rebalanceFrozenAtIso: z.string().datetime(),
  startedAtIso: z.string().datetime(),
  status: z.enum(["active", "paused", "stopped"]),
  benchmark: z.string().min(1).default("SPY"),
});
export type StrategyForwardProfile = z.infer<
  typeof StrategyForwardProfileSchema
>;

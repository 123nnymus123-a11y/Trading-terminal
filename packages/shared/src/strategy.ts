import { z } from "zod";

export const RegimeModeSchema = z.enum([
  "trend-day",
  "mean-reversion-day",
  "high-vol-risk-off",
]);
export type RegimeMode = z.infer<typeof RegimeModeSchema>;

export const TrendDirectionSchema = z.enum(["up", "down", "flat"]);
export type TrendDirection = z.infer<typeof TrendDirectionSchema>;

export const VolStateSchema = z.enum(["low", "normal", "high"]);
export type VolState = z.infer<typeof VolStateSchema>;

export const RegimeUpdateSchema = z.object({
  type: z.literal("compute.regime.update"),
  ts: z.number().int(),
  source: z.enum(["compute", "stub"]).default("compute"),
  mode: RegimeModeSchema,
  trendDirection: TrendDirectionSchema,
  volState: VolStateSchema,
  confidence: z.number().min(0).max(1),
  indexSymbol: z.string().default("SPY"),
  features: z.object({
    indexSlope: z.number().nullable(),
    emaFast: z.number().nullable(),
    emaSlow: z.number().nullable(),
    realizedVol: z.number().nullable(),
    volZScore: z.number().nullable(),
    spreadPct: z.number().nullable(),
    breadthAboveVwap: z.number().nullable(),
  }),
  notes: z.array(z.string()).max(8).default([]),
});
export type RegimeUpdate = z.infer<typeof RegimeUpdateSchema>;

export const SignalComponentSchema = z.object({
  id: z.enum(["vwap-mean-revert", "trend-pullback", "vol-breakout-filter"]),
  score: z.number(),
  confidence: z.number().min(0).max(1).optional(),
  detail: z.string().optional(),
});
export type SignalComponent = z.infer<typeof SignalComponentSchema>;

export const SizingPlanSchema = z.object({
  targetDollars: z.number(),
  volScale: z.number(),
  riskBudgetPerSymbol: z.number(),
  grossExposureCap: z.number().optional(),
  perSymbolCap: z.number().optional(),
});
export type SizingPlan = z.infer<typeof SizingPlanSchema>;

export const ExecutionPlanSchema = z.object({
  allowed: z.boolean(),
  orderType: z.enum(["passive", "aggressive"]),
  maxSlippageBps: z.number(),
  expectedEdgeDollars: z.number(),
  expectedCostDollars: z.number(),
  reasons: z.array(z.string()).max(8),
});
export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>;

export const CamVolatilityStateSchema = z.enum([
  "expanding",
  "neutral",
  "compressed",
  "chaotic",
]);
export type CamVolatilityState = z.infer<typeof CamVolatilityStateSchema>;

export const CamContributorSchema = z.object({
  key: z.string().min(1),
  value: z.number(),
});
export type CamContributor = z.infer<typeof CamContributorSchema>;

export const CamFreshnessSchema = z.object({
  publicFlowAgeMs: z.number().int().nonnegative(),
  congressAgeMs: z.number().int().nonnegative(),
  themeAgeMs: z.number().int().nonnegative(),
  secondOrderAgeMs: z.number().int().nonnegative(),
});
export type CamFreshness = z.infer<typeof CamFreshnessSchema>;

export const CamFeatureDelaysSchema = z.object({
  publicFlowDelayMs: z.number().int().nonnegative(),
  congressDelayMs: z.number().int().nonnegative(),
  themeDelayMs: z.number().int().nonnegative(),
  secondOrderDelayMs: z.number().int().nonnegative(),
});
export type CamFeatureDelays = z.infer<typeof CamFeatureDelaysSchema>;

// ─── CAM Phase 2 — Influence, Policy, and Explainability schemas ──────────────

export const CamInfluenceTierSchema = z.enum([
  "leadership",
  "committee-key",
  "committee-standard",
  "rank-and-file",
]);
export type CamInfluenceTier = z.infer<typeof CamInfluenceTierSchema>;

export const CamHerdingStateSchema = z.enum([
  "low",
  "moderate",
  "high",
  "extreme",
]);
export type CamHerdingState = z.infer<typeof CamHerdingStateSchema>;

export const CamEventWindowPhaseSchema = z.enum([
  "pre-event",
  "event",
  "post-event",
  "none",
]);
export type CamEventWindowPhase = z.infer<typeof CamEventWindowPhaseSchema>;

export const CamConnectionTypeSchema = z.enum([
  "home-state",
  "contributor-linked",
  "procurement-linked",
  "none",
]);
export type CamConnectionType = z.infer<typeof CamConnectionTypeSchema>;

export const CamTradeArchetypeSchema = z.enum([
  "repeated-same-stock",
  "speculative",
  "conflicted",
  "standard",
]);
export type CamTradeArchetype = z.infer<typeof CamTradeArchetypeSchema>;

export const CamBuyVsSellChannelSchema = z.enum([
  "buy",
  "sell",
  "exchange",
  "unknown",
]);
export type CamBuyVsSellChannel = z.infer<typeof CamBuyVsSellChannelSchema>;

export const CamInfluenceTierBreakdownSchema = z.object({
  influenceTier: CamInfluenceTierSchema,
  committeePowerScore: z.number().min(0).max(1),
  seniorityScore: z.number().min(0).max(1),
  leadershipRole: z.string().nullable(),
  committeeJurisdictions: z.array(z.string()).max(10),
  networkProximityScore: z.number().min(0).max(1),
});
export type CamInfluenceTierBreakdown = z.infer<
  typeof CamInfluenceTierBreakdownSchema
>;

export const CamEventWindowFeaturesSchema = z.object({
  phase: CamEventWindowPhaseSchema,
  eventType: z.string().nullable(),
  daysToEvent: z.number().int().nullable(),
  eventDescription: z.string().max(300).nullable(),
  procurementEventLinked: z.boolean().default(false),
  regulatoryEventLinked: z.boolean().default(false),
});
export type CamEventWindowFeatures = z.infer<
  typeof CamEventWindowFeaturesSchema
>;

export const CamLagAdjustedConfidenceSchema = z.object({
  modelConfidence: z.number().min(0).max(1),
  stalenessPenalty: z.number().min(0).max(1),
  disclosureLagAdjustment: z.number().min(-1).max(0),
  effectiveConfidence: z.number().min(0).max(1),
  disclosureLagDays: z.number().int().nonnegative().nullable(),
});
export type CamLagAdjustedConfidence = z.infer<
  typeof CamLagAdjustedConfidenceSchema
>;

export const CamSignedContributorSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  value: z.number(),
  direction: z.enum(["positive", "negative", "neutral"]),
  weight: z.number().min(0).max(1),
});
export type CamSignedContributor = z.infer<typeof CamSignedContributorSchema>;

export const CamExplainabilityPayloadSchema = z.object({
  whyNow: z.string().max(500).nullable(),
  topSignedContributors: z.array(CamSignedContributorSchema).max(8),
  scoreVersion: z.string(),
  tradeArchetype: CamTradeArchetypeSchema,
  buyVsSellChannel: CamBuyVsSellChannelSchema,
  copycatRiskScore: z.number().min(0).max(1),
  repeatedTradePattern: z.boolean(),
  episodicInformedTradeProbability: z.number().min(0).max(1).nullable(),
  informationAsymmetryProxy: z.number().min(0).max(1).nullable(),
});
export type CamExplainabilityPayload = z.infer<
  typeof CamExplainabilityPayloadSchema
>;

export const CamPoliticalConnectionFlagsSchema = z.object({
  connectionTypes: z.array(CamConnectionTypeSchema).max(6),
  localityLink: z.boolean(),
  contributorLink: z.boolean(),
  contractChannelIndicator: z.boolean(),
  divestmentShockFlag: z.boolean(),
});
export type CamPoliticalConnectionFlags = z.infer<
  typeof CamPoliticalConnectionFlagsSchema
>;

// ─────────────────────────────────────────────────────────────────────────────

export const CapitalMomentumSignalSchema = z.object({
  type: z.literal("compute.cam.signal"),
  ts: z.number().int(),
  symbol: z.string().min(1),
  regimeMode: RegimeModeSchema,
  trendScore: z.number().min(0).max(1),
  flowScore: z.number().min(0).max(1),
  volatilityScore: z.number().min(0).max(1),
  breakoutScore: z.number().min(0).max(1),
  volatilityState: CamVolatilityStateSchema,
  compositeScore: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
  threshold: z.number().min(0).max(100),
  passes: z.boolean(),
  gatesFailed: z.array(z.string()).max(12),
  topContributors: z.array(CamContributorSchema).max(8),
  dataFreshness: CamFreshnessSchema,
  featureDelays: CamFeatureDelaysSchema,
  transactionDate: z.number().int().nullable().optional().default(null),
  disclosureDate: z.number().int().nullable().optional().default(null),
  effectiveForTradingAt: z.number().int(),
  suggestedEntry: z.number().nonnegative(),
  stopLoss: z.number().nonnegative(),
  riskSizeDollars: z.number().nonnegative(),
  crashKillTriggered: z.boolean().default(false),
  notes: z.array(z.string()).max(12).default([]),
  // ─── Phase 2 fields — optional for backward compatibility ────────────────
  influenceTierBreakdown: CamInfluenceTierBreakdownSchema.nullable().optional(),
  eventWindowFeatures: CamEventWindowFeaturesSchema.nullable().optional(),
  lagAdjustedConfidence: CamLagAdjustedConfidenceSchema.nullable().optional(),
  explainabilityPayload: CamExplainabilityPayloadSchema.nullable().optional(),
  herdingState: CamHerdingStateSchema.nullable().optional(),
  uncertaintyRegimePenalty: z.number().min(0).max(1).nullable().optional(),
  politicalConnectionFlags:
    CamPoliticalConnectionFlagsSchema.nullable().optional(),
});
export type CapitalMomentumSignal = z.infer<typeof CapitalMomentumSignalSchema>;

export const AlphaSignalSchema = z.object({
  type: z.literal("compute.alpha.signal"),
  ts: z.number().int(),
  symbol: z.string().min(1),
  regimeMode: RegimeModeSchema,
  compositeScore: z.number(),
  compositeConfidence: z.number().min(0).max(1),
  signals: z.array(SignalComponentSchema),
  sizing: SizingPlanSchema,
  execution: ExecutionPlanSchema,
  features: z.object({
    vwapZ: z.number().nullable(),
    realizedVol: z.number().nullable(),
    atr: z.number().nullable(),
    spreadPct: z.number().nullable(),
    volumeAnomaly: z.number().nullable(),
    rangeExpansion: z.number().nullable(),
  }),
});
export type AlphaSignal = z.infer<typeof AlphaSignalSchema>;

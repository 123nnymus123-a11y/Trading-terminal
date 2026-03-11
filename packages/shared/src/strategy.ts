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

export const CamVolatilityStateSchema = z.enum(["expanding", "neutral", "compressed", "chaotic"]);
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
  effectiveForTradingAt: z.number().int(),
  suggestedEntry: z.number().nonnegative(),
  stopLoss: z.number().nonnegative(),
  riskSizeDollars: z.number().nonnegative(),
  crashKillTriggered: z.boolean().default(false),
  notes: z.array(z.string()).max(12).default([]),
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

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

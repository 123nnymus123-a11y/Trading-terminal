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
    licenseKey: z.string().min(8),
  })
  .refine((value) => Boolean(value.email || value.username), {
    message: "email_or_username_required",
    path: ["email"],
  });

export const signupRequestSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3),
  password: z.string().min(8),
  licenseKey: z.string().min(8),
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

export const logoutResponseSchema = z.object({
  ok: z.boolean().optional(),
});

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
  chamber: z.enum(["House", "Senate"]),
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

export const congressQueryTradeItemSchema = z.object({
  id: z.number().int().positive(),
  person_name: z.string(),
  chamber: z.enum(["House", "Senate"]),
  transaction_date: z.string().datetime(),
  disclosure_date: z.string().datetime(),
  transaction_type: z.string(),
  asset_name_raw: z.string(),
  ticker_normalized: z.string().nullable(),
  asset_type: z.enum(["stock", "option", "crypto", "fund", "bond", "other"]),
  amount_range_low: z.number().nullable(),
  amount_range_high: z.number().nullable(),
  amount_currency: z.string(),
  comments_raw: z.string().nullable(),
  source_url: z.string().nullable(),
  quality_flag_ticker_match: z.enum(["confident", "ambiguous", "unmatched"]),
  quality_flag_amount: z.enum(["complete", "partial", "missing"]),
  ingestion_timestamp: z.string().datetime(),
  last_updated_timestamp: z.string().datetime(),
});

export const congressQueryTradesResponseSchema = z.object({
  items: z.array(congressQueryTradeItemSchema),
});

export const congressMemberItemSchema = z.object({
  id: z.number().int().positive(),
  member_id: z.string(),
  full_name: z.string(),
  chamber: z.enum(["House", "Senate"]),
  party: z.string().nullable(),
  state: z.string().nullable(),
  district: z.string().nullable(),
  committee_memberships: z.string().nullable(),
  leadership_roles: z.string().nullable(),
  seniority_indicator: z.string().nullable(),
  office_term_start: z.string().nullable(),
  office_term_end: z.string().nullable(),
  bioguide_id: z.string().nullable(),
  last_updated_timestamp: z.string().datetime(),
});

export const congressMembersResponseSchema = z.object({
  items: z.array(congressMemberItemSchema),
});

export const congressLobbyingItemSchema = z.object({
  id: z.number().int().positive(),
  record_id: z.string().nullable(),
  reporting_entity_name: z.string(),
  client_name: z.string(),
  lobbying_amount: z.number().nullable(),
  period_start: z.string().nullable(),
  period_end: z.string().nullable(),
  issues_topics_raw: z.string().nullable(),
  naics_code: z.string().nullable(),
  ticker_normalized: z.string().nullable(),
  filing_reference_id: z.string().nullable(),
  filing_url: z.string().nullable(),
  ingestion_timestamp: z.string().datetime(),
  last_updated_timestamp: z.string().datetime(),
});

export const congressLobbyingResponseSchema = z.object({
  items: z.array(congressLobbyingItemSchema),
});

export const congressContractItemSchema = z.object({
  id: z.number().int().positive(),
  record_id: z.string().nullable(),
  recipient_name: z.string(),
  contractor_name: z.string(),
  award_amount: z.number().nullable(),
  award_currency: z.string(),
  agency_name: z.string(),
  award_date: z.string().nullable(),
  period_start: z.string().nullable(),
  period_end: z.string().nullable(),
  naics_code: z.string().nullable(),
  category_description: z.string().nullable(),
  ticker_normalized: z.string().nullable(),
  contract_reference_id: z.string().nullable(),
  source_url: z.string().nullable(),
  ingestion_timestamp: z.string().datetime(),
  last_updated_timestamp: z.string().datetime(),
});

export const congressContractsResponseSchema = z.object({
  items: z.array(congressContractItemSchema),
});

export const congressMostTradedItemSchema = z.object({
  ticker: z.string(),
  trade_count: z.number().int().nonnegative(),
  buy_count: z.number().int().nonnegative(),
  sell_count: z.number().int().nonnegative(),
});

export const congressMostTradedResponseSchema = z.object({
  items: z.array(congressMostTradedItemSchema),
});

export const congressDisclosureLagStatsSchema = z.object({
  avg_lag_days: z.number(),
  median_lag_days: z.number(),
  max_lag_days: z.number(),
});

export const congressDisclosureLagResponseSchema = z.object({
  stats: congressDisclosureLagStatsSchema.nullable(),
});

export const publicFlowRecentItemSchema = z.object({
  id: z.number().int().positive(),
  source: z.string(),
  source_url: z.string().nullable(),
  entity_name: z.string(),
  entity_type: z.enum(["institution", "insider", "hedge-fund", "etf", "other"]),
  owner_type: z.enum(["institutional", "insider", "beneficial-owner", "other"]),
  ticker: z.string().nullable(),
  asset_name: z.string(),
  action: z.enum(["BUY", "SELL"]),
  tx_date: z.string().datetime(),
  report_date: z.string().datetime(),
  amount_min: z.number().nullable(),
  amount_max: z.number().nullable(),
  sector: z.string().nullable(),
  industry: z.string().nullable(),
  confidence: z.number(),
  raw_json: z.string().nullable(),
  created_at: z.string().datetime(),
});

export const publicFlowRecentResponseSchema = z.object({
  items: z.array(publicFlowRecentItemSchema),
  cached: z.boolean().optional(),
});

export const publicFlowThemeItemSchema = z.object({
  id: z.number().int().positive(),
  window_days: z.union([z.literal(7), z.literal(30)]),
  window_start: z.string().datetime(),
  window_end: z.string().datetime(),
  sector: z.string(),
  score: z.number(),
  summary: z.string(),
  created_at: z.string().datetime(),
});

export const publicFlowThemesResponseSchema = z.object({
  items: z.array(publicFlowThemeItemSchema),
  cached: z.boolean().optional(),
});

export const publicFlowCandidateItemSchema = z.object({
  id: z.number().int().positive(),
  theme_id: z.number().int().positive(),
  ticker: z.string(),
  rationale: z.string(),
  relation_type: z.enum(["peer", "supplier", "customer", "etf-constituent"]),
  created_at: z.string().datetime(),
});

export const publicFlowCandidatesResponseSchema = z.object({
  items: z.array(publicFlowCandidateItemSchema),
});

export const publicFlowValuationTagSchema = z.object({
  ticker: z.string(),
  tag: z.enum(["overvalued", "fair", "undervalued"]),
  confidence: z.number(),
  updated_at: z.string().datetime(),
  basis: z.array(z.string()),
});

export const publicFlowValuationsResponseSchema = z.object({
  items: z.record(publicFlowValuationTagSchema),
});

export const publicFlowRefreshResponseSchema = z.object({
  ok: z.boolean(),
  ts: z.number().int().optional(),
});

export const userSettingsResponseSchema = z.object({
  settings: z.record(z.unknown()),
});

export const supplyChainCacheResponseSchema = z.object({
  keys: z.array(z.string()),
});

export const supplyChainGenerateRequestSchema = z.object({
  ticker: z.string().min(1),
  globalTickers: z.array(z.string()).optional(),
  strictMode: z.boolean().optional(),
  includeHypothesis: z.boolean().optional(),
  hops: z.number().int().positive().optional(),
  minEdgeWeight: z.number().optional(),
});

export const supplyChainGenerateResponseSchema = z.object({
  success: z.boolean(),
  data: z
    .object({
      centerTicker: z.string(),
      categories: z.array(z.unknown()),
      insights: z.array(z.string()),
    })
    .passthrough(),
  fromCache: z.boolean(),
  needsRefresh: z.boolean(),
  cacheKey: z.string(),
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
export type SignupRequest = z.infer<typeof signupRequestSchema>;
export type RefreshTokenRequest = z.infer<typeof refreshTokenRequestSchema>;
export type LogoutRequest = z.infer<typeof logoutRequestSchema>;
export type LogoutResponse = z.infer<typeof logoutResponseSchema>;
export type AuthUser = z.infer<typeof authUserSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
export type RuntimeFlagsResponse = z.infer<typeof runtimeFlagsResponseSchema>;
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
export type CongressQueryTradeItem = z.infer<
  typeof congressQueryTradeItemSchema
>;
export type CongressQueryTradesResponse = z.infer<
  typeof congressQueryTradesResponseSchema
>;
export type CongressMemberItem = z.infer<typeof congressMemberItemSchema>;
export type CongressMembersResponse = z.infer<
  typeof congressMembersResponseSchema
>;
export type CongressLobbyingItem = z.infer<typeof congressLobbyingItemSchema>;
export type CongressLobbyingResponse = z.infer<
  typeof congressLobbyingResponseSchema
>;
export type CongressContractItem = z.infer<typeof congressContractItemSchema>;
export type CongressContractsResponse = z.infer<
  typeof congressContractsResponseSchema
>;
export type CongressMostTradedItem = z.infer<
  typeof congressMostTradedItemSchema
>;
export type CongressMostTradedResponse = z.infer<
  typeof congressMostTradedResponseSchema
>;
export type CongressDisclosureLagStats = z.infer<
  typeof congressDisclosureLagStatsSchema
>;
export type CongressDisclosureLagResponse = z.infer<
  typeof congressDisclosureLagResponseSchema
>;
export type PublicFlowRecentItem = z.infer<typeof publicFlowRecentItemSchema>;
export type PublicFlowRecentResponse = z.infer<
  typeof publicFlowRecentResponseSchema
>;
export type PublicFlowThemeItem = z.infer<typeof publicFlowThemeItemSchema>;
export type PublicFlowThemesResponse = z.infer<
  typeof publicFlowThemesResponseSchema
>;
export type PublicFlowCandidateItem = z.infer<
  typeof publicFlowCandidateItemSchema
>;
export type PublicFlowCandidatesResponse = z.infer<
  typeof publicFlowCandidatesResponseSchema
>;
export type PublicFlowValuationTag = z.infer<
  typeof publicFlowValuationTagSchema
>;
export type PublicFlowValuationsResponse = z.infer<
  typeof publicFlowValuationsResponseSchema
>;
export type PublicFlowRefreshResponse = z.infer<
  typeof publicFlowRefreshResponseSchema
>;
export type UserSettingsResponse = z.infer<typeof userSettingsResponseSchema>;
export type SupplyChainCacheResponse = z.infer<
  typeof supplyChainCacheResponseSchema
>;
export type SupplyChainGenerateRequest = z.infer<
  typeof supplyChainGenerateRequestSchema
>;
export type SupplyChainGenerateResponse = z.infer<
  typeof supplyChainGenerateResponseSchema
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

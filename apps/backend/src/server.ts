import cors from "cors";
import express, { type Request, type Response } from "express";
import {
  aiJobEnqueueResponseSchema,
  aiJobStatusResponseSchema,
  aiModelsListResponseSchema,
  aiResearchConfigRequestSchema,
  aiResearchRunRequestSchema,
  calendarInsightRequestSchema,
  calendarInsightResponseSchema,
  congressTradesResponseSchema,
  createStrategyRequestSchema,
  createStrategyResponseSchema,
  createStrategyVersionRequestSchema,
  createStrategyVersionResponseSchema,
  getLatestVersionResponseSchema,
  getStrategyResponseSchema,
  gwmdSyncPullResponseSchema,
  gwmdSyncPushRequestSchema,
  gwmdSyncPushResponseSchema,
  graphSorFactUpsertRequestSchema,
  graphSorFactUpsertResponseSchema,
  graphSorStatusResponseSchema,
  gwmdSyncStatusResponseSchema,
  healthResponseSchema,
  listStrategiesResponseSchema,
  loginRequestSchema,
  loginResponseSchema,
  logoutRequestSchema,
  meResponseSchema,
  publicFlowEventsResponseSchema,
  refreshTokenRequestSchema,
  runtimeFlagsResponseSchema,
  strategyBacktestRunEnqueueResponseSchema,
  strategyBacktestRunRequestSchema,
  strategyBacktestRunStatusResponseSchema,
  strategyDatasetSnapshotsResponseSchema,
  strategyBacktestArtifactsResponseSchema,
  strategyBacktestCompareResponseSchema,
  strategyBacktestRobustnessRequestSchema,
  strategyBacktestRobustnessResponseSchema,
  strategyConnectorListResponseSchema,
  strategyConnectorUpsertRequestSchema,
  strategyForwardProfileAlertsResponseSchema,
  strategyForwardProfileCreateRequestSchema,
  strategyForwardProfileDriftResponseSchema,
  strategyForwardProfileListResponseSchema,
  strategyForwardProfileStatusUpdateRequestSchema,
  strategyGovernanceReadinessResponseSchema,
  strategyGovernanceProfileListResponseSchema,
  strategyGovernanceProfileUpsertRequestSchema,
  strategyPromotionRequestSchema,
  strategyAcceptancePackListResponseSchema,
  strategyAcceptancePackUpsertRequestSchema,
  strategyRunExperimentRequestSchema,
  strategyRunExperimentResponseSchema,
  updateStrategyRequestSchema,
  signupRequestSchema,
  totpDisableRequestSchema,
  totpVerifyRequestSchema,
} from "./contracts.js";
import { createLogger } from "./logger.js";
import { createAuthService } from "./auth.js";
import {
  attachTenantContext,
  extractBearerToken,
  requireAuth,
  requireRoles,
} from "./authMiddleware.js";
import {
  clearSupplyChainCache,
  computeIndicators,
  createSupplyChainMap,
  getDisclosureEvents,
  getDisclosureLagStats,
  getMostTradedTickers,
  getSectorThemes,
  getSupplyChainCachedKeys,
  getValuationTags,
  getWatchlistCandidates,
  listCongressTrades,
  listPublicFlowEvents,
  queryCongressionalMembers,
  queryCongressionalTrades,
  queryFederalContracts,
  queryLobbyingActivities,
} from "./domainStore.js";
import type { AppEnv } from "./config.js";
import type { WebSocketMetricsReader } from "./wsHub.js";
import type { BackendInfra } from "./infra.js";
import { OllamaCloudClient } from "./services/ollama/ollamaClient.js";
import { createAiResearchService } from "./services/aiResearch/aiResearchService.js";
import { createAiCongressService } from "./services/congress/aiCongressService.js";
import { createSupplyChainService } from "./services/supplyChain/supplyChainService.js";
import { createGwmdCloudService } from "./services/gwmd/gwmdCloudService.js";
import { createGraphSorService } from "./services/graphSor/graphSorService.js";
import { createAiOrchestratorService } from "./services/orchestrator/aiOrchestratorService.js";
import { createAiStewardService } from "./services/steward/aiStewardService.js";
import { createEconomicInsightsService } from "./services/economicCalendar/economicInsightsService.js";
import { buildTedIntelSnapshot } from "./services/tedIntel/tedIntel.js";
import {
  applyTedLiveConfigPatch,
  fetchLiveTedSnapshotStrict,
  getTedLiveConfigStatus,
  TedLiveError,
} from "./services/tedIntel/tedIntelLive.js";
import { createProcurementIntelService } from "./services/procurementIntel/procurementIntelService.js";
import { createEdgarIntelService } from "./services/edgarIntel/edgarIntelService.js";
import { createBacktestingService } from "./services/backtesting/backtestingService.js";
import { createLineageDiffService } from "./services/backtesting/lineageDiffService.js";
import { createBacktestWorker } from "./services/backtesting/backtestWorker.js";
import { BacktestingRepo } from "./services/backtesting/backtestingRepo.js";
import { createBacktestRobustnessService } from "./services/backtesting/backtestRobustnessService.js";
import { compareRunMetrics } from "./services/backtesting/backtestAnalytics.js";
import { AuthSessionStore, isRefreshTokenMatch } from "./authSessionStore.js";
import {
  buildOtpAuthUrl,
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  verifyTotpCode,
} from "./totp.js";
import { randomUUID } from "node:crypto";
import type {
  EdgarFlowAnomalyFinding,
  EdgarFlowIntelPayload,
} from "@tc/shared";
import {
  buildFlowAnomalyFingerprint,
  buildFlowIntelPayload,
} from "./services/edgarIntel/flowIntelEngine.js";
import { createAuthEmailService } from "./authEmail.js";
import metricsRegistry, {
  aiQueueGauge,
  aiQueueRunningGauge,
  httpErrorCounter,
  httpRequestCounter,
  httpRequestDurationMs,
} from "./metrics.js";
import DurableJobQueue from "./queue.js";

const logger = createLogger("http");

function toIsoDay(now: Date, daysBack: number): string {
  const since = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
  return since.toISOString().slice(0, 10);
}

export function createServer(
  version: string,
  env: AppEnv,
  readWsMetrics: WebSocketMetricsReader,
  infra: BackendInfra,
) {
  const app = express();
  app.disable("x-powered-by");
  const corsOriginRaw = env.CORS_ORIGIN.trim();
  if (env.NODE_ENV === "production" && corsOriginRaw === "*") {
    throw new Error("CORS_ORIGIN cannot be '*' in production");
  }
  const corsOrigin =
    corsOriginRaw === "*"
      ? true
      : corsOriginRaw
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
  // rate limiter & job queue setup
  const aiQueue = new DurableJobQueue({
    concurrency: env.AI_QUEUE_CONCURRENCY,
    maxQueue: env.AI_QUEUE_MAX,
    retryLimit: env.AI_QUEUE_RETRY_LIMIT,
    jobTtlSeconds: env.AI_QUEUE_JOB_TTL_SECONDS,
    ...(env.REDIS_URL ? { redisUrl: env.REDIS_URL } : {}),
    namespace: "tcq:ai",
  });

  const normalizeMetricRoute = (req: Request): string => {
    if (req.route && typeof req.route.path === "string") {
      return `${req.baseUrl || ""}${req.route.path}`;
    }
    return req.path || req.originalUrl || "unknown";
  };

  const refreshAiQueueMetrics = async () => {
    try {
      await refreshAiQueueMetrics();
      aiQueueRunningGauge.set(aiQueue.getRunningCount());
    } catch (error) {
      logger.warn("ai_queue_metrics_refresh_failed", {
        error: error instanceof Error ? error.message : "unknown_error",
      });
    }
  };
  const auth = createAuthService(env, infra.pool);
  const authEmail = createAuthEmailService(env);
  const authGuard = requireAuth(auth.verifyAccessToken);
  const operatorOrAdminGuard = requireRoles(["admin", "operator"], {
    enabled: env.AUTH_RBAC_ENFORCED,
  });
  const ollama = new OllamaCloudClient(env);
  const aiResearch = infra.pool
    ? createAiResearchService(infra.pool, ollama, env)
    : null;
  const aiCongress = infra.pool
    ? createAiCongressService(infra.pool, ollama, env)
    : null;
  const supplyChain = infra.pool
    ? createSupplyChainService(infra.pool, ollama, env)
    : null;
  const gwmdCloud = infra.pool ? createGwmdCloudService(infra.pool) : null;
  const graphSor = infra.pool ? createGraphSorService(infra.pool) : null;
  const aiOrchestrator = infra.pool
    ? createAiOrchestratorService(infra.pool, env)
    : null;
  const aiSteward = infra.pool
    ? createAiStewardService(infra.pool, env, async () => ({
        queueDepth: await aiQueue.getQueueDepth(),
        queueRunning: aiQueue.getRunningCount(),
        migrationFlags: {
          backendOnlyProcessing: env.MIGRATION_BACKEND_ONLY_PROCESSING,
          desktopLocalFallback: env.MIGRATION_DESKTOP_LOCAL_FALLBACK,
          webPrimaryRouting: env.MIGRATION_WEB_PRIMARY_ROUTING,
        },
      }))
    : null;
  const economicInsights = createEconomicInsightsService(env);
  const authSessionStore =
    env.AUTH_SESSION_STORE_ENABLED && infra.pool
      ? new AuthSessionStore(infra.pool)
      : null;
  let tedLiveConfig = {
    enabled: env.TED_LIVE_ENABLED,
    baseUrl: env.TED_LIVE_BASE_URL ?? "",
    apiKey: env.TED_LIVE_API_KEY ?? "",
    authHeader: env.TED_LIVE_AUTH_HEADER,
    timeoutMs: env.TED_LIVE_TIMEOUT_MS,
    windowQueryParam: env.TED_LIVE_WINDOW_QUERY_PARAM,
  };
  const procurementIntel = createProcurementIntelService(
    infra.pool,
    env,
    () => tedLiveConfig,
  );
  const edgarIntel = createEdgarIntelService(infra.pool, env);

  // Backtest queue and service setup
  const backtestQueue = new DurableJobQueue({
    concurrency: 2,
    maxQueue: 100,
    retryLimit: 2,
    jobTtlSeconds: 7200, // 2 hours
    ...(env.REDIS_URL ? { redisUrl: env.REDIS_URL } : {}),
    namespace: "tcq:backtest",
  });

  const backtesting = infra.pool
    ? createBacktestingService(infra.pool, backtestQueue)
    : null;
  const backtestingRepo = infra.pool ? new BacktestingRepo(infra.pool) : null;
  const lineageDiff = infra.pool ? createLineageDiffService(infra.pool) : null;
  const backtestRobustness = infra.pool
    ? createBacktestRobustnessService(infra.pool)
    : null;

  if (backtesting && infra.pool) {
    createBacktestWorker(infra.pool, backtestQueue, "database");
    logger.info("backtest_worker_initialized", {
      concurrency: 2,
      dataProvider: "database",
    });
  }
  const defaultEdgarCiks = env.EDGAR_WATCHER_CIKS.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (env.EDGAR_WATCHER_ENABLED && defaultEdgarCiks.length) {
    void edgarIntel
      .startWatcher("global", {
        ciks: defaultEdgarCiks,
        forms: ["8-K", "10-K", "10-Q", "4"],
        intervalSec: env.EDGAR_WATCHER_INTERVAL_SECONDS,
        perCikLimit: 20,
      })
      .then(() => {
        logger.info("edgar_watcher_autostarted", {
          ciks: defaultEdgarCiks.length,
          intervalSec: env.EDGAR_WATCHER_INTERVAL_SECONDS,
        });
      })
      .catch((error) => {
        logger.error("edgar_watcher_autostart_failed", {
          error: error instanceof Error ? error.message : "unknown_error",
        });
      });
  }

  const parseCsvQuery = (value: unknown): string[] => {
    if (Array.isArray(value)) {
      return value
        .flatMap((part) => (typeof part === "string" ? part.split(",") : []))
        .map((part) => part.trim())
        .filter(Boolean);
    }
    if (typeof value === "string") {
      return value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
    }
    return [];
  };

  const parseProcurementFilters = (req: Request) => {
    const minValue = Number(req.query.minValue);
    const maxValue = Number(req.query.maxValue);
    const minConfidence = Number(req.query.minConfidence);
    const limit = Number(req.query.limit);
    return {
      ...(parseCsvQuery(req.query.country).length
        ? { country: parseCsvQuery(req.query.country) }
        : {}),
      ...(parseCsvQuery(req.query.region).length
        ? { region: parseCsvQuery(req.query.region) }
        : {}),
      ...(parseCsvQuery(req.query.cpv).length
        ? { cpv: parseCsvQuery(req.query.cpv) }
        : {}),
      ...(parseCsvQuery(req.query.sectorTag).length
        ? { sector_tag: parseCsvQuery(req.query.sectorTag) }
        : {}),
      ...(parseCsvQuery(req.query.themeTag).length
        ? { theme_tag: parseCsvQuery(req.query.themeTag) }
        : {}),
      ...(parseCsvQuery(req.query.commodityTag).length
        ? { commodity_tag: parseCsvQuery(req.query.commodityTag) }
        : {}),
      ...(parseCsvQuery(req.query.buyer).length
        ? { buyer: parseCsvQuery(req.query.buyer) }
        : {}),
      ...(parseCsvQuery(req.query.supplier).length
        ? { supplier: parseCsvQuery(req.query.supplier) }
        : {}),
      ...(Number.isFinite(minValue) ? { min_value: minValue } : {}),
      ...(Number.isFinite(maxValue) ? { max_value: maxValue } : {}),
      ...(Number.isFinite(minConfidence)
        ? { min_confidence: minConfidence }
        : {}),
      ...(parseCsvQuery(req.query.strategicImportance).length
        ? {
            strategic_importance: parseCsvQuery(req.query.strategicImportance),
          }
        : {}),
      ...(typeof req.query.fromDate === "string"
        ? { from_date: req.query.fromDate }
        : {}),
      ...(typeof req.query.toDate === "string"
        ? { to_date: req.query.toDate }
        : {}),
      ...(Number.isFinite(limit) ? { limit } : {}),
    };
  };

  const parseEdgarFilters = (req: Request) => {
    const limit = Number(req.query.limit);
    const minScore = Number(req.query.minScore);
    const formTypeRaw =
      typeof req.query.formType === "string"
        ? req.query.formType.trim().toUpperCase()
        : "";
    const formType =
      formTypeRaw === "8-K" ||
      formTypeRaw === "10-K" ||
      formTypeRaw === "10-Q" ||
      formTypeRaw === "4"
        ? formTypeRaw
        : undefined;
    return {
      ...(typeof req.query.cik === "string" ? { cik: req.query.cik } : {}),
      ...(typeof req.query.ticker === "string"
        ? { ticker: req.query.ticker }
        : {}),
      ...(formType ? { formType } : {}),
      ...(typeof req.query.fromDate === "string"
        ? { fromDate: req.query.fromDate }
        : {}),
      ...(typeof req.query.toDate === "string"
        ? { toDate: req.query.toDate }
        : {}),
      ...(Number.isFinite(minScore) ? { minScore } : {}),
      ...(Number.isFinite(limit) ? { limit } : {}),
    };
  };

  const persistFlowAnomalyReports = async (
    scopeId: string,
    payload: EdgarFlowIntelPayload,
    cooldownHours: number,
  ) => {
    if (!infra.pool) {
      return { inserted: 0, suppressed: payload.anomalies.length };
    }

    const scope = scopeId.trim() || "global";
    let inserted = 0;
    let suppressed = 0;

    try {
      for (const anomaly of payload.anomalies) {
        const fingerprint = buildFlowAnomalyFingerprint(anomaly);
        const existing = await infra.pool.query<{ id: string }>(
          `SELECT id
             FROM edgar_flow_anomaly_report
            WHERE scope_id = $1
              AND fingerprint = $2
              AND reported_at >= NOW() - ($3 * INTERVAL '1 hour')
            LIMIT 1`,
          [scope, fingerprint, cooldownHours],
        );

        if (existing.rowCount && existing.rowCount > 0) {
          suppressed += 1;
          continue;
        }

        await infra.pool.query(
          `INSERT INTO edgar_flow_anomaly_report (
             scope_id,
             filing_id,
             ticker,
             company_name,
             severity,
             anomaly_score,
             triggers,
             rationale,
             filed_at,
             fingerprint,
             window_days,
             source_payload
           ) VALUES (
             $1,
             $2,
             $3,
             $4,
             $5,
             $6,
             $7::jsonb,
             $8,
             $9::timestamptz,
             $10,
             $11,
             $12::jsonb
           )`,
          [
            scope,
            anomaly.filing_id,
            anomaly.ticker ?? null,
            anomaly.company_name,
            anomaly.severity,
            anomaly.anomaly_score,
            JSON.stringify(anomaly.triggers),
            anomaly.rationale,
            anomaly.filed_at,
            fingerprint,
            payload.window_days,
            JSON.stringify(anomaly),
          ],
        );
        inserted += 1;
      }
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: unknown }).code ?? "")
          : "";
      if (code === "42P01") {
        logger.warn("edgar_flow_anomaly_report_table_missing", {
          scope,
          table: "edgar_flow_anomaly_report",
        });
        return { inserted: 0, suppressed: payload.anomalies.length };
      }
      throw error;
    }

    return { inserted, suppressed };
  };

  const listRecentFlowAnomalyReports = async (
    scopeId: string,
    limit: number,
  ): Promise<EdgarFlowAnomalyFinding[]> => {
    if (!infra.pool) {
      return [];
    }

    const scope = scopeId.trim() || "global";
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    let result;
    try {
      result = await infra.pool.query<{
        filing_id: string;
        ticker: string | null;
        company_name: string;
        severity: "info" | "warning" | "critical";
        anomaly_score: number;
        triggers: string[];
        rationale: string;
        filed_at: string;
        reported_at: string;
      }>(
        `SELECT filing_id,
                ticker,
                company_name,
                severity,
                anomaly_score,
                triggers,
                rationale,
                filed_at::text,
                reported_at::text
           FROM edgar_flow_anomaly_report
          WHERE scope_id = $1
          ORDER BY reported_at DESC
          LIMIT $2`,
        [scope, safeLimit],
      );
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: unknown }).code ?? "")
          : "";
      if (code === "42P01") {
        logger.warn("edgar_flow_anomaly_report_table_missing", {
          scope,
          table: "edgar_flow_anomaly_report",
        });
        return [];
      }
      throw error;
    }

    return result.rows.map((row) => ({
      id: `report:${row.filing_id}:${row.reported_at}`,
      filing_id: row.filing_id,
      ...(row.ticker ? { ticker: row.ticker } : {}),
      company_name: row.company_name,
      severity: row.severity,
      anomaly_score: Number(row.anomaly_score),
      triggers: Array.isArray(row.triggers) ? row.triggers : [],
      rationale: row.rationale,
      filed_at: row.filed_at,
    }));
  };

  async function syncDomainUser(
    user: { id: string; email: string; username?: string },
    tenantId?: string,
  ) {
    if (!infra.pool) return;
    try {
      const tenant = tenantId ?? env.DEFAULT_TENANT_ID;
      await infra.pool.query(
        "INSERT INTO users (id, tenant_id, email, username) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, email = EXCLUDED.email, username = EXCLUDED.username",
        [user.id, tenant, user.email, user.username ?? user.email],
      );
    } catch (err) {
      logger.error("user_sync_failed", err);
    }
  }

  app.use(
    cors({
      origin: Array.isArray(corsOrigin) ? corsOrigin : corsOrigin,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use((req: Request, res: Response, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-DNS-Prefetch-Control", "off");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-site");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    if (env.NODE_ENV === "production") {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  });
  app.use(
    attachTenantContext(
      env.DEFAULT_TENANT_ID,
      env.MIGRATION_REQUIRE_TENANT_HEADER,
    ),
  );
  app.use((req, res, next) => {
    void infra.rateLimitMiddleware(req, res, next);
  });

  const migrationFlags = {
    backendOnlyProcessing: env.MIGRATION_BACKEND_ONLY_PROCESSING,
    desktopLocalFallback: env.MIGRATION_DESKTOP_LOCAL_FALLBACK,
    webPrimaryRouting: env.MIGRATION_WEB_PRIMARY_ROUTING,
    requireTenantHeader: env.MIGRATION_REQUIRE_TENANT_HEADER,
  };

  if (aiResearch) {
    aiQueue.registerProcessor<
      {
        userId: string;
        tenantId: string;
        manualItems: Array<{ title: string; text: string }>;
        model: string;
      },
      { runId: string; status: "completed" }
    >("ai.research.run", async (payload) => {
      const result = await aiResearch.runNow(
        payload.userId,
        payload.manualItems,
        payload.model,
        payload.tenantId,
      );
      if (!result.ok || !result.runId) {
        throw new Error(result.error);
      }
      return { runId: result.runId, status: "completed" };
    });
  }

  if (aiCongress) {
    aiQueue.registerProcessor<
      {
        userId: string;
        tenantId: string;
        tradeId: string;
        tradeData: {
          member: string;
          ticker: string;
          side: string;
          amount: string;
          date: string;
        };
        model?: string;
      },
      { ok: boolean; analysis?: unknown; error?: string }
    >("ai.congress.analyze", async (payload) => {
      const result = await aiCongress.analyzeTradeForSentiment(
        payload.userId,
        payload.tradeId,
        payload.tradeData,
        payload.model,
        payload.tenantId,
      );
      if (!result.ok) {
        throw new Error(result.error ?? "ai_congress_failed");
      }
      return result;
    });
  }

  if (supplyChain) {
    aiQueue.registerProcessor<
      {
        userId: string;
        tenantId: string;
        ticker: string;
        options?: {
          globalTickers?: string[];
          includeHypothesis?: boolean;
          hops?: number;
        };
        model?: string;
      },
      { ok: boolean; data?: unknown; cacheKey?: string; error?: string }
    >("ai.supplychain.generate", async (payload) => {
      const result = await supplyChain.generateMap(
        payload.userId,
        payload.ticker,
        payload.options,
        payload.model,
        payload.tenantId,
      );
      if (!result.ok) {
        throw new Error(result.error ?? "supply_chain_failed");
      }
      return result;
    });
  }

  aiQueue.registerProcessor<
    {
      tenantId: string;
      request: {
        focus: "upcoming" | "released";
        windowHours: number;
        events: Array<{
          id: string;
          title: string;
          releaseDateTime: string;
          status: "upcoming" | "released" | "revised";
          importance: 1 | 2 | 3;
          eventCategory:
            | "inflation"
            | "employment"
            | "growth"
            | "trade"
            | "housing"
            | "confidence"
            | "other";
          country: string;
          confidenceScore?: number;
          summary?: string;
        }>;
        model?: string;
      };
    },
    {
      aiEngine: "cloud" | "heuristic";
      generatedAt: string;
      headline: string;
      synopsis: string;
      bullets: string[];
      riskSignals: Array<{
        label: string;
        detail: string;
        severity: "low" | "medium" | "high";
      }>;
      focusEvents: Array<{
        id: string;
        title: string;
        eta: string;
        status: "upcoming" | "released" | "revised";
        importance: 1 | 2 | 3;
        aiView: string;
      }>;
    }
  >("ai.economic.insights", async (payload) => {
    return economicInsights.generateInsights(payload.request, payload.tenantId);
  });

  app.use((req: Request, res: Response, next) => {
    const startedAt = process.hrtime.bigint();
    res.on("finish", () => {
      const durationMs =
        Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const status = String(res.statusCode);
      const route = normalizeMetricRoute(req);
      httpRequestCounter.inc({ method: req.method, route, status });
      httpRequestDurationMs.observe(
        { method: req.method, route, status },
        durationMs,
      );
      if (res.statusCode >= 400) {
        httpErrorCounter.inc({ route, status });
      }
    });
    next();
  });

  const isMetricsAuthorized = (req: Request): boolean => {
    const candidateAuth = req.headers.authorization;
    const bearer =
      typeof candidateAuth === "string" && candidateAuth.startsWith("Bearer ")
        ? candidateAuth.slice("Bearer ".length).trim()
        : null;
    const headerToken =
      typeof req.headers["x-metrics-token"] === "string"
        ? req.headers["x-metrics-token"].trim()
        : null;
    const token = bearer ?? headerToken;
    return Boolean(env.METRICS_TOKEN && token && token === env.METRICS_TOKEN);
  };

  app.get("/metrics/prometheus", async (req: Request, res: Response) => {
    if (!isMetricsAuthorized(req)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    res.set("Content-Type", metricsRegistry.register.contentType);
    res.end(await metricsRegistry.register.metrics());
  });

  app.use("/api", async (req: Request, res: Response, next) => {
    if (!authSessionStore || !env.AUTH_SESSION_STORE_ENABLED) {
      next();
      return;
    }
    if (req.path.startsWith("/auth/")) {
      next();
      return;
    }

    const token = extractBearerToken(req.headers.authorization);
    if (!token) {
      next();
      return;
    }

    const verified = auth.verifyAccessTokenDetailed(token);
    if (!verified?.claims.sid) {
      next();
      return;
    }

    const session = await authSessionStore.getSession(verified.claims.sid);
    if (
      !session ||
      session.userId !== verified.user.id ||
      session.status !== "active"
    ) {
      res.status(401).json({ error: "session_inactive" });
      return;
    }

    await authSessionStore.touchSession(session.id);
    next();
  });

  app.use("/api/ai", authGuard, async (req: Request, res: Response, next) => {
    const identity = req.user?.id ?? req.ip ?? "anonymous";
    const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
    const routePath = req.path.replace(/\/[0-9a-fA-F-]{8,}/g, "/:id");
    const key = `rate:ai:${tenantId}:${identity}:${routePath}`;
    try {
      const count = await infra.cache.incrementRateKey(
        key,
        env.AI_RATE_LIMIT_WINDOW_SECONDS,
      );
      if (count > env.AI_RATE_LIMIT_MAX_REQUESTS) {
        res.set("Retry-After", String(env.AI_RATE_LIMIT_WINDOW_SECONDS));
        res.status(429).json({
          error: "ai_rate_limited",
          retryAfterSeconds: env.AI_RATE_LIMIT_WINDOW_SECONDS,
        });
        return;
      }
      next();
    } catch (error) {
      logger.error("ai_rate_limit_failed", {
        error: error instanceof Error ? error.message : "unknown_error",
        routePath,
      });
      next();
    }
  });

  app.get("/health", (_req: Request, res: Response) => {
    const payload = healthResponseSchema.parse({
      status: "ok",
      service: "trading-cockpit-backend",
      version,
      now: new Date().toISOString(),
    });
    res.status(200).json(payload);
  });

  app.get("/api/runtime/flags", (req: Request, res: Response) => {
    const payload = runtimeFlagsResponseSchema.parse({
      flags: migrationFlags,
      tenant: {
        tenantId: req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID,
        source: req.tenantContext?.source ?? "default",
      },
    });
    res.status(200).json(payload);
  });

  const normalizeAuthIdentifier = (identifier: string): string =>
    identifier.trim().toLowerCase() || "unknown";

  const buildAuthLoginKeys = (identifier: string, ipAddress: string) => {
    const normalizedIdentifier = normalizeAuthIdentifier(identifier);
    const normalizedIp = ipAddress.trim() || "unknown";
    return {
      failureKey: `auth:login:fail:${normalizedIdentifier}:${normalizedIp}`,
      lockKey: `auth:login:lock:${normalizedIdentifier}:${normalizedIp}`,
    };
  };

  const enforceSignupRateLimit = async (ipAddress: string): Promise<number | null> => {
    const normalizedIp = ipAddress.trim() || "unknown";
    const key = `auth:signup:ip:${normalizedIp}`;
    const count = await infra.cache.incrementRateKey(
      key,
      env.AUTH_SIGNUP_WINDOW_SECONDS,
    );
    if (count <= env.AUTH_SIGNUP_MAX_ATTEMPTS_PER_IP) {
      return null;
    }
    return env.AUTH_SIGNUP_WINDOW_SECONDS;
  };

  const enforceLoginLockout = async (
    identifier: string,
    ipAddress: string,
  ): Promise<number | null> => {
    const { lockKey } = buildAuthLoginKeys(identifier, ipAddress);
    const lockUntilMs = await infra.cache.getJson<number>(lockKey);
    if (!lockUntilMs || lockUntilMs <= Date.now()) {
      return null;
    }
    return Math.ceil((lockUntilMs - Date.now()) / 1000);
  };

  const registerLoginFailure = async (
    identifier: string,
    ipAddress: string,
    userAgent?: string,
  ): Promise<number | null> => {
    const { failureKey, lockKey } = buildAuthLoginKeys(identifier, ipAddress);
    const failures = await infra.cache.incrementRateKey(
      failureKey,
      env.AUTH_LOGIN_WINDOW_SECONDS,
    );
    if (failures < env.AUTH_LOGIN_MAX_ATTEMPTS) {
      return null;
    }

    const lockUntil = Date.now() + env.AUTH_LOGIN_LOCKOUT_SECONDS * 1000;
    await infra.cache.setJson(lockKey, lockUntil, env.AUTH_LOGIN_LOCKOUT_SECONDS);
    if (authSessionStore) {
      void authSessionStore.writeAuditEvent({
        eventType: "auth.login_lockout",
        outcome: "threshold_exceeded",
        metadata: {
          identifier: normalizeAuthIdentifier(identifier),
          failures,
          lockoutSeconds: env.AUTH_LOGIN_LOCKOUT_SECONDS,
        },
        ...(ipAddress ? { ipAddress } : {}),
        ...(userAgent ? { userAgent } : {}),
      });
    }
    return env.AUTH_LOGIN_LOCKOUT_SECONDS;
  };

  const clearLoginFailureState = async (identifier: string, ipAddress: string) => {
    const { failureKey, lockKey } = buildAuthLoginKeys(identifier, ipAddress);
    await infra.cache.deleteKey(failureKey);
    await infra.cache.deleteKey(lockKey);
  };

  app.post("/api/auth/signup", async (req: Request, res: Response) => {
    const signupRetryAfter = await enforceSignupRateLimit(req.ip ?? "unknown");
    if (signupRetryAfter) {
      res.set("Retry-After", String(signupRetryAfter));
      res.status(429).json({
        error: "signup_rate_limited",
        retryAfterSeconds: signupRetryAfter,
      });
      return;
    }

    const parsed = signupRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "invalid_request", details: parsed.error.flatten() });
      return;
    }

    const signupResult = await auth.createUserAccount(parsed.data);
    if (!signupResult.ok) {
      if (signupResult.error === "auth_store_unavailable") {
        res.status(503).json({ error: "auth_store_unavailable" });
        return;
      }
      if (signupResult.error === "invalid_license_key") {
        res.status(400).json({ error: "invalid_license_key" });
        return;
      }
      if (signupResult.error === "identity_exists") {
        res.status(409).json({ error: "identity_exists" });
        return;
      }
      res.status(500).json({ error: "signup_failed" });
      return;
    }

    const user = signupResult.user;
    const tokenPair = auth.issueTokenPair(user);
    const response = loginResponseSchema.parse(tokenPair);

    void authEmail
      .sendSignupAuthenticationEmail({
        email: user.email,
        username: user.username,
      })
      .catch((error) => {
        logger.error("auth_signup_email_send_failed", error);
      });

    // Ensure domain users row exists before auth session writes (FK safety).
    await syncDomainUser(user, req.tenantContext?.tenantId);

    if (authSessionStore) {
      const userAgent =
        typeof req.headers["user-agent"] === "string"
          ? req.headers["user-agent"]
          : null;
      try {
        await authSessionStore.createSession({
          id: tokenPair.sessionId,
          userId: user.id,
          expiresAtIso: new Date(
            Date.now() + env.AUTH_REFRESH_TOKEN_TTL_SECONDS * 1000,
          ).toISOString(),
          clientType: "desktop",
          userAgent,
          ...(req.ip ? { ipAddress: req.ip } : {}),
          status: env.AUTH_TOTP_REQUIRED ? "pending_2fa" : "active",
        });
        await authSessionStore.storeRefreshToken({
          jti: tokenPair.refreshJti,
          sessionId: tokenPair.sessionId,
          userId: user.id,
          token: tokenPair.refreshToken,
          expiresAtIso: new Date(
            Date.now() + env.AUTH_REFRESH_TOKEN_TTL_SECONDS * 1000,
          ).toISOString(),
        });
        void authSessionStore.writeAuditEvent({
          userId: user.id,
          sessionId: tokenPair.sessionId,
          eventType: "auth.signup",
          outcome: "ok",
          metadata: { sessionStoreEnabled: true },
          ...(req.ip ? { ipAddress: req.ip } : {}),
          ...(userAgent ? { userAgent } : {}),
        });
      } catch (error) {
        logger.error("auth_session_store_signup_write_failed", error);
      }
    }

    res.status(201).json(response);
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    const parsed = loginRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "invalid_request", details: parsed.error.flatten() });
      return;
    }

    const identifier = parsed.data.username ?? parsed.data.email ?? "";
    const loginIp = req.ip ?? "unknown";
    const userAgentHeader =
      typeof req.headers["user-agent"] === "string"
        ? req.headers["user-agent"]
        : undefined;

    const lockoutRetryAfter = await enforceLoginLockout(identifier, loginIp);
    if (lockoutRetryAfter) {
      res.set("Retry-After", String(lockoutRetryAfter));
      res.status(429).json({
        error: "account_temporarily_locked",
        retryAfterSeconds: lockoutRetryAfter,
      });
      return;
    }

    const user = await auth.validateUserCredentials(
      identifier,
      parsed.data.password,
      parsed.data.licenseKey,
    );
    if (!user) {
      const retryAfter = await registerLoginFailure(
        identifier,
        loginIp,
        userAgentHeader,
      );
      if (retryAfter) {
        res.set("Retry-After", String(retryAfter));
        res.status(429).json({
          error: "account_temporarily_locked",
          retryAfterSeconds: retryAfter,
        });
        return;
      }
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }

    await clearLoginFailureState(identifier, loginIp);

    const tokenPair = auth.issueTokenPair(user);
    const response = loginResponseSchema.parse(tokenPair);

    // Ensure domain users row exists before auth session writes (FK safety).
    await syncDomainUser(user, req.tenantContext?.tenantId);

    if (authSessionStore) {
      const userAgent =
        typeof req.headers["user-agent"] === "string"
          ? req.headers["user-agent"]
          : null;
      try {
        await authSessionStore.createSession({
          id: tokenPair.sessionId,
          userId: user.id,
          expiresAtIso: new Date(
            Date.now() + env.AUTH_REFRESH_TOKEN_TTL_SECONDS * 1000,
          ).toISOString(),
          clientType: "desktop",
          userAgent,
          ...(req.ip ? { ipAddress: req.ip } : {}),
          status: env.AUTH_TOTP_REQUIRED ? "pending_2fa" : "active",
        });
        await authSessionStore.storeRefreshToken({
          jti: tokenPair.refreshJti,
          sessionId: tokenPair.sessionId,
          userId: user.id,
          token: tokenPair.refreshToken,
          expiresAtIso: new Date(
            Date.now() + env.AUTH_REFRESH_TOKEN_TTL_SECONDS * 1000,
          ).toISOString(),
        });
        void authSessionStore.writeAuditEvent({
          userId: user.id,
          sessionId: tokenPair.sessionId,
          eventType: "auth.login",
          outcome: "ok",
          metadata: { sessionStoreEnabled: true },
          ...(req.ip ? { ipAddress: req.ip } : {}),
          ...(userAgent ? { userAgent } : {}),
        });
      } catch (error) {
        logger.error("auth_session_store_login_write_failed", error);
      }
    }

    res.status(200).json(response);
  });

  app.post("/api/auth/refresh", async (req: Request, res: Response) => {
    const parsed = refreshTokenRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "invalid_request", details: parsed.error.flatten() });
      return;
    }

    const verified = auth.verifyRefreshTokenDetailed(parsed.data.refreshToken);
    if (!verified) {
      res.status(401).json({ error: "invalid_refresh_token" });
      return;
    }

    const user = verified.user;
    const claims = verified.claims;

    if (authSessionStore) {
      if (!claims.sid || !claims.jti) {
        res.status(401).json({ error: "invalid_refresh_claims" });
        return;
      }

      const existingSession = await authSessionStore.getSession(claims.sid);
      if (!existingSession || existingSession.userId !== user.id) {
        res.status(401).json({ error: "session_not_found" });
        return;
      }
      if (existingSession.status !== "active") {
        res.status(401).json({ error: "session_inactive" });
        return;
      }

      const refreshRecord = await authSessionStore.getRefreshToken(claims.jti);
      if (
        !refreshRecord ||
        refreshRecord.userId !== user.id ||
        refreshRecord.sessionId !== claims.sid
      ) {
        res.status(401).json({ error: "refresh_not_found" });
        return;
      }
      if (
        refreshRecord.revokedAt ||
        new Date(refreshRecord.expiresAt).getTime() <= Date.now()
      ) {
        res.status(401).json({ error: "refresh_expired_or_revoked" });
        return;
      }
      if (
        !isRefreshTokenMatch(parsed.data.refreshToken, refreshRecord.tokenHash)
      ) {
        res.status(401).json({ error: "refresh_mismatch" });
        return;
      }
      if (env.AUTH_REFRESH_ROTATION_ENABLED && refreshRecord.consumedAt) {
        await authSessionStore.revokeAllUserSessions(
          user.id,
          "refresh_token_reuse_detected",
        );
        await authSessionStore.writeAuditEvent({
          userId: user.id,
          sessionId: claims.sid,
          eventType: "auth.refresh_reuse_detected",
          outcome: "revoked_all_sessions",
          ...(req.ip ? { ipAddress: req.ip } : {}),
          ...(typeof req.headers["user-agent"] === "string"
            ? { userAgent: req.headers["user-agent"] }
            : {}),
        });
        res.status(401).json({ error: "refresh_reuse_detected" });
        return;
      }

      await authSessionStore.touchSession(claims.sid);
      if (env.AUTH_REFRESH_ROTATION_ENABLED) {
        await authSessionStore.consumeRefreshToken(claims.jti);
      }
    }

    const tokenPair = auth.issueTokenPair(user, {
      ...(claims.sid ? { sessionId: claims.sid } : {}),
      ...(claims.amr ? { amr: claims.amr } : {}),
      ...(typeof claims.twoFactorVerified === "boolean"
        ? { twoFactorVerified: claims.twoFactorVerified }
        : {}),
    });

    if (authSessionStore && claims.sid) {
      await authSessionStore.storeRefreshToken({
        jti: tokenPair.refreshJti,
        sessionId: claims.sid,
        userId: user.id,
        token: tokenPair.refreshToken,
        expiresAtIso: new Date(
          Date.now() + env.AUTH_REFRESH_TOKEN_TTL_SECONDS * 1000,
        ).toISOString(),
        ...(claims.jti ? { rotatedFromJti: claims.jti } : {}),
      });
      await authSessionStore.writeAuditEvent({
        userId: user.id,
        sessionId: claims.sid,
        eventType: "auth.refresh",
        outcome: "ok",
        metadata: {
          refreshRotationEnabled: env.AUTH_REFRESH_ROTATION_ENABLED,
        },
        ...(req.ip ? { ipAddress: req.ip } : {}),
        ...(typeof req.headers["user-agent"] === "string"
          ? { userAgent: req.headers["user-agent"] }
          : {}),
      });
    }

    const response = loginResponseSchema.parse(tokenPair);
    res.status(200).json(response);
  });

  app.get("/api/auth/me", authGuard, (req: Request, res: Response) => {
    if (!req.user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const response = meResponseSchema.parse({ user: req.user });
    res.status(200).json(response);
  });

  app.post(
    "/api/auth/logout",
    authGuard,
    async (req: Request, res: Response) => {
      const parsed = logoutRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "invalid_request", details: parsed.error.flatten() });
        return;
      }

      if (authSessionStore && req.user) {
        const accessToken = extractBearerToken(req.headers.authorization);
        const accessClaims = accessToken
          ? auth.verifyAccessTokenDetailed(accessToken)?.claims
          : null;
        const userAgent =
          typeof req.headers["user-agent"] === "string"
            ? req.headers["user-agent"]
            : undefined;

        if (parsed.data.allSessions) {
          await authSessionStore.revokeAllUserSessions(
            req.user.id,
            "user_logout_all_sessions",
          );
        } else if (accessClaims?.sid) {
          await authSessionStore.revokeSession(accessClaims.sid, "user_logout");
        }

        if (parsed.data.refreshToken) {
          const refreshClaims = auth.verifyRefreshTokenDetailed(
            parsed.data.refreshToken,
          )?.claims;
          if (refreshClaims?.jti) {
            await authSessionStore.revokeRefreshToken(
              refreshClaims.jti,
              "user_logout",
            );
          }
        }

        await authSessionStore.writeAuditEvent({
          userId: req.user.id,
          ...(accessClaims?.sid ? { sessionId: accessClaims.sid } : {}),
          eventType: "auth.logout",
          outcome: "ok",
          metadata: {
            allSessions: Boolean(parsed.data.allSessions),
            hasRefreshToken: Boolean(parsed.data.refreshToken),
          },
          ...(req.ip ? { ipAddress: req.ip } : {}),
          ...(userAgent ? { userAgent } : {}),
        });
      }

      res.status(200).json({ ok: true });
    },
  );

  app.post(
    "/api/auth/2fa/setup",
    authGuard,
    async (req: Request, res: Response) => {
      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      if (!infra.pool || !authSessionStore) {
        res.status(503).json({ error: "totp_unavailable_no_database" });
        return;
      }

      const issuer = "Trading Cockpit";
      const accountName = req.user.email;
      const secret = generateTotpSecret();
      const encrypted = encryptTotpSecret(
        secret,
        process.env.AUTH_TOTP_ENCRYPTION_KEY ?? env.JWT_SECRET,
      );
      const factorId = randomUUID();
      const recoveryCodes = generateRecoveryCodes();

      await infra.pool.query(
        `UPDATE auth_totp_factors
       SET disabled_at = NOW(),
           updated_at = NOW()
       WHERE user_id = $1
         AND disabled_at IS NULL`,
        [req.user.id],
      );

      await infra.pool.query(
        `INSERT INTO auth_totp_factors (
         id, user_id, encrypted_secret, secret_iv, algorithm, digits, period_seconds
       ) VALUES ($1, $2, $3, $4, 'SHA1', 6, 30)`,
        [factorId, req.user.id, encrypted.encryptedSecret, encrypted.iv],
      );

      await infra.pool.query(
        "DELETE FROM auth_recovery_codes WHERE user_id = $1",
        [req.user.id],
      );
      for (const code of recoveryCodes) {
        await infra.pool.query(
          `INSERT INTO auth_recovery_codes (id, user_id, code_hash)
         VALUES ($1, $2, $3)`,
          [randomUUID(), req.user.id, hashRecoveryCode(code)],
        );
      }

      await authSessionStore.writeAuditEvent({
        userId: req.user.id,
        eventType: "auth.2fa_setup",
        outcome: "ok",
        ...(req.ip ? { ipAddress: req.ip } : {}),
        ...(typeof req.headers["user-agent"] === "string"
          ? { userAgent: req.headers["user-agent"] }
          : {}),
      });

      res.status(200).json({
        ok: true,
        otpauthUrl: buildOtpAuthUrl({ issuer, accountName, secret }),
        recoveryCodes,
      });
    },
  );

  app.post(
    "/api/auth/2fa/verify",
    authGuard,
    async (req: Request, res: Response) => {
      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      if (!infra.pool || !authSessionStore) {
        res.status(503).json({ error: "totp_unavailable_no_database" });
        return;
      }

      const parsed = totpVerifyRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "invalid_request", details: parsed.error.flatten() });
        return;
      }

      const factorResult = await infra.pool.query<{
        id: string;
        encrypted_secret: string;
        secret_iv: string;
        digits: number;
        period_seconds: number;
      }>(
        `SELECT id, encrypted_secret, secret_iv, digits, period_seconds
       FROM auth_totp_factors
       WHERE user_id = $1
         AND disabled_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
        [req.user.id],
      );

      const factor = factorResult.rows[0];
      if (!factor) {
        res.status(404).json({ error: "totp_factor_not_found" });
        return;
      }

      const secret = decryptTotpSecret(
        factor.encrypted_secret,
        factor.secret_iv,
        process.env.AUTH_TOTP_ENCRYPTION_KEY ?? env.JWT_SECRET,
      );
      const valid = verifyTotpCode(secret, parsed.data.code, {
        digits: factor.digits,
        periodSeconds: factor.period_seconds,
        window: 1,
      });

      if (!valid) {
        res.status(401).json({ error: "invalid_totp_code" });
        return;
      }

      await infra.pool.query(
        `UPDATE auth_totp_factors
       SET confirmed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
        [factor.id],
      );

      const accessToken = extractBearerToken(req.headers.authorization);
      const sid = accessToken
        ? auth.verifyAccessTokenDetailed(accessToken)?.claims.sid
        : undefined;
      if (sid) {
        await authSessionStore.setSessionStatus(sid, "active");
      }

      await authSessionStore.writeAuditEvent({
        userId: req.user.id,
        ...(sid ? { sessionId: sid } : {}),
        eventType: "auth.2fa_verify",
        outcome: "ok",
        ...(req.ip ? { ipAddress: req.ip } : {}),
        ...(typeof req.headers["user-agent"] === "string"
          ? { userAgent: req.headers["user-agent"] }
          : {}),
      });

      res.status(200).json({ ok: true });
    },
  );

  app.post(
    "/api/auth/2fa/disable",
    authGuard,
    async (req: Request, res: Response) => {
      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      if (!infra.pool || !authSessionStore) {
        res.status(503).json({ error: "totp_unavailable_no_database" });
        return;
      }

      const parsed = totpDisableRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "invalid_request", details: parsed.error.flatten() });
        return;
      }

      const factorResult = await infra.pool.query<{
        id: string;
        encrypted_secret: string;
        secret_iv: string;
        digits: number;
        period_seconds: number;
      }>(
        `SELECT id, encrypted_secret, secret_iv, digits, period_seconds
       FROM auth_totp_factors
       WHERE user_id = $1
         AND disabled_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
        [req.user.id],
      );

      const factor = factorResult.rows[0];
      if (!factor) {
        res.status(404).json({ error: "totp_factor_not_found" });
        return;
      }

      let valid = false;
      if (parsed.data.code) {
        const secret = decryptTotpSecret(
          factor.encrypted_secret,
          factor.secret_iv,
          process.env.AUTH_TOTP_ENCRYPTION_KEY ?? env.JWT_SECRET,
        );
        valid = verifyTotpCode(secret, parsed.data.code, {
          digits: factor.digits,
          periodSeconds: factor.period_seconds,
          window: 1,
        });
      } else if (parsed.data.recoveryCode) {
        const codeHash = hashRecoveryCode(parsed.data.recoveryCode);
        const row = await infra.pool.query<{ id: string }>(
          `SELECT id
         FROM auth_recovery_codes
         WHERE user_id = $1
           AND code_hash = $2
           AND consumed_at IS NULL
         LIMIT 1`,
          [req.user.id, codeHash],
        );
        const match = row.rows[0];
        if (match) {
          await infra.pool.query(
            `UPDATE auth_recovery_codes
           SET consumed_at = NOW()
           WHERE id = $1`,
            [match.id],
          );
          valid = true;
        }
      }

      if (!valid) {
        res.status(401).json({ error: "invalid_2fa_proof" });
        return;
      }

      await infra.pool.query(
        `UPDATE auth_totp_factors
       SET disabled_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
        [factor.id],
      );

      await authSessionStore.writeAuditEvent({
        userId: req.user.id,
        eventType: "auth.2fa_disable",
        outcome: "ok",
        ...(req.ip ? { ipAddress: req.ip } : {}),
        ...(typeof req.headers["user-agent"] === "string"
          ? { userAgent: req.headers["user-agent"] }
          : {}),
      });

      res.status(200).json({ ok: true });
    },
  );

  app.get(
    "/api/congress/trades",
    authGuard,
    async (req: Request, res: Response) => {
      const symbol =
        typeof req.query.symbol === "string" ? req.query.symbol : undefined;
      const limit =
        typeof req.query.limit === "string"
          ? Number(req.query.limit)
          : undefined;
      const normalizedLimit = Number.isFinite(limit) ? Number(limit) : 100;
      const cacheKey = `congress:trades:${symbol ?? "all"}:${normalizedLimit}`;
      const cached =
        await infra.cache.getJson<
          ReturnType<typeof congressTradesResponseSchema.parse>
        >(cacheKey);
      if (cached) {
        res.status(200).json(cached);
        return;
      }
      const items = listCongressTrades(
        symbol,
        Number.isFinite(limit) ? limit : undefined,
      );
      const response = congressTradesResponseSchema.parse({
        items,
        total: items.length,
      });
      await infra.cache.setJson(
        cacheKey,
        response,
        env.CACHE_CONGRESS_TRADES_TTL_SECONDS,
      );
      res.status(200).json(response);
    },
  );

  app.get(
    "/api/publicflow/events",
    authGuard,
    (req: Request, res: Response) => {
      const ticker =
        typeof req.query.ticker === "string" ? req.query.ticker : undefined;
      const limit =
        typeof req.query.limit === "string"
          ? Number(req.query.limit)
          : undefined;
      const items = listPublicFlowEvents(
        ticker,
        Number.isFinite(limit) ? limit : undefined,
      );
      const response = publicFlowEventsResponseSchema.parse({
        items,
        total: items.length,
      });
      res.status(200).json(response);
    },
  );

  app.get(
    "/api/user/settings",
    authGuard,
    async (req: Request, res: Response) => {
      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const userId = req.user.id;
      const settings = await infra.storage.getSettings(req.user.id, tenantId);
      res.status(200).json({ settings });
    },
  );

  app.put(
    "/api/user/settings",
    authGuard,
    async (req: Request, res: Response) => {
      const next =
        typeof req.body === "object" && req.body !== null ? req.body : {};
      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const settings = await infra.storage.updateSettings(
        req.user.id,
        next as Record<string, unknown>,
        tenantId,
      );
      res.status(200).json({ settings });
    },
  );

  app.get(
    "/api/user/watchlists",
    authGuard,
    async (req: Request, res: Response) => {
      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const items = await infra.storage.listWatchlists(req.user.id, tenantId);
      res.status(200).json({ items });
    },
  );

  app.post(
    "/api/user/watchlists",
    authGuard,
    async (req: Request, res: Response) => {
      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      const symbol =
        typeof req.body?.symbol === "string" ? req.body.symbol : "";
      const note = typeof req.body?.note === "string" ? req.body.note : "";
      if (!symbol.trim()) {
        res.status(400).json({ error: "invalid_symbol" });
        return;
      }
      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const item = await infra.storage.addWatchlist(
        req.user.id,
        symbol,
        note,
        tenantId,
      );
      res.status(200).json(item);
    },
  );

  app.put(
    "/api/user/watchlists/:id",
    authGuard,
    async (req: Request, res: Response) => {
      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: "invalid_id" });
        return;
      }
      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const next = await infra.storage.updateWatchlist(
        req.user.id,
        id,
        {
          ...(typeof req.body?.symbol === "string"
            ? { symbol: req.body.symbol }
            : {}),
          ...(typeof req.body?.note === "string"
            ? { note: req.body.note }
            : {}),
        },
        tenantId,
      );
      if (!next) {
        res.status(404).json({ error: "watchlist_not_found" });
        return;
      }
      res.status(200).json(next);
    },
  );

  app.delete(
    "/api/user/watchlists/:id",
    authGuard,
    async (req: Request, res: Response) => {
      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: "invalid_id" });
        return;
      }
      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const ok = await infra.storage.removeWatchlist(req.user.id, id, tenantId);
      res.status(200).json({ ok });
    },
  );

  app.get(
    "/api/order/orders",
    authGuard,
    async (req: Request, res: Response) => {
      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const items = await infra.storage.getOrders(req.user.id, tenantId);
      res.status(200).json({ items });
    },
  );

  app.get(
    "/api/order/positions",
    authGuard,
    async (req: Request, res: Response) => {
      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const items = await infra.storage.getPositions(req.user.id, tenantId);
      res.status(200).json({ items });
    },
  );

  app.get(
    "/api/order/account",
    authGuard,
    async (req: Request, res: Response) => {
      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const account = await infra.storage.getAccount(req.user.id, tenantId);
      res.status(200).json({ account });
    },
  );

  app.post(
    "/api/order/place",
    authGuard,
    async (req: Request, res: Response) => {
      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      const symbol =
        typeof req.body?.symbol === "string" ? req.body.symbol : "";
      const side = req.body?.side === "SELL" ? "SELL" : "BUY";
      const qty = Number(req.body?.qty);
      const type =
        typeof req.body?.type === "string" ? req.body.type : "MARKET";
      const limitPrice = Number.isFinite(Number(req.body?.limitPrice))
        ? Number(req.body.limitPrice)
        : undefined;
      const stopPrice = Number.isFinite(Number(req.body?.stopPrice))
        ? Number(req.body.stopPrice)
        : undefined;

      if (!symbol || !Number.isFinite(qty) || qty <= 0) {
        res.status(400).json({ error: "invalid_order_request" });
        return;
      }

      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const userId = req.user.id;
      const order = await infra.storage.placeOrder(
        req.user.id,
        {
          symbol,
          side,
          qty,
          type,
          ...(limitPrice !== undefined ? { limitPrice } : {}),
          ...(stopPrice !== undefined ? { stopPrice } : {}),
        },
        tenantId,
      );
      res.status(200).json({ accepted: true, orderId: order.orderId, order });
    },
  );

  app.post(
    "/api/order/cancel",
    authGuard,
    async (req: Request, res: Response) => {
      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      const orderId =
        typeof req.body?.orderId === "string" ? req.body.orderId : "";
      if (!orderId) {
        res.status(400).json({ error: "invalid_order_id" });
        return;
      }
      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const ok = await infra.storage.cancelOrder(
        req.user.id,
        orderId,
        tenantId,
      );
      res.status(200).json({ ok });
    },
  );

  app.get(
    "/api/congress/query-trades",
    authGuard,
    (req: Request, res: Response) => {
      const limit =
        typeof req.query.limit === "string"
          ? Number(req.query.limit)
          : undefined;
      const filters: {
        person_name?: string;
        chamber?: string;
        ticker?: string;
        transaction_date_start?: string;
        transaction_date_end?: string;
        limit?: number;
      } = {};
      if (typeof req.query.person_name === "string")
        filters.person_name = req.query.person_name;
      if (typeof req.query.chamber === "string")
        filters.chamber = req.query.chamber;
      if (typeof req.query.ticker === "string")
        filters.ticker = req.query.ticker;
      if (typeof req.query.transaction_date_start === "string")
        filters.transaction_date_start = req.query.transaction_date_start;
      if (typeof req.query.transaction_date_end === "string")
        filters.transaction_date_end = req.query.transaction_date_end;
      if (Number.isFinite(limit)) {
        const parsedLimit = Number(limit);
        filters.limit = parsedLimit;
      }
      const items = queryCongressionalTrades(filters);
      res.status(200).json({ items });
    },
  );

  app.get("/api/congress/members", authGuard, (req: Request, res: Response) => {
    const limit =
      typeof req.query.limit === "string" ? Number(req.query.limit) : 100;
    res.status(200).json({
      items: queryCongressionalMembers(Number.isFinite(limit) ? limit : 100),
    });
  });

  app.get(
    "/api/congress/lobbying",
    authGuard,
    (req: Request, res: Response) => {
      const limit =
        typeof req.query.limit === "string" ? Number(req.query.limit) : 100;
      res.status(200).json({
        items: queryLobbyingActivities(Number.isFinite(limit) ? limit : 100),
      });
    },
  );

  app.get(
    "/api/congress/contracts",
    authGuard,
    (req: Request, res: Response) => {
      const limit =
        typeof req.query.limit === "string" ? Number(req.query.limit) : 100;
      res.status(200).json({
        items: queryFederalContracts(Number.isFinite(limit) ? limit : 100),
      });
    },
  );

  app.get(
    "/api/congress/most-traded",
    authGuard,
    (req: Request, res: Response) => {
      const limit =
        typeof req.query.limit === "string" ? Number(req.query.limit) : 10;
      res.status(200).json({
        items: getMostTradedTickers(Number.isFinite(limit) ? limit : 10),
      });
    },
  );

  app.get(
    "/api/congress/disclosure-lag",
    authGuard,
    (_req: Request, res: Response) => {
      res.status(200).json({ stats: getDisclosureLagStats() });
    },
  );

  app.post("/api/congress/fetch", authGuard, (req: Request, res: Response) => {
    const source =
      typeof req.body?.source === "string" ? req.body.source : "all";
    res.status(200).json({
      source,
      house: {
        inserted: 4,
        skipped: 0,
        errors: [],
        cached: false,
        cacheAge: 0,
      },
      senate: {
        inserted: 2,
        skipped: 0,
        errors: [],
        cached: false,
        cacheAge: 0,
      },
      lobbying: {
        inserted: 1,
        skipped: 0,
        errors: [],
        cached: false,
        cacheAge: 0,
      },
      contracts: {
        inserted: 1,
        skipped: 0,
        errors: [],
        cached: false,
        cacheAge: 0,
      },
      total: { inserted: 8, skipped: 0 },
    });
  });

  app.get(
    "/api/publicflow/recent",
    authGuard,
    async (req: Request, res: Response) => {
      const limit =
        typeof req.query.limit === "string" ? Number(req.query.limit) : 50;
      const cappedLimit = Number.isFinite(limit) ? limit : 50;
      const cacheKey = `publicflow:recent:${cappedLimit}`;
      const cached = await infra.cache.getJson<unknown[]>(cacheKey);
      if (cached) {
        res.status(200).json({ items: cached, cached: true });
        return;
      }
      const items = getDisclosureEvents(cappedLimit);
      await infra.cache.setJson(
        cacheKey,
        items,
        env.CACHE_PUBLICFLOW_TTL_SECONDS,
      );
      res.status(200).json({ items, cached: false });
    },
  );

  app.get(
    "/api/publicflow/themes",
    authGuard,
    async (req: Request, res: Response) => {
      const windowDays = req.query.windowDays === "30" ? 30 : 7;
      const limit =
        typeof req.query.limit === "string" ? Number(req.query.limit) : 10;
      const cappedLimit = Number.isFinite(limit) ? limit : 10;
      const cacheKey = `publicflow:themes:${windowDays}:${cappedLimit}`;
      const cached = await infra.cache.getJson<unknown[]>(cacheKey);
      if (cached) {
        res.status(200).json({ items: cached, cached: true });
        return;
      }
      const items = getSectorThemes(windowDays, cappedLimit);
      await infra.cache.setJson(
        cacheKey,
        items,
        env.CACHE_PUBLICFLOW_TTL_SECONDS,
      );
      res.status(200).json({ items, cached: false });
    },
  );

  app.get(
    "/api/publicflow/candidates",
    authGuard,
    (req: Request, res: Response) => {
      const themeId = Number(req.query.themeId);
      const minPriorityRaw =
        typeof req.query.minPriority === "string"
          ? req.query.minPriority.toLowerCase()
          : undefined;
      const minPriority: "critical" | "high" | "medium" | "low" | undefined =
        minPriorityRaw === "critical" ||
        minPriorityRaw === "high" ||
        minPriorityRaw === "medium" ||
        minPriorityRaw === "low"
          ? minPriorityRaw
          : undefined;
      const minConfidenceRaw =
        typeof req.query.minConfidence === "string"
          ? Number(req.query.minConfidence)
          : undefined;
      const minConfidence =
        Number.isFinite(minConfidenceRaw) && minConfidenceRaw !== undefined
          ? Math.max(0, Math.min(1, minConfidenceRaw))
          : undefined;

      if (!Number.isFinite(themeId) || themeId <= 0) {
        res.status(400).json({ error: "invalid_theme_id" });
        return;
      }
      const candidateFilters = {
        ...(minPriority ? { minPriority } : {}),
        ...(typeof minConfidence === "number" ? { minConfidence } : {}),
      };

      res.status(200).json({
        items: getWatchlistCandidates(themeId, candidateFilters),
      });
    },
  );

  app.post(
    "/api/publicflow/valuations",
    authGuard,
    (req: Request, res: Response) => {
      const tickers = Array.isArray(req.body?.tickers)
        ? req.body.tickers.filter(
            (ticker: unknown): ticker is string => typeof ticker === "string",
          )
        : [];
      res.status(200).json({ items: getValuationTags(tickers) });
    },
  );

  app.post(
    "/api/publicflow/refresh",
    authGuard,
    (_req: Request, res: Response) => {
      res.status(200).json({ ok: true, ts: Date.now() });
    },
  );

  app.get(
    "/api/tedintel/snapshot",
    authGuard,
    async (req: Request, res: Response) => {
      const rawWindow =
        typeof req.query.window === "string" ? req.query.window : "90d";
      const window =
        rawWindow === "7d" ||
        rawWindow === "30d" ||
        rawWindow === "90d" ||
        rawWindow === "1y"
          ? rawWindow
          : "90d";

      try {
        const liveSnapshot = await fetchLiveTedSnapshotStrict(
          tedLiveConfig,
          window,
        );
        res.status(200).json(liveSnapshot);
      } catch (error) {
        if (error instanceof TedLiveError) {
          const configMissing =
            error.code === "ted_live_disabled" ||
            error.code === "ted_base_url_missing" ||
            error.code === "ted_api_key_missing";

          if (configMissing) {
            logger.info("ted_live_snapshot_fallback_mock", {
              code: error.code,
              window,
            });
            res.status(200).json(buildTedIntelSnapshot(window));
            return;
          }

          logger.warn("ted_live_snapshot_unavailable", {
            code: error.code,
            status: error.status,
            upstreamStatus: error.upstreamStatus,
            message: error.message,
            baseUrl: tedLiveConfig.baseUrl,
            authHeader: tedLiveConfig.authHeader,
            timeoutMs: tedLiveConfig.timeoutMs,
            window,
          });
          res.status(error.status).json({
            error: error.code,
            message: error.message,
            ...(typeof error.upstreamStatus === "number"
              ? { upstreamStatus: error.upstreamStatus }
              : {}),
          });
          return;
        }

        logger.error("ted_live_snapshot_unexpected_error", {
          window,
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res.status(500).json({ error: "ted_snapshot_unexpected_error" });
      }
    },
  );

  app.get("/api/tedintel/config", authGuard, (_req: Request, res: Response) => {
    res.status(200).json(getTedLiveConfigStatus(tedLiveConfig));
  });

  app.put("/api/tedintel/config", authGuard, (req: Request, res: Response) => {
    const payload = req.body;
    if (!payload || typeof payload !== "object") {
      res.status(400).json({ error: "invalid_payload" });
      return;
    }

    tedLiveConfig = applyTedLiveConfigPatch(
      tedLiveConfig,
      payload as {
        enabled?: boolean;
        baseUrl?: string;
        apiKey?: string;
        authHeader?: string;
        timeoutMs?: number;
        windowQueryParam?: string;
      },
    );

    res.status(200).json(getTedLiveConfigStatus(tedLiveConfig));
  });

  app.post(
    "/api/procurement/intel/ingest",
    authGuard,
    operatorOrAdminGuard,
    async (req: Request, res: Response) => {
      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const window =
        req.body?.window === "7d" ||
        req.body?.window === "30d" ||
        req.body?.window === "90d" ||
        req.body?.window === "1y"
          ? req.body.window
          : "90d";

      try {
        const result = await procurementIntel.ingest(tenantId, window);
        res.status(200).json({ ok: true, result });
      } catch (error) {
        if (error instanceof TedLiveError) {
          logger.warn("procurement_intel_ingest_blocked_ted_error", {
            tenantId,
            code: error.code,
            status: error.status,
            upstreamStatus: error.upstreamStatus,
            message: error.message,
          });
          res.status(error.status).json({
            error: error.code,
            message: error.message,
            ...(typeof error.upstreamStatus === "number"
              ? { upstreamStatus: error.upstreamStatus }
              : {}),
          });
          return;
        }

        logger.error("procurement_intel_ingest_failed", {
          tenantId,
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res.status(500).json({ error: "procurement_intel_ingest_failed" });
      }
    },
  );

  app.post(
    "/api/procurement/intel/reprocess",
    authGuard,
    operatorOrAdminGuard,
    async (req: Request, res: Response) => {
      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const noticeIds = Array.isArray(req.body?.noticeIds)
        ? req.body.noticeIds.filter(
            (value: unknown): value is string => typeof value === "string",
          )
        : undefined;

      try {
        const result = await procurementIntel.reprocess(tenantId, noticeIds);
        res.status(200).json({ ok: true, result });
      } catch (error) {
        logger.error("procurement_intel_reprocess_failed", {
          tenantId,
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res.status(500).json({ error: "procurement_intel_reprocess_failed" });
      }
    },
  );

  app.get(
    "/api/procurement/intel/notices",
    authGuard,
    async (req: Request, res: Response) => {
      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      try {
        const filters = parseProcurementFilters(req);
        const items = await procurementIntel.listNotices(tenantId, filters);
        res.status(200).json({ items, total: items.length, filters });
      } catch (error) {
        logger.error("procurement_intel_list_failed", {
          tenantId,
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res.status(500).json({ error: "procurement_intel_list_failed" });
      }
    },
  );

  app.get(
    "/api/procurement/intel/summary",
    authGuard,
    async (req: Request, res: Response) => {
      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      try {
        const filters = parseProcurementFilters(req);
        const summary = await procurementIntel.getAggregations(
          tenantId,
          filters,
        );
        res.status(200).json({ summary, filters });
      } catch (error) {
        logger.error("procurement_intel_summary_failed", {
          tenantId,
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res.status(500).json({ error: "procurement_intel_summary_failed" });
      }
    },
  );

  app.get(
    "/api/procurement/intel/graph",
    authGuard,
    async (req: Request, res: Response) => {
      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      try {
        const filters = parseProcurementFilters(req);
        const relations = await procurementIntel.getGraphRelations(
          tenantId,
          filters,
        );
        res.status(200).json({ relations, total: relations.length, filters });
      } catch (error) {
        logger.error("procurement_intel_graph_failed", {
          tenantId,
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res.status(500).json({ error: "procurement_intel_graph_failed" });
      }
    },
  );

  app.get(
    "/api/procurement/intel/integrations",
    authGuard,
    async (req: Request, res: Response) => {
      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      try {
        const filters = parseProcurementFilters(req);
        const feeds = await procurementIntel.getIntegrationFeeds(
          tenantId,
          filters,
        );
        res.status(200).json({ feeds, filters });
      } catch (error) {
        logger.error("procurement_intel_integrations_failed", {
          tenantId,
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res
          .status(500)
          .json({ error: "procurement_intel_integrations_failed" });
      }
    },
  );

  app.get(
    "/api/procurement/intel/raw/:rawId",
    authGuard,
    operatorOrAdminGuard,
    async (req: Request, res: Response) => {
      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const rawId = req.params.rawId;
      if (!rawId) {
        res.status(400).json({ error: "missing_raw_id" });
        return;
      }
      try {
        const raw = await procurementIntel.getRawNotice(tenantId, rawId);
        if (!raw) {
          res.status(404).json({ error: "raw_notice_not_found" });
          return;
        }
        res.status(200).json({ raw });
      } catch (error) {
        logger.error("procurement_intel_raw_notice_failed", {
          tenantId,
          rawId,
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res.status(500).json({ error: "procurement_intel_raw_notice_failed" });
      }
    },
  );

  app.get(
    "/api/procurement/intel/diagnostics",
    authGuard,
    operatorOrAdminGuard,
    async (req: Request, res: Response) => {
      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      try {
        const diagnostics = await procurementIntel.getDiagnostics(tenantId);
        res.status(200).json({ diagnostics });
      } catch (error) {
        logger.error("procurement_intel_diagnostics_failed", {
          tenantId,
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res.status(500).json({ error: "procurement_intel_diagnostics_failed" });
      }
    },
  );

  app.post(
    "/api/sec/edgar/ingest",
    authGuard,
    operatorOrAdminGuard,
    async (req: Request, res: Response) => {
      const scopeId = "global";
      const filings = Array.isArray(req.body?.filings)
        ? req.body.filings.filter(
            (
              value: unknown,
            ): value is {
              company_name: string;
              cik: string;
              accession_number: string;
              filing_date: string;
              form_type: "8-K" | "10-K" | "10-Q" | "4";
              raw_content: string;
              accepted_at?: string;
              period_of_report?: string;
              ticker?: string;
              primary_document_url?: string;
              filing_detail_url?: string;
              source_links?: string[];
              metadata?: Record<string, unknown>;
            } =>
              Boolean(
                value &&
                typeof value === "object" &&
                typeof (value as { company_name?: unknown }).company_name ===
                  "string" &&
                typeof (value as { cik?: unknown }).cik === "string" &&
                typeof (value as { accession_number?: unknown })
                  .accession_number === "string" &&
                typeof (value as { filing_date?: unknown }).filing_date ===
                  "string" &&
                typeof (value as { form_type?: unknown }).form_type ===
                  "string" &&
                typeof (value as { raw_content?: unknown }).raw_content ===
                  "string",
              ),
          )
        : [];

      if (!filings.length) {
        res.status(400).json({ error: "missing_filings" });
        return;
      }

      try {
        const result = await edgarIntel.ingest(scopeId, filings);
        res.status(200).json({ ok: true, result });
      } catch (error) {
        logger.error("edgar_ingest_failed", {
          scopeId,
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res.status(500).json({ error: "edgar_ingest_failed" });
      }
    },
  );

  app.post(
    "/api/sec/edgar/watcher/run",
    authGuard,
    operatorOrAdminGuard,
    async (req: Request, res: Response) => {
      const ciks = Array.isArray(req.body?.ciks)
        ? req.body.ciks.filter(
            (value: unknown): value is string => typeof value === "string",
          )
        : [];
      const forms = Array.isArray(req.body?.forms)
        ? req.body.forms.filter(
            (value: unknown): value is "8-K" | "10-K" | "10-Q" | "4" =>
              value === "8-K" ||
              value === "10-K" ||
              value === "10-Q" ||
              value === "4",
          )
        : undefined;
      const perCikLimit = Number(req.body?.perCikLimit);

      if (!ciks.length) {
        res.status(400).json({ error: "missing_ciks" });
        return;
      }

      try {
        const result = await edgarIntel.runWatcherOnce("global", {
          ciks,
          ...(forms?.length ? { forms } : {}),
          ...(Number.isFinite(perCikLimit) ? { perCikLimit } : {}),
        });
        res.status(200).json({ ok: true, result });
      } catch (error) {
        logger.error("edgar_watcher_run_failed", {
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res.status(500).json({ error: "edgar_watcher_run_failed" });
      }
    },
  );

  app.post(
    "/api/sec/edgar/watcher/start",
    authGuard,
    operatorOrAdminGuard,
    async (req: Request, res: Response) => {
      const ciks = Array.isArray(req.body?.ciks)
        ? req.body.ciks.filter(
            (value: unknown): value is string => typeof value === "string",
          )
        : [];
      if (!ciks.length) {
        res.status(400).json({ error: "missing_ciks" });
        return;
      }
      const forms = Array.isArray(req.body?.forms)
        ? req.body.forms.filter(
            (value: unknown): value is "8-K" | "10-K" | "10-Q" | "4" =>
              value === "8-K" ||
              value === "10-K" ||
              value === "10-Q" ||
              value === "4",
          )
        : ["8-K", "10-K", "10-Q", "4"];
      const intervalSecRaw = Number(req.body?.intervalSec);
      const perCikLimitRaw = Number(req.body?.perCikLimit);

      try {
        const status = await edgarIntel.startWatcher("global", {
          ciks,
          forms,
          intervalSec: Number.isFinite(intervalSecRaw)
            ? Math.max(60, Math.min(3600, intervalSecRaw))
            : env.EDGAR_WATCHER_INTERVAL_SECONDS,
          perCikLimit: Number.isFinite(perCikLimitRaw)
            ? Math.max(1, Math.min(50, perCikLimitRaw))
            : 20,
        });
        res.status(200).json({ ok: true, status });
      } catch (error) {
        logger.error("edgar_watcher_start_failed", {
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res.status(500).json({ error: "edgar_watcher_start_failed" });
      }
    },
  );

  app.post(
    "/api/sec/edgar/watcher/stop",
    authGuard,
    operatorOrAdminGuard,
    (_req: Request, res: Response) => {
      const status = edgarIntel.stopWatcher();
      res.status(200).json({ ok: true, status });
    },
  );

  app.get(
    "/api/sec/edgar/watcher/status",
    authGuard,
    (_req: Request, res: Response) => {
      const status = edgarIntel.getWatcherStatus();
      res.status(200).json({ status });
    },
  );

  app.get(
    "/api/sec/edgar/filings",
    authGuard,
    async (req: Request, res: Response) => {
      try {
        const filters = parseEdgarFilters(req);
        const items = await edgarIntel.listFilings("global", filters);
        res.status(200).json({ items, total: items.length, filters });
      } catch (error) {
        logger.error("edgar_filing_list_failed", {
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res.status(500).json({ error: "edgar_filing_list_failed" });
      }
    },
  );

  app.get(
    "/api/sec/edgar/filings/:filingId/intelligence",
    authGuard,
    async (req: Request, res: Response) => {
      const filingId =
        typeof req.params.filingId === "string" ? req.params.filingId : "";
      if (!filingId) {
        res.status(400).json({ error: "missing_filing_id" });
        return;
      }

      try {
        const view = await edgarIntel.getFilingIntelligenceView(
          "global",
          filingId,
        );
        if (!view) {
          res.status(404).json({ error: "filing_not_found" });
          return;
        }
        res.status(200).json({ view });
      } catch (error) {
        logger.error("edgar_filing_intelligence_view_failed", {
          filingId,
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res
          .status(500)
          .json({ error: "edgar_filing_intelligence_view_failed" });
      }
    },
  );

  app.post(
    "/api/sec/edgar/reprocess",
    authGuard,
    operatorOrAdminGuard,
    async (req: Request, res: Response) => {
      const filingIds = Array.isArray(req.body?.filingIds)
        ? req.body.filingIds.filter(
            (value: unknown): value is string =>
              typeof value === "string" && Boolean(value),
          )
        : undefined;
      const cik = typeof req.body?.cik === "string" ? req.body.cik : undefined;
      const formTypeRaw =
        typeof req.body?.formType === "string"
          ? req.body.formType.trim().toUpperCase()
          : "";
      const formType =
        formTypeRaw === "8-K" ||
        formTypeRaw === "10-K" ||
        formTypeRaw === "10-Q" ||
        formTypeRaw === "4"
          ? formTypeRaw
          : undefined;
      const limit = Number(req.body?.limit);

      try {
        const result = await edgarIntel.reprocess("global", {
          ...(filingIds?.length ? { filingIds } : {}),
          ...(cik ? { cik } : {}),
          ...(formType ? { formType } : {}),
          ...(Number.isFinite(limit) ? { limit } : {}),
        });
        res.status(200).json({ ok: true, result });
      } catch (error) {
        logger.error("edgar_reprocess_failed", {
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res.status(500).json({ error: "edgar_reprocess_failed" });
      }
    },
  );

  app.get(
    "/api/sec/edgar/routes",
    authGuard,
    async (req: Request, res: Response) => {
      const surfaceRaw =
        typeof req.query.surface === "string"
          ? req.query.surface.trim().toLowerCase()
          : "all";
      const surface =
        surfaceRaw === "flow" ||
        surfaceRaw === "intelligence" ||
        surfaceRaw === "gwmd" ||
        surfaceRaw === "all"
          ? surfaceRaw
          : "all";
      const limitRaw = Number(req.query.limit);
      const limit = Number.isFinite(limitRaw)
        ? Math.max(1, Math.min(500, limitRaw))
        : 100;

      try {
        const items = await edgarIntel.listRouting(
          "global",
          surface as "flow" | "intelligence" | "gwmd" | "all",
          limit,
        );
        res.status(200).json({ surface, items, total: items.length });
      } catch (error) {
        logger.error("edgar_route_list_failed", {
          surface,
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res.status(500).json({ error: "edgar_route_list_failed" });
      }
    },
  );

  app.get(
    "/api/sec/edgar/snapshot",
    authGuard,
    async (req: Request, res: Response) => {
      const windowDaysRaw = Number(req.query.windowDays);
      const windowDays = Number.isFinite(windowDaysRaw)
        ? Math.max(1, Math.min(365, Math.floor(windowDaysRaw)))
        : env.EDGAR_WATCHER_BACKFILL_DAYS;
      try {
        const snapshot = await edgarIntel.getSnapshot("global", windowDays);
        res.status(200).json({ snapshot });
      } catch (error) {
        logger.error("edgar_snapshot_failed", {
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res.status(500).json({ error: "edgar_snapshot_failed" });
      }
    },
  );

  app.get(
    "/api/sec/edgar/flow-intel",
    authGuard,
    async (req: Request, res: Response) => {
      const scopeId =
        typeof req.query.scopeId === "string" && req.query.scopeId.trim()
          ? req.query.scopeId.trim()
          : "global";
      const windowDaysRaw = Number(req.query.windowDays);
      const windowDays = Number.isFinite(windowDaysRaw)
        ? Math.max(1, Math.min(90, Math.floor(windowDaysRaw)))
        : 14;
      const limitRaw = Number(req.query.limit);
      const limit = Number.isFinite(limitRaw)
        ? Math.max(20, Math.min(400, Math.floor(limitRaw)))
        : 180;
      const cooldownHoursRaw = Number(req.query.cooldownHours);
      const cooldownHours = Number.isFinite(cooldownHoursRaw)
        ? Math.max(1, Math.min(168, Math.floor(cooldownHoursRaw)))
        : 24;
      const persistReports = req.query.persist !== "false";

      try {
        const filings = await edgarIntel.listFilings(scopeId, {
          fromDate: toIsoDay(new Date(), windowDays),
          limit,
        });
        const payload = buildFlowIntelPayload(filings, windowDays);
        const persistence = persistReports
          ? await persistFlowAnomalyReports(scopeId, payload, cooldownHours)
          : { inserted: 0, suppressed: payload.anomalies.length };

        res.status(200).json({ payload, persistence });
      } catch (error) {
        logger.error("edgar_flow_intel_failed", {
          scopeId,
          windowDays,
          limit,
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res.status(500).json({ error: "edgar_flow_intel_failed" });
      }
    },
  );

  app.get(
    "/api/sec/edgar/flow-intel/digest",
    authGuard,
    async (req: Request, res: Response) => {
      const scopeId =
        typeof req.query.scopeId === "string" && req.query.scopeId.trim()
          ? req.query.scopeId.trim()
          : "global";
      const limitRaw = Number(req.query.limit);
      const limit = Number.isFinite(limitRaw)
        ? Math.max(1, Math.min(25, Math.floor(limitRaw)))
        : 8;

      try {
        const items = await listRecentFlowAnomalyReports(scopeId, limit);
        res.status(200).json({
          scopeId,
          items,
          total: items.length,
          generatedAt: new Date().toISOString(),
        });
      } catch (error) {
        logger.error("edgar_flow_intel_digest_failed", {
          scopeId,
          limit,
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res.status(500).json({ error: "edgar_flow_intel_digest_failed" });
      }
    },
  );

  app.post(
    "/api/supplychain/generate",
    authGuard,
    (req: Request, res: Response) => {
      const ticker =
        typeof req.body?.ticker === "string" ? req.body.ticker : "";
      if (!ticker) {
        res.status(400).json({ error: "missing_ticker" });
        return;
      }
      const generated = createSupplyChainMap({
        ticker,
        ...(Array.isArray(req.body?.globalTickers)
          ? { globalTickers: req.body.globalTickers }
          : {}),
        ...(typeof req.body?.strictMode === "boolean"
          ? { strictMode: req.body.strictMode }
          : {}),
        ...(typeof req.body?.includeHypothesis === "boolean"
          ? { includeHypothesis: req.body.includeHypothesis }
          : {}),
        ...(Number.isFinite(Number(req.body?.hops))
          ? { hops: Number(req.body.hops) }
          : {}),
        ...(Number.isFinite(Number(req.body?.minEdgeWeight))
          ? { minEdgeWeight: Number(req.body.minEdgeWeight) }
          : {}),
      });
      res.status(200).json({
        success: true,
        data: generated.data,
        fromCache: false,
        needsRefresh: false,
        cacheKey: generated.cacheKey,
      });
    },
  );

  app.post(
    "/api/supplychain/clear-cache",
    authGuard,
    (req: Request, res: Response) => {
      const key = typeof req.body?.key === "string" ? req.body.key : "";
      if (!key) {
        res.status(400).json({ error: "missing_key" });
        return;
      }
      const ok = clearSupplyChainCache(key);
      res.status(200).json({ ok });
    },
  );

  app.get(
    "/api/supplychain/cache",
    authGuard,
    (_req: Request, res: Response) => {
      res.status(200).json({ keys: getSupplyChainCachedKeys() });
    },
  );

  app.post(
    "/api/supplychain/advisor-ask",
    authGuard,
    (req: Request, res: Response) => {
      const question =
        typeof req.body?.question === "string" ? req.body.question : "";
      res.status(200).json({
        success: true,
        answer: question
          ? `Advisor summary: ${question.slice(0, 180)}. Primary risk remains concentrated supplier dependency.`
          : "Advisor summary unavailable without question.",
        sources: ["Internal supply chain model"],
        followups: [
          "What is the highest criticality edge?",
          "Which node has best substitution optionality?",
        ],
        model: "backend-demo-advisor",
      });
    },
  );

  app.post(
    "/api/indicators/compute",
    authGuard,
    (req: Request, res: Response) => {
      const symbol =
        typeof req.body?.symbol === "string" ? req.body.symbol : "AAPL";
      const prices = Array.isArray(req.body?.prices)
        ? req.body.prices
            .map((value: unknown) => Number(value))
            .filter((value: number) => Number.isFinite(value))
        : [];
      res.status(200).json({ result: computeIndicators(symbol, prices) });
    },
  );

  app.get("/api/ai/models", authGuard, async (_req: Request, res: Response) => {
    try {
      const models = await ollama.listModels();
      const response = aiModelsListResponseSchema.parse({ models });
      res.status(200).json(response);
    } catch (error) {
      logger.error("ai_models_failed", {
        error: error instanceof Error ? error.message : "unknown_error",
      });
      res.status(502).json({ error: "ollama_models_unavailable" });
    }
  });

  app.post(
    "/api/ai/research/run",
    authGuard,
    async (req: Request, res: Response) => {
      if (!aiResearch) {
        res.status(503).json({ error: "ai_research_unavailable_no_database" });
        return;
      }

      const parsed = aiResearchRunRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "invalid_request", details: parsed.error.flatten() });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const model =
        parsed.data.model ??
        env.OLLAMA_RESEARCH_MODEL ??
        env.OLLAMA_DEFAULT_MODEL;
      const manualItems = parsed.data.manualItems ?? [];
      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const idempotencyHeader = req.header("x-idempotency-key");
      const idempotencyKey =
        typeof idempotencyHeader === "string" &&
        idempotencyHeader.trim().length > 0
          ? idempotencyHeader.trim()
          : undefined;

      try {
        const job = await aiQueue.enqueue(
          "ai.research.run",
          {
            userId: req.user.id,
            tenantId,
            manualItems,
            model,
          },
          {
            ...(idempotencyKey ? { idempotencyKey } : {}),
            maxAttempts: env.AI_QUEUE_RETRY_LIMIT,
          },
        );

        aiQueueGauge.set(await aiQueue.getQueueDepth());

        const waitTimeoutMs = Number(
          req.query.waitMs ?? env.AI_RESEARCH_WAIT_TIMEOUT_MS,
        );
        const settled = await aiQueue.waitFor<
          {
            userId: string;
            tenantId: string;
            manualItems: Array<{ title: string; text: string }>;
            model: string;
          },
          { runId: string; status: "completed" }
        >(job.id, waitTimeoutMs);
        await refreshAiQueueMetrics();

        if (!settled) {
          const queuedPayload = aiJobEnqueueResponseSchema.parse({
            jobId: job.id,
            status: "queued",
          });
          res.status(202).json(queuedPayload);
          return;
        }

        if (settled.status === "completed") {
          res
            .status(200)
            .json(
              settled.result ?? { jobId: settled.id, status: settled.status },
            );
          return;
        }

        if (settled.status === "cancelled") {
          res
            .status(409)
            .json({ error: "ai_research_cancelled", jobId: settled.id });
          return;
        }

        res.status(502).json({
          error: settled.error ?? "ai_research_failed",
          jobId: settled.id,
          model,
        });
      } catch (error) {
        logger.error("ai_research_run_failed", {
          error: error instanceof Error ? error.message : "unknown_error",
          model,
        });
        res.status(502).json({ error: "ai_research_failed", model });
      }
    },
  );

  app.get(
    "/api/ai/jobs/:jobId",
    authGuard,
    async (req: Request, res: Response) => {
      const jobId = req.params.jobId;
      if (!jobId) {
        res.status(400).json({ error: "missing_job_id" });
        return;
      }

      const job = await aiQueue.getJob(jobId);
      if (!job) {
        res.status(404).json({ error: "job_not_found" });
        return;
      }

      const payload = aiJobStatusResponseSchema.parse({ job });
      res.status(200).json(payload);
    },
  );

  app.post(
    "/api/ai/jobs/:jobId/cancel",
    authGuard,
    async (req: Request, res: Response) => {
      const jobId = req.params.jobId;
      if (!jobId) {
        res.status(400).json({ error: "missing_job_id" });
        return;
      }

      const ok = await aiQueue.cancel(jobId);
      if (!ok) {
        res.status(409).json({ ok: false, error: "job_not_cancellable" });
        return;
      }

      res.status(200).json({ ok: true });
    },
  );

  app.post(
    "/api/strategies",
    authGuard,
    async (req: Request, res: Response) => {
      if (!backtesting) {
        res.status(503).json({ error: "backtesting_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const parsed = createStrategyRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "invalid_request", details: parsed.error.flatten() });
        return;
      }

      try {
        const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
        const strategy = await backtesting.createStrategy({
          tenantId,
          userId: req.user.id,
          name: parsed.data.name,
          description: parsed.data.description,
        });

        const response = createStrategyResponseSchema.parse({
          strategy: {
            id: strategy.strategyId,
            name: strategy.name,
            stage: strategy.stage,
            tags: strategy.tags,
            description: strategy.description,
            createdAt: strategy.createdAt,
            updatedAt: strategy.updatedAt,
          },
        });
        res.status(201).json(response);
      } catch (error) {
        logger.error("strategy_create_failed", {
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res.status(500).json({ error: "strategy_create_failed" });
      }
    },
  );

  app.get("/api/strategies", authGuard, async (req: Request, res: Response) => {
    if (!backtesting) {
      res.status(503).json({ error: "backtesting_unavailable_no_database" });
      return;
    }

    if (!req.user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    try {
      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const limit = Number(req.query.limit);
      const strategies = await backtesting.listStrategies(
        req.user.id,
        tenantId,
        Number.isFinite(limit) ? limit : 100,
      );

      const response = listStrategiesResponseSchema.parse({
        strategies: strategies.map((s) => ({
          id: s.strategyId,
          name: s.name,
          stage: s.stage,
          tags: s.tags,
          description: s.description,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        })),
      });
      res.status(200).json(response);
    } catch (error) {
      logger.error("strategy_list_failed", {
        error: error instanceof Error ? error.message : "unknown_error",
      });
      res.status(500).json({ error: "strategy_list_failed" });
    }
  });

  app.get(
    "/api/strategies/:strategyId",
    authGuard,
    async (req: Request, res: Response) => {
      if (!backtesting) {
        res.status(503).json({ error: "backtesting_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const strategyId = req.params.strategyId;
      if (!strategyId) {
        res.status(400).json({ error: "missing_strategy_id" });
        return;
      }

      try {
        const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
        const strategy = await backtesting.getStrategy(
          strategyId,
          req.user.id,
          tenantId,
        );
        if (!strategy) {
          res.status(404).json({ error: "strategy_not_found" });
          return;
        }

        const version = await backtesting.getLatestStrategyVersion(
          strategyId,
          req.user.id,
          tenantId,
        );

        const response = getStrategyResponseSchema.parse({
          strategy: {
            id: strategy.strategyId,
            name: strategy.name,
            stage: strategy.stage,
            tags: strategy.tags,
            description: strategy.description,
            createdAt: strategy.createdAt,
            updatedAt: strategy.updatedAt,
          },
          version: version
            ? {
                id: `${version.strategyId}-${version.version}`,
                strategyId: version.strategyId,
                version: version.version,
                scriptLanguage: version.scriptLanguage,
                scriptSource: version.scriptSource,
                scriptChecksum: version.scriptChecksum,
                universe: version.universe,
                assumptions: version.assumptions,
                createdAt: version.createdAt,
              }
            : {
                id: "",
                strategyId,
                version: "",
                scriptLanguage: "javascript",
                scriptSource: "",
                scriptChecksum: "",
                universe: [],
                assumptions: {},
                createdAt: new Date().toISOString(),
              },
        });
        res.status(200).json(response);
      } catch (error) {
        logger.error("strategy_get_failed", {
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res.status(500).json({ error: "strategy_get_failed" });
      }
    },
  );

  app.patch(
    "/api/strategies/:strategyId",
    authGuard,
    async (req: Request, res: Response) => {
      if (!backtesting) {
        res.status(503).json({ error: "backtesting_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const strategyId = req.params.strategyId;
      if (!strategyId) {
        res.status(400).json({ error: "missing_strategy_id" });
        return;
      }

      const parsed = updateStrategyRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "invalid_request", details: parsed.error.flatten() });
        return;
      }

      try {
        const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
        const updated = await backtesting.updateStrategy({
          strategyId,
          userId: req.user.id,
          tenantId,
          name: parsed.data.name,
          description: parsed.data.description,
          stage: parsed.data.stage,
          tags: parsed.data.tags,
          metadata: undefined,
        });

        if (!updated) {
          res.status(404).json({ error: "strategy_not_found" });
          return;
        }

        const response = createStrategyResponseSchema.parse({
          strategy: {
            id: updated.strategyId,
            name: updated.name,
            stage: updated.stage,
            tags: updated.tags,
            description: updated.description,
            createdAt: updated.createdAt,
            updatedAt: updated.updatedAt,
          },
        });
        res.status(200).json(response);
      } catch (error) {
        logger.error("strategy_update_failed", {
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res.status(500).json({ error: "strategy_update_failed" });
      }
    },
  );

  app.post(
    "/api/strategy/versions",
    authGuard,
    async (req: Request, res: Response) => {
      if (!backtesting) {
        res.status(503).json({ error: "backtesting_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const strategyId =
        typeof req.body?.strategyId === "string" ? req.body.strategyId : "";
      if (!strategyId) {
        res.status(400).json({ error: "missing_strategy_id" });
        return;
      }

      const parsed = createStrategyVersionRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "invalid_request", details: parsed.error.flatten() });
        return;
      }

      try {
        const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
        const version = await backtesting.createStrategyVersion({
          strategyId,
          userId: req.user.id,
          tenantId,
          scriptLanguage: parsed.data.scriptLanguage ?? "javascript",
          scriptEntrypoint: parsed.data.scriptEntrypoint,
          scriptSource: parsed.data.scriptSource,
          universe: parsed.data.universe,
          assumptions: parsed.data.assumptions,
          notes: parsed.data.notes,
        });

        const response = createStrategyVersionResponseSchema.parse({
          version: {
            id: `${version.strategyId}-${version.version}`,
            strategyId: version.strategyId,
            version: version.version,
            scriptLanguage: version.scriptLanguage,
            scriptSource: version.scriptSource,
            scriptChecksum: version.scriptChecksum,
            universe: version.universe,
            assumptions: version.assumptions,
            createdAt: version.createdAt,
          },
        });
        res.status(201).json(response);
      } catch (error) {
        logger.error("strategy_version_create_failed", {
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res.status(500).json({ error: "strategy_version_create_failed" });
      }
    },
  );

  app.get(
    "/api/strategy/versions/:strategyId/latest",
    authGuard,
    async (req: Request, res: Response) => {
      if (!backtesting) {
        res.status(503).json({ error: "backtesting_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const strategyId = req.params.strategyId;
      if (!strategyId) {
        res.status(400).json({ error: "missing_strategy_id" });
        return;
      }

      try {
        const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
        const version = await backtesting.getLatestStrategyVersion(
          strategyId,
          req.user.id,
          tenantId,
        );

        if (!version) {
          res.status(404).json({ error: "version_not_found" });
          return;
        }

        const response = getLatestVersionResponseSchema.parse({
          version: {
            id: `${version.strategyId}-${version.version}`,
            strategyId: version.strategyId,
            version: version.version,
            scriptLanguage: version.scriptLanguage,
            scriptSource: version.scriptSource,
            scriptChecksum: version.scriptChecksum,
            universe: version.universe,
            assumptions: version.assumptions,
            createdAt: version.createdAt,
          },
        });
        res.status(200).json(response);
      } catch (error) {
        logger.error("strategy_version_get_failed", {
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res.status(500).json({ error: "strategy_version_get_failed" });
      }
    },
  );

  app.post(
    "/api/strategy/backtest/runs",
    authGuard,
    async (req: Request, res: Response) => {
      if (!backtesting) {
        res.status(503).json({ error: "backtesting_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const parsed = strategyBacktestRunRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "invalid_request", details: parsed.error.flatten() });
        return;
      }

      try {
        const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
        const enqueuePayload = {
          tenantId,
          userId: req.user.id,
          strategyId: parsed.data.strategyId,
          strategyVersion: parsed.data.strategyVersion,
          datasetSnapshotId: parsed.data.datasetSnapshotId,
          executionMode: parsed.data.executionMode,
          queuePriority: parsed.data.queuePriority,
          queueResourceClass: parsed.data.queueResourceClass,
          maxAttempts: parsed.data.maxAttempts,
          assumptions: parsed.data.assumptions,
          ...(parsed.data.idempotencyKey
            ? { idempotencyKey: parsed.data.idempotencyKey }
            : {}),
        };

        const diagnostics = await backtesting.validateRunInput(enqueuePayload);
        if (!diagnostics.ok) {
          res.status(422).json({
            error: "backtest_pre_run_validation_failed",
            diagnostics,
          });
          return;
        }

        const run = await backtesting.enqueueRun(enqueuePayload);

        const payload = strategyBacktestRunEnqueueResponseSchema.parse({
          runId: run.runId,
          status: run.status,
        });
        res.status(202).json(payload);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "unknown_error";
        if (
          message === "backtest_resource_limit_user_queue" ||
          message === "backtest_resource_limit_tenant_queue" ||
          message === "backtest_resource_limit_tenant_running"
        ) {
          res.status(429).json({ error: message });
          return;
        }
        logger.error("strategy_backtest_enqueue_failed", {
          error: message,
        });
        res.status(500).json({ error: "strategy_backtest_enqueue_failed" });
      }
    },
  );

  app.get(
    "/api/strategy/backtest/datasets",
    authGuard,
    async (req: Request, res: Response) => {
      if (!backtesting) {
        res.status(503).json({ error: "backtesting_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      try {
        const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
        const limit = Number(req.query.limit);
        const snapshots = await backtesting.listDatasetSnapshots(
          req.user.id,
          tenantId,
          Number.isFinite(limit) ? limit : 100,
        );
        const payload = strategyDatasetSnapshotsResponseSchema.parse({
          snapshots: snapshots.map((item) => ({
            id: item.snapshotId,
            name: item.datasetName,
            version: item.datasetVersion,
            snapshotAtIso: item.snapshotAt,
            rowCount: item.rowCount ?? null,
            sourceManifest: item.sourceManifest ?? {},
            checksumSha256: item.checksumSha256,
          })),
        });
        res.status(200).json(payload);
      } catch (error) {
        logger.error("strategy_backtest_datasets_list_failed", {
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res
          .status(500)
          .json({ error: "strategy_backtest_datasets_list_failed" });
      }
    },
  );

  app.get(
    "/api/strategy/backtest/runs",
    authGuard,
    async (req: Request, res: Response) => {
      if (!backtesting) {
        res.status(503).json({ error: "backtesting_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      try {
        const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
        const strategyId =
          typeof req.query.strategyId === "string"
            ? req.query.strategyId
            : undefined;
        const limit = Number(req.query.limit);
        const runs = await backtesting.listRuns(
          req.user.id,
          tenantId,
          strategyId,
          Number.isFinite(limit) ? limit : 50,
        );
        res.status(200).json({ runs });
      } catch (error) {
        logger.error("strategy_backtest_list_failed", {
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res.status(500).json({ error: "strategy_backtest_list_failed" });
      }
    },
  );

  app.get(
    "/api/strategy/backtest/runs/:runId",
    authGuard,
    async (req: Request, res: Response) => {
      if (!backtesting) {
        res.status(503).json({ error: "backtesting_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const runId = req.params.runId;
      if (!runId) {
        res.status(400).json({ error: "missing_run_id" });
        return;
      }

      try {
        const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
        const run = await backtesting.getRun(runId, req.user.id, tenantId);
        if (!run) {
          res.status(404).json({ error: "run_not_found" });
          return;
        }
        const payload = strategyBacktestRunStatusResponseSchema.parse({ run });
        res.status(200).json(payload);
      } catch (error) {
        logger.error("strategy_backtest_get_failed", {
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res.status(500).json({ error: "strategy_backtest_get_failed" });
      }
    },
  );

  app.get(
    "/api/strategy/backtest/runs/:runId/stream",
    authGuard,
    async (req: Request, res: Response) => {
      if (!backtesting) {
        res.status(503).json({ error: "backtesting_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const runId = req.params.runId;
      if (!runId) {
        res.status(400).json({ error: "missing_run_id" });
        return;
      }

      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const userId = req.user.id;

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();

      let closed = false;
      const writeHeartbeat = () => {
        if (closed) return;
        res.write(
          `event: heartbeat\ndata: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`,
        );
      };

      const toProgressPct = (status: string): number => {
        if (status === "queued") return 10;
        if (status === "running") return 60;
        return 100;
      };

      const emitSnapshot = async () => {
        if (closed) return false;
        try {
          const run = await backtesting.getRun(runId, userId, tenantId);
          if (!run) {
            res.write(
              `event: error\ndata: ${JSON.stringify({ error: "run_not_found" })}\n\n`,
            );
            return true;
          }

          const payload = {
            runId: run.runId,
            status: run.status,
            progressPct: toProgressPct(run.status),
            queueJobId: run.queueJobId,
            queuePriority: run.queuePriority,
            queueResourceClass: run.queueResourceClass,
            retryCount: run.retryCount,
            maxAttempts: run.maxAttempts,
            lastRetryAt: run.lastRetryAt,
            lastError: run.lastError,
            requestedAt: run.requestedAt,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
            error: run.error,
            metrics: run.metrics,
            ts: new Date().toISOString(),
          };

          res.write(`event: progress\ndata: ${JSON.stringify(payload)}\n\n`);
          return (
            run.status === "completed" ||
            run.status === "failed" ||
            run.status === "cancelled"
          );
        } catch (error) {
          res.write(
            `event: error\ndata: ${JSON.stringify({ error: error instanceof Error ? error.message : "stream_error" })}\n\n`,
          );
          return true;
        }
      };

      const tick = setInterval(() => {
        void emitSnapshot().then((done) => {
          if (done && !closed) {
            res.write("event: end\ndata: {}\n\n");
            clearInterval(tick);
            clearInterval(heartbeats);
            res.end();
            closed = true;
          }
        });
      }, 1000);

      const heartbeats = setInterval(writeHeartbeat, 15000);

      void emitSnapshot();

      req.on("close", () => {
        closed = true;
        clearInterval(tick);
        clearInterval(heartbeats);
      });
    },
  );

  app.get(
    "/api/strategy/backtest/runs/:runId/lineage/diff",
    authGuard,
    async (req: Request, res: Response) => {
      if (!lineageDiff) {
        res.status(503).json({ error: "backtesting_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const runIdA = req.params.runId;
      const runIdB =
        typeof req.query.compareToRunId === "string"
          ? req.query.compareToRunId.trim()
          : "";

      if (!runIdA || !runIdB) {
        res.status(400).json({ error: "missing_run_id_or_compare_to_run_id" });
        return;
      }

      try {
        const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
        const result = await lineageDiff.diff(
          runIdA,
          runIdB,
          req.user.id,
          tenantId,
        );
        res.status(200).json(result);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "unknown_error";
        if (message.startsWith("lineage_diff_run_not_found:")) {
          res.status(404).json({ error: message });
          return;
        }
        logger.error("lineage_diff_failed", { error: message });
        res.status(500).json({ error: "lineage_diff_failed" });
      }
    },
  );

  app.get(
    "/api/strategy/backtest/runs/:runId/artifacts",
    authGuard,
    async (req: Request, res: Response) => {
      if (!backtestingRepo) {
        res.status(503).json({ error: "backtesting_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const runId = req.params.runId;
      if (!runId) {
        res.status(400).json({ error: "missing_run_id" });
        return;
      }

      try {
        const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
        const artifacts = await backtestingRepo.listArtifacts(
          runId,
          req.user.id,
          tenantId,
        );
        const payload = strategyBacktestArtifactsResponseSchema.parse({
          artifacts,
        });
        res.status(200).json(payload);
      } catch (error) {
        logger.error("strategy_backtest_artifacts_failed", {
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res.status(500).json({ error: "strategy_backtest_artifacts_failed" });
      }
    },
  );

  app.get(
    "/api/strategy/backtest/runs/:runId/artifacts/:artifactKind",
    authGuard,
    async (req: Request, res: Response) => {
      if (!backtestingRepo) {
        res.status(503).json({ error: "backtesting_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const runId = req.params.runId;
      const artifactKind = req.params.artifactKind;

      if (!runId || !artifactKind) {
        res.status(400).json({ error: "missing_run_id_or_artifact_kind" });
        return;
      }

      try {
        const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
        const artifact = await backtestingRepo.getArtifactByKind(
          runId,
          artifactKind,
          req.user.id,
          tenantId,
        );

        if (!artifact) {
          res.status(404).json({ error: "artifact_not_found" });
          return;
        }

        // Determine content type from artifact kind
        let contentType = "application/json";
        if (artifact.artifactKind.includes("csv")) {
          contentType = "text/csv";
        } else if (
          artifact.artifactKind.includes("markdown") ||
          artifact.artifactKind.includes("text")
        ) {
          contentType = "text/markdown";
        }

        // If payload has actual content, return it
        if (artifact.payload && artifact.payload.data) {
          res.setHeader("Content-Type", contentType);
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="${artifact.artifactKind}.${artifact.artifactKind.includes("csv") ? "csv" : "txt"}"`,
          );
          res.status(200).send(artifact.payload.data as string);
        } else {
          // Return full artifact object
          res.status(200).json({
            artifact,
          });
        }
      } catch (error) {
        logger.error("strategy_backtest_artifact_content_failed", {
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res
          .status(500)
          .json({ error: "strategy_backtest_artifact_content_failed" });
      }
    },
  );

  app.post(
    "/api/strategy/backtest/runs/:runId/robustness",
    authGuard,
    async (req: Request, res: Response) => {
      if (!backtestRobustness || !backtestingRepo) {
        res.status(503).json({ error: "backtesting_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const runId = req.params.runId;
      if (!runId) {
        res.status(400).json({ error: "missing_run_id" });
        return;
      }

      const parsed = strategyBacktestRobustnessRequestSchema.safeParse(
        req.body ?? {},
      );
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "invalid_request", details: parsed.error.flatten() });
        return;
      }

      try {
        const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
        const report = await backtestRobustness.runSuite({
          runId,
          userId: req.user.id,
          tenantId,
        });

        if (parsed.data.persistExperimentName) {
          const run = await backtestingRepo.getRun(
            runId,
            req.user.id,
            tenantId,
          );
          if (!run) {
            res.status(404).json({ error: "run_not_found" });
            return;
          }
          await backtestingRepo.upsertExperiment({
            experimentId: randomUUID(),
            tenantId,
            userId: req.user.id,
            strategyId: run.strategyId,
            runId,
            experimentName: parsed.data.persistExperimentName,
            tags: parsed.data.tags ?? [],
            notes: parsed.data.notes ?? "",
            parameters: {
              robustnessReport: report,
            },
          });
        }

        const payload = strategyBacktestRobustnessResponseSchema.parse({
          report,
        });
        res.status(200).json(payload);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "unknown_error";
        if (
          message === "robustness_run_not_found" ||
          message === "robustness_strategy_version_not_found" ||
          message === "robustness_snapshot_not_found"
        ) {
          res.status(404).json({ error: message });
          return;
        }
        logger.error("strategy_backtest_robustness_failed", {
          error: message,
        });
        res.status(500).json({ error: "strategy_backtest_robustness_failed" });
      }
    },
  );

  app.get(
    "/api/strategy/backtest/runs/:runId/compare",
    authGuard,
    async (req: Request, res: Response) => {
      if (!backtestingRepo) {
        res.status(503).json({ error: "backtesting_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const runId = req.params.runId;
      const baselineRunId =
        typeof req.query.baselineRunId === "string"
          ? req.query.baselineRunId.trim()
          : typeof req.query.compareToRunId === "string"
            ? req.query.compareToRunId.trim()
            : "";
      if (!runId || !baselineRunId) {
        res.status(400).json({ error: "missing_run_id_or_baseline_run_id" });
        return;
      }

      try {
        const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
        const [run, baselineRun] = await Promise.all([
          backtestingRepo.getRun(runId, req.user.id, tenantId),
          backtestingRepo.getRun(baselineRunId, req.user.id, tenantId),
        ]);
        if (!run || !baselineRun) {
          res.status(404).json({ error: "run_not_found" });
          return;
        }

        const comparison = compareRunMetrics({
          runId,
          baselineRunId,
          runMetrics: run.metrics ?? {},
          baselineMetrics: baselineRun.metrics ?? {},
          trackedFields: [
            "totalReturn",
            "annualizedReturn",
            "sharpeRatio",
            "maxDrawdown",
            "winRate",
            "annualizedVolatility",
            "turnoverPct",
            "exposureUtilizationPct",
            "expectancy",
            "cagr",
            "sortinoRatio",
            "calmarRatio",
          ],
        });
        const includeLineage =
          req.query.includeLineage === "1" ||
          req.query.includeLineage === "true";
        const lineage =
          includeLineage && lineageDiff
            ? await lineageDiff.diff(
                runId,
                baselineRunId,
                req.user.id,
                tenantId,
              )
            : undefined;
        const payload = strategyBacktestCompareResponseSchema.parse({
          comparison,
          ...(lineage ? { lineage } : {}),
        });
        res.status(200).json(payload);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "unknown_error";
        logger.error("strategy_backtest_compare_failed", { error: message });
        res.status(500).json({ error: "strategy_backtest_compare_failed" });
      }
    },
  );

  app.get(
    "/api/strategy/backtest/runs/:runId/experiment",
    authGuard,
    async (req: Request, res: Response) => {
      if (!backtestingRepo) {
        res.status(503).json({ error: "backtesting_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const runId = req.params.runId;
      if (!runId) {
        res.status(400).json({ error: "missing_run_id" });
        return;
      }

      try {
        const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
        const experiment = await backtestingRepo.getExperiment(
          runId,
          req.user.id,
          tenantId,
        );
        const payload = strategyRunExperimentResponseSchema.parse({
          experiment,
        });
        res.status(200).json(payload);
      } catch (error) {
        logger.error("strategy_backtest_experiment_get_failed", {
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res
          .status(500)
          .json({ error: "strategy_backtest_experiment_get_failed" });
      }
    },
  );

  app.put(
    "/api/strategy/backtest/runs/:runId/experiment",
    authGuard,
    async (req: Request, res: Response) => {
      if (!backtestingRepo) {
        res.status(503).json({ error: "backtesting_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const runId = req.params.runId;
      if (!runId) {
        res.status(400).json({ error: "missing_run_id" });
        return;
      }

      const parsed = strategyRunExperimentRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "invalid_request", details: parsed.error.flatten() });
        return;
      }

      try {
        const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
        const run = await backtestingRepo.getRun(runId, req.user.id, tenantId);
        if (!run) {
          res.status(404).json({ error: "run_not_found" });
          return;
        }
        const existing = await backtestingRepo.getExperiment(
          runId,
          req.user.id,
          tenantId,
        );
        const experimentId = existing?.experimentId ?? randomUUID();
        await backtestingRepo.upsertExperiment({
          experimentId,
          tenantId,
          userId: req.user.id,
          strategyId: run.strategyId,
          runId,
          experimentName: parsed.data.experimentName,
          tags: parsed.data.tags,
          notes: parsed.data.notes,
          parameters: parsed.data.parameters,
        });
        const experiment = await backtestingRepo.getExperiment(
          runId,
          req.user.id,
          tenantId,
        );
        const payload = strategyRunExperimentResponseSchema.parse({
          experiment,
        });
        res.status(200).json(payload);
      } catch (error) {
        logger.error("strategy_backtest_experiment_upsert_failed", {
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res
          .status(500)
          .json({ error: "strategy_backtest_experiment_upsert_failed" });
      }
    },
  );

  app.post(
    "/api/strategy/promotions",
    authGuard,
    async (req: Request, res: Response) => {
      if (!backtesting) {
        res.status(503).json({ error: "backtesting_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const parsed = strategyPromotionRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "invalid_request", details: parsed.error.flatten() });
        return;
      }

      try {
        const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
        const promotionPayload = {
          tenantId,
          userId: req.user.id,
          strategyId: parsed.data.strategyId,
          fromStage: parsed.data.fromStage,
          toStage: parsed.data.toStage,
          ...(parsed.data.sourceRunId
            ? { sourceRunId: parsed.data.sourceRunId }
            : {}),
          ...(parsed.data.baselineRunId
            ? { baselineRunId: parsed.data.baselineRunId }
            : {}),
          ...(parsed.data.governanceProfileId
            ? { governanceProfileId: parsed.data.governanceProfileId }
            : {}),
          ...(parsed.data.acceptancePackId
            ? { acceptancePackId: parsed.data.acceptancePackId }
            : {}),
          autoGatePassed: parsed.data.autoGatePassed,
          checklist: parsed.data.checklist,
          rationale: parsed.data.rationale,
          ...(parsed.data.manualApprovedBy
            ? { manualApprovedBy: parsed.data.manualApprovedBy }
            : {}),
        };
        const result = await backtesting.promoteStrategy(promotionPayload);
        res.status(200).json({ ok: true, eventId: result.eventId });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "unknown_error";
        if (
          message === "governance_profile_default_missing" ||
          message === "acceptance_pack_default_missing"
        ) {
          res.status(422).json({ error: message });
          return;
        }
        if (
          message === "governance_auto_gate_required" ||
          message === "governance_manual_approval_required" ||
          message === "governance_transition_disallowed" ||
          message === "governance_benchmark_required" ||
          message === "governance_source_run_required_for_oos" ||
          message === "governance_source_run_required_for_replay_tolerance" ||
          message.startsWith("governance_checklist_incomplete") ||
          message.startsWith("governance_required_reports_incomplete") ||
          message.startsWith("governance_oos_minimums_failed") ||
          message.startsWith("governance_replay_tolerance_failed")
        ) {
          res.status(409).json({ error: message });
          return;
        }
        if (
          message === "governance_source_run_not_found" ||
          message === "governance_baseline_run_not_found"
        ) {
          res.status(404).json({ error: message });
          return;
        }
        if (
          message === "governance_source_run_strategy_mismatch" ||
          message === "governance_source_run_not_completed" ||
          message === "governance_baseline_run_strategy_mismatch"
        ) {
          res.status(400).json({ error: message });
          return;
        }
        logger.error("strategy_promotion_failed", {
          error: message,
        });
        res.status(500).json({ error: "strategy_promotion_failed" });
      }
    },
  );

  app.put(
    "/api/strategy/connectors",
    authGuard,
    async (req: Request, res: Response) => {
      if (!backtesting) {
        res.status(503).json({ error: "backtesting_unavailable_no_database" });
        return;
      }

      const parsed = strategyConnectorUpsertRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "invalid_request", details: parsed.error.flatten() });
        return;
      }

      try {
        const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
        const result = await backtesting.upsertConnector({
          ...(parsed.data.connectorId
            ? { connectorId: parsed.data.connectorId }
            : {}),
          tenantId,
          connectorType: parsed.data.connectorType,
          status: parsed.data.status,
          displayName: parsed.data.displayName,
          config: parsed.data.config,
          capabilities: parsed.data.capabilities,
        });
        res.status(200).json({ ok: true, connectorId: result.connectorId });
      } catch (error) {
        logger.error("strategy_connector_upsert_failed", {
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res.status(500).json({ error: "strategy_connector_upsert_failed" });
      }
    },
  );

  app.get(
    "/api/strategy/connectors",
    authGuard,
    async (req: Request, res: Response) => {
      if (!backtesting) {
        res.status(503).json({ error: "backtesting_unavailable_no_database" });
        return;
      }

      try {
        const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
        const connectors = await backtesting.listConnectors(tenantId);
        const payload = strategyConnectorListResponseSchema.parse({
          connectors,
        });
        res.status(200).json(payload);
      } catch (error) {
        logger.error("strategy_connector_list_failed", {
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res.status(500).json({ error: "strategy_connector_list_failed" });
      }
    },
  );

  app.put(
    "/api/strategy/governance-profiles",
    authGuard,
    async (req: Request, res: Response) => {
      if (!backtesting) {
        res.status(503).json({ error: "backtesting_unavailable_no_database" });
        return;
      }

      const parsed = strategyGovernanceProfileUpsertRequestSchema.safeParse(
        req.body,
      );
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "invalid_request", details: parsed.error.flatten() });
        return;
      }

      try {
        const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
        const result = await backtesting.upsertGovernanceProfile({
          ...(parsed.data.profileId
            ? { profileId: parsed.data.profileId }
            : {}),
          tenantId,
          profileName: parsed.data.profileName,
          isDefault: parsed.data.isDefault,
          transitionRules: parsed.data.transitionRules,
          requiredReportSections: parsed.data.requiredReportSections,
          benchmarkRequired: parsed.data.benchmarkRequired,
          oosMinimums: parsed.data.oosMinimums,
          drawdownHaltRules: parsed.data.drawdownHaltRules,
          replayTolerance: parsed.data.replayTolerance,
        });
        res.status(200).json({ ok: true, profileId: result.profileId });
      } catch (error) {
        logger.error("strategy_governance_profile_upsert_failed", {
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res
          .status(500)
          .json({ error: "strategy_governance_profile_upsert_failed" });
      }
    },
  );

  app.get(
    "/api/strategy/governance-profiles",
    authGuard,
    async (req: Request, res: Response) => {
      if (!backtesting) {
        res.status(503).json({ error: "backtesting_unavailable_no_database" });
        return;
      }

      try {
        const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
        const profiles = await backtesting.listGovernanceProfiles(tenantId);
        const payload = strategyGovernanceProfileListResponseSchema.parse({
          profiles,
        });
        res.status(200).json(payload);
      } catch (error) {
        logger.error("strategy_governance_profile_list_failed", {
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res
          .status(500)
          .json({ error: "strategy_governance_profile_list_failed" });
      }
    },
  );

  app.put(
    "/api/strategy/acceptance-packs",
    authGuard,
    async (req: Request, res: Response) => {
      if (!backtesting) {
        res.status(503).json({ error: "backtesting_unavailable_no_database" });
        return;
      }

      const parsed = strategyAcceptancePackUpsertRequestSchema.safeParse(
        req.body,
      );
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "invalid_request", details: parsed.error.flatten() });
        return;
      }

      try {
        const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
        const result = await backtesting.upsertAcceptancePack({
          ...(parsed.data.packId ? { packId: parsed.data.packId } : {}),
          tenantId,
          packName: parsed.data.packName,
          isDefault: parsed.data.isDefault,
          goldenStrategies: parsed.data.goldenStrategies,
          requiredReportSections: parsed.data.requiredReportSections,
          replayTolerance: parsed.data.replayTolerance,
          promotionChecklist: parsed.data.promotionChecklist,
          definitionOfDone: parsed.data.definitionOfDone,
        });
        res.status(200).json({ ok: true, packId: result.packId });
      } catch (error) {
        logger.error("strategy_acceptance_pack_upsert_failed", {
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res
          .status(500)
          .json({ error: "strategy_acceptance_pack_upsert_failed" });
      }
    },
  );

  app.get(
    "/api/strategy/acceptance-packs",
    authGuard,
    async (req: Request, res: Response) => {
      if (!backtesting) {
        res.status(503).json({ error: "backtesting_unavailable_no_database" });
        return;
      }

      try {
        const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
        const packs = await backtesting.listAcceptancePacks(tenantId);
        const payload = strategyAcceptancePackListResponseSchema.parse({
          packs,
        });
        res.status(200).json(payload);
      } catch (error) {
        logger.error("strategy_acceptance_pack_list_failed", {
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res.status(500).json({ error: "strategy_acceptance_pack_list_failed" });
      }
    },
  );

  app.get(
    "/api/strategy/governance/readiness",
    authGuard,
    async (req: Request, res: Response) => {
      if (!backtesting) {
        res.status(503).json({ error: "backtesting_unavailable_no_database" });
        return;
      }

      const executionModeRaw =
        typeof req.query.executionMode === "string"
          ? req.query.executionMode.trim().toLowerCase()
          : "";
      if (executionModeRaw !== "paper" && executionModeRaw !== "live") {
        res
          .status(400)
          .json({ error: "invalid_execution_mode_expected_paper_or_live" });
        return;
      }

      try {
        const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
        const readiness = await backtesting.getGovernanceReadiness({
          tenantId,
          executionMode: executionModeRaw,
        });
        const payload =
          strategyGovernanceReadinessResponseSchema.parse(readiness);
        res.status(200).json(payload);
      } catch (error) {
        logger.error("strategy_governance_readiness_failed", {
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res.status(500).json({ error: "strategy_governance_readiness_failed" });
      }
    },
  );

  app.post(
    "/api/strategy/forward-profiles",
    authGuard,
    async (req: Request, res: Response) => {
      if (!backtesting) {
        res.status(503).json({ error: "backtesting_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const parsed = strategyForwardProfileCreateRequestSchema.safeParse(
        req.body,
      );
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "invalid_request", details: parsed.error.flatten() });
        return;
      }

      try {
        const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
        const result = await backtesting.createForwardProfile({
          tenantId,
          userId: req.user.id,
          strategyId: parsed.data.strategyId,
          sourceRunId: parsed.data.sourceRunId,
          ...(parsed.data.baselineRunId
            ? { baselineRunId: parsed.data.baselineRunId }
            : {}),
          executionMode: parsed.data.executionMode,
          ...(parsed.data.governanceProfileId
            ? { governanceProfileId: parsed.data.governanceProfileId }
            : {}),
          ...(parsed.data.acceptancePackId
            ? { acceptancePackId: parsed.data.acceptancePackId }
            : {}),
          autoGatePassed: parsed.data.autoGatePassed,
          checklist: parsed.data.checklist,
          ...(parsed.data.manualApprovedBy
            ? { manualApprovedBy: parsed.data.manualApprovedBy }
            : {}),
          benchmark: parsed.data.benchmark,
          rebalanceFrozenAt: parsed.data.rebalanceFrozenAt,
          metadata: parsed.data.metadata,
        });
        res.status(200).json({ ok: true, profileId: result.profileId });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "unknown_error";
        if (
          message === "source_run_not_found" ||
          message === "strategy_not_found" ||
          message === "governance_baseline_run_not_found"
        ) {
          res.status(404).json({ error: message });
          return;
        }
        if (
          message === "source_run_strategy_mismatch" ||
          message === "source_run_not_completed" ||
          message === "strategy_stage_not_ready_for_handoff" ||
          message === "strategy_stage_not_ready_for_live_activation" ||
          message === "governance_baseline_run_strategy_mismatch" ||
          message === "governance_baseline_run_not_completed"
        ) {
          res.status(400).json({ error: message });
          return;
        }
        if (
          message === "governance_profile_default_missing" ||
          message === "acceptance_pack_default_missing"
        ) {
          res.status(422).json({ error: message });
          return;
        }
        if (
          message === "governance_auto_gate_required" ||
          message === "governance_manual_approval_required" ||
          message === "governance_transition_disallowed" ||
          message === "governance_benchmark_required" ||
          message === "governance_baseline_run_required_for_replay_tolerance" ||
          message.startsWith("governance_checklist_incomplete") ||
          message.startsWith("governance_definition_of_done_incomplete") ||
          message.startsWith("governance_required_reports_incomplete") ||
          message.startsWith("governance_oos_minimums_failed") ||
          message.startsWith("governance_replay_tolerance_failed")
        ) {
          res.status(409).json({ error: message });
          return;
        }
        logger.error("strategy_forward_profile_create_failed", {
          error: message,
        });
        res
          .status(500)
          .json({ error: "strategy_forward_profile_create_failed" });
      }
    },
  );

  app.get(
    "/api/strategy/forward-profiles",
    authGuard,
    async (req: Request, res: Response) => {
      if (!backtesting) {
        res.status(503).json({ error: "backtesting_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const strategyId =
        typeof req.query.strategyId === "string" && req.query.strategyId.trim()
          ? req.query.strategyId.trim()
          : undefined;
      const limitRaw =
        typeof req.query.limit === "string" ? Number(req.query.limit) : 100;
      const limit = Number.isFinite(limitRaw) ? Number(limitRaw) : 100;

      try {
        const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
        const profiles = await backtesting.listForwardProfiles({
          tenantId,
          userId: req.user.id,
          ...(strategyId ? { strategyId } : {}),
          limit,
        });
        const payload = strategyForwardProfileListResponseSchema.parse({
          profiles,
        });
        res.status(200).json(payload);
      } catch (error) {
        logger.error("strategy_forward_profile_list_failed", {
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res.status(500).json({ error: "strategy_forward_profile_list_failed" });
      }
    },
  );

  app.patch(
    "/api/strategy/forward-profiles/:profileId/status",
    authGuard,
    async (req: Request, res: Response) => {
      if (!backtesting) {
        res.status(503).json({ error: "backtesting_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const profileId = String(req.params.profileId ?? "").trim();
      if (!profileId) {
        res.status(400).json({ error: "invalid_profile_id" });
        return;
      }

      const parsed = strategyForwardProfileStatusUpdateRequestSchema.safeParse(
        req.body,
      );
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "invalid_request", details: parsed.error.flatten() });
        return;
      }

      try {
        const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
        await backtesting.setForwardProfileStatus({
          tenantId,
          userId: req.user.id,
          profileId,
          status: parsed.data.status,
          ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
        });
        res
          .status(200)
          .json({ ok: true, profileId, status: parsed.data.status });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "unknown_error";
        if (message === "forward_profile_not_found") {
          res.status(404).json({ error: message });
          return;
        }
        if (message === "forward_profile_stopped_terminal_state") {
          res.status(409).json({ error: message });
          return;
        }
        logger.error("strategy_forward_profile_status_update_failed", {
          error: message,
        });
        res
          .status(500)
          .json({ error: "strategy_forward_profile_status_update_failed" });
      }
    },
  );

  app.get(
    "/api/strategy/forward-profiles/:profileId/drift",
    authGuard,
    async (req: Request, res: Response) => {
      if (!backtesting) {
        res.status(503).json({ error: "backtesting_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const profileId = String(req.params.profileId ?? "").trim();
      if (!profileId) {
        res.status(400).json({ error: "invalid_profile_id" });
        return;
      }

      const candidateRunId =
        typeof req.query.runId === "string" && req.query.runId.trim().length > 0
          ? req.query.runId.trim()
          : undefined;

      try {
        const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
        const drift = await backtesting.getForwardProfileDrift({
          tenantId,
          userId: req.user.id,
          profileId,
          ...(candidateRunId ? { candidateRunId } : {}),
        });
        const payload = strategyForwardProfileDriftResponseSchema.parse(drift);
        res.status(200).json(payload);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "unknown_error";
        if (
          message === "forward_profile_not_found" ||
          message === "forward_profile_source_run_not_found"
        ) {
          res.status(404).json({ error: message });
          return;
        }
        if (
          message === "forward_profile_source_run_not_completed" ||
          message === "forward_profile_drift_candidate_run_missing" ||
          message === "forward_profile_drift_candidate_run_not_completed" ||
          message === "forward_profile_drift_candidate_strategy_mismatch"
        ) {
          res.status(400).json({ error: message });
          return;
        }
        logger.error("strategy_forward_profile_drift_failed", {
          error: message,
        });
        res
          .status(500)
          .json({ error: "strategy_forward_profile_drift_failed" });
      }
    },
  );

  app.get(
    "/api/strategy/forward-profiles/:profileId/alerts",
    authGuard,
    async (req: Request, res: Response) => {
      if (!backtesting) {
        res.status(503).json({ error: "backtesting_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const profileId = String(req.params.profileId ?? "").trim();
      if (!profileId) {
        res.status(400).json({ error: "invalid_profile_id" });
        return;
      }

      const candidateRunId =
        typeof req.query.runId === "string" && req.query.runId.trim().length > 0
          ? req.query.runId.trim()
          : undefined;

      try {
        const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
        const alerts = await backtesting.getForwardProfileAlerts({
          tenantId,
          userId: req.user.id,
          profileId,
          ...(candidateRunId ? { candidateRunId } : {}),
        });
        const payload =
          strategyForwardProfileAlertsResponseSchema.parse(alerts);
        res.status(200).json(payload);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "unknown_error";
        if (message === "forward_profile_not_found") {
          res.status(404).json({ error: message });
          return;
        }
        logger.error("strategy_forward_profile_alerts_failed", {
          error: message,
        });
        res
          .status(500)
          .json({ error: "strategy_forward_profile_alerts_failed" });
      }
    },
  );

  app.get(
    "/api/ai/research/briefs",
    authGuard,
    async (req: Request, res: Response) => {
      if (!aiResearch) {
        res.status(503).json({ error: "ai_research_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const limit =
        typeof req.query.limit === "string" ? Number(req.query.limit) : 50;
      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const normalizedLimit = Number.isFinite(limit) ? Number(limit) : 50;
      const cacheKey = `ai:briefs:${tenantId}:${req.user.id}:${normalizedLimit}`;
      const cached = await infra.cache.getJson<{ briefs: unknown[] }>(cacheKey);
      if (cached) {
        res.status(200).json(cached);
        return;
      }
      const briefs = await aiResearch.listBriefs(req.user.id, limit, tenantId);
      const payload = { briefs };
      await infra.cache.setJson(
        cacheKey,
        payload,
        env.CACHE_AI_BRIEFS_TTL_SECONDS,
      );
      res.status(200).json(payload);
    },
  );

  app.get(
    "/api/ai/research/config",
    authGuard,
    async (req: Request, res: Response) => {
      if (!aiResearch) {
        res.status(503).json({ error: "ai_research_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const config = await aiResearch.getConfig(req.user.id, tenantId);
      res.status(200).json(config);
    },
  );

  app.put(
    "/api/ai/research/config",
    authGuard,
    async (req: Request, res: Response) => {
      if (!aiResearch) {
        res.status(503).json({ error: "ai_research_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const parsed = aiResearchConfigRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "invalid_config", details: parsed.error.flatten() });
        return;
      }

      try {
        const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
        const result = await aiResearch.setConfig(
          req.user.id,
          parsed.data,
          tenantId,
        );
        if (!result.ok) {
          res.status(400).json({ error: result.error });
          return;
        }
        res.status(200).json({ ok: true });
      } catch (error) {
        logger.error("ai_research_set_config_failed", error);
        res.status(500).json({ error: "internal_error" });
      }
    },
  );

  app.get(
    "/api/ai/research/status",
    authGuard,
    async (req: Request, res: Response) => {
      if (!aiResearch) {
        res.status(503).json({ error: "ai_research_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const status = await aiResearch.getStatus(req.user.id, tenantId);
      res.status(200).json(status);
    },
  );

  app.delete(
    "/api/ai/research/briefs/:id",
    authGuard,
    async (req: Request, res: Response) => {
      if (!aiResearch) {
        res.status(503).json({ error: "ai_research_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const briefId = req.params.id;
      if (!briefId) {
        res.status(400).json({ error: "missing_brief_id" });
        return;
      }

      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const ok = await aiResearch.dismissBrief(req.user.id, briefId, tenantId);
      res.status(200).json({ ok });
    },
  );

  app.post(
    "/api/ai/economic-calendar/insights",
    authGuard,
    async (req: Request, res: Response) => {
      const parsed = calendarInsightRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "invalid_request", details: parsed.error.flatten() });
        return;
      }

      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;

      const idempotencyHeader = req.header("x-idempotency-key");
      const idempotencyKey =
        typeof idempotencyHeader === "string" &&
        idempotencyHeader.trim().length > 0
          ? idempotencyHeader.trim()
          : undefined;

      try {
        const job = await aiQueue.enqueue(
          "ai.economic.insights",
          {
            tenantId,
            request: parsed.data,
          },
          {
            ...(idempotencyKey ? { idempotencyKey } : {}),
            maxAttempts: env.AI_QUEUE_RETRY_LIMIT,
          },
        );

        await refreshAiQueueMetrics();

        const waitTimeoutMs = Number(
          req.query.waitMs ?? env.AI_RESEARCH_WAIT_TIMEOUT_MS,
        );
        const settled = await aiQueue.waitFor(job.id, waitTimeoutMs);
        await refreshAiQueueMetrics();
        if (!settled) {
          const queuedPayload = aiJobEnqueueResponseSchema.parse({
            jobId: job.id,
            status: "queued",
          });
          res.status(202).json(queuedPayload);
          return;
        }

        if (settled.status === "completed") {
          const response = calendarInsightResponseSchema.parse(settled.result);
          res.status(200).json(response);
          return;
        }

        if (settled.status === "cancelled") {
          res
            .status(409)
            .json({ error: "economic_insights_cancelled", jobId: settled.id });
          return;
        }

        res.status(502).json({
          error: settled.error ?? "economic_insights_failed",
          jobId: settled.id,
        });
      } catch (error) {
        logger.error("ai_economic_insights_failed", {
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res.status(502).json({ error: "economic_insights_failed" });
      }
    },
  );

  // Congress Activity AI endpoints
  app.post(
    "/api/ai/congress/analyze",
    authGuard,
    async (req: Request, res: Response) => {
      if (!aiCongress) {
        res.status(503).json({ error: "ai_congress_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const { tradeId, tradeData, model } = req.body as {
        tradeId: string;
        tradeData: {
          member: string;
          ticker: string;
          side: string;
          amount: string;
          date: string;
        };
        model?: string;
      };

      if (!tradeId || !tradeData) {
        res.status(400).json({ error: "missing_required_fields" });
        return;
      }

      const idempotencyHeader = req.header("x-idempotency-key");
      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const idempotencyKey =
        typeof idempotencyHeader === "string" &&
        idempotencyHeader.trim().length > 0
          ? idempotencyHeader.trim()
          : undefined;

      try {
        const job = await aiQueue.enqueue(
          "ai.congress.analyze",
          {
            userId: req.user.id,
            tenantId,
            tradeId,
            tradeData,
            ...(model ? { model } : {}),
          },
          {
            ...(idempotencyKey ? { idempotencyKey } : {}),
            maxAttempts: env.AI_QUEUE_RETRY_LIMIT,
          },
        );

        await refreshAiQueueMetrics();

        const waitTimeoutMs = Number(
          req.query.waitMs ?? env.AI_RESEARCH_WAIT_TIMEOUT_MS,
        );
        const settled = await aiQueue.waitFor(job.id, waitTimeoutMs);
        await refreshAiQueueMetrics();
        if (!settled) {
          const queuedPayload = aiJobEnqueueResponseSchema.parse({
            jobId: job.id,
            status: "queued",
          });
          res.status(202).json(queuedPayload);
          return;
        }

        if (settled.status === "completed") {
          res
            .status(200)
            .json(settled.result ?? { ok: true, jobId: settled.id });
          return;
        }

        if (settled.status === "cancelled") {
          res
            .status(409)
            .json({ error: "ai_congress_cancelled", jobId: settled.id });
          return;
        }

        res.status(502).json({
          error: settled.error ?? "ai_congress_failed",
          jobId: settled.id,
          model,
        });
      } catch (error) {
        logger.error("ai_congress_analyze_failed", {
          error: error instanceof Error ? error.message : "unknown_error",
          tradeId,
        });
        res.status(502).json({ error: "ai_congress_failed" });
      }
    },
  );

  app.get(
    "/api/ai/congress/watchlist",
    authGuard,
    async (req: Request, res: Response) => {
      if (!aiCongress) {
        res.status(503).json({ error: "ai_congress_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const watchlist = await aiCongress.getWatchlist(req.user.id, tenantId);
      res.status(200).json({ ok: true, data: watchlist });
    },
  );

  app.post(
    "/api/ai/congress/watchlist",
    authGuard,
    async (req: Request, res: Response) => {
      if (!aiCongress) {
        res.status(503).json({ error: "ai_congress_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const { ticker, reason, priority } = req.body as {
        ticker: string;
        reason: string;
        priority?: number;
      };
      if (!ticker || !reason) {
        res.status(400).json({ error: "missing_ticker_or_reason" });
        return;
      }

      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const result = await aiCongress.addToWatchlist(
        req.user.id,
        ticker,
        reason,
        priority,
        tenantId,
      );
      res.status(200).json({ ok: true, data: result });
    },
  );

  app.delete(
    "/api/ai/congress/watchlist/:id",
    authGuard,
    async (req: Request, res: Response) => {
      if (!aiCongress) {
        res.status(503).json({ error: "ai_congress_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const watchlistIdStr = req.params.id;
      if (!watchlistIdStr) {
        res.status(400).json({ error: "missing_watchlist_id" });
        return;
      }

      const watchlistId = parseInt(watchlistIdStr, 10);
      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const ok = await aiCongress.dismissFromWatchlist(
        req.user.id,
        watchlistId,
        tenantId,
      );
      res.status(200).json({ ok });
    },
  );

  // Supply Chain Mind-Map endpoints
  app.post(
    "/api/ai/supplychain/generate",
    authGuard,
    async (req: Request, res: Response) => {
      if (!supplyChain) {
        res.status(503).json({ error: "supply_chain_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const { ticker, options, model } = req.body as {
        ticker: string;
        options?: {
          globalTickers?: string[];
          includeHypothesis?: boolean;
          hops?: number;
        };
        model?: string;
      };

      if (!ticker) {
        res.status(400).json({ error: "missing_ticker" });
        return;
      }

      const idempotencyHeader = req.header("x-idempotency-key");
      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const idempotencyKey =
        typeof idempotencyHeader === "string" &&
        idempotencyHeader.trim().length > 0
          ? idempotencyHeader.trim()
          : undefined;

      try {
        const job = await aiQueue.enqueue(
          "ai.supplychain.generate",
          {
            userId: req.user.id,
            tenantId,
            ticker,
            ...(options ? { options } : {}),
            ...(model ? { model } : {}),
          },
          {
            ...(idempotencyKey ? { idempotencyKey } : {}),
            maxAttempts: env.AI_QUEUE_RETRY_LIMIT,
          },
        );

        await refreshAiQueueMetrics();

        const waitTimeoutMs = Number(
          req.query.waitMs ?? env.AI_RESEARCH_WAIT_TIMEOUT_MS,
        );
        const settled = await aiQueue.waitFor(job.id, waitTimeoutMs);
        await refreshAiQueueMetrics();
        if (!settled) {
          const queuedPayload = aiJobEnqueueResponseSchema.parse({
            jobId: job.id,
            status: "queued",
          });
          res.status(202).json(queuedPayload);
          return;
        }

        if (settled.status === "completed") {
          res
            .status(200)
            .json(settled.result ?? { ok: true, jobId: settled.id });
          return;
        }

        if (settled.status === "cancelled") {
          res
            .status(409)
            .json({ error: "supply_chain_cancelled", jobId: settled.id });
          return;
        }

        res.status(502).json({
          error: settled.error ?? "supply_chain_failed",
          jobId: settled.id,
          model,
        });
      } catch (error) {
        logger.error("ai_supplychain_generate_failed", {
          error: error instanceof Error ? error.message : "unknown_error",
          ticker,
        });
        res.status(502).json({ error: "supply_chain_failed" });
      }
    },
  );

  app.get(
    "/api/ai/supplychain/cache/:cacheKey",
    authGuard,
    async (req: Request, res: Response) => {
      if (!supplyChain) {
        res.status(503).json({ error: "supply_chain_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const cacheKey = req.params.cacheKey;
      if (!cacheKey) {
        res.status(400).json({ error: "missing_cache_key" });
        return;
      }

      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const result = await supplyChain.getCachedMap(cacheKey, tenantId);
      res.status(result ? 200 : 404).json({ ok: !!result, data: result });
    },
  );

  app.get(
    "/api/ai/supplychain/insights/:ticker",
    authGuard,
    async (req: Request, res: Response) => {
      if (!supplyChain) {
        res.status(503).json({ error: "supply_chain_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const ticker = req.params.ticker;
      if (!ticker) {
        res.status(400).json({ error: "missing_ticker" });
        return;
      }

      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const insights = await supplyChain.getInsights(
        req.user.id,
        ticker,
        tenantId,
      );
      res.status(200).json({ ok: true, data: insights });
    },
  );

  app.get(
    "/api/ai/graph/sor/status",
    authGuard,
    async (req: Request, res: Response) => {
      if (!graphSor) {
        res.status(503).json({ error: "graph_sor_unavailable_no_database" });
        return;
      }

      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const cacheKey = `graph:sor:status:${tenantId}`;
      const cached = await infra.cache.getJson<unknown>(cacheKey);
      if (cached) {
        res.status(200).json(cached);
        return;
      }

      try {
        const status = await graphSor.getStatus(tenantId);
        const payload = graphSorStatusResponseSchema.parse({
          ok: true,
          status,
        });
        await infra.cache.setJson(cacheKey, payload, 30);
        res.status(200).json(payload);
      } catch (error) {
        const errorCode =
          error && typeof error === "object" && "code" in error
            ? String((error as { code?: unknown }).code ?? "")
            : "";

        if (errorCode === "42P01") {
          res.status(503).json({
            error: "graph_sor_schema_not_ready",
            message: "Run backend migration 028_supply_chain_graph_sor.sql",
          });
          return;
        }

        logger.error("graph_sor_status_failed", {
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res.status(500).json({ error: "graph_sor_status_failed" });
      }
    },
  );

  app.post(
    "/api/ai/graph/sor/facts",
    authGuard,
    async (req: Request, res: Response) => {
      if (!graphSor) {
        res.status(503).json({ error: "graph_sor_unavailable_no_database" });
        return;
      }

      const parsed = graphSorFactUpsertRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "invalid_request", details: parsed.error.flatten() });
        return;
      }

      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;

      try {
        const applied = await graphSor.upsertFact(parsed.data, tenantId);
        const payload = graphSorFactUpsertResponseSchema.parse({
          ok: true,
          applied,
        });
        res.status(200).json(payload);
      } catch (error) {
        const errorCode =
          error && typeof error === "object" && "code" in error
            ? String((error as { code?: unknown }).code ?? "")
            : "";

        if (errorCode === "42P01") {
          res.status(503).json({
            error: "graph_sor_schema_not_ready",
            message: "Run backend migration 028_supply_chain_graph_sor.sql",
          });
          return;
        }

        if (errorCode === "23505") {
          res.status(409).json({
            error: "graph_sor_conflict",
            message: "Duplicate relationship or provenance hash",
          });
          return;
        }

        logger.error("graph_sor_fact_upsert_failed", {
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res.status(500).json({ error: "graph_sor_fact_upsert_failed" });
      }
    },
  );

  app.post(
    "/api/ai/gwmd/sync/push",
    authGuard,
    async (req: Request, res: Response) => {
      if (!gwmdCloud) {
        res.status(503).json({ error: "gwmd_sync_unavailable_no_database" });
        return;
      }

      const parsed = gwmdSyncPushRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "invalid_request", details: parsed.error.flatten() });
        return;
      }

      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;

      try {
        const result = await gwmdCloud.pushSnapshot(
          {
            companies: parsed.data.companies,
            relationships: parsed.data.relationships,
            ...(parsed.data.replace !== undefined
              ? { replace: parsed.data.replace }
              : {}),
          },
          tenantId,
        );

        const payload = gwmdSyncPushResponseSchema.parse({
          ok: true,
          applied: result.applied,
          status: result.status,
        });

        const statusCacheKey = `gwmd:sync:status:${tenantId}`;
        await infra.cache.setJson(
          statusCacheKey,
          { ok: true, status: result.status },
          1,
        );

        res.status(200).json(payload);
      } catch (error) {
        logger.error("gwmd_sync_push_failed", {
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res.status(500).json({ error: "gwmd_sync_push_failed" });
      }
    },
  );

  app.get(
    "/api/ai/gwmd/sync/pull",
    authGuard,
    async (req: Request, res: Response) => {
      if (!gwmdCloud) {
        res.status(503).json({ error: "gwmd_sync_unavailable_no_database" });
        return;
      }

      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const since =
        typeof req.query.since === "string" && req.query.since.trim()
          ? req.query.since
          : undefined;
      const cacheKey = `gwmd:sync:pull:${tenantId}:${since ?? "full"}`;

      const cached = await infra.cache.getJson<unknown>(cacheKey);
      if (cached) {
        res.status(200).json(cached);
        return;
      }

      try {
        const result = await gwmdCloud.pullSnapshot(tenantId, since);
        const payload = gwmdSyncPullResponseSchema.parse({
          ok: true,
          data: {
            companies: result.companies,
            relationships: result.relationships,
          },
          status: result.status,
        });

        await infra.cache.setJson(cacheKey, payload, 300);
        res.status(200).json(payload);
      } catch (error) {
        logger.error("gwmd_sync_pull_failed", {
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res.status(500).json({ error: "gwmd_sync_pull_failed" });
      }
    },
  );

  app.get(
    "/api/ai/gwmd/sync/status",
    authGuard,
    async (req: Request, res: Response) => {
      if (!gwmdCloud) {
        res.status(503).json({ error: "gwmd_sync_unavailable_no_database" });
        return;
      }

      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const cacheKey = `gwmd:sync:status:${tenantId}`;
      const cached = await infra.cache.getJson<unknown>(cacheKey);
      if (cached) {
        res.status(200).json(cached);
        return;
      }

      try {
        const status = await gwmdCloud.getStatus(tenantId);
        const payload = gwmdSyncStatusResponseSchema.parse({
          ok: true,
          status,
        });
        await infra.cache.setJson(cacheKey, payload, 30);
        res.status(200).json(payload);
      } catch (error) {
        logger.error("gwmd_sync_status_failed", {
          error: error instanceof Error ? error.message : "unknown_error",
        });
        res.status(500).json({ error: "gwmd_sync_status_failed" });
      }
    },
  );

  // Central AI Orchestrator endpoints
  app.post(
    "/api/ai/orchestrator/track",
    authGuard,
    async (req: Request, res: Response) => {
      if (!aiOrchestrator) {
        res.status(503).json({ error: "orchestrator_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const { eventType, symbol, metadata } = req.body as {
        eventType: string;
        symbol?: string;
        metadata?: Record<string, unknown>;
      };

      if (!eventType) {
        res.status(400).json({ error: "missing_event_type" });
        return;
      }

      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      await aiOrchestrator.trackInteraction(
        req.user.id,
        eventType,
        symbol,
        metadata,
        tenantId,
      );
      res.status(200).json({ ok: true });
    },
  );

  app.get(
    "/api/ai/orchestrator/predictions",
    authGuard,
    async (req: Request, res: Response) => {
      if (!aiOrchestrator) {
        res.status(503).json({ error: "orchestrator_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const predictionType = req.query.type as string | undefined;
      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const cacheKey = `ai:orchestrator:predictions:${tenantId}:${req.user.id}:${predictionType ?? "all"}`;
      const cached = await infra.cache.getJson<{ ok: true; data: unknown }>(
        cacheKey,
      );
      if (cached) {
        res.status(200).json(cached);
        return;
      }
      const predictions = await aiOrchestrator.getPredictions(
        req.user.id,
        predictionType,
        tenantId,
      );
      const payload = { ok: true as const, data: predictions };
      await infra.cache.setJson(
        cacheKey,
        payload,
        env.CACHE_AI_PREDICTIONS_TTL_SECONDS,
      );
      res.status(200).json(payload);
    },
  );

  app.get(
    "/api/ai/orchestrator/stats",
    authGuard,
    async (req: Request, res: Response) => {
      if (!aiOrchestrator) {
        res.status(503).json({ error: "orchestrator_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const stats = await aiOrchestrator.getStats(req.user.id, tenantId);
      res.status(200).json({ ok: true, data: stats });
    },
  );

  app.post(
    "/api/ai/orchestrator/preload",
    authGuard,
    operatorOrAdminGuard,
    async (req: Request, res: Response) => {
      if (!aiOrchestrator) {
        res.status(503).json({ error: "orchestrator_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const result = await aiOrchestrator.preloadPredictions(
        req.user.id,
        tenantId,
      );
      res.status(result.ok ? 200 : 500).json(result);
    },
  );

  // AI Steward endpoints
  app.get(
    "/api/ai/steward/overview",
    authGuard,
    async (req: Request, res: Response) => {
      if (!aiSteward) {
        res.status(503).json({ error: "steward_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const overview = await aiSteward.getOverview(req.user.id, tenantId);
      res.status(200).json({ ok: true, data: overview });
    },
  );

  app.get(
    "/api/ai/steward/config",
    authGuard,
    async (req: Request, res: Response) => {
      if (!aiSteward) {
        res.status(503).json({ error: "steward_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const config = await aiSteward.getConfig(req.user.id, tenantId);
      res.status(200).json({ ok: true, data: config });
    },
  );

  app.get(
    "/api/ai/steward/health",
    authGuard,
    async (req: Request, res: Response) => {
      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const health = aiSteward
        ? await aiSteward.getHealthStatus(
            req.user.id,
            req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID,
          )
        : {
            generatedAt: new Date().toISOString(),
            overall: {
              state: "unavailable",
              severity: "critical",
              score: 0,
            },
            incidents: {
              totalOpen: 1,
              bySeverity: {
                info: 0,
                warning: 0,
                high: 0,
                critical: 1,
              },
              pendingTasks: 0,
            },
            runtime: {
              queueDepth: await aiQueue.getQueueDepth(),
              queueRunning: aiQueue.getRunningCount(),
              migrationFlags,
            },
            modules: [
              {
                module: "steward",
                state: "unavailable",
                severity: "critical",
                probableCause:
                  "Database-backed steward service is not configured",
                attemptedRepairs: [],
                owner: "admin",
              },
            ],
          };
      res.status(200).json({ ok: true, data: health });
    },
  );

  app.get(
    "/api/ai/steward/incident-digest",
    authGuard,
    async (req: Request, res: Response) => {
      if (!aiSteward) {
        res.status(503).json({ error: "steward_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const digest = await aiSteward.getIncidentDigest(req.user.id, tenantId);
      res.status(200).json({ ok: true, data: digest });
    },
  );

  app.post(
    "/api/ai/steward/check-health",
    authGuard,
    operatorOrAdminGuard,
    async (req: Request, res: Response) => {
      if (!aiSteward) {
        res.status(503).json({ error: "steward_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const result = await aiSteward.runHealthCheck(req.user.id, tenantId);
      res.status(result.ok ? 200 : 500).json(result);
    },
  );

  app.put(
    "/api/ai/steward/config",
    authGuard,
    operatorOrAdminGuard,
    async (req: Request, res: Response) => {
      if (!aiSteward) {
        res.status(503).json({ error: "steward_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const config = req.body;
      if (!config) {
        res.status(400).json({ error: "missing_config" });
        return;
      }

      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const result = await aiSteward.setConfig(req.user.id, config, tenantId);
      res.status(result.ok ? 200 : 500).json(result);
    },
  );

  app.post(
    "/api/ai/steward/run-module",
    authGuard,
    operatorOrAdminGuard,
    async (req: Request, res: Response) => {
      if (!aiSteward) {
        res.status(503).json({ error: "steward_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const { moduleName } = req.body as { moduleName: string };

      if (!moduleName) {
        res.status(400).json({ error: "missing_module_name" });
        return;
      }

      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const result = await aiSteward.runModule(
        req.user.id,
        moduleName,
        tenantId,
      );
      res.status(result.ok ? 200 : 500).json(result);
    },
  );

  app.get(
    "/api/ai/steward/findings",
    authGuard,
    async (req: Request, res: Response) => {
      if (!aiSteward) {
        res.status(503).json({ error: "steward_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const module = req.query.module as string | undefined;
      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const findings = await aiSteward.listFindings(
        req.user.id,
        module,
        tenantId,
      );
      res.status(200).json({ ok: true, data: findings });
    },
  );

  app.delete(
    "/api/ai/steward/findings/:id",
    authGuard,
    async (req: Request, res: Response) => {
      if (!aiSteward) {
        res.status(503).json({ error: "steward_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const findingId = req.params.id;
      if (!findingId) {
        res.status(400).json({ error: "missing_finding_id" });
        return;
      }

      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const ok = await aiSteward.dismissFinding(
        req.user.id,
        findingId,
        tenantId,
      );
      res.status(200).json({ ok });
    },
  );

  app.get(
    "/api/ai/steward/tasks",
    authGuard,
    async (req: Request, res: Response) => {
      if (!aiSteward) {
        res.status(503).json({ error: "steward_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const tasks = await aiSteward.listTasks(req.user.id, tenantId);
      res.status(200).json({ ok: true, data: tasks });
    },
  );

  app.post(
    "/api/ai/steward/tasks/:id/apply",
    authGuard,
    operatorOrAdminGuard,
    async (req: Request, res: Response) => {
      if (!aiSteward) {
        res.status(503).json({ error: "steward_unavailable_no_database" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const taskId = req.params.id;
      if (!taskId) {
        res.status(400).json({ error: "missing_task_id" });
        return;
      }

      const tenantId = req.tenantContext?.tenantId ?? env.DEFAULT_TENANT_ID;
      const result = await aiSteward.applyTask(req.user.id, taskId, tenantId);
      res.status(result.ok ? 200 : 500).json(result);
    },
  );

  // --- Settings: Ollama / AI provider info ---
  app.get(
    "/api/settings/ai-provider",
    authGuard,
    (_req: Request, res: Response) => {
      const hasKey = !!(env.OLLAMA_CLOUD_API_KEY ?? env.OLLAMA_API_KEY);
      const endpoint = env.OLLAMA_CLOUD_ENDPOINT;
      const isLocal =
        endpoint.includes("127.0.0.1") || endpoint.includes("localhost");
      res.status(200).json({
        endpoint,
        hasApiKey: hasKey,
        isLocalOllama: isLocal,
        defaultModel: env.OLLAMA_DEFAULT_MODEL,
        secondaryModel: env.OLLAMA_SECONDARY_MODEL ?? null,
        tertiaryModel: env.OLLAMA_TERTIARY_MODEL ?? null,
        researchModel: env.OLLAMA_RESEARCH_MODEL ?? null,
        supplyChainModel: env.OLLAMA_SUPPLY_CHAIN_MODEL ?? null,
        congressModel: env.OLLAMA_CONGRESS_MODEL ?? null,
      });
    },
  );

  app.get("/metrics", (req: Request, res: Response) => {
    const candidateAuth = req.headers.authorization;
    const bearer =
      typeof candidateAuth === "string" && candidateAuth.startsWith("Bearer ")
        ? candidateAuth.slice("Bearer ".length).trim()
        : null;
    const headerToken =
      typeof req.headers["x-metrics-token"] === "string"
        ? req.headers["x-metrics-token"].trim()
        : null;
    const token = bearer ?? headerToken;
    if (!env.METRICS_TOKEN || !token || token !== env.METRICS_TOKEN) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    res.status(200).json({
      ws: readWsMetrics(),
      infra: infra.meta,
      now: new Date().toISOString(),
    });
  });

  app.use((req: Request, res: Response) => {
    logger.warn("route_not_found", {
      method: req.method,
      url: req.originalUrl,
    });
    res.status(404).json({ error: "not_found" });
  });

  return app;
}

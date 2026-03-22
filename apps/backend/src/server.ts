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
  gwmdSyncPullResponseSchema,
  gwmdSyncPushRequestSchema,
  gwmdSyncPushResponseSchema,
  gwmdSyncStatusResponseSchema,
  healthResponseSchema,
  loginRequestSchema,
  loginResponseSchema,
  logoutRequestSchema,
  meResponseSchema,
  publicFlowEventsResponseSchema,
  refreshTokenRequestSchema,
  runtimeFlagsResponseSchema,
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
import { createAiOrchestratorService } from "./services/orchestrator/aiOrchestratorService.js";
import { createAiStewardService } from "./services/steward/aiStewardService.js";
import { createEconomicInsightsService } from "./services/economicCalendar/economicInsightsService.js";
import {
  applyTedLiveConfigPatch,
  fetchLiveTedSnapshot,
  getTedLiveConfigStatus,
} from "./services/tedIntel/tedIntelLive.js";
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

export function createServer(
  version: string,
  env: AppEnv,
  readWsMetrics: WebSocketMetricsReader,
  infra: BackendInfra,
) {
  const app = express();
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
  const aiOrchestrator = infra.pool
    ? createAiOrchestratorService(infra.pool, env)
    : null;
  const aiSteward = infra.pool ? createAiStewardService(infra.pool, env) : null;
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

  app.use(cors({ origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN }));
  app.use(express.json({ limit: "1mb" }));
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

  app.get("/metrics/prometheus", async (_req: Request, res: Response) => {
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

  app.post("/api/auth/signup", async (req: Request, res: Response) => {
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
    const user = await auth.validateUserCredentials(
      identifier,
      parsed.data.password,
      parsed.data.licenseKey,
    );
    if (!user) {
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }

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
      if (!Number.isFinite(themeId) || themeId <= 0) {
        res.status(400).json({ error: "invalid_theme_id" });
        return;
      }
      res.status(200).json({ items: getWatchlistCandidates(themeId) });
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

      if (!tedLiveConfig.enabled || !tedLiveConfig.baseUrl) {
        res.status(503).json({
          error:
            "TED live feed is not configured. Add the TED endpoint and API key in Settings or API Hub.",
        });
        return;
      }

      const liveSnapshot = await fetchLiveTedSnapshot(tedLiveConfig, window);
      if (liveSnapshot) {
        res.status(200).json(liveSnapshot);
        return;
      }

      res.status(502).json({
        error:
          "TED live feed request failed. Check the TED endpoint, API key, and auth header in Settings or API Hub.",
      });
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

  app.get("/metrics", (_req: Request, res: Response) => {
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

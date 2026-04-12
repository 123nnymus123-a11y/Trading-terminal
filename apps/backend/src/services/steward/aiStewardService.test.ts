import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createInfra } from "../../infra.js";
import type { AppEnv } from "../../config.js";
import { createAiStewardService } from "./aiStewardService.js";

function testEnv(): AppEnv {
  return {
    NODE_ENV: "test",
    PORT: 0,
    CORS_ORIGIN: "*",
    JWT_SECRET: "test-secret-very-strong",
    JWT_EXPIRES_SECONDS: 3600,
    JWT_REFRESH_EXPIRES_SECONDS: 86400,
    AUTH_BOOTSTRAP_EMAIL: "demo@tradingcockpit.dev",
    AUTH_BOOTSTRAP_USERNAME: "demo",
    AUTH_BOOTSTRAP_PASSWORD: "ChangeMe123!",
    AUTH_BOOTSTRAP_LICENSE_KEY: "TC-DEMO-STARTER",
    AUTH_EMAIL_ENABLED: false,
    AUTH_EMAIL_SMTP_SECURE: false,
    AUTH_EMAIL_VERIFY_BASE_URL: "http://localhost:5173/auth/verify",
    AUTH_ACCESS_TOKEN_TTL_SECONDS: 900,
    AUTH_REFRESH_TOKEN_TTL_SECONDS: 1209600,
    AUTH_REQUIRE_2FA_FOR_ROLES: ["admin", "operator"],
    AUTH_SESSION_STORE_ENABLED: false,
    AUTH_REFRESH_ROTATION_ENABLED: false,
    AUTH_RBAC_ENFORCED: false,
    AUTH_TOTP_REQUIRED: false,
    WS_REVOCATION_CHECKS_ENABLED: false,
    IPC_STRICT_ALLOWLIST_ENABLED: false,
    WS_BATCH_INTERVAL_MS: 100,
    WS_QUEUE_LIMIT: 200,
    RATE_LIMIT_WINDOW_SECONDS: 60,
    RATE_LIMIT_MAX_REQUESTS: 240,
    AUTH_LOGIN_WINDOW_SECONDS: 900,
    AUTH_LOGIN_MAX_ATTEMPTS: 5,
    AUTH_LOGIN_LOCKOUT_SECONDS: 900,
    AUTH_SIGNUP_WINDOW_SECONDS: 900,
    AUTH_SIGNUP_MAX_ATTEMPTS_PER_IP: 20,
    AI_RATE_LIMIT_WINDOW_SECONDS: 60,
    AI_RATE_LIMIT_MAX_REQUESTS: 60,
    CACHE_PUBLICFLOW_TTL_SECONDS: 30,
    CACHE_CONGRESS_TRADES_TTL_SECONDS: 30,
    CACHE_AI_BRIEFS_TTL_SECONDS: 20,
    CACHE_AI_PREDICTIONS_TTL_SECONDS: 20,
    DEFAULT_TENANT_ID: "default",
    MIGRATION_BACKEND_ONLY_PROCESSING: false,
    MIGRATION_DESKTOP_LOCAL_FALLBACK: true,
    MIGRATION_WEB_PRIMARY_ROUTING: false,
    MIGRATION_REQUIRE_TENANT_HEADER: false,
    AI_QUEUE_CONCURRENCY: 2,
    AI_QUEUE_MAX: 50,
    AI_QUEUE_RETRY_LIMIT: 2,
    AI_QUEUE_JOB_TTL_SECONDS: 3600,
    AI_RESEARCH_WAIT_TIMEOUT_MS: 45000,
    OLLAMA_CLOUD_ENDPOINT: "https://ollama.com/api",
    OLLAMA_DEFAULT_MODEL: "llama3.1:70b",
    OLLAMA_REQUEST_TIMEOUT_MS: 60000,
    TED_LIVE_ENABLED: false,
    TED_LIVE_AUTH_HEADER: "x-api-key",
    TED_LIVE_TIMEOUT_MS: 12000,
    TED_LIVE_WINDOW_QUERY_PARAM: "window",
    EDGAR_USER_AGENT: "TradingTerminal-Test/0.0.1 test@tradingcockpit.dev",
    EDGAR_WATCHER_ENABLED: false,
    EDGAR_WATCHER_INTERVAL_SECONDS: 300,
    EDGAR_WATCHER_CIKS: "",
    EDGAR_WATCHER_BACKFILL_DAYS: 90,
  };
}

describe("ai steward service", () => {
  const env = testEnv();
  const tenantId = "default";
  let userId = "";

  beforeEach(() => {
    userId = `test-steward-${randomUUID()}`;
  });

  it("auto-applies safe tasks when autoApply is enabled", async () => {
    const infra = await createInfra(env);
    try {
      if (!infra.pool) {
        return;
      }

      await infra.pool.query(
        "INSERT INTO users (id, tenant_id, email, username) VALUES ($1, $2, $3, $4)",
        [userId, tenantId, `${userId}@example.test`, userId],
      );

      const steward = createAiStewardService(infra.pool, env);
      await steward.setConfig(
        userId,
        {
          enabled: true,
          autoApply: true,
          modulesEnabled: { cftc: true, congress: true, contracts: false },
          checkIntervalSec: 600,
        },
        tenantId,
      );

      const run = await steward.runModule(userId, "cftc", tenantId);
      expect(run.ok).toBe(true);

      const tasks = (await steward.listTasks(userId, tenantId)) as unknown[];
      expect(Array.isArray(tasks)).toBe(true);
      expect(tasks.length).toBe(0);
    } finally {
      await infra.close();
    }
  });

  it("honors module enablement when running health checks", async () => {
    const infra = await createInfra(env);
    try {
      if (!infra.pool) {
        return;
      }

      await infra.pool.query(
        "INSERT INTO users (id, tenant_id, email, username) VALUES ($1, $2, $3, $4)",
        [userId, tenantId, `${userId}@example.test`, userId],
      );

      const steward = createAiStewardService(infra.pool, env);
      await steward.setConfig(
        userId,
        {
          enabled: true,
          autoApply: false,
          modulesEnabled: { cftc: false, congress: true, contracts: false },
          checkIntervalSec: 600,
        },
        tenantId,
      );

      const result = await steward.runHealthCheck(userId, tenantId);
      expect(result.ok).toBe(true);

      const findings = (await steward.listFindings(
        userId,
        undefined,
        tenantId,
      )) as Array<{ module?: string }>;
      expect(findings.every((finding) => finding.module === "congress")).toBe(
        true,
      );
    } finally {
      await infra.close();
    }
  });

  it("returns normalized incident digest summary and incident records", async () => {
    const infra = await createInfra(env);
    try {
      if (!infra.pool) {
        return;
      }

      await infra.pool.query(
        "INSERT INTO users (id, tenant_id, email, username) VALUES ($1, $2, $3, $4)",
        [userId, tenantId, `${userId}@example.test`, userId],
      );

      const steward = createAiStewardService(infra.pool, env);
      await steward.setConfig(
        userId,
        {
          enabled: true,
          autoApply: false,
          modulesEnabled: { cftc: true, congress: true, contracts: false },
          checkIntervalSec: 600,
        },
        tenantId,
      );

      await steward.runModule(userId, "cftc", tenantId);
      await steward.runModule(userId, "congress", tenantId);

      const digest = await steward.getIncidentDigest(userId, tenantId);
      expect(digest.summary.totalOpenIncidents).toBeGreaterThanOrEqual(2);
      expect(digest.summary.criticalOpenIncidents).toBe(0);
      expect(digest.summary.incidentsLast24h).toBeGreaterThanOrEqual(2);
      expect(Array.isArray(digest.topIncidents)).toBe(true);
      expect(digest.topIncidents[0]).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          title: expect.any(String),
          severity: expect.any(String),
          category: expect.any(String),
          module: expect.any(String),
          detectedAt: expect.any(String),
          status: "open",
        }),
      );
    } finally {
      await infra.close();
    }
  });
});

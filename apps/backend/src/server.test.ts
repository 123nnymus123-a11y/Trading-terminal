import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer as createHttpServer, type Server } from "node:http";
import request from "supertest";
import { WebSocket } from "ws";
import { createServer } from "./server.js";
import type { AppEnv } from "./config.js";
import { createAuthService } from "./auth.js";
import { attachWebSocket } from "./wsHub.js";
import { createInfra } from "./infra.js";

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
  };
}

describe("backend auth + ws", () => {
  const env = testEnv();
  const auth = createAuthService(env);
  let app!: ReturnType<typeof createServer>;
  let closeInfra: (() => Promise<void>) | null = null;

  let wsServer: Server;
  let wsPort = 0;

  beforeAll(async () => {
    const infra = await createInfra(env);
    closeInfra = infra.close;
    app = createServer(
      "test",
      env,
      () => ({
        connectedClients: 0,
        totalMessagesDropped: 0,
        totalMessagesSent: 0,
      }),
      infra,
    );

    wsServer = createHttpServer((_req, res) => {
      res.statusCode = 200;
      res.end("ok");
    });
    attachWebSocket(wsServer, auth.verifyAccessToken, env);

    await new Promise<void>((resolve) => {
      wsServer.listen(0, "127.0.0.1", () => {
        const address = wsServer.address();
        if (address && typeof address === "object") {
          wsPort = address.port;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (closeInfra) {
      await closeInfra();
    }
    await new Promise<void>((resolve, reject) => {
      wsServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });

  it("supports login + me + refresh", async () => {
    // When no DATABASE_URL is configured the backend uses an in-memory store,
    // so signup with a valid license key succeeds (201) rather than 503.
    const signupResult = await request(app).post("/api/auth/signup").send({
      email: "new-user@tradingcockpit.dev",
      username: "newuser",
      password: "ChangeMe123!",
      licenseKey: env.AUTH_BOOTSTRAP_LICENSE_KEY,
    });
    expect(signupResult.status).toBe(201);

    // Signup with an invalid license key should be rejected (400).
    const signupBadKey = await request(app).post("/api/auth/signup").send({
      email: "bad-key@tradingcockpit.dev",
      username: "badkeyuser",
      password: "ChangeMe123!",
      licenseKey: "INVALID-KEY-XYZ",
    });
    expect(signupBadKey.status).toBe(400);
    expect(signupBadKey.body.error).toBe("invalid_license_key");

    const login = await request(app).post("/api/auth/login").send({
      email: env.AUTH_BOOTSTRAP_EMAIL,
      password: env.AUTH_BOOTSTRAP_PASSWORD,
      licenseKey: env.AUTH_BOOTSTRAP_LICENSE_KEY,
    });

    expect(login.status).toBe(200);
    expect(login.body.token).toEqual(expect.any(String));
    expect(login.body.refreshToken).toEqual(expect.any(String));
    expect(Array.isArray(login.body.user.roles)).toBe(true);

    const accessVerified = auth.verifyAccessTokenDetailed(login.body.token);
    expect(accessVerified?.claims.sid).toEqual(expect.any(String));
    expect(accessVerified?.claims.jti).toEqual(expect.any(String));
    expect(accessVerified?.claims.type).toBe("access");

    const me = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${login.body.token}`);

    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(env.AUTH_BOOTSTRAP_EMAIL);

    const refresh = await request(app).post("/api/auth/refresh").send({
      refreshToken: login.body.refreshToken,
    });

    expect(refresh.status).toBe(200);
    expect(refresh.body.token).toEqual(expect.any(String));

    const logout = await request(app)
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${refresh.body.token}`)
      .send({ allSessions: false });

    expect(logout.status).toBe(200);
    expect(logout.body.ok).toBe(true);

    const setup2fa = await request(app)
      .post("/api/auth/2fa/setup")
      .set("Authorization", `Bearer ${login.body.token}`)
      .send({});
    expect(setup2fa.status).toBe(503);
  });

  it("streams market.batch after authenticated subscribe", async () => {
    const tokenPair = auth.issueTokenPair({
      id: "user-test",
      email: env.AUTH_BOOTSTRAP_EMAIL,
      username: env.AUTH_BOOTSTRAP_USERNAME,
      tier: "starter",
      roles: ["viewer"],
      licenseKey: env.AUTH_BOOTSTRAP_LICENSE_KEY,
    });

    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}/ws`, [
      "Bearer",
      tokenPair.token,
    ]);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("timed_out_waiting_for_market_batch"));
      }, 3000);

      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "subscribe", symbols: ["AAPL"] }));
      });

      ws.on("message", (raw) => {
        const payload = JSON.parse(String(raw));
        if (payload?.type === "market.batch") {
          clearTimeout(timeout);
          expect(Array.isArray(payload.quotes)).toBe(true);
          expect(payload.quotes.length).toBeGreaterThan(0);
          ws.close();
          resolve();
        }
      });

      ws.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  });

  it("enforces RBAC when enabled for steward mutation routes", async () => {
    const strictEnv: AppEnv = {
      ...env,
      AUTH_RBAC_ENFORCED: true,
    };
    const infra = await createInfra(strictEnv);
    try {
      const strictApp = createServer(
        "test",
        strictEnv,
        () => ({
          connectedClients: 0,
          totalMessagesDropped: 0,
          totalMessagesSent: 0,
        }),
        infra,
      );

      const viewerTokenPair = auth.issueTokenPair({
        id: "user-viewer",
        email: env.AUTH_BOOTSTRAP_EMAIL,
        username: env.AUTH_BOOTSTRAP_USERNAME,
        tier: "starter",
        roles: ["viewer"],
        licenseKey: env.AUTH_BOOTSTRAP_LICENSE_KEY,
      });

      const response = await request(strictApp)
        .post("/api/ai/steward/run-module")
        .set("Authorization", `Bearer ${viewerTokenPair.token}`)
        .send({ moduleName: "compliance" });

      expect(response.status).toBe(403);
    } finally {
      await infra.close();
    }
  });
});

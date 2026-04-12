/**
 * Backend API Client for Desktop App
 * Provides centralized API access to all backend AI services
 */

import type {
  CongressContractsResponse,
  CongressDisclosureLagResponse,
  CongressLobbyingResponse,
  CongressMembersResponse,
  CongressMostTradedResponse,
  CongressQueryTradesResponse,
  GwmdCloudCompany,
  GwmdCloudRelationship,
  GwmdSyncPullResponse,
  GwmdSyncPushResponse,
  GwmdSyncStatusResponse,
  PublicFlowCandidatesResponse,
  PublicFlowRecentResponse,
  PublicFlowRefreshResponse,
  PublicFlowThemesResponse,
  PublicFlowValuationsResponse,
} from "@tc/api";
import type { TedIntelSnapshot, TedIntelTimeWindow } from "@tc/shared";
import http from "node:http";
import https from "node:https";
import type { AiStewardIncidentDigest } from "./aiSteward";

export interface ApiClientConfig {
  baseUrl: string;
  getAuthToken: () => Promise<string | null>;
  getTenantId?: () => Promise<string | null>;
  requestTimeoutMs?: number;
}

export type TedLiveConfigStatus = {
  enabled: boolean;
  baseUrl: string;
  hasApiKey: boolean;
  authHeader: string;
  timeoutMs: number;
  windowQueryParam: string;
};

export type TedLiveConfigUpdate = {
  enabled?: boolean;
  baseUrl?: string;
  apiKey?: string;
  authHeader?: string;
  timeoutMs?: number;
  windowQueryParam?: string;
};

type PublicFlowCandidateQuery = {
  minPriority?: "critical" | "high" | "medium" | "low";
  minConfidence?: number;
};

export class BackendApiClient {
  private baseUrl: string;
  private getAuthToken: () => Promise<string | null>;
  private getTenantId: (() => Promise<string | null>) | undefined;
  private requestTimeoutMs: number;
  private directAuthToken: string | null = null;
  private directTenantId: string | null = null;
  private static readonly keepAliveHttpAgent = new http.Agent({
    keepAlive: true,
    maxSockets: 16,
    maxFreeSockets: 8,
    keepAliveMsecs: 15_000,
  });
  private static readonly keepAliveHttpsAgent = new https.Agent({
    keepAlive: true,
    maxSockets: 16,
    maxFreeSockets: 8,
    keepAliveMsecs: 15_000,
  });

  constructor(config: ApiClientConfig) {
    this.baseUrl = config.baseUrl;
    this.getAuthToken = config.getAuthToken;
    this.getTenantId = config.getTenantId;
    this.requestTimeoutMs = config.requestTimeoutMs ?? 30_000;
  }

  setAuthToken(token: string | null): void {
    this.directAuthToken = token;
  }

  setTenantId(tenantId: string | null): void {
    this.directTenantId = tenantId;
  }

  private async fetch<T>(
    endpoint: string,
    options: RequestInit & { method?: "GET" | "POST" | "PUT" | "DELETE" } = {},
  ): Promise<T> {
    // Use direct token if set, otherwise get from callback
    let token = this.directAuthToken;
    if (!token) {
      token = await this.getAuthToken();
    }

    if (!token) {
      throw new Error("No authentication token available");
    }

    let tenantId = this.directTenantId;
    if (!tenantId && this.getTenantId) {
      tenantId = await this.getTenantId();
    }
    if (!tenantId || !tenantId.trim()) {
      tenantId = "default";
    }

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(tenantId ? { "x-tenant-id": tenantId } : {}),
      ...options.headers,
    };

    const url = `${this.baseUrl}${endpoint}`;
    const requestUrl = new URL(url);
    const method = options.method ?? "GET";
    const payload =
      typeof options.body === "string"
        ? options.body
        : options.body === undefined
          ? undefined
          : JSON.stringify(options.body as unknown);

    const normalizedHeaders = normalizeHeaders(headers);
    if (
      payload !== undefined &&
      normalizedHeaders["content-length"] === undefined
    ) {
      normalizedHeaders["content-length"] = String(Buffer.byteLength(payload));
    }
    if (normalizedHeaders.connection === undefined) {
      normalizedHeaders.connection = "keep-alive";
    }

    const transport = requestUrl.protocol === "https:" ? https : http;
    const agent =
      requestUrl.protocol === "https:"
        ? BackendApiClient.keepAliveHttpsAgent
        : BackendApiClient.keepAliveHttpAgent;

    try {
      const responseText = await new Promise<string>((resolve, reject) => {
        const req = transport.request(
          requestUrl,
          {
            method,
            headers: normalizedHeaders,
            agent,
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk: Buffer | string) => {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            });
            res.on("end", () => {
              const bodyText = Buffer.concat(chunks).toString("utf8");
              const status = res.statusCode ?? 500;
              if (status < 200 || status >= 300) {
                const parsedError = safeParseJson<{ error?: string }>(bodyText);
                reject(new Error(parsedError?.error || `API error: ${status}`));
                return;
              }
              resolve(bodyText);
            });
          },
        );

        req.setTimeout(this.requestTimeoutMs, () => {
          req.destroy(
            new Error(
              `Request timeout after ${this.requestTimeoutMs}ms: ${endpoint}`,
            ),
          );
        });

        let abortListener: (() => void) | undefined;
        if (options.signal) {
          if (options.signal.aborted) {
            req.destroy(new Error(`Request aborted: ${endpoint}`));
          } else {
            abortListener = () =>
              req.destroy(new Error(`Request aborted: ${endpoint}`));
            options.signal.addEventListener("abort", abortListener, {
              once: true,
            });
          }
        }

        req.on("error", (error) => {
          reject(error);
        });

        req.on("close", () => {
          if (abortListener && options.signal) {
            options.signal.removeEventListener("abort", abortListener);
          }
        });

        if (payload !== undefined) {
          req.write(payload);
        }
        req.end();
      });

      const parsed = safeParseJson<T>(responseText);
      if (parsed === null) {
        throw new Error(`invalid_json_response:${endpoint}`);
      }
      return parsed;
    } catch (error) {
      throw error;
    }
  }

  // AI Research endpoints
  async researchGetConfig() {
    return this.fetch("/api/ai/research/config", { method: "GET" });
  }

  async researchSetConfig(config: unknown) {
    return this.fetch("/api/ai/research/config", {
      method: "PUT",
      body: JSON.stringify({ config }),
    });
  }

  async researchRun(manualItems?: Array<{ title: string; text: string }>) {
    return this.fetch("/api/ai/research/run", {
      method: "POST",
      body: JSON.stringify({ manualItems }),
    });
  }

  async aiGetJob(jobId: string) {
    return this.fetch(`/api/ai/jobs/${jobId}`, { method: "GET" });
  }

  async aiCancelJob(jobId: string) {
    return this.fetch(`/api/ai/jobs/${jobId}/cancel`, { method: "POST" });
  }

  async getRuntimeFlags() {
    return this.fetch("/api/runtime/flags", { method: "GET" });
  }

  async researchGetBriefs(limit?: number) {
    const url = `/api/ai/research/briefs${limit ? `?limit=${limit}` : ""}`;
    return this.fetch(url, { method: "GET" });
  }

  async researchGetStatus() {
    return this.fetch("/api/ai/research/status", { method: "GET" });
  }

  async researchDismissBrief(briefId: string) {
    return this.fetch(`/api/ai/research/briefs/${briefId}`, {
      method: "DELETE",
    });
  }

  // Congress Activity endpoints
  async congressAnalyzeTrade(
    tradeId: string,
    tradeData: Record<string, unknown>,
    model?: string,
  ) {
    return this.fetch("/api/ai/congress/analyze", {
      method: "POST",
      body: JSON.stringify({ tradeId, tradeData, model }),
    });
  }

  async congressGetWatchlist() {
    return this.fetch("/api/ai/congress/watchlist", { method: "GET" });
  }

  async congressAddToWatchlist(
    ticker: string,
    reason: string,
    priority?: number,
  ) {
    return this.fetch("/api/ai/congress/watchlist", {
      method: "POST",
      body: JSON.stringify({ ticker, reason, priority }),
    });
  }

  async congressDismissFromWatchlist(watchlistId: number) {
    return this.fetch(`/api/ai/congress/watchlist/${watchlistId}`, {
      method: "DELETE",
    });
  }

  // Supply Chain endpoints
  async supplyChainGenerateMap(
    ticker: string,
    options?: {
      globalTickers?: string[];
      includeHypothesis?: boolean;
      hops?: number;
    },
    model?: string,
  ) {
    return this.fetch("/api/ai/supplychain/generate", {
      method: "POST",
      body: JSON.stringify({ ticker, options, model }),
    });
  }

  async supplyChainGetCachedMap(cacheKey: string) {
    return this.fetch(`/api/ai/supplychain/cache/${cacheKey}`, {
      method: "GET",
    });
  }

  async supplyChainGetInsights(ticker: string) {
    return this.fetch(`/api/ai/supplychain/insights/${ticker}`, {
      method: "GET",
    });
  }

  async gwmdPushSync(payload: {
    companies: GwmdCloudCompany[];
    relationships: GwmdCloudRelationship[];
    replace?: boolean;
  }) {
    return this.fetch<GwmdSyncPushResponse>("/api/ai/gwmd/sync/push", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async gwmdPullSync(since?: string) {
    const endpoint = since
      ? `/api/ai/gwmd/sync/pull?since=${encodeURIComponent(since)}`
      : "/api/ai/gwmd/sync/pull";
    return this.fetch<GwmdSyncPullResponse>(endpoint, { method: "GET" });
  }

  async gwmdGetSyncStatus() {
    return this.fetch<GwmdSyncStatusResponse>("/api/ai/gwmd/sync/status", {
      method: "GET",
    });
  }

  async economicCalendarGetInsights(request: unknown) {
    return this.fetch("/api/ai/economic-calendar/insights", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  // Orchestrator endpoints
  async orchestratorTrackInteraction(
    eventType: string,
    symbol?: string,
    metadata?: Record<string, unknown>,
  ) {
    return this.fetch("/api/ai/orchestrator/track", {
      method: "POST",
      body: JSON.stringify({ eventType, symbol, metadata }),
    });
  }

  async orchestratorGetPredictions(predictionType?: string) {
    const url = `/api/ai/orchestrator/predictions${predictionType ? `?type=${predictionType}` : ""}`;
    return this.fetch(url, { method: "GET" });
  }

  async orchestratorGetStats() {
    return this.fetch("/api/ai/orchestrator/stats", { method: "GET" });
  }

  async orchestratorPreloadPredictions() {
    return this.fetch("/api/ai/orchestrator/preload", { method: "POST" });
  }

  // Steward endpoints
  async stewardGetOverview() {
    return this.fetch("/api/ai/steward/overview", { method: "GET" });
  }

  async stewardGetConfig() {
    return this.fetch("/api/ai/steward/config", { method: "GET" });
  }

  async stewardGetHealth() {
    return this.fetch("/api/ai/steward/health", { method: "GET" });
  }
  async stewardGetIncidentDigest(): Promise<AiStewardIncidentDigest> {
    return this.fetch("/api/ai/steward/incident-digest", { method: "GET" });
  }

  async stewardCheckHealth() {
    return this.fetch("/api/ai/steward/check-health", { method: "POST" });
  }

  async stewardSetConfig(config: unknown) {
    return this.fetch("/api/ai/steward/config", {
      method: "PUT",
      body: JSON.stringify(config),
    });
  }

  async stewardRunModule(moduleName: string) {
    return this.fetch("/api/ai/steward/run-module", {
      method: "POST",
      body: JSON.stringify({ moduleName }),
    });
  }

  async stewardGetFindings(module?: string) {
    const url = `/api/ai/steward/findings${module ? `?module=${module}` : ""}`;
    return this.fetch(url, { method: "GET" });
  }

  async stewardDismissFinding(findingId: string) {
    return this.fetch(`/api/ai/steward/findings/${findingId}`, {
      method: "DELETE",
    });
  }

  async stewardGetTasks() {
    return this.fetch("/api/ai/steward/tasks", { method: "GET" });
  }

  async stewardApplyTask(taskId: string) {
    return this.fetch(`/api/ai/steward/tasks/${taskId}/apply`, {
      method: "POST",
    });
  }

  // User settings and watchlists endpoints
  async userGetSettings() {
    return this.fetch<{ settings: Record<string, unknown> }>(
      "/api/user/settings",
      {
        method: "GET",
      },
    );
  }

  async userUpdateSettings(next: Record<string, unknown>) {
    return this.fetch<{ settings: Record<string, unknown> }>(
      "/api/user/settings",
      {
        method: "PUT",
        body: JSON.stringify(next),
      },
    );
  }

  async userListWatchlists() {
    return this.fetch<{ items: Array<Record<string, unknown>> }>(
      "/api/user/watchlists",
      {
        method: "GET",
      },
    );
  }

  async userAddWatchlist(symbol: string, note?: string) {
    return this.fetch<Record<string, unknown>>("/api/user/watchlists", {
      method: "POST",
      body: JSON.stringify({ symbol, note: note ?? "" }),
    });
  }

  async userUpdateWatchlist(
    id: number,
    fields: { symbol?: string; note?: string },
  ) {
    return this.fetch<Record<string, unknown>>(`/api/user/watchlists/${id}`, {
      method: "PUT",
      body: JSON.stringify(fields),
    });
  }

  async userRemoveWatchlist(id: number) {
    return this.fetch<{ ok: boolean }>(`/api/user/watchlists/${id}`, {
      method: "DELETE",
    });
  }

  // Congress and Public Flow data endpoints
  async congressQueryTrades(filters?: Record<string, unknown>) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(filters ?? {})) {
      if (value !== undefined && value !== null && value !== "") {
        search.set(key, String(value));
      }
    }
    const query = search.toString();
    const endpoint = `/api/congress/query-trades${query ? `?${query}` : ""}`;
    return this.fetch<CongressQueryTradesResponse>(endpoint, { method: "GET" });
  }

  async publicFlowGetRecent(limit: number = 50) {
    return this.fetch<PublicFlowRecentResponse>(
      `/api/publicflow/recent?limit=${limit}`,
      { method: "GET" },
    );
  }

  async publicFlowGetThemes(windowDays: 7 | 30, limit: number = 10) {
    return this.fetch<PublicFlowThemesResponse>(
      `/api/publicflow/themes?windowDays=${windowDays}&limit=${limit}`,
      { method: "GET" },
    );
  }

  async publicFlowGetCandidates(
    themeId: number,
    options?: PublicFlowCandidateQuery,
  ) {
    const search = new URLSearchParams({ themeId: String(themeId) });
    if (options?.minPriority) {
      search.set("minPriority", options.minPriority);
    }
    if (typeof options?.minConfidence === "number") {
      search.set("minConfidence", String(options.minConfidence));
    }
    return this.fetch<PublicFlowCandidatesResponse>(
      `/api/publicflow/candidates?${search.toString()}`,
      { method: "GET" },
    );
  }

  async publicFlowGetValuations(tickers: string[]) {
    return this.fetch<PublicFlowValuationsResponse>(
      `/api/publicflow/valuations`,
      {
        method: "POST",
        body: JSON.stringify({ tickers }),
      },
    );
  }

  async publicFlowRefresh() {
    return this.fetch<PublicFlowRefreshResponse>(`/api/publicflow/refresh`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  async tedIntelGetSnapshot(windowDays: TedIntelTimeWindow = "90d") {
    return this.fetch<TedIntelSnapshot>(
      `/api/tedintel/snapshot?window=${encodeURIComponent(windowDays)}`,
      { method: "GET" },
    );
  }

  async tedIntelGetConfig() {
    return this.fetch<TedLiveConfigStatus>(`/api/tedintel/config`, {
      method: "GET",
    });
  }

  async tedIntelSetConfig(next: TedLiveConfigUpdate) {
    return this.fetch<TedLiveConfigStatus>(`/api/tedintel/config`, {
      method: "PUT",
      body: JSON.stringify(next),
    });
  }

  async congressQueryMembers(limit: number = 100) {
    return this.fetch<CongressMembersResponse>(
      `/api/congress/members?limit=${limit}`,
      { method: "GET" },
    );
  }

  async congressQueryLobbying(limit: number = 100) {
    return this.fetch<CongressLobbyingResponse>(
      `/api/congress/lobbying?limit=${limit}`,
      { method: "GET" },
    );
  }

  async congressQueryContracts(limit: number = 100) {
    return this.fetch<CongressContractsResponse>(
      `/api/congress/contracts?limit=${limit}`,
      { method: "GET" },
    );
  }

  async congressGetMostTradedTickers(limit: number = 10) {
    return this.fetch<CongressMostTradedResponse>(
      `/api/congress/most-traded?limit=${limit}`,
      { method: "GET" },
    );
  }

  async congressGetDisclosureLagStats() {
    return this.fetch<CongressDisclosureLagResponse>(
      `/api/congress/disclosure-lag`,
      {
        method: "GET",
      },
    );
  }
}

function safeParseJson<T>(bodyText: string): T | null {
  if (!bodyText.trim()) {
    return null;
  }
  try {
    return JSON.parse(bodyText) as T;
  } catch {
    return null;
  }
}

function normalizeHeaders(
  headers: HeadersInit | undefined,
): Record<string, string> {
  if (!headers) {
    return {};
  }
  if (headers instanceof Headers) {
    const out: Record<string, string> = {};
    headers.forEach((value, key) => {
      out[key.toLowerCase()] = value;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    return headers.reduce<Record<string, string>>((acc, [key, value]) => {
      acc[String(key).toLowerCase()] = String(value);
      return acc;
    }, {});
  }
  return Object.entries(headers).reduce<Record<string, string>>(
    (acc, [key, value]) => {
      acc[key.toLowerCase()] = String(value);
      return acc;
    },
    {},
  );
}

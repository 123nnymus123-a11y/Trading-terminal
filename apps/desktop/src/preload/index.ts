import { contextBridge, ipcRenderer } from "electron";

console.log("[preload] starting to load");

type AnyListener = (...args: unknown[]) => void;
type IpcCompatListener = Parameters<typeof ipcRenderer.on>[1];

function asIpcListener(listener: unknown): IpcCompatListener {
  return listener as unknown as IpcCompatListener;
}

const strictIpcAllowlistEnabled =
  String(process.env.IPC_STRICT_ALLOWLIST_ENABLED ?? "false") === "true";

const allowedIpcPrefixes = [
  "cockpit:",
  "backendAuth:",
  "publicFlow:",
  "tedIntel:",
  "congress:",
  "ai:",
  "aiSteward:",
  "supplyChain:",
  "graphMemory:",
  "gwmdMap:",
  "apiHub:",
  "smartRouting:",
  "centralAI:",
  "externalFeeds:",
  "economicCalendar:",
];

const allowedIpcChannels = new Set([
  "cockpit:events",
  "cockpit:trading:event",
  "cockpit:risk:event",
  "ai:briefs",
  "ai:status",
  "ai:progress",
  "aiSteward:update",
  "apiHub:changed",
  "centralAI:preload:intelligence",
]);

function assertAllowedChannel(channel: string): void {
  if (!strictIpcAllowlistEnabled) {
    return;
  }
  const allowed =
    allowedIpcChannels.has(channel) ||
    allowedIpcPrefixes.some((prefix) => channel.startsWith(prefix));
  if (!allowed) {
    throw new Error(`ipc_channel_not_allowed:${channel}`);
  }
}

let cachedBackendAuthToken: string | undefined;

type BackendWsState =
  | "idle"
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed"
  | "error";

let backendWs: WebSocket | null = null;
let backendWsState: BackendWsState = "idle";
let backendWsReconnectAttempt = 0;
let backendWsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let backendWsManualDisconnect = false;
const backendWsSubscriptions = new Set<string>();
const backendWsMessageListeners = new Set<(message: unknown) => void>();
const backendWsStateListeners = new Set<(state: BackendWsState) => void>();

function setBackendWsState(next: BackendWsState): void {
  backendWsState = next;
  for (const listener of backendWsStateListeners) {
    try {
      listener(next);
    } catch (error) {
      console.error("[preload] backendWs state listener error", error);
    }
  }
}

function emitBackendWsMessage(message: unknown): void {
  for (const listener of backendWsMessageListeners) {
    try {
      listener(message);
    } catch (error) {
      console.error("[preload] backendWs message listener error", error);
    }
  }
}

function clearBackendWsReconnectTimer(): void {
  if (backendWsReconnectTimer) {
    clearTimeout(backendWsReconnectTimer);
    backendWsReconnectTimer = null;
  }
}

function normalizeBackendWsSymbols(symbols: string[]): string[] {
  return [
    ...new Set(
      symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean),
    ),
  ];
}

async function resolveBackendWsEndpoint(token?: string): Promise<string> {
  const backendUrl = await ipcRenderer.invoke("cockpit:config:backendUrl:get");
  const parsed = new URL(
    typeof backendUrl === "string" ? backendUrl : "http://localhost:8787",
  );
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  parsed.pathname = "/ws";
  parsed.search = "";
  if (token) {
    parsed.searchParams.set("token", token);
  }
  return parsed.toString();
}

function sendBackendWsJson(payload: unknown): boolean {
  if (!backendWs || backendWs.readyState !== WebSocket.OPEN) {
    return false;
  }
  backendWs.send(JSON.stringify(payload));
  return true;
}

function scheduleBackendWsReconnect(): void {
  if (backendWsManualDisconnect) {
    return;
  }
  clearBackendWsReconnectTimer();
  const backoffMs = Math.min(1_000 * 2 ** backendWsReconnectAttempt, 30_000);
  backendWsReconnectAttempt += 1;
  setBackendWsState("reconnecting");
  backendWsReconnectTimer = setTimeout(() => {
    void connectBackendWs();
  }, backoffMs);
}

async function connectBackendWs(): Promise<boolean> {
  if (
    backendWs &&
    (backendWs.readyState === WebSocket.OPEN ||
      backendWs.readyState === WebSocket.CONNECTING)
  ) {
    return true;
  }

  backendWsManualDisconnect = false;
  clearBackendWsReconnectTimer();
  setBackendWsState("connecting");

  try {
    const token = await resolveAuthToken();
    const endpoint = await resolveBackendWsEndpoint(token);
    backendWs = new WebSocket(endpoint);

    backendWs.onopen = () => {
      backendWsReconnectAttempt = 0;
      setBackendWsState("open");
      const symbols = [...backendWsSubscriptions.values()];
      if (symbols.length > 0) {
        sendBackendWsJson({ type: "subscribe", symbols });
      }
    };

    backendWs.onmessage = (event) => {
      const rawPayload = event.data;
      if (typeof rawPayload !== "string") {
        emitBackendWsMessage(rawPayload);
        return;
      }
      try {
        emitBackendWsMessage(JSON.parse(rawPayload));
      } catch {
        emitBackendWsMessage(rawPayload);
      }
    };

    backendWs.onerror = () => {
      setBackendWsState("error");
    };

    backendWs.onclose = () => {
      backendWs = null;
      if (backendWsManualDisconnect) {
        setBackendWsState("closed");
        return;
      }
      scheduleBackendWsReconnect();
    };

    return true;
  } catch (error) {
    console.warn("[preload] backendWs connect failed", error);
    scheduleBackendWsReconnect();
    return false;
  }
}

function disconnectBackendWs(): void {
  backendWsManualDisconnect = true;
  clearBackendWsReconnectTimer();
  if (
    backendWs &&
    (backendWs.readyState === WebSocket.OPEN ||
      backendWs.readyState === WebSocket.CONNECTING)
  ) {
    backendWs.close();
  }
  backendWs = null;
  setBackendWsState("closed");
}

function refreshBackendWsConnection(): void {
  if (!backendWs || backendWs.readyState !== WebSocket.OPEN) {
    return;
  }
  backendWsManualDisconnect = false;
  backendWs.close();
}

function setCachedBackendAuthToken(token: unknown): void {
  if (typeof token === "string" && token.length > 0) {
    cachedBackendAuthToken = token;
    return;
  }
  cachedBackendAuthToken = undefined;
}

// Keep preload token cache synchronized with auth changes from main.
ipcRenderer.on("backendAuth:tokenChanged", (_event, token: unknown) => {
  setCachedBackendAuthToken(token);
  refreshBackendWsConnection();
});

ipcRenderer.on("cockpit:backendUrl:changed", () => {
  refreshBackendWsConnection();
});

void ipcRenderer
  .invoke("backendAuth:getToken")
  .then((token) => setCachedBackendAuthToken(token))
  .catch(() => {
    // Ignore bootstrap failures; callers can still resolve tokens on demand.
  });

async function resolveAuthToken(
  authToken?: string,
): Promise<string | undefined> {
  if (typeof authToken === "string" && authToken.length > 0) {
    return authToken;
  }
  if (
    typeof cachedBackendAuthToken === "string" &&
    cachedBackendAuthToken.length > 0
  ) {
    return cachedBackendAuthToken;
  }
  try {
    const token = await ipcRenderer.invoke("backendAuth:getToken");
    if (typeof token === "string" && token.length > 0) {
      cachedBackendAuthToken = token;
      return token;
    }
  } catch {
    // Keep IPC bridge resilient: callers can still use local fallback paths.
  }
  return undefined;
}

// --------------------
// ipcCompat (window.electron.ipcRenderer)
// --------------------
const listenerMap = new Map<AnyListener, IpcCompatListener>();

function wrapListener(listener: AnyListener) {
  const wrapped: AnyListener = (event: unknown, ...args: unknown[]) =>
    listener(event, ...args);
  const ipcWrapped = asIpcListener(wrapped);
  listenerMap.set(listener, ipcWrapped);
  return ipcWrapped;
}

const ipcCompat = {
  invoke: (channel: string, ...args: unknown[]) => {
    assertAllowedChannel(channel);
    return ipcRenderer.invoke(channel, ...args);
  },
  send: (channel: string, ...args: unknown[]) => {
    assertAllowedChannel(channel);
    return ipcRenderer.send(channel, ...args);
  },

  on: (channel: string, listener: AnyListener) => {
    assertAllowedChannel(channel);
    const wrapped = wrapListener(listener);
    ipcRenderer.on(channel, wrapped);
    return ipcCompat;
  },

  once: (channel: string, listener: AnyListener) => {
    assertAllowedChannel(channel);
    const wrapped: AnyListener = (event: unknown, ...args: unknown[]) =>
      listener(event, ...args);
    ipcRenderer.once(channel, asIpcListener(wrapped));
    return ipcCompat;
  },

  off: (channel: string, listener: AnyListener) => {
    assertAllowedChannel(channel);
    const wrapped = listenerMap.get(listener) ?? asIpcListener(listener);
    ipcRenderer.off(channel, wrapped);
    listenerMap.delete(listener);
    return ipcCompat;
  },

  addListener: (channel: string, listener: AnyListener) =>
    ipcCompat.on(channel, listener),
  removeListener: (channel: string, listener: AnyListener) =>
    ipcCompat.off(channel, listener),

  removeAllListeners: (channel?: string) => {
    if (typeof channel === "string") {
      ipcRenderer.removeAllListeners(channel);
      listenerMap.clear();
    } else {
      const knownChannels = [
        ...allowedIpcChannels,
        IPC_EVENTS,
        "ai:briefs",
        "ai:status",
        "ai:progress",
        "aiSteward:update",
        "apiHub:changed",
        "centralAI:preload:intelligence",
        "cockpit:trading:event",
        "cockpit:risk:event",
      ];
      for (const knownChannel of knownChannels) {
        ipcRenderer.removeAllListeners(knownChannel);
      }
      listenerMap.clear();
    }
    return ipcCompat;
  },
};

contextBridge.exposeInMainWorld("electron", { ipcRenderer: ipcCompat });

// --------------------
// Prompt 5 channels (cockpit)
// --------------------
const IPC_EVENTS = "cockpit:events";
const IPC_STREAM_SET_SOURCE = "cockpit:stream:setSource";
const IPC_STREAM_GET_STATUS = "cockpit:stream:getStatus";

const IPC_REPLAY_PLAY = "cockpit:replay:play";
const IPC_REPLAY_PAUSE = "cockpit:replay:pause";
const IPC_REPLAY_STOP = "cockpit:replay:stop";
const IPC_REPLAY_SPEED = "cockpit:replay:setSpeed";
const IPC_REPLAY_SCRUB = "cockpit:replay:scrub";

const cockpitApi = {
  events: {
    subscribe(handler: (batch: unknown[]) => void) {
      const listener = (_event: unknown, batch: unknown[]) => handler(batch);
      const ipcListener = asIpcListener(listener);
      ipcRenderer.on(IPC_EVENTS, ipcListener);
      return () => ipcRenderer.off(IPC_EVENTS, ipcListener);
    },
  },
  stream: {
    async setSource(source: unknown) {
      await ipcRenderer.invoke(IPC_STREAM_SET_SOURCE, source);
    },
    async getStatus() {
      return await ipcRenderer.invoke(IPC_STREAM_GET_STATUS);
    },
  },
  replay: {
    async play() {
      await ipcRenderer.invoke(IPC_REPLAY_PLAY);
    },
    async pause() {
      await ipcRenderer.invoke(IPC_REPLAY_PAUSE);
    },
    async stop(resetToStart = true) {
      await ipcRenderer.invoke(IPC_REPLAY_STOP, resetToStart);
    },
    async setSpeed(speed: unknown) {
      await ipcRenderer.invoke(IPC_REPLAY_SPEED, speed);
    },
    async scrubTo(ts: number) {
      await ipcRenderer.invoke(IPC_REPLAY_SCRUB, ts);
    },
  },
  auth: {
    async login(payload: {
      username?: string;
      email?: string;
      password: string;
      licenseKey: string;
    }) {
      const response = await ipcRenderer.invoke("backendAuth:login", payload);
      if ((response as { ok?: boolean }).ok) {
        const token = (response as { session?: { token?: string } }).session
          ?.token;
        setCachedBackendAuthToken(token);
      }
      return response;
    },
    async signup(payload: {
      username: string;
      email: string;
      password: string;
      licenseKey: string;
    }) {
      const response = await ipcRenderer.invoke("backendAuth:signup", payload);
      if ((response as { ok?: boolean }).ok) {
        const token = (response as { session?: { token?: string } }).session
          ?.token;
        setCachedBackendAuthToken(token);
      }
      return response;
    },
    async refresh() {
      const response = await ipcRenderer.invoke("backendAuth:refresh");
      if ((response as { ok?: boolean }).ok) {
        const token = (response as { session?: { token?: string } }).session
          ?.token;
        setCachedBackendAuthToken(token);
      }
      return response;
    },
    async getSession() {
      return ipcRenderer.invoke("backendAuth:getSession");
    },
    async setSession(session: unknown) {
      const success = await ipcRenderer.invoke(
        "backendAuth:setSession",
        session,
      );
      if (success === true) {
        const token =
          typeof session === "object" && session !== null
            ? (session as { token?: unknown }).token
            : undefined;
        setCachedBackendAuthToken(token);
      }
      return success;
    },
    async logout() {
      const response = await ipcRenderer.invoke("backendAuth:logout");
      if (response === true) {
        setCachedBackendAuthToken(undefined);
      }
      return response;
    },
    async getToken() {
      const token = await ipcRenderer.invoke("backendAuth:getToken");
      setCachedBackendAuthToken(token);
      return token;
    },
  },
  publicFlow: {
    async getRecent(limit?: number) {
      return ipcRenderer.invoke("publicFlow:getRecent", limit);
    },
    async getThemes(windowDays: 7 | 30, limit?: number) {
      return ipcRenderer.invoke("publicFlow:getThemes", windowDays, limit);
    },
    async getCandidates(themeId: number) {
      return ipcRenderer.invoke("publicFlow:getCandidates", themeId);
    },
    async getValuations(tickers: string[]) {
      return ipcRenderer.invoke("publicFlow:getValuations", tickers);
    },
    async refresh() {
      return ipcRenderer.invoke("publicFlow:refresh");
    },
  },
  tedIntel: {
    async getSnapshot(windowDays?: "7d" | "30d" | "90d" | "1y") {
      return ipcRenderer.invoke("tedIntel:getSnapshot", windowDays ?? "90d");
    },
  },
  aiResearch: {
    async getConfig(authToken?: string) {
      const resolvedToken = await resolveAuthToken(authToken);
      return ipcRenderer.invoke("ai:config:get", { authToken: resolvedToken });
    },
    async setConfig(next: unknown, authToken?: string) {
      const resolvedToken = await resolveAuthToken(authToken);
      return ipcRenderer.invoke("ai:config:set", {
        config: next,
        authToken: resolvedToken,
      });
    },
    async runNow(
      manualItems?: Array<{ title: string; text: string }>,
      authToken?: string,
    ) {
      const resolvedToken = await resolveAuthToken(authToken);
      return ipcRenderer.invoke("ai:run", {
        items: manualItems ?? [],
        authToken: resolvedToken,
      });
    },
    async listBriefs(limit?: number, authToken?: string) {
      const resolvedToken = await resolveAuthToken(authToken);
      return ipcRenderer.invoke("ai:briefs:list", {
        limit,
        authToken: resolvedToken,
      });
    },
    async getStatus(authToken?: string) {
      const resolvedToken = await resolveAuthToken(authToken);
      return ipcRenderer.invoke("ai:status:get", { authToken: resolvedToken });
    },
    async checkRuntime() {
      return ipcRenderer.invoke("ai:runtime:check");
    },
    async listModels() {
      return ipcRenderer.invoke("ai:models:list");
    },
    async testModelConnection(payload: {
      provider?: string;
      model: string;
      apiKey?: string;
    }) {
      return ipcRenderer.invoke("ai:model:test", payload);
    },
    onBriefs(handler: (briefs: unknown[]) => void) {
      const listener = (_event: unknown, briefs: unknown[]) => handler(briefs);
      const ipcListener = asIpcListener(listener);
      ipcRenderer.on("ai:briefs", ipcListener);
      return () => ipcRenderer.off("ai:briefs", ipcListener);
    },
    onStatus(handler: (status: unknown) => void) {
      const listener: AnyListener = (_event: unknown, status: unknown) =>
        handler(status);
      const ipcListener = asIpcListener(listener);
      ipcRenderer.on("ai:status", ipcListener);
      return () => ipcRenderer.off("ai:status", ipcListener);
    },
    onProgress(handler: (progress: unknown) => void) {
      const listener: AnyListener = (_event: unknown, progress: unknown) =>
        handler(progress);
      const ipcListener = asIpcListener(listener);
      ipcRenderer.on("ai:progress", ipcListener);
      return () => ipcRenderer.off("ai:progress", ipcListener);
    },
  },
  strategyResearch: {
    async loadLocalWorkspace() {
      return ipcRenderer.invoke("strategyResearch:loadLocalWorkspace");
    },
    async upsertLocalStrategy(strategy: {
      id: string;
      name: string;
      description?: string;
      stage: "draft" | "candidate" | "validation" | "production" | "retired";
      tags: string[];
      createdAt: string;
      updatedAt: string;
    }) {
      return ipcRenderer.invoke("strategyResearch:upsertLocalStrategy", {
        strategy,
      });
    },
    async upsertLocalVersion(version: {
      id: string;
      strategyId: string;
      version: string;
      scriptLanguage: "javascript" | "typescript";
      scriptSource: string;
      scriptChecksum: string;
      universe: string[];
      assumptions: Record<string, unknown>;
      createdAt: string;
    }) {
      return ipcRenderer.invoke("strategyResearch:upsertLocalVersion", {
        version,
      });
    },
    async upsertLocalRun(run: {
      runId: string;
      strategyId: string;
      strategyVersion: string;
      status: "queued" | "running" | "completed" | "failed" | "cancelled";
      executionMode: "desktop-local" | "backend";
      requestedAt?: string;
      startedAt?: string;
      finishedAt?: string;
      error?: string;
      metrics?: Record<string, unknown>;
      equityCurve?: Array<{ timestamp: string; value: number }>;
      trades?: Array<Record<string, unknown>>;
      historicalData?: Record<string, unknown>;
      runMetadata?: Record<string, unknown>;
      runLogs?: string[];
    }) {
      return ipcRenderer.invoke("strategyResearch:upsertLocalRun", { run });
    },
    async upsertLocalComparisonNote(comparisonNote: {
      id: string;
      strategyId: string;
      primaryRunId: string;
      baselineRunId: string;
      note: string;
      createdAt: string;
      updatedAt: string;
    }) {
      return ipcRenderer.invoke("strategyResearch:upsertLocalComparisonNote", {
        comparisonNote,
      });
    },
    async downloadHistoricalData(symbols: string[]) {
      return ipcRenderer.invoke("strategyResearch:downloadHistoricalData", {
        symbols,
      });
    },
    async runLocalBacktest(payload: {
      runId: string;
      strategyId: string;
      strategyVersion: string;
      scriptSource: string;
      universe: string[];
      assumptions?: Record<string, unknown>;
    }) {
      return ipcRenderer.invoke("strategyResearch:runLocalBacktest", payload);
    },
  },
  aiSteward: {
    async getOverview(authToken?: string) {
      const resolvedToken = await resolveAuthToken(authToken);
      return ipcRenderer.invoke("aiSteward:getOverview", {
        authToken: resolvedToken,
      });
    },
    async getConfig(authToken?: string) {
      const resolvedToken = await resolveAuthToken(authToken);
      return ipcRenderer.invoke("aiSteward:getConfig", {
        authToken: resolvedToken,
      });
    },
    async getHealth(authToken?: string) {
      const resolvedToken = await resolveAuthToken(authToken);
      return ipcRenderer.invoke("aiSteward:getHealth", {
        authToken: resolvedToken,
      });
    },
    async getIncidentDigest(authToken?: string) {
      const resolvedToken = await resolveAuthToken(authToken);
      return ipcRenderer.invoke("aiSteward:getIncidentDigest", {
        authToken: resolvedToken,
      });
    },
    async getFindings(module?: string, authToken?: string) {
      const resolvedToken = await resolveAuthToken(authToken);
      return ipcRenderer.invoke("aiSteward:getFindings", {
        module,
        authToken: resolvedToken,
      });
    },
    async getTasks(authToken?: string) {
      const resolvedToken = await resolveAuthToken(authToken);
      return ipcRenderer.invoke("aiSteward:getTasks", {
        authToken: resolvedToken,
      });
    },
    async dismissFinding(findingId: string, authToken?: string) {
      const resolvedToken = await resolveAuthToken(authToken);
      return ipcRenderer.invoke("aiSteward:dismissFinding", {
        findingId,
        authToken: resolvedToken,
      });
    },
    async checkHealth(authToken?: string) {
      const resolvedToken = await resolveAuthToken(authToken);
      return ipcRenderer.invoke("aiSteward:checkHealth", {
        authToken: resolvedToken,
      });
    },
    async setConfig(patch: unknown, authToken?: string) {
      const resolvedToken = await resolveAuthToken(authToken);
      return ipcRenderer.invoke("aiSteward:setConfig", {
        patch: patch ?? {},
        authToken: resolvedToken,
      });
    },
    async runModule(module: string, authToken?: string) {
      const resolvedToken = await resolveAuthToken(authToken);
      return ipcRenderer.invoke("aiSteward:runModule", {
        module,
        authToken: resolvedToken,
      });
    },
    async applyTask(taskId: string, authToken?: string) {
      const resolvedToken = await resolveAuthToken(authToken);
      return ipcRenderer.invoke("aiSteward:applyTask", {
        taskId,
        authToken: resolvedToken,
      });
    },
    async testResponse(prompt?: string) {
      return ipcRenderer.invoke("aiSteward:test", prompt);
    },
    onUpdate(handler: (overview: unknown) => void) {
      const listener: AnyListener = (_event: unknown, overview: unknown) =>
        handler(overview);
      const ipcListener = asIpcListener(listener);
      ipcRenderer.on("aiSteward:update", ipcListener);
      return () => ipcRenderer.off("aiSteward:update", ipcListener);
    },
  },
  supplyChain: {
    async generate(options: {
      ticker: string;
      globalTickers?: string[];
      strictMode?: boolean;
      includeHypothesis?: boolean;
      hops?: number;
      minEdgeWeight?: number;
      refresh?: boolean;
      authToken?: string;
    }) {
      const resolvedToken = await resolveAuthToken(options.authToken);
      return ipcRenderer.invoke("supplyChain:generate", {
        ...options,
        authToken: resolvedToken,
      });
    },
    async openGlobalMap(tickers: string[]) {
      return ipcRenderer.invoke("supplyChain:openGlobalMap", tickers);
    },
    async clearCache(ticker: string) {
      return ipcRenderer.invoke("supplyChain:clearCache", ticker);
    },
    async listCached() {
      return ipcRenderer.invoke("supplyChain:listCached");
    },
    async askAdvisor(payload: unknown) {
      return ipcRenderer.invoke("supplyChain:advisorAsk", payload);
    },
    async generateForGwmd(
      ticker: string,
      options: { model: unknown; hops?: number },
    ) {
      return ipcRenderer.invoke("gwmdMap:search", {
        ticker,
        model: options.model,
        hops: options.hops,
      });
    },
    async getEnrichmentInspector() {
      return ipcRenderer.invoke("graphEnrichment:getInspector");
    },
    async exportEnrichmentSnapshot() {
      return ipcRenderer.invoke("graphEnrichment:exportSnapshot");
    },
    async getEnrichmentSyncStatus() {
      return ipcRenderer.invoke("graphEnrichment:getSyncStatus");
    },
    async getEnrichmentCachedSubgraph(payload: {
      query: string;
      hops?: number;
    }) {
      return ipcRenderer.invoke(
        "graphEnrichment:getCachedSubgraph",
        payload ?? { query: "" },
      );
    },
    async runEnrichmentMaintenance() {
      return ipcRenderer.invoke("graphEnrichment:runMaintenance");
    },
  },
  graphMemory: {
    async getDashboard() {
      return ipcRenderer.invoke("graphMemory:getDashboard");
    },
    async getSection(payload: unknown) {
      return ipcRenderer.invoke("graphMemory:getSection", payload ?? {});
    },
    async getDetail(payload: unknown) {
      return ipcRenderer.invoke("graphMemory:getDetail", payload ?? {});
    },
    async refresh() {
      return ipcRenderer.invoke("graphMemory:refresh");
    },
    async revalidateSelected(payload: unknown) {
      return ipcRenderer.invoke(
        "graphMemory:revalidateSelected",
        payload ?? { records: [] },
      );
    },
    async exportNow() {
      return ipcRenderer.invoke("graphMemory:exportNow");
    },
    async getExportsManifest() {
      return ipcRenderer.invoke("graphMemory:getExportsManifest");
    },
    async openLatestSnapshot() {
      return ipcRenderer.invoke("graphMemory:openLatestSnapshot");
    },
    async revealPath(pathValue: string) {
      return ipcRenderer.invoke("graphMemory:revealPath", { path: pathValue });
    },
  },
  gwmdMap: {
    async search(
      ticker: string,
      options?: {
        model: unknown;
        hops?: number;
        refresh?: boolean;
        sourceMode?: "cache_only" | "hybrid" | "fresh";
      },
    ) {
      return ipcRenderer.invoke("gwmdMap:search", {
        ticker,
        model: options?.model,
        hops: options?.hops,
        refresh: options?.refresh,
        sourceMode: options?.sourceMode,
      });
    },
    async loadAll() {
      return ipcRenderer.invoke("gwmdMap:loadAll");
    },
    async loadScoped(ticker: string) {
      return ipcRenderer.invoke("gwmdMap:loadScoped", { ticker });
    },
    async clear() {
      return ipcRenderer.invoke("gwmdMap:clear");
    },
    async syncPush(payload: {
      companies: Array<{
        ticker: string;
        name: string;
        hq_lat?: number | null;
        hq_lon?: number | null;
        hq_city?: string | null;
        hq_country?: string | null;
        industry?: string | null;
        health_score?: number | null;
      }>;
      relationships: Array<{
        id: string;
        from_ticker: string;
        to_ticker: string;
        relation_type:
          | "supplier"
          | "customer"
          | "partner"
          | "competitor"
          | "financing"
          | "license";
        weight?: number | null;
        confidence?: number | null;
        evidence?: string | null;
      }>;
      replace?: boolean;
      authToken?: string;
    }) {
      return ipcRenderer.invoke("gwmdMap:syncPush", payload);
    },
    async syncPull(payload?: {
      since?: string;
      replace?: boolean;
      authToken?: string;
    }) {
      return ipcRenderer.invoke("gwmdMap:syncPull", payload ?? {});
    },
    async syncStatus(payload?: { authToken?: string }) {
      return ipcRenderer.invoke("gwmdMap:syncStatus", payload ?? {});
    },
    async enterDisplaySurface(payload?: {
      monitorIds?: number[];
      primaryMonitorId?: number | null;
      mode?: "standard" | "wall" | "analyst" | "mirror";
    }) {
      return ipcRenderer.invoke("gwmdMap:display:enter", payload ?? {});
    },
    async exitDisplaySurface() {
      return ipcRenderer.invoke("gwmdMap:display:exit");
    },
    async getDisplaySurfaceState() {
      return ipcRenderer.invoke("gwmdMap:display:getState");
    },
    async listDisplayMonitors() {
      return ipcRenderer.invoke("gwmdMap:display:listMonitors");
    },
    async getDisplaySurfaceSelection() {
      return ipcRenderer.invoke("gwmdMap:display:selection:get");
    },
    async setDisplaySurfaceSelection(payload: {
      monitorIds?: number[];
      primaryMonitorId?: number | null;
      mode?: "standard" | "wall" | "analyst" | "mirror";
    }) {
      return ipcRenderer.invoke("gwmdMap:display:selection:set", payload ?? {});
    },
    onDisplaySurfaceChanged(handler: (state: unknown) => void) {
      const listener: AnyListener = (_event: unknown, state: unknown) =>
        handler(state);
      const ipcListener = asIpcListener(listener);
      ipcRenderer.on("gwmdMap:display:changed", ipcListener);
      return () => ipcRenderer.off("gwmdMap:display:changed", ipcListener);
    },
    onGraphUpdated(handler: () => void) {
      const listener: AnyListener = () => handler();
      const ipcListener = asIpcListener(listener);
      ipcRenderer.on("gwmdMap:graph:updated", ipcListener);
      return () => ipcRenderer.off("gwmdMap:graph:updated", ipcListener);
    },
    async repairGeo(limit?: number) {
      return ipcRenderer.invoke("gwmdMap:repairGeo", { limit });
    },
  },
  congress: {
    async queryTrades(filters: unknown) {
      return ipcRenderer.invoke("congress:queryTrades", filters);
    },
    async queryTradesWithParty(filters: unknown) {
      return ipcRenderer.invoke("congress:queryTradesWithParty", filters);
    },
    async getTradeStats(ticker: string, dateStart?: string, dateEnd?: string) {
      return ipcRenderer.invoke(
        "congress:getTradeStats",
        ticker,
        dateStart,
        dateEnd,
      );
    },
    async getMostTradedTickers(params: {
      dateStart?: string;
      dateEnd?: string;
      limit?: number;
    }) {
      return ipcRenderer.invoke("congress:getMostTradedTickers", params);
    },
    async getDisclosureLagStats() {
      return ipcRenderer.invoke("congress:getDisclosureLagStats");
    },
    async queryMembers(filters: unknown) {
      return ipcRenderer.invoke("congress:queryMembers", filters);
    },
    async queryLobbying(filters: unknown) {
      return ipcRenderer.invoke("congress:queryLobbying", filters);
    },
    async queryContracts(filters: unknown) {
      return ipcRenderer.invoke("congress:queryContracts", filters);
    },
    async insertTrades(trades: unknown[]) {
      return ipcRenderer.invoke("congress:insertTrades", trades);
    },
    async insertLobbying(activities: unknown[]) {
      return ipcRenderer.invoke("congress:insertLobbying", activities);
    },
    async insertContracts(contracts: unknown[]) {
      return ipcRenderer.invoke("congress:insertContracts", contracts);
    },
    async upsertMembers(members: unknown[]) {
      return ipcRenderer.invoke("congress:upsertMembers", members);
    },
    async findTicker(companyName: string) {
      return ipcRenderer.invoke("congress:findTicker", companyName);
    },
    async insertIngestionLog(log: unknown) {
      return ipcRenderer.invoke("congress:insertIngestionLog", log);
    },
    async queryIngestionLogs(domain?: string, limit?: number) {
      return ipcRenderer.invoke("congress:queryIngestionLogs", domain, limit);
    },
    async fetchHouseTrades(limit?: number) {
      return ipcRenderer.invoke("congress:fetchHouseTrades", limit);
    },
    async fetchSenateTrades(limit?: number) {
      return ipcRenderer.invoke("congress:fetchSenateTrades", limit);
    },
    async fetchLobbyingActivities(limit?: number) {
      return ipcRenderer.invoke("congress:fetchLobbyingActivities", limit);
    },
    async fetchFederalContracts(limit?: number) {
      return ipcRenderer.invoke("congress:fetchFederalContracts", limit);
    },
    async fetchAllTrades(limit?: number) {
      return ipcRenderer.invoke("congress:fetchAllTrades", limit);
    },
    async scanAiSources() {
      return ipcRenderer.invoke("congress:scanAiSources");
    },
    async analyzeTrade(
      tradeId: string,
      tradeData: Record<string, unknown>,
      model?: string,
      authToken?: string,
    ) {
      const resolvedToken = await resolveAuthToken(authToken);
      return ipcRenderer.invoke("congress:ai:analyzeTrade", {
        tradeId,
        tradeData,
        model,
        authToken: resolvedToken,
      });
    },
    async getAiWatchlist(authToken?: string) {
      const resolvedToken = await resolveAuthToken(authToken);
      return ipcRenderer.invoke("congress:ai:watchlist:get", {
        authToken: resolvedToken,
      });
    },
    async addAiWatchlist(
      ticker: string,
      reason: string,
      priority?: number,
      authToken?: string,
    ) {
      const resolvedToken = await resolveAuthToken(authToken);
      return ipcRenderer.invoke("congress:ai:watchlist:add", {
        ticker,
        reason,
        priority,
        authToken: resolvedToken,
      });
    },
    async removeAiWatchlist(watchlistId: number, authToken?: string) {
      const resolvedToken = await resolveAuthToken(authToken);
      return ipcRenderer.invoke("congress:ai:watchlist:remove", {
        watchlistId,
        authToken: resolvedToken,
      });
    },
  },
  journal: {
    async listEntries(limit?: number) {
      return ipcRenderer.invoke("cockpit:config:watchlists:list", limit);
    },
    async watchlistsAdd(symbol: string, note?: string) {
      return ipcRenderer.invoke("cockpit:config:watchlists:add", symbol, note);
    },
    async watchlistsUpdate(
      id: number,
      fields: { symbol?: string; note?: string },
    ) {
      return ipcRenderer.invoke("cockpit:config:watchlists:update", id, fields);
    },
    async watchlistsRemove(id: number) {
      return ipcRenderer.invoke("cockpit:config:watchlists:remove", id);
    },
    async layoutsList(symbol?: string) {
      return ipcRenderer.invoke("cockpit:config:layouts:list", symbol);
    },
    async setLayoutPreset(symbol: string, preset: string, data?: unknown) {
      return ipcRenderer.invoke(
        "cockpit:config:layouts:setPreset",
        symbol,
        preset,
        data,
      );
    },
    async settingsGet() {
      return ipcRenderer.invoke("cockpit:config:settings:get");
    },
    async settingsSet(next: Record<string, unknown>) {
      return ipcRenderer.invoke("cockpit:config:settings:set", next);
    },
    async backendUrlGet() {
      return ipcRenderer.invoke("cockpit:config:backendUrl:get");
    },
    async backendUrlSet(nextUrl: string) {
      return ipcRenderer.invoke("cockpit:config:backendUrl:set", nextUrl);
    },
    async tedConfigGet() {
      return ipcRenderer.invoke("cockpit:ted:config:get");
    },
    async tedConfigSet(next: Record<string, unknown>) {
      return ipcRenderer.invoke("cockpit:ted:config:set", next);
    },
  },
  secrets: {
    async set(account: string, secret: string, passphrase?: string) {
      return ipcRenderer.invoke(
        "cockpit:secrets:set",
        account,
        secret,
        passphrase,
      );
    },
    async get(account: string, passphrase?: string) {
      return ipcRenderer.invoke("cockpit:secrets:get", account, passphrase);
    },
  },
  apiHub: {
    async list() {
      return ipcRenderer.invoke("apiHub:list");
    },
    async save(record: unknown) {
      return ipcRenderer.invoke("apiHub:save", record);
    },
    async remove(id: string) {
      return ipcRenderer.invoke("apiHub:remove", id);
    },
    async openWindow() {
      return ipcRenderer.invoke("apiHub:openWindow");
    },
    onChanged(handler: (snapshot: unknown) => void) {
      const listener: AnyListener = (_event: unknown, snapshot: unknown) =>
        handler(snapshot);
      const ipcListener = asIpcListener(listener);
      ipcRenderer.on("apiHub:changed", ipcListener);
      return () => ipcRenderer.off("apiHub:changed", ipcListener);
    },
  },
  smartRouting: {
    async openWindow() {
      return ipcRenderer.invoke("smartRouting:openWindow");
    },
  },
  tabs: {
    async openWindow(tabLabel: string) {
      return ipcRenderer.invoke("cockpit:tabs:openWindow", tabLabel);
    },
  },
  apiKey: {
    async validate(provider: string, credentials: Record<string, string>) {
      return ipcRenderer.invoke(
        "cockpit:apikey:validate",
        provider,
        credentials,
      );
    },
    async validateStored(
      apiKeyId: string,
      provider: string,
      fields: Array<{ key: string; account: string }>,
      config?: Record<string, string>,
    ) {
      return ipcRenderer.invoke(
        "cockpit:apikey:validateStored",
        apiKeyId,
        provider,
        fields,
        config,
      );
    },
  },
  centralAI: {
    async track(interaction: Record<string, unknown>, authToken?: string) {
      const resolvedToken = await resolveAuthToken(authToken);
      return ipcRenderer.invoke("centralAI:track", {
        ...interaction,
        authToken: resolvedToken,
      });
    },
    async predict(limit?: number, authToken?: string) {
      const resolvedToken = await resolveAuthToken(authToken);
      return ipcRenderer.invoke("centralAI:predict", {
        limit,
        authToken: resolvedToken,
      });
    },
    async validate(response: string, context: unknown) {
      return ipcRenderer.invoke("centralAI:validate", response, context);
    },
    async getIntelligence() {
      return ipcRenderer.invoke("centralAI:getIntelligence");
    },
    async getStats() {
      return ipcRenderer.invoke("centralAI:getStats");
    },
    onPreloadIntelligence(handler: (data: unknown) => void) {
      const listener: AnyListener = (_event: unknown, data: unknown) =>
        handler(data);
      const ipcListener = asIpcListener(listener);
      ipcRenderer.on("centralAI:preload:intelligence", ipcListener);
      return () =>
        ipcRenderer.off("centralAI:preload:intelligence", ipcListener);
    },
  },
  externalFeeds: {
    async getConfig() {
      return ipcRenderer.invoke("externalFeeds:getConfig");
    },
    async setConfig(next: unknown) {
      return ipcRenderer.invoke("externalFeeds:setConfig", next);
    },
    async testProvider(
      providerId: string,
      credentials?: Record<string, string>,
    ) {
      return ipcRenderer.invoke(
        "externalFeeds:testProvider",
        providerId,
        credentials ?? {},
      );
    },
    async getCotSummary(symbols: string[]) {
      return ipcRenderer.invoke("externalFeeds:getCftcSummary", symbols);
    },
    async getJoltsSeries() {
      return ipcRenderer.invoke("externalFeeds:getJoltsSeries");
    },
    async getSecEvents(params: { tickers?: string[]; limit?: number }) {
      return ipcRenderer.invoke("externalFeeds:getSecEvents", params);
    },
  },
  economicCalendar: {
    async generateInsights(
      request: unknown,
      preference?: string,
      authToken?: string,
    ) {
      const resolvedToken = await resolveAuthToken(authToken);
      return ipcRenderer.invoke("economicCalendar:insights", {
        request,
        preference,
        authToken: resolvedToken,
      });
    },
  },
  trading: {
    async placeOrder(req: unknown) {
      return ipcRenderer.invoke("cockpit:trading:placeOrder", req);
    },
    async cancelOrder(orderId: string) {
      return ipcRenderer.invoke("cockpit:trading:cancelOrder", orderId);
    },
    async getOrders() {
      return ipcRenderer.invoke("cockpit:trading:getOrders");
    },
    async getPositions() {
      return ipcRenderer.invoke("cockpit:trading:getPositions");
    },
    async getAccount() {
      return ipcRenderer.invoke("cockpit:trading:getAccount");
    },
    onEvent(handler: (event: unknown) => void) {
      const listener: AnyListener = (_event: unknown, paperEvent: unknown) =>
        handler(paperEvent);
      const ipcListener = asIpcListener(listener);
      ipcRenderer.on("cockpit:trading:event", ipcListener);
      return () => ipcRenderer.off("cockpit:trading:event", ipcListener);
    },
  },
  risk: {
    onEvent(handler: (event: unknown) => void) {
      const listener: AnyListener = (_event: unknown, riskEvent: unknown) =>
        handler(riskEvent);
      const ipcListener = asIpcListener(listener);
      ipcRenderer.on("cockpit:risk:event", ipcListener);
      return () => ipcRenderer.off("cockpit:risk:event", ipcListener);
    },
  },
  backendWs: {
    async connect() {
      return connectBackendWs();
    },
    disconnect() {
      disconnectBackendWs();
    },
    getState() {
      return backendWsState;
    },
    subscribe(symbols: string[]) {
      const normalized = normalizeBackendWsSymbols(symbols);
      for (const symbol of normalized) {
        backendWsSubscriptions.add(symbol);
      }
      if (normalized.length > 0) {
        sendBackendWsJson({ type: "subscribe", symbols: normalized });
      }
      return [...backendWsSubscriptions.values()];
    },
    unsubscribe(symbols: string[]) {
      const normalized = normalizeBackendWsSymbols(symbols);
      for (const symbol of normalized) {
        backendWsSubscriptions.delete(symbol);
      }
      if (normalized.length > 0) {
        sendBackendWsJson({ type: "unsubscribe", symbols: normalized });
      }
      return [...backendWsSubscriptions.values()];
    },
    onMessage(handler: (message: unknown) => void) {
      backendWsMessageListeners.add(handler);
      return () => backendWsMessageListeners.delete(handler);
    },
    onStateChange(handler: (state: BackendWsState) => void) {
      backendWsStateListeners.add(handler);
      return () => backendWsStateListeners.delete(handler);
    },
  },
};
// Friendly namespace for cockpit-specific APIs
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
window.cockpit = cockpitApi;

contextBridge.exposeInMainWorld("cockpit", cockpitApi);

// --------------------
// COMPAT: window.streaming (make it accept many signatures)
// --------------------
let compatSeq = 0;

function pickFn(x: unknown): AnyListener | null {
  if (typeof x === "function") return x as AnyListener;
  if (x && typeof x === "object") {
    const candidateMap = x as Record<string, unknown>;
    const candidates = [
      candidateMap.handler,
      candidateMap.onEvents,
      candidateMap.onEvent,
      candidateMap.onBatch,
      candidateMap.onEventBatch,
      candidateMap.onMessage,
      candidateMap.next,
      candidateMap.callback,
      candidateMap.cb,
    ];
    for (const c of candidates)
      if (typeof c === "function") return c as AnyListener;
  }
  return null;
}

/**
 * Normalizes onEvents(...) signatures into a callable.
 * Supported:
 * - onEvents(fn)
 * - onEvents(channel, fn)
 * - onEvents(opts, fn)
 * - onEvents({handler: fn}) / {onEvents: fn} / {onBatch: fn} / {onMessage: fn}
 */
function normalizeOnEventsArgs(a: unknown, b: unknown) {
  const fnB = pickFn(b);
  if (fnB) return { kind: "events" as const, fn: fnB };

  const fnA = pickFn(a);
  if (fnA) return { kind: "events" as const, fn: fnA };

  // if a is object with batch handler, prefer batch delivery
  if (a && typeof a === "object") {
    const candidateMap = a as Record<string, unknown>;
    const batchFn =
      pickFn(candidateMap.onBatch) ||
      pickFn(candidateMap.onEventBatch) ||
      pickFn(candidateMap.onEventsBatch);
    if (batchFn) return { kind: "batch" as const, fn: batchFn };
  }

  return { kind: "none" as const, fn: null as AnyListener | null };
}

function subscribeWithNormalizedHandler(norm: {
  kind: "events" | "batch" | "none";
  fn: AnyListener | null;
}) {
  const listener = (_event: unknown, events: unknown[]) => {
    compatSeq += 1;
    const meta = { seq: compatSeq, ts: Date.now() };

    if (!norm.fn) return; // never crash if caller passed wrong shape

    try {
      if (norm.kind === "batch") {
        norm.fn({ ...meta, events });
      } else {
        // events style: pass (events, meta) AND also allow (meta, events) consumers to ignore order
        norm.fn(events, meta);
      }
    } catch (err) {
      // never take down the renderer because a handler threw
      console.error("[streamingCompat] handler threw", err);
    }
  };

  const ipcListener = asIpcListener(listener);
  ipcRenderer.on(IPC_EVENTS, ipcListener);
  return () => ipcRenderer.off(IPC_EVENTS, ipcListener);
}

const streamingCompat = {
  version: "compat-3" as const,
  ipcRenderer: ipcCompat,

  onEvents(a: unknown, b?: unknown) {
    const norm = normalizeOnEventsArgs(a, b);
    return subscribeWithNormalizedHandler(norm);
  },

  // keep common aliases too
  onEventBatch(handler: unknown) {
    return subscribeWithNormalizedHandler({
      kind: "batch" as const,
      fn: pickFn(handler),
    });
  },
  onEventsBatch(handler: unknown) {
    return subscribeWithNormalizedHandler({
      kind: "batch" as const,
      fn: pickFn(handler),
    });
  },

  subscribe(handler: unknown) {
    return subscribeWithNormalizedHandler({
      kind: "events" as const,
      fn: pickFn(handler),
    });
  },
  subscribeBatch(handler: unknown) {
    return subscribeWithNormalizedHandler({
      kind: "batch" as const,
      fn: pickFn(handler),
    });
  },

  async setSource(source: "demo" | "replay" | "live") {
    await ipcRenderer.invoke(IPC_STREAM_SET_SOURCE, source);
  },
  async getStatus() {
    return await ipcRenderer.invoke(IPC_STREAM_GET_STATUS);
  },

  replay: {
    async play() {
      await ipcRenderer.invoke(IPC_REPLAY_PLAY);
    },
    async pause() {
      await ipcRenderer.invoke(IPC_REPLAY_PAUSE);
    },
    async stop(resetToStart = true) {
      await ipcRenderer.invoke(IPC_REPLAY_STOP, resetToStart);
    },
    async setSpeed(speed: unknown) {
      await ipcRenderer.invoke(IPC_REPLAY_SPEED, speed);
    },
    async scrubTo(ts: number) {
      await ipcRenderer.invoke(IPC_REPLAY_SCRUB, ts);
    },
  },
};

contextBridge.exposeInMainWorld("streaming", streamingCompat);

console.log("[preload] loaded (electron + streaming + cockpit)");

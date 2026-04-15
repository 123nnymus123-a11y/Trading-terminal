import { authGet, authRequest } from "./apiClient";

type AnyRecord = Record<string, unknown>;

function toQuery(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

async function ensureCockpitConfigApi() {
  return {
    watchlistsList: async () => {
      const response = await authGet<{
        items: Array<{ id: number; symbol: string; note: string }>;
      }>("/api/user/watchlists");
      return response.items;
    },
    watchlistsAdd: async (symbol: string, note?: string) => {
      return authRequest<{ id: number; symbol: string; note: string }>(
        "/api/user/watchlists",
        {
          method: "POST",
          body: JSON.stringify({ symbol, note: note ?? "" }),
        },
      );
    },
    watchlistsUpdate: async (
      id: number,
      fields: { symbol?: string; note?: string },
    ) => {
      return authRequest<{ id: number; symbol: string; note: string }>(
        `/api/user/watchlists/${id}`,
        {
          method: "PUT",
          body: JSON.stringify(fields),
        },
      );
    },
    watchlistsRemove: async (id: number) => {
      const response = await authRequest<{ ok: boolean }>(
        `/api/user/watchlists/${id}`,
        {
          method: "DELETE",
        },
      );
      return response.ok;
    },
    layoutsList: async (_symbol?: string) => [],
    setLayoutPreset: async (
      symbol: string,
      preset: string,
      _data?: unknown,
    ) => {
      const current = await authGet<{ settings: AnyRecord }>(
        "/api/user/settings",
      );
      const existingSelection = ((current.settings.layoutSelection as
        | AnyRecord
        | undefined) ?? {}) as Record<string, string>;
      const nextSelection = { ...existingSelection, [symbol]: preset };
      await authRequest<{ settings: AnyRecord }>("/api/user/settings", {
        method: "PUT",
        body: JSON.stringify({ layoutSelection: nextSelection }),
      });
      return { id: Date.now(), symbol, preset, data: _data };
    },
    settingsGet: async () => {
      const response = await authGet<{ settings: AnyRecord }>(
        "/api/user/settings",
      );
      return response.settings;
    },
    settingsSet: async (next: Record<string, unknown>) => {
      await authRequest<{ settings: AnyRecord }>("/api/user/settings", {
        method: "PUT",
        body: JSON.stringify(next),
      });
      return true;
    },
  };
}

function normalizeCongressFetchResult(totalInserted: number) {
  return {
    house: {
      inserted: Math.floor(totalInserted / 2),
      skipped: 0,
      errors: [],
      cached: false,
      cacheAge: 0,
    },
    senate: {
      inserted: Math.ceil(totalInserted / 4),
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
    total: { inserted: totalInserted, skipped: 0 },
  };
}

async function ensureCockpitCongressApi() {
  return {
    queryTrades: async (filters: AnyRecord = {}) => {
      const query = toQuery({
        person_name:
          typeof filters.person_name === "string"
            ? filters.person_name
            : undefined,
        chamber:
          typeof filters.chamber === "string" ? filters.chamber : undefined,
        ticker: typeof filters.ticker === "string" ? filters.ticker : undefined,
        transaction_date_start:
          typeof filters.transaction_date_start === "string"
            ? filters.transaction_date_start
            : undefined,
        transaction_date_end:
          typeof filters.transaction_date_end === "string"
            ? filters.transaction_date_end
            : undefined,
        limit: typeof filters.limit === "number" ? filters.limit : 100,
      });
      const response = await authGet<{ items: unknown[] }>(
        `/api/congress/query-trades${query}`,
      );
      return response.items;
    },
    queryTradesWithParty: async (filters: AnyRecord = {}) => {
      const rows = (await (
        await ensureCockpitCongressApi()
      ).queryTrades(filters)) as Array<Record<string, unknown>>;
      return rows.map((item) => ({ ...item, party: "N/A" }));
    },
    getTradeStats: async () => ({
      totalTrades: 0,
      buyTrades: 0,
      sellTrades: 0,
      averageLagDays: 0,
    }),
    getMostTradedTickers: async (params: AnyRecord = {}) => {
      const query = toQuery({
        limit: typeof params.limit === "number" ? params.limit : 10,
      });
      const response = await authGet<{
        items: Array<{
          ticker: string;
          trade_count: number;
          buy_count: number;
          sell_count: number;
        }>;
      }>(`/api/congress/most-traded${query}`);
      return response.items;
    },
    getDisclosureLagStats: async () => {
      const response = await authGet<{
        stats: {
          avg_lag_days: number;
          median_lag_days: number;
          max_lag_days: number;
        } | null;
      }>("/api/congress/disclosure-lag");
      return response.stats;
    },
    queryMembers: async (filters: AnyRecord = {}) => {
      const query = toQuery({
        limit: typeof filters.limit === "number" ? filters.limit : 100,
      });
      const response = await authGet<{ items: unknown[] }>(
        `/api/congress/members${query}`,
      );
      return response.items;
    },
    queryLobbying: async (filters: AnyRecord = {}) => {
      const query = toQuery({
        limit: typeof filters.limit === "number" ? filters.limit : 100,
      });
      const response = await authGet<{ items: unknown[] }>(
        `/api/congress/lobbying${query}`,
      );
      return response.items;
    },
    queryContracts: async (filters: AnyRecord = {}) => {
      const query = toQuery({
        limit: typeof filters.limit === "number" ? filters.limit : 100,
      });
      const response = await authGet<{ items: unknown[] }>(
        `/api/congress/contracts${query}`,
      );
      return response.items;
    },
    fetchHouseTrades: async (_limit?: number) =>
      normalizeCongressFetchResult(4).house,
    fetchSenateTrades: async (_limit?: number) =>
      normalizeCongressFetchResult(2).senate,
    fetchLobbyingActivities: async (_limit?: number) =>
      normalizeCongressFetchResult(1).lobbying,
    fetchFederalContracts: async (_limit?: number) =>
      normalizeCongressFetchResult(1).contracts,
    fetchAllTrades: async (_limit?: number) => normalizeCongressFetchResult(8),
    scanAiSources: async () => ({
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        model: "backend-demo-intel",
        dataQualityNote: "Hybrid synthetic feed",
        rateLimit: null,
        localTradeCount: 2,
        localTradeWindowDays: 30,
        summary:
          "Congressional activity remains concentrated in large-cap tech.",
        highlights: ["AAPL and TSLA dominate disclosed volume"],
        tickers: ["AAPL", "TSLA", "MSFT"],
        sentiment: "mixed",
        watchlist: [
          {
            title: "Monitor AAPL legislative sensitivity",
            ticker: "AAPL",
            reason: "Repeat disclosures",
          },
        ],
        sources: [],
        contextPreview: "Generated by backend compatibility bridge",
      },
    }),
  };
}

async function ensureCockpitPublicFlowApi() {
  return {
    getRecent: async (limit?: number) => {
      const query = toQuery({ limit: limit ?? 50 });
      const response = await authGet<{ items: unknown[] }>(
        `/api/publicflow/recent${query}`,
      );
      return response.items;
    },
    getThemes: async (windowDays: 7 | 30, limit?: number) => {
      const query = toQuery({ windowDays, limit: limit ?? 10 });
      const response = await authGet<{ items: unknown[] }>(
        `/api/publicflow/themes${query}`,
      );
      return response.items;
    },
    getCandidates: async (
      themeId: number,
      options?: {
        minPriority?: "critical" | "high" | "medium" | "low";
        minConfidence?: number;
      },
    ) => {
      const query = toQuery({
        themeId,
        minPriority: options?.minPriority,
        minConfidence:
          typeof options?.minConfidence === "number"
            ? options.minConfidence
            : undefined,
      });
      const response = await authGet<{ items: unknown[] }>(
        `/api/publicflow/candidates${query}`,
      );
      return response.items;
    },
    getValuations: async (tickers: string[]) => {
      const response = await authRequest<{ items: Record<string, unknown> }>(
        "/api/publicflow/valuations",
        {
          method: "POST",
          body: JSON.stringify({ tickers }),
        },
      );
      return response.items;
    },
    refresh: async () => {
      return authRequest<{ ok: boolean; ts: number }>(
        "/api/publicflow/refresh",
        {
          method: "POST",
          body: JSON.stringify({}),
        },
      );
    },
  };
}

async function ensureCockpitEdgarIntelApi() {
  return {
    getFlowIntel: async (windowDays?: number, limit?: number) => {
      const query = toQuery({
        windowDays: Number.isFinite(windowDays) ? windowDays : 14,
        limit: Number.isFinite(limit) ? limit : 180,
      });
      const response = await authGet<{ payload: unknown }>(
        `/api/sec/edgar/flow-intel${query}`,
      );
      return response.payload;
    },
    getFlowIntelDigest: async (scopeId?: string, limit?: number) => {
      const query = toQuery({
        scopeId:
          typeof scopeId === "string" && scopeId.trim() ? scopeId : "global",
        limit: Number.isFinite(limit) ? limit : 8,
      });
      return authGet<unknown>(`/api/sec/edgar/flow-intel/digest${query}`);
    },
  };
}

async function ensureCockpitTradingApi() {
  return {
    placeOrder: async (req: AnyRecord) =>
      authRequest<{ orderId: string; accepted: boolean; reason?: string }>(
        "/api/order/place",
        {
          method: "POST",
          body: JSON.stringify(req),
        },
      ),
    cancelOrder: async (orderId: string) => {
      const response = await authRequest<{ ok: boolean }>("/api/order/cancel", {
        method: "POST",
        body: JSON.stringify({ orderId }),
      });
      return response.ok;
    },
    getOrders: async () => {
      const response = await authGet<{ items: unknown[] }>("/api/order/orders");
      return response.items;
    },
    getPositions: async () => {
      const response = await authGet<{ items: unknown[] }>(
        "/api/order/positions",
      );
      return response.items;
    },
    getAccount: async () => {
      const response = await authGet<{ account: unknown }>(
        "/api/order/account",
      );
      return response.account;
    },
    onEvent: (_handler: (event: unknown) => void) => () => undefined,
  };
}

async function ensureCockpitAiResearchApi() {
  return {
    getConfig: async () => authGet<unknown>("/api/ai/research/config"),
    setConfig: async (config: unknown) => {
      return authRequest<{ ok?: boolean }>("/api/ai/research/config", {
        method: "PUT",
        body: JSON.stringify(config ?? {}),
      });
    },
    runNow: async (manualItems?: Array<{ title: string; text: string }>) => {
      return authRequest<{ ok?: boolean; error?: string }>(
        "/api/ai/research/run",
        {
          method: "POST",
          body: JSON.stringify({ manualItems: manualItems ?? [] }),
        },
      );
    },
    listBriefs: async (limit?: number) => {
      const query = toQuery({ limit: limit ?? 5 });
      return authGet<unknown>(`/api/ai/research/briefs${query}`);
    },
    getStatus: async () => authGet<unknown>("/api/ai/research/status"),
    checkRuntime: async () => {
      try {
        const result = await authGet<{ models?: string[] }>("/api/ai/models");
        const models = Array.isArray(result?.models)
          ? result.models.filter((model): model is string => typeof model === "string" && model.length > 0)
          : [];
        return {
          available: models.length > 0,
          message: models.length > 0 ? `Detected ${models.length} AI model(s)` : "No AI models detected",
          version: "backend-bridge",
          cloudModelsAvailable: models.length,
        };
      } catch (error) {
        return {
          available: false,
          message: error instanceof Error ? error.message : String(error),
          version: "backend-bridge",
          cloudModelsAvailable: 0,
        };
      }
    },
    listModels: async () => authGet<{ models?: string[] }>("/api/ai/models"),
    testModelConnection: async () => ({
      ok: false,
      message: "Model connection tests are not available through the browser bridge.",
    }),
    onBriefs: (_handler: (briefs: unknown[]) => void) => () => undefined,
    onStatus: (_handler: (status: unknown) => void) => () => undefined,
    onProgress: (_handler: (progress: unknown) => void) => () => undefined,
  };
}

async function ensureCockpitAiStewardApi() {
  return {
    getOverview: async () => authGet<unknown>("/api/ai/steward/overview"),
    getConfig: async () => authGet<unknown>("/api/ai/steward/config"),
    getHealth: async () => authGet<unknown>("/api/ai/steward/health"),
    getIncidentDigest: async () =>
      authGet<unknown>("/api/ai/steward/incident-digest"),
    getFindings: async (module?: string) => {
      const query = toQuery({ module });
      return authGet<unknown>(`/api/ai/steward/findings${query}`);
    },
    getTasks: async () => authGet<unknown>("/api/ai/steward/tasks"),
    dismissFinding: async (findingId: string) => {
      return authRequest<unknown>(`/api/ai/steward/findings/${encodeURIComponent(findingId)}`, {
        method: "DELETE",
      });
    },
    checkHealth: async () => {
      return authRequest<unknown>("/api/ai/steward/check-health", {
        method: "POST",
        body: JSON.stringify({}),
      });
    },
    setConfig: async (patch: unknown) => {
      return authRequest<unknown>("/api/ai/steward/config", {
        method: "PUT",
        body: JSON.stringify(patch ?? {}),
      });
    },
    runModule: async (module: string) => {
      return authRequest<unknown>("/api/ai/steward/run-module", {
        method: "POST",
        body: JSON.stringify({ moduleName: module }),
      });
    },
    applyTask: async (taskId: string) => {
      return authRequest<unknown>(`/api/ai/steward/tasks/${encodeURIComponent(taskId)}/apply`, {
        method: "POST",
        body: JSON.stringify({}),
      });
    },
    testResponse: async () => ({
      ok: false,
      message: "AI steward test responses are not available through the browser bridge.",
    }),
    onUpdate: (_handler: (overview: unknown) => void) => () => undefined,
  };
}

async function ensureCockpitGwmdMapApi() {
  const toGwmdNode = (company: Record<string, unknown>) => {
    const id = typeof company.ticker === "string" ? company.ticker : "";
    return {
      id,
      label:
        typeof company.name === "string" && company.name.trim().length > 0
          ? company.name
          : id,
      tickers: id ? [id] : [],
      metadata: {
        hqLat: typeof company.hq_lat === "number" ? company.hq_lat : null,
        hqLon: typeof company.hq_lon === "number" ? company.hq_lon : null,
        hqCity:
          typeof company.hq_city === "string" ? company.hq_city : undefined,
        hqCountry:
          typeof company.hq_country === "string"
            ? company.hq_country
            : undefined,
        industry:
          typeof company.industry === "string" ? company.industry : undefined,
      },
    };
  };

  const toGwmdEdge = (edge: Record<string, unknown>) => ({
    id:
      typeof edge.id === "string"
        ? edge.id
        : `${String(edge.from_ticker ?? edge.from ?? "")}-${String(edge.to_ticker ?? edge.to ?? "")}-${String(edge.relation_type ?? edge.kind ?? "linked_to")}`,
    from: String(edge.from_ticker ?? edge.from ?? ""),
    to: String(edge.to_ticker ?? edge.to ?? ""),
    kind: String(edge.relation_type ?? edge.kind ?? "linked_to"),
    weight: typeof edge.weight === "number" ? edge.weight : 0.5,
    confidence:
      typeof edge.confidence === "number" ? edge.confidence : undefined,
    evidence: typeof edge.evidence === "string" ? edge.evidence : undefined,
  });

  return {
    search: async (
      ticker: string,
      options?: {
        model?: unknown;
        hops?: number;
        refresh?: boolean;
        sourceMode?: "cache_only" | "hybrid" | "fresh";
      },
    ) => {
      const selectedModel =
        typeof options?.model === "string"
          ? options.model
          : (options?.model as { model?: string } | undefined)?.model;
      const data = await authRequest<{
        ticker: string;
        nodes?: Array<{ id: string; label?: string; type?: string }>;
        edges?: Array<{
          source: string;
          target: string;
          type: string;
          weight?: number;
        }>;
        insights?: string[];
      }>("/api/ai/supplychain/generate", {
        method: "POST",
        body: JSON.stringify({
          ticker,
          model: selectedModel ?? undefined,
          hops: options?.hops,
          refresh: options?.refresh,
        }),
      });

      const nodes = Array.isArray(data?.nodes) ? data.nodes : [];
      const edges = Array.isArray(data?.edges) ? data.edges : [];
      return {
        success: true,
        status: "ok",
        companies: nodes.map((node) => ({
          ticker: node.id,
          name: node.label ?? node.id,
        })),
        edges: edges.map((edge) => ({
          from: edge.source,
          to: edge.target,
          kind: edge.type,
          weight: edge.weight ?? 0.5,
          confidence: edge.weight ?? 0.5,
          evidence: "",
        })),
        meta: {
          status: "ok" as const,
          source: "fresh" as const,
          degraded: false,
          unlocatedCount: 0,
          hypothesisRatio: 0,
          primaryRelationshipCount: edges.length,
          hop2SeedCount: 0,
          requestedHops:
            typeof options?.hops === "number" ? options.hops : 2,
          sourceMode: options?.sourceMode,
          expandedTickerCount: Math.max(0, nodes.length - 1),
        },
      };
    },
    loadAll: async () => {
      try {
        const cloud = await authGet<{ data?: { companies?: unknown[]; relationships?: unknown[] } }>(
          "/api/ai/gwmd/sync/pull",
        );
        const companies = Array.isArray(cloud?.data?.companies)
          ? (cloud.data.companies as Record<string, unknown>[])
          : [];
        const relationships = Array.isArray(cloud?.data?.relationships)
          ? (cloud.data.relationships as Record<string, unknown>[])
          : [];
        return {
          success: true,
          status: "ok",
          companies,
          graph: {
            nodes: companies.map(toGwmdNode),
            edges: relationships.map(toGwmdEdge),
          },
          meta: {
            source: "cloud_snapshot",
            unlocatedCount: companies.filter(
              (company) =>
                typeof company.hq_lat !== "number" ||
                typeof company.hq_lon !== "number",
            ).length,
          },
        };
      } catch {
        return {
          success: true,
          status: "ok",
          companies: [],
          graph: { nodes: [], edges: [] },
          meta: { source: "empty_bridge", unlocatedCount: 0 },
        };
      }
    },
    loadScoped: async (ticker: string) => {
      const snapshot = await authGet<{ data?: { companies?: unknown[]; relationships?: unknown[] } }>(
        `/api/ai/gwmd/sync/pull?since=${encodeURIComponent(ticker)}`,
      ).catch(() => ({ data: { companies: [], relationships: [] } }));
      const companies = Array.isArray(snapshot?.data?.companies)
        ? (snapshot.data.companies as Record<string, unknown>[]).filter(
            (company) =>
              typeof company.ticker === "string" &&
              company.ticker.toUpperCase().includes(ticker.trim().toUpperCase()),
          )
        : [];
      const relationships = Array.isArray(snapshot?.data?.relationships)
        ? (snapshot.data.relationships as Record<string, unknown>[]).filter(
            (edge) => {
              const fromTicker = String(edge.from_ticker ?? "").toUpperCase();
              const toTicker = String(edge.to_ticker ?? "").toUpperCase();
              const normalized = ticker.trim().toUpperCase();
              return fromTicker === normalized || toTicker === normalized;
            },
          )
        : [];
      return {
        success: true,
        status: "ok",
        companies,
        graph: {
          nodes: companies.map(toGwmdNode),
          edges: relationships.map(toGwmdEdge),
        },
        meta: {
          source: "cloud_scoped_snapshot",
          focalTicker: ticker.trim().toUpperCase(),
          unlocatedCount: companies.filter(
            (company) =>
              typeof company.hq_lat !== "number" ||
              typeof company.hq_lon !== "number",
          ).length,
        },
      };
    },
    clear: async () => ({ success: true }),
    syncPush: async (payload: {
      companies: unknown[];
      relationships: unknown[];
      replace?: boolean;
    }) => {
      return authRequest<unknown>("/api/ai/gwmd/sync/push", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    syncPull: async (payload?: { since?: string; replace?: boolean }) => {
      const query = toQuery({ since: payload?.since });
      return authGet<unknown>(`/api/ai/gwmd/sync/pull${query}`);
    },
    syncStatus: async () => authGet<unknown>("/api/ai/gwmd/sync/status"),
    enterDisplaySurface: async () => ({
      enabled: false,
      mode: "standard",
      monitorCount: 0,
      selectedMonitorIds: [],
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    }),
    exitDisplaySurface: async () => ({
      enabled: false,
      mode: "standard",
      monitorCount: 0,
      selectedMonitorIds: [],
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    }),
    getDisplaySurfaceState: async () => ({
      enabled: false,
      mode: "standard",
      monitorCount: 0,
      selectedMonitorIds: [],
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    }),
    listDisplayMonitors: async () => [],
    getDisplaySurfaceSelection: async () => ({
      monitorIds: [],
      primaryMonitorId: null,
      mode: "standard",
    }),
    setDisplaySurfaceSelection: async (payload: {
      monitorIds?: number[];
      primaryMonitorId?: number | null;
      mode?: "standard" | "wall" | "analyst" | "mirror";
    }) => ({
      monitorIds: payload.monitorIds ?? [],
      primaryMonitorId: payload.primaryMonitorId ?? null,
      mode: payload.mode ?? "standard",
    }),
    onDisplaySurfaceChanged: (_handler: (state: unknown) => void) =>
      () => undefined,
    onGraphUpdated: (_handler: () => void) => () => undefined,
    repairGeo: async () => ({ attempted: 0, updated: 0 }),
  };
}

async function ensureCockpitSupplyChainApi() {
  return {
    generate: async (options: AnyRecord) => {
      return authRequest<unknown>("/api/supplychain/generate", {
        method: "POST",
        body: JSON.stringify(options),
      });
    },
    clearCache: async (ticker: string) => {
      const response = await authRequest<{ ok: boolean }>(
        "/api/supplychain/clear-cache",
        {
          method: "POST",
          body: JSON.stringify({ key: ticker }),
        },
      );
      return response;
    },
    listCached: async () => {
      const response = await authGet<{ keys: string[] }>(
        "/api/supplychain/cache",
      );
      return response.keys;
    },
    askAdvisor: async (payload: AnyRecord) => {
      return authRequest<unknown>("/api/supplychain/advisor-ask", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    generateForGwmd: async (ticker: string) => {
      const response = await authRequest<{
        success: boolean;
        data?: { categories?: unknown[]; graph?: { edges?: unknown[] } };
        error?: string;
      }>("/api/supplychain/generate", {
        method: "POST",
        body: JSON.stringify({ ticker }),
      });
      return {
        success: response.success,
        status: response.success ? "ok" : "error",
        companies: response.data?.categories ?? [],
        edges: response.data?.graph?.edges ?? [],
        meta: {},
        error: response.error,
      };
    },
  };
}

export async function installCockpitBackendBridge() {
  const existingCockpit = window.cockpit ?? {};

  const [
    config,
    congress,
    publicFlow,
    edgarIntel,
    trading,
    supplyChain,
    aiResearch,
    aiSteward,
    gwmdMap,
  ] = await Promise.all([
    ensureCockpitConfigApi(),
    ensureCockpitCongressApi(),
    ensureCockpitPublicFlowApi(),
    ensureCockpitEdgarIntelApi(),
    ensureCockpitTradingApi(),
    ensureCockpitSupplyChainApi(),
    ensureCockpitAiResearchApi(),
    ensureCockpitAiStewardApi(),
    ensureCockpitGwmdMapApi(),
  ]);

  const bridge = {
    ...existingCockpit,
    config: existingCockpit.config ?? config,
    congress: existingCockpit.congress ?? congress,
    publicFlow: existingCockpit.publicFlow ?? publicFlow,
    edgarIntel: existingCockpit.edgarIntel ?? edgarIntel,
    trading: existingCockpit.trading ?? trading,
    supplyChain: existingCockpit.supplyChain ?? supplyChain,
    aiResearch: existingCockpit.aiResearch ?? aiResearch,
    aiSteward: existingCockpit.aiSteward ?? aiSteward,
    gwmdMap: existingCockpit.gwmdMap ?? gwmdMap,
  };

  window.cockpit = bridge as unknown as NonNullable<typeof window.cockpit>;
}

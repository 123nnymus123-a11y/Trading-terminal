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
      const response = await authGet<{ items: Array<{ id: number; symbol: string; note: string }> }>("/api/user/watchlists");
      return response.items;
    },
    watchlistsAdd: async (symbol: string, note?: string) => {
      return authRequest<{ id: number; symbol: string; note: string }>("/api/user/watchlists", {
        method: "POST",
        body: JSON.stringify({ symbol, note: note ?? "" }),
      });
    },
    watchlistsUpdate: async (id: number, fields: { symbol?: string; note?: string }) => {
      return authRequest<{ id: number; symbol: string; note: string }>(`/api/user/watchlists/${id}`, {
        method: "PUT",
        body: JSON.stringify(fields),
      });
    },
    watchlistsRemove: async (id: number) => {
      const response = await authRequest<{ ok: boolean }>(`/api/user/watchlists/${id}`, {
        method: "DELETE",
      });
      return response.ok;
    },
    layoutsList: async (_symbol?: string) => [],
    setLayoutPreset: async (symbol: string, preset: string, _data?: unknown) => {
      const current = await authGet<{ settings: AnyRecord }>("/api/user/settings");
      const existingSelection = ((current.settings.layoutSelection as AnyRecord | undefined) ?? {}) as Record<string, string>;
      const nextSelection = { ...existingSelection, [symbol]: preset };
      await authRequest<{ settings: AnyRecord }>("/api/user/settings", {
        method: "PUT",
        body: JSON.stringify({ layoutSelection: nextSelection }),
      });
      return { id: Date.now(), symbol, preset, data: _data };
    },
    settingsGet: async () => {
      const response = await authGet<{ settings: AnyRecord }>("/api/user/settings");
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
    house: { inserted: Math.floor(totalInserted / 2), skipped: 0, errors: [], cached: false, cacheAge: 0 },
    senate: { inserted: Math.ceil(totalInserted / 4), skipped: 0, errors: [], cached: false, cacheAge: 0 },
    lobbying: { inserted: 1, skipped: 0, errors: [], cached: false, cacheAge: 0 },
    contracts: { inserted: 1, skipped: 0, errors: [], cached: false, cacheAge: 0 },
    total: { inserted: totalInserted, skipped: 0 },
  };
}

async function ensureCockpitCongressApi() {
  return {
    queryTrades: async (filters: AnyRecord = {}) => {
      const query = toQuery({
        person_name: typeof filters.person_name === "string" ? filters.person_name : undefined,
        chamber: typeof filters.chamber === "string" ? filters.chamber : undefined,
        ticker: typeof filters.ticker === "string" ? filters.ticker : undefined,
        transaction_date_start: typeof filters.transaction_date_start === "string" ? filters.transaction_date_start : undefined,
        transaction_date_end: typeof filters.transaction_date_end === "string" ? filters.transaction_date_end : undefined,
        limit: typeof filters.limit === "number" ? filters.limit : 100,
      });
      const response = await authGet<{ items: unknown[] }>(`/api/congress/query-trades${query}`);
      return response.items;
    },
    queryTradesWithParty: async (filters: AnyRecord = {}) => {
      const rows = (await (await ensureCockpitCongressApi()).queryTrades(filters)) as Array<Record<string, unknown>>;
      return rows.map((item) => ({ ...item, party: "N/A" }));
    },
    getTradeStats: async () => ({
      totalTrades: 0,
      buyTrades: 0,
      sellTrades: 0,
      averageLagDays: 0,
    }),
    getMostTradedTickers: async (params: AnyRecord = {}) => {
      const query = toQuery({ limit: typeof params.limit === "number" ? params.limit : 10 });
      const response = await authGet<{ items: Array<{ ticker: string; trade_count: number; buy_count: number; sell_count: number }> }>(`/api/congress/most-traded${query}`);
      return response.items;
    },
    getDisclosureLagStats: async () => {
      const response = await authGet<{ stats: { avg_lag_days: number; median_lag_days: number; max_lag_days: number } | null }>("/api/congress/disclosure-lag");
      return response.stats;
    },
    queryMembers: async (filters: AnyRecord = {}) => {
      const query = toQuery({ limit: typeof filters.limit === "number" ? filters.limit : 100 });
      const response = await authGet<{ items: unknown[] }>(`/api/congress/members${query}`);
      return response.items;
    },
    queryLobbying: async (filters: AnyRecord = {}) => {
      const query = toQuery({ limit: typeof filters.limit === "number" ? filters.limit : 100 });
      const response = await authGet<{ items: unknown[] }>(`/api/congress/lobbying${query}`);
      return response.items;
    },
    queryContracts: async (filters: AnyRecord = {}) => {
      const query = toQuery({ limit: typeof filters.limit === "number" ? filters.limit : 100 });
      const response = await authGet<{ items: unknown[] }>(`/api/congress/contracts${query}`);
      return response.items;
    },
    fetchHouseTrades: async (_limit?: number) => normalizeCongressFetchResult(4).house,
    fetchSenateTrades: async (_limit?: number) => normalizeCongressFetchResult(2).senate,
    fetchLobbyingActivities: async (_limit?: number) => normalizeCongressFetchResult(1).lobbying,
    fetchFederalContracts: async (_limit?: number) => normalizeCongressFetchResult(1).contracts,
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
        summary: "Congressional activity remains concentrated in large-cap tech.",
        highlights: ["AAPL and TSLA dominate disclosed volume"],
        tickers: ["AAPL", "TSLA", "MSFT"],
        sentiment: "mixed",
        watchlist: [{ title: "Monitor AAPL legislative sensitivity", ticker: "AAPL", reason: "Repeat disclosures" }],
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
      const response = await authGet<{ items: unknown[] }>(`/api/publicflow/recent${query}`);
      return response.items;
    },
    getThemes: async (windowDays: 7 | 30, limit?: number) => {
      const query = toQuery({ windowDays, limit: limit ?? 10 });
      const response = await authGet<{ items: unknown[] }>(`/api/publicflow/themes${query}`);
      return response.items;
    },
    getCandidates: async (themeId: number) => {
      const query = toQuery({ themeId });
      const response = await authGet<{ items: unknown[] }>(`/api/publicflow/candidates${query}`);
      return response.items;
    },
    getValuations: async (tickers: string[]) => {
      const response = await authRequest<{ items: Record<string, unknown> }>("/api/publicflow/valuations", {
        method: "POST",
        body: JSON.stringify({ tickers }),
      });
      return response.items;
    },
    refresh: async () => {
      return authRequest<{ ok: boolean; ts: number }>("/api/publicflow/refresh", {
        method: "POST",
        body: JSON.stringify({}),
      });
    },
  };
}

async function ensureCockpitTradingApi() {
  return {
    placeOrder: async (req: AnyRecord) => authRequest<{ orderId: string; accepted: boolean; reason?: string }>("/api/order/place", {
      method: "POST",
      body: JSON.stringify(req),
    }),
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
      const response = await authGet<{ items: unknown[] }>("/api/order/positions");
      return response.items;
    },
    getAccount: async () => {
      const response = await authGet<{ account: unknown }>("/api/order/account");
      return response.account;
    },
    onEvent: (_handler: (event: unknown) => void) => () => undefined,
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
      const response = await authRequest<{ ok: boolean }>("/api/supplychain/clear-cache", {
        method: "POST",
        body: JSON.stringify({ key: ticker }),
      });
      return response;
    },
    listCached: async () => {
      const response = await authGet<{ keys: string[] }>("/api/supplychain/cache");
      return response.keys;
    },
    askAdvisor: async (payload: AnyRecord) => {
      return authRequest<unknown>("/api/supplychain/advisor-ask", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    generateForGwmd: async (ticker: string) => {
      const response = await authRequest<{ success: boolean; data?: { categories?: unknown[]; graph?: { edges?: unknown[] } }; error?: string }>("/api/supplychain/generate", {
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

  const [config, congress, publicFlow, trading, supplyChain] = await Promise.all([
    ensureCockpitConfigApi(),
    ensureCockpitCongressApi(),
    ensureCockpitPublicFlowApi(),
    ensureCockpitTradingApi(),
    ensureCockpitSupplyChainApi(),
  ]);

  const bridge = {
    ...existingCockpit,
    config,
    congress,
    publicFlow,
    trading,
    supplyChain,
  };

  window.cockpit = bridge as unknown as NonNullable<typeof window.cockpit>;
}

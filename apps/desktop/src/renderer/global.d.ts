import type {
  CalendarInsightRequest,
  CalendarInsightResponse,
  DisclosureEvent,
  SectorTheme,
  WatchlistCandidate,
  ValuationTag,
} from '@tc/shared';
import type {
  CongressionalTrade,
  CongressionalMember,
  LobbyingActivity,
  FederalContract,
  CompanyTickerMapping,
  CongressDataIngestionLog,
} from '@tc/shared';
import type {
  SupplyChainAdvisorRequest,
  SupplyChainAdvisorResponse,
  SupplyChainGraph,
} from '@tc/shared/supplyChain';
import type { ApiCredentialRecord, ApiHubSnapshot } from '../shared/apiHub';

export {};

type CongressAiScanSourceHit = {
  title: string;
  url: string;
  snippet: string;
};

type CongressAiScanSource = {
  id: string;
  name: string;
  hits: CongressAiScanSourceHit[];
};

type CongressAiScanPayload = {
  generatedAt: string;
  summary: string;
  highlights: string[];
  tickers: string[];
  sentiment: 'bullish' | 'bearish' | 'neutral' | 'mixed';
  watchlist: Array<{ title: string; ticker?: string; reason?: string }>;
  sources: CongressAiScanSource[];
  contextPreview: string;
};

type CongressAiScanResponse = {
  success: boolean;
  data?: CongressAiScanPayload;
  error?: string;
};

declare global {
  type StreamSource = 'demo' | 'replay' | 'live' | 'unknown';

  type ReplayStatus = {
    playing: boolean;
    speed: number;
    cursorTs: number;
    startTs: number;
    endTs: number;
    dataset: string;
  };

  type StreamStatus = { source: 'demo' | 'replay' | 'live'; replay?: ReplayStatus | null };

  type StreamingApi = {
    version?: string;

    // Event subscription helpers (your preload already exposes these)
    onEvents?: (cb: (batch: any[]) => void) => (() => void) | void;
    onEventBatch?: (cb: (batch: any[]) => void) => (() => void) | void;
    onEventsBatch?: (cb: (batch: any[]) => void) => (() => void) | void;

    subscribe?: (cb: (ev: any) => void) => (() => void) | void;
    subscribeBatch?: (cb: (batch: any[]) => void) => (() => void) | void;

    setSource?: (source: 'demo' | 'replay' | 'live') => Promise<void> | void;
    getStatus?: () => Promise<StreamStatus> | StreamStatus;

    replay?: {
      play: () => Promise<void> | void;
      pause: () => Promise<void> | void;
      setSpeed: (speed: number) => Promise<void> | void;
      scrubTo: (ts: number) => Promise<void> | void;
    };
  };

  interface Window {
    streaming?: StreamingApi;
    cockpit?: {
      auth?: {
        login?: (payload: {
          username?: string;
          email?: string;
          password: string;
          licenseKey: string;
        }) => Promise<{
          ok: boolean;
          session?: {
            token: string;
            refreshToken: string;
            expiresAtMs?: number;
            expiresInSeconds?: number;
            user: {
              id: string;
              email: string;
              username?: string;
              tier: 'starter' | 'pro' | 'enterprise';
              licenseKey: string;
            };
          };
          error?: string;
        }>;
        signup?: (payload: {
          username: string;
          email: string;
          password: string;
          licenseKey: string;
        }) => Promise<{
          ok: boolean;
          session?: {
            token: string;
            refreshToken: string;
            expiresAtMs?: number;
            expiresInSeconds?: number;
            user: {
              id: string;
              email: string;
              username?: string;
              tier: 'starter' | 'pro' | 'enterprise';
              licenseKey: string;
            };
          };
          error?: string;
        }>;
        refresh?: () => Promise<{ ok: boolean; session?: unknown; error?: string }>;
        getSession?: () => Promise<any | null>;
        setSession?: (session: any | null) => Promise<boolean>;
        logout?: () => Promise<boolean>;
        getToken?: () => Promise<string | null>;
      };
      events?: {
        subscribe?: (handler: (batch: any[]) => void) => (() => void) | void;
      };
      config?: {
        watchlistsList?: () => Promise<Array<{ id: number; symbol: string; note: string }>>;
        watchlistsAdd?: (
          symbol: string,
          note?: string,
        ) => Promise<{ id: number; symbol: string; note: string }>;
        watchlistsUpdate?: (
          id: number,
          fields: { symbol?: string; note?: string },
        ) => Promise<{ id: number; symbol: string; note: string } | null>;
        watchlistsRemove?: (id: number) => Promise<boolean>;
        layoutsList?: (
          symbol?: string,
        ) => Promise<Array<{ id: number; symbol: string | null; preset: string; data: unknown }>>;
        setLayoutPreset?: (
          symbol: string,
          preset: string,
          data?: unknown,
        ) => Promise<{ id: number; symbol: string; preset: string; data: unknown }>;
        settingsGet?: () => Promise<Record<string, unknown>>;
        settingsSet?: (next: Record<string, unknown>) => Promise<boolean>;
        backendUrlGet?: () => Promise<string>;
        backendUrlSet?: (nextUrl: string) => Promise<boolean>;
      };
      journal?: {
        listEntries?: (limit?: number) => Promise<Array<{ id: number; symbol: string; note: string }>>;
        watchlistsAdd?: (
          symbol: string,
          note?: string,
        ) => Promise<{ id: number; symbol: string; note: string }>;
        watchlistsUpdate?: (
          id: number,
          fields: { symbol?: string; note?: string },
        ) => Promise<{ id: number; symbol: string; note: string } | null>;
        watchlistsRemove?: (id: number) => Promise<boolean>;
        layoutsList?: (
          symbol?: string,
        ) => Promise<Array<{ id: number; symbol: string | null; preset: string; data: unknown }>>;
        setLayoutPreset?: (
          symbol: string,
          preset: string,
          data?: unknown,
        ) => Promise<{ id: number; symbol: string; preset: string; data: unknown }>;
        settingsGet?: () => Promise<Record<string, unknown>>;
        settingsSet?: (next: Record<string, unknown>) => Promise<boolean>;
        backendUrlGet?: () => Promise<string>;
        backendUrlSet?: (nextUrl: string) => Promise<boolean>;
      };
      secrets?: {
        set?: (account: string, secret: string, passphrase?: string) => Promise<boolean>;
        get?: (account: string, passphrase?: string) => Promise<string | null>;
      };
      trading?: {
        placeOrder?: (req: any) => Promise<{ orderId: string; accepted: boolean; reason?: string }>;
        cancelOrder?: (orderId: string) => Promise<boolean>;
        getOrders?: () => Promise<any[]>;
        getPositions?: () => Promise<any[]>;
        getAccount?: () => Promise<any>;
        onEvent?: (handler: (event: any) => void) => () => void;
      };
      risk?: {
        onEvent?: (handler: (event: any) => void) => () => void;
      };
      backendWs?: {
        connect?: () => Promise<boolean>;
        disconnect?: () => void;
        getState?: () => 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed' | 'error';
        subscribe?: (symbols: string[]) => string[];
        unsubscribe?: (symbols: string[]) => string[];
        onMessage?: (handler: (message: unknown) => void) => () => void;
        onStateChange?: (
          handler: (state: 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed' | 'error') => void,
        ) => () => void;
      };
      publicFlow?: {
        getRecent?: (limit?: number) => Promise<DisclosureEvent[]>;
        getThemes?: (windowDays: 7 | 30, limit?: number) => Promise<SectorTheme[]>;
        getCandidates?: (themeId: number) => Promise<WatchlistCandidate[]>;
        getValuations?: (tickers: string[]) => Promise<Record<string, ValuationTag>>;
        refresh?: () => Promise<{
          ok: boolean;
          ts: number;
          error?: string;
          ingest?: unknown;
          recompute?: unknown;
          started?: number;
        }>;
      };
      aiResearch?: {
        getConfig?: (authToken?: string) => Promise<any>;
        setConfig?: (next: any, authToken?: string) => Promise<any>;
        runNow?: (manualItems?: Array<{ title: string; text: string }>, authToken?: string) => Promise<any>;
        listBriefs?: (limit?: number, authToken?: string) => Promise<any[]>;
        getStatus?: (authToken?: string) => Promise<any>;
        checkRuntime?: () => Promise<any>;
        listModels?: () => Promise<{ ok: boolean; models?: string[]; error?: string }>;
        onBriefs?: (handler: (briefs: any[]) => void) => () => void;
        onStatus?: (handler: (status: any) => void) => () => void;
        onProgress?: (handler: (progress: any) => void) => () => void;
      };
      aiSteward?: {
        getOverview?: (authToken?: string) => Promise<any>;
        getConfig?: (authToken?: string) => Promise<any>;
        setConfig?: (patch: any, authToken?: string) => Promise<any>;
        runModule?: (module: string, authToken?: string) => Promise<any>;
        applyTask?: (taskId: string, authToken?: string) => Promise<any>;
        testResponse?: (prompt?: string) => Promise<any>;
        onUpdate?: (handler: (overview: any) => void) => () => void;
      };
      centralAI?: {
        track?: (interaction: Record<string, unknown>, authToken?: string) => Promise<any>;
        predict?: (limit?: number, authToken?: string) => Promise<any>;
        validate?: (response: string, context: unknown) => Promise<any>;
        getIntelligence?: () => Promise<any>;
        getStats?: () => Promise<any>;
        onPreloadIntelligence?: (handler: (data: unknown) => void) => () => void;
      };
      externalFeeds?: {
        getConfig?: () => Promise<any>;
        setConfig?: (next: any) => Promise<any>;
        testProvider?: (
          providerId: string,
          credentials?: Record<string, string>,
        ) => Promise<{ ok: boolean; message: string }>;
        getCotSummary?: (symbols: string[]) => Promise<any[]>;
        getJoltsSeries?: () => Promise<any[]>;
        getSecEvents?: (params: { tickers?: string[]; limit?: number }) => Promise<any[]>;
      };
      economicCalendar?: {
        generateInsights?: (
          request: CalendarInsightRequest,
          preference?: string,
          authToken?: string,
        ) => Promise<{ success: boolean; result?: CalendarInsightResponse; error?: string }>;
      };
      supplyChain?: {
        generate?: (options: {
          ticker: string;
          globalTickers?: string[];
          strictMode?: boolean;
          includeHypothesis?: boolean;
          hops?: number;
          minEdgeWeight?: number;
          refresh?: boolean;
          authToken?: string;
        }) => Promise<any>;
        openGlobalMap?: (tickers: string[]) => Promise<any>;
        clearCache?: (ticker: string) => Promise<any>;
        listCached?: () => Promise<any>;
        askAdvisor?: (payload: SupplyChainAdvisorRequest) => Promise<SupplyChainAdvisorResponse>;
        generateForGwmd?: (
          ticker: string,
          options: { model: unknown },
        ) => Promise<{
          success: boolean;
          status?: 'ok' | 'degraded_cache' | 'parse_fail' | 'error';
          companies?: Array<Record<string, unknown>>;
          edges?: SupplyChainGraph['edges'];
          meta?: Record<string, unknown>;
          error?: string;
        }>;
      };
      gwmdMap?: {
        search?: (
          ticker: string,
          options: { model: unknown },
        ) => Promise<{
          success: boolean;
          status?: 'ok' | 'degraded_cache' | 'parse_fail' | 'error';
          companies?: Array<Record<string, unknown>>;
          edges?: SupplyChainGraph['edges'];
          meta?: Record<string, unknown>;
          error?: string;
        }>;
        loadAll?: () => Promise<{
          success: boolean;
          status?: 'ok' | 'error';
          companies?: Array<Record<string, unknown>>;
          graph?: SupplyChainGraph | null;
          meta?: { unlocatedCount?: number };
          error?: string;
        }>;
        clear?: () => Promise<{ success: boolean; error?: string }>;
      };
      congress?: {
        queryTrades?: (filters: any) => Promise<CongressionalTrade[]>;
        queryTradesWithParty?: (
          filters: any,
        ) => Promise<Array<CongressionalTrade & { party?: string | null }>>;
        getTradeStats?: (ticker: string, dateStart?: string, dateEnd?: string) => Promise<any>;
        getMostTradedTickers?: (params: {
          dateStart?: string;
          dateEnd?: string;
          limit?: number;
        }) => Promise<
          Array<{ ticker: string; trade_count: number; buy_count: number; sell_count: number }>
        >;
        getDisclosureLagStats?: () => Promise<{
          avg_lag_days: number;
          median_lag_days: number;
          max_lag_days: number;
        } | null>;
        queryMembers?: (filters: any) => Promise<CongressionalMember[]>;
        queryLobbying?: (filters: any) => Promise<LobbyingActivity[]>;
        queryContracts?: (filters: any) => Promise<FederalContract[]>;
        insertTrades?: (trades: any[]) => Promise<number[]>;
        insertLobbying?: (activities: any[]) => Promise<number[]>;
        insertContracts?: (contracts: any[]) => Promise<number[]>;
        upsertMembers?: (members: any[]) => Promise<number[]>;
        findTicker?: (companyName: string) => Promise<CompanyTickerMapping | null>;
        insertIngestionLog?: (log: any) => Promise<number>;
        queryIngestionLogs?: (
          domain?: string,
          limit?: number,
        ) => Promise<CongressDataIngestionLog[]>;
        fetchHouseTrades?: (limit?: number) => Promise<{
          inserted: number;
          skipped: number;
          errors: string[];
          cached: boolean;
          cacheAge?: number;
        }>;
        fetchSenateTrades?: (limit?: number) => Promise<{
          inserted: number;
          skipped: number;
          errors: string[];
          cached: boolean;
          cacheAge?: number;
        }>;
        fetchLobbyingActivities?: (limit?: number) => Promise<{
          inserted: number;
          skipped: number;
          errors: string[];
          cached: boolean;
          cacheAge?: number;
        }>;
        fetchFederalContracts?: (limit?: number) => Promise<{
          inserted: number;
          skipped: number;
          errors: string[];
          cached: boolean;
          cacheAge?: number;
        }>;
        fetchAllTrades?: (limit?: number) => Promise<{
          house: {
            inserted: number;
            skipped: number;
            errors: string[];
            cached: boolean;
            cacheAge?: number;
          };
          senate: {
            inserted: number;
            skipped: number;
            errors: string[];
            cached: boolean;
            cacheAge?: number;
          };
          lobbying: {
            inserted: number;
            skipped: number;
            errors: string[];
            cached: boolean;
            cacheAge?: number;
          };
          contracts: {
            inserted: number;
            skipped: number;
            errors: string[];
            cached: boolean;
            cacheAge?: number;
          };
          total: { inserted: number; skipped: number };
        }>;
        scanAiSources?: () => Promise<CongressAiScanResponse>;
      };
      apiKey?: {
        validate?: (provider: string, credentials: Record<string, string>) => Promise<any>;
        validateStored?: (
          apiKeyId: string,
          provider: string,
          fields: Array<{ key: string; account: string }>,
          config?: Record<string, string>,
        ) => Promise<any>;
      };
      apiHub?: {
        list?: () => Promise<ApiHubSnapshot>;
        save?: (record: ApiCredentialRecord) => Promise<ApiHubSnapshot>;
        remove?: (id: string) => Promise<ApiHubSnapshot>;
        openWindow?: () => Promise<boolean>;
        onChanged?: (handler: (snapshot: ApiHubSnapshot) => void) => (() => void) | void;
      };
      smartRouting?: {
        openWindow?: () => Promise<boolean>;
      };
      congress?: {
        queryTrades?: (filters: unknown) => Promise<any>;
        queryTradesWithParty?: (filters: unknown) => Promise<any>;
        getTradeStats?: (ticker: string, dateStart?: string, dateEnd?: string) => Promise<any>;
        getMostTradedTickers?: (params: {
          dateStart?: string;
          dateEnd?: string;
          limit?: number;
        }) => Promise<any>;
        getDisclosureLagStats?: () => Promise<any>;
        queryMembers?: (filters: unknown) => Promise<any>;
        queryLobbying?: (filters: unknown) => Promise<any>;
        queryContracts?: (filters: unknown) => Promise<any>;
        insertTrades?: (trades: unknown[]) => Promise<any>;
        insertLobbying?: (activities: unknown[]) => Promise<any>;
        insertContracts?: (contracts: unknown[]) => Promise<any>;
        upsertMembers?: (members: unknown[]) => Promise<any>;
        findTicker?: (companyName: string) => Promise<any>;
        insertIngestionLog?: (log: unknown) => Promise<any>;
        queryIngestionLogs?: (domain?: string, limit?: number) => Promise<any>;
        fetchHouseTrades?: (limit?: number) => Promise<any>;
        fetchSenateTrades?: (limit?: number) => Promise<any>;
        fetchLobbyingActivities?: (limit?: number) => Promise<any>;
        fetchFederalContracts?: (limit?: number) => Promise<any>;
        fetchAllTrades?: (limit?: number) => Promise<any>;
        scanAiSources?: () => Promise<any>;
        analyzeTrade?: (
          tradeId: string,
          tradeData: Record<string, unknown>,
          model?: string,
          authToken?: string,
        ) => Promise<any>;
        getAiWatchlist?: (authToken?: string) => Promise<any>;
        addAiWatchlist?: (
          ticker: string,
          reason: string,
          priority?: number,
          authToken?: string,
        ) => Promise<any>;
        removeAiWatchlist?: (watchlistId: number, authToken?: string) => Promise<any>;
      };
    };
  }
}

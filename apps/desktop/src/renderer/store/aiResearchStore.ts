import { create } from 'zustand';
import { authGet, authRequest } from '../lib/apiClient';
import type { CloudAiModelConfig } from './settingsStore';

const AI_RESEARCH_CONFIG_KEY = 'trading_terminal_ai_research_config';

type AiBriefSource = {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
};

type AiBrief = {
  id: string;
  createdAt: string;
  headline: string;
  summaryBullets: string[];
  tickers: string[];
  whyItMatters: string[];
  whatToWatch: string[];
  impactScore: number;
  confidence: number;
  sources: AiBriefSource[];
};

type AiConfig = {
  enabled: boolean;
  model: string;
  pollIntervalSec: number;
  rssFeeds: string[];
  secForms: string[];
  watchlistTickers: string[];
  watchlistKeywords: string[];
  useX: boolean;
  xApiKey?: string;
  focusPrompt?: string;
  cloudModelId?: string;
  useCloudModel?: boolean;
};

type AiRunStatus = {
  running: boolean;
  queueDepth: number;
  lastRun?: {
    id: string;
    startedAt: string;
    finishedAt?: string;
    status: string;
    error?: string;
    modelUsed?: string;
    provider?: string;
  } | null;
};

type AiRuntimeStatus = {
  available: boolean;
  message?: string;
  version?: string;
  cloudModelsAvailable?: number;
};

type AiProgress = {
  stage: 'ingest' | 'store' | string;
  runId: string;
  counts?: { items: number; clusters: number; briefs: number };
  modelProvider?: string;
  modelName?: string;
};

type AiResearchState = {
  config: AiConfig | null;
  status: AiRunStatus | null;
  runtime: AiRuntimeStatus | null;
  briefs: AiBrief[];
  progress: AiProgress | null;
  lastErrors: string[];
  focusDraft: string;
  setFocusDraft: (value: string) => void;
  loading: boolean;
  error: string | null;
  cloudModels: CloudAiModelConfig[];

  init: () => void;
  loadConfig: () => Promise<void>;
  saveConfig: (next: AiConfig) => Promise<void>;
  runNow: (manualItems?: Array<{ title: string; text: string }>) => Promise<void>;
  refreshBriefs: (limit?: number) => Promise<void>;
  checkRuntime: () => Promise<void>;
  setCloudModels: (models: CloudAiModelConfig[]) => void;
  getActiveCloudModels: () => CloudAiModelConfig[];
};

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown error';
}

function getDefaultAiConfig(): AiConfig {
  return {
    enabled: false,
    model: 'deepseek-r1:14b',
    pollIntervalSec: 300,
    rssFeeds: [],
    secForms: ['8-K', '10-Q', '10-K'],
    watchlistTickers: [],
    watchlistKeywords: [],
    useX: false,
  };
}

function loadLocalAiConfig(): AiConfig {
  try {
    const raw = localStorage.getItem(AI_RESEARCH_CONFIG_KEY);
    if (!raw) return getDefaultAiConfig();
    const parsed = JSON.parse(raw) as Partial<AiConfig>;
    return {
      ...getDefaultAiConfig(),
      ...parsed,
      rssFeeds: Array.isArray(parsed.rssFeeds) ? parsed.rssFeeds : [],
      secForms: Array.isArray(parsed.secForms) ? parsed.secForms : ['8-K', '10-Q', '10-K'],
      watchlistTickers: Array.isArray(parsed.watchlistTickers) ? parsed.watchlistTickers : [],
      watchlistKeywords: Array.isArray(parsed.watchlistKeywords) ? parsed.watchlistKeywords : [],
    };
  } catch {
    return getDefaultAiConfig();
  }
}

function saveLocalAiConfig(next: AiConfig): void {
  try {
    localStorage.setItem(AI_RESEARCH_CONFIG_KEY, JSON.stringify(next));
  } catch {
    // Ignore localStorage write errors
  }
}

async function checkRuntimeViaHttp(): Promise<AiRuntimeStatus> {
  try {
    // Route through main process instead of calling localhost directly
    const result = await window.cockpit.aiResearch.checkRuntime();
    return result as AiRuntimeStatus;
  } catch (err) {
    return { available: false, message: `Runtime check failed: ${formatError(err)}` };
  }
}

let subscriptionsReady = false;

export const useAiResearchStore = create<AiResearchState>((set, get) => ({
  config: null,
  status: null,
  runtime: null,
  briefs: [],
  progress: null,
  lastErrors: [],
  focusDraft: '',
  setFocusDraft: (value) => set({ focusDraft: value }),
  loading: false,
  error: null,
  cloudModels: [],

  init() {
    if (subscriptionsReady) return;
    subscriptionsReady = true;

    const api = window.cockpit?.aiResearch;
    if (!api) {
      // Web mode: no IPC push events — poll for briefs and status on an interval
      void get().refreshBriefs();
      setInterval(() => {
        void get().refreshBriefs();
        authGet<{ running: boolean; queueDepth: number; lastRun?: unknown }>(
          '/api/ai/research/status',
        )
          .then((status) => set({ status: status as AiRunStatus }))
          .catch(() => {});
      }, 30_000);
      return;
    }

    api.onBriefs?.((briefs) => set({ briefs: briefs ?? [] }));
    api.onStatus?.((status) => set({ status }));
    api.onProgress?.((progress) => set({ progress }));

    // Optional WS path for backend-pushed AI updates (kept alongside IPC for compatibility).
    const wsApi = window.cockpit?.backendWs;
    void wsApi?.connect?.();
    wsApi?.onMessage?.((message) => {
      if (!message || typeof message !== 'object') {
        return;
      }
      const payload = message as { type?: string; data?: unknown; progress?: unknown };
      if (payload.type === 'ai:status') {
        set({ status: payload.data as AiRunStatus });
      } else if (payload.type === 'ai:briefs') {
        set({ briefs: (payload.data as AiBrief[]) ?? [] });
      } else if (payload.type === 'ai:progress' || payload.type === 'job:progress') {
        set({ progress: (payload.progress ?? payload.data) as AiProgress });
      }
    });
  },

  async loadConfig() {
    const api = window.cockpit?.aiResearch;
    if (!api?.getConfig) {
      // Web mode: try backend HTTP, fall back to localStorage
      set({ loading: true, error: null });
      try {
        const config = await authGet<AiConfig>('/api/ai/research/config');
        saveLocalAiConfig(config);
        set({ config, focusDraft: config?.focusPrompt ?? '', loading: false });
      } catch {
        const localConfig = loadLocalAiConfig();
        set({ config: localConfig, loading: false, error: null });
      }
      return;
    }
    set({ loading: true, error: null });
    try {
      const config = await api.getConfig();
      saveLocalAiConfig(config);
      set({ config, focusDraft: config?.focusPrompt ?? '', loading: false });
    } catch (err) {
      const localConfig = loadLocalAiConfig();
      set({ config: localConfig, loading: false, error: null });
    }
  },

  async saveConfig(next) {
    const api = window.cockpit?.aiResearch;
    if (!api?.setConfig) {
      // Web mode: persist to localStorage immediately, then sync to backend
      saveLocalAiConfig(next);
      set({ config: next, error: null, loading: false });
      authRequest('/api/ai/research/config', {
        method: 'PUT',
        body: JSON.stringify(next),
      }).catch(() => {});
      return;
    }
    set({ loading: true, error: null });
    try {
      await api.setConfig(next);
      saveLocalAiConfig(next);
      set({ config: next, loading: false });
    } catch (err) {
      saveLocalAiConfig(next);
      set({ config: next, loading: false, error: null });
    }
  },

  async runNow(manualItems) {
    const api = window.cockpit?.aiResearch;
    if (!api?.runNow) {
      // Web mode: call backend REST endpoint directly
      set({ loading: true, error: null });
      try {
        await authRequest('/api/ai/research/run', {
          method: 'POST',
          body: JSON.stringify({ manualItems: manualItems ?? [] }),
        });
        set({ lastErrors: [], loading: false });
        await get().refreshBriefs();
        await get().loadConfig();
      } catch (err) {
        set({ loading: false, error: formatError(err) });
      }
      return;
    }
    set({ loading: true, error: null });
    try {
      const res = await api.runNow(manualItems ?? []);
      if (isRunError(res)) {
        set({ loading: false, error: res.error ?? 'AI run failed' });
        return;
      }
      if (hasRunWarnings(res)) {
        set({ lastErrors: res.errors ?? [], loading: false });
      } else {
        set({ lastErrors: [], loading: false });
      }
      await get().refreshBriefs();
      await get().loadConfig();
    } catch (err) {
      set({ loading: false, error: formatError(err) });
    }
  },

  async refreshBriefs(limit = 5) {
    const api = window.cockpit?.aiResearch;
    if (!api?.listBriefs) {
      // Web mode: call backend REST endpoint directly
      try {
        const data = await authGet<{ briefs: AiBrief[] }>(
          `/api/ai/research/briefs?limit=${limit}`,
        );
        set({ briefs: data.briefs ?? [] });
      } catch (err) {
        set({ error: formatError(err) });
      }
      return;
    }
    try {
      const briefs = await api.listBriefs(limit);
      set({ briefs: briefs ?? [] });
    } catch (err) {
      set({ error: formatError(err) });
    }
  },

  async checkRuntime() {
    const api = window.cockpit?.aiResearch;
    console.log('[aiResearchStore] checkRuntime() called, API available:', !!api?.checkRuntime);

    if (!api?.checkRuntime) {
      console.warn(
        '[aiResearchStore] IPC checkRuntime unavailable, falling back to direct Ollama HTTP check',
      );
      const runtime = await checkRuntimeViaHttp();
      console.log('[aiResearchStore] Direct HTTP runtime result:', runtime);
      set({ runtime, error: runtime.available ? null : get().error });
      return;
    }

    try {
      console.log('[aiResearchStore] 🔍 Calling api.checkRuntime()...');
      const startTime = Date.now();
      const runtime = await api.checkRuntime();
      const duration = Date.now() - startTime;
      console.log(
        `[aiResearchStore] ✅ Runtime check completed in ${duration}ms:`,
        JSON.stringify(runtime, null, 2),
      );
      set({ runtime, error: runtime.available ? null : get().error });
    } catch (err) {
      console.error('[aiResearchStore] ❌ Runtime check failed with exception:', err);
      console.error(
        '[aiResearchStore] Error type:',
        err instanceof Error ? err.constructor.name : typeof err,
      );
      console.error(
        '[aiResearchStore] Error message:',
        err instanceof Error ? err.message : String(err),
      );
      const fallbackRuntime = await checkRuntimeViaHttp();
      console.log('[aiResearchStore] IPC failed, direct HTTP fallback result:', fallbackRuntime);
      set({
        runtime: fallbackRuntime.available
          ? fallbackRuntime
          : {
              available: false,
              message: `Exception: ${formatError(err)} | ${fallbackRuntime.message}`,
            },
        error: fallbackRuntime.available ? null : get().error,
      });
    }
  },

  setCloudModels: (models: CloudAiModelConfig[]) => {
    set({ cloudModels: models });
    const available = models.filter((m) => m.enabled).length;
    set((state) => ({
      runtime: {
        ...state.runtime,
        available: (state.runtime?.available ?? false) || available > 0,
        cloudModelsAvailable: available,
      } as AiRuntimeStatus,
    }));
  },

  getActiveCloudModels: () => {
    return get().cloudModels.filter((m) => m.enabled && m.useForResearch);
  },
}));

function isRunError(value: unknown): value is { ok: false; error?: string } {
  return (
    !!value &&
    typeof value === 'object' &&
    'ok' in value &&
    (value as { ok?: boolean }).ok === false
  );
}

function hasRunWarnings(value: unknown): value is { errors?: string[] } {
  return (
    !!value &&
    typeof value === 'object' &&
    'errors' in value &&
    Array.isArray((value as { errors?: unknown }).errors)
  );
}

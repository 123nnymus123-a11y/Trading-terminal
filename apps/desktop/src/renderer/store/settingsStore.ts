import { create } from "zustand";
import type { ApiCredentialRecord } from "../../shared/apiHub";

export type MarketFocus = "us-large-cap" | "index-futures";

export interface MarketFocusConfig {
  type: MarketFocus;
  symbols: string[];
  description: string;
  sophisticationLevel: "simple" | "sophisticated";
}

export type AiEnginePreference = "cloud-first" | "cloud-only" | "local-only";
export type CloudProvider =
  | "ollama"
  | "openai"
  | "anthropic"
  | "gemini"
  | "mistral"
  | "groq"
  | "xai";
export type ModelTier = "standard" | "advanced" | "expert";
export type AiFeature = "research" | "supplyChain" | "congress" | "cftc";
export type AiFeatureRouting = Record<AiFeature, string>;

export interface CloudAiModelConfig {
  provider: CloudProvider;
  model: string;
  tier: ModelTier;
  enabled: boolean;
  temperature?: number;
  maxTokens?: number;
  useForResearch?: boolean;
  useForSupplyChain?: boolean;
  useForCongress?: boolean;
  useForCftc?: boolean;
  createdAt: number;
  lastUsed?: number;
}

export type ApiKey = ApiCredentialRecord;

export interface ExternalFeedsSettings {
  enableSec: boolean;
  enableCftc: boolean;
  enableBls: boolean;
  blsApiKeyId?: string;
  blsApiKeyAccount?: string;
  cftcMappingPath?: string;
  cftcSampleZipPath?: string;
  secCikMappingPath?: string;
}

export interface AlertRule {
  id: string;
  name: string;
  symbol?: string;
  condition:
    | "price_above"
    | "price_below"
    | "volume_surge"
    | "volatility_spike";
  threshold: number;
  enabled: boolean;
  createdAt: number;
}

export interface LayoutPreset {
  id: string;
  name: string;
  config: Record<string, unknown>;
  createdAt: number;
}

export interface SystemLog {
  id: string;
  timestamp: number;
  level: "info" | "warn" | "error";
  category: string;
  message: string;
}

export interface DataFeedHealth {
  adapter: string;
  connected: boolean;
  lastEventTs?: number;
  latencyMs?: number;
  eventsCount: number;
  errorCount: number;
}

interface SettingsStoreState {
  // Market Focus
  marketFocus: MarketFocus;
  setMarketFocus: (focus: MarketFocus) => void;
  getMarketFocusConfig: () => MarketFocusConfig;

  // AI Settings
  aiContextSharingEnabled: boolean;
  setAiContextSharingEnabled: (enabled: boolean) => void;
  aiEnginePreference: AiEnginePreference;
  setAiEnginePreference: (mode: AiEnginePreference) => void;
  aiFeatureRouting: AiFeatureRouting;
  setAiFeatureRouting: (feature: AiFeature, providerKey: string) => void;

  // Cloud AI Models
  cloudAiModels: CloudAiModelConfig[];
  addCloudAiModel: (model: Omit<CloudAiModelConfig, "createdAt">) => string;
  updateCloudAiModel: (
    id: string,
    updates: Partial<CloudAiModelConfig>,
  ) => void;
  removeCloudAiModel: (id: string) => void;
  getActiveCloudModels: () => CloudAiModelConfig[];
  getCloudModelFor: (
    feature: "research" | "supplyChain" | "congress" | "cftc",
  ) => CloudAiModelConfig | null;
  recordCloudModelUsage: (id: string) => void;

  // API Keys
  apiKeys: ApiKey[];
  setApiKeys: (keys: ApiKey[], options?: { persist?: boolean }) => void;
  addApiKey: (key: Omit<ApiKey, "createdAt"> & { id?: string }) => string;
  removeApiKey: (id: string) => void;

  // Alert Rules
  alertRules: AlertRule[];
  addAlertRule: (rule: Omit<AlertRule, "id" | "createdAt">) => void;
  updateAlertRule: (id: string, updates: Partial<AlertRule>) => void;
  removeAlertRule: (id: string) => void;

  // Layouts
  layouts: LayoutPreset[];
  saveLayout: (name: string, config: Record<string, unknown>) => void;
  loadLayout: (id: string) => Record<string, unknown> | null;
  removeLayout: (id: string) => void;
  exportLayouts: () => string;
  importLayouts: (json: string) => void;

  // System Logs
  logs: SystemLog[];
  addLog: (log: Omit<SystemLog, "id">) => void;
  clearLogs: () => void;
  getLogsByLevel: (level: SystemLog["level"]) => SystemLog[];
  getErrorLogs: () => SystemLog[];

  // Data Feed Health
  feedHealth: Record<string, DataFeedHealth>;
  updateFeedHealth: (adapter: string, health: Partial<DataFeedHealth>) => void;

  // External Feeds
  externalFeeds: ExternalFeedsSettings;
  setExternalFeeds: (next: Partial<ExternalFeedsSettings>) => void;

  // Persistence
  loadSettings: () => void;
  saveSettings: () => void;
}

const MAX_LOGS = 5000;
const STORAGE_KEY = "trading_terminal_settings";

// Market Focus Configurations
const MARKET_FOCUS_CONFIGS: Record<MarketFocus, MarketFocusConfig> = {
  "us-large-cap": {
    type: "us-large-cap",
    symbols: [
      "AAPL",
      "MSFT",
      "GOOGL",
      "AMZN",
      "NVDA",
      "META",
      "TSLA",
      "BRK.B",
      "JNJ",
      "V",
      "WMT",
      "PG",
      "JPM",
      "MA",
      "INTC",
      "KO",
      "PEP",
      "DIS",
      "BA",
      "VZ",
    ],
    description:
      "Sophisticated US Large Cap equity trading with advanced analytics",
    sophisticationLevel: "sophisticated",
  },
  "index-futures": {
    type: "index-futures",
    symbols: ["ES", "NQ"],
    description: "Simple Index Futures trading (S&P 500 / Nasdaq 100)",
    sophisticationLevel: "simple",
  },
};

export const useSettingsStore = create<SettingsStoreState>((set, get) => ({
  // Market Focus
  marketFocus: "us-large-cap",

  setMarketFocus: (focus: MarketFocus) => {
    set({ marketFocus: focus });
    // Trigger any necessary UI updates or reconfigurations
    const config = MARKET_FOCUS_CONFIGS[focus];
    console.log(
      `[settingsStore] Market focus changed to: ${config.description}`,
    );
  },

  getMarketFocusConfig: () => {
    const state = get();
    return MARKET_FOCUS_CONFIGS[state.marketFocus];
  },

  // AI Settings
  aiContextSharingEnabled: false,
  setAiContextSharingEnabled: (enabled: boolean) => {
    set({ aiContextSharingEnabled: enabled });
    console.log(
      `[settingsStore] AI context sharing ${enabled ? "enabled" : "disabled"}`,
    );
  },
  aiEnginePreference: "cloud-only",
  aiFeatureRouting: {
    research: "auto",
    supplyChain: "auto",
    congress: "auto",
    cftc: "auto",
  },
  setAiEnginePreference: (mode: AiEnginePreference) => {
    set((state) => {
      try {
        const toSave = {
          marketFocus: state.marketFocus,
          aiContextSharingEnabled: state.aiContextSharingEnabled,
          aiEnginePreference: mode,
          aiFeatureRouting: state.aiFeatureRouting,
          cloudAiModels: state.cloudAiModels,
          apiKeys: state.apiKeys,
          alertRules: state.alertRules,
          layouts: state.layouts,
          externalFeeds: state.externalFeeds,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
      } catch (e) {
        console.error(
          "[settingsStore] failed to persist aiEnginePreference:",
          e,
        );
      }
      return { aiEnginePreference: mode };
    });
    console.log(`[settingsStore] AI engine preference -> ${mode}`);
  },
  setAiFeatureRouting: (feature, providerKey) => {
    set((state) => {
      const nextRouting: AiFeatureRouting = {
        ...state.aiFeatureRouting,
        [feature]: providerKey,
      };
      try {
        const toSave = {
          marketFocus: state.marketFocus,
          aiContextSharingEnabled: state.aiContextSharingEnabled,
          aiEnginePreference: state.aiEnginePreference,
          aiFeatureRouting: nextRouting,
          cloudAiModels: state.cloudAiModels,
          apiKeys: state.apiKeys,
          alertRules: state.alertRules,
          layouts: state.layouts,
          externalFeeds: state.externalFeeds,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
      } catch (e) {
        console.error("[settingsStore] failed to persist aiFeatureRouting:", e);
      }
      return { aiFeatureRouting: nextRouting };
    });
  },

  // Initialize other state
  apiKeys: [],
  alertRules: [],
  layouts: [],
  logs: [],
  feedHealth: {},
  cloudAiModels: [],
  externalFeeds: {
    enableSec: false,
    enableCftc: false,
    enableBls: false,
  },

  addCloudAiModel: (model) => {
    const id = `cloud-ai-${crypto.randomUUID()}`;
    set((state) => {
      const updated = [
        ...state.cloudAiModels,
        { ...model, createdAt: Date.now() },
      ];
      try {
        const toSave = {
          marketFocus: state.marketFocus,
          aiContextSharingEnabled: state.aiContextSharingEnabled,
          aiEnginePreference: state.aiEnginePreference,
          aiFeatureRouting: state.aiFeatureRouting,
          cloudAiModels: updated,
          apiKeys: state.apiKeys,
          alertRules: state.alertRules,
          layouts: state.layouts,
          externalFeeds: state.externalFeeds,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
        console.log("[settingsStore] added cloud AI model:", {
          provider: model.provider,
          model: model.model,
        });
      } catch (e) {
        console.error("[settingsStore] failed to save cloud AI model:", e);
      }
      return { cloudAiModels: updated };
    });
    return id;
  },

  updateCloudAiModel: (id, updates) =>
    set((state) => {
      const updated = state.cloudAiModels.map((m) =>
        m.createdAt === parseInt(id.split("-").pop() || "0") ||
        `cloud-ai-${m.createdAt}` === id
          ? { ...m, ...updates }
          : m,
      );
      try {
        const toSave = {
          marketFocus: state.marketFocus,
          aiContextSharingEnabled: state.aiContextSharingEnabled,
          aiEnginePreference: state.aiEnginePreference,
          aiFeatureRouting: state.aiFeatureRouting,
          cloudAiModels: updated,
          apiKeys: state.apiKeys,
          alertRules: state.alertRules,
          layouts: state.layouts,
          externalFeeds: state.externalFeeds,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
        console.log("[settingsStore] updated cloud AI model:", id);
      } catch (e) {
        console.error("[settingsStore] failed to update cloud AI model:", e);
      }
      return { cloudAiModels: updated };
    }),

  removeCloudAiModel: (id) =>
    set((state) => {
      const updated = state.cloudAiModels.filter(
        (m) => `cloud-ai-${m.createdAt}` !== id,
      );
      try {
        const toSave = {
          marketFocus: state.marketFocus,
          aiContextSharingEnabled: state.aiContextSharingEnabled,
          aiEnginePreference: state.aiEnginePreference,
          aiFeatureRouting: state.aiFeatureRouting,
          cloudAiModels: updated,
          apiKeys: state.apiKeys,
          alertRules: state.alertRules,
          layouts: state.layouts,
          externalFeeds: state.externalFeeds,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
        console.log("[settingsStore] removed cloud AI model:", id);
      } catch (e) {
        console.error("[settingsStore] failed to remove cloud AI model:", e);
      }
      return { cloudAiModels: updated };
    }),

  getActiveCloudModels: () => {
    return get().cloudAiModels.filter((m) => m.enabled);
  },

  getCloudModelFor: (feature) => {
    const state = get();
    const models = state.cloudAiModels.filter((m) => m.enabled);

    if (feature === "research") {
      return models.find((m) => m.useForResearch) || models[0] || null;
    } else if (feature === "supplyChain") {
      return models.find((m) => m.useForSupplyChain) || models[0] || null;
    } else if (feature === "congress") {
      return models.find((m) => m.useForCongress) || models[0] || null;
    } else if (feature === "cftc") {
      return models.find((m) => m.useForCftc) || models[0] || null;
    }
    return null;
  },

  recordCloudModelUsage: (id) => {
    set((state) => {
      const updated = state.cloudAiModels.map((m) =>
        `cloud-ai-${m.createdAt}` === id ? { ...m, lastUsed: Date.now() } : m,
      );
      return { cloudAiModels: updated };
    });
  },

  addApiKey: (key) => {
    const id = key.id ?? crypto.randomUUID();
    set((state) => {
      const updated = [...state.apiKeys, { ...key, id, createdAt: Date.now() }];
      // Auto-save to localStorage
      try {
        const toSave = {
          marketFocus: state.marketFocus,
          aiContextSharingEnabled: state.aiContextSharingEnabled,
          aiEnginePreference: state.aiEnginePreference,
          aiFeatureRouting: state.aiFeatureRouting,
          cloudAiModels: state.cloudAiModels,
          apiKeys: updated,
          alertRules: state.alertRules,
          layouts: state.layouts,
          externalFeeds: state.externalFeeds,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
        console.log("[settingsStore] auto-saved apiKeys to localStorage");
      } catch (e) {
        console.error("[settingsStore] failed to auto-save apiKeys:", e);
      }
      return { apiKeys: updated };
    });
    return id;
  },

  removeApiKey: (id) =>
    set((state) => {
      const updated = state.apiKeys.filter((k) => k.id !== id);
      // Auto-save to localStorage
      try {
        const toSave = {
          marketFocus: state.marketFocus,
          aiContextSharingEnabled: state.aiContextSharingEnabled,
          aiEnginePreference: state.aiEnginePreference,
          aiFeatureRouting: state.aiFeatureRouting,
          cloudAiModels: state.cloudAiModels,
          apiKeys: updated,
          alertRules: state.alertRules,
          layouts: state.layouts,
          externalFeeds: state.externalFeeds,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
        console.log(
          "[settingsStore] auto-saved after removing apiKey to localStorage",
        );
      } catch (e) {
        console.error(
          "[settingsStore] failed to auto-save after removing apiKey:",
          e,
        );
      }
      return { apiKeys: updated };
    }),

  setApiKeys: (keys, options) =>
    set((state) => {
      const normalized = Array.isArray(keys)
        ? keys.map((key) => ({
            ...key,
            fields: Array.isArray(key.fields) ? key.fields : [],
            createdAt: key.createdAt ?? Date.now(),
          }))
        : [];
      if (options?.persist ?? true) {
        try {
          const toSave = {
            marketFocus: state.marketFocus,
            aiContextSharingEnabled: state.aiContextSharingEnabled,
            aiEnginePreference: state.aiEnginePreference,
            aiFeatureRouting: state.aiFeatureRouting,
            cloudAiModels: state.cloudAiModels,
            apiKeys: normalized,
            alertRules: state.alertRules,
            layouts: state.layouts,
            externalFeeds: state.externalFeeds,
          };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
          console.log("[settingsStore] synced apiKeys from hub", {
            count: normalized.length,
          });
        } catch (err) {
          console.error(
            "[settingsStore] failed to persist apiKeys from hub",
            err,
          );
        }
      }
      return { apiKeys: normalized };
    }),

  addAlertRule: (rule) =>
    set((state) => ({
      alertRules: [
        ...state.alertRules,
        { ...rule, id: crypto.randomUUID(), createdAt: Date.now() },
      ],
    })),

  updateAlertRule: (id, updates) =>
    set((state) => ({
      alertRules: state.alertRules.map((r) =>
        r.id === id ? { ...r, ...updates } : r,
      ),
    })),

  removeAlertRule: (id) =>
    set((state) => ({
      alertRules: state.alertRules.filter((r) => r.id !== id),
    })),

  saveLayout: (name, config) =>
    set((state) => ({
      layouts: [
        ...state.layouts,
        { id: crypto.randomUUID(), name, config, createdAt: Date.now() },
      ],
    })),

  loadLayout: (id) => {
    const state = get();
    const layout = state.layouts.find((l) => l.id === id);
    return layout?.config ?? null;
  },

  removeLayout: (id) =>
    set((state) => ({
      layouts: state.layouts.filter((l) => l.id !== id),
    })),

  exportLayouts: () => {
    const state = get();
    return JSON.stringify(state.layouts, null, 2);
  },

  importLayouts: (json) => {
    try {
      const layouts = JSON.parse(json) as LayoutPreset[];
      set((state) => ({
        layouts: [...state.layouts, ...layouts],
      }));
    } catch (e) {
      console.error("[settingsStore] failed to import layouts:", e);
    }
  },

  addLog: (log) =>
    set((state) => {
      const newLogs = [
        { ...log, id: crypto.randomUUID() },
        ...state.logs,
      ].slice(0, MAX_LOGS);
      return { logs: newLogs };
    }),

  clearLogs: () => set({ logs: [] }),

  getLogsByLevel: (level) => {
    const state = get();
    return state.logs.filter((l) => l.level === level);
  },

  getErrorLogs: () => {
    const state = get();
    return state.logs.filter((l) => l.level === "error");
  },

  updateFeedHealth: (adapter, health) =>
    set((state) => ({
      feedHealth: {
        ...state.feedHealth,
        [adapter]: {
          ...(state.feedHealth[adapter] || {
            adapter,
            connected: false,
            eventsCount: 0,
            errorCount: 0,
          }),
          ...health,
        },
      },
    })),

  setExternalFeeds: (next) =>
    set((state) => {
      const updated = {
        ...state.externalFeeds,
        ...next,
      };
      // Auto-save to localStorage
      try {
        const toSave = {
          marketFocus: state.marketFocus,
          aiContextSharingEnabled: state.aiContextSharingEnabled,
          aiEnginePreference: state.aiEnginePreference,
          aiFeatureRouting: state.aiFeatureRouting,
          cloudAiModels: state.cloudAiModels,
          apiKeys: state.apiKeys,
          alertRules: state.alertRules,
          layouts: state.layouts,
          externalFeeds: updated,
        };
        const json = JSON.stringify(toSave);
        localStorage.setItem(STORAGE_KEY, json);
        console.log("[settingsStore] ✅ SAVED to localStorage:", {
          updated,
          totalSize: json.length,
        });
        console.log(
          "[settingsStore] localStorage check:",
          localStorage.getItem(STORAGE_KEY),
        );
      } catch (e) {
        console.error(
          "[settingsStore] ❌ FAILED to auto-save externalFeeds:",
          e,
        );
      }
      return { externalFeeds: updated };
    }),

  loadSettings: () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      console.log(
        "[settingsStore] loadSettings called, stored data:",
        !!stored ? `${stored.length} chars` : "EMPTY",
      );
      if (!stored) {
        console.log("[settingsStore] ℹ️ No localStorage data found");
        return;
      }

      const parsed = JSON.parse(stored);
      console.log("[settingsStore] ✅ PARSED localStorage:", {
        hasApiKeys: !!parsed.apiKeys?.length,
        apiKeysCount: parsed.apiKeys?.length ?? 0,
        externalFeeds: parsed.externalFeeds,
      });

      const normalizedApiKeys = Array.isArray(parsed.apiKeys)
        ? parsed.apiKeys.map((key: ApiKey) => ({
            ...key,
            fields: Array.isArray(key.fields) ? key.fields : [],
            config: key.config ?? undefined,
          }))
        : [];

      const normalizedCloudAiModels = Array.isArray(parsed.cloudAiModels)
        ? parsed.cloudAiModels
            .filter((entry: CloudAiModelConfig | null | undefined) => !!entry)
            .map((entry: CloudAiModelConfig) => ({
              ...entry,
              createdAt:
                typeof entry.createdAt === "number"
                  ? entry.createdAt
                  : Date.now(),
            }))
        : [];

      set({
        marketFocus: (parsed.marketFocus as MarketFocus) || "us-large-cap",
        aiContextSharingEnabled: parsed.aiContextSharingEnabled ?? false,
        aiEnginePreference:
          (parsed.aiEnginePreference as AiEnginePreference) || "cloud-only",
        aiFeatureRouting: {
          research: parsed.aiFeatureRouting?.research ?? "auto",
          supplyChain: parsed.aiFeatureRouting?.supplyChain ?? "auto",
          congress: parsed.aiFeatureRouting?.congress ?? "auto",
          cftc: parsed.aiFeatureRouting?.cftc ?? "auto",
        },
        cloudAiModels: normalizedCloudAiModels,
        apiKeys: normalizedApiKeys,
        alertRules: parsed.alertRules || [],
        layouts: parsed.layouts || [],
        logs: parsed.logs || [],
        externalFeeds: {
          enableSec: parsed.externalFeeds?.enableSec ?? false,
          enableCftc: parsed.externalFeeds?.enableCftc ?? false,
          enableBls: parsed.externalFeeds?.enableBls ?? false,
          blsApiKeyId: parsed.externalFeeds?.blsApiKeyId,
          blsApiKeyAccount: parsed.externalFeeds?.blsApiKeyAccount,
          cftcMappingPath: parsed.externalFeeds?.cftcMappingPath,
          cftcSampleZipPath: parsed.externalFeeds?.cftcSampleZipPath,
          secCikMappingPath: parsed.externalFeeds?.secCikMappingPath,
        },
      });
      console.log("[settingsStore] ✅ State updated from localStorage");
    } catch (e) {
      console.error("[settingsStore] ❌ failed to load settings:", e);
    }
  },

  saveSettings: () => {
    try {
      const state = get();
      const toSave = {
        marketFocus: state.marketFocus,
        aiContextSharingEnabled: state.aiContextSharingEnabled,
        aiEnginePreference: state.aiEnginePreference,
        aiFeatureRouting: state.aiFeatureRouting,
        cloudAiModels: state.cloudAiModels,
        apiKeys: state.apiKeys,
        alertRules: state.alertRules,
        layouts: state.layouts,
        externalFeeds: state.externalFeeds,
        // Don't persist logs to localStorage (only in-memory)
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch (e) {
      console.error("[settingsStore] failed to save settings:", e);
    }
  },
}));

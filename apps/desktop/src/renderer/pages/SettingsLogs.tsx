import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStreamStore } from "../store/streamStore";
import { useConfigStore } from "../store/configStore";
import { useSettingsStore } from "../store/settingsStore";
import { useAiResearchStore } from "../store/aiResearchStore";
import { useAiStewardStore } from "../store/aiStewardStore";
import { CloudAiConfigurator } from "../components/CloudAiConfigurator";
import {
  getBackendBaseUrl,
  refreshBackendBaseUrl,
  setBackendBaseUrl,
} from "../lib/apiClient";
import { DEFAULT_BACKEND_URL } from "../../shared/backendConfig";
import type {
  AiStewardModule,
  AiStewardModuleState,
  AiStewardModuleStatus,
} from "../../shared/aiSteward";
import { ThemeControls } from "../components/ThemeControls";
import { API_KEY_TEMPLATES } from "../constants/apiKeyTemplates";
import type { ApiKeyProviderOption } from "../constants/apiKeyTemplates";

const TED_API_HUB_RECORD_ID = "ted-live";
const TED_API_KEY_ACCOUNT = "api-hub:ted-live:api-key";

function fmt(ts?: number | null) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return "—";
  }
}

function fmtDate(ts: number) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "—";
  }
}

const MODEL_PRESETS = [
  "deepseek-r1:14b",
  "deepseek-r1:7b",
  "llama3.1:70b",
  "llama3.1:8b",
  "mixtral-8x7b",
  "phi-3-medium",
  "gpt-oss:120b-cloud",
  "gpt-oss:20b-cloud",
  "deepseek-v3.1:671b-cloud",
  "qwen3-coder:480b-cloud",
  "qwen3-vl:235b-cloud",
  "minimax-m2:cloud",
  "glm-4.6:cloud",
];

const CUSTOM_MODEL_VALUE = "__custom_model__";
const AI_SELECTIONS_KEY = "trading_terminal_ai_selections";
const AI_DRAFT_KEY = "trading_terminal_ai_draft";
const GWMD_USER_SETTINGS_KEY = "gwmd:user-settings:v1";

type DesktopUpdateState =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error"
  | "unsupported";

type DesktopUpdateStatus = {
  ok?: boolean;
  state: DesktopUpdateState;
  message: string;
  version?: string;
  progress?: number;
  error?: string;
};

type GwmdSourceMode = "cache_only" | "hybrid" | "fresh";
type GwmdUserSettings = {
  defaultHops: number;
  defaultRelation: string;
  defaultRegion: string;
  minConfidence: number;
  sourceMode: GwmdSourceMode;
  showUnresolved: boolean;
};

const DEFAULT_GWMD_SETTINGS: GwmdUserSettings = {
  defaultHops: 2,
  defaultRelation: "all",
  defaultRegion: "All",
  minConfidence: 0,
  sourceMode: "hybrid",
  showUnresolved: true,
};

function readGwmdUserSettings(): GwmdUserSettings {
  try {
    const raw = window.localStorage.getItem(GWMD_USER_SETTINGS_KEY);
    if (!raw) return DEFAULT_GWMD_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<GwmdUserSettings>;
    return {
      defaultHops:
        typeof parsed.defaultHops === "number" && Number.isFinite(parsed.defaultHops)
          ? Math.max(1, Math.min(3, Math.floor(parsed.defaultHops)))
          : DEFAULT_GWMD_SETTINGS.defaultHops,
      defaultRelation:
        typeof parsed.defaultRelation === "string" && parsed.defaultRelation.trim()
          ? parsed.defaultRelation
          : DEFAULT_GWMD_SETTINGS.defaultRelation,
      defaultRegion:
        typeof parsed.defaultRegion === "string" && parsed.defaultRegion.trim()
          ? parsed.defaultRegion
          : DEFAULT_GWMD_SETTINGS.defaultRegion,
      minConfidence:
        typeof parsed.minConfidence === "number" && Number.isFinite(parsed.minConfidence)
          ? Math.max(0, Math.min(1, parsed.minConfidence))
          : DEFAULT_GWMD_SETTINGS.minConfidence,
      sourceMode:
        parsed.sourceMode === "cache_only" ||
          parsed.sourceMode === "hybrid" ||
          parsed.sourceMode === "fresh"
          ? parsed.sourceMode
          : DEFAULT_GWMD_SETTINGS.sourceMode,
      showUnresolved:
        typeof parsed.showUnresolved === "boolean"
          ? parsed.showUnresolved
          : DEFAULT_GWMD_SETTINGS.showUnresolved,
    };
  } catch {
    return DEFAULT_GWMD_SETTINGS;
  }
}

async function fetchModelsDirectFromOllama(): Promise<string[]> {
  // Route through main process IPC — no direct localhost calls from renderer
  try {
    const result = await window.cockpit.aiResearch.listModels();
    return Array.isArray(result?.models) ? result.models : [];
  } catch {
    return [];
  }
}

function buildAiKey(provider: string, model: string) {
  return `${provider}|${model}`;
}

function parseAiKey(key: string): { provider: string; model: string } | null {
  const idx = key.indexOf("|");
  if (idx <= 0) return null;
  const provider = key.slice(0, idx).trim();
  const model = key.slice(idx + 1).trim();
  if (!provider || !model) return null;
  return { provider, model };
}

function isCloudModelName(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return normalized.endsWith(":cloud") || normalized.endsWith("-cloud");
}

function isCloudAiKey(key: string): boolean {
  const parsed = parseAiKey(key);
  if (!parsed) return false;
  if (parsed.provider.toLowerCase() !== "ollama") return true;
  return isCloudModelName(parsed.model);
}

const STEWARD_MODULE_ORDER: AiStewardModule[] = ["cftc", "congress"];

const STEWARD_MODULE_META: Record<AiStewardModule, {
  short: string;
  title: string;
  description: string;
}> = {
  cftc: {
    short: "CFTC",
    title: "CFTC Commitments of Traders",
    description: "Tracks futures positioning pulled straight from official CFTC drops.",
  },
  congress: {
    short: "Congress",
    title: "Congressional Disclosures",
    description: "Scrapes PTRs, lobbying filings, and federal contracts from public portals.",
  },
};

const MODULE_STATUS_STYLE: Record<AiStewardModuleStatus, { bg: string; border: string; color: string; label: string }> = {
  ok: { bg: "rgba(34,197,94,0.12)", border: "rgba(34,197,94,0.4)", color: "#86efac", label: "Healthy" },
  degraded: { bg: "rgba(251,191,36,0.15)", border: "rgba(251,191,36,0.5)", color: "#fde68a", label: "Attention" },
  failing: { bg: "rgba(248,113,113,0.15)", border: "rgba(248,113,113,0.5)", color: "#fecaca", label: "Failing" },
};

type ProviderDraft = {
  enabled: boolean;
  name: string;
  secrets: Record<string, string>;
  config: Record<string, string>;
};

type ProviderDraftMap = Record<ApiKeyProviderOption, ProviderDraft>;

function createInitialProviderDrafts(): ProviderDraftMap {
  const next = {} as ProviderDraftMap;
  (Object.entries(API_KEY_TEMPLATES) as Array<[ApiKeyProviderOption, (typeof API_KEY_TEMPLATES)[ApiKeyProviderOption]]>).forEach(
    ([provider, template]) => {
      next[provider] = {
        enabled: false,
        name: template.label,
        secrets: {},
        config: {},
      };
    },
  );
  return next;
}

export default function SettingsLogs() {
  const source = useStreamStore((s) => s.source);
  const replay = useStreamStore((s) => s.replay);
  const setSource = useStreamStore((s) => s.setSource);
  const setReplay = useStreamStore((s) => s.setReplay);

  // Settings Store
  const apiKeys = useSettingsStore((s) => s.apiKeys);
  const setApiKeys = useSettingsStore((s) => s.setApiKeys);
  const logs = useSettingsStore((s) => s.logs);
  const feedHealth = useSettingsStore((s) => s.feedHealth);
  const externalFeeds = useSettingsStore((s) => s.externalFeeds);
  const setExternalFeeds = useSettingsStore((s) => s.setExternalFeeds);

  const addApiKey = useSettingsStore((s) => s.addApiKey);
  const removeApiKey = useSettingsStore((s) => s.removeApiKey);
  const addLog = useSettingsStore((s) => s.addLog);
  const clearLogs = useSettingsStore((s) => s.clearLogs);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const saveSettings = useSettingsStore((s) => s.saveSettings);
  const marketFocus = useSettingsStore((s) => s.marketFocus);
  const setMarketFocus = useSettingsStore((s) => s.setMarketFocus);
  const getMarketFocusConfig = useSettingsStore((s) => s.getMarketFocusConfig);
  const aiContextSharingEnabled = useSettingsStore((s) => s.aiContextSharingEnabled);
  const setAiContextSharingEnabled = useSettingsStore((s) => s.setAiContextSharingEnabled);
  const aiEnginePreference = useSettingsStore((s) => s.aiEnginePreference);
  const aiFeatureRouting = useSettingsStore((s) => s.aiFeatureRouting);
  const setAiFeatureRouting = useSettingsStore((s) => s.setAiFeatureRouting);
  const cloudAiModels = useSettingsStore((s) => s.cloudAiModels);

  const api = window.streaming;
  const settingsApi = window.cockpit?.journal;
  const updatesApi = window.cockpit?.updates;

  // Keep status fresh
  useEffect(() => {
    if (typeof api?.getStatus !== "function") return;

    const t = setInterval(() => {
      Promise.resolve(api.getStatus!())
        .then((s) => {
          if (s?.source === "demo" || s?.source === "replay" || s?.source === "live") setSource(s.source);
          if (s?.replay) setReplay(s.replay);
        })
        .catch(() => void 0);
    }, 1000);

    return () => clearInterval(t);
  }, [api, setReplay, setSource]);

  // Load settings on mount
  useEffect(() => {
    console.log("[SettingsLogs] mount: loading settings from store...");
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (settingsApi?.settingsGet) {
      settingsApi.settingsGet()
        .then((settings) => {
          const primary = settings?.primaryAiModel as { provider?: string; model?: string } | undefined;
          const secondary = settings?.secondaryAiModel as { provider?: string; model?: string } | undefined;
          if (primary?.provider && primary?.model) {
            setPrimaryAiKey(buildAiKey(primary.provider, primary.model));
          }
          if (secondary?.provider && secondary?.model) {
            setSecondaryAiKey(buildAiKey(secondary.provider, secondary.model));
          }
        })
        .catch((err) => {
          console.warn("[SettingsLogs] failed to load app settings", err);
        });
      return;
    }

    try {
      const stored = localStorage.getItem(AI_SELECTIONS_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored) as { primaryAiKey?: string; secondaryAiKey?: string };
      if (parsed.primaryAiKey) setPrimaryAiKey(parsed.primaryAiKey);
      if (parsed.secondaryAiKey) setSecondaryAiKey(parsed.secondaryAiKey);
    } catch (err) {
      console.warn("[SettingsLogs] failed to load local AI selections", err);
    }
  }, [settingsApi]);

  // Auto-save settings when they change
  useEffect(() => {
    const timer = setTimeout(() => {
      saveSettings();
    }, 1000);
    return () => clearTimeout(timer);
  }, [apiKeys, saveSettings]);

  const canSetSource = typeof api?.setSource === "function";
  const r = api?.replay;

  const canReplay =
    !!r &&
    typeof r.play === "function" &&
    typeof r.pause === "function" &&
    typeof r.setSpeed === "function" &&
    typeof r.scrubTo === "function";

  // Debug: Log API availability on mount
  useEffect(() => {
    console.log("[SettingsLogs] API availability:", {
      streaming: !!api,
      setSource: canSetSource,
      replay: canReplay,
    });
  }, [api, canSetSource, canReplay]);

  const startTs = replay?.startTs ?? null;
  const endTs = replay?.endTs ?? null;
  const cursorTs = replay?.cursorTs ?? startTs;

  const [providerDrafts, setProviderDrafts] = useState<ProviderDraftMap>(() => createInitialProviderDrafts());
  const [apiKeyStatus, setApiKeyStatus] = useState<string | null>(null);
  const [apiKeyBusy, setApiKeyBusy] = useState(false);
  const [testOnSave, setTestOnSave] = useState(true);

  // API Key Testing State
  const [testingKeys, setTestingKeys] = useState<Set<string>>(new Set());
  const [keyTestResults, setKeyTestResults] = useState<Map<string, {
    status: 'success' | 'error' | 'unknown';
    message: string;
    timestamp: number;
    details?: any;
  }>>(new Map());

  const [logFilter, setLogFilter] = useState<"all" | "error" | "warn" | "info">("all");
  const [activeSection, setActiveSection] = useState<"ai" | "steward" | "research" | "data" | "market" | "gwmd" | "system">("ai");
  const [externalFeedTests, setExternalFeedTests] = useState<Record<string, { status: "success" | "error" | "unknown"; message: string; timestamp: number }>>({});

  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiModel, setAiModel] = useState("deepseek-r1:14b");
  const [aiPollInterval, setAiPollInterval] = useState(300);
  const [aiRssFeeds, setAiRssFeeds] = useState<string>("");
  const [aiSecForms, setAiSecForms] = useState<string>("8-K,10-Q,10-K");
  const [aiWatchlistTickers, setAiWatchlistTickers] = useState<string>("");
  const [aiWatchlistKeywords, setAiWatchlistKeywords] = useState<string>("");
  const [primaryAiKey, setPrimaryAiKey] = useState<string>("");
  const [secondaryAiKey, setSecondaryAiKey] = useState<string>("");
  const [aiSelectionStatus, setAiSelectionStatus] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>(MODEL_PRESETS);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [manualTitle, setManualTitle] = useState("");
  const [manualText, setManualText] = useState("");
  const [ollamaApiKey, setOllamaApiKey] = useState<string>("");
  const [backendUrlDraft, setBackendUrlDraft] = useState<string>("");
  const [backendUrlStatus, setBackendUrlStatus] = useState<string | null>(null);
  const [backendUrlSaving, setBackendUrlSaving] = useState(false);
  const [backendHealthChecking, setBackendHealthChecking] = useState(false);
  const [backendHealth, setBackendHealth] = useState<"unknown" | "ok" | "error">("unknown");
  const [updateStatus, setUpdateStatus] = useState<DesktopUpdateStatus | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [tedLiveEnabled, setTedLiveEnabled] = useState(false);
  const [tedBaseUrl, setTedBaseUrl] = useState("");
  const [tedApiKey, setTedApiKey] = useState("");
  const [tedAuthHeader, setTedAuthHeader] = useState("x-api-key");
  const [tedTimeoutMs, setTedTimeoutMs] = useState(12000);
  const [tedWindowQueryParam, setTedWindowQueryParam] = useState("window");
  const [tedConfigStatus, setTedConfigStatus] = useState<string | null>(null);
  const [tedConfigSaving, setTedConfigSaving] = useState(false);
  const [tedApiTesting, setTedApiTesting] = useState(false);
  const [tedApiTestResult, setTedApiTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [settingsSaveStatus, setSettingsSaveStatus] = useState<string | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [gwmdSettingsDraft, setGwmdSettingsDraft] =
    useState<GwmdUserSettings>(DEFAULT_GWMD_SETTINGS);
  const [gwmdSettingsStatus, setGwmdSettingsStatus] = useState<string | null>(null);

  useEffect(() => {
    setGwmdSettingsDraft(readGwmdUserSettings());
  }, []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(AI_DRAFT_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored) as {
        aiEnabled?: boolean;
        aiModel?: string;
        aiPollInterval?: number;
        primaryAiKey?: string;
        secondaryAiKey?: string;
      };
      if (typeof parsed.aiEnabled === "boolean") setAiEnabled(parsed.aiEnabled);
      if (typeof parsed.aiModel === "string" && (parsed.aiModel ?? "").trim()) setAiModel(parsed.aiModel);
      if (typeof parsed.aiPollInterval === "number" && Number.isFinite(parsed.aiPollInterval)) {
        setAiPollInterval(parsed.aiPollInterval);
      }
      if (typeof parsed.primaryAiKey === "string") setPrimaryAiKey(parsed.primaryAiKey);
      if (typeof parsed.secondaryAiKey === "string") setSecondaryAiKey(parsed.secondaryAiKey);
    } catch (err) {
      console.warn("[SettingsLogs] failed to load AI draft", err);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        AI_DRAFT_KEY,
        JSON.stringify({
          aiEnabled,
          aiModel,
          aiPollInterval,
          primaryAiKey,
          secondaryAiKey,
        }),
      );
    } catch {
      // Ignore draft persistence errors
    }
  }, [aiEnabled, aiModel, aiPollInterval, primaryAiKey, secondaryAiKey]);

  // AI Research state
  const aiInit = useAiResearchStore((s) => s.init);
  const aiLoadConfig = useAiResearchStore((s) => s.loadConfig);
  const aiSaveConfig = useAiResearchStore((s) => s.saveConfig);
  const aiRunNow = useAiResearchStore((s) => s.runNow);
  const aiRefreshBriefs = useAiResearchStore((s) => s.refreshBriefs);
  const aiCheckRuntime = useAiResearchStore((s) => s.checkRuntime);
  const aiConfig = useAiResearchStore((s) => s.config);
  const aiStatus = useAiResearchStore((s) => s.status);
  const aiRuntime = useAiResearchStore((s) => s.runtime);
  const aiBriefs = useAiResearchStore((s) => s.briefs);
  const aiProgress = useAiResearchStore((s) => s.progress);
  const aiLastErrors = useAiResearchStore((s) => s.lastErrors);
  const aiLoading = useAiResearchStore((s) => s.loading);
  const aiError = useAiResearchStore((s) => s.error);
  const isIpcOnlyAiError = aiError === "AI IPC API unavailable";
  const showAiErrorBanner = !!aiError && !(isIpcOnlyAiError && aiRuntime?.available);
  const isSettingsApiUnavailable = aiSelectionStatus === "Settings API unavailable";
  const showAiSelectionStatus = !!aiSelectionStatus && !(isSettingsApiUnavailable && aiRuntime?.available);

  const aiOptions = useMemo(() => {
    const options: Array<{ key: string; label: string }> = [];
    const addOption = (key: string, label: string) => {
      if (!options.some((opt) => opt.key === key)) {
        options.push({ key, label });
      }
    };

    const localModel = (aiModel ?? "").trim() || "deepseek-r1:14b";
    addOption(buildAiKey("ollama", localModel), `Local Ollama (${localModel})`);

    availableModels
      .map((model) => model.trim())
      .filter((model) => model.length > 0)
      .forEach((model) => {
        addOption(buildAiKey("ollama", model), `Local Ollama (${model})`);
      });

    cloudAiModels.forEach((model) => {
      const key = buildAiKey(model.provider, model.model);
      const status = model.enabled ? "" : " (disabled)";
      addOption(key, `${model.provider} / ${model.model}${status}`);
    });

    [primaryAiKey, secondaryAiKey].forEach((key) => {
      if (!key) return;
      if (!options.some((opt) => opt.key === key)) {
        addOption(key, `Saved: ${key}`);
      }
    });

    if (aiEnginePreference === "cloud-only") {
      return options.filter((opt) => isCloudAiKey(opt.key));
    }
    if (aiEnginePreference === "local-only") {
      return options.filter((opt) => !isCloudAiKey(opt.key));
    }
    return options;
  }, [aiEnginePreference, aiModel, cloudAiModels, primaryAiKey, secondaryAiKey]);

  const filteredModelOptions = useMemo(() => {
    const merged = new Set<string>();
    availableModels.forEach((name) => {
      if (!name) return;
      if (aiEnginePreference === "cloud-only" && !isCloudModelName(name)) return;
      if (aiEnginePreference === "local-only" && isCloudModelName(name)) return;
      merged.add(name);
    });
    if (aiModel?.trim()) {
      const current = (aiModel ?? "").trim();
      const shouldIncludeCurrent =
        aiEnginePreference === "cloud-first" ||
        (aiEnginePreference === "cloud-only" && isCloudModelName(current)) ||
        (aiEnginePreference === "local-only" && !isCloudModelName(current));
      if (shouldIncludeCurrent) merged.add(current);
    }
    return Array.from(merged);
  }, [availableModels, aiEnginePreference, aiModel]);

  const defaultPrimaryAiKey = useMemo(() => {
    const fallbackLocal = buildAiKey("ollama", (aiModel ?? "").trim() || "deepseek-r1:14b");
    return aiOptions[0]?.key ?? fallbackLocal;
  }, [aiModel, aiOptions]);

  const primarySelection = useMemo(() => parseAiKey(primaryAiKey || defaultPrimaryAiKey), [primaryAiKey, defaultPrimaryAiKey]);
  const secondarySelection = useMemo(() => parseAiKey(secondaryAiKey), [secondaryAiKey]);
  const needsOllamaCloudKey = useMemo(() => {
    const primaryNeeds =
      primarySelection?.provider.toLowerCase() === "ollama" &&
      isCloudModelName(primarySelection.model);
    const secondaryNeeds =
      secondarySelection?.provider.toLowerCase() === "ollama" &&
      isCloudModelName(secondarySelection.model);
    return Boolean(primaryNeeds || secondaryNeeds);
  }, [primarySelection, secondarySelection]);

  useEffect(() => {
    const validKeys = new Set(aiOptions.map((opt) => opt.key));
    if (primaryAiKey && !validKeys.has(primaryAiKey)) {
      setPrimaryAiKey(defaultPrimaryAiKey);
    }
    if (secondaryAiKey && !validKeys.has(secondaryAiKey)) {
      setSecondaryAiKey("");
    }
  }, [aiOptions, defaultPrimaryAiKey, primaryAiKey, secondaryAiKey]);

  useEffect(() => {
    const parsed = parseAiKey(primaryAiKey || defaultPrimaryAiKey);
    if (!parsed) return;
    if (parsed.provider.toLowerCase() !== "ollama") return;
    if (parsed.model !== aiModel) {
      setAiModel(parsed.model);
    }
  }, [primaryAiKey, defaultPrimaryAiKey, aiModel]);

  const persistAiSelections = useCallback(async () => {
    const primaryKey = primaryAiKey || defaultPrimaryAiKey;
    const secondaryKey = secondaryAiKey || "";
    const primary = parseAiKey(primaryKey);
    const secondary = secondaryKey ? parseAiKey(secondaryKey) : null;

    if (!settingsApi?.settingsGet || !settingsApi?.settingsSet) {
      try {
        localStorage.setItem(AI_SELECTIONS_KEY, JSON.stringify({ primaryAiKey: primaryKey, secondaryAiKey: secondaryKey }));
        setAiSelectionStatus("Primary/secondary AI saved locally");
        setTimeout(() => setAiSelectionStatus(null), 3000);
      } catch (err) {
        console.warn("[SettingsLogs] failed to save local AI selections", err);
        setAiSelectionStatus("Failed to save AI selections");
      }
      return;
    }

    try {
      const settings = await settingsApi.settingsGet();
      const next = {
        ...settings,
        primaryAiModel: primary,
        secondaryAiModel: secondary,
        globalAiModel: primary?.model,
      };
      await settingsApi.settingsSet(next);
      localStorage.setItem(AI_SELECTIONS_KEY, JSON.stringify({ primaryAiKey: primaryKey, secondaryAiKey: secondaryKey }));
      setAiSelectionStatus("Primary/secondary AI saved");
      setTimeout(() => setAiSelectionStatus(null), 3000);
    } catch (err) {
      console.warn("[SettingsLogs] failed to save AI selections", err);
      setAiSelectionStatus("Failed to save AI selections");
    }
  }, [settingsApi, primaryAiKey, secondaryAiKey, defaultPrimaryAiKey]);

  const handleSaveSettings = useCallback(async () => {
    if (settingsSaving) return;
    setSettingsSaving(true);
    setSettingsSaveStatus(null);
    try {
      saveSettings();
      await persistAiSelections();
      setSettingsSaveStatus("Saved");
      setTimeout(() => setSettingsSaveStatus(null), 2500);
    } catch (err) {
      console.warn("[SettingsLogs] failed to save settings", err);
      setSettingsSaveStatus("Save failed");
    } finally {
      setSettingsSaving(false);
    }
  }, [saveSettings, persistAiSelections, settingsSaving]);

  const saveGwmdSettings = useCallback(() => {
    try {
      window.localStorage.setItem(
        GWMD_USER_SETTINGS_KEY,
        JSON.stringify(gwmdSettingsDraft),
      );
      setGwmdSettingsStatus("GWMD settings saved");
      setTimeout(() => setGwmdSettingsStatus(null), 2500);
    } catch (err) {
      setGwmdSettingsStatus(
        `Failed to save GWMD settings: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, [gwmdSettingsDraft]);

  const resetGwmdSettings = useCallback(() => {
    setGwmdSettingsDraft(DEFAULT_GWMD_SETTINGS);
    setGwmdSettingsStatus("GWMD defaults restored (click Save to persist)");
  }, []);

  const stewardInit = useAiStewardStore((s) => s.init);
  const stewardOverview = useAiStewardStore((s) => s.overview);
  const stewardHealth = useAiStewardStore((s) => s.health);
  const stewardIncidentDigest = useAiStewardStore((s) => s.incidentDigest);
  const stewardFindings = useAiStewardStore((s) => s.findings);
  const stewardTasks = useAiStewardStore((s) => s.tasks);
  const stewardCheckHealth = useAiStewardStore((s) => s.checkHealth);
  const stewardSetConfig = useAiStewardStore((s) => s.setConfig);
  const stewardDismissFinding = useAiStewardStore((s) => s.dismissFinding);
  const stewardApplyTask = useAiStewardStore((s) => s.applyTask);
  const stewardLoading = useAiStewardStore((s) => s.loading);
  const stewardError = useAiStewardStore((s) => s.error);
  const [stewardCheckBusy, setStewardCheckBusy] = useState(false);
  const [stewardPolicySaving, setStewardPolicySaving] = useState(false);
  const [stewardPolicyStatus, setStewardPolicyStatus] = useState<string | null>(null);
  const [stewardAutoFixDraft, setStewardAutoFixDraft] = useState(false);
  const [stewardIntervalDraft, setStewardIntervalDraft] = useState(30);
  const [stewardCftcModeDraft, setStewardCftcModeDraft] = useState<"off" | "suggest" | "auto">("suggest");
  const [stewardCongressModeDraft, setStewardCongressModeDraft] = useState<"off" | "suggest" | "auto">("suggest");

  const secretsApi = window.cockpit?.secrets;
  const apiHubApi = window.cockpit?.apiHub;
  const externalFeedsApi = window.cockpit?.externalFeeds;
  const apiHubSyncedRef = useRef(false);
  const localApiKeysRef = useRef(apiKeys);

  useEffect(() => {
    localApiKeysRef.current = apiKeys;
  }, [apiKeys]);

  useEffect(() => {
    if (!apiHubApi || apiHubSyncedRef.current) return;
    apiHubSyncedRef.current = true;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;

    const bootstrap = async () => {
      try {
        const snapshot = await apiHubApi.list?.();
        if (disposed) return;
        const remoteKeys = snapshot?.records ?? [];
        if (remoteKeys.length) {
          setApiKeys(remoteKeys);
        } else if (localApiKeysRef.current.length) {
          for (const key of localApiKeysRef.current) {
            await apiHubApi.save?.(key);
          }
          const refreshed = await apiHubApi.list?.();
          if (!disposed && refreshed?.records) {
            setApiKeys(refreshed.records);
          }
        }
      } catch (err) {
        console.warn("[SettingsLogs] apiHub bootstrap failed", err);
      } finally {
        if (!disposed) {
          const off = apiHubApi.onChanged?.((snapshot) => {
            setApiKeys(snapshot?.records ?? []);
          });
          unsubscribe = typeof off === "function" ? off : undefined;
        }
      }
    };

    bootstrap();

    return () => {
      disposed = true;
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, [apiHubApi, setApiKeys]);

  const refreshModelCatalog = useCallback(async () => {
    const listModels = window.cockpit?.aiResearch?.listModels;
    console.log("[SettingsLogs] refreshModelCatalog() called, API available:", !!listModels);

    console.log("[SettingsLogs] 🔍 Calling listModels()...");
    setModelsLoading(true);
    try {
      let modelsFromSource: string[] = [];
      let sourceLabel = "IPC";

      if (listModels) {
        const startTime = Date.now();
        const result = await listModels();
        const duration = Date.now() - startTime;
        console.log(`[SettingsLogs] ✅ Model scan completed in ${duration}ms:`, result);

        if (Array.isArray(result?.models)) {
          modelsFromSource = result.models.filter((m): m is string => typeof m === "string" && m.length > 0);
        }

        if (result?.ok === false || modelsFromSource.length === 0) {
          console.warn("[SettingsLogs] IPC returned no models, trying direct HTTP fallback");
          const directModels = await fetchModelsDirectFromOllama();
          if (directModels.length > 0) {
            modelsFromSource = directModels;
            sourceLabel = "Direct HTTP";
          }
          setModelsError(result.error ?? (directModels.length ? null : "Unable to query Ollama"));
        } else {
          setModelsError(null);
        }
      } else {
        console.warn("[SettingsLogs] IPC unavailable, using direct HTTP fallback");
        const directModels = await fetchModelsDirectFromOllama();
        if (directModels.length > 0) {
          modelsFromSource = directModels;
          sourceLabel = "Direct HTTP";
          setModelsError(null);
        } else {
          const errorMsg = "AI runtime scan unavailable - both IPC and direct HTTP failed";
          setModelsError(errorMsg);
          console.error("[SettingsLogs] ❌", errorMsg);
        }
      }

      const merged = Array.from(new Set([...MODEL_PRESETS, ...modelsFromSource]));
      console.log(`[SettingsLogs] 📋 ${sourceLabel}: found ${modelsFromSource.length} models, merged to ${merged.length} total`);
      if (merged.length > 0) {
        setAvailableModels(merged);
      }
    } catch (err) {
      console.error("[SettingsLogs] ❌ Model scan exception:", err);
      const directModels = await fetchModelsDirectFromOllama();
      if (directModels.length > 0) {
        const merged = Array.from(new Set([...MODEL_PRESETS, ...directModels]));
        setAvailableModels(merged);
        setModelsError(null);
        console.log(`[SettingsLogs] ✅ Recovery via direct HTTP fallback: ${directModels.length} models`);
      } else {
        setModelsError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    console.log("[SettingsLogs] ⚡ Component mounted, initializing AI services...");
    console.log("[SettingsLogs] window.cockpit available:", !!window.cockpit);
    console.log("[SettingsLogs] window.cockpit.aiResearch available:", !!window.cockpit?.aiResearch);

    aiInit();
    aiLoadConfig();
    aiRefreshBriefs(5);

    // Delay the runtime check to ensure backend is initialized
    const checkTimer = setTimeout(() => {
      console.log("[SettingsLogs] ⏰ 1-second delay complete, running Ollama runtime check...");
      aiCheckRuntime().catch((err) => {
        console.error("[SettingsLogs] ❌ aiCheckRuntime() exception:", err);
      });
    }, 1000);

    // Delay model catalog too
    const scanTimer = setTimeout(() => {
      console.log("[SettingsLogs] ⏰ Running model catalog scan...");
      refreshModelCatalog();
    }, 1500);

    return () => {
      clearTimeout(checkTimer);
      clearTimeout(scanTimer);
    };
  }, [aiInit, aiLoadConfig, aiRefreshBriefs, aiCheckRuntime, refreshModelCatalog]);

  useEffect(() => {
    stewardInit();
  }, [stewardInit]);

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Sync external feeds from main process and localStorage on mount
  useEffect(() => {
    let active = true;
    const syncAll = async () => {
      // 1. Load from localStorage first (local cache)
      loadSettings();

      // 2. Then fetch from main process to sync state
      if (!externalFeedsApi?.getConfig) return;
      try {
        const cfg = await externalFeedsApi.getConfig();
        if (!active || !cfg) return;
        setExternalFeeds({
          enableCftc: cfg.enabled?.cftc ?? false,
          enableSec: cfg.enabled?.sec ?? false,
          enableBls: cfg.enabled?.bls ?? false,
          blsApiKeyId: cfg.bls?.apiKeyId,
          blsApiKeyAccount: cfg.bls?.apiKeyAccount,
          cftcMappingPath: cfg.cftc?.mappingPath,
          cftcSampleZipPath: cfg.cftc?.sampleZipPath,
          secCikMappingPath: cfg.sec?.cikMappingPath,
        });
      } catch (err) {
        console.warn("[SettingsLogs] failed to load external feeds config:", err);
      }
    };
    syncAll();
    return () => {
      active = false;
    };
  }, [externalFeedsApi, setExternalFeeds, loadSettings]);

  useEffect(() => {
    if (!aiConfig) return;
    setAiEnabled(aiConfig.enabled);
    setAiModel(aiConfig.model);
    setAiPollInterval(aiConfig.pollIntervalSec);
    setAiRssFeeds((aiConfig.rssFeeds ?? []).join("\n"));
    setAiSecForms((aiConfig.secForms ?? []).join(","));
    setAiWatchlistTickers((aiConfig.watchlistTickers ?? []).join(","));
    setAiWatchlistKeywords((aiConfig.watchlistKeywords ?? []).join(","));
  }, [aiConfig]);

  // Load Ollama API key from localStorage on mount
  useEffect(() => {
    const stored = window.localStorage.getItem("ollama_api_key");
    if (stored) {
      setOllamaApiKey(stored);
      console.log("[SettingsLogs] Loaded Ollama API key from localStorage");
    }
  }, []);

  useEffect(() => {
    let disposed = false;

    const loadBackendUrl = async () => {
      try {
        const loaded = await settingsApi?.backendUrlGet?.();
        if (disposed) return;
        const next = (typeof loaded === "string" && loaded.trim()) || getBackendBaseUrl();
        setBackendUrlDraft(next);
      } catch {
        if (disposed) return;
        setBackendUrlDraft(getBackendBaseUrl());
      }
    };

    loadBackendUrl();
    return () => {
      disposed = true;
    };
  }, [settingsApi]);

  useEffect(() => {
    let disposed = false;

    const loadTedConfig = async () => {
      try {
        const config = await settingsApi?.tedConfigGet?.();
        if (disposed || !config || typeof config !== "object") return;

        const value = config as Record<string, unknown>;
        if (typeof value.enabled === "boolean") setTedLiveEnabled(value.enabled);
        if (typeof value.baseUrl === "string") setTedBaseUrl(value.baseUrl);
        if (typeof value.apiKey === "string") setTedApiKey(value.apiKey);
        if (typeof value.authHeader === "string" && value.authHeader.trim()) {
          setTedAuthHeader(value.authHeader);
        }
        if (typeof value.timeoutMs === "number" && Number.isFinite(value.timeoutMs)) {
          setTedTimeoutMs(value.timeoutMs);
        }
        if (
          typeof value.windowQueryParam === "string" &&
          value.windowQueryParam.trim()
        ) {
          setTedWindowQueryParam(value.windowQueryParam);
        }
      } catch (err) {
        if (!disposed) {
          console.warn("[SettingsLogs] failed to load TED config", err);
          addLog({
            timestamp: Date.now(),
            level: "error",
            category: "ted-intel",
            message: `Failed to load TED config: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }
    };

    loadTedConfig();

    return () => {
      disposed = true;
    };
  }, [settingsApi]);

  const saveBackendUrl = useCallback(async () => {
    const next = backendUrlDraft.trim();
    if (!next) {
      setBackendUrlStatus("❌ Backend URL is required");
      return;
    }

    setBackendUrlSaving(true);
    setBackendUrlStatus(null);
    try {
      await settingsApi?.backendUrlSet?.(next);
      setBackendBaseUrl(next);
      await refreshBackendBaseUrl();
      setBackendUrlDraft(getBackendBaseUrl());
      setBackendUrlStatus("✅ Backend URL saved");
      setBackendHealth("unknown");
    } catch (error) {
      setBackendUrlStatus(`❌ Failed to save backend URL: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBackendUrlSaving(false);
    }
  }, [backendUrlDraft, settingsApi]);

  const resetBackendUrl = useCallback(async () => {
    setBackendUrlDraft(DEFAULT_BACKEND_URL);
    setBackendUrlStatus(null);
    setBackendHealth("unknown");
  }, []);

  const checkBackendHealth = useCallback(async () => {
    setBackendHealthChecking(true);
    setBackendUrlStatus(null);
    try {
      const baseUrl = backendUrlDraft.trim().replace(/\/+$/, "");
      const response = await fetch(`${baseUrl}/health`, { method: "GET" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      setBackendHealth("ok");
      setBackendUrlStatus("✅ Backend is reachable");
    } catch (error) {
      setBackendHealth("error");
      setBackendUrlStatus(`❌ Health check failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBackendHealthChecking(false);
    }
  }, [backendUrlDraft]);

  useEffect(() => {
    let active = true;

    void updatesApi?.getStatus?.()
      .then((status) => {
        if (active && status) {
          setUpdateStatus(status as DesktopUpdateStatus);
        }
      })
      .catch((error) => {
        if (active) {
          setUpdateStatus({
            state: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });

    const unsubscribe = updatesApi?.onStatus?.((status) => {
      if (active) {
        setUpdateStatus(status as DesktopUpdateStatus);
      }
    });

    return () => {
      active = false;
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, [updatesApi]);

  const handleCheckForUpdates = useCallback(async () => {
    if (!updatesApi?.check) {
      setUpdateStatus({
        state: "unsupported",
        message: "Updater bridge unavailable in this build.",
      });
      return;
    }

    setUpdateChecking(true);
    try {
      const status = await updatesApi.check();
      setUpdateStatus(status as DesktopUpdateStatus);
    } catch (error) {
      setUpdateStatus({
        state: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setUpdateChecking(false);
    }
  }, [updatesApi]);

  const handleInstallUpdate = useCallback(async () => {
    if (!updatesApi?.install) {
      setUpdateStatus({
        state: "error",
        message: "Install action unavailable in this build.",
      });
      return;
    }

    const result = await updatesApi.install();
    if (!result?.ok) {
      setUpdateStatus((prev) => ({
        ...(prev ?? {
          state: "error" as const,
          message: "Update is not ready to install yet.",
        }),
        state: "error",
        message: result?.error ?? "Update is not ready to install yet.",
      }));
    }
  }, [updatesApi]);

  const saveTedConfig = useCallback(async () => {
    if (!settingsApi?.tedConfigSet) {
      setTedConfigStatus("❌ TED config API unavailable");
      addLog({
        timestamp: Date.now(),
        level: "error",
        category: "ted-intel",
        message: "TED config API unavailable in renderer bridge",
      });
      return;
    }

    if (!tedBaseUrl.trim()) {
      setTedConfigStatus("❌ TED base URL is required");
      addLog({
        timestamp: Date.now(),
        level: "error",
        category: "ted-intel",
        message: "TED config save blocked: missing base URL",
      });
      return;
    }

    if (!tedApiKey.trim()) {
      setTedConfigStatus("❌ TED API key is required. Save it here or edit it in API Hub.");
      addLog({
        timestamp: Date.now(),
        level: "error",
        category: "ted-intel",
        message: "TED config save blocked: missing API key",
      });
      return;
    }

    setTedConfigSaving(true);
    setTedConfigStatus(null);
    try {
      const response = await settingsApi.tedConfigSet({
        enabled: tedLiveEnabled,
        baseUrl: tedBaseUrl,
        apiKey: tedApiKey,
        authHeader: tedAuthHeader,
        timeoutMs: tedTimeoutMs,
        windowQueryParam: tedWindowQueryParam,
      });

      const hasApiKey =
        typeof response?.hasApiKey === "boolean"
          ? response.hasApiKey
          : tedApiKey.trim().length > 0;
      setApiKeys(
        [
          ...apiKeys.filter((key) => key.id !== TED_API_HUB_RECORD_ID),
          {
            id: TED_API_HUB_RECORD_ID,
            name: "TED Live Feed",
            provider: "ted",
            createdAt: Date.now(),
            fields: [
              {
                key: "TED_API_KEY",
                label: "API Key",
                account: TED_API_KEY_ACCOUNT,
              },
            ],
            config: {
              BASE_URL: tedBaseUrl.trim(),
              AUTH_HEADER: tedAuthHeader.trim(),
              TIMEOUT_MS: String(tedTimeoutMs),
              WINDOW_QUERY_PARAM: tedWindowQueryParam.trim(),
              ENABLED: tedLiveEnabled ? "true" : "false",
            },
          },
        ],
        { persist: true },
      );
      addLog({
        timestamp: Date.now(),
        level: "info",
        category: "ted-intel",
        message: `TED config saved. Live feed ${tedLiveEnabled ? "enabled" : "disabled"}.`,
      });
      setTedConfigStatus(
        `✅ TED config saved to Settings and API Hub${hasApiKey ? "" : " (no API key stored)"}`,
      );
      setTimeout(() => setTedConfigStatus(null), 3500);
    } catch (error) {
      addLog({
        timestamp: Date.now(),
        level: "error",
        category: "ted-intel",
        message: `TED config save failed: ${error instanceof Error ? error.message : String(error)}`,
      });
      setTedConfigStatus(
        `❌ Failed to save TED config: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setTedConfigSaving(false);
    }
  }, [
    settingsApi,
    tedLiveEnabled,
    tedBaseUrl,
    tedApiKey,
    tedAuthHeader,
    tedTimeoutMs,
    tedWindowQueryParam,
  ]);

  const testTedApi = useCallback(async () => {
    setTedApiTesting(true);
    setTedApiTestResult(null);
    try {
      // Always push current form config to the backend before testing so a
      // backend restart (e.g. tsx watch picking up code changes) doesn't leave
      // the in-memory config stale with TED_LIVE_ENABLED=false from .env.
      if (settingsApi?.tedConfigSet && tedBaseUrl.trim() && tedApiKey.trim()) {
        try {
          await settingsApi.tedConfigSet({
            enabled: tedLiveEnabled,
            baseUrl: tedBaseUrl,
            apiKey: tedApiKey,
            authHeader: tedAuthHeader,
            timeoutMs: tedTimeoutMs,
            windowQueryParam: tedWindowQueryParam,
          });
        } catch {
          // Non-fatal — backend may be starting up; proceed to test anyway.
        }
      }

      const api = window.cockpit?.tedIntel;
      if (!api?.getSnapshot) {
        setTedApiTestResult({ ok: false, message: "TED Intel IPC not available" });
        return;
      }
      const snapshot = await api.getSnapshot("90d");
      const mode = snapshot.sourceMode ?? "unknown";
      const label = snapshot.sourceLabel ?? "—";
      const at = snapshot.generatedAt
        ? new Date(snapshot.generatedAt).toLocaleTimeString()
        : "—";

      if (mode === "mock") {
        setTedApiTestResult({
          ok: false,
          message: `⚠️ Received mock data — backend is using fallback. Check that the backend is running, Base URL and API Key are correct, and click Save TED Config first.`,
        });
        return;
      }

      setTedApiTestResult({
        ok: true,
        message: `✅ Live — ${label} • generated ${at}`,
      });
    } catch (err) {
      setTedApiTestResult({
        ok: false,
        message: `❌ ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setTedApiTesting(false);
    }
  }, [
    settingsApi,
    tedLiveEnabled,
    tedBaseUrl,
    tedApiKey,
    tedAuthHeader,
    tedTimeoutMs,
    tedWindowQueryParam,
  ]);

  // Save Ollama API key to localStorage when it changes
  useEffect(() => {
    if (ollamaApiKey) {
      window.localStorage.setItem("ollama_api_key", ollamaApiKey);
      console.log("[SettingsLogs] Saved Ollama API key to localStorage");
    } else {
      window.localStorage.removeItem("ollama_api_key");
    }
  }, [ollamaApiKey]);

  const filteredLogs = useMemo(() => {
    if (logFilter === "all") return logs;
    return logs.filter((l) => l.level === logFilter);
  }, [logs, logFilter]);

  const blsKeys = useMemo(() => apiKeys.filter((k) => k.provider === "bls"), [apiKeys]);
  const stewardModules = stewardOverview?.modules ?? [];
  const moduleStateMap = useMemo(() => {
    const map = new Map<AiStewardModule, AiStewardModuleState>();
    stewardModules.forEach((m) => map.set(m.module, m));
    return map;
  }, [stewardModules]);


  const getModuleStatusStyle = useCallback(
    (module: AiStewardModule) => {
      const state = moduleStateMap.get(module);
      const status = (state?.status ?? "degraded") as AiStewardModuleStatus;
      return MODULE_STATUS_STYLE[status];
    },
    [moduleStateMap],
  );

  const stewardHealthModules = useMemo(
    () =>
      (stewardHealth?.modules ?? []).filter((module) =>
        ["cftc", "congress"].includes(module.module),
      ),
    [stewardHealth],
  );

  const stewardFindingsList = useMemo(
    () => (Array.isArray(stewardFindings) ? stewardFindings : []),
    [stewardFindings],
  );

  const stewardTasksList = useMemo(
    () => (Array.isArray(stewardTasks) ? stewardTasks : []),
    [stewardTasks],
  );

  const recentStewardFindings = useMemo(
    () => [...stewardFindingsList].sort((a, b) => b.detectedAt - a.detectedAt).slice(0, 8),
    [stewardFindingsList],
  );

  const recentStewardTasks = useMemo(
    () => [...stewardTasksList].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8),
    [stewardTasksList],
  );

  const handleRunStewardHealthCheck = useCallback(async () => {
    if (stewardCheckBusy) return;
    setStewardCheckBusy(true);
    try {
      await stewardCheckHealth();
    } catch {
      // Store owns steward error state updates.
    } finally {
      setStewardCheckBusy(false);
    }
  }, [stewardCheckBusy, stewardCheckHealth]);

  const openClawErrorText = (stewardError ?? "").toLowerCase();
  const openClawReadiness = useMemo(() => {
    const backendAvailable = !openClawErrorText.includes("steward_unavailable_no_database");
    const authenticated = !openClawErrorText.includes("unauthorized");
    const hasHealthSignal = Boolean(stewardHealth?.generatedAt || stewardOverview?.lastCheckAt);
    const serviceResponsive = hasHealthSignal && !stewardError;

    const status: "connected" | "connecting" | "action_required" | "initializing" =
      stewardLoading
        ? "connecting"
        : serviceResponsive
          ? "connected"
          : stewardError
            ? "action_required"
            : "initializing";

    return {
      backendAvailable,
      authenticated,
      hasHealthSignal,
      serviceResponsive,
      status,
    };
  }, [openClawErrorText, stewardError, stewardHealth?.generatedAt, stewardLoading, stewardOverview?.lastCheckAt]);

  const openClawStatusStyle = useMemo(() => {
    if (openClawReadiness.status === "connected") {
      return {
        border: "1px solid rgba(34,197,94,0.45)",
        background: "rgba(34,197,94,0.14)",
        color: "#bbf7d0",
        label: "OpenClaw Connected",
      };
    }
    if (openClawReadiness.status === "connecting") {
      return {
        border: "1px solid rgba(59,130,246,0.45)",
        background: "rgba(59,130,246,0.14)",
        color: "#bfdbfe",
        label: "Connecting OpenClaw",
      };
    }
    if (openClawReadiness.status === "action_required") {
      return {
        border: "1px solid rgba(248,113,113,0.45)",
        background: "rgba(248,113,113,0.14)",
        color: "#fecaca",
        label: "Action Required",
      };
    }
    return {
      border: "1px solid rgba(251,191,36,0.45)",
      background: "rgba(251,191,36,0.14)",
      color: "#fde68a",
      label: "Initializing OpenClaw",
    };
  }, [openClawReadiness.status]);

  const handleConnectOpenClaw = useCallback(async () => {
    if (stewardCheckBusy || stewardLoading) return;
    stewardInit();
    await handleRunStewardHealthCheck();
  }, [handleRunStewardHealthCheck, stewardCheckBusy, stewardInit, stewardLoading]);

  useEffect(() => {
    const config = stewardOverview?.config;
    if (!config) return;
    setStewardAutoFixDraft(Boolean(config.autoFixData));
    setStewardIntervalDraft(
      Number.isFinite(config.checkIntervalMinutes)
        ? Math.max(5, Math.floor(config.checkIntervalMinutes))
        : 30,
    );
    setStewardCftcModeDraft(
      config.modules?.cftc?.mode === "off" ? "off" : "suggest",
    );
    setStewardCongressModeDraft(
      config.modules?.congress?.mode === "off" ? "off" : "suggest",
    );
  }, [stewardOverview?.config]);

  const handleSaveStewardPolicy = useCallback(async () => {
    if (stewardPolicySaving) return;
    setStewardPolicySaving(true);
    setStewardPolicyStatus(null);
    try {
      await stewardSetConfig({
        autoFixData: stewardAutoFixDraft,
        checkIntervalMinutes: Math.max(5, stewardIntervalDraft),
        modules: {
          cftc: { mode: stewardCftcModeDraft },
          congress: { mode: stewardCongressModeDraft },
        },
      });
      setStewardPolicyStatus("Policy saved");
      setTimeout(() => setStewardPolicyStatus(null), 2500);
    } catch {
      setStewardPolicyStatus("Policy save failed");
    } finally {
      setStewardPolicySaving(false);
    }
  }, [
    stewardAutoFixDraft,
    stewardCongressModeDraft,
    stewardCftcModeDraft,
    stewardIntervalDraft,
    stewardPolicySaving,
    stewardSetConfig,
  ]);

  const aiRoutingOptions = useMemo(() => {
    const map = new Map<string, string>();
    map.set("auto", "Auto (first connected provider)");

    const ollamaEnabled = cloudAiModels.some((entry) => entry.provider === "ollama" && entry.enabled);
    if (ollamaEnabled) {
      map.set("ollama", "Ollama (local)");
    }

    const providerLabels: Record<string, string> = {
      openai: "OpenAI",
      anthropic: "Anthropic",
      gemini: "Google Gemini",
      mistral: "Mistral",
      groq: "Groq",
      xai: "xAI / Grok",
    };

    apiKeys.forEach((entry) => {
      const provider = String(entry.provider);
      if (provider in providerLabels) {
        map.set(provider, providerLabels[provider]);
      }
    });

    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  }, [cloudAiModels, apiKeys]);

  const syncExternalFeeds = async (next?: Partial<typeof externalFeeds>) => {
    if (!externalFeedsApi?.setConfig) {
      console.warn("[SettingsLogs] ❌ externalFeedsApi.setConfig not available");
      return;
    }
    const merged = { ...externalFeeds, ...next };
    console.log("[SettingsLogs] 📤 Calling syncExternalFeeds with:", merged);
    try {
      await externalFeedsApi.setConfig({
        enabled: {
          cftc: merged.enableCftc,
          sec: merged.enableSec,
          bls: merged.enableBls,
        },
        bls: {
          apiKeyId: merged.blsApiKeyId,
          apiKeyAccount: merged.blsApiKeyAccount,
        },
        cftc: {
          mappingPath: merged.cftcMappingPath,
          sampleZipPath: merged.cftcSampleZipPath,
        },
        sec: {
          cikMappingPath: merged.secCikMappingPath,
        },
      });
      console.log("[SettingsLogs] ✅ syncExternalFeeds succeeded");
    } catch (err) {
      console.error("[SettingsLogs] ❌ syncExternalFeeds failed:", err);
    }
  };

  const testExternalFeed = async (providerId: "CFTC_COT" | "BLS_JOLTS" | "SEC_EDGAR") => {
    if (!externalFeedsApi?.testProvider) {
      setExternalFeedTests((prev) => ({
        ...prev,
        [providerId]: { status: "error", message: "External feed testing not available", timestamp: Date.now() },
      }));
      return;
    }

    const credentials: Record<string, string> = {};
    if (providerId === "BLS_JOLTS") {
      const blsKey = blsKeys.find((k) => k.id === externalFeeds.blsApiKeyId);
      const field = blsKey?.fields.find((f) => f.key === "BLS_API_KEY");
      if (field) credentials.BLS_API_KEY = await window.cockpit?.secrets?.get?.(field.account) ?? "";
    }

    const result = await externalFeedsApi.testProvider(providerId, credentials);
    setExternalFeedTests((prev) => ({
      ...prev,
      [providerId]: {
        status: result.ok ? "success" : "error",
        message: result.message,
        timestamp: Date.now(),
      },
    }));
  };

  const healthStatus = useMemo(() => {
    return Object.values(feedHealth).map((h) => ({
      ...h,
      latencyDisplay: h.latencyMs ? `${h.latencyMs}ms` : "—",
      lastEventDisplay: h.lastEventTs ? fmt(h.lastEventTs) : "—",
    }));
  }, [feedHealth]);

  const parseList = (value: string) =>
    value
      .split(/[\n,]/)
      .map((v) => v.trim())
      .filter(Boolean);

  // Test API Key function
  const testApiKey = async (apiKey: typeof apiKeys[0]) => {
    const apiKeyApi = window.cockpit?.apiKey;
    if (!apiKeyApi?.validateStored) {
      setKeyTestResults(prev => {
        const next = new Map(prev);
        next.set(apiKey.id, {
          status: 'error',
          message: 'API validation not available',
          timestamp: Date.now()
        });
        return next;
      });
      return;
    }

    setTestingKeys(prev => new Set(prev).add(apiKey.id));

    try {
      const result = await apiKeyApi.validateStored(apiKey.id, apiKey.provider, apiKey.fields, apiKey.config);

      setKeyTestResults(prev => {
        const next = new Map(prev);
        next.set(apiKey.id, {
          status: result.valid ? 'success' : 'error',
          message: result.message,
          timestamp: Date.now(),
          details: result.details
        });
        return next;
      });
    } catch (error) {
      setKeyTestResults(prev => {
        const next = new Map(prev);
        next.set(apiKey.id, {
          status: 'error',
          message: error instanceof Error ? error.message : 'Unknown error',
          timestamp: Date.now()
        });
        return next;
      });
    } finally {
      setTestingKeys(prev => {
        const next = new Set(prev);
        next.delete(apiKey.id);
        return next;
      });
    }
  };

  // Test All API Keys
  const testAllApiKeys = async () => {
    for (const key of apiKeys) {
      await testApiKey(key);
    }
  };

  const providerTemplateEntries = useMemo(
    () => Object.entries(API_KEY_TEMPLATES) as Array<[ApiKeyProviderOption, (typeof API_KEY_TEMPLATES)[ApiKeyProviderOption]]>,
    [],
  );

  const enabledProviderCount = useMemo(
    () => Object.values(providerDrafts).filter((draft) => draft.enabled).length,
    [providerDrafts],
  );

  const setProviderEnabled = (provider: ApiKeyProviderOption, enabled: boolean) => {
    setProviderDrafts((prev) => ({
      ...prev,
      [provider]: { ...prev[provider], enabled },
    }));
  };

  const setProviderName = (provider: ApiKeyProviderOption, value: string) => {
    setProviderDrafts((prev) => ({
      ...prev,
      [provider]: { ...prev[provider], name: value },
    }));
  };

  const setProviderSecret = (provider: ApiKeyProviderOption, key: string, value: string) => {
    setProviderDrafts((prev) => ({
      ...prev,
      [provider]: {
        ...prev[provider],
        secrets: { ...prev[provider].secrets, [key]: value },
      },
    }));
  };

  const setProviderConfig = (provider: ApiKeyProviderOption, key: string, value: string) => {
    setProviderDrafts((prev) => ({
      ...prev,
      [provider]: {
        ...prev[provider],
        config: { ...prev[provider].config, [key]: value },
      },
    }));
  };

  const uploadSelectedProvidersToApiHub = async () => {
    setApiKeyStatus(null);

    if (!enabledProviderCount) {
      setApiKeyStatus("❌ Select at least one provider first.");
      return;
    }
    if (!secretsApi?.set) {
      setApiKeyStatus("❌ Secure storage is not available.");
      return;
    }
    if (!apiHubApi?.save) {
      setApiKeyStatus("❌ API Hub service is not available.");
      return;
    }

    const selectedProviders = providerTemplateEntries.filter(([provider]) => providerDrafts[provider]?.enabled);
    for (const [provider, template] of selectedProviders) {
      const draft = providerDrafts[provider];
      const missing = (template.secrets ?? []).filter((field) => !(draft.secrets[field.key] ?? "").trim());
      if (missing.length) {
        setApiKeyStatus(`❌ ${template.label}: missing ${missing.map((m) => m.label).join(", ")}`);
        return;
      }
    }

    setApiKeyBusy(true);
    const created: Array<{ id: string; name: string; provider: ApiKeyProviderOption; fields: Array<{ key: string; label: string; account: string }>; config?: Record<string, string> }> = [];

    try {
      for (const [provider, template] of selectedProviders) {
        const draft = providerDrafts[provider];
        const id = crypto.randomUUID();
        const fields: Array<{ key: string; label: string; account: string }> = [];

        for (const field of template.secrets ?? []) {
          const value = (draft.secrets[field.key] ?? "").trim();
          const account = `apikey:${provider}:${id}:${field.key}`;
          await secretsApi.set(account, value);
          if (provider === "alpaca" && (field.key === "APCA_API_KEY_ID" || field.key === "APCA_API_SECRET_KEY")) {
            await secretsApi.set(field.key, value);
          }
          fields.push({ key: field.key, label: field.label, account });
        }

        const configEntries = Object.entries(draft.config)
          .map(([k, v]) => [k, v.trim()] as const)
          .filter(([, v]) => v.length > 0);

        const newApiKey = {
          id,
          name: (draft.name || template.label).trim(),
          provider,
          fields,
          config: configEntries.length ? Object.fromEntries(configEntries) : undefined,
        };

        addApiKey(newApiKey);
        await apiHubApi.save(newApiKey as any);
        created.push(newApiKey);

        if (provider === "bls") {
          const blsField = fields.find((f) => f.key === "BLS_API_KEY");
          const next = { enableBls: true, blsApiKeyId: id, blsApiKeyAccount: blsField?.account };
          setExternalFeeds(next);
          await syncExternalFeeds(next);
        }
      }

      if (testOnSave) {
        setApiKeyStatus(`✅ Uploaded ${created.length} provider${created.length === 1 ? "" : "s"}. Testing...`);
        for (const key of created) {
          await testApiKey(key as (typeof apiKeys)[0]);
        }
      } else {
        setApiKeyStatus(`✅ Uploaded ${created.length} provider${created.length === 1 ? "" : "s"} to API Hub.`);
      }

      const reset = createInitialProviderDrafts();
      setProviderDrafts((prev) => {
        const next = { ...prev };
        created.forEach((entry) => {
          next[entry.provider] = reset[entry.provider];
        });
        return next;
      });
    } catch (err) {
      setApiKeyStatus(`❌ Upload failed: ${(err as Error).message}`);
    } finally {
      setApiKeyBusy(false);
    }
  };

  const saveAiConfiguration = async () => {
    const next = {
      enabled: aiEnabled,
      model: (aiModel ?? "").trim() || "deepseek-r1:14b",
      pollIntervalSec: Math.max(60, Math.min(3600, aiPollInterval || 300)),
      rssFeeds: parseList(aiRssFeeds),
      secForms: parseList(aiSecForms),
      watchlistTickers: parseList(aiWatchlistTickers),
      watchlistKeywords: parseList(aiWatchlistKeywords),
      useX: false,
    };
    await aiSaveConfig(next as any);
    await persistAiSelections();
  };

  const runAiResearchNow = async () => {
    await persistAiSelections();
    await aiRunNow();
  };

  const refreshAiBriefings = async () => {
    await persistAiSelections();
    await aiRefreshBriefs(5);
  };

  const S = {
    pageBorder: "2px solid var(--border-strong)",
    text: "var(--text)",
    muted: "var(--muted)",
    hint: "var(--hint)",
    panel: "var(--panel)",
    panelAlt: "var(--panel2)",
    border: "1px solid var(--border)",
    borderStrong: "1px solid var(--border-strong)",
    accent: "var(--accent)",
    accentLight: "var(--accent-light)",
    radius: "var(--surface-radius)",
    controlRadius: "var(--control-radius)",
    mono: "var(--mono)",
    transition: "var(--transition)",
  } as const;

  return (
    <div style={{ opacity: 0.98, paddingBottom: 40, maxWidth: 1600, margin: "0 auto", color: S.text }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 24,
          padding: "16px 0",
          borderBottom: S.pageBorder,
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 28, fontWeight: 800, letterSpacing: 1 }}>⚙️ Settings</h2>
          <div style={{ fontSize: 13, color: S.muted, marginTop: 4 }}>Configure your Trading Terminal</div>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <StatusIndicator label="Stream" value={source} status={source === "live" ? "success" : source === "demo" ? "warning" : "info"} />
          <StatusIndicator label="AI" value={aiRuntime?.available ? "Ready" : "Offline"} status={aiRuntime?.available ? "success" : "error"} />
          <StatusIndicator label="Update" value={updateIndicator.value} status={updateIndicator.status} />
          <button
            type="button"
            onClick={() => {
              void handleCheckForUpdates();
            }}
            disabled={updateChecking}
            style={{
              border: S.border,
              background: "linear-gradient(180deg, rgba(16,185,129,0.9), rgba(5,150,105,0.85))",
              color: "#fff",
              borderRadius: 8,
              padding: "8px 14px",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 0.3,
              cursor: updateChecking ? "wait" : "pointer",
              opacity: updateChecking ? 0.75 : 1,
            }}
          >
            {updateChecking ? "Checking..." : "Check for Updates"}
          </button>
          <button
            type="button"
            onClick={() => {
              handleSaveSettings().catch(() => void 0);
            }}
            disabled={settingsSaving}
            style={{
              border: S.border,
              background: "linear-gradient(180deg, rgba(99,102,241,0.9), rgba(79,70,229,0.85))",
              color: "#fff",
              borderRadius: 8,
              padding: "8px 14px",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 0.3,
              cursor: settingsSaving ? "wait" : "pointer",
              opacity: settingsSaving ? 0.75 : 1,
            }}
          >
            {settingsSaving ? "Saving..." : "Save"}
          </button>
          {settingsSaveStatus ? (
            <span style={{ fontSize: 12, color: settingsSaveStatus === "Saved" ? "#86efac" : "#fca5a5", minWidth: 70 }}>
              {settingsSaveStatus}
            </span>
          ) : null}
        </div>
      </div>

      {/* Section Navigation */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 10, marginBottom: 24 }}>
        <SectionTab
          icon="🤖"
          title="AI"
          active={activeSection === "ai"}
          onClick={() => setActiveSection("ai")}
        />
        <SectionTab
          icon="🛡️"
          title="Steward"
          active={activeSection === "steward"}
          onClick={() => setActiveSection("steward")}
        />
        <SectionTab
          icon="📋"
          title="Research"
          active={activeSection === "research"}
          onClick={() => setActiveSection("research")}
        />
        <SectionTab
          icon="📡"
          title="Data & APIs"
          active={activeSection === "data"}
          onClick={() => setActiveSection("data")}
        />
        <SectionTab
          icon="🎯"
          title="Market"
          active={activeSection === "market"}
          onClick={() => setActiveSection("market")}
        />
        <SectionTab
          icon="🗺️"
          title="GWMD"
          active={activeSection === "gwmd"}
          onClick={() => setActiveSection("gwmd")}
        />
        <SectionTab
          icon="💻"
          title="System"
          active={activeSection === "system"}
          onClick={() => setActiveSection("system")}
        />
      </div>

      {/* AI Configuration Section */}
      {activeSection === "ai" && (
        <div style={{ display: "grid", gap: 20 }}>
          <Card title="⚡ AI Control Center">
            <div style={{ display: "grid", gap: 16 }}>
              <div style={{ fontSize: 14, lineHeight: 1.6, color: "var(--muted)", maxWidth: 900 }}>
                Configure your AI providers below. Active providers are used automatically across AI-powered features,
                and you can fine-tune which provider powers each feature in the routing panel.
              </div>

              <CloudAiConfigurator onConfigUpdated={() => {
                console.log("[SettingsLogs] AI provider configuration updated");
              }} />

              {showAiErrorBanner && (
                <div style={{ padding: 12, borderRadius: 8, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.4)", color: "#fecdd3" }}>
                  ⚠️ {aiError}
                </div>
              )}

              {showAiSelectionStatus && (
                <div style={{ padding: 10, borderRadius: 8, background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.35)", color: "#bfdbfe", fontSize: 12 }}>
                  {aiSelectionStatus}
                </div>
              )}
            </div>
          </Card>

          <Card title="🔌 AI Feature Routing">
            <div style={{ display: "grid", gap: 12 }}>
              {[{ key: "research", title: "AI Research Briefs", detail: "Daily research summaries and signal synthesis." },
              { key: "supplyChain", title: "Supply Chain Intelligence", detail: "Shipping and logistics disruption analysis." },
              { key: "congress", title: "Congressional Intelligence", detail: "Legislative and disclosure impact detection." },
              { key: "cftc", title: "CFTC Analysis", detail: "Commitments of Traders and futures positioning insights." }].map((row) => (
                <div key={row.key} style={{ display: "grid", gridTemplateColumns: "1fr minmax(220px, 280px)", gap: 12, alignItems: "center", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: 12 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{row.title}</div>
                    <div style={{ fontSize: 12, opacity: 0.72, marginTop: 3 }}>{row.detail}</div>
                  </div>
                  <select
                    value={aiFeatureRouting[row.key as "research" | "supplyChain" | "congress" | "cftc"]}
                    onChange={(e) => setAiFeatureRouting(row.key as "research" | "supplyChain" | "congress" | "cftc", e.target.value)}
                    style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(15,23,42,0.95)", color: "inherit" }}
                  >
                    {aiRoutingOptions.map((opt) => (
                      <option key={`${row.key}:${opt.value}`} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              ))}
              <div style={{ fontSize: 12, opacity: 0.72 }}>
                Auto routing uses the first connected provider by priority, starting with local Ollama.
              </div>
            </div>
          </Card>

          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, border: "1px solid rgba(59,130,246,0.25)", background: "rgba(59,130,246,0.08)", borderRadius: 10 }}>
            <input
              type="checkbox"
              checked={aiContextSharingEnabled}
              onChange={(e) => setAiContextSharingEnabled(e.target.checked)}
              style={{ width: 18, height: 18, cursor: "pointer" }}
            />
            <label style={{ cursor: "pointer", flex: 1, fontSize: 13 }}>
              <span style={{ fontWeight: 700 }}>AI Context Sharing</span>
              <span style={{ opacity: 0.8 }}> - Allow AI systems to read prices, positions, trades, journal notes, and supply chain state.</span>
            </label>
          </div>

          <Card title="🤖 OpenClaw Agent">
            <div style={{ display: "grid", gap: 16 }}>
              <div style={{ padding: 12, borderRadius: 10, border: openClawStatusStyle.border, background: openClawStatusStyle.background, color: openClawStatusStyle.color, fontWeight: 700 }}>
                {openClawStatusStyle.label}
              </div>

              <div style={{ fontSize: 13, lineHeight: 1.6, opacity: 0.85 }}>
                OpenClaw Agent is the autonomous steward for regulatory and disclosure data quality, recovery, and operational oversight.
                Connection is considered complete once backend steward availability, authentication, and health telemetry are all online.
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                <div style={{ border: "1px solid rgba(148,163,184,0.28)", borderRadius: 10, padding: 10, fontSize: 12 }}>
                  {openClawReadiness.backendAvailable ? "✓" : "✗"} Backend steward service
                </div>
                <div style={{ border: "1px solid rgba(148,163,184,0.28)", borderRadius: 10, padding: 10, fontSize: 12 }}>
                  {openClawReadiness.authenticated ? "✓" : "✗"} Authenticated user session
                </div>
                <div style={{ border: "1px solid rgba(148,163,184,0.28)", borderRadius: 10, padding: 10, fontSize: 12 }}>
                  {openClawReadiness.hasHealthSignal ? "✓" : "✗"} Health telemetry available
                </div>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
                <div style={{ fontSize: 13, opacity: 0.8 }}>
                  Last check: <b>{stewardHealth?.generatedAt ? fmtDate(Date.parse(stewardHealth.generatedAt)) : stewardOverview?.lastCheckAt ? fmtDate(stewardOverview.lastCheckAt) : "—"}</b>
                </div>
                <div style={{ fontSize: 13, opacity: 0.9 }}>
                  Health score: <b>{typeof stewardHealth?.overall?.score === "number" ? `${stewardHealth.overall.score}/100` : "—"}</b>
                </div>
                <div style={{ fontSize: 13, opacity: 0.9 }}>
                  Open incidents: <b>{stewardHealth?.incidents?.totalOpen ?? 0}</b>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {STEWARD_MODULE_ORDER.map((module) => {
                    const statusStyle = getModuleStatusStyle(module);
                    return (
                      <div
                        key={module}
                        style={{
                          padding: "4px 12px",
                          borderRadius: 999,
                          border: `1px solid ${statusStyle.border}`,
                          background: statusStyle.bg,
                          color: statusStyle.color,
                          fontSize: 12,
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                        }}
                      >
                        {STEWARD_MODULE_META[module].short} {statusStyle.label}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                <button
                  onClick={() => {
                    void handleConnectOpenClaw();
                  }}
                  disabled={stewardCheckBusy || stewardLoading}
                  style={{
                    border: "1px solid rgba(59,130,246,0.45)",
                    background: stewardCheckBusy || stewardLoading ? "rgba(59,130,246,0.14)" : "rgba(59,130,246,0.22)",
                    color: "#bfdbfe",
                    borderRadius: 8,
                    padding: "8px 12px",
                    fontWeight: 700,
                    cursor: stewardCheckBusy || stewardLoading ? "wait" : "pointer",
                  }}
                >
                  {stewardCheckBusy || stewardLoading ? "Connecting..." : "Connect OpenClaw"}
                </button>
                <button
                  onClick={() => setActiveSection("steward")}
                  style={{
                    border: "1px solid rgba(148,163,184,0.45)",
                    background: "rgba(148,163,184,0.14)",
                    color: "#e2e8f0",
                    borderRadius: 8,
                    padding: "8px 12px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Open Steward Controls
                </button>
              </div>

              {stewardError && (
                <div style={{ padding: 12, borderRadius: 8, background: "rgba(248,113,113,0.15)", border: "1px solid rgba(248,113,113,0.4)", color: "#fecdd3" }}>
                  ⚠️ {stewardError}
                </div>
              )}

              {stewardLoading && (
                <div style={{ fontSize: 12, opacity: 0.75 }}>Refreshing OpenClaw status...</div>
              )}
            </div>
          </Card>

          <div style={{ fontSize: 12, opacity: 0.75, padding: "0 2px" }}>
            Research inputs, poll intervals, RSS feeds, SEC forms, and keywords now live in the <b>Research</b> tab.
          </div>
        </div>
      )}

      {activeSection === "steward" && (
        <div style={{ display: "grid", gap: 20 }}>
          <Card title="🛡️ Terminal Steward Overview">
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                <div style={{ border: "1px solid rgba(148,163,184,0.28)", borderRadius: 10, padding: 12 }}>
                  <div style={{ fontSize: 12, opacity: 0.72 }}>Health Score</div>
                  <div style={{ fontSize: 24, fontWeight: 700 }}>
                    {typeof stewardHealth?.overall?.score === "number" ? `${stewardHealth.overall.score}/100` : "—"}
                  </div>
                </div>
                <div style={{ border: "1px solid rgba(148,163,184,0.28)", borderRadius: 10, padding: 12 }}>
                  <div style={{ fontSize: 12, opacity: 0.72 }}>Overall State</div>
                  <div style={{ fontSize: 18, fontWeight: 700, textTransform: "uppercase" }}>
                    {stewardHealth?.overall?.state ?? "unknown"}
                  </div>
                </div>
                <div style={{ border: "1px solid rgba(148,163,184,0.28)", borderRadius: 10, padding: 12 }}>
                  <div style={{ fontSize: 12, opacity: 0.72 }}>Open Incidents</div>
                  <div style={{ fontSize: 24, fontWeight: 700 }}>
                    {stewardIncidentDigest?.summary?.totalOpenIncidents ?? stewardHealth?.incidents?.totalOpen ?? 0}
                  </div>
                </div>
                <div style={{ border: "1px solid rgba(148,163,184,0.28)", borderRadius: 10, padding: 12 }}>
                  <div style={{ fontSize: 12, opacity: 0.72 }}>Pending Tasks</div>
                  <div style={{ fontSize: 24, fontWeight: 700 }}>{stewardHealth?.incidents?.pendingTasks ?? 0}</div>
                </div>
                <div style={{ border: "1px solid rgba(148,163,184,0.28)", borderRadius: 10, padding: 12 }}>
                  <div style={{ fontSize: 12, opacity: 0.72 }}>Critical Open</div>
                  <div style={{ fontSize: 24, fontWeight: 700 }}>
                    {stewardIncidentDigest?.summary?.criticalOpenIncidents ?? 0}
                  </div>
                </div>
                <div style={{ border: "1px solid rgba(148,163,184,0.28)", borderRadius: 10, padding: 12 }}>
                  <div style={{ fontSize: 12, opacity: 0.72 }}>Last 24h</div>
                  <div style={{ fontSize: 24, fontWeight: 700 }}>
                    {stewardIncidentDigest?.summary?.incidentsLast24h ?? 0}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div style={{ fontSize: 12, opacity: 0.75 }}>
                  Last generated: <b>{stewardIncidentDigest?.generatedAt ? new Date(stewardIncidentDigest.generatedAt).toLocaleString() : stewardHealth?.generatedAt ? new Date(stewardHealth.generatedAt).toLocaleString() : "—"}</b>
                </div>
                <button
                  onClick={() => {
                    void handleRunStewardHealthCheck();
                  }}
                  disabled={stewardCheckBusy}
                  style={{
                    border: "1px solid rgba(34,197,94,0.5)",
                    background: stewardCheckBusy ? "rgba(34,197,94,0.15)" : "rgba(34,197,94,0.2)",
                    color: "#bbf7d0",
                    borderRadius: 8,
                    padding: "8px 12px",
                    fontWeight: 700,
                    cursor: stewardCheckBusy ? "wait" : "pointer",
                  }}
                >
                  {stewardCheckBusy ? "Running check..." : "Run deterministic health check"}
                </button>
              </div>

              <div style={{ border: "1px solid rgba(148,163,184,0.28)", borderRadius: 10, padding: 12, display: "grid", gap: 8 }}>
                <div style={{ fontSize: 12, opacity: 0.72 }}>Recommendations</div>
                {stewardIncidentDigest?.recommendations?.length ? (
                  <div style={{ display: "grid", gap: 6 }}>
                    {stewardIncidentDigest.recommendations.slice(0, 4).map((item, index) => (
                      <div key={`${item}-${index}`} style={{ fontSize: 12, opacity: 0.84 }}>
                        • {item}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, opacity: 0.68 }}>
                    No recommendations generated yet.
                  </div>
                )}
              </div>
            </div>
          </Card>

          <Card title="🧩 Modules">
            <div style={{ display: "grid", gap: 10 }}>
              {stewardHealthModules.length === 0 && (
                <div style={{ fontSize: 12, opacity: 0.75 }}>No module health data yet.</div>
              )}
              {stewardHealthModules.map((module) => (
                <div
                  key={module.module}
                  style={{
                    border: "1px solid rgba(148,163,184,0.28)",
                    borderRadius: 10,
                    padding: 12,
                    display: "grid",
                    gridTemplateColumns: "1.1fr 0.9fr 2fr",
                    gap: 10,
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, textTransform: "uppercase" }}>{module.module}</div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>Owner: {module.owner}</div>
                  </div>
                  <div style={{ fontSize: 12, textTransform: "uppercase", fontWeight: 700 }}>
                    {module.state} / {module.severity}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.78 }}>
                    {module.probableCause ?? "No probable cause attached"}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <Card title="🚨 Incidents">
              <div style={{ display: "grid", gap: 10 }}>
                {recentStewardFindings.length === 0 && (
                  <div style={{ fontSize: 12, opacity: 0.75 }}>No active findings.</div>
                )}
                {recentStewardFindings.map((finding) => (
                  <div key={finding.id} style={{ border: "1px solid rgba(148,163,184,0.28)", borderRadius: 10, padding: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ fontWeight: 700 }}>{finding.title}</div>
                      <div style={{ fontSize: 11, textTransform: "uppercase", opacity: 0.8 }}>{finding.severity}</div>
                    </div>
                    <div style={{ marginTop: 4, fontSize: 12, opacity: 0.78 }}>{finding.detail}</div>
                    <div style={{ marginTop: 6, fontSize: 11, opacity: 0.68 }}>
                      {finding.module.toUpperCase()} • {new Date(finding.detectedAt).toLocaleString()}
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <button
                        onClick={() => {
                          void stewardDismissFinding(finding.id);
                        }}
                        style={{
                          border: "1px solid rgba(148,163,184,0.5)",
                          background: "rgba(148,163,184,0.12)",
                          color: "#e2e8f0",
                          borderRadius: 6,
                          padding: "4px 8px",
                          fontSize: 11,
                          cursor: "pointer",
                        }}
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="🛠️ Tasks">
              <div style={{ display: "grid", gap: 10 }}>
                {recentStewardTasks.length === 0 && (
                  <div style={{ fontSize: 12, opacity: 0.75 }}>No active tasks.</div>
                )}
                {recentStewardTasks.map((task) => (
                  <div key={task.id} style={{ border: "1px solid rgba(148,163,184,0.28)", borderRadius: 10, padding: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ fontWeight: 700 }}>{task.title}</div>
                      <div style={{ fontSize: 11, textTransform: "uppercase", opacity: 0.8 }}>{task.status}</div>
                    </div>
                    <div style={{ marginTop: 4, fontSize: 12, opacity: 0.78 }}>{task.summary}</div>
                    <div style={{ marginTop: 6, fontSize: 11, opacity: 0.68 }}>
                      {task.module.toUpperCase()} • {new Date(task.updatedAt).toLocaleString()}
                    </div>
                    {task.status === "pending" && (
                      <div style={{ marginTop: 8 }}>
                        <button
                          onClick={() => {
                            void stewardApplyTask(task.id);
                          }}
                          style={{
                            border: "1px solid rgba(59,130,246,0.45)",
                            background: "rgba(59,130,246,0.2)",
                            color: "#bfdbfe",
                            borderRadius: 6,
                            padding: "4px 8px",
                            fontSize: 11,
                            cursor: "pointer",
                          }}
                        >
                          Apply task
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <Card title="⚙️ Runtime and Policy">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              <div style={{ border: "1px solid rgba(148,163,184,0.28)", borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 12, opacity: 0.72 }}>Queue Depth</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{stewardHealth?.runtime?.queueDepth ?? 0}</div>
              </div>
              <div style={{ border: "1px solid rgba(148,163,184,0.28)", borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 12, opacity: 0.72 }}>Queue Running</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{stewardHealth?.runtime?.queueRunning ?? 0}</div>
              </div>
              <div style={{ border: "1px solid rgba(148,163,184,0.28)", borderRadius: 10, padding: 12 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={stewardAutoFixDraft}
                    onChange={(e) => setStewardAutoFixDraft(e.target.checked)}
                  />
                  <span style={{ fontSize: 13, fontWeight: 700 }}>Auto-apply Category 1 safe actions</span>
                </label>
                <div style={{ marginTop: 6, fontSize: 11, opacity: 0.68 }}>
                  Retries, bounded re-checks, and stale-state corrections only.
                </div>
              </div>
              <div style={{ border: "1px solid rgba(148,163,184,0.28)", borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 12, opacity: 0.72 }}>Check Interval</div>
                <input
                  type="number"
                  min={5}
                  max={1440}
                  value={stewardIntervalDraft}
                  onChange={(e) => setStewardIntervalDraft(Math.max(5, Number(e.target.value) || 5))}
                  style={{ marginTop: 6, width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(148,163,184,0.4)", background: "rgba(15,23,42,0.9)", color: "inherit" }}
                />
              </div>
              <div style={{ border: "1px solid rgba(148,163,184,0.28)", borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 12, opacity: 0.72 }}>CFTC Mode</div>
                <select
                  value={stewardCftcModeDraft}
                  onChange={(e) => setStewardCftcModeDraft(e.target.value as "off" | "suggest" | "auto")}
                  style={{ marginTop: 6, width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(148,163,184,0.4)", background: "rgba(15,23,42,0.9)", color: "inherit" }}
                >
                  <option value="off">Off</option>
                  <option value="suggest">Suggest</option>
                  <option value="auto">Auto</option>
                </select>
              </div>
              <div style={{ border: "1px solid rgba(148,163,184,0.28)", borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 12, opacity: 0.72 }}>Congress Mode</div>
                <select
                  value={stewardCongressModeDraft}
                  onChange={(e) => setStewardCongressModeDraft(e.target.value as "off" | "suggest" | "auto")}
                  style={{ marginTop: 6, width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(148,163,184,0.4)", background: "rgba(15,23,42,0.9)", color: "inherit" }}
                >
                  <option value="off">Off</option>
                  <option value="suggest">Suggest</option>
                  <option value="auto">Auto</option>
                </select>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 11, opacity: 0.68 }}>
                Category 2/3 actions remain approval-gated and are not auto-applied.
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {stewardPolicyStatus && (
                  <span style={{ fontSize: 12, color: stewardPolicyStatus.includes("failed") ? "#fecaca" : "#bbf7d0" }}>
                    {stewardPolicyStatus}
                  </span>
                )}
                <button
                  onClick={() => {
                    void handleSaveStewardPolicy();
                  }}
                  disabled={stewardPolicySaving}
                  style={{
                    border: "1px solid rgba(59,130,246,0.45)",
                    background: stewardPolicySaving ? "rgba(59,130,246,0.15)" : "rgba(59,130,246,0.2)",
                    color: "#bfdbfe",
                    borderRadius: 8,
                    padding: "8px 12px",
                    fontWeight: 700,
                    cursor: stewardPolicySaving ? "wait" : "pointer",
                  }}
                >
                  {stewardPolicySaving ? "Saving..." : "Save policy"}
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Research Section */}
      {activeSection === "research" && (
        <div style={{ display: "grid", gap: 20 }}>
          <Card title="📋 Research Feeds & Signals">
            <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 12, alignItems: "center" }}>
              <label style={{ fontSize: 13, opacity: 0.8, textTransform: "uppercase", letterSpacing: 0.8, fontFamily: "var(--mono)" }}>
                Poll Interval (Sec)
              </label>
              <input
                type="number"
                min={60}
                max={3600}
                value={aiPollInterval}
                onChange={(e) => setAiPollInterval(Number(e.target.value))}
                style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)" }}
              />

              <label style={{ fontSize: 13, opacity: 0.8, textTransform: "uppercase", letterSpacing: 0.8, fontFamily: "var(--mono)" }}>
                RSS Feeds
              </label>
              <textarea
                rows={5}
                value={aiRssFeeds}
                onChange={(e) => setAiRssFeeds(e.target.value)}
                placeholder="One URL per line"
                style={{ padding: "8px 12px", fontSize: 13, borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)" }}
              />

              <label style={{ fontSize: 13, opacity: 0.8, textTransform: "uppercase", letterSpacing: 0.8, fontFamily: "var(--mono)" }}>
                SEC Forms
              </label>
              <input
                value={aiSecForms}
                onChange={(e) => setAiSecForms(e.target.value)}
                placeholder="8-K,10-Q,10-K"
                style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)" }}
              />

              <label style={{ fontSize: 13, opacity: 0.8, textTransform: "uppercase", letterSpacing: 0.8, fontFamily: "var(--mono)" }}>
                Watchlist Tickers
              </label>
              <input
                value={aiWatchlistTickers}
                onChange={(e) => setAiWatchlistTickers(e.target.value)}
                placeholder="AAPL,MSFT,TSLA"
                style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)" }}
              />

              <label style={{ fontSize: 13, opacity: 0.8, textTransform: "uppercase", letterSpacing: 0.8, fontFamily: "var(--mono)" }}>
                Keywords
              </label>
              <input
                value={aiWatchlistKeywords}
                onChange={(e) => setAiWatchlistKeywords(e.target.value)}
                placeholder="earnings,FDA,acquisition"
                style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)" }}
              />
            </div>

            <div style={{ display: "flex", gap: 8, paddingTop: 12, marginTop: 12, borderTop: "1px solid rgba(255,255,255,0.1)", flexWrap: "wrap" }}>
              <button onClick={saveAiConfiguration} disabled={aiLoading} style={{ padding: "8px 16px", fontWeight: 600 }}>
                💾 Save Settings
              </button>
              <button onClick={runAiResearchNow} disabled={aiLoading || !aiEnabled} style={{ padding: "8px 16px" }}>
                ▶️ Run Now
              </button>
              <button onClick={refreshAiBriefings} disabled={aiLoading} style={{ padding: "8px 16px" }}>
                🔄 Refresh Briefs
              </button>
            </div>
          </Card>

          <Card title="📊 Research Status">
            <div style={{ display: "grid", gap: 12 }}>
              {(aiStatus || aiProgress) && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, padding: 12, background: "rgba(255,255,255,0.03)", borderRadius: 8, fontSize: 13 }}>
                  <div>Status: <b>{aiStatus?.running ? "🟢 Running" : "⚪ Idle"}</b></div>
                  <div>Queue: <b>{aiStatus?.queueDepth ?? 0}</b></div>
                  {aiProgress && <div>Stage: <b>{aiProgress.stage}</b></div>}
                  {aiProgress?.counts && <div>Briefs: <b>{aiProgress.counts.briefs}</b></div>}
                </div>
              )}

              {showAiErrorBanner && (
                <div style={{ padding: 12, borderRadius: 8, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.4)", color: "#fecdd3" }}>
                  ⚠️ {aiError}
                </div>
              )}

              {showAiSelectionStatus && (
                <div style={{ padding: 10, borderRadius: 8, background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.35)", color: "#bfdbfe", fontSize: 12 }}>
                  {aiSelectionStatus}
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Data Sources & APIs Section */}
      {activeSection === "data" && (
        <div style={{ display: "grid", gap: 20 }}>
          <Card title="📡 Stream Source">
            <div style={{ display: "grid", gap: 16 }}>
              {!canSetSource && (
                <div style={{
                  padding: "12px 16px",
                  background: "rgba(251,191,36,0.15)",
                  border: "1px solid rgba(251,191,36,0.4)",
                  borderRadius: 8,
                  fontSize: 13,
                  color: "#fde68a"
                }}>
                  ⚠️ Stream source controls unavailable. The streaming API is not loaded. Try restarting the application.
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                <SourceButton
                  title="Live Data"
                  description="Real-time market data"
                  icon="🔴"
                  active={source === "live"}
                  onClick={() => api?.setSource?.("live")}
                  disabled={!canSetSource}
                />
                <SourceButton
                  title="Replay Mode"
                  description="Historical playback"
                  icon="⏮️"
                  active={source === "replay"}
                  onClick={() => api?.setSource?.("replay")}
                  disabled={!canSetSource}
                />
                <SourceButton
                  title="Demo Mode"
                  description="Simulated data"
                  icon="🎮"
                  active={source === "demo"}
                  onClick={() => api?.setSource?.("demo")}
                  disabled={!canSetSource}
                />
              </div>

              {source === "replay" && replay && (
                <div style={{ padding: 16, background: "rgba(255,255,255,0.03)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.1)" }}>
                  <div style={{ fontWeight: 700, marginBottom: 12 }}>Replay Controls</div>
                  <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                    <button disabled={!canReplay} onClick={() => r!.play()}>▶️ Play</button>
                    <button disabled={!canReplay} onClick={() => r!.pause()}>⏸️ Pause</button>
                    <span style={{ width: 12 }} />
                    <button disabled={!canReplay} onClick={() => r!.setSpeed(0.5)}>0.5x</button>
                    <button disabled={!canReplay} onClick={() => r!.setSpeed(1)}>1x</button>
                    <button disabled={!canReplay} onClick={() => r!.setSpeed(2)}>2x</button>
                    <button disabled={!canReplay} onClick={() => r!.setSpeed(5)}>5x</button>
                  </div>
                  <div style={{ fontSize: 13, opacity: 0.8 }}>
                    Status: <b>{replay.playing ? "▶️ Playing" : "⏸️ Paused"}</b> @ <b>{replay.speed}x</b> | Cursor: <b>{fmt(replay.cursorTs)}</b>
                  </div>
                </div>
              )}
            </div>
          </Card>

          <Card title="🌐 External Feeds (Phase-1)">
            <div style={{ display: "grid", gap: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input
                    type="checkbox"
                    checked={externalFeeds.enableCftc}
                    onChange={async (e) => {
                      const next = { enableCftc: e.target.checked };
                      setExternalFeeds(next);
                      await syncExternalFeeds(next);
                    }}
                    style={{ width: 18, height: 18 }}
                  />
                  <span style={{ fontWeight: 600 }}>Enable CFTC CoT</span>
                </label>

                <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input
                    type="checkbox"
                    checked={externalFeeds.enableSec}
                    onChange={async (e) => {
                      const next = { enableSec: e.target.checked };
                      setExternalFeeds(next);
                      await syncExternalFeeds(next);
                    }}
                    style={{ width: 18, height: 18 }}
                  />
                  <span style={{ fontWeight: 600 }}>Enable SEC EDGAR</span>
                </label>

                <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input
                    type="checkbox"
                    checked={externalFeeds.enableBls}
                    onChange={async (e) => {
                      const next = { enableBls: e.target.checked };
                      setExternalFeeds(next);
                      await syncExternalFeeds(next);
                    }}
                    style={{ width: 18, height: 18 }}
                  />
                  <span style={{ fontWeight: 600 }}>Enable BLS JOLTS</span>
                </label>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>CFTC Mapping CSV Path</div>
                  <input
                    placeholder="C:\\path\\cot_mapping.csv"
                    value={externalFeeds.cftcMappingPath ?? ""}
                    onChange={async (e) => {
                      const next = { cftcMappingPath: e.target.value };
                      setExternalFeeds(next);
                      await syncExternalFeeds(next);
                    }}
                    style={{ padding: "8px 12px", borderRadius: 6 }}
                  />
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>CFTC Sample Zip Path</div>
                  <input
                    placeholder="C:\\path\\fut_disagg_txt_2026_full.zip"
                    value={externalFeeds.cftcSampleZipPath ?? ""}
                    onChange={async (e) => {
                      const next = { cftcSampleZipPath: e.target.value };
                      setExternalFeeds(next);
                      await syncExternalFeeds(next);
                    }}
                    style={{ padding: "8px 12px", borderRadius: 6 }}
                  />
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>SEC CIK Mapping Path</div>
                  <input
                    placeholder="C:\\path\\cik_mapping.csv"
                    value={externalFeeds.secCikMappingPath ?? ""}
                    onChange={async (e) => {
                      const next = { secCikMappingPath: e.target.value };
                      setExternalFeeds(next);
                      await syncExternalFeeds(next);
                    }}
                    style={{ padding: "8px 12px", borderRadius: 6 }}
                  />
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>BLS API Key</div>
                  <select
                    value={externalFeeds.blsApiKeyId ?? ""}
                    onChange={async (e) => {
                      const nextId = e.target.value || undefined;
                      const selected = blsKeys.find((k) => k.id === nextId);
                      const field = selected?.fields.find((f) => f.key === "BLS_API_KEY");
                      const next = { blsApiKeyId: nextId, blsApiKeyAccount: field?.account };
                      setExternalFeeds(next);
                      await syncExternalFeeds(next);
                    }}
                    style={{ padding: "8px 12px", borderRadius: 6 }}
                  >
                    <option value="">Select BLS key</option>
                    {blsKeys.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.name}
                      </option>
                    ))}
                  </select>
                  {blsKeys.length === 0 && (
                    <div style={{ fontSize: 11, opacity: 0.6 }}>Add a BLS key below to enable JOLTS.</div>
                  )}
                </div>
              </div>

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <button onClick={() => testExternalFeed("CFTC_COT")} style={{ padding: "6px 12px" }}>
                  🧪 Test CFTC
                </button>
                <button onClick={() => testExternalFeed("SEC_EDGAR")} style={{ padding: "6px 12px" }}>
                  🧪 Test SEC
                </button>
                <button onClick={() => testExternalFeed("BLS_JOLTS")} style={{ padding: "6px 12px" }}>
                  🧪 Test BLS
                </button>
                {externalFeedTests.CFTC_COT && (
                  <span style={{ fontSize: 12, opacity: 0.7 }}>
                    CFTC: {externalFeedTests.CFTC_COT.message}
                  </span>
                )}
                {externalFeedTests.SEC_EDGAR && (
                  <span style={{ fontSize: 12, opacity: 0.7 }}>
                    SEC: {externalFeedTests.SEC_EDGAR.message}
                  </span>
                )}
                {externalFeedTests.BLS_JOLTS && (
                  <span style={{ fontSize: 12, opacity: 0.7 }}>
                    BLS: {externalFeedTests.BLS_JOLTS.message}
                  </span>
                )}
              </div>
            </div>
          </Card>

          <Card title="🔐 API Key Management">
            <div style={{ display: "grid", gap: 16 }}>
              {/* Description */}
              <div style={{
                fontSize: 13,
                opacity: 0.85,
                lineHeight: 1.6,
                padding: 12,
                background: 'rgba(255,255,255,0.03)',
                borderRadius: 8,
                borderLeft: '3px solid rgba(59,130,246,0.5)'
              }}>
                Configure market data and AI provider credentials in one place. Secrets are encrypted and synced into API Hub after upload.
                <strong> Test your connections</strong> to verify each provider is ready.
              </div>

              <div style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 12,
                padding: "8px 4px"
              }}>
                <div style={{ fontSize: 12, opacity: 0.75 }}>
                  Need full control? Launch the standalone API Hub to edit every credential in one secure view.
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    onClick={async () => {
                      await apiHubApi?.openWindow?.();
                    }}
                    style={{
                      padding: "8px 14px",
                      borderRadius: 999,
                      border: "1px solid rgba(59,130,246,0.5)",
                      background: "linear-gradient(90deg, rgba(59,130,246,0.25), rgba(147,51,234,0.25))",
                      fontWeight: 600,
                      letterSpacing: 0.5
                    }}
                  >
                    🚀 Open API Hub
                  </button>
                  <button
                    onClick={async () => {
                      const api = window.cockpit?.smartRouting;
                      if (api?.openWindow) {
                        await api.openWindow();
                      } else {
                        console.warn("[SettingsLogs] smartRouting bridge missing");
                        setApiKeyStatus("❌ Smart Routing service unavailable");
                        setTimeout(() => setApiKeyStatus(null), 2500);
                      }
                    }}
                    style={{
                      padding: "8px 14px",
                      borderRadius: 999,
                      border: "1px solid rgba(16,185,129,0.5)",
                      background: "linear-gradient(90deg, rgba(16,185,129,0.25), rgba(20,184,166,0.25))",
                      fontWeight: 600,
                      letterSpacing: 0.5
                    }}
                  >
                    🧠 Smart Routing Overview
                  </button>
                </div>
              </div>

              {/* Connection Health Summary */}
              {apiKeys.length > 0 && (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                  gap: 12,
                  padding: 16,
                  background: 'rgba(255,255,255,0.02)',
                  borderRadius: 12,
                  border: '1px solid rgba(255,255,255,0.08)'
                }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 24, fontWeight: 700 }}>{apiKeys.length}</div>
                    <div style={{ fontSize: 11, opacity: 0.7, textTransform: 'uppercase', letterSpacing: 0.5 }}>Total Keys</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#86efac' }}>
                      {Array.from(keyTestResults.values()).filter(r => r.status === 'success').length}
                    </div>
                    <div style={{ fontSize: 11, opacity: 0.7, textTransform: 'uppercase', letterSpacing: 0.5 }}>Connected</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#fca5a5' }}>
                      {Array.from(keyTestResults.values()).filter(r => r.status === 'error').length}
                    </div>
                    <div style={{ fontSize: 11, opacity: 0.7, textTransform: 'uppercase', letterSpacing: 0.5 }}>Failed</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#94a3b8' }}>
                      {apiKeys.length - keyTestResults.size}
                    </div>
                    <div style={{ fontSize: 11, opacity: 0.7, textTransform: 'uppercase', letterSpacing: 0.5 }}>Untested</div>
                  </div>
                </div>
              )}

              <div style={{ padding: 16, background: "rgba(59,130,246,0.08)", borderRadius: 12, border: "1px solid rgba(59,130,246,0.2)", display: "grid", gap: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>One-Place Provider Setup</div>
                    <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                      Choose providers, enter credentials once, then upload all selected keys to API Hub in a single action.
                    </div>
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>Selected: <b>{enabledProviderCount}</b></div>
                </div>

                <div style={{ display: "grid", gap: 10 }}>
                  {providerTemplateEntries.map(([provider, template]) => {
                    const draft = providerDrafts[provider];
                    const requiredSecretCount = (template.secrets ?? []).length;
                    return (
                      <div
                        key={provider}
                        style={{
                          border: `1px solid ${draft.enabled ? "rgba(59,130,246,0.5)" : "rgba(255,255,255,0.12)"}`,
                          background: draft.enabled ? "rgba(59,130,246,0.1)" : "rgba(255,255,255,0.02)",
                          borderRadius: 10,
                          padding: 12,
                          display: "grid",
                          gap: 10,
                        }}
                      >
                        <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, cursor: "pointer" }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
                            <input
                              type="checkbox"
                              checked={draft.enabled}
                              onChange={(e) => setProviderEnabled(provider, e.target.checked)}
                              style={{ width: 16, height: 16 }}
                            />
                            {template.label}
                          </span>
                          <span style={{ fontSize: 11, opacity: 0.65 }}>{requiredSecretCount} secret field{requiredSecretCount === 1 ? "" : "s"}</span>
                        </label>

                        {draft.enabled && (
                          <>
                            <input
                              value={draft.name}
                              onChange={(e) => setProviderName(provider, e.target.value)}
                              placeholder={`${template.label} (display name)`}
                              style={{ padding: "8px 12px", borderRadius: 6 }}
                            />

                            {(template.secrets ?? []).length > 0 && (
                              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
                                {template.secrets.map((field) => (
                                  <input
                                    key={`${provider}:${field.key}`}
                                    type="password"
                                    placeholder={field.label}
                                    value={draft.secrets[field.key] ?? ""}
                                    onChange={(e) => setProviderSecret(provider, field.key, e.target.value)}
                                    style={{ padding: "8px 12px", borderRadius: 6 }}
                                  />
                                ))}
                              </div>
                            )}

                            {(template.config ?? []).length > 0 && (
                              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
                                {template.config!.map((field) => (
                                  <input
                                    key={`${provider}:${field.key}`}
                                    placeholder={field.placeholder ?? field.label}
                                    value={draft.config[field.key] ?? ""}
                                    onChange={(e) => setProviderConfig(provider, field.key, e.target.value)}
                                    style={{ padding: "8px 12px", borderRadius: 6 }}
                                  />
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <button
                    disabled={apiKeyBusy}
                    onClick={uploadSelectedProvidersToApiHub}
                    style={{
                      padding: "8px 16px",
                      fontWeight: 600,
                      background: "rgba(34,197,94,0.2)",
                      border: "1px solid rgba(34,197,94,0.4)",
                      borderRadius: 8,
                      cursor: apiKeyBusy ? "wait" : "pointer",
                    }}
                  >
                    {apiKeyBusy ? "⏳ Uploading..." : "☁️ Upload Selected To API Hub"}
                  </button>

                  <label style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 13,
                    cursor: "pointer",
                    padding: "6px 12px",
                    background: "rgba(255,255,255,0.05)",
                    borderRadius: 6,
                    border: "1px solid rgba(255,255,255,0.1)",
                  }}>
                    <input
                      type="checkbox"
                      checked={testOnSave}
                      onChange={(e) => setTestOnSave(e.target.checked)}
                      style={{ width: 16, height: 16 }}
                    />
                    <span>Test connections after upload</span>
                  </label>

                  {apiKeyStatus && (
                    <span style={{
                      fontSize: 13,
                      opacity: 0.9,
                      padding: "6px 12px",
                      background: apiKeyStatus.includes("✅") ? "rgba(34,197,94,0.15)" : "rgba(248,113,113,0.15)",
                      borderRadius: 6,
                      border: `1px solid ${apiKeyStatus.includes("✅") ? "rgba(34,197,94,0.3)" : "rgba(248,113,113,0.3)"}`,
                    }}>
                      {apiKeyStatus}
                    </span>
                  )}
                </div>
              </div>

              {apiKeys.length > 0 && (
                <div>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 12
                  }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>
                      Stored API Keys <span style={{ opacity: 0.6, fontSize: 12 }}>({apiKeys.length})</span>
                    </div>
                    <button
                      onClick={testAllApiKeys}
                      disabled={testingKeys.size > 0}
                      style={{
                        padding: '6px 12px',
                        fontSize: 12,
                        fontWeight: 600,
                        background: 'rgba(139,92,246,0.2)',
                        border: '1px solid rgba(139,92,246,0.4)',
                        borderRadius: 6,
                        cursor: testingKeys.size > 0 ? 'wait' : 'pointer'
                      }}
                    >
                      {testingKeys.size > 0 ? '⏳ Testing...' : '🔄 Test All Connections'}
                    </button>
                  </div>
                  <div style={{ display: "grid", gap: 12 }}>
                    {apiKeys.map((k) => {
                      const testResult = keyTestResults.get(k.id);
                      const isTesting = testingKeys.has(k.id);
                      const statusColor = testResult?.status === 'success' ? '#86efac' :
                        testResult?.status === 'error' ? '#fca5a5' : '#94a3b8';
                      const statusIcon = testResult?.status === 'success' ? '✓' :
                        testResult?.status === 'error' ? '✗' : '○';

                      return (
                        <div
                          key={k.id}
                          style={{
                            padding: 16,
                            background: "rgba(255,255,255,0.03)",
                            borderRadius: 12,
                            border: `1px solid ${testResult ? statusColor.replace('ac', '33').replace('a5', '33').replace('b8', '33') : 'rgba(255,255,255,0.1)'}`,
                            transition: 'all 0.2s ease',
                          }}
                        >
                          {/* Header Row */}
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                <div style={{ fontWeight: 700, fontSize: 15 }}>{k.name}</div>
                                {testResult && (
                                  <div
                                    style={{
                                      fontSize: 11,
                                      padding: '2px 8px',
                                      borderRadius: 6,
                                      background: statusColor.replace('ac', '22').replace('a5', '22').replace('b8', '22'),
                                      color: statusColor,
                                      border: `1px solid ${statusColor}`,
                                      fontWeight: 600,
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 4
                                    }}
                                  >
                                    <span>{statusIcon}</span>
                                    <span>{testResult.status === 'success' ? 'CONNECTED' : testResult.status === 'error' ? 'FAILED' : 'UNKNOWN'}</span>
                                  </div>
                                )}
                              </div>
                              <div style={{ fontSize: 12, opacity: 0.7 }}>
                                {API_KEY_TEMPLATES[k.provider as keyof typeof API_KEY_TEMPLATES]?.label || k.provider} • Added {fmtDate(k.createdAt)}
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                              <button
                                onClick={() => testApiKey(k)}
                                disabled={isTesting}
                                style={{
                                  padding: "6px 12px",
                                  fontSize: 12,
                                  fontWeight: 600,
                                  background: isTesting ? 'rgba(59,130,246,0.15)' : 'rgba(59,130,246,0.25)',
                                  border: '1px solid rgba(59,130,246,0.4)',
                                  borderRadius: 6,
                                  cursor: isTesting ? 'wait' : 'pointer',
                                  transition: 'all 0.2s ease'
                                }}
                              >
                                {isTesting ? '⏳ Testing...' : '🔍 Test Connection'}
                              </button>
                              <button
                                onClick={async () => {
                                  removeApiKey(k.id);
                                  try {
                                    await apiHubApi?.remove?.(k.id);
                                  } catch (err) {
                                    console.warn("[SettingsLogs] failed to remove key from ApiHub", err);
                                  }
                                }}
                                style={{
                                  padding: "6px 12px",
                                  fontSize: 12,
                                  background: 'rgba(248,113,113,0.15)',
                                  border: '1px solid rgba(248,113,113,0.3)',
                                  borderRadius: 6
                                }}
                              >
                                🗑️ Remove
                              </button>
                            </div>
                          </div>

                          {/* Details Grid */}
                          <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'auto 1fr',
                            gap: '8px 12px',
                            fontSize: 12,
                            opacity: 0.75,
                            padding: 12,
                            background: 'rgba(255,255,255,0.02)',
                            borderRadius: 8,
                            marginBottom: testResult ? 12 : 0
                          }}>
                            <div style={{ fontWeight: 600 }}>Provider:</div>
                            <div>{k.provider}</div>

                            <div style={{ fontWeight: 600 }}>Credentials:</div>
                            <div>{k.fields.map((f) => f.label).join(", ")}</div>

                            {k.config && Object.keys(k.config).length > 0 && (
                              <>
                                <div style={{ fontWeight: 600 }}>Configuration:</div>
                                <div>{Object.entries(k.config).map(([key, val]) => `${key}=${val}`).join(" • ")}</div>
                              </>
                            )}
                          </div>

                          {/* Test Results */}
                          {testResult && (
                            <div style={{
                              padding: 12,
                              background: testResult.status === 'success' ? 'rgba(34,197,94,0.08)' : 'rgba(248,113,113,0.08)',
                              borderRadius: 8,
                              border: `1px solid ${statusColor.replace('ac', '33').replace('a5', '33')}`,
                            }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                <div style={{ fontSize: 13, fontWeight: 600 }}>
                                  {testResult.status === 'success' ? '✓ Connection Successful' : '✗ Connection Failed'}
                                </div>
                                <div style={{ fontSize: 11, opacity: 0.6 }}>
                                  Tested {new Date(testResult.timestamp).toLocaleTimeString()}
                                </div>
                              </div>

                              <div style={{ fontSize: 12, marginBottom: testResult.details ? 8 : 0 }}>
                                {testResult.message}
                              </div>

                              {testResult.details && (
                                <div style={{
                                  fontSize: 11,
                                  opacity: 0.7,
                                  padding: 8,
                                  background: 'rgba(0,0,0,0.2)',
                                  borderRadius: 4,
                                  fontFamily: 'monospace'
                                }}>
                                  {testResult.details.accountId && <div>Account: {testResult.details.accountId}</div>}
                                  {testResult.details.tier && <div>Tier: {testResult.details.tier}</div>}
                                  {testResult.details.expiresAt && <div>Expires: {testResult.details.expiresAt}</div>}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </Card>

          <Card title="🏥 Data Feed Health">
            {healthStatus.length === 0 ? (
              <div style={{ opacity: 0.7, fontSize: 13, textAlign: "center", padding: 24 }}>No adapters connected yet</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
                {healthStatus.map((h) => (
                  <div key={h.adapter} style={{ padding: 16, border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, background: "rgba(255,255,255,0.02)" }}>
                    <div style={{ fontWeight: 700, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                      <span>{h.connected ? "🟢" : "🔴"}</span>
                      <span>{h.adapter}</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 13, opacity: 0.85 }}>
                      <div>Latency: <b>{h.latencyDisplay}</b></div>
                      <div>Events: <b>{h.eventsCount}</b></div>
                      <div>Errors: <b>{h.errorCount}</b></div>
                      <div>Last: <b>{h.lastEventDisplay}</b></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Market Settings Section */}
      {activeSection === "market" && (
        <div style={{ display: "grid", gap: 20 }}>
          <Card title="🎯 Market Focus">
            <div style={{ fontSize: 14, opacity: 0.85, marginBottom: 16, lineHeight: 1.6 }}>
              Choose your trading focus. Each preset configures the platform with optimized analytics and symbol lists for that market type.
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
              <MarketFocusCard
                title="📊 US Large Cap"
                level="Sophisticated"
                symbols="AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA..."
                description="Sophisticated equity trading platform with advanced technical analysis and fundamental data"
                active={marketFocus === "us-large-cap"}
                onClick={() => setMarketFocus("us-large-cap")}
              />

              <MarketFocusCard
                title="⚡ Index Futures"
                level="Simple & Focused"
                symbols="ES (S&P 500), NQ (Nasdaq 100)"
                description="Fast-paced index futures trading with streamlined charts and essential metrics"
                active={marketFocus === "index-futures"}
                onClick={() => setMarketFocus("index-futures")}
              />
            </div>

            <div style={{ marginTop: 16, padding: 16, background: "rgba(59,130,246,0.08)", borderRadius: 12, border: "1px solid rgba(59,130,246,0.2)", fontSize: 13 }}>
              <b>Current Selection:</b> {getMarketFocusConfig().description}
            </div>
          </Card>

          <Card title="🎨 Interface & Colorway">
            <div style={{ fontSize: 14, opacity: 0.85, marginBottom: 16, lineHeight: 1.6 }}>
              Tailor the cockpit personality for different operators. Terminal strips everything down, Friendly adds iconography, and Sleek sits in between. Colorways override the accent palette across the renderer and map surfaces.
            </div>
            <ThemeControls />
          </Card>
        </div>
      )}

      {activeSection === "gwmd" && (
        <div style={{ display: "grid", gap: 20 }}>
          <Card title="🗺️ GWMD Search Defaults">
            <div style={{ display: "grid", gap: 14 }}>
              <div style={{ fontSize: 13, opacity: 0.8, lineHeight: 1.6 }}>
                These defaults are used by GWMD map searches and filtering. Choose whether searches should use local cache, fresh AI generation, or a hybrid refresh path.
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, opacity: 0.75 }}>Default Hops</span>
                  <select
                    value={gwmdSettingsDraft.defaultHops}
                    onChange={(e) => {
                      setGwmdSettingsDraft((prev) => ({
                        ...prev,
                        defaultHops: Math.max(1, Math.min(3, Number(e.target.value))),
                      }));
                    }}
                    style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)" }}
                  >
                    <option value={1}>1 hop</option>
                    <option value={2}>2 hops</option>
                    <option value={3}>3 hops</option>
                  </select>
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, opacity: 0.75 }}>Default Source Mode</span>
                  <select
                    value={gwmdSettingsDraft.sourceMode}
                    onChange={(e) => {
                      const value = e.target.value as GwmdSourceMode;
                      setGwmdSettingsDraft((prev) => ({ ...prev, sourceMode: value }));
                    }}
                    style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)" }}
                  >
                    <option value="hybrid">Hybrid</option>
                    <option value="fresh">Fresh AI</option>
                    <option value="cache_only">Cache only</option>
                  </select>
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, opacity: 0.75 }}>Default Region</span>
                  <select
                    value={gwmdSettingsDraft.defaultRegion}
                    onChange={(e) => {
                      setGwmdSettingsDraft((prev) => ({
                        ...prev,
                        defaultRegion: e.target.value,
                      }));
                    }}
                    style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)" }}
                  >
                    {"All,Americas,Europe,APAC,MEA,Other".split(",").map((region) => (
                      <option key={region} value={region}>{region}</option>
                    ))}
                  </select>
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, opacity: 0.75 }}>Default Relation</span>
                  <select
                    value={gwmdSettingsDraft.defaultRelation}
                    onChange={(e) => {
                      setGwmdSettingsDraft((prev) => ({
                        ...prev,
                        defaultRelation: e.target.value,
                      }));
                    }}
                    style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)" }}
                  >
                    {["all", "supplier", "customer", "partner", "competitor", "financing", "license"].map((relation) => (
                      <option key={relation} value={relation}>{relation}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, opacity: 0.75 }}>
                    Minimum Confidence: {Math.round(gwmdSettingsDraft.minConfidence * 100)}%
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={gwmdSettingsDraft.minConfidence}
                    onChange={(e) => {
                      setGwmdSettingsDraft((prev) => ({
                        ...prev,
                        minConfidence: Number(e.target.value),
                      }));
                    }}
                  />
                </label>

                <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input
                    type="checkbox"
                    checked={gwmdSettingsDraft.showUnresolved}
                    onChange={(e) => {
                      setGwmdSettingsDraft((prev) => ({
                        ...prev,
                        showUnresolved: e.target.checked,
                      }));
                    }}
                  />
                  <span style={{ fontSize: 13 }}>Show unresolved node hints and unlocated warnings</span>
                </label>
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button onClick={saveGwmdSettings} style={{ padding: "8px 14px" }}>
                  💾 Save GWMD Defaults
                </button>
                <button onClick={resetGwmdSettings} style={{ padding: "8px 14px" }}>
                  Reset Defaults
                </button>
                {gwmdSettingsStatus && <span style={{ fontSize: 12, opacity: 0.85 }}>{gwmdSettingsStatus}</span>}
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* System Section */}
      {activeSection === "system" && (
        <div style={{ display: "grid", gap: 20 }}>
          <Card title="⬆️ Desktop Updates">
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ fontSize: 13, opacity: 0.8 }}>
                Check for published desktop releases and install them from the app. Auto-update works only in installed packaged builds.
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button onClick={() => { void handleCheckForUpdates(); }} disabled={updateChecking} style={{ padding: "8px 14px" }}>
                  {updateChecking ? "Checking..." : "🔄 Check for Updates"}
                </button>
                {updateStatus?.state === "downloaded" && (
                  <button onClick={() => { void handleInstallUpdate(); }} style={{ padding: "8px 14px" }}>
                    ♻️ Restart & Install
                  </button>
                )}
                <span style={{ fontSize: 12, opacity: 0.85 }}>
                  State: {updateStatus?.state ?? "idle"}
                  {updateStatus?.version ? ` • v${updateStatus.version}` : ""}
                  {typeof updateStatus?.progress === "number" ? ` • ${Math.round(updateStatus.progress)}%` : ""}
                </span>
              </div>

              <div style={{ fontSize: 12, opacity: 0.9 }}>
                {updateStatus?.message ?? "No update check has been run yet."}
              </div>
            </div>
          </Card>

          <Card title="🌐 Backend Connection">
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ fontSize: 13, opacity: 0.8 }}>
                Desktop connects to this backend URL. The value is stored in local SQLite app settings.
              </div>

              <input
                value={backendUrlDraft}
                onChange={(e) => setBackendUrlDraft(e.target.value)}
                placeholder="http://localhost:8787"
                style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)", fontFamily: "var(--mono)" }}
              />

              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button onClick={saveBackendUrl} disabled={backendUrlSaving} style={{ padding: "8px 14px" }}>
                  {backendUrlSaving ? "Saving..." : "💾 Save URL"}
                </button>
                <button onClick={resetBackendUrl} style={{ padding: "8px 14px" }}>
                  Reset to Default
                </button>
                <button onClick={checkBackendHealth} disabled={backendHealthChecking} style={{ padding: "8px 14px" }}>
                  {backendHealthChecking ? "Checking..." : "🔍 Check Health"}
                </button>
                <span style={{ fontSize: 12, opacity: 0.85 }}>
                  Status: {backendHealth === "ok" ? "🟢 Reachable" : backendHealth === "error" ? "🔴 Unreachable" : "⚪ Not checked"}
                </span>
              </div>

              {backendUrlStatus && (
                <div style={{ fontSize: 12, opacity: 0.9 }}>{backendUrlStatus}</div>
              )}
            </div>
          </Card>

          <Card title="🛰️ TED Intel Live API">
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ fontSize: 13, opacity: 0.8 }}>
                Enter your TED live endpoint and API key here. The API key is stored in API Hub,
                and TED will error instead of falling back to fake data. This feeds the
                TED Intel pipeline used in Intelligence, Panorama, Data Vault,
                Supply Chain, and GWMD overlays.
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  type="checkbox"
                  checked={tedLiveEnabled}
                  onChange={(e) => setTedLiveEnabled(e.target.checked)}
                  style={{ width: 18, height: 18 }}
                />
                <span style={{ fontWeight: 600 }}>Enable live TED ingestion</span>
              </label>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, opacity: 0.72 }}>Base URL</div>
                  <input
                    value={tedBaseUrl}
                    onChange={(e) => setTedBaseUrl(e.target.value)}
                    placeholder="https://your-ted-provider.example/api/tedintel"
                    style={{
                      padding: "10px 12px",
                      borderRadius: 8,
                      border: "1px solid rgba(255,255,255,0.2)",
                      fontFamily: "var(--mono)",
                    }}
                  />
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, opacity: 0.72 }}>API Key</div>
                  <input
                    type="password"
                    value={tedApiKey}
                    onChange={(e) => setTedApiKey(e.target.value)}
                    placeholder="Paste TED API key"
                    style={{
                      padding: "10px 12px",
                      borderRadius: 8,
                      border: "1px solid rgba(255,255,255,0.2)",
                      fontFamily: "var(--mono)",
                    }}
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(140px, 1fr))", gap: 10 }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, opacity: 0.72 }}>Auth Header</div>
                  <input
                    value={tedAuthHeader}
                    onChange={(e) => setTedAuthHeader(e.target.value)}
                    placeholder="x-api-key"
                    style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)", fontFamily: "var(--mono)" }}
                  />
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, opacity: 0.72 }}>Timeout (ms)</div>
                  <input
                    type="number"
                    min={1000}
                    step={500}
                    value={tedTimeoutMs}
                    onChange={(e) => setTedTimeoutMs(Number(e.target.value) || 12000)}
                    style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)", fontFamily: "var(--mono)" }}
                  />
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, opacity: 0.72 }}>Window Query Param</div>
                  <input
                    value={tedWindowQueryParam}
                    onChange={(e) => setTedWindowQueryParam(e.target.value)}
                    placeholder="window"
                    style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)", fontFamily: "var(--mono)" }}
                  />
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button onClick={saveTedConfig} disabled={tedConfigSaving} style={{ padding: "8px 14px" }}>
                  {tedConfigSaving ? "Saving..." : "💾 Save TED Config"}
                </button>
                <button
                  onClick={testTedApi}
                  disabled={tedApiTesting}
                  style={{ padding: "8px 14px" }}
                >
                  {tedApiTesting ? "Testing..." : "🧪 Test TED API"}
                </button>
                <button
                  onClick={async () => {
                    try {
                      await apiHubApi?.openWindow?.();
                    } catch (err) {
                      console.warn("[SettingsLogs] failed to open API Hub", err);
                    }
                  }}
                  style={{ padding: "8px 14px" }}
                >
                  🔐 Open API Hub
                </button>
                <span style={{ fontSize: 12, opacity: 0.75 }}>
                  Missing or broken TED config now produces an error instead of fallback data.
                </span>
              </div>

              {tedApiTestResult && (
                <div
                  style={{
                    fontSize: 12,
                    padding: "8px 12px",
                    borderRadius: 8,
                    background: tedApiTestResult.ok
                      ? "rgba(34,197,94,0.1)"
                      : "rgba(248,113,113,0.1)",
                    border: `1px solid ${tedApiTestResult.ok ? "rgba(34,197,94,0.3)" : "rgba(248,113,113,0.3)"}`,
                    color: tedApiTestResult.ok ? "#86efac" : "#fca5a5",
                  }}
                >
                  {tedApiTestResult.message}
                </div>
              )}

              {tedConfigStatus ? (
                <div style={{ fontSize: 12, opacity: 0.95 }}>{tedConfigStatus}</div>
              ) : null}
            </div>
          </Card>

          <Card title="📋 System Logs">
            <div style={{ marginBottom: 16, display: "flex", gap: 12, alignItems: "center" }}>
              <select value={logFilter} onChange={(e) => setLogFilter(e.target.value as any)} style={{ padding: "6px 12px", borderRadius: 6 }}>
                <option value="all">All ({logs.length})</option>
                <option value="error">Errors ({logs.filter((l) => l.level === "error").length})</option>
                <option value="warn">Warnings ({logs.filter((l) => l.level === "warn").length})</option>
                <option value="info">Info ({logs.filter((l) => l.level === "info").length})</option>
              </select>
              <button onClick={() => clearLogs()} style={{ padding: "6px 12px" }}>
                🗑️ Clear Logs
              </button>
              <span style={{ opacity: 0.7, fontSize: 13 }}>showing {filteredLogs.length} of {logs.length}</span>
            </div>

            <div
              style={{
                maxHeight: 500,
                overflowY: "auto",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 12,
                padding: 12,
                background: "rgba(0,0,0,0.3)",
                fontSize: 12,
                fontFamily: "monospace",
              }}
            >
              {filteredLogs.length === 0 ? (
                <div style={{ opacity: 0.5, textAlign: "center", padding: 40 }}>No logs to display</div>
              ) : (
                <div>
                  {filteredLogs.slice(0, 200).map((l) => (
                    <div key={l.id} style={{ padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.05)", opacity: l.level === "error" ? 1 : 0.85 }}>
                      <span style={{ color: l.level === "error" ? "#ff6b6b" : l.level === "warn" ? "#ffd93d" : "#6bff6b", fontWeight: 700 }}>
                        [{l.level.toUpperCase()}]
                      </span>{" "}
                      <span style={{ opacity: 0.7 }}>{fmtDate(l.timestamp)}</span>{" "}
                      <span style={{ opacity: 0.6 }}>({l.category})</span> {l.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

// UI Components
function CollapsibleSection({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", background: "rgba(0,0,0,0.08)" }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: "100%",
          textAlign: "left",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "9px 12px",
          border: "none",
          borderLeft: "3px solid var(--accent)",
          background: "var(--accent-light)",
          color: "var(--text)",
          cursor: "pointer",
          fontFamily: "var(--mono)",
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 0.8,
          textTransform: "uppercase",
        }}
      >
        <span>{open ? "[-]" : "[+]"}</span>
        <span>{title}</span>
      </button>
      {open && <div style={{ padding: 12 }}>{children}</div>}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--surface-radius)",
        overflow: "hidden",
        background: "linear-gradient(180deg, color-mix(in srgb, var(--panel) 88%, #000), color-mix(in srgb, var(--bg) 76%, #000))",
        boxShadow: "var(--shadow)",
      }}
    >
      <div
        style={{
          padding: "16px 20px",
          background: "color-mix(in srgb, var(--panel2) 72%, transparent)",
          borderBottom: "1px solid var(--border)",
          fontWeight: 700,
          fontSize: 16,
          fontFamily: "var(--mono)",
          textTransform: "uppercase",
          letterSpacing: 0.8,
        }}
      >
        {title}
      </div>
      <div style={{ padding: 20 }}>{children}</div>
    </div>
  );
}

function SectionTab({ icon, title, active, onClick }: { icon: string; title: string; active: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: "12px 10px",
        borderRadius: "var(--control-radius)",
        border: active ? "1px solid var(--accent)" : "1px solid var(--border)",
        background: active ? "var(--accent)" : "color-mix(in srgb, var(--panel) 78%, transparent)",
        color: active ? "var(--bg)" : "var(--text)",
        cursor: "pointer",
        transition: "var(--transition)",
        textAlign: "center",
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = "color-mix(in srgb, var(--panel2) 80%, transparent)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "color-mix(in srgb, var(--panel) 78%, transparent)";
      }}
    >
      <div style={{ fontSize: 22, marginBottom: 6 }}>{icon}</div>
      <div style={{ fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.8 }}>{title}</div>
    </div>
  );
}

function StatusIndicator({ label, value, status }: { label: string; value: string; status: "success" | "warning" | "error" | "info" }) {
  const colors = {
    success: "#86efac",
    warning: "#fbbf24",
    error: "#fca5a5",
    info: "#7dd3fc",
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "var(--panel2)", borderRadius: "var(--chip-radius)", border: "1px solid var(--border)" }}>
      <div style={{ fontSize: 11, opacity: 0.7, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontWeight: 700, fontSize: 13, color: colors[status] }}>{value}</div>
    </div>
  );
}

function SourceButton({ title, description, icon, active, onClick, disabled }: { title: string; description: string; icon: string; active: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "16px 20px",
        borderRadius: "var(--control-radius)",
        border: active ? "1px solid var(--accent)" : "1px solid var(--border)",
        background: active ? "var(--accent-light)" : "color-mix(in srgb, var(--panel) 72%, transparent)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        transition: "var(--transition)",
        textAlign: "left",
      }}
    >
      <div style={{ fontSize: 24, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12, opacity: 0.7 }}>{description}</div>
    </button>
  );
}

function MarketFocusCard({ title, level, symbols, description, active, onClick }: { title: string; level: string; symbols: string; description: string; active: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: "20px",
        borderRadius: "var(--control-radius)",
        border: active ? "1px solid var(--accent)" : "1px solid var(--border)",
        background: active ? "var(--accent-light)" : "color-mix(in srgb, var(--panel) 72%, transparent)",
        cursor: "pointer",
        transition: "var(--transition)",
        position: "relative",
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.06)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.02)";
      }}
    >
      {active && (
        <div style={{ position: "absolute", top: 12, right: 12, fontSize: 20 }}>✓</div>
      )}
      <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 12, lineHeight: 1.5 }}>{description}</div>
      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>
        <b>Level:</b> {level}
      </div>
      <div style={{ fontSize: 11, opacity: 0.65 }}>
        <b>Symbols:</b> {symbols}
      </div>
    </div>
  );
}

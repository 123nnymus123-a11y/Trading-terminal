import { app, BrowserWindow, ipcMain, protocol, screen, shell } from "electron";
import { config as loadEnv } from "dotenv";
import { getDb } from "./persistence/db";
import {
  WatchlistsRepo,
  LayoutsRepo,
  AppSettingsRepo,
  AuditRepo,
  TradesJournalRepo,
} from "./persistence/repos";
import { CongressRepo } from "./persistence/congressRepo";
import { getCongressDataService } from "./services/congress/congressDataService";
import { scanCongressAiIntel } from "./services/congress/aiCongressIntel";
import { setSecret, getSecret, deleteSecret } from "./secrets";
import path from "node:path";
import fs from "node:fs";
import { EventBus } from "./streaming/eventBus";
import { attachIpcStreaming } from "./streaming/ipcStreaming";
import { StreamManager } from "./streaming/streamManager";
import { PaperTradingAdapter } from "./adapters/paperTradingAdapter";
import type { PlaceOrderRequest } from "./adapters/brokerAdapter";
import { getJournalManager } from "./journal/journalManager";
import type { Fill } from "./adapters/paperTradingAdapter";
import { RiskGuardian } from "./risk/riskGuardian";
import {
  getRecentDisclosureEvents,
  getTopSectorThemes,
  getWatchlistCandidates,
  getValuationTags,
  refreshPublicFlowIntel,
} from "./services/publicFlow/service";
import { AiResearchManager } from "./services/aiResearch/aiResearchManager";
import {
  getCentralAIOrchestrator,
  type UserInteraction,
} from "./services/centralAIOrchestrator";
import { ExternalFeedsService } from "./services/externalFeeds";
import { AiStewardService } from "./services/aiSteward/aiStewardService";
import type { AiStewardConfig, AiStewardModule } from "../shared/aiSteward";
import { BackendApiClient } from "../shared/backendApiClient";
import type { CalendarInsightRequest } from "@tc/shared";
import { buildTedIntelSnapshot } from "@tc/shared";
import {
  generateEconomicCalendarInsights,
  type EnginePreference,
} from "./services/economicCalendar/insightsService";
import { ApiHubService } from "./services/apiHub";
import type { ApiHubSnapshot, ApiCredentialRecord } from "../shared/apiHub";
import { createGraphEnrichmentService } from "./services/graphEnrichment";
import { createGraphMemoryService } from "./services/graphMemory";
import { LocalStrategyResearchService } from "./services/strategyResearch/localStrategyResearchService";
import {
  StrategyResearchRepo,
  type LocalStrategyComparisonNoteRecord,
  type LocalStrategyDefinitionRecord,
  type LocalStrategyRunRecord,
  type LocalStrategyVersionRecord,
} from "./persistence/strategyResearchRepo";

const PRODUCTION_BACKEND_URL = "http://79.76.40.72:8787";
const DEV_BACKEND_FALLBACK_URL = "http://localhost:8787";

// Global error handlers
process.on("uncaughtException", (err) => {
  console.error("[main] Uncaught Exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("[main] Unhandled Rejection:", reason);
  process.exit(1);
});

const isDev =
  !app.isPackaged &&
  (!!process.env.VITE_DEV_SERVER_URL || process.env.NODE_ENV === "development");

if (isDev) {
  // Load .env first, then .env.local so local overrides take precedence.
  loadEnv({ path: path.resolve(process.cwd(), ".env") });
  loadEnv({ path: path.resolve(process.cwd(), ".env.local"), override: true });
}

let mainWindow: BrowserWindow | null = null;
let aiManager: AiResearchManager | null = null;
let centralAI = getCentralAIOrchestrator();
let riskGuardian: RiskGuardian | null = null;
let aiStewardService: AiStewardService | null = null;
let apiHubWindow: BrowserWindow | null = null;
let smartRoutingWindow: BrowserWindow | null = null;
let supplyChainGlobalWindow: BrowserWindow | null = null;
const gwmdDisplayWallWindows = new Map<number, BrowserWindow>();
let gwmdDisplaySourceWindow: BrowserWindow | null = null;
let gwmdDisplayListenersAttached = false;
let gwmdDisplaySelectedMonitorIds: number[] = [];
let gwmdDisplayPrimaryMonitorId: number | null = null;
let gwmdDisplayMode: GwmdDisplayMode = "wall";
let gwmdDisplaySessionId: string | null = null;
let gwmdWallClosing = false;
const detachedTabWindows = new Map<string, BrowserWindow>();
const apiHubService = new ApiHubService();
const graphEnrichmentService = createGraphEnrichmentService();
const graphMemoryService = createGraphMemoryService();
let localStrategyResearchService: LocalStrategyResearchService | null = null;
const TED_API_HUB_RECORD_ID = "ted-live";
const TED_API_KEY_ACCOUNT = "api-hub:ted-live:api-key";

function getLocalStrategyResearchService(): LocalStrategyResearchService {
  if (!localStrategyResearchService) {
    localStrategyResearchService = new LocalStrategyResearchService(
      path.join(app.getPath("userData"), "strategy-research-cache"),
    );
  }
  return localStrategyResearchService;
}

type TedDesktopConfig = {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  authHeader: string;
  timeoutMs: number;
  windowQueryParam: string;
};

function getTedApiHubRecord(): ApiCredentialRecord | null {
  const snapshot = apiHubService.list();
  return (
    snapshot.records.find((record) => record.id === TED_API_HUB_RECORD_ID) ??
    snapshot.records.find((record) => record.provider === "ted") ??
    null
  );
}

function parseTedApiHubConfig(
  record: ApiCredentialRecord | null,
): Partial<TedDesktopConfig> {
  const config = record?.config ?? {};
  const timeoutCandidate = Number(config.TIMEOUT_MS ?? config.timeoutMs);
  return {
    ...(typeof config.BASE_URL === "string"
      ? { baseUrl: config.BASE_URL }
      : {}),
    ...(typeof config.AUTH_HEADER === "string"
      ? { authHeader: config.AUTH_HEADER }
      : {}),
    ...(Number.isFinite(timeoutCandidate)
      ? { timeoutMs: timeoutCandidate }
      : {}),
    ...(typeof config.WINDOW_QUERY_PARAM === "string"
      ? { windowQueryParam: config.WINDOW_QUERY_PARAM }
      : {}),
    ...(typeof config.ENABLED === "string"
      ? { enabled: config.ENABLED.trim().toLowerCase() === "true" }
      : {}),
  };
}

function buildTedApiHubRecord(
  config: Omit<TedDesktopConfig, "apiKey">,
  existing?: ApiCredentialRecord | null,
): ApiCredentialRecord {
  return {
    id: TED_API_HUB_RECORD_ID,
    name: "TED Live Feed",
    provider: "ted",
    createdAt: existing?.createdAt ?? Date.now(),
    fields: [
      {
        key: "TED_API_KEY",
        label: "API Key",
        account: TED_API_KEY_ACCOUNT,
      },
    ],
    config: {
      BASE_URL: config.baseUrl,
      AUTH_HEADER: config.authHeader,
      TIMEOUT_MS: String(config.timeoutMs),
      WINDOW_QUERY_PARAM: config.windowQueryParam,
      ENABLED: config.enabled ? "true" : "false",
    },
  };
}

async function readTedApiKeyFromStorage(): Promise<string> {
  const existing = await getSecret(TED_API_KEY_ACCOUNT).catch(() => null);
  if (existing) {
    return existing;
  }

  const settings = AppSettingsRepo.get();
  const local = (settings.tedLiveConfig ?? {}) as Record<string, unknown>;
  return typeof local.apiKey === "string" ? local.apiKey : "";
}

async function writeTedApiKeyToStorage(apiKey: string): Promise<void> {
  if (apiKey.trim()) {
    await setSecret(TED_API_KEY_ACCOUNT, apiKey.trim());
    return;
  }
  await deleteSecret(TED_API_KEY_ACCOUNT).catch(() => undefined);
}

type CongressAiWatchlistFallbackItem = {
  id: number;
  ticker: string;
  reason: string;
  priority: number;
  createdAt: string;
};
let congressAiWatchlistFallback: CongressAiWatchlistFallbackItem[] = [];
let congressAiWatchlistFallbackSeq = 1;

// Backend API client for AI services
let backendApiClient: BackendApiClient | null = null;

function normalizeBackendUrl(value: string): string | null {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return trimmed;
  } catch {
    return null;
  }
}

function getPersistedBackendUrl(): string | null {
  try {
    const settings = AppSettingsRepo.get();
    const stored = settings.backendUrl;
    if (typeof stored !== "string") {
      return null;
    }
    return normalizeBackendUrl(stored);
  } catch {
    return null;
  }
}

function ensurePersistedBackendUrl(): string {
  const existing = getPersistedBackendUrl();
  if (existing) {
    return existing;
  }

  const settings = AppSettingsRepo.get();
  AppSettingsRepo.set({ ...settings, backendUrl: PRODUCTION_BACKEND_URL });
  return PRODUCTION_BACKEND_URL;
}

// Get backend URL from environment or use default
const getBackendUrl = (): string => {
  if (isDev) {
    const envCandidate =
      process.env.BACKEND_URL ||
      process.env.VITE_BACKEND_URL ||
      process.env.VITE_TC_BACKEND_URL;
    const normalizedEnv = envCandidate
      ? normalizeBackendUrl(envCandidate)
      : null;
    if (normalizedEnv) {
      return normalizedEnv;
    }
  }

  const persisted = getPersistedBackendUrl();
  if (persisted) {
    return persisted;
  }

  return isDev ? DEV_BACKEND_FALLBACK_URL : PRODUCTION_BACKEND_URL;
};

function rebuildBackendApiClient(): void {
  backendApiClient = new BackendApiClient({
    baseUrl: getBackendUrl(),
    getAuthToken: async () => ensureMainAuthToken(),
  });
  console.log("[main] Backend API Client initialized for:", getBackendUrl());
}

const parseEnvBool = (
  value: string | undefined,
  defaultValue: boolean,
): boolean => {
  if (typeof value !== "string") return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes")
    return true;
  if (normalized === "0" || normalized === "false" || normalized === "no")
    return false;
  return defaultValue;
};

const migrationFlags = {
  backendOnlyProcessing: parseEnvBool(
    process.env.MIGRATION_BACKEND_ONLY_PROCESSING,
    false,
  ),
  desktopLocalFallback: parseEnvBool(
    process.env.MIGRATION_DESKTOP_LOCAL_FALLBACK,
    true,
  ),
};

const canUseLocalFallback = (): boolean => {
  if (migrationFlags.backendOnlyProcessing) {
    return false;
  }
  return migrationFlags.desktopLocalFallback;
};

const CONGRESS_CACHE_TTL_MS = 5 * 60 * 1000;
type CongressCacheEntry = { expiresAt: number; value: unknown };
const congressBackendCache = new Map<string, CongressCacheEntry>();

function getCongressCacheKey(channel: string, payload?: unknown): string {
  return `${channel}:${JSON.stringify(payload ?? null)}`;
}

function readCongressCache<T>(channel: string, payload?: unknown): T | null {
  const key = getCongressCacheKey(channel, payload);
  const hit = congressBackendCache.get(key);
  if (!hit) {
    return null;
  }
  if (Date.now() >= hit.expiresAt) {
    congressBackendCache.delete(key);
    return null;
  }
  return hit.value as T;
}

function writeCongressCache(
  channel: string,
  payload: unknown,
  value: unknown,
): void {
  congressBackendCache.set(getCongressCacheKey(channel, payload), {
    expiresAt: Date.now() + CONGRESS_CACHE_TTL_MS,
    value,
  });
}

function clearCongressBackendCache(): void {
  congressBackendCache.clear();
}

type MainAuthUser = {
  id: string;
  email: string;
  username?: string;
  tier: "starter" | "pro" | "enterprise";
  roles?: string[];
  licenseKey: string;
};

type MainAuthSession = {
  token: string;
  refreshToken: string;
  expiresAtMs: number;
  user: MainAuthUser;
};

let mainAuthSession: MainAuthSession | null = null;
const AUTH_SESSION_SECRET_ACCOUNT = "backend-auth-session-v1";

function broadcastBackendAuthTokenChanged(token: string | null): void {
  for (const windowRef of BrowserWindow.getAllWindows()) {
    if (windowRef.isDestroyed()) {
      continue;
    }
    windowRef.webContents.send("backendAuth:tokenChanged", token);
  }
}

function broadcastBackendUrlChanged(url: string): void {
  for (const windowRef of BrowserWindow.getAllWindows()) {
    if (windowRef.isDestroyed()) {
      continue;
    }
    windowRef.webContents.send("cockpit:backendUrl:changed", url);
  }
}

function getAuthFallbackPassphrase(): string {
  return (
    process.env.AUTH_SESSION_FALLBACK_PASSPHRASE ||
    process.env.JWT_SECRET ||
    "tc-auth-fallback"
  );
}

function isValidMainAuthSession(session: unknown): session is MainAuthSession {
  if (!session || typeof session !== "object") {
    return false;
  }
  const candidate = session as Partial<MainAuthSession>;
  return Boolean(
    typeof candidate.token === "string" &&
    typeof candidate.refreshToken === "string" &&
    typeof candidate.expiresAtMs === "number" &&
    candidate.user &&
    typeof candidate.user.id === "string" &&
    typeof candidate.user.email === "string",
  );
}

async function persistMainAuthSession(
  session: MainAuthSession | null,
): Promise<void> {
  if (!session) {
    await deleteSecret(AUTH_SESSION_SECRET_ACCOUNT);
    return;
  }

  await setSecret(
    AUTH_SESSION_SECRET_ACCOUNT,
    JSON.stringify(session),
    getAuthFallbackPassphrase(),
  );
}

async function loadMainAuthSession(): Promise<void> {
  try {
    const raw = await getSecret(
      AUTH_SESSION_SECRET_ACCOUNT,
      getAuthFallbackPassphrase(),
    );
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!isValidMainAuthSession(parsed)) {
      await deleteSecret(AUTH_SESSION_SECRET_ACCOUNT);
      mainAuthSession = null;
      broadcastBackendAuthTokenChanged(null);
      return;
    }
    if (parsed.expiresAtMs <= Date.now()) {
      await deleteSecret(AUTH_SESSION_SECRET_ACCOUNT);
      mainAuthSession = null;
      broadcastBackendAuthTokenChanged(null);
      return;
    }
    mainAuthSession = parsed;
    broadcastBackendAuthTokenChanged(parsed.token);
  } catch (error) {
    console.warn("[main] failed to load persisted auth session", error);
    mainAuthSession = null;
    broadcastBackendAuthTokenChanged(null);
  }
}

function decodeJwtExpMs(token: string): number | null {
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) {
    return null;
  }

  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(
      Buffer.from(base64, "base64").toString("utf8"),
    ) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function normalizeMainAuthSession(data: {
  token: string;
  refreshToken: string;
  expiresInSeconds: number;
  user: MainAuthUser;
}): MainAuthSession {
  const expFromJwt = decodeJwtExpMs(data.token);
  const fallbackExp = Date.now() + data.expiresInSeconds * 1000;
  return {
    token: data.token,
    refreshToken: data.refreshToken,
    expiresAtMs: expFromJwt ?? fallbackExp,
    user: data.user,
  };
}

async function requestBackendAuth(
  pathName: string,
  payload: Record<string, unknown>,
) {
  const response = await fetch(`${getBackendUrl()}${pathName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `auth_error:${response.status}:${text || response.statusText}`,
    );
  }

  return (await response.json()) as {
    token: string;
    refreshToken: string;
    expiresInSeconds: number;
    user: MainAuthUser;
  };
}

async function loginMainSession(payload: {
  username?: string;
  email?: string;
  password: string;
  licenseKey: string;
}): Promise<MainAuthSession> {
  const response = await requestBackendAuth("/api/auth/login", payload);
  const session = normalizeMainAuthSession(response);
  mainAuthSession = session;
  await persistMainAuthSession(session);
  return session;
}

async function signupMainSession(payload: {
  username: string;
  email: string;
  password: string;
  licenseKey: string;
}): Promise<MainAuthSession> {
  const response = await requestBackendAuth("/api/auth/signup", payload);
  const session = normalizeMainAuthSession(response);
  mainAuthSession = session;
  await persistMainAuthSession(session);
  return session;
}

async function refreshMainSession(
  refreshToken: string,
): Promise<MainAuthSession> {
  const response = await requestBackendAuth("/api/auth/refresh", {
    refreshToken,
  });
  const session = normalizeMainAuthSession(response);
  mainAuthSession = session;
  await persistMainAuthSession(session);
  return session;
}

async function ensureMainAuthToken(): Promise<string | null> {
  if (!mainAuthSession) {
    return null;
  }

  if (mainAuthSession.expiresAtMs - Date.now() > 30_000) {
    return mainAuthSession.token;
  }

  if (!mainAuthSession.refreshToken) {
    mainAuthSession = null;
    return null;
  }

  try {
    const refreshed = await refreshMainSession(mainAuthSession.refreshToken);
    broadcastBackendAuthTokenChanged(refreshed.token);
    return refreshed.token;
  } catch {
    mainAuthSession = null;
    broadcastBackendAuthTokenChanged(null);
    return null;
  }
}

function createWindow() {
  const preloadPath = path.join(__dirname, "../preload/index.cjs");

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: "#0b1020",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    console.log(
      `[main] loading devServer URL: ${process.env.VITE_DEV_SERVER_URL}`,
    );
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    const indexHtml = path.join(__dirname, "../renderer/index.html");
    console.log(`[main] loading file: ${indexHtml}`);
    win.loadFile(indexHtml);
  }

  // Listen for load failures
  win.webContents.on(
    "did-fail-load",
    (event, errorCode, errorDescription, validatedURL) => {
      console.error(
        "[main] [event] did-fail-load:",
        errorCode,
        errorDescription,
        validatedURL,
      );
    },
  );

  // Log various loading events
  win.webContents.on("did-start-loading", () => {
    console.log("[main] [event] did-start-loading");
  });

  win.webContents.on("dom-ready", () => {
    console.log("[main] [event] dom-ready");
  });

  win.webContents.on("did-finish-load", () => {
    console.log(
      "[main] [event] did-finish-load (generic, should be caught by once handler)",
    );
  });

  win.webContents.on("preload-error", (event, preloadPath, error) => {
    console.error("[main] [event] preload-error:", preloadPath);
    console.error("[main] [event] preload error details:", error);
  });

  win.webContents.on("ipc-message", (event, channel, ...args) => {
    if (!channel.startsWith("ELECTRON")) {
      console.log("[main] [event] ipc-message:", channel);
    }
  });

  // Log when the window is closed
  win.on("closed", () => {
    console.log("[main] [event] window closed");
  });

  // Log when window is about to be closed
  win.on("close", (e) => {
    console.log("[main] [event] window close event - preventing default");
    // Don't close the window automatically
  });

  // Log any crashes (via render-process-gone instead, since 'crashed' isn't a real event)
  // win.webContents.on("crashed", () => {
  //   console.error("[main] [event] RENDERER CRASHED!");
  // });

  // Log render process gone
  win.webContents.on("render-process-gone", (event, details) => {
    console.error(
      "[main] [event] RENDERER PROCESS GONE:",
      JSON.stringify(details),
    );
  });

  // Log any unresponsive renderer
  win.on("unresponsive", () => {
    console.warn("[main] [event] renderer unresponsive");
  });

  // Log when renderer becomes responsive again
  win.on("responsive", () => {
    console.log("[main] [event] renderer responsive");
  });

  return win;
}

function openApiHubWindow() {
  if (apiHubWindow && !apiHubWindow.isDestroyed()) {
    apiHubWindow.focus();
    return apiHubWindow;
  }

  const preloadPath = path.join(__dirname, "../preload/index.cjs");
  apiHubWindow = new BrowserWindow({
    width: 960,
    height: 720,
    backgroundColor: "#050816",
    title: "API Hub",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    apiHubWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}?view=api-hub`);
  } else {
    const indexHtml = path.join(__dirname, "../renderer/index.html");
    apiHubWindow.loadFile(indexHtml, { query: { view: "api-hub" } });
  }

  apiHubWindow.on("closed", () => {
    apiHubWindow = null;
  });

  return apiHubWindow;
}

function openSupplyChainGlobalWindow(tickers: string[]) {
  if (supplyChainGlobalWindow && !supplyChainGlobalWindow.isDestroyed()) {
    supplyChainGlobalWindow.focus();
    return supplyChainGlobalWindow;
  }

  const preloadPath = path.join(__dirname, "../preload/index.cjs");
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    backgroundColor: "#0b1020",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const tickersParam = encodeURIComponent(tickers.join("|"));
  const viewParam = `view=global-map&tickers=${tickersParam}`;

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(`${process.env.VITE_DEV_SERVER_URL}?${viewParam}`);
  } else {
    const indexHtml = path.join(__dirname, "../renderer/index.html");
    win.loadFile(indexHtml, {
      query: { view: "global-map", tickers: tickers.join("|") },
    });
  }

  win.on("closed", () => {
    supplyChainGlobalWindow = null;
  });

  supplyChainGlobalWindow = win;
  return win;
}

const GWMD_WALL_SETTINGS_KEY = "gwmdWallMode";

type GwmdDisplayMode = "standard" | "wall" | "analyst" | "mirror";

type GwmdDisplayMonitorSummary = {
  id: number;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  workArea: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  rotation: number;
  internal: boolean;
  touchSupport: "unknown" | "available" | "unavailable";
  size: { width: number; height: number };
};

type GwmdDisplaySelection = {
  monitorIds: number[];
  primaryMonitorId: number | null;
  mode: GwmdDisplayMode;
};

type NativeDisplay = ReturnType<typeof screen.getAllDisplays>[number];

function getGwmdDisplaysSorted() {
  return screen
    .getAllDisplays()
    .slice()
    .sort((a, b) => {
      if (a.bounds.x !== b.bounds.x) return a.bounds.x - b.bounds.x;
      if (a.bounds.y !== b.bounds.y) return a.bounds.y - b.bounds.y;
      return a.id - b.id;
    });
}

function toGwmdMonitorSummary(
  display: NativeDisplay,
  fallbackLabelIndex: number,
): GwmdDisplayMonitorSummary {
  const rawLabel =
    typeof (display as { label?: unknown }).label === "string"
      ? String((display as { label?: string }).label)
      : "";
  const label =
    rawLabel.trim().length > 0
      ? rawLabel.trim()
      : `Display ${fallbackLabelIndex + 1}`;

  return {
    id: display.id,
    label,
    bounds: {
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
    },
    workArea: {
      x: display.workArea.x,
      y: display.workArea.y,
      width: display.workArea.width,
      height: display.workArea.height,
    },
    scaleFactor: display.scaleFactor,
    rotation: display.rotation,
    internal: Boolean(display.internal),
    touchSupport: display.touchSupport,
    size: {
      width: display.size.width,
      height: display.size.height,
    },
  };
}

function listGwmdMonitors(): GwmdDisplayMonitorSummary[] {
  return getGwmdDisplaysSorted().map((display, index) =>
    toGwmdMonitorSummary(display, index),
  );
}

function computeCombinedBounds(displays: NativeDisplay[]) {
  if (displays.length === 0) {
    return {
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      arrangement: "single" as const,
    };
  }

  let minX = displays[0].bounds.x;
  let minY = displays[0].bounds.y;
  let maxX = displays[0].bounds.x + displays[0].bounds.width;
  let maxY = displays[0].bounds.y + displays[0].bounds.height;

  for (const display of displays) {
    minX = Math.min(minX, display.bounds.x);
    minY = Math.min(minY, display.bounds.y);
    maxX = Math.max(maxX, display.bounds.x + display.bounds.width);
    maxY = Math.max(maxY, display.bounds.y + display.bounds.height);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    arrangement: displays.length > 1 ? ("multi" as const) : ("single" as const),
  };
}

function isGwmdWallEnabled() {
  for (const win of gwmdDisplayWallWindows.values()) {
    if (!win.isDestroyed()) {
      return true;
    }
  }
  return false;
}

function readGwmdDisplaySelectionPrefs(): GwmdDisplaySelection {
  try {
    const settings = AppSettingsRepo.get();
    const raw = settings[GWMD_WALL_SETTINGS_KEY] as
      | { monitorIds?: unknown; primaryMonitorId?: unknown; mode?: unknown }
      | undefined;
    const monitorIds = Array.isArray(raw?.monitorIds)
      ? raw?.monitorIds
          .map((id) => Number(id))
          .filter((id) => Number.isInteger(id))
      : [];
    const primaryMonitorId =
      typeof raw?.primaryMonitorId === "number" &&
      Number.isInteger(raw.primaryMonitorId)
        ? raw.primaryMonitorId
        : null;
    const mode: GwmdDisplayMode =
      raw?.mode === "analyst" || raw?.mode === "mirror" || raw?.mode === "wall"
        ? raw.mode
        : "wall";

    return {
      monitorIds: Array.from(new Set(monitorIds)),
      primaryMonitorId,
      mode,
    };
  } catch {
    return {
      monitorIds: [],
      primaryMonitorId: null,
      mode: "wall",
    };
  }
}

function persistGwmdDisplaySelection(selection: GwmdDisplaySelection): void {
  try {
    const current = AppSettingsRepo.get();
    AppSettingsRepo.set({
      ...current,
      [GWMD_WALL_SETTINGS_KEY]: {
        monitorIds: selection.monitorIds,
        primaryMonitorId: selection.primaryMonitorId,
        mode: selection.mode,
      },
    });
  } catch (error) {
    console.warn("[main] failed to persist GWMD wall selection", error);
  }
}

function sanitizeGwmdDisplaySelection(selection?: {
  monitorIds?: number[];
  primaryMonitorId?: number | null;
  mode?: GwmdDisplayMode;
}): GwmdDisplaySelection {
  const displays = getGwmdDisplaysSorted();
  const availableIds = new Set(displays.map((display) => display.id));

  const requestedMonitorIds = Array.isArray(selection?.monitorIds)
    ? selection?.monitorIds
    : gwmdDisplaySelectedMonitorIds.length > 0
      ? gwmdDisplaySelectedMonitorIds
      : readGwmdDisplaySelectionPrefs().monitorIds;

  const requested = Array.from(
    new Set(
      requestedMonitorIds
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && availableIds.has(id)),
    ),
  );

  const fallbackPrimary =
    screen.getPrimaryDisplay()?.id ?? displays[0]?.id ?? null;

  const monitorIds =
    requested.length > 0
      ? requested
      : fallbackPrimary !== null
        ? [fallbackPrimary]
        : displays.length > 0
          ? [displays[0].id]
          : [];

  const requestedPrimary =
    selection?.primaryMonitorId ??
    gwmdDisplayPrimaryMonitorId ??
    readGwmdDisplaySelectionPrefs().primaryMonitorId ??
    fallbackPrimary;

  const primaryMonitorId =
    typeof requestedPrimary === "number" &&
    monitorIds.includes(requestedPrimary)
      ? requestedPrimary
      : (monitorIds[0] ?? null);

  const requestedMode =
    selection?.mode ?? gwmdDisplayMode ?? readGwmdDisplaySelectionPrefs().mode;
  const mode: GwmdDisplayMode =
    requestedMode === "analyst" ||
    requestedMode === "mirror" ||
    requestedMode === "standard"
      ? requestedMode
      : "wall";

  return {
    monitorIds,
    primaryMonitorId,
    mode,
  };
}

function getGwmdSelectedDisplays(activeOnly: boolean): NativeDisplay[] {
  const displays = getGwmdDisplaysSorted();
  if (!activeOnly || !isGwmdWallEnabled()) {
    return displays;
  }

  const selected = new Set(gwmdDisplaySelectedMonitorIds);
  const filtered = displays.filter((display) => selected.has(display.id));
  return filtered.length > 0 ? filtered : displays;
}

function getGwmdDisplaySurfaceState() {
  const enabled = isGwmdWallEnabled();
  const activeDisplays = getGwmdSelectedDisplays(enabled);
  const bounds = computeCombinedBounds(activeDisplays);

  return {
    enabled,
    mode: enabled ? gwmdDisplayMode : ("standard" as const),
    monitorCount: activeDisplays.length,
    arrangement: bounds.arrangement,
    bounds: {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    },
    selectedMonitorIds: [...gwmdDisplaySelectedMonitorIds],
    primaryMonitorId: gwmdDisplayPrimaryMonitorId,
    displayMode: gwmdDisplayMode,
    wallSessionId: gwmdDisplaySessionId,
    monitors: listGwmdMonitors(),
  };
}

function broadcastGwmdDisplaySurfaceState(): void {
  const state = getGwmdDisplaySurfaceState();
  for (const windowRef of BrowserWindow.getAllWindows()) {
    if (windowRef.isDestroyed()) {
      continue;
    }
    windowRef.webContents.send("gwmdMap:display:changed", state);
  }
}

function broadcastGwmdGraphUpdated(): void {
  for (const windowRef of BrowserWindow.getAllWindows()) {
    if (windowRef.isDestroyed()) {
      continue;
    }
    windowRef.webContents.send("gwmdMap:graph:updated");
  }
}

function buildGwmdWallWindowUrl(params: {
  sessionId: string;
  monitorId: number;
  primaryMonitorId: number;
  role: "primary" | "satellite";
  mode: GwmdDisplayMode;
}) {
  const viewMode =
    params.mode === "analyst"
      ? "gwmd-analyst"
      : params.mode === "mirror"
        ? "gwmd-mirror"
        : "gwmd-wall";
  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    const viewUrl = new URL(process.env.VITE_DEV_SERVER_URL);
    viewUrl.searchParams.set("view", viewMode);
    viewUrl.searchParams.set("wallSession", params.sessionId);
    viewUrl.searchParams.set("monitorId", String(params.monitorId));
    viewUrl.searchParams.set(
      "primaryMonitorId",
      String(params.primaryMonitorId),
    );
    viewUrl.searchParams.set("wallRole", params.role);
    return {
      isUrl: true,
      value: viewUrl.toString(),
    } as const;
  }

  return {
    isUrl: false,
    value: path.join(__dirname, "../renderer/index.html"),
    query: {
      view: viewMode,
      wallSession: params.sessionId,
      monitorId: String(params.monitorId),
      primaryMonitorId: String(params.primaryMonitorId),
      wallRole: params.role,
      displayMode: params.mode,
    },
  } as const;
}

function createGwmdDisplayWindow(
  display: NativeDisplay,
  options: {
    sessionId: string;
    primaryMonitorId: number;
  },
) {
  const preloadPath = path.join(__dirname, "../preload/index.cjs");
  const win = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    enableLargerThanScreen: true,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: "#0a0e1a",
    show: false,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    movable: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  const role =
    display.id === options.primaryMonitorId ? "primary" : "satellite";
  const target = buildGwmdWallWindowUrl({
    sessionId: options.sessionId,
    monitorId: display.id,
    primaryMonitorId: options.primaryMonitorId,
    role,
    mode: gwmdDisplayMode,
  });

  if (target.isUrl) {
    void win.loadURL(target.value);
  } else {
    void win.loadFile(target.value, {
      query: target.query,
    });
  }

  win.once("ready-to-show", () => {
    if (win.isDestroyed()) {
      return;
    }
    win.setBounds(
      {
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height,
      },
      true,
    );
    win.webContents.setZoomFactor(1);
    win.show();
    if (role === "primary") {
      win.focus();
    }
  });

  win.on("closed", () => {
    gwmdDisplayWallWindows.delete(display.id);
    if (gwmdWallClosing) {
      return;
    }
    closeGwmdDisplaySurface();
  });

  return win;
}

function applyGwmdDisplaySurfaceBounds(): void {
  if (!isGwmdWallEnabled()) {
    return;
  }

  const displayById = new Map(
    getGwmdDisplaysSorted().map((display) => [display.id, display]),
  );

  for (const [monitorId, windowRef] of gwmdDisplayWallWindows.entries()) {
    if (windowRef.isDestroyed()) {
      continue;
    }
    const display = displayById.get(monitorId);
    if (!display) {
      continue;
    }
    windowRef.setBounds(
      {
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height,
      },
      true,
    );
  }
}

function closeGwmdDisplaySurface(restoreSource = true) {
  if (!isGwmdWallEnabled()) {
    const state = getGwmdDisplaySurfaceState();
    broadcastGwmdDisplaySurfaceState();
    return state;
  }

  gwmdWallClosing = true;
  const windows = Array.from(gwmdDisplayWallWindows.values());
  gwmdDisplayWallWindows.clear();

  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.close();
    }
  }

  gwmdWallClosing = false;
  gwmdDisplaySessionId = null;

  if (restoreSource) {
    const restoreWindow = gwmdDisplaySourceWindow;
    gwmdDisplaySourceWindow = null;
    if (restoreWindow && !restoreWindow.isDestroyed()) {
      restoreWindow.show();
      restoreWindow.focus();
    }
  }

  const state = getGwmdDisplaySurfaceState();
  broadcastGwmdDisplaySurfaceState();
  return state;
}

function synchronizeGwmdDisplayWallWindows({
  focusPrimary = false,
}: {
  focusPrimary?: boolean;
} = {}) {
  const selected = sanitizeGwmdDisplaySelection({
    monitorIds: gwmdDisplaySelectedMonitorIds,
    primaryMonitorId: gwmdDisplayPrimaryMonitorId,
    mode: gwmdDisplayMode,
  });
  gwmdDisplaySelectedMonitorIds = selected.monitorIds;
  gwmdDisplayPrimaryMonitorId = selected.primaryMonitorId;
  gwmdDisplayMode = selected.mode;

  if (gwmdDisplaySelectedMonitorIds.length === 0) {
    return closeGwmdDisplaySurface();
  }

  const displays = getGwmdDisplaysSorted();
  const displayById = new Map(displays.map((display) => [display.id, display]));
  const wantedIds = new Set(gwmdDisplaySelectedMonitorIds);

  for (const [monitorId, win] of gwmdDisplayWallWindows.entries()) {
    if (
      win.isDestroyed() ||
      !wantedIds.has(monitorId) ||
      !displayById.has(monitorId)
    ) {
      if (!win.isDestroyed()) {
        win.close();
      }
      gwmdDisplayWallWindows.delete(monitorId);
    }
  }

  if (!gwmdDisplaySessionId) {
    gwmdDisplaySessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  for (const monitorId of gwmdDisplaySelectedMonitorIds) {
    if (gwmdDisplayWallWindows.has(monitorId)) {
      continue;
    }
    const display = displayById.get(monitorId);
    if (!display || gwmdDisplayPrimaryMonitorId === null) {
      continue;
    }
    const win = createGwmdDisplayWindow(display, {
      sessionId: gwmdDisplaySessionId,
      primaryMonitorId: gwmdDisplayPrimaryMonitorId,
    });
    gwmdDisplayWallWindows.set(monitorId, win);
  }

  applyGwmdDisplaySurfaceBounds();

  if (focusPrimary && gwmdDisplayPrimaryMonitorId !== null) {
    const primaryWin = gwmdDisplayWallWindows.get(gwmdDisplayPrimaryMonitorId);
    if (primaryWin && !primaryWin.isDestroyed()) {
      primaryWin.focus();
    }
  }

  const state = getGwmdDisplaySurfaceState();
  broadcastGwmdDisplaySurfaceState();
  return state;
}

function handleGwmdDisplayTopologyChange(): void {
  if (!isGwmdWallEnabled()) {
    return;
  }

  const availableIds = new Set(
    getGwmdDisplaysSorted().map((display) => display.id),
  );
  const nextSelected = gwmdDisplaySelectedMonitorIds.filter((id) =>
    availableIds.has(id),
  );

  if (nextSelected.length === 0) {
    closeGwmdDisplaySurface();
    return;
  }

  gwmdDisplaySelectedMonitorIds = nextSelected;
  if (
    gwmdDisplayPrimaryMonitorId === null ||
    !availableIds.has(gwmdDisplayPrimaryMonitorId)
  ) {
    gwmdDisplayPrimaryMonitorId = nextSelected[0] ?? null;
  }

  persistGwmdDisplaySelection({
    monitorIds: gwmdDisplaySelectedMonitorIds,
    primaryMonitorId: gwmdDisplayPrimaryMonitorId,
    mode: gwmdDisplayMode,
  });

  synchronizeGwmdDisplayWallWindows({ focusPrimary: false });
  broadcastGwmdDisplaySurfaceState();
}

function ensureGwmdDisplayListeners(): void {
  if (gwmdDisplayListenersAttached) {
    return;
  }
  screen.on("display-added", handleGwmdDisplayTopologyChange);
  screen.on("display-removed", handleGwmdDisplayTopologyChange);
  screen.on("display-metrics-changed", handleGwmdDisplayTopologyChange);
  gwmdDisplayListenersAttached = true;
}

function getGwmdDisplaySelection() {
  const selection = sanitizeGwmdDisplaySelection();
  gwmdDisplaySelectedMonitorIds = selection.monitorIds;
  gwmdDisplayPrimaryMonitorId = selection.primaryMonitorId;
  gwmdDisplayMode = selection.mode;
  persistGwmdDisplaySelection(selection);
  return selection;
}

function setGwmdDisplaySelection(selection?: {
  monitorIds?: number[];
  primaryMonitorId?: number | null;
  mode?: GwmdDisplayMode;
}) {
  const next = sanitizeGwmdDisplaySelection(selection);
  gwmdDisplaySelectedMonitorIds = next.monitorIds;
  gwmdDisplayPrimaryMonitorId = next.primaryMonitorId;
  gwmdDisplayMode = next.mode;
  persistGwmdDisplaySelection(next);

  if (isGwmdWallEnabled()) {
    synchronizeGwmdDisplayWallWindows({ focusPrimary: false });
  }

  const state = getGwmdDisplaySurfaceState();
  broadcastGwmdDisplaySurfaceState();
  return {
    ...next,
    state,
  };
}

function openGwmdDisplaySurface(
  sourceWindow?: BrowserWindow | null,
  selection?: {
    monitorIds?: number[];
    primaryMonitorId?: number | null;
    mode?: GwmdDisplayMode;
  },
) {
  const next = sanitizeGwmdDisplaySelection(selection);
  gwmdDisplaySelectedMonitorIds = next.monitorIds;
  gwmdDisplayPrimaryMonitorId = next.primaryMonitorId;
  gwmdDisplayMode = next.mode;
  persistGwmdDisplaySelection(next);

  if (gwmdDisplayMode === "standard") {
    return closeGwmdDisplaySurface();
  }

  if (gwmdDisplaySelectedMonitorIds.length === 0) {
    return getGwmdDisplaySurfaceState();
  }

  ensureGwmdDisplayListeners();

  const candidateSource =
    sourceWindow && !sourceWindow.isDestroyed()
      ? sourceWindow
      : mainWindow && !mainWindow.isDestroyed()
        ? mainWindow
        : null;
  if (candidateSource) {
    gwmdDisplaySourceWindow = candidateSource;
  }

  if (gwmdDisplaySourceWindow && !gwmdDisplaySourceWindow.isDestroyed()) {
    gwmdDisplaySourceWindow.hide();
  }

  return synchronizeGwmdDisplayWallWindows({ focusPrimary: true });
}

function openSmartRoutingWindow() {
  if (smartRoutingWindow && !smartRoutingWindow.isDestroyed()) {
    smartRoutingWindow.focus();
    return smartRoutingWindow;
  }

  const preloadPath = path.join(__dirname, "../preload/index.cjs");
  smartRoutingWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    backgroundColor: "#030712",
    title: "Smart Routing Overview",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    smartRoutingWindow.loadURL(
      `${process.env.VITE_DEV_SERVER_URL}?view=smart-routing`,
    );
  } else {
    const indexHtml = path.join(__dirname, "../renderer/index.html");
    smartRoutingWindow.loadFile(indexHtml, {
      query: { view: "smart-routing" },
    });
  }

  smartRoutingWindow.on("closed", () => {
    smartRoutingWindow = null;
  });

  return smartRoutingWindow;
}

function openDetachedTabWindow(tabLabel: string) {
  const safeTabLabel = typeof tabLabel === "string" ? tabLabel.trim() : "";
  if (!safeTabLabel) {
    return null;
  }

  const existing = detachedTabWindows.get(safeTabLabel);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return existing;
  }

  const preloadPath = path.join(__dirname, "../preload/index.cjs");
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: "#0b1020",
    title: `Trading Terminal - ${tabLabel}`,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    const detachedUrl = new URL(process.env.VITE_DEV_SERVER_URL);
    detachedUrl.searchParams.set("view", "detached-tab");
    detachedUrl.searchParams.set("tab", safeTabLabel);
    win.loadURL(detachedUrl.toString());
  } else {
    const indexHtml = path.join(__dirname, "../renderer/index.html");
    win.loadFile(indexHtml, {
      query: { view: "detached-tab", tab: safeTabLabel },
    });
  }

  detachedTabWindows.set(safeTabLabel, win);
  win.on("closed", () => {
    detachedTabWindows.delete(safeTabLabel);
  });

  return win;
}

function broadcastApiHubSnapshot(snapshot: ApiHubSnapshot) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("apiHub:changed", snapshot);
    }
  }
}

app.whenReady().then(async () => {
  try {
    console.log("[main] app.whenReady()");

    // Recover any local backtest runs that were stuck in 'running' state from a previous crash
    try {
      const recoveredCount = StrategyResearchRepo.recoverStuckRuns();
      if (recoveredCount > 0) {
        console.log(
          `[main] Recovered ${recoveredCount} stuck local backtest run(s) to failed state`,
        );
      }
    } catch (recoveryErr) {
      console.error(
        "[main] Failed to recover stuck backtest runs:",
        recoveryErr,
      );
    }

    // Validate Cloud LLM configuration early so errors surface before the window opens
    try {
      const { validateConfig, getConfigSummary } =
        await import("./services/llm/cloudLlmConfig");
      validateConfig();
      const summary = getConfigSummary();
      console.log(
        `[main] Cloud LLM configured: provider=${summary.provider} model=${summary.model}`,
      );
    } catch (configErr) {
      const msg =
        configErr instanceof Error ? configErr.message : String(configErr);
      console.error("[main] Cloud LLM config error:", msg);
      const { dialog } = await import("electron");
      dialog.showErrorBox(
        "Cloud AI Configuration Error",
        `${msg}\n\nThe app will continue but AI features will not work until you fix .env.local and restart.`,
      );
    }

    await loadMainAuthSession();

    // External Feeds service + IPC should be registered early to avoid renderer race
    const externalFeeds = new ExternalFeedsService(AppSettingsRepo);
    ipcMain.handle("externalFeeds:getConfig", () => externalFeeds.getConfig());
    ipcMain.handle("externalFeeds:setConfig", (_e, next: any) =>
      externalFeeds.setConfig(next),
    );
    ipcMain.handle(
      "externalFeeds:testProvider",
      async (_e, providerId: any, credentials?: Record<string, string>) => {
        return externalFeeds.testProvider(providerId, credentials ?? {});
      },
    );
    ipcMain.handle(
      "externalFeeds:getCftcSummary",
      async (_e, symbols: string[]) => {
        return externalFeeds.getCotSummary(symbols ?? []);
      },
    );
    ipcMain.handle("externalFeeds:getJoltsSeries", async () => {
      return externalFeeds.getJoltsSeries();
    });
    ipcMain.handle(
      "externalFeeds:getSecEvents",
      async (_e, params: { tickers?: string[]; limit?: number }) => {
        return externalFeeds.getSecEvents(params ?? {});
      },
    );

    ipcMain.handle("apiHub:list", () => {
      return apiHubService.list();
    });

    ipcMain.handle("apiHub:save", (_e, record: ApiCredentialRecord) => {
      const snapshot = apiHubService.upsert(record);
      broadcastApiHubSnapshot(snapshot);
      return snapshot;
    });

    ipcMain.handle("apiHub:remove", async (_e, id: string) => {
      const snapshot = await apiHubService.remove(id);
      broadcastApiHubSnapshot(snapshot);
      return snapshot;
    });

    ipcMain.handle("apiHub:openWindow", () => {
      openApiHubWindow();
      return true;
    });

    ipcMain.handle("smartRouting:openWindow", () => {
      openSmartRoutingWindow();
      return true;
    });

    ipcMain.handle("cockpit:tabs:openWindow", (_e, tabLabel: string) => {
      openDetachedTabWindow(tabLabel);
      return true;
    });

    aiStewardService = new AiStewardService(
      AppSettingsRepo,
      externalFeeds,
      path.join(app.getPath("userData"), "ai-steward"),
    );
    aiStewardService.on("update", (overview) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("aiSteward:update", overview);
      }
    });

    // Register custom protocol for serving screenshots
    protocol.handle("screenshot", (request) => {
      const url = request.url.replace("screenshot://", "");
      const filePath = decodeURIComponent(url);

      try {
        return new Response(fs.readFileSync(filePath), {
          headers: { "Content-Type": "image/png" },
        });
      } catch (err) {
        console.error("[main] Failed to load screenshot:", filePath, err);
        return new Response("Not Found", { status: 404 });
      }
    });
    console.log("[main] Screenshot protocol registered");

    // Initialize database early
    try {
      getDb();
      ensurePersistedBackendUrl();
      console.log("[main] SQLite initialized");

      // Run ingest connectors (seed + local drop folder) before pipeline
      const { ingestAll } = await import("./services/publicFlow/ingest");
      const ingestResult = await ingestAll("1970-01-01T00:00:00.000Z");
      console.log(
        `[main] Public Flow ingest complete: fetched=${ingestResult.totals.fetched} parsed=${ingestResult.totals.parsed} inserted=${ingestResult.totals.inserted} skipped=${ingestResult.totals.skipped}`,
      );
      if (ingestResult.errors.length) {
        console.warn(
          "[main] Public Flow ingest errors:",
          ingestResult.errors.join(" | "),
        );
      }

      // Run Public Flow Intel pipeline on startup
      const { PublicFlowPipeline } =
        await import("./services/publicFlow/pipeline");
      PublicFlowPipeline.run().catch((err) => {
        console.error("[main] Public Flow pipeline startup error:", err);
      });
    } catch (dbErr) {
      console.error("[main] SQLite init failed", dbErr);
    }
    mainWindow = createWindow();
    console.log("[main] window created");

    // KEEP APP ALIVE - Don't auto-quit when windows close (during dev)
    if (isDev) {
      console.log("[main] DEV MODE: app will NOT auto-quit when windows close");
    }

    const bus = new EventBus();
    console.log("[main] EventBus created");

    aiManager = new AiResearchManager((channel, payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, payload);
      }
    });
    aiManager.resetPolling(aiManager.getConfig());

    // Initialize Backend API Client for AI services
    rebuildBackendApiClient();

    const logger = {
      log: (...args: any[]) => console.log("[main]", ...args),
      error: (...args: any[]) => console.error("[main]", ...args),
    };

    console.log("[main] creating StreamManager...");
    const stream = new StreamManager((evt) => bus.publish(evt), logger);
    console.log("[main] StreamManager created");

    // Initialize paper trading adapter
    const paperAdapter = new PaperTradingAdapter();
    await paperAdapter.connect();
    console.log("[main] PaperTradingAdapter initialized");

    riskGuardian = new RiskGuardian(
      {
        maxDailyLoss: -1500,
        maxDrawdown: -2500,
      },
      (status) => {
        console.warn("[risk] trip", status.reason);
        try {
          const orders = paperAdapter.getOrders();
          for (const o of orders) {
            if (o.status === "PENDING") {
              void paperAdapter.cancelOrder(o.orderId);
            }
          }
        } catch (err) {
          console.error("[risk] failed to cancel pending orders", err);
        }

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("cockpit:risk:event", {
            type: "risk.limit",
            ts: Date.now(),
            status,
          });
        }
      },
    );

    // Setup journal manager to capture fills
    const journalManager = getJournalManager();
    journalManager.setWindow(mainWindow);

    // Stream paper trading events to renderer
    paperAdapter.onEvent((event) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("cockpit:trading:event", event);
      }

      // Capture fill events for journaling
      if (event.type === "fill") {
        journalManager.handleFill(event.fill as Fill).catch((err) => {
          console.error("[main] Journal manager error:", err);
        });
      }

      if (event.type === "account") {
        riskGuardian?.observeAccount(event.account);
      }
    });

    // Attach IPC publisher after load (so renderer is ready)
    mainWindow.webContents.once("did-finish-load", () => {
      console.log("[main]");
      console.log("[main] ===== DID-FINISH-LOAD FIRED =====");
      console.log("[main]");
      try {
        broadcastBackendAuthTokenChanged(mainAuthSession?.token ?? null);

        console.log("[main] [1/4] attaching IPC streaming...");
        attachIpcStreaming(bus, mainWindow!.webContents);
        console.log("[main] [1/4] ✓ IPC streaming attached");

        // Initialize Central AI Orchestrator
        console.log("[main] [2/4] initializing Central AI...");
        centralAI.setWebContents(mainWindow!.webContents);
        console.log("[main] [2/4] ✓ Central AI initialized");

        // Start default stream + heartbeat
        console.log("[main] [3/4] initializing stream...");
        try {
          stream.init();
          console.log("[main] [3/4] ✓ stream initialized");
        } catch (initErr) {
          console.error(
            "[main] [3/4] ✗ FATAL Error in stream.init():",
            initErr,
          );
          throw initErr;
        }

        // tell renderer initial status
        console.log("[main] [4/4] publishing initial status...");
        try {
          bus.publish({
            type: "system.stream.source",
            ts: Date.now(),
            source: stream.getSource(),
          });
          console.log("[main] [4/4] ✓ initial status published");
          console.log("[main]");
          console.log("[main] ===== ✓ APP FULLY INITIALIZED =====");
          console.log("[main]");
        } catch (publishErr) {
          console.error(
            "[main] [3/3] ✗ FATAL Error publishing initial status:",
            publishErr,
          );
          throw publishErr;
        }
      } catch (e) {
        console.error("[main]");
        console.error("[main] ===== ✗ FATAL ERROR IN DID-FINISH-LOAD =====");
        console.error("[main] Error:", e);
        console.error("[main]");
        process.exit(1);
      }
    });

    // --- Auth session bridge for backend API ---
    ipcMain.handle("backendAuth:login", async (_e, payload: any = {}) => {
      const username =
        typeof payload.username === "string" ? payload.username : undefined;
      const email =
        typeof payload.email === "string" ? payload.email : undefined;
      const password =
        typeof payload.password === "string" ? payload.password : "";
      const licenseKey =
        typeof payload.licenseKey === "string" ? payload.licenseKey : "";

      if ((!username && !email) || !password || !licenseKey) {
        return { ok: false, error: "invalid_login_payload" };
      }

      try {
        const session = await loginMainSession({
          username,
          email,
          password,
          licenseKey,
        });
        if (backendApiClient) {
          backendApiClient.setAuthToken(session.token);
        }
        broadcastBackendAuthTokenChanged(session.token);
        return { ok: true, session };
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    });

    ipcMain.handle("backendAuth:signup", async (_e, payload: any = {}) => {
      const username =
        typeof payload.username === "string" ? payload.username.trim() : "";
      const email =
        typeof payload.email === "string" ? payload.email.trim() : "";
      const password =
        typeof payload.password === "string" ? payload.password : "";
      const licenseKey =
        typeof payload.licenseKey === "string" ? payload.licenseKey : "";

      if (!username || !email || !password || !licenseKey) {
        return { ok: false, error: "invalid_signup_payload" };
      }

      try {
        const session = await signupMainSession({
          username,
          email,
          password,
          licenseKey,
        });
        if (backendApiClient) {
          backendApiClient.setAuthToken(session.token);
        }
        broadcastBackendAuthTokenChanged(session.token);
        return { ok: true, session };
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    });

    ipcMain.handle("backendAuth:refresh", async () => {
      if (!mainAuthSession?.refreshToken) {
        return { ok: false, error: "no_refresh_token" };
      }

      try {
        const session = await refreshMainSession(mainAuthSession.refreshToken);
        if (backendApiClient) {
          backendApiClient.setAuthToken(session.token);
        }
        broadcastBackendAuthTokenChanged(session.token);
        return { ok: true, session };
      } catch (error) {
        mainAuthSession = null;
        broadcastBackendAuthTokenChanged(null);
        return { ok: false, error: (error as Error).message };
      }
    });

    ipcMain.handle("backendAuth:getSession", async () => {
      return mainAuthSession;
    });

    ipcMain.handle(
      "backendAuth:setSession",
      async (_e, session: MainAuthSession | null) => {
        if (session === null) {
          mainAuthSession = null;
          await persistMainAuthSession(null);
          if (backendApiClient) {
            backendApiClient.setAuthToken(null);
          }
          broadcastBackendAuthTokenChanged(null);
          return true;
        }

        if (!isValidMainAuthSession(session)) {
          return false;
        }

        mainAuthSession = session;
        await persistMainAuthSession(session);
        if (backendApiClient) {
          backendApiClient.setAuthToken(session.token);
        }
        broadcastBackendAuthTokenChanged(session.token);
        return true;
      },
    );

    ipcMain.handle("backendAuth:logout", async () => {
      if (mainAuthSession) {
        try {
          const token = await ensureMainAuthToken();
          await fetch(`${getBackendUrl()}/api/auth/logout`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
              allSessions: false,
              refreshToken: mainAuthSession.refreshToken,
            }),
          });
        } catch (error) {
          console.warn("[main] backend logout notify failed", error);
        }
      }

      mainAuthSession = null;
      await persistMainAuthSession(null);
      if (backendApiClient) {
        backendApiClient.setAuthToken(null);
      }
      broadcastBackendAuthTokenChanged(null);
      return true;
    });

    ipcMain.handle("backendAuth:getToken", async () => {
      const token = await ensureMainAuthToken();
      return token;
    });

    ipcMain.handle(
      "strategyResearch:downloadHistoricalData",
      async (_event, payload?: { symbols?: unknown }) => {
        const symbols = Array.isArray(payload?.symbols)
          ? payload.symbols.filter(
              (value): value is string => typeof value === "string",
            )
          : [];
        return getLocalStrategyResearchService().downloadHistoricalData(
          symbols,
        );
      },
    );

    ipcMain.handle("strategyResearch:loadLocalWorkspace", async () => {
      return StrategyResearchRepo.listWorkspace();
    });

    ipcMain.handle(
      "strategyResearch:upsertLocalStrategy",
      async (
        _event,
        payload?: {
          strategy?: LocalStrategyDefinitionRecord;
        },
      ) => {
        if (!payload?.strategy) {
          throw new Error("strategy_payload_required");
        }
        StrategyResearchRepo.upsertStrategy(payload.strategy);
        return { ok: true };
      },
    );

    ipcMain.handle(
      "strategyResearch:upsertLocalVersion",
      async (
        _event,
        payload?: {
          version?: LocalStrategyVersionRecord;
        },
      ) => {
        if (!payload?.version) {
          throw new Error("version_payload_required");
        }
        StrategyResearchRepo.upsertVersion(payload.version);
        return { ok: true };
      },
    );

    ipcMain.handle(
      "strategyResearch:upsertLocalRun",
      async (
        _event,
        payload?: {
          run?: LocalStrategyRunRecord;
        },
      ) => {
        if (!payload?.run) {
          throw new Error("run_payload_required");
        }
        StrategyResearchRepo.upsertRun(payload.run);
        return { ok: true };
      },
    );

    ipcMain.handle(
      "strategyResearch:upsertLocalComparisonNote",
      async (
        _event,
        payload?: {
          comparisonNote?: LocalStrategyComparisonNoteRecord;
        },
      ) => {
        if (!payload?.comparisonNote) {
          throw new Error("comparison_note_payload_required");
        }
        StrategyResearchRepo.upsertComparisonNote(payload.comparisonNote);
        return { ok: true };
      },
    );

    ipcMain.handle(
      "strategyResearch:runLocalBacktest",
      async (
        _event,
        payload?: {
          runId?: unknown;
          strategyId?: unknown;
          strategyVersion?: unknown;
          scriptSource?: unknown;
          universe?: unknown;
          assumptions?: unknown;
        },
      ) => {
        return getLocalStrategyResearchService().runBacktest({
          runId:
            typeof payload?.runId === "string"
              ? payload.runId
              : `local-run-${Date.now()}`,
          strategyId:
            typeof payload?.strategyId === "string"
              ? payload.strategyId
              : "local-strategy",
          strategyVersion:
            typeof payload?.strategyVersion === "string"
              ? payload.strategyVersion
              : "local-version",
          scriptSource:
            typeof payload?.scriptSource === "string"
              ? payload.scriptSource
              : "function onBar(){ return [hold()]; }",
          universe: Array.isArray(payload?.universe)
            ? payload.universe.filter(
                (value): value is string => typeof value === "string",
              )
            : [],
          assumptions:
            payload?.assumptions && typeof payload.assumptions === "object"
              ? (payload.assumptions as Record<string, unknown>)
              : {},
        });
      },
    );

    const bindBackendToken = async (authToken?: string) => {
      if (!backendApiClient) {
        return false;
      }
      const resolvedToken = authToken ?? (await ensureMainAuthToken());
      if (!resolvedToken) {
        return false;
      }
      backendApiClient.setAuthToken(resolvedToken);
      return true;
    };

    // --- IPC handlers (Prompt 5) ---
    // Public Flow Intel IPC handlers
    ipcMain.handle("publicFlow:getRecent", async (_e, limit?: number) => {
      const resolvedLimit = limit ?? 50;
      if (backendApiClient) {
        try {
          const response =
            await backendApiClient.publicFlowGetRecent(resolvedLimit);
          return response.items ?? [];
        } catch (error) {
          if (!canUseLocalFallback()) {
            throw error;
          }
        }
      }

      return getRecentDisclosureEvents(resolvedLimit);
    });

    ipcMain.handle(
      "publicFlow:getThemes",
      async (_e, windowDays: 7 | 30, limit?: number) => {
        const window = windowDays === 30 ? 30 : 7;
        const resolvedLimit = limit ?? 10;

        if (backendApiClient) {
          try {
            const response = await backendApiClient.publicFlowGetThemes(
              windowDays,
              resolvedLimit,
            );
            return response.items ?? [];
          } catch (error) {
            if (!canUseLocalFallback()) {
              throw error;
            }
          }
        }

        return getTopSectorThemes(window, resolvedLimit);
      },
    );

    ipcMain.handle("publicFlow:getCandidates", async (_e, themeId: number) => {
      if (backendApiClient) {
        try {
          const response =
            await backendApiClient.publicFlowGetCandidates(themeId);
          return response.items ?? [];
        } catch (error) {
          if (!canUseLocalFallback()) {
            throw error;
          }
        }
      }

      return getWatchlistCandidates(themeId);
    });

    ipcMain.handle(
      "publicFlow:getValuations",
      async (_e, tickers: string[]) => {
        if (backendApiClient) {
          try {
            const response = await backendApiClient.publicFlowGetValuations(
              tickers ?? [],
            );
            return response.items ?? {};
          } catch (error) {
            if (!canUseLocalFallback()) {
              throw error;
            }
          }
        }

        try {
          return await getValuationTags(tickers ?? []);
        } catch (err) {
          console.error("[main] publicFlow:getValuations error", err);
          return {};
        }
      },
    );

    ipcMain.handle("publicFlow:refresh", async () => {
      const started = Date.now();
      if (backendApiClient) {
        try {
          const response = await backendApiClient.publicFlowRefresh();
          return { ok: true, ...response };
        } catch (error) {
          if (!canUseLocalFallback()) {
            throw error;
          }
        }
      }

      try {
        const result = await refreshPublicFlowIntel();
        return { ok: true, ...result };
      } catch (err) {
        console.error("[main] publicFlow:refresh error", err);
        return { ok: false, error: String(err), ts: Date.now(), started };
      }
    });

    ipcMain.handle("tedIntel:getSnapshot", async (_e, windowDays?: unknown) => {
      const requestedWindow =
        windowDays === "7d" ||
        windowDays === "30d" ||
        windowDays === "90d" ||
        windowDays === "1y"
          ? windowDays
          : "90d";

      if (!backendApiClient) {
        console.warn(
          "[tedIntel:getSnapshot] No backend client — returning local snapshot",
        );
        return buildTedIntelSnapshot(requestedWindow);
      }

      try {
        return await backendApiClient.tedIntelGetSnapshot(requestedWindow);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[tedIntel:getSnapshot] Backend unavailable (${message}) — returning local snapshot`,
        );
        return buildTedIntelSnapshot(requestedWindow);
      }
    });

    // --- Congress Activity IPC handlers ---
    ipcMain.handle("congress:queryTrades", async (_e, filters: any) => {
      if (backendApiClient) {
        try {
          const cached = readCongressCache<unknown[]>(
            "congress:queryTrades",
            filters,
          );
          if (cached) {
            return cached;
          }
          const response = await backendApiClient.congressQueryTrades(filters);
          const rows = response.items ?? [];
          writeCongressCache("congress:queryTrades", filters, rows);
          return rows;
        } catch (error) {
          if (!canUseLocalFallback()) {
            throw error;
          }
        }
      }

      return CongressRepo.queryCongressionalTrades(filters);
    });

    ipcMain.handle(
      "congress:queryTradesWithParty",
      async (_e, filters: any) => {
        if (backendApiClient) {
          try {
            const cached = readCongressCache<unknown[]>(
              "congress:queryTradesWithParty",
              filters,
            );
            if (cached) {
              return cached;
            }
            const response =
              await backendApiClient.congressQueryTrades(filters);
            const rows = Array.isArray(response.items) ? response.items : [];
            const mappedRows = rows.map((item) => ({
              ...item,
              party:
                typeof (item as Record<string, unknown>).party === "string"
                  ? (item as Record<string, unknown>).party
                  : "N/A",
            }));
            writeCongressCache(
              "congress:queryTradesWithParty",
              filters,
              mappedRows,
            );
            return mappedRows;
          } catch (error) {
            if (!canUseLocalFallback()) {
              throw error;
            }
          }
        }

        return CongressRepo.queryCongressionalTradesWithParty(filters);
      },
    );

    ipcMain.handle(
      "congress:getTradeStats",
      async (_e, ticker: string, dateStart?: string, dateEnd?: string) => {
        if (backendApiClient) {
          try {
            const cachePayload = { ticker, dateStart, dateEnd };
            const cached = readCongressCache<Record<string, unknown> | null>(
              "congress:getTradeStats",
              cachePayload,
            );
            if (cached !== null) {
              return cached;
            }
            const response = await backendApiClient.congressQueryTrades({
              ticker,
              transaction_date_start: dateStart,
              transaction_date_end: dateEnd,
              limit: 1000,
            });

            const rows = Array.isArray(response.items)
              ? (response.items as Array<Record<string, unknown>>)
              : [];

            if (rows.length === 0) {
              writeCongressCache("congress:getTradeStats", cachePayload, null);
              return null;
            }

            const toNumber = (value: unknown): number => {
              const n = Number(value);
              return Number.isFinite(n) ? n : 0;
            };

            const buySet = new Set(["buy", "purchase"]);
            const sellSet = new Set(["sell", "sale"]);

            let totalBuys = 0;
            let totalSells = 0;
            let buyVolumeMin = 0;
            let buyVolumeMax = 0;
            let sellVolumeMin = 0;
            let sellVolumeMax = 0;
            const uniqueTraders = new Set<string>();

            for (const row of rows) {
              const txType = String(row.transaction_type ?? "").toLowerCase();
              const low = toNumber(row.amount_range_low);
              const high = toNumber(row.amount_range_high);
              const personName = row.person_name;
              if (typeof personName === "string" && personName.trim()) {
                uniqueTraders.add(personName.trim());
              }

              if (buySet.has(txType)) {
                totalBuys += 1;
                buyVolumeMin += low;
                buyVolumeMax += high;
              } else if (sellSet.has(txType)) {
                totalSells += 1;
                sellVolumeMin += low;
                sellVolumeMax += high;
              }
            }

            const stats = {
              ticker,
              total_buys: totalBuys,
              total_sells: totalSells,
              buy_volume_min: buyVolumeMin,
              buy_volume_max: buyVolumeMax,
              sell_volume_min: sellVolumeMin,
              sell_volume_max: sellVolumeMax,
              unique_traders: uniqueTraders.size,
            };
            writeCongressCache("congress:getTradeStats", cachePayload, stats);
            return stats;
          } catch (error) {
            if (!canUseLocalFallback()) {
              throw error;
            }
          }
        }

        return CongressRepo.getTradeStatsByTicker(ticker, dateStart, dateEnd);
      },
    );

    ipcMain.handle(
      "congress:getMostTradedTickers",
      async (
        _e,
        params: { dateStart?: string; dateEnd?: string; limit?: number },
      ) => {
        if (backendApiClient) {
          try {
            const cached = readCongressCache<unknown[]>(
              "congress:getMostTradedTickers",
              params,
            );
            if (cached) {
              return cached;
            }
            const response =
              await backendApiClient.congressGetMostTradedTickers(
                params?.limit ?? 10,
              );
            const rows = response.items ?? [];
            writeCongressCache("congress:getMostTradedTickers", params, rows);
            return rows;
          } catch (error) {
            if (!canUseLocalFallback()) {
              throw error;
            }
          }
        }

        return CongressRepo.getMostTradedTickers(
          params.dateStart,
          params.dateEnd,
          params.limit,
        );
      },
    );

    ipcMain.handle("congress:getDisclosureLagStats", async () => {
      if (backendApiClient) {
        try {
          const cached = readCongressCache<Record<string, unknown>>(
            "congress:getDisclosureLagStats",
          );
          if (cached) {
            return cached;
          }
          const response =
            await backendApiClient.congressGetDisclosureLagStats();
          const stats = response.stats ?? {};
          writeCongressCache("congress:getDisclosureLagStats", null, stats);
          return stats;
        } catch (error) {
          if (!canUseLocalFallback()) {
            throw error;
          }
        }
      }

      return CongressRepo.getDisclosureLagStats();
    });

    ipcMain.handle("congress:queryMembers", async (_e, filters: any) => {
      if (backendApiClient) {
        try {
          const cached = readCongressCache<unknown[]>(
            "congress:queryMembers",
            filters,
          );
          if (cached) {
            return cached;
          }
          const response = await backendApiClient.congressQueryMembers(
            filters?.limit ?? 100,
          );
          const rows = response.items ?? [];
          writeCongressCache("congress:queryMembers", filters, rows);
          return rows;
        } catch (error) {
          if (!canUseLocalFallback()) {
            throw error;
          }
        }
      }

      return CongressRepo.queryCongressionalMembers(filters);
    });

    ipcMain.handle("congress:queryLobbying", async (_e, filters: any) => {
      if (backendApiClient) {
        try {
          const cached = readCongressCache<unknown[]>(
            "congress:queryLobbying",
            filters,
          );
          if (cached) {
            return cached;
          }
          const response = await backendApiClient.congressQueryLobbying(
            filters?.limit ?? 100,
          );
          const rows = response.items ?? [];
          writeCongressCache("congress:queryLobbying", filters, rows);
          return rows;
        } catch (error) {
          if (!canUseLocalFallback()) {
            throw error;
          }
        }
      }

      return CongressRepo.queryLobbyingActivities(filters);
    });

    ipcMain.handle("congress:queryContracts", async (_e, filters: any) => {
      if (backendApiClient) {
        try {
          const cached = readCongressCache<unknown[]>(
            "congress:queryContracts",
            filters,
          );
          if (cached) {
            return cached;
          }
          const response = await backendApiClient.congressQueryContracts(
            filters?.limit ?? 100,
          );
          const rows = response.items ?? [];
          writeCongressCache("congress:queryContracts", filters, rows);
          return rows;
        } catch (error) {
          if (!canUseLocalFallback()) {
            throw error;
          }
        }
      }

      return CongressRepo.queryFederalContracts(filters);
    });

    ipcMain.handle("congress:insertTrades", (_e, trades: any[]) => {
      clearCongressBackendCache();
      return CongressRepo.insertCongressionalTrades(trades);
    });

    ipcMain.handle("congress:insertLobbying", (_e, activities: any[]) => {
      clearCongressBackendCache();
      return CongressRepo.insertLobbyingActivities(activities);
    });

    ipcMain.handle("congress:insertContracts", (_e, contracts: any[]) => {
      clearCongressBackendCache();
      return CongressRepo.insertFederalContracts(contracts);
    });

    ipcMain.handle("congress:upsertMembers", (_e, members: any[]) => {
      clearCongressBackendCache();
      return CongressRepo.upsertCongressionalMembers(members);
    });

    ipcMain.handle("congress:findTicker", (_e, companyName: string) => {
      return CongressRepo.findTickerByCompanyName(companyName);
    });

    ipcMain.handle("congress:insertIngestionLog", (_e, log: any) => {
      return CongressRepo.insertIngestionLog(log);
    });

    ipcMain.handle(
      "congress:queryIngestionLogs",
      (_e, domain?: string, limit?: number) => {
        return CongressRepo.queryIngestionLogs(domain, limit);
      },
    );

    ipcMain.handle("congress:fetchHouseTrades", async (_e, limit?: number) => {
      clearCongressBackendCache();
      const service = getCongressDataService();
      return await service.fetchHouseTrades(limit);
    });

    ipcMain.handle("congress:fetchSenateTrades", async (_e, limit?: number) => {
      clearCongressBackendCache();
      const service = getCongressDataService();
      return await service.fetchSenateTrades(limit);
    });

    ipcMain.handle(
      "congress:fetchLobbyingActivities",
      async (_e, limit?: number) => {
        clearCongressBackendCache();
        const service = getCongressDataService();
        return await service.fetchLobbyingActivities(limit);
      },
    );

    ipcMain.handle(
      "congress:fetchFederalContracts",
      async (_e, limit?: number) => {
        clearCongressBackendCache();
        const service = getCongressDataService();
        return await service.fetchFederalContracts(limit);
      },
    );

    ipcMain.handle("congress:fetchAllTrades", async (_e, limit?: number) => {
      clearCongressBackendCache();
      const service = getCongressDataService();
      return await service.fetchAll(limit);
    });

    ipcMain.handle("congress:scanAiSources", async () => {
      try {
        const data = await scanCongressAiIntel();
        return { success: true, data };
      } catch (err) {
        console.error("[main] congress:scanAiSources error", err);
        return { success: false, error: String(err) };
      }
    });

    ipcMain.handle(
      "congress:ai:analyzeTrade",
      async (
        _e,
        {
          tradeId,
          tradeData,
          model,
          authToken,
        }: {
          tradeId?: string;
          tradeData?: Record<string, unknown>;
          model?: string;
          authToken?: string;
        } = {},
      ) => {
        try {
          if (tradeId && tradeData && (await bindBackendToken(authToken))) {
            const analysis = await backendApiClient.congressAnalyzeTrade(
              tradeId,
              tradeData,
              model,
            );
            return { ok: true, data: analysis, source: "backend" };
          }

          if (!canUseLocalFallback()) {
            return {
              ok: false,
              error: "backend_only_processing_enabled",
              source: "backend-required",
            };
          }

          const intel = await scanCongressAiIntel();
          return {
            ok: true,
            data: {
              tradeId: tradeId ?? "local-fallback",
              summary: intel.summary,
              highlights: intel.highlights,
              sentiment: intel.sentiment,
              watchlist: intel.watchlist,
              model: intel.model,
              generatedAt: intel.generatedAt,
            },
            source: "local",
          };
        } catch (error) {
          if (!canUseLocalFallback()) {
            return {
              ok: false,
              error: String(error),
              source: "backend-required",
            };
          }
          try {
            const intel = await scanCongressAiIntel();
            return {
              ok: true,
              data: {
                tradeId: tradeId ?? "local-fallback",
                summary: intel.summary,
                highlights: intel.highlights,
                sentiment: intel.sentiment,
                watchlist: intel.watchlist,
                model: intel.model,
                generatedAt: intel.generatedAt,
              },
              source: "local-fallback",
            };
          } catch (fallbackError) {
            return { ok: false, error: String(fallbackError) };
          }
        }
      },
    );

    ipcMain.handle(
      "congress:ai:watchlist:get",
      async (_e, { authToken }: { authToken?: string } = {}) => {
        try {
          if (await bindBackendToken(authToken)) {
            const watchlist = await backendApiClient.congressGetWatchlist();
            return { ok: true, data: watchlist, source: "backend" };
          }

          if (!canUseLocalFallback()) {
            return {
              ok: false,
              error: "backend_only_processing_enabled",
              source: "backend-required",
            };
          }

          return {
            ok: true,
            data: {
              items: [...congressAiWatchlistFallback],
            },
            source: "local",
          };
        } catch (error) {
          if (!canUseLocalFallback()) {
            return {
              ok: false,
              error: String(error),
              source: "backend-required",
            };
          }
          return {
            ok: true,
            data: {
              items: [...congressAiWatchlistFallback],
            },
            source: "local-fallback",
          };
        }
      },
    );

    ipcMain.handle(
      "congress:ai:watchlist:add",
      async (
        _e,
        {
          ticker,
          reason,
          priority,
          authToken,
        }: {
          ticker?: string;
          reason?: string;
          priority?: number;
          authToken?: string;
        } = {},
      ) => {
        try {
          if (ticker && reason && (await bindBackendToken(authToken))) {
            const created = await backendApiClient.congressAddToWatchlist(
              ticker,
              reason,
              priority,
            );
            return { ok: true, data: created, source: "backend" };
          }

          if (!canUseLocalFallback()) {
            return {
              ok: false,
              error: "backend_only_processing_enabled",
              source: "backend-required",
            };
          }

          if (!ticker || !reason) {
            return { ok: false, error: "ticker_and_reason_required" };
          }

          const item: CongressAiWatchlistFallbackItem = {
            id: congressAiWatchlistFallbackSeq++,
            ticker,
            reason,
            priority: Number.isFinite(priority) ? Number(priority) : 1,
            createdAt: new Date().toISOString(),
          };
          congressAiWatchlistFallback = [item, ...congressAiWatchlistFallback];
          return { ok: true, data: item, source: "local" };
        } catch (error) {
          if (!canUseLocalFallback()) {
            return {
              ok: false,
              error: String(error),
              source: "backend-required",
            };
          }
          if (!ticker || !reason) {
            return { ok: false, error: "ticker_and_reason_required" };
          }
          const item: CongressAiWatchlistFallbackItem = {
            id: congressAiWatchlistFallbackSeq++,
            ticker,
            reason,
            priority: Number.isFinite(priority) ? Number(priority) : 1,
            createdAt: new Date().toISOString(),
          };
          congressAiWatchlistFallback = [item, ...congressAiWatchlistFallback];
          return { ok: true, data: item, source: "local-fallback" };
        }
      },
    );

    ipcMain.handle(
      "congress:ai:watchlist:remove",
      async (
        _e,
        {
          watchlistId,
          authToken,
        }: { watchlistId?: number; authToken?: string } = {},
      ) => {
        try {
          if (
            typeof watchlistId === "number" &&
            (await bindBackendToken(authToken))
          ) {
            const result =
              await backendApiClient.congressDismissFromWatchlist(watchlistId);
            return { ok: true, data: result, source: "backend" };
          }

          if (!canUseLocalFallback()) {
            return {
              ok: false,
              error: "backend_only_processing_enabled",
              source: "backend-required",
            };
          }

          if (typeof watchlistId !== "number") {
            return { ok: false, error: "watchlist_id_required" };
          }

          const before = congressAiWatchlistFallback.length;
          congressAiWatchlistFallback = congressAiWatchlistFallback.filter(
            (item) => item.id !== watchlistId,
          );
          return {
            ok: true,
            data: { removed: congressAiWatchlistFallback.length < before },
            source: "local",
          };
        } catch (error) {
          if (!canUseLocalFallback()) {
            return {
              ok: false,
              error: String(error),
              source: "backend-required",
            };
          }
          if (typeof watchlistId !== "number") {
            return { ok: false, error: "watchlist_id_required" };
          }
          const before = congressAiWatchlistFallback.length;
          congressAiWatchlistFallback = congressAiWatchlistFallback.filter(
            (item) => item.id !== watchlistId,
          );
          return {
            ok: true,
            data: { removed: congressAiWatchlistFallback.length < before },
            source: "local-fallback",
          };
        }
      },
    );

    // --- AI Research IPC handlers ---
    ipcMain.handle(
      "ai:config:get",
      async (_e, { authToken }: { authToken?: string } = {}) => {
        try {
          // Try backend first
          if (await bindBackendToken(authToken)) {
            const config = await backendApiClient.researchGetConfig();
            return { ok: true, data: config, source: "backend" };
          }
          // Fall back to local
          const config = await aiManager?.getConfig();
          return { ok: true, data: config, source: "local" };
        } catch (error) {
          // Try local fallback if backend fails
          try {
            const config = await aiManager?.getConfig();
            return { ok: true, data: config, source: "local-fallback" };
          } catch (fallbackError) {
            return { ok: false, error: (fallbackError as Error).message };
          }
        }
      },
    );

    ipcMain.handle(
      "ai:config:set",
      async (
        _e,
        { config, authToken }: { config?: unknown; authToken?: string } = {},
      ) => {
        try {
          // Try backend first
          if (await bindBackendToken(authToken)) {
            const result = await backendApiClient.researchSetConfig(config);
            return { ok: true, data: result, source: "backend" };
          }
          // Fall back to local
          const result = aiManager?.setConfig(config);
          return { ok: true, data: result, source: "local" };
        } catch (error) {
          // Try local fallback if backend fails
          try {
            const result = aiManager?.setConfig(config);
            return { ok: true, data: result, source: "local-fallback" };
          } catch (fallbackError) {
            return { ok: false, error: (fallbackError as Error).message };
          }
        }
      },
    );

    ipcMain.handle(
      "ai:run",
      async (
        _e,
        {
          items,
          authToken,
        }: {
          items?: Array<{ title: string; text: string }>;
          authToken?: string;
        } = {},
      ) => {
        if (!aiManager && !backendApiClient)
          return { ok: false, error: "AI manager not ready" };
        try {
          // Try backend first
          if (await bindBackendToken(authToken)) {
            const result = await backendApiClient.researchRun(items);
            return { ok: true, data: result, source: "backend" };
          }
          if (!canUseLocalFallback()) {
            return {
              ok: false,
              error: "backend_only_processing_enabled",
              source: "backend-required",
            };
          }
          // Fall back to local
          const result = await aiManager!.runNow("manual", items ?? []);
          return { ok: true, data: result, source: "local" };
        } catch (error) {
          // Try local fallback if backend fails
          try {
            if (!canUseLocalFallback()) {
              return {
                ok: false,
                error:
                  (error as Error).message || "backend_only_processing_enabled",
                source: "backend-required",
              };
            }
            const result = await aiManager!.runNow("manual", items ?? []);
            return { ok: true, data: result, source: "local-fallback" };
          } catch (fallbackError) {
            return { ok: false, error: (fallbackError as Error).message };
          }
        }
      },
    );

    ipcMain.handle(
      "ai:briefs:list",
      async (
        _e,
        { limit, authToken }: { limit?: number; authToken?: string } = {},
      ) => {
        try {
          // Try backend first
          if (await bindBackendToken(authToken)) {
            const briefs = await backendApiClient.researchGetBriefs(limit);
            return { ok: true, data: briefs, source: "backend" };
          }
          // Fall back to local
          const { AiResearchRepo } = require("./persistence/aiResearchRepo");
          const briefs = AiResearchRepo.listBriefs(limit ?? 5);
          return { ok: true, data: briefs, source: "local" };
        } catch (error) {
          // Try local fallback if backend fails
          try {
            const { AiResearchRepo } = require("./persistence/aiResearchRepo");
            const briefs = AiResearchRepo.listBriefs(limit ?? 5);
            return { ok: true, data: briefs, source: "local-fallback" };
          } catch (fallbackError) {
            return { ok: false, error: (fallbackError as Error).message };
          }
        }
      },
    );

    ipcMain.handle(
      "ai:status:get",
      async (_e, { authToken }: { authToken?: string } = {}) => {
        try {
          // Try backend first
          if (await bindBackendToken(authToken)) {
            const status = await backendApiClient.researchGetStatus();
            return { ok: true, data: status, source: "backend" };
          }
          // Fall back to local
          const status = aiManager?.getStatus();
          return { ok: true, data: status, source: "local" };
        } catch (error) {
          // Try local fallback if backend fails
          try {
            const status = aiManager?.getStatus();
            return { ok: true, data: status, source: "local-fallback" };
          } catch (fallbackError) {
            return { ok: false, error: (fallbackError as Error).message };
          }
        }
      },
    );

    ipcMain.handle("ai:runtime:check", async () => {
      console.log(
        "[main] IPC: ai:runtime:check called, aiManager ready:",
        !!aiManager,
      );
      if (!aiManager) {
        console.warn(
          "[main] IPC: ai:runtime:check - aiManager not initialized yet",
        );
        return { available: false, message: "AI manager initializing..." };
      }
      try {
        const result = await aiManager.checkRuntime();
        console.log("[main] IPC: ai:runtime:check result:", result);
        return result;
      } catch (err) {
        console.error("[main] IPC: ai:runtime:check error:", err);
        return { available: false, message: String(err) };
      }
    });

    ipcMain.handle("ai:models:list", async () => {
      console.log(
        "[main] IPC: ai:models:list called, aiManager ready:",
        !!aiManager,
      );
      if (!aiManager) {
        console.warn(
          "[main] IPC: ai:models:list - aiManager not initialized yet",
        );
        return { ok: false, error: "AI manager initializing...", models: [] };
      }
      try {
        const result = await aiManager.listLocalModels();
        console.log("[main] IPC: ai:models:list result:", result);
        return result;
      } catch (err) {
        console.error("[main] IPC: ai:models:list error:", err);
        return { ok: false, error: String(err), models: [] };
      }
    });

    ipcMain.handle(
      "ai:model:test",
      async (
        _e,
        payload: { provider?: string; model: string; apiKey?: string },
      ) => {
        if (!aiManager) {
          return { ok: false, message: "AI manager initializing..." };
        }
        try {
          return await aiManager.testModelConnection(payload);
        } catch (err) {
          return {
            ok: false,
            message: err instanceof Error ? err.message : String(err),
          };
        }
      },
    );

    ipcMain.handle(
      "aiSteward:getOverview",
      async (_e, { authToken }: { authToken?: string } = {}) => {
        try {
          // Try backend first
          if (await bindBackendToken(authToken)) {
            const [overviewSummary, config, modulesHealth, findings, tasks] =
              await Promise.all([
                backendApiClient.stewardGetOverview(),
                backendApiClient.stewardGetConfig(),
                backendApiClient.stewardGetHealth(),
                backendApiClient.stewardGetFindings(),
                backendApiClient.stewardGetTasks(),
              ]);

            const overviewSummaryData =
              (overviewSummary as { lastCheck?: string } | null) ?? null;
            const configData =
              (config as {
                autoApply?: boolean;
                checkIntervalSec?: number;
                modulesEnabled?: { cftc?: boolean; congress?: boolean };
              } | null) ?? null;
            const modulesHealthData =
              (modulesHealth as {
                modules?: Array<{
                  module: string;
                  state: string;
                  probableCause?: string;
                  lastSeenAt?: string;
                }>;
              } | null) ?? null;
            const findingsData = Array.isArray(findings)
              ? (findings as Array<{
                  id: string;
                  module: string;
                  severity: string;
                  title: string;
                  description: string;
                  createdAt?: string;
                }>)
              : [];
            const tasksData = Array.isArray(tasks)
              ? (tasks as Array<{
                  id: string;
                  type?: string;
                  title: string;
                  description: string;
                  status: string;
                  createdAt?: string;
                }>)
              : [];

            const normalizedOverview = {
              config: {
                model: "deepseek-r1:14b",
                checkIntervalMinutes: Math.max(
                  5,
                  Math.floor(Number(configData?.checkIntervalSec ?? 1800) / 60),
                ),
                autoFixData: Boolean(configData?.autoApply),
                modules: {
                  cftc: {
                    mode: configData?.modulesEnabled?.cftc ? "suggest" : "off",
                  },
                  congress: {
                    mode: configData?.modulesEnabled?.congress
                      ? "suggest"
                      : "off",
                  },
                },
              },
              modules:
                modulesHealthData?.modules?.map((module) => ({
                  module: module.module,
                  status:
                    module.state === "ok"
                      ? "ok"
                      : module.state === "unavailable"
                        ? "failing"
                        : "degraded",
                  summary: module.probableCause ?? "No summary available",
                  lastRunAt: module.lastSeenAt
                    ? Date.parse(module.lastSeenAt)
                    : undefined,
                  lastSuccessAt:
                    module.state === "ok" && module.lastSeenAt
                      ? Date.parse(module.lastSeenAt)
                      : undefined,
                })) ?? [],
              findings:
                findingsData.map((finding) => ({
                  id: finding.id,
                  module: finding.module,
                  severity:
                    finding.severity === "critical"
                      ? "error"
                      : finding.severity === "warning"
                        ? "warn"
                        : "info",
                  title: finding.title,
                  detail: finding.description,
                  detectedAt: finding.createdAt
                    ? Date.parse(finding.createdAt)
                    : Date.now(),
                  meta: {},
                })) ?? [],
              tasks:
                tasksData.map((task) => ({
                  id: task.id,
                  module: (task.type?.split(":")?.[0] ?? "cftc") as
                    | "cftc"
                    | "congress",
                  kind: task.type ?? "manual:task",
                  title: task.title,
                  summary: task.description,
                  severity: "warn",
                  autoApplicable: false,
                  status:
                    task.status === "applied"
                      ? "completed"
                      : task.status === "rejected"
                        ? "failed"
                        : task.status,
                  createdAt: task.createdAt
                    ? Date.parse(task.createdAt)
                    : Date.now(),
                  updatedAt: task.createdAt
                    ? Date.parse(task.createdAt)
                    : Date.now(),
                  result: task.status,
                })) ?? [],
              lastCheckAt: overviewSummaryData?.lastCheck
                ? Date.parse(overviewSummaryData.lastCheck)
                : Date.now(),
            };

            const supportedModules = new Set(["cftc", "congress"]);
            normalizedOverview.modules = normalizedOverview.modules.filter(
              (module) => supportedModules.has(module.module),
            );
            normalizedOverview.findings = normalizedOverview.findings.filter(
              (finding) => supportedModules.has(finding.module),
            );
            normalizedOverview.tasks = normalizedOverview.tasks.filter((task) =>
              supportedModules.has(task.module),
            );

            return { ok: true, data: normalizedOverview, source: "backend" };
          }
          // Fall back to local
          const overview = aiStewardService?.getOverview() ?? null;
          return { ok: true, data: overview, source: "local" };
        } catch (error) {
          // Try local fallback if backend fails
          try {
            const overview = aiStewardService?.getOverview() ?? null;
            return { ok: true, data: overview, source: "local-fallback" };
          } catch (fallbackError) {
            return { ok: false, error: (fallbackError as Error).message };
          }
        }
      },
    );

    ipcMain.handle(
      "aiSteward:getConfig",
      async (_e, { authToken }: { authToken?: string } = {}) => {
        try {
          // Try backend first
          if (await bindBackendToken(authToken)) {
            const config = await backendApiClient.stewardGetConfig();
            const configData =
              (config as {
                autoApply?: boolean;
                checkIntervalSec?: number;
                modulesEnabled?: { cftc?: boolean; congress?: boolean };
              } | null) ?? null;

            const normalizedConfig = {
              model: "deepseek-r1:14b",
              checkIntervalMinutes: Math.max(
                5,
                Math.floor(Number(configData?.checkIntervalSec ?? 1800) / 60),
              ),
              autoFixData: Boolean(configData?.autoApply),
              modules: {
                cftc: {
                  mode: configData?.modulesEnabled?.cftc ? "suggest" : "off",
                },
                congress: {
                  mode: configData?.modulesEnabled?.congress
                    ? "suggest"
                    : "off",
                },
              },
            };

            return { ok: true, data: normalizedConfig, source: "backend" };
          }
          // Fall back to local
          const config = aiStewardService?.getConfig() ?? null;
          return { ok: true, data: config, source: "local" };
        } catch (error) {
          // Try local fallback if backend fails
          try {
            const config = aiStewardService?.getConfig() ?? null;
            return { ok: true, data: config, source: "local-fallback" };
          } catch (fallbackError) {
            return { ok: false, error: (fallbackError as Error).message };
          }
        }
      },
    );

    ipcMain.handle(
      "aiSteward:getHealth",
      async (_e, { authToken }: { authToken?: string } = {}) => {
        try {
          if (await bindBackendToken(authToken)) {
            const health = await backendApiClient.stewardGetHealth();
            return { ok: true, data: health, source: "backend" };
          }

          const overview = aiStewardService?.getOverview();
          const fallbackHealth = {
            generatedAt: new Date().toISOString(),
            overall: {
              state: overview
                ? ("degraded" as const)
                : ("unavailable" as const),
              severity: overview ? ("warning" as const) : ("critical" as const),
              score: overview ? 60 : 0,
            },
            incidents: {
              totalOpen: overview?.findings?.length ?? 0,
              bySeverity: {
                info:
                  overview?.findings?.filter(
                    (finding) => finding.severity === "info",
                  ).length ?? 0,
                warning:
                  overview?.findings?.filter(
                    (finding) => finding.severity === "warn",
                  ).length ?? 0,
                high: 0,
                critical:
                  overview?.findings?.filter(
                    (finding) => finding.severity === "error",
                  ).length ?? 0,
              },
              pendingTasks:
                overview?.tasks?.filter((task) => task.status === "pending")
                  .length ?? 0,
            },
            runtime: {
              queueDepth: 0,
              queueRunning: 0,
              migrationFlags,
            },
            modules:
              overview?.modules?.map((module) => ({
                module: module.module,
                state:
                  module.status === "ok"
                    ? "ok"
                    : module.status === "failing"
                      ? "unavailable"
                      : "degraded",
                severity:
                  module.status === "ok"
                    ? "info"
                    : module.status === "failing"
                      ? "critical"
                      : "warning",
                lastSeenAt: module.lastRunAt
                  ? new Date(module.lastRunAt).toISOString()
                  : undefined,
                probableCause: module.summary,
                attemptedRepairs: [],
                owner: "system" as const,
              })) ?? [],
          };

          return { ok: true, data: fallbackHealth, source: "local" };
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );

    ipcMain.handle(
      "aiSteward:getIncidentDigest",
      async (_e, { authToken }: { authToken?: string } = {}) => {
        try {
          if (await bindBackendToken(authToken)) {
            const digest = await backendApiClient.stewardGetIncidentDigest();
            const digestData =
              (digest as {
                generatedAt?: string;
                summary?: {
                  totalOpenIncidents?: number;
                  criticalOpenIncidents?: number;
                  incidentsLast24h?: number;
                };
                topIncidents?: Array<{
                  id?: string;
                  title?: string;
                  severity?: string;
                  category?: string;
                  module?: string;
                  detectedAt?: string;
                  status?: string;
                }>;
                recommendations?: string[];
              } | null) ?? null;

            const normalized = {
              generatedAt: digestData?.generatedAt ?? new Date().toISOString(),
              summary: {
                totalOpenIncidents: Math.max(
                  0,
                  Number(digestData?.summary?.totalOpenIncidents ?? 0),
                ),
                criticalOpenIncidents: Math.max(
                  0,
                  Number(digestData?.summary?.criticalOpenIncidents ?? 0),
                ),
                incidentsLast24h: Math.max(
                  0,
                  Number(digestData?.summary?.incidentsLast24h ?? 0),
                ),
              },
              topIncidents: Array.isArray(digestData?.topIncidents)
                ? digestData.topIncidents
                    .map((incident) => ({
                      id: String(incident.id ?? ""),
                      title: String(incident.title ?? "Untitled incident"),
                      severity:
                        incident.severity === "critical" ||
                        incident.severity === "high" ||
                        incident.severity === "medium"
                          ? incident.severity
                          : "low",
                      category:
                        incident.category === "category_1" ||
                        incident.category === "category_2" ||
                        incident.category === "category_3"
                          ? incident.category
                          : "category_4",
                      module: ["cftc", "congress"].includes(
                        String(incident.module),
                      )
                        ? String(incident.module)
                        : "cftc",
                      detectedAt:
                        incident.detectedAt ?? new Date().toISOString(),
                      status:
                        incident.status === "dismissed" ||
                        incident.status === "resolved" ||
                        incident.status === "in_progress"
                          ? incident.status
                          : "open",
                    }))
                    .filter((incident) => incident.id.length > 0)
                : [],
              recommendations: Array.isArray(digestData?.recommendations)
                ? digestData.recommendations.filter(
                    (item): item is string =>
                      typeof item === "string" && item.trim().length > 0,
                  )
                : [],
            };
            return { ok: true, data: normalized, source: "backend" };
          }

          const overview = aiStewardService?.getOverview();
          const nowIso = new Date().toISOString();
          const findings = overview?.findings ?? [];
          const fallbackDigest = {
            generatedAt: nowIso,
            summary: {
              totalOpenIncidents: findings.length,
              criticalOpenIncidents: findings.filter(
                (finding) => finding.severity === "error",
              ).length,
              incidentsLast24h: findings.filter(
                (finding) =>
                  Date.now() - finding.detectedAt <= 24 * 60 * 60 * 1000,
              ).length,
            },
            topIncidents: findings.slice(0, 5).map((finding) => ({
              id: finding.id,
              title: finding.title,
              severity:
                finding.severity === "error"
                  ? "critical"
                  : finding.severity === "warn"
                    ? "medium"
                    : "low",
              category: "category_1" as const,
              module: finding.module,
              detectedAt: new Date(finding.detectedAt).toISOString(),
              status: "open" as const,
            })),
            recommendations: [
              "Run deterministic health check and review top incidents.",
            ],
          };
          return { ok: true, data: fallbackDigest, source: "local" };
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );

    ipcMain.handle(
      "aiSteward:getFindings",
      async (
        _e,
        { module, authToken }: { module?: string; authToken?: string } = {},
      ) => {
        try {
          if (await bindBackendToken(authToken)) {
            const findings = await backendApiClient.stewardGetFindings(module);
            const findingsData = Array.isArray(findings)
              ? (findings as Array<{
                  id: string;
                  module: string;
                  severity: string;
                  title: string;
                  description: string;
                  createdAt?: string;
                }>)
              : [];
            const normalized = findingsData
              .map((finding) => ({
                id: finding.id,
                module: finding.module,
                severity:
                  finding.severity === "critical"
                    ? "error"
                    : finding.severity === "warning"
                      ? "warn"
                      : "info",
                title: finding.title,
                detail: finding.description,
                detectedAt: finding.createdAt
                  ? Date.parse(finding.createdAt)
                  : Date.now(),
                meta: {},
              }))
              .filter((finding) =>
                ["cftc", "congress"].includes(String(finding.module)),
              );
            return { ok: true, data: normalized, source: "backend" };
          }

          const fallbackFindings =
            aiStewardService?.getOverview()?.findings ?? [];
          return { ok: true, data: fallbackFindings, source: "local" };
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );

    ipcMain.handle(
      "aiSteward:getTasks",
      async (_e, { authToken }: { authToken?: string } = {}) => {
        try {
          if (await bindBackendToken(authToken)) {
            const tasks = await backendApiClient.stewardGetTasks();
            const tasksData = Array.isArray(tasks)
              ? (tasks as Array<{
                  id: string;
                  type?: string;
                  title: string;
                  description: string;
                  status: string;
                  createdAt?: string;
                }>)
              : [];
            const normalized = tasksData
              .map((task) => ({
                id: task.id,
                module: (task.type?.split(":")?.[0] ?? "cftc") as
                  | "cftc"
                  | "congress",
                kind: task.type ?? "manual:task",
                title: task.title,
                summary: task.description,
                severity: "warn" as const,
                autoApplicable: false,
                status:
                  task.status === "applied"
                    ? "completed"
                    : task.status === "rejected"
                      ? "failed"
                      : task.status,
                createdAt: task.createdAt
                  ? Date.parse(task.createdAt)
                  : Date.now(),
                updatedAt: task.createdAt
                  ? Date.parse(task.createdAt)
                  : Date.now(),
                result: task.status,
              }))
              .filter((task) => ["cftc", "congress"].includes(task.module));
            return { ok: true, data: normalized, source: "backend" };
          }

          const fallbackTasks = aiStewardService?.getOverview()?.tasks ?? [];
          return { ok: true, data: fallbackTasks, source: "local" };
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );

    ipcMain.handle(
      "aiSteward:dismissFinding",
      async (
        _e,
        {
          findingId,
          authToken,
        }: { findingId?: string; authToken?: string } = {},
      ) => {
        if (!findingId) {
          return { ok: false, error: "missing_finding_id" };
        }

        try {
          if (await bindBackendToken(authToken)) {
            const result =
              await backendApiClient.stewardDismissFinding(findingId);
            return { ok: true, data: result, source: "backend" };
          }

          return { ok: false, error: "dismiss_not_supported_in_local_mode" };
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );

    ipcMain.handle(
      "aiSteward:checkHealth",
      async (_e, { authToken }: { authToken?: string } = {}) => {
        try {
          if (await bindBackendToken(authToken)) {
            const result = await backendApiClient.stewardCheckHealth();
            return { ok: true, data: result, source: "backend" };
          }

          await aiStewardService?.runModule("cftc");
          await aiStewardService?.runModule("congress");
          return { ok: true, source: "local" };
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );

    ipcMain.handle(
      "aiSteward:setConfig",
      async (
        _e,
        {
          patch,
          authToken,
        }: { patch?: Partial<AiStewardConfig>; authToken?: string } = {},
      ) => {
        if (!aiStewardService && !backendApiClient)
          return { ok: false, error: "AI steward not ready" };
        const localPatch = (patch ?? {}) as Partial<AiStewardConfig>;
        const backendPatchSource =
          (patch as {
            autoFixData?: boolean;
            checkIntervalMinutes?: number;
            modules?: {
              cftc?: { mode?: string };
              congress?: { mode?: string };
            };
          } | null) ?? null;
        try {
          const backendPatch = {
            autoApply:
              typeof backendPatchSource?.autoFixData === "boolean"
                ? backendPatchSource.autoFixData
                : undefined,
            checkIntervalSec:
              typeof backendPatchSource?.checkIntervalMinutes === "number"
                ? Math.max(
                    300,
                    Math.floor(backendPatchSource.checkIntervalMinutes * 60),
                  )
                : undefined,
            modulesEnabled: backendPatchSource?.modules
              ? {
                  cftc: backendPatchSource.modules.cftc?.mode !== "off",
                  congress: backendPatchSource.modules.congress?.mode !== "off",
                }
              : undefined,
          };

          // Try backend first
          if (await bindBackendToken(authToken)) {
            const result =
              await backendApiClient.stewardSetConfig(backendPatch);
            return { ok: true, data: result, source: "backend" };
          }
          // Fall back to local
          const result = aiStewardService?.setConfig(localPatch);
          return { ok: true, data: result, source: "local" };
        } catch (error) {
          // Try local fallback if backend fails
          try {
            const result = aiStewardService?.setConfig(localPatch);
            return { ok: true, data: result, source: "local-fallback" };
          } catch (fallbackError) {
            return { ok: false, error: (fallbackError as Error).message };
          }
        }
      },
    );

    ipcMain.handle(
      "aiSteward:runModule",
      async (
        _e,
        {
          module,
          authToken,
        }: { module?: AiStewardModule; authToken?: string } = {},
      ) => {
        if (!aiStewardService && !backendApiClient)
          return { ok: false, error: "AI steward not ready" };
        try {
          // Try backend first
          if (module && (await bindBackendToken(authToken))) {
            const result = await backendApiClient.stewardRunModule(module);
            return { ok: true, data: result, source: "backend" };
          }
          // Fall back to local
          if (module) {
            await aiStewardService!.runModule(module);
          }
          return { ok: true, source: "local" };
        } catch (error) {
          // Try local fallback if backend fails
          try {
            if (module) {
              await aiStewardService!.runModule(module);
            }
            return { ok: true, source: "local-fallback" };
          } catch (fallbackError) {
            return { ok: false, message: (fallbackError as Error).message };
          }
        }
      },
    );

    ipcMain.handle(
      "aiSteward:applyTask",
      async (
        _e,
        { taskId, authToken }: { taskId?: string; authToken?: string } = {},
      ) => {
        if (!aiStewardService && !backendApiClient)
          return { ok: false, message: "AI steward not ready" };
        try {
          // Try backend first
          if (taskId && (await bindBackendToken(authToken))) {
            const result = await backendApiClient.stewardApplyTask(taskId);
            return { ok: true, data: result, source: "backend" };
          }
          // Fall back to local
          if (taskId) {
            const result = await aiStewardService!.applyTask(taskId);
            return { ok: true, data: result, source: "local" };
          }
          return { ok: false, message: "No taskId provided" };
        } catch (error) {
          // Try local fallback if backend fails
          try {
            if (taskId) {
              const result = await aiStewardService!.applyTask(taskId);
              return { ok: true, data: result, source: "local-fallback" };
            }
            return { ok: false, message: "No taskId provided" };
          } catch (fallbackError) {
            return { ok: false, message: (fallbackError as Error).message };
          }
        }
      },
    );

    ipcMain.handle("aiSteward:test", async (_e, prompt?: string) => {
      if (!aiStewardService)
        return { ok: false, message: "AI steward not ready" };
      try {
        const response = await aiStewardService.testResponse(prompt);
        return { ok: true, response };
      } catch (err) {
        return {
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    });

    // --- Central AI Orchestrator IPC handlers ---
    ipcMain.handle(
      "centralAI:track",
      async (
        _e,
        { type = "symbol_search", symbol, action, authToken }: any = {},
      ) => {
        try {
          // Try backend first
          if (await bindBackendToken(authToken)) {
            await backendApiClient.orchestratorTrackInteraction(type, symbol, {
              action,
              timestamp: new Date().toISOString(),
            });
            return { success: true, source: "backend" };
          }
          // Fall back to local
          centralAI.trackInteraction({
            type: type as
              | "symbol_search"
              | "supply_chain_view"
              | "intelligence_read"
              | "portfolio_add"
              | "portfolio_remove"
              | "trade_executed",
            symbol: symbol as string | undefined,
            timestamp: Date.now(),
            metadata: action ? { action } : undefined,
          } as UserInteraction);
          return { success: true, source: "local" };
        } catch (error) {
          // Try local fallback
          try {
            centralAI.trackInteraction({
              type: type as
                | "symbol_search"
                | "supply_chain_view"
                | "intelligence_read"
                | "portfolio_add"
                | "portfolio_remove"
                | "trade_executed",
              symbol: symbol as string | undefined,
              timestamp: Date.now(),
              metadata: action ? { action } : undefined,
            } as UserInteraction);
            return { success: true, source: "local-fallback" };
          } catch (fallbackError) {
            console.error("[main] centralAI:track error", fallbackError);
            return { success: false, error: String(fallbackError) };
          }
        }
      },
    );

    ipcMain.handle(
      "centralAI:predict",
      async (
        _e,
        { limit, authToken }: { limit?: number; authToken?: string } = {},
      ) => {
        try {
          // Try backend first
          if (await bindBackendToken(authToken)) {
            const predictions =
              await backendApiClient.orchestratorGetPredictions();
            return { success: true, predictions, source: "backend" };
          }
          // Fall back to local
          const predictions = centralAI.predictNextSymbols(limit ?? 5);
          return { success: true, predictions, source: "local" };
        } catch (error) {
          // Try local fallback
          try {
            const predictions = centralAI.predictNextSymbols(limit ?? 5);
            return { success: true, predictions, source: "local-fallback" };
          } catch (fallbackError) {
            console.error("[main] centralAI:predict error", fallbackError);
            return { success: false, error: String(fallbackError) };
          }
        }
      },
    );

    ipcMain.handle(
      "centralAI:validate",
      async (_e, response: string, context: any) => {
        try {
          const result = await centralAI.validateAIResponse(response, context);
          return { success: true, ...result };
        } catch (err) {
          console.error("[main] centralAI:validate error", err);
          return { success: false, error: String(err) };
        }
      },
    );

    // --- Economic Calendar AI handlers ---
    ipcMain.handle(
      "economicCalendar:insights",
      async (
        _e,
        payload: {
          request: CalendarInsightRequest;
          preference?: EnginePreference;
          authToken?: string;
        },
      ) => {
        try {
          if (await bindBackendToken(payload.authToken)) {
            const result = await backendApiClient.economicCalendarGetInsights(
              payload.request,
            );
            return { success: true, result, source: "backend" };
          }
          if (!canUseLocalFallback()) {
            return {
              success: false,
              error: "backend_only_processing_enabled",
              source: "backend-required",
            };
          }
          const result = await generateEconomicCalendarInsights(
            payload.request,
            {
              preference: payload.preference,
            },
          );
          return { success: true, result, source: "local" };
        } catch (err) {
          console.error("[main] economicCalendar:insights error", err);
          if (!canUseLocalFallback()) {
            return {
              success: false,
              error: String(err),
              source: "backend-required",
            };
          }
          try {
            const result = await generateEconomicCalendarInsights(
              payload.request,
              {
                preference: payload.preference,
              },
            );
            return { success: true, result, source: "local-fallback" };
          } catch (fallbackErr) {
            return { success: false, error: String(fallbackErr) };
          }
        }
      },
    );

    ipcMain.handle("centralAI:getIntelligence", () => {
      try {
        return {
          success: true,
          intelligence: centralAI.getPersonalizedIntelligence(),
        };
      } catch (err) {
        console.error("[main] centralAI:getIntelligence error", err);
        return { success: false, error: String(err) };
      }
    });

    ipcMain.handle("centralAI:getStats", () => {
      try {
        return { success: true, stats: centralAI.getStats() };
      } catch (err) {
        console.error("[main] centralAI:getStats error", err);
        return { success: false, error: String(err) };
      }
    });

    // --- Supply Chain IPC handlers ---
    ipcMain.handle(
      "supplyChain:generate",
      async (
        _e,
        options: {
          ticker: string;
          globalTickers?: string[];
          strictMode?: boolean;
          includeHypothesis?: boolean;
          hops?: number;
          minEdgeWeight?: number;
          refresh?: boolean;
          authToken?: string;
        },
      ) => {
        const runLocalSupplyChain = async (
          source: "local" | "local-fallback",
        ) => {
          const {
            generateOfficialSupplyChain,
          } = require("./services/supplyChain/officialSupplyChain");
          const { AiResearchRepo } = require("./persistence/aiResearchRepo");

          // Get globally configured AI model from settings
          const config = AiResearchRepo.getConfig();
          const model = config?.model || "deepseek-r1:14b";

          console.log(
            `[supplyChain] Generating for ${options.ticker} using model: ${model}`,
          );

          const result = await generateOfficialSupplyChain(model, {
            ticker: options.ticker,
            globalTickers: options.globalTickers,
            strictMode: options.strictMode,
            includeHypothesis: options.includeHypothesis,
            hops: options.hops,
            minEdgeWeight: options.minEdgeWeight,
            refresh: options.refresh,
          });

          try {
            await graphEnrichmentService.ingestMindMapResult({
              mindMapData: result.data,
              queryUsage: {
                queryText: `supplychain:${options.ticker.toUpperCase()}`,
                queryCluster: options.globalTickers?.length
                  ? "global_supply_chain"
                  : "supply_chain",
                cacheHit: result.fromCache,
              },
            });
          } catch (enrichmentErr) {
            console.warn(
              "[main] graph enrichment ingest warning",
              enrichmentErr,
            );
          }

          console.log(
            `[supplyChain] Generated successfully for ${options.ticker}`,
          );
          return {
            success: true,
            data: result.data,
            fromCache: result.fromCache,
            needsRefresh: result.needsRefresh,
            source,
          };
        };

        try {
          if (await bindBackendToken(options.authToken)) {
            try {
              const backendResult =
                await backendApiClient.supplyChainGenerateMap(options.ticker, {
                  globalTickers: options.globalTickers,
                  includeHypothesis: options.includeHypothesis,
                  hops: options.hops,
                });

              try {
                const maybeData = (backendResult as Record<string, unknown>)
                  ?.data as unknown;
                if (maybeData && typeof maybeData === "object") {
                  await graphEnrichmentService.ingestMindMapResult({
                    mindMapData:
                      maybeData as import("@tc/shared/supplyChain").MindMapData,
                    queryUsage: {
                      queryText: `supplychain:${options.ticker.toUpperCase()}`,
                      queryCluster: options.globalTickers?.length
                        ? "global_supply_chain"
                        : "supply_chain",
                      cacheHit: false,
                    },
                  });
                }
              } catch (enrichmentErr) {
                console.warn(
                  "[main] graph enrichment backend ingest warning",
                  enrichmentErr,
                );
              }

              return {
                success: true,
                ...((backendResult as Record<string, unknown>) ?? {}),
                source: "backend",
              };
            } catch (backendError) {
              console.warn(
                "[main] supplyChain:generate backend failed, attempting local fallback",
                backendError,
              );
              if (!canUseLocalFallback()) {
                return {
                  success: false,
                  error: String(backendError),
                  fromCache: false,
                  source: "backend-required",
                };
              }
              return await runLocalSupplyChain("local-fallback");
            }
          }

          if (!canUseLocalFallback()) {
            return {
              success: false,
              error: "backend_only_processing_enabled",
              fromCache: false,
              source: "backend-required",
            };
          }
          return await runLocalSupplyChain("local");
        } catch (err) {
          console.error("[main] supplyChain:generate error:", err);
          if (!canUseLocalFallback()) {
            return {
              success: false,
              error: String(err),
              fromCache: false,
              source: "backend-required",
            };
          }
          return {
            success: false,
            error: String(err),
            fromCache: false,
          };
        }
      },
    );

    ipcMain.handle("supplyChain:clearCache", (_e, ticker: string) => {
      try {
        const {
          SupplyChainGraphRepo,
        } = require("./persistence/supplyChainGraphRepo");
        SupplyChainGraphRepo.clearEgoGraphCache(ticker);
        return { success: true };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    });

    ipcMain.handle("supplyChain:openGlobalMap", (_e, tickers: string[]) => {
      try {
        const sanitized = Array.isArray(tickers) ? tickers.filter(Boolean) : [];
        if (sanitized.length === 0)
          return { success: false, error: "No tickers provided" };
        openSupplyChainGlobalWindow(sanitized);
        return { success: true };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    });

    ipcMain.handle("supplyChain:listCached", () => {
      try {
        const {
          SupplyChainGraphRepo,
        } = require("./persistence/supplyChainGraphRepo");
        return {
          success: true,
          tickers: SupplyChainGraphRepo.listCachedTickers(),
        };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    });

    ipcMain.handle("graphEnrichment:getInspector", async () => {
      try {
        return {
          success: true,
          data: await graphEnrichmentService.getInspector(),
        };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    });

    ipcMain.handle("graphEnrichment:exportSnapshot", async () => {
      try {
        return {
          success: true,
          data: await graphEnrichmentService.exportSnapshot(),
        };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    });

    ipcMain.handle("graphEnrichment:getSyncStatus", async () => {
      try {
        return {
          success: true,
          data: await graphEnrichmentService.getSyncStatus(),
        };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    });

    ipcMain.handle(
      "graphEnrichment:getCachedSubgraph",
      async (_e, payload: { query: string; hops?: number }) => {
        try {
          return {
            success: true,
            data: await graphEnrichmentService.getCachedSubgraph(
              payload?.query ?? "",
              payload?.hops ?? 1,
            ),
          };
        } catch (err) {
          return { success: false, error: String(err) };
        }
      },
    );

    ipcMain.handle("graphEnrichment:runMaintenance", async () => {
      try {
        return {
          success: true,
          data: await graphEnrichmentService.runMaintenance(),
        };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    });

    ipcMain.handle("graphMemory:getDashboard", async () => {
      try {
        return {
          success: true,
          data: await graphMemoryService.getDashboard(),
        };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    });

    ipcMain.handle("graphMemory:getSection", async (_e, payload) => {
      try {
        return {
          success: true,
          data: await graphMemoryService.getSection(
            payload ?? { section: "overview" },
          ),
        };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    });

    ipcMain.handle("graphMemory:getDetail", async (_e, payload) => {
      try {
        return {
          success: true,
          data: await graphMemoryService.getDetail(
            payload ?? { section: "overview", id: "" },
          ),
        };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    });

    ipcMain.handle("graphMemory:refresh", async () => {
      try {
        return {
          success: true,
          data: await graphMemoryService.refresh(),
        };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    });

    ipcMain.handle("graphMemory:revalidateSelected", async (_e, payload) => {
      try {
        return {
          success: true,
          data: await graphMemoryService.revalidateSelected(
            payload ?? { records: [] },
          ),
        };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    });

    ipcMain.handle("graphMemory:exportNow", async () => {
      try {
        return {
          success: true,
          data: await graphMemoryService.exportNow(),
        };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    });

    ipcMain.handle("graphMemory:getExportsManifest", async () => {
      try {
        return {
          success: true,
          data: await graphMemoryService.getExportsManifest(),
        };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    });

    ipcMain.handle("graphMemory:openLatestSnapshot", async () => {
      try {
        const latestPath = await graphMemoryService.getLatestSnapshotPath();
        if (!latestPath) {
          return { success: false, error: "no_snapshot_found" };
        }
        await shell.openPath(latestPath);
        return { success: true, data: { path: latestPath } };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    });

    ipcMain.handle("graphMemory:revealPath", async (_e, payload) => {
      try {
        const targetPath =
          typeof payload?.path === "string" ? payload.path : "";
        if (!targetPath) {
          return { success: false, error: "missing_path" };
        }
        shell.showItemInFolder(targetPath);
        return { success: true };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    });

    ipcMain.handle("supplyChain:advisorAsk", async (_e, payload) => {
      try {
        const { AiResearchRepo } = require("./persistence/aiResearchRepo");
        const {
          askSupplyChainAdvisor,
        } = require("./services/supplyChain/ollamaSupplyChain");
        const config = AiResearchRepo.getConfig();
        const model = config?.model || "deepseek-r1:14b";
        return await askSupplyChainAdvisor(model, payload);
      } catch (err) {
        console.error("[main] supplyChain:advisorAsk error", err);
        return { success: false, error: String(err) };
      }
    });

    // --- GWMD Map IPC handlers ---
    ipcMain.handle(
      "gwmdMap:search",
      async (
        _e,
        payload: {
          ticker: string;
          model: any;
          hops?: number;
          refresh?: boolean;
          sourceMode?: "cache_only" | "hybrid" | "fresh";
        },
      ) => {
        try {
          const {
            companyRelationshipService,
          } = require("./services/GWMD/companyRelationshipService");

          console.log(
            `[gwmdMap] Searching for relationships: ${payload.ticker}`,
          );

          const result = await companyRelationshipService.generateRelationships(
            payload.ticker,
            {
              model: payload.model,
              hops: payload.hops,
              refresh: payload.refresh,
            },
          );

          broadcastGwmdGraphUpdated();

          try {
            const {
              mapGwmdToMindMap,
            } = require("./services/GWMD/gwmdToMindMap");
            const mappedMindMapData = mapGwmdToMindMap(
              payload.ticker,
              result.companies,
              result.edges,
            );
            await graphEnrichmentService.ingestMindMapResult({
              mindMapData: mappedMindMapData,
              queryUsage: {
                queryText: `gwmd:${String(payload.ticker || "")
                  .trim()
                  .toUpperCase()}`,
                queryCluster: "gwmd_map",
                cacheHit: false,
              },
            });
          } catch (ingestErr) {
            console.warn("[gwmdMap] Graph enrichment ingest failed", ingestErr);
          }

          console.log(
            `[gwmdMap] Found ${result.companies.length} companies and ${result.edges.length} relationships`,
          );

          return {
            success: true,
            status: result.meta.status,
            companies: result.companies,
            edges: result.edges,
            meta: result.meta,
          };
        } catch (err) {
          console.error("[main] gwmdMap:search error", err);
          const message = err instanceof Error ? err.message : String(err);
          const status =
            err instanceof Error &&
            (err.name === "GwmdParseError" ||
              /parse|quality checks/i.test(err.message))
              ? "parse_fail"
              : "error";
          return {
            success: false,
            status,
            error: message,
            companies: [],
            edges: [],
          };
        }
      },
    );

    ipcMain.handle("gwmdMap:loadAll", async () => {
      try {
        const { gwmdMapRepo } = require("./persistence/gwmdMapRepo");
        const {
          companyRelationshipService,
        } = require("./services/GWMD/companyRelationshipService");

        try {
          const repair =
            await companyRelationshipService.repairMissingCoordinates(200);
          if (repair.updated > 0) {
            console.log(
              `[gwmdMap] Repaired ${repair.updated}/${repair.attempted} missing coordinates`,
            );
          }
        } catch (err) {
          console.warn("[gwmdMap] Repair missing coordinates failed", err);
        }

        const companies = gwmdMapRepo.getAllCompanies();
        const graph = gwmdMapRepo.buildGraph();

        return {
          success: true,
          status: "ok",
          companies,
          graph,
          meta: {
            source: "db_snapshot",
            unlocatedCount: companies.filter(
              (company: { hq_lat?: number | null; hq_lon?: number | null }) =>
                company.hq_lat == null || company.hq_lon == null,
            ).length,
          },
        };
      } catch (err) {
        console.error("[main] gwmdMap:loadAll error", err);
        return {
          success: false,
          status: "error",
          error: String(err),
          companies: [],
          graph: null,
        };
      }
    });

    ipcMain.handle(
      "gwmdMap:loadScoped",
      async (_e, payload: { ticker?: string } = {}) => {
        try {
          const ticker =
            typeof payload.ticker === "string" ? payload.ticker.trim() : "";
          if (!ticker) {
            return {
              success: false,
              status: "error",
              error: "Ticker is required",
              companies: [],
              graph: null,
            };
          }

          const { gwmdMapRepo } = require("./persistence/gwmdMapRepo");
          const {
            companyRelationshipService,
          } = require("./services/GWMD/companyRelationshipService");
          const scopedSnapshot = gwmdMapRepo.getScopedSnapshot(ticker);
          const graph = gwmdMapRepo.buildScopedGraph(ticker);

          // Run geo-repair in background so scoped cache users progressively gain map coverage.
          const scopedUnlocatedCount = scopedSnapshot.companies.filter(
            (company: { hq_lat?: number | null; hq_lon?: number | null }) =>
              company.hq_lat == null || company.hq_lon == null,
          ).length;
          if (scopedUnlocatedCount > 0) {
            void companyRelationshipService
              .repairMissingCoordinates(Math.min(scopedUnlocatedCount, 120))
              .then((repair: { attempted: number; updated: number }) => {
                if (repair.updated > 0) {
                  console.log(
                    `[gwmdMap] Scoped background geo-repair updated ${repair.updated}/${repair.attempted} companies for ${ticker.toUpperCase()}`,
                  );
                  broadcastGwmdGraphUpdated();
                }
              })
              .catch((repairError: unknown) => {
                console.warn(
                  "[gwmdMap] Scoped background geo-repair failed",
                  repairError,
                );
              });
          }

          return {
            success: true,
            status: "ok",
            companies: scopedSnapshot.companies,
            graph,
            meta: {
              source: "db_scoped_snapshot",
              focalTicker: ticker.toUpperCase(),
              unlocatedCount: scopedUnlocatedCount,
            },
          };
        } catch (err) {
          console.error("[main] gwmdMap:loadScoped error", err);
          return {
            success: false,
            status: "error",
            error: String(err),
            companies: [],
            graph: null,
          };
        }
      },
    );

    ipcMain.handle("gwmdMap:clear", async () => {
      try {
        const { gwmdMapRepo } = require("./persistence/gwmdMapRepo");
        gwmdMapRepo.clear();
        return { success: true };
      } catch (err) {
        console.error("[main] gwmdMap:clear error", err);
        return { success: false, error: String(err) };
      }
    });

    ipcMain.handle(
      "gwmdMap:repairGeo",
      async (_event, payload?: { limit?: number }) => {
        try {
          const {
            companyRelationshipService,
          } = require("./services/GWMD/companyRelationshipService");
          const limit =
            typeof payload?.limit === "number"
              ? Math.max(1, Math.min(500, payload.limit))
              : 200;
          const result =
            (await companyRelationshipService.repairMissingCoordinates(
              limit,
            )) as { attempted: number; updated: number };
          if (result.updated > 0) {
            broadcastGwmdGraphUpdated();
          }
          return {
            success: true,
            attempted: result.attempted,
            updated: result.updated,
          };
        } catch (err) {
          console.error("[main] gwmdMap:repairGeo error", err);
          return { success: false, error: String(err) };
        }
      },
    );

    ipcMain.handle(
      "gwmdMap:display:enter",
      (
        event,
        payload: {
          monitorIds?: number[];
          primaryMonitorId?: number | null;
          mode?: GwmdDisplayMode;
        } = {},
      ) => {
        const sourceWindow = BrowserWindow.fromWebContents(event.sender);
        return openGwmdDisplaySurface(sourceWindow ?? mainWindow, payload);
      },
    );

    ipcMain.handle("gwmdMap:display:selection:get", () => {
      return getGwmdDisplaySelection();
    });

    ipcMain.handle(
      "gwmdMap:display:selection:set",
      (
        _event,
        payload: {
          monitorIds?: number[];
          primaryMonitorId?: number | null;
          mode?: GwmdDisplayMode;
        } = {},
      ) => {
        return setGwmdDisplaySelection(payload);
      },
    );

    ipcMain.handle("gwmdMap:display:listMonitors", () => {
      return listGwmdMonitors();
    });

    ipcMain.handle("gwmdMap:display:exit", () => {
      return closeGwmdDisplaySurface();
    });

    ipcMain.handle("gwmdMap:display:getState", () => {
      return getGwmdDisplaySurfaceState();
    });

    ipcMain.handle("gwmdMap:display:enter:legacy", (event) => {
      const sourceWindow = BrowserWindow.fromWebContents(event.sender);
      return openGwmdDisplaySurface(sourceWindow ?? mainWindow);
    });

    ipcMain.handle(
      "gwmdMap:syncPush",
      async (
        _e,
        payload: {
          companies?: Array<{
            ticker: string;
            name: string;
            hq_lat?: number | null;
            hq_lon?: number | null;
            hq_city?: string | null;
            hq_country?: string | null;
            industry?: string | null;
            health_score?: number | null;
          }>;
          relationships?: Array<{
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
        } = {},
      ) => {
        try {
          if (
            !backendApiClient ||
            !(await bindBackendToken(payload.authToken))
          ) {
            return { success: false, error: "Authentication required" };
          }

          const companies = Array.isArray(payload.companies)
            ? payload.companies
            : [];
          const relationships = Array.isArray(payload.relationships)
            ? payload.relationships
            : [];

          const response = await backendApiClient.gwmdPushSync({
            companies,
            relationships,
            ...(payload.replace !== undefined
              ? { replace: payload.replace }
              : {}),
          });

          return {
            success: true,
            applied: response.applied,
            status: response.status,
            source: "backend",
          };
        } catch (err) {
          console.error("[main] gwmdMap:syncPush error", err);
          return { success: false, error: String(err) };
        }
      },
    );

    ipcMain.handle(
      "gwmdMap:syncPull",
      async (
        _e,
        payload: {
          since?: string;
          replace?: boolean;
          authToken?: string;
        } = {},
      ) => {
        try {
          if (
            !backendApiClient ||
            !(await bindBackendToken(payload.authToken))
          ) {
            return { success: false, error: "Authentication required" };
          }

          const response = await backendApiClient.gwmdPullSync(payload.since);
          const { gwmdMapRepo } = require("./persistence/gwmdMapRepo");
          const shouldReplace = payload.replace !== false;

          if (shouldReplace) {
            gwmdMapRepo.clear();
          }

          gwmdMapRepo.addCompanies(
            response.data.companies.map((company) => ({
              ticker: company.ticker,
              name: company.name,
              hq_lat: company.hq_lat ?? undefined,
              hq_lon: company.hq_lon ?? undefined,
              hq_city: company.hq_city ?? undefined,
              hq_country: company.hq_country ?? undefined,
              industry: company.industry ?? undefined,
              health_score: company.health_score ?? undefined,
            })),
          );

          gwmdMapRepo.addRelationships(
            response.data.relationships.map((relationship) => ({
              id: relationship.id,
              from_ticker: relationship.from_ticker,
              to_ticker: relationship.to_ticker,
              relation_type: relationship.relation_type,
              weight: relationship.weight ?? undefined,
              confidence: relationship.confidence ?? undefined,
              evidence: relationship.evidence ?? undefined,
            })),
          );

          broadcastGwmdGraphUpdated();

          return {
            success: true,
            pulled: {
              companies: response.data.companies.length,
              relationships: response.data.relationships.length,
            },
            status: response.status,
            source: "backend",
          };
        } catch (err) {
          console.error("[main] gwmdMap:syncPull error", err);
          return { success: false, error: String(err) };
        }
      },
    );

    ipcMain.handle(
      "gwmdMap:syncStatus",
      async (_e, payload: { authToken?: string } = {}) => {
        try {
          if (
            !backendApiClient ||
            !(await bindBackendToken(payload.authToken))
          ) {
            return { success: false, error: "Authentication required" };
          }

          const response = await backendApiClient.gwmdGetSyncStatus();
          return {
            success: true,
            status: response.status,
            source: "backend",
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (message.includes("gwmd_sync_unavailable_no_database")) {
            console.warn(
              "[main] gwmdMap:syncStatus unavailable (backend DB not configured)",
            );
          } else {
            console.error("[main] gwmdMap:syncStatus error", err);
          }
          return { success: false, error: String(err) };
        }
      },
    );

    // --- IPC handlers (Prompt 7: persistence) ---
    ipcMain.handle("cockpit:config:watchlists:list", async () => {
      if (backendApiClient) {
        try {
          const response = await backendApiClient.userListWatchlists();
          return response.items ?? [];
        } catch (error) {
          if (!canUseLocalFallback()) {
            throw error;
          }
        }
      }
      return WatchlistsRepo.list();
    });
    ipcMain.handle(
      "cockpit:config:watchlists:add",
      async (_e, symbol: string, note?: string) => {
        if (backendApiClient) {
          try {
            const item = await backendApiClient.userAddWatchlist(
              symbol,
              note ?? "",
            );
            AuditRepo.record(
              "watchlist.add",
              `symbol=${symbol},source=backend`,
            );
            return item;
          } catch (error) {
            if (!canUseLocalFallback()) {
              throw error;
            }
          }
        }

        const w = WatchlistsRepo.add(symbol, note ?? "");
        AuditRepo.record("watchlist.add", `symbol=${symbol}`);
        return w;
      },
    );
    ipcMain.handle(
      "cockpit:config:watchlists:update",
      async (_e, id: number, fields: { symbol?: string; note?: string }) => {
        if (backendApiClient) {
          try {
            const item = await backendApiClient.userUpdateWatchlist(id, fields);
            AuditRepo.record("watchlist.update", `id=${id},source=backend`);
            return item;
          } catch (error) {
            if (!canUseLocalFallback()) {
              throw error;
            }
          }
        }

        const w = WatchlistsRepo.update(id, fields) as any;
        if (w) AuditRepo.record("watchlist.update", `id=${id}`);
        return w;
      },
    );
    ipcMain.handle(
      "cockpit:config:watchlists:remove",
      async (_e, id: number) => {
        if (backendApiClient) {
          try {
            const result = await backendApiClient.userRemoveWatchlist(id);
            if (result.ok)
              AuditRepo.record("watchlist.remove", `id=${id},source=backend`);
            return result.ok;
          } catch (error) {
            if (!canUseLocalFallback()) {
              throw error;
            }
          }
        }

        const ok = WatchlistsRepo.remove(id);
        if (ok) AuditRepo.record("watchlist.remove", `id=${id}`);
        return ok;
      },
    );

    ipcMain.handle("cockpit:config:layouts:list", (_e, symbol?: string) => {
      return LayoutsRepo.list(symbol);
    });
    ipcMain.handle(
      "cockpit:config:layouts:setPreset",
      (_e, symbol: string, preset: string, data?: unknown) => {
        const res = LayoutsRepo.setPreset(symbol, preset, data);
        const settings = AppSettingsRepo.get();
        AppSettingsRepo.set({
          ...settings,
          layoutSelection: { symbol, preset },
        });
        AuditRepo.record(
          "layout.setPreset",
          `symbol=${symbol},preset=${preset}`,
        );
        return res;
      },
    );
    ipcMain.handle("cockpit:config:settings:get", async () => {
      if (backendApiClient) {
        try {
          const response = await backendApiClient.userGetSettings();
          return response.settings ?? {};
        } catch (error) {
          if (!canUseLocalFallback()) {
            throw error;
          }
        }
      }

      return AppSettingsRepo.get();
    });
    ipcMain.handle(
      "cockpit:config:settings:set",
      async (_e, next: Record<string, unknown>) => {
        if (backendApiClient) {
          try {
            await backendApiClient.userUpdateSettings(next);
            return true;
          } catch (error) {
            if (!canUseLocalFallback()) {
              throw error;
            }
          }
        }

        AppSettingsRepo.set(next);
        if (typeof next.backendUrl === "string") {
          rebuildBackendApiClient();
          const normalized = normalizeBackendUrl(next.backendUrl);
          if (normalized) {
            broadcastBackendUrlChanged(normalized);
          }
        }
        return true;
      },
    );
    ipcMain.handle("cockpit:config:backendUrl:get", async () => {
      return getBackendUrl();
    });
    ipcMain.handle(
      "cockpit:config:backendUrl:set",
      async (_e, nextUrl: string) => {
        const normalized = normalizeBackendUrl(nextUrl);
        if (!normalized) {
          throw new Error("invalid_backend_url");
        }

        const settings = AppSettingsRepo.get();
        AppSettingsRepo.set({ ...settings, backendUrl: normalized });
        rebuildBackendApiClient();
        broadcastBackendUrlChanged(normalized);
        return true;
      },
    );

    ipcMain.handle("cockpit:ted:config:get", async () => {
      const settings = AppSettingsRepo.get();
      const local = (settings.tedLiveConfig ?? {}) as Record<string, unknown>;
      const record = getTedApiHubRecord();
      const hubConfig = parseTedApiHubConfig(record);
      const apiKey = await readTedApiKeyFromStorage();
      const localConfig = {
        enabled:
          typeof hubConfig.enabled === "boolean"
            ? hubConfig.enabled
            : typeof local.enabled === "boolean"
              ? local.enabled
              : false,
        baseUrl:
          typeof hubConfig.baseUrl === "string"
            ? hubConfig.baseUrl
            : typeof local.baseUrl === "string"
              ? local.baseUrl
              : "",
        apiKey,
        authHeader:
          typeof hubConfig.authHeader === "string" &&
          hubConfig.authHeader.trim().length > 0
            ? hubConfig.authHeader
            : typeof local.authHeader === "string" &&
                local.authHeader.trim().length > 0
              ? local.authHeader
              : "x-api-key",
        timeoutMs:
          typeof hubConfig.timeoutMs === "number" &&
          Number.isFinite(hubConfig.timeoutMs)
            ? hubConfig.timeoutMs
            : typeof local.timeoutMs === "number" &&
                Number.isFinite(local.timeoutMs)
              ? local.timeoutMs
              : 12000,
        windowQueryParam:
          typeof hubConfig.windowQueryParam === "string" &&
          hubConfig.windowQueryParam.trim().length > 0
            ? hubConfig.windowQueryParam
            : typeof local.windowQueryParam === "string" &&
                local.windowQueryParam.trim().length > 0
              ? local.windowQueryParam
              : "window",
      };

      if (backendApiClient) {
        try {
          const remote = await backendApiClient.tedIntelGetConfig();
          return {
            ...remote,
            apiKey: localConfig.apiKey,
          };
        } catch (error) {
          if (!canUseLocalFallback()) {
            throw error;
          }
        }
      }

      return {
        enabled: localConfig.enabled,
        baseUrl: localConfig.baseUrl,
        hasApiKey: localConfig.apiKey.trim().length > 0,
        authHeader: localConfig.authHeader,
        timeoutMs: localConfig.timeoutMs,
        windowQueryParam: localConfig.windowQueryParam,
        apiKey: localConfig.apiKey,
      };
    });

    ipcMain.handle(
      "cockpit:ted:config:set",
      async (_e, next: Record<string, unknown>) => {
        const normalized = {
          enabled: typeof next?.enabled === "boolean" ? next.enabled : false,
          baseUrl: typeof next?.baseUrl === "string" ? next.baseUrl.trim() : "",
          apiKey: typeof next?.apiKey === "string" ? next.apiKey.trim() : "",
          authHeader:
            typeof next?.authHeader === "string" &&
            next.authHeader.trim().length > 0
              ? next.authHeader.trim()
              : "x-api-key",
          timeoutMs:
            typeof next?.timeoutMs === "number" &&
            Number.isFinite(next.timeoutMs)
              ? Math.max(1000, Math.round(next.timeoutMs))
              : 12000,
          windowQueryParam:
            typeof next?.windowQueryParam === "string" &&
            next.windowQueryParam.trim().length > 0
              ? next.windowQueryParam.trim()
              : "window",
        };

        const settings = AppSettingsRepo.get();
        AppSettingsRepo.set({
          ...settings,
          tedLiveConfig: {
            enabled: normalized.enabled,
            baseUrl: normalized.baseUrl,
            authHeader: normalized.authHeader,
            timeoutMs: normalized.timeoutMs,
            windowQueryParam: normalized.windowQueryParam,
          },
        });

        await writeTedApiKeyToStorage(normalized.apiKey);
        const tedHubRecord = buildTedApiHubRecord(
          normalized,
          getTedApiHubRecord(),
        );
        const snapshot = apiHubService.upsert(tedHubRecord);
        broadcastApiHubSnapshot(snapshot);

        if (backendApiClient) {
          try {
            const remote = await backendApiClient.tedIntelSetConfig(normalized);
            return {
              ...remote,
              apiKey: normalized.apiKey,
            };
          } catch (error) {
            if (!canUseLocalFallback()) {
              throw error;
            }
          }
        }

        return {
          enabled: normalized.enabled,
          baseUrl: normalized.baseUrl,
          hasApiKey: normalized.apiKey.length > 0,
          authHeader: normalized.authHeader,
          timeoutMs: normalized.timeoutMs,
          windowQueryParam: normalized.windowQueryParam,
          apiKey: normalized.apiKey,
        };
      },
    );

    ipcMain.handle(
      "cockpit:secrets:set",
      async (_e, account: string, secret: string, passphrase?: string) => {
        return setSecret(account, secret, passphrase);
      },
    );
    ipcMain.handle(
      "cockpit:secrets:get",
      async (_e, account: string, passphrase?: string) => {
        return getSecret(account, passphrase);
      },
    );

    // API Key Validation
    ipcMain.handle(
      "cockpit:apikey:validate",
      async (_e, provider: string, credentials: Record<string, string>) => {
        try {
          const { validateApiKey } = await import("./services/apiKeyValidator");
          return await validateApiKey(provider as any, credentials);
        } catch (err) {
          return {
            valid: false,
            message: `Validation error: ${err instanceof Error ? err.message : "Unknown error"}`,
          };
        }
      },
    );

    ipcMain.handle(
      "cockpit:apikey:validateStored",
      async (
        _e,
        apiKeyId: string,
        provider: string,
        fields: Array<{ key: string; account: string }>,
        config?: Record<string, string>,
      ) => {
        try {
          const { validateStoredApiKey } =
            await import("./services/apiKeyValidator");
          return await validateStoredApiKey(
            apiKeyId,
            provider as any,
            fields,
            config,
          );
        } catch (err) {
          return {
            valid: false,
            message: `Validation error: ${err instanceof Error ? err.message : "Unknown error"}`,
          };
        }
      },
    );

    ipcMain.handle(
      "cockpit:stream:setSource",
      (_e, source: "demo" | "replay" | "live") => {
        stream.setSource(source);
        return true;
      },
    );

    ipcMain.handle("cockpit:stream:getStatus", () => {
      return stream.getStatus();
    });

    ipcMain.handle("cockpit:replay:play", () => {
      stream.getReplay().play();
      return true;
    });

    ipcMain.handle("cockpit:replay:pause", () => {
      stream.getReplay().pause();
      return true;
    });

    ipcMain.handle(
      "cockpit:replay:stop",
      (_e, resetToStart: boolean = true) => {
        stream.getReplay().stop(resetToStart);
        return true;
      },
    );

    ipcMain.handle("cockpit:replay:setSpeed", (_e, speed: number) => {
      stream.getReplay().setSpeed(speed);
      return true;
    });

    ipcMain.handle("cockpit:replay:scrub", (_e, ts: number) => {
      stream.getReplay().scrubTo(ts);
      return true;
    });

    // Paper trading IPC handlers
    ipcMain.handle(
      "cockpit:trading:placeOrder",
      async (_e, req: PlaceOrderRequest) => {
        const guard = riskGuardian?.checkCanTrade();
        if (guard && !guard.allowed) {
          return { orderId: "", accepted: false, reason: guard.reason };
        }
        return await paperAdapter.placeOrder(req);
      },
    );

    ipcMain.handle(
      "cockpit:trading:cancelOrder",
      async (_e, orderId: string) => {
        return await paperAdapter.cancelOrder(orderId);
      },
    );

    ipcMain.handle("cockpit:trading:getOrders", () => {
      return paperAdapter.getOrders();
    });

    ipcMain.handle("cockpit:trading:getPositions", () => {
      return paperAdapter.getPositions();
    });

    ipcMain.handle("cockpit:trading:getAccount", () => {
      return paperAdapter.getAccount();
    });

    // Journal IPC handlers
    ipcMain.handle("cockpit:journal:getTodayTrades", () => {
      return journalManager.getTodayTrades();
    });

    ipcMain.handle("cockpit:journal:getClosedTrades", (_e, limit?: number) => {
      return journalManager.getClosedTrades(limit ?? 100);
    });

    ipcMain.handle("cockpit:journal:getTradeById", (_e, tradeId: number) => {
      return journalManager.getTradeById(tradeId);
    });

    ipcMain.handle(
      "cockpit:journal:getSessionStats",
      (_e, startTs: number, endTs: number) => {
        return journalManager.getSessionStats(startTs, endTs);
      },
    );

    ipcMain.handle(
      "cockpit:journal:updateTradeMetadata",
      (_e, tradeId: number, metadata: any) => {
        const result = journalManager.updateTradeMetadata(tradeId, metadata);
        if (result) {
          AuditRepo.record("journal.updateMetadata", `trade_id=${tradeId}`);
        }
        return result;
      },
    );

    ipcMain.handle(
      "cockpit:journal:addTags",
      (_e, tradeId: number, tags: any) => {
        journalManager.addTags(tradeId, tags);
        AuditRepo.record(
          "journal.addTags",
          `trade_id=${tradeId},count=${tags.length}`,
        );
        return true;
      },
    );

    // Forward market data updates to paper adapter for fills
    bus.subscribe((event: any) => {
      if (event.type === "market.print") {
        paperAdapter.updateMarketPrice(event.symbol, event.price);
      }
    });

    app.on("window-all-closed", () => {
      console.log("[main] [event] window-all-closed fired");
      stream.shutdown();
      // In dev mode, don't auto-quit so we can reopen windows with cmd+shift+delete or F12
      if (!isDev && process.platform !== "darwin") {
        console.log("[main] exiting: not in dev mode and not macOS");
        app.quit();
      } else {
        console.log("[main] not exiting: dev mode or macOS");
      }
    });

    app.on("activate", () => {
      console.log("[main] activate event");
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow();
      }
    });

    console.log("[main] Event handlers registered, app is running");
    console.log("[main] ===== MAIN PROCESS READY - WAITING FOR RENDERER =====");
  } catch (e) {
    console.error("[main] ===== FATAL ERROR IN APP.WHENREADY() =====");
    console.error("[main] Error:", e);
    console.error("[main] Error stack:", (e as any).stack);
    process.exit(1);
  }
});

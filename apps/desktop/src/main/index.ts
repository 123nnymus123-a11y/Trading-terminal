import { app, BrowserWindow, dialog, ipcMain, protocol } from 'electron';
import { config as loadEnv } from 'dotenv';
import { autoUpdater } from 'electron-updater';
import { getDb } from './persistence/db';
import {
  WatchlistsRepo,
  LayoutsRepo,
  AppSettingsRepo,
  AuditRepo,
  TradesJournalRepo,
} from './persistence/repos';
import { CongressRepo } from './persistence/congressRepo';
import { getCongressDataService } from './services/congress/congressDataService';
import { scanCongressAiIntel } from './services/congress/aiCongressIntel';
import { setSecret, getSecret, deleteSecret } from './secrets';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { EventBus } from './streaming/eventBus';
import { attachIpcStreaming } from './streaming/ipcStreaming';
import { StreamManager } from './streaming/streamManager';
import { PaperTradingAdapter } from './adapters/paperTradingAdapter';
import type { PlaceOrderRequest } from './adapters/brokerAdapter';
import { getJournalManager } from './journal/journalManager';
import type { Fill } from './adapters/paperTradingAdapter';
import { RiskGuardian } from './risk/riskGuardian';
import {
  getRecentDisclosureEvents,
  getTopSectorThemes,
  getWatchlistCandidates,
  getValuationTags,
  refreshPublicFlowIntel,
} from './services/publicFlow/service';
import { AiResearchManager } from './services/aiResearch/aiResearchManager';
import { getCentralAIOrchestrator, type UserInteraction } from './services/centralAIOrchestrator';
import { ExternalFeedsService } from './services/externalFeeds';
import { AiStewardService } from './services/aiSteward/aiStewardService';
import type { AiStewardConfig, AiStewardModule } from '../shared/aiSteward';
import { BackendApiClient } from '../shared/backendApiClient';
import type { CalendarInsightRequest } from '@tc/shared';
import {
  generateEconomicCalendarInsights,
  type EnginePreference,
} from './services/economicCalendar/insightsService';
import { ApiHubService } from './services/apiHub';
import type { ApiHubSnapshot, ApiCredentialRecord } from '../shared/apiHub';

const PRODUCTION_BACKEND_URL = 'http://79.76.40.72:8787';
const DEV_BACKEND_FALLBACK_URL = 'http://localhost:8787';

/**
 * Configure auto-updates from GitHub Releases.
 * The updater will:
 * 1. Check for updates every hour
 * 2. Download updates in the background
 * 3. Prompt user to restart and install
 */
function setupAutoUpdater(): void {
  try {
    // Only enable auto-updates in packaged (production) builds
    if (!app.isPackaged) {
      console.log('[main] auto-update disabled in dev mode');
      return;
    }

    // Configure updater
    autoUpdater.channel = 'latest';
    autoUpdater.autoDownload = true;  // Auto-download updates
    autoUpdater.autoInstallOnAppQuit = true;  // Install on quit

    // Log update checks
    autoUpdater.on('checking-for-update', () => {
      console.log('[main] checking for updates...');
    });

    autoUpdater.on('update-available', (info) => {
      console.log('[main] update available:', info.version);
      dialog.showMessageBox({
        type: 'info',
        title: 'Update Available',
        message: `A new version (${info.version}) is available.`,
        detail: 'The app will download and install it in the background. Restart to apply the update.',
        buttons: ['OK'],
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      console.log('[main] update downloaded:', info.version);
      dialog.showMessageBox({
        type: 'info',
        title: 'Update Ready',
        message: `Update version ${info.version} has been downloaded.`,
        detail: 'Restart the app to install the update.',
        buttons: ['Restart Now', 'Later'],
      }).then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
    });

    autoUpdater.on('error', (error) => {
      console.error('[main] auto-update error:', error);
    });

    // Check for updates
    autoUpdater.checkForUpdates().catch((error) => {
      console.error('[main] failed to check for updates:', error);
    });
  } catch (error) {
    console.error('[main] auto-updater setup failed:', error);
  }
}

function getFatalLogPath(): string {
  const candidates = [
    (() => {
      try {
        return path.join(app.getPath('userData'), 'startup-crash.log');
      } catch {
        return null;
      }
    })(),
    path.join(os.tmpdir(), 'trading-cockpit-startup-crash.log'),
    path.resolve(process.cwd(), 'trading-cockpit-startup-crash.log'),
  ].filter((value): value is string => Boolean(value));

  return candidates[0] ?? 'trading-cockpit-startup-crash.log';
}

function formatFatal(reason: unknown): string {
  if (reason instanceof Error) {
    return `${reason.name}: ${reason.message}\n${reason.stack ?? ''}`;
  }
  return String(reason);
}

function reportFatalAndExit(kind: 'uncaughtException' | 'unhandledRejection', reason: unknown): never {
  const detail = formatFatal(reason);
  const crashLogPath = getFatalLogPath();
  const payload = `[${new Date().toISOString()}] ${kind}\n${detail}\n\n`;

  console.error(`[main] ${kind}:`, reason);

  try {
    fs.mkdirSync(path.dirname(crashLogPath), { recursive: true });
    fs.appendFileSync(crashLogPath, payload, 'utf8');
  } catch (error) {
    console.error('[main] failed to write startup crash log', error);
  }

  try {
    dialog.showErrorBox(
      'Trading Cockpit failed to start',
      `A startup error occurred:\n\n${detail.slice(0, 1200)}\n\nCrash log:\n${crashLogPath}`,
    );
  } catch {
    // Ignore dialog failures in early startup contexts.
  }

  process.exit(1);
}

// Global error handlers
process.on('uncaughtException', (err) => {
  reportFatalAndExit('uncaughtException', err);
});

process.on('unhandledRejection', (reason) => {
  reportFatalAndExit('unhandledRejection', reason);
});

const isDev =
  !app.isPackaged &&
  (!!process.env.VITE_DEV_SERVER_URL || process.env.NODE_ENV === 'development');

if (isDev) {
  // Load .env first, then .env.local so local overrides take precedence.
  loadEnv({ path: path.resolve(process.cwd(), '.env') });
  loadEnv({ path: path.resolve(process.cwd(), '.env.local'), override: true });
}

let mainWindow: BrowserWindow | null = null;
let aiManager: AiResearchManager | null = null;
let centralAI = getCentralAIOrchestrator();
let riskGuardian: RiskGuardian | null = null;
let aiStewardService: AiStewardService | null = null;
let apiHubWindow: BrowserWindow | null = null;
let smartRoutingWindow: BrowserWindow | null = null;
let supplyChainGlobalWindow: BrowserWindow | null = null;
const apiHubService = new ApiHubService();

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
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
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
    if (typeof stored !== 'string') {
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

// Cache for detected backend URL to avoid repeated probing
let detectedBackendUrl: string | null = null;

/**
 * Attempts to connect to a backend URL to verify it's reachable.
 * Uses a simple HEAD request with configurable timeout.
 */
async function testBackendUrl(url: string, timeoutMs: number = 5000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    const response = await fetch(url + '/health', {
      method: 'GET',
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    return response.ok;
  } catch (error) {
    // Any error (timeout, network, etc.) means unreachable
    console.log(`[main] backend test failed for ${url}:`, error instanceof Error ? error.message : String(error));
    return false;
  }
}

/**
 * Detects which backend is available: tries localhost first (local dev),
 * then public IP for remote access, then falls back to production.
 * Caches the result to avoid repeated probing.
 */
async function detectAvailableBackendUrl(): Promise<string> {
  if (detectedBackendUrl) {
    return detectedBackendUrl;
  }

  console.log('[main] probing available backends...');
  
  const candidateUrls = [
    DEV_BACKEND_FALLBACK_URL,      // http://localhost:8787 - local dev
    PRODUCTION_BACKEND_URL,         // http://79.76.40.72:8787 - remote/public
    'http://10.0.0.13:8787',       // Linux internal IP - slower for remote
  ];

  for (const url of candidateUrls) {
    console.log(`[main] testing backend: ${url}`);
    if (await testBackendUrl(url)) {
      console.log(`[main] ✓ backend available: ${url}`);
      detectedBackendUrl = url;
      return detectedBackendUrl;
    }
  }

  // All failed, use production as final fallback
  console.log('[main] all backend URLs failed, using production as fallback');
  detectedBackendUrl = PRODUCTION_BACKEND_URL;
  return detectedBackendUrl;
}

// Get backend URL from environment or use default
const getBackendUrl = (): string => {
  if (isDev) {
    const envCandidate =
      process.env.BACKEND_URL || process.env.VITE_BACKEND_URL || process.env.VITE_TC_BACKEND_URL;
    const normalizedEnv = envCandidate ? normalizeBackendUrl(envCandidate) : null;
    if (normalizedEnv) {
      return normalizedEnv;
    }
  }

  const persisted = getPersistedBackendUrl();
  if (persisted) {
    return persisted;
  }

  // Use detected backend URL if available, otherwise fallback to defaults
  if (detectedBackendUrl) {
    return detectedBackendUrl;
  }

  return isDev ? DEV_BACKEND_FALLBACK_URL : PRODUCTION_BACKEND_URL;
};

function rebuildBackendApiClient(): void {
  backendApiClient = new BackendApiClient({
    baseUrl: getBackendUrl(),
    getAuthToken: async () => ensureMainAuthToken(),
  });
  console.log('[main] Backend API Client initialized for:', getBackendUrl());
}

const parseEnvBool = (value: string | undefined, defaultValue: boolean): boolean => {
  if (typeof value !== 'string') return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'no') return false;
  return defaultValue;
};

const migrationFlags = {
  backendOnlyProcessing: parseEnvBool(process.env.MIGRATION_BACKEND_ONLY_PROCESSING, false),
  desktopLocalFallback: parseEnvBool(process.env.MIGRATION_DESKTOP_LOCAL_FALLBACK, true),
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

function writeCongressCache(channel: string, payload: unknown, value: unknown): void {
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
  tier: 'starter' | 'pro' | 'enterprise';
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
const AUTH_SESSION_SECRET_ACCOUNT = 'backend-auth-session-v1';

function broadcastBackendAuthTokenChanged(token: string | null): void {
  for (const windowRef of BrowserWindow.getAllWindows()) {
    if (windowRef.isDestroyed()) {
      continue;
    }
    windowRef.webContents.send('backendAuth:tokenChanged', token);
  }
}

function broadcastBackendUrlChanged(url: string): void {
  for (const windowRef of BrowserWindow.getAllWindows()) {
    if (windowRef.isDestroyed()) {
      continue;
    }
    windowRef.webContents.send('cockpit:backendUrl:changed', url);
  }
}

function getAuthFallbackPassphrase(): string {
  return (
    process.env.AUTH_SESSION_FALLBACK_PASSPHRASE || process.env.JWT_SECRET || 'tc-auth-fallback'
  );
}

function isValidMainAuthSession(session: unknown): session is MainAuthSession {
  if (!session || typeof session !== 'object') {
    return false;
  }
  const candidate = session as Partial<MainAuthSession>;
  return Boolean(
    typeof candidate.token === 'string' &&
    typeof candidate.refreshToken === 'string' &&
    typeof candidate.expiresAtMs === 'number' &&
    candidate.user &&
    typeof candidate.user.id === 'string' &&
    typeof candidate.user.email === 'string',
  );
}

async function persistMainAuthSession(session: MainAuthSession | null): Promise<void> {
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
    const raw = await getSecret(AUTH_SESSION_SECRET_ACCOUNT, getAuthFallbackPassphrase());
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
    console.warn('[main] failed to load persisted auth session', error);
    mainAuthSession = null;
    broadcastBackendAuthTokenChanged(null);
  }
}

function decodeJwtExpMs(token: string): number | null {
  const parts = token.split('.');
  if (parts.length < 2 || !parts[1]) {
    return null;
  }

  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(base64, 'base64').toString('utf8')) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
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

async function requestBackendAuth(pathName: string, payload: Record<string, unknown>) {
  const response = await fetch(`${getBackendUrl()}${pathName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`auth_error:${response.status}:${text || response.statusText}`);
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
  const response = await requestBackendAuth('/api/auth/login', payload);
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
  const response = await requestBackendAuth('/api/auth/signup', payload);
  const session = normalizeMainAuthSession(response);
  mainAuthSession = session;
  await persistMainAuthSession(session);
  return session;
}

async function refreshMainSession(refreshToken: string): Promise<MainAuthSession> {
  const response = await requestBackendAuth('/api/auth/refresh', { refreshToken });
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
  const preloadPath = path.join(__dirname, '../preload/index.cjs');

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#0b1020',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    console.log(`[main] loading devServer URL: ${process.env.VITE_DEV_SERVER_URL}`);
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    const indexHtml = path.join(__dirname, '../renderer/index.html');
    console.log(`[main] loading file: ${indexHtml}`);
    win.loadFile(indexHtml);
  }

  // Listen for load failures
  win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('[main] [event] did-fail-load:', errorCode, errorDescription, validatedURL);
  });

  // Log various loading events
  win.webContents.on('did-start-loading', () => {
    console.log('[main] [event] did-start-loading');
  });

  win.webContents.on('dom-ready', () => {
    console.log('[main] [event] dom-ready');
  });

  win.webContents.on('did-finish-load', () => {
    console.log('[main] [event] did-finish-load (generic, should be caught by once handler)');
  });

  win.webContents.on('preload-error', (event, preloadPath, error) => {
    console.error('[main] [event] preload-error:', preloadPath);
    console.error('[main] [event] preload error details:', error);
  });

  win.webContents.on('ipc-message', (event, channel, ...args) => {
    if (!channel.startsWith('ELECTRON')) {
      console.log('[main] [event] ipc-message:', channel);
    }
  });

  // Log when the window is closed
  win.on('closed', () => {
    console.log('[main] [event] window closed');
  });

  // Log when window is about to be closed
  win.on('close', (e) => {
    console.log('[main] [event] window close event - preventing default');
    // Don't close the window automatically
  });

  // Log any crashes (via render-process-gone instead, since 'crashed' isn't a real event)
  // win.webContents.on("crashed", () => {
  //   console.error("[main] [event] RENDERER CRASHED!");
  // });

  // Log render process gone
  win.webContents.on('render-process-gone', (event, details) => {
    console.error('[main] [event] RENDERER PROCESS GONE:', JSON.stringify(details));
  });

  // Log any unresponsive renderer
  win.on('unresponsive', () => {
    console.warn('[main] [event] renderer unresponsive');
  });

  // Log when renderer becomes responsive again
  win.on('responsive', () => {
    console.log('[main] [event] renderer responsive');
  });

  return win;
}

function openApiHubWindow() {
  if (apiHubWindow && !apiHubWindow.isDestroyed()) {
    apiHubWindow.focus();
    return apiHubWindow;
  }

  const preloadPath = path.join(__dirname, '../preload/index.cjs');
  apiHubWindow = new BrowserWindow({
    width: 960,
    height: 720,
    backgroundColor: '#050816',
    title: 'API Hub',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    apiHubWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}?view=api-hub`);
  } else {
    const indexHtml = path.join(__dirname, '../renderer/index.html');
    apiHubWindow.loadFile(indexHtml, { query: { view: 'api-hub' } });
  }

  apiHubWindow.on('closed', () => {
    apiHubWindow = null;
  });

  return apiHubWindow;
}

function openSupplyChainGlobalWindow(tickers: string[]) {
  if (supplyChainGlobalWindow && !supplyChainGlobalWindow.isDestroyed()) {
    supplyChainGlobalWindow.focus();
    return supplyChainGlobalWindow;
  }

  const preloadPath = path.join(__dirname, '../preload/index.cjs');
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    backgroundColor: '#0b1020',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const tickersParam = encodeURIComponent(tickers.join('|'));
  const viewParam = `view=global-map&tickers=${tickersParam}`;

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(`${process.env.VITE_DEV_SERVER_URL}?${viewParam}`);
  } else {
    const indexHtml = path.join(__dirname, '../renderer/index.html');
    win.loadFile(indexHtml, { query: { view: 'global-map', tickers: tickers.join('|') } });
  }

  win.on('closed', () => {
    supplyChainGlobalWindow = null;
  });

  supplyChainGlobalWindow = win;
  return win;
}

function openSmartRoutingWindow() {
  if (smartRoutingWindow && !smartRoutingWindow.isDestroyed()) {
    smartRoutingWindow.focus();
    return smartRoutingWindow;
  }

  const preloadPath = path.join(__dirname, '../preload/index.cjs');
  smartRoutingWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    backgroundColor: '#030712',
    title: 'Smart Routing Overview',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    smartRoutingWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}?view=smart-routing`);
  } else {
    const indexHtml = path.join(__dirname, '../renderer/index.html');
    smartRoutingWindow.loadFile(indexHtml, { query: { view: 'smart-routing' } });
  }

  smartRoutingWindow.on('closed', () => {
    smartRoutingWindow = null;
  });

  return smartRoutingWindow;
}

function broadcastApiHubSnapshot(snapshot: ApiHubSnapshot) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('apiHub:changed', snapshot);
    }
  }
}

app.whenReady().then(async () => {
  try {
    console.log('[main] app.whenReady()');

    // Detect available backend (try localhost first, fall back to production)
    await detectAvailableBackendUrl();
    console.log('[main] Backend URL resolved to:', getBackendUrl());

    // Set up auto-updates from GitHub Releases
    setupAutoUpdater();

    // Validate Cloud LLM configuration early so errors surface before the window opens
    try {
      const { validateConfig, getConfigSummary } = await import('./services/llm/cloudLlmConfig');
      validateConfig();
      const summary = getConfigSummary();
      console.log(`[main] Cloud LLM configured: provider=${summary.provider} model=${summary.model}`);
    } catch (configErr) {
      const msg = configErr instanceof Error ? configErr.message : String(configErr);
      console.error('[main] Cloud LLM config error:', msg);
      const { dialog } = await import('electron');
      dialog.showErrorBox(
        'Cloud AI Configuration Error',
        `${msg}\n\nThe app will continue but AI features will not work until you fix .env.local and restart.`,
      );
    }

    await loadMainAuthSession();

    // External Feeds service + IPC should be registered early to avoid renderer race
    const externalFeeds = new ExternalFeedsService(AppSettingsRepo);
    ipcMain.handle('externalFeeds:getConfig', () => externalFeeds.getConfig());
    ipcMain.handle('externalFeeds:setConfig', (_e, next: any) => externalFeeds.setConfig(next));
    ipcMain.handle(
      'externalFeeds:testProvider',
      async (_e, providerId: any, credentials?: Record<string, string>) => {
        return externalFeeds.testProvider(providerId, credentials ?? {});
      },
    );
    ipcMain.handle('externalFeeds:getCftcSummary', async (_e, symbols: string[]) => {
      return externalFeeds.getCotSummary(symbols ?? []);
    });
    ipcMain.handle('externalFeeds:getJoltsSeries', async () => {
      return externalFeeds.getJoltsSeries();
    });
    ipcMain.handle(
      'externalFeeds:getSecEvents',
      async (_e, params: { tickers?: string[]; limit?: number }) => {
        return externalFeeds.getSecEvents(params ?? {});
      },
    );

    ipcMain.handle('apiHub:list', () => {
      return apiHubService.list();
    });

    ipcMain.handle('apiHub:save', (_e, record: ApiCredentialRecord) => {
      const snapshot = apiHubService.upsert(record);
      broadcastApiHubSnapshot(snapshot);
      return snapshot;
    });

    ipcMain.handle('apiHub:remove', async (_e, id: string) => {
      const snapshot = await apiHubService.remove(id);
      broadcastApiHubSnapshot(snapshot);
      return snapshot;
    });

    ipcMain.handle('apiHub:openWindow', () => {
      openApiHubWindow();
      return true;
    });

    ipcMain.handle('smartRouting:openWindow', () => {
      openSmartRoutingWindow();
      return true;
    });

    aiStewardService = new AiStewardService(
      AppSettingsRepo,
      externalFeeds,
      path.join(app.getPath('userData'), 'ai-steward'),
    );
    aiStewardService.on('update', (overview) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('aiSteward:update', overview);
      }
    });

    // Register custom protocol for serving screenshots
    protocol.handle('screenshot', (request) => {
      const url = request.url.replace('screenshot://', '');
      const filePath = decodeURIComponent(url);

      try {
        return new Response(fs.readFileSync(filePath), {
          headers: { 'Content-Type': 'image/png' },
        });
      } catch (err) {
        console.error('[main] Failed to load screenshot:', filePath, err);
        return new Response('Not Found', { status: 404 });
      }
    });
    console.log('[main] Screenshot protocol registered');

    // Initialize database early
    try {
      getDb();
      ensurePersistedBackendUrl();
      console.log('[main] SQLite initialized');

      // Run ingest connectors (seed + local drop folder) before pipeline
      const { ingestAll } = await import('./services/publicFlow/ingest');
      const ingestResult = await ingestAll('1970-01-01T00:00:00.000Z');
      console.log(
        `[main] Public Flow ingest complete: fetched=${ingestResult.totals.fetched} parsed=${ingestResult.totals.parsed} inserted=${ingestResult.totals.inserted} skipped=${ingestResult.totals.skipped}`,
      );
      if (ingestResult.errors.length) {
        console.warn('[main] Public Flow ingest errors:', ingestResult.errors.join(' | '));
      }

      // Run Public Flow Intel pipeline on startup
      const { PublicFlowPipeline } = await import('./services/publicFlow/pipeline');
      PublicFlowPipeline.run().catch((err) => {
        console.error('[main] Public Flow pipeline startup error:', err);
      });
    } catch (dbErr) {
      console.error('[main] SQLite init failed', dbErr);
    }
    mainWindow = createWindow();
    console.log('[main] window created');

    // KEEP APP ALIVE - Don't auto-quit when windows close (during dev)
    if (isDev) {
      console.log('[main] DEV MODE: app will NOT auto-quit when windows close');
    }

    const bus = new EventBus();
    console.log('[main] EventBus created');

    aiManager = new AiResearchManager((channel, payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, payload);
      }
    });
    aiManager.resetPolling(aiManager.getConfig());

    // Initialize Backend API Client for AI services
    rebuildBackendApiClient();

    const logger = {
      log: (...args: any[]) => console.log('[main]', ...args),
      error: (...args: any[]) => console.error('[main]', ...args),
    };

    console.log('[main] creating StreamManager...');
    const stream = new StreamManager((evt) => bus.publish(evt), logger);
    console.log('[main] StreamManager created');

    // Initialize paper trading adapter
    const paperAdapter = new PaperTradingAdapter();
    await paperAdapter.connect();
    console.log('[main] PaperTradingAdapter initialized');

    riskGuardian = new RiskGuardian(
      {
        maxDailyLoss: -1500,
        maxDrawdown: -2500,
      },
      (status) => {
        console.warn('[risk] trip', status.reason);
        try {
          const orders = paperAdapter.getOrders();
          for (const o of orders) {
            if (o.status === 'PENDING') {
              void paperAdapter.cancelOrder(o.orderId);
            }
          }
        } catch (err) {
          console.error('[risk] failed to cancel pending orders', err);
        }

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('cockpit:risk:event', {
            type: 'risk.limit',
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
        mainWindow.webContents.send('cockpit:trading:event', event);
      }

      // Capture fill events for journaling
      if (event.type === 'fill') {
        journalManager.handleFill(event.fill as Fill).catch((err) => {
          console.error('[main] Journal manager error:', err);
        });
      }

      if (event.type === 'account') {
        riskGuardian?.observeAccount(event.account);
      }
    });

    // Attach IPC publisher after load (so renderer is ready)
    mainWindow.webContents.once('did-finish-load', () => {
      console.log('[main]');
      console.log('[main] ===== DID-FINISH-LOAD FIRED =====');
      console.log('[main]');
      try {
        broadcastBackendAuthTokenChanged(mainAuthSession?.token ?? null);

        console.log('[main] [1/4] attaching IPC streaming...');
        attachIpcStreaming(bus, mainWindow!.webContents);
        console.log('[main] [1/4] ✓ IPC streaming attached');

        // Initialize Central AI Orchestrator
        console.log('[main] [2/4] initializing Central AI...');
        centralAI.setWebContents(mainWindow!.webContents);
        console.log('[main] [2/4] ✓ Central AI initialized');

        // Start default stream + heartbeat
        console.log('[main] [3/4] initializing stream...');
        try {
          stream.init();
          console.log('[main] [3/4] ✓ stream initialized');
        } catch (initErr) {
          console.error('[main] [3/4] ✗ FATAL Error in stream.init():', initErr);
          throw initErr;
        }

        // tell renderer initial status
        console.log('[main] [4/4] publishing initial status...');
        try {
          bus.publish({ type: 'system.stream.source', ts: Date.now(), source: stream.getSource() });
          console.log('[main] [4/4] ✓ initial status published');
          console.log('[main]');
          console.log('[main] ===== ✓ APP FULLY INITIALIZED =====');
          console.log('[main]');
        } catch (publishErr) {
          console.error('[main] [3/3] ✗ FATAL Error publishing initial status:', publishErr);
          throw publishErr;
        }
      } catch (e) {
        console.error('[main]');
        console.error('[main] ===== ✗ FATAL ERROR IN DID-FINISH-LOAD =====');
        console.error('[main] Error:', e);
        console.error('[main]');
        process.exit(1);
      }
    });

    // --- Auth session bridge for backend API ---
    ipcMain.handle('backendAuth:login', async (_e, payload: any = {}) => {
      const username = typeof payload.username === 'string' ? payload.username : undefined;
      const email = typeof payload.email === 'string' ? payload.email : undefined;
      const password = typeof payload.password === 'string' ? payload.password : '';
      const licenseKey = typeof payload.licenseKey === 'string' ? payload.licenseKey : '';

      if ((!username && !email) || !password || !licenseKey) {
        return { ok: false, error: 'invalid_login_payload' };
      }

      try {
        const session = await loginMainSession({ username, email, password, licenseKey });
        if (backendApiClient) {
          backendApiClient.setAuthToken(session.token);
        }
        broadcastBackendAuthTokenChanged(session.token);
        return { ok: true, session };
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    });

    ipcMain.handle('backendAuth:signup', async (_e, payload: any = {}) => {
      const username = typeof payload.username === 'string' ? payload.username.trim() : '';
      const email = typeof payload.email === 'string' ? payload.email.trim() : '';
      const password = typeof payload.password === 'string' ? payload.password : '';
      const licenseKey = typeof payload.licenseKey === 'string' ? payload.licenseKey : '';

      if (!username || !email || !password || !licenseKey) {
        return { ok: false, error: 'invalid_signup_payload' };
      }

      try {
        const session = await signupMainSession({ username, email, password, licenseKey });
        if (backendApiClient) {
          backendApiClient.setAuthToken(session.token);
        }
        broadcastBackendAuthTokenChanged(session.token);
        return { ok: true, session };
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    });

    ipcMain.handle('backendAuth:refresh', async () => {
      if (!mainAuthSession?.refreshToken) {
        return { ok: false, error: 'no_refresh_token' };
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

    ipcMain.handle('backendAuth:getSession', async () => {
      return mainAuthSession;
    });

    ipcMain.handle('backendAuth:setSession', async (_e, session: MainAuthSession | null) => {
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
    });

    ipcMain.handle('backendAuth:logout', async () => {
      if (mainAuthSession) {
        try {
          const token = await ensureMainAuthToken();
          await fetch(`${getBackendUrl()}/api/auth/logout`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
              allSessions: false,
              refreshToken: mainAuthSession.refreshToken,
            }),
          });
        } catch (error) {
          console.warn('[main] backend logout notify failed', error);
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

    ipcMain.handle('backendAuth:getToken', async () => {
      const token = await ensureMainAuthToken();
      return token;
    });

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
    ipcMain.handle('publicFlow:getRecent', async (_e, limit?: number) => {
      const resolvedLimit = limit ?? 50;
      if (backendApiClient) {
        try {
          const response = await backendApiClient.publicFlowGetRecent(resolvedLimit);
          return response.items ?? [];
        } catch (error) {
          if (!canUseLocalFallback()) {
            throw error;
          }
        }
      }

      return getRecentDisclosureEvents(resolvedLimit);
    });

    ipcMain.handle('publicFlow:getThemes', async (_e, windowDays: 7 | 30, limit?: number) => {
      const window = windowDays === 30 ? 30 : 7;
      const resolvedLimit = limit ?? 10;

      if (backendApiClient) {
        try {
          const response = await backendApiClient.publicFlowGetThemes(windowDays, resolvedLimit);
          return response.items ?? [];
        } catch (error) {
          if (!canUseLocalFallback()) {
            throw error;
          }
        }
      }

      return getTopSectorThemes(window, resolvedLimit);
    });

    ipcMain.handle('publicFlow:getCandidates', async (_e, themeId: number) => {
      if (backendApiClient) {
        try {
          const response = await backendApiClient.publicFlowGetCandidates(themeId);
          return response.items ?? [];
        } catch (error) {
          if (!canUseLocalFallback()) {
            throw error;
          }
        }
      }

      return getWatchlistCandidates(themeId);
    });

    ipcMain.handle('publicFlow:getValuations', async (_e, tickers: string[]) => {
      if (backendApiClient) {
        try {
          const response = await backendApiClient.publicFlowGetValuations(tickers ?? []);
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
        console.error('[main] publicFlow:getValuations error', err);
        return {};
      }
    });

    ipcMain.handle('publicFlow:refresh', async () => {
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
        console.error('[main] publicFlow:refresh error', err);
        return { ok: false, error: String(err), ts: Date.now(), started };
      }
    });

    // --- Congress Activity IPC handlers ---
    ipcMain.handle('congress:queryTrades', async (_e, filters: any) => {
      if (backendApiClient) {
        try {
          const cached = readCongressCache<unknown[]>('congress:queryTrades', filters);
          if (cached) {
            return cached;
          }
          const response = await backendApiClient.congressQueryTrades(filters);
          const rows = response.items ?? [];
          writeCongressCache('congress:queryTrades', filters, rows);
          return rows;
        } catch (error) {
          if (!canUseLocalFallback()) {
            throw error;
          }
        }
      }

      return CongressRepo.queryCongressionalTrades(filters);
    });

    ipcMain.handle('congress:queryTradesWithParty', async (_e, filters: any) => {
      if (backendApiClient) {
        try {
          const cached = readCongressCache<unknown[]>('congress:queryTradesWithParty', filters);
          if (cached) {
            return cached;
          }
          const response = await backendApiClient.congressQueryTrades(filters);
          const rows = Array.isArray(response.items) ? response.items : [];
          const mappedRows = rows.map((item) => ({
            ...item,
            party:
              typeof (item as Record<string, unknown>).party === 'string'
                ? (item as Record<string, unknown>).party
                : 'N/A',
          }));
          writeCongressCache('congress:queryTradesWithParty', filters, mappedRows);
          return mappedRows;
        } catch (error) {
          if (!canUseLocalFallback()) {
            throw error;
          }
        }
      }

      return CongressRepo.queryCongressionalTradesWithParty(filters);
    });

    ipcMain.handle(
      'congress:getTradeStats',
      async (_e, ticker: string, dateStart?: string, dateEnd?: string) => {
        if (backendApiClient) {
          try {
            const cachePayload = { ticker, dateStart, dateEnd };
            const cached = readCongressCache<Record<string, unknown> | null>(
              'congress:getTradeStats',
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
              writeCongressCache('congress:getTradeStats', cachePayload, null);
              return null;
            }

            const toNumber = (value: unknown): number => {
              const n = Number(value);
              return Number.isFinite(n) ? n : 0;
            };

            const buySet = new Set(['buy', 'purchase']);
            const sellSet = new Set(['sell', 'sale']);

            let totalBuys = 0;
            let totalSells = 0;
            let buyVolumeMin = 0;
            let buyVolumeMax = 0;
            let sellVolumeMin = 0;
            let sellVolumeMax = 0;
            const uniqueTraders = new Set<string>();

            for (const row of rows) {
              const txType = String(row.transaction_type ?? '').toLowerCase();
              const low = toNumber(row.amount_range_low);
              const high = toNumber(row.amount_range_high);
              const personName = row.person_name;
              if (typeof personName === 'string' && personName.trim()) {
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
            writeCongressCache('congress:getTradeStats', cachePayload, stats);
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
      'congress:getMostTradedTickers',
      async (_e, params: { dateStart?: string; dateEnd?: string; limit?: number }) => {
        if (backendApiClient) {
          try {
            const cached = readCongressCache<unknown[]>('congress:getMostTradedTickers', params);
            if (cached) {
              return cached;
            }
            const response = await backendApiClient.congressGetMostTradedTickers(params?.limit ?? 10);
            const rows = response.items ?? [];
            writeCongressCache('congress:getMostTradedTickers', params, rows);
            return rows;
          } catch (error) {
            if (!canUseLocalFallback()) {
              throw error;
            }
          }
        }

        return CongressRepo.getMostTradedTickers(params.dateStart, params.dateEnd, params.limit);
      },
    );

    ipcMain.handle('congress:getDisclosureLagStats', async () => {
      if (backendApiClient) {
        try {
          const cached = readCongressCache<Record<string, unknown>>('congress:getDisclosureLagStats');
          if (cached) {
            return cached;
          }
          const response = await backendApiClient.congressGetDisclosureLagStats();
          const stats = response.stats ?? {};
          writeCongressCache('congress:getDisclosureLagStats', null, stats);
          return stats;
        } catch (error) {
          if (!canUseLocalFallback()) {
            throw error;
          }
        }
      }

      return CongressRepo.getDisclosureLagStats();
    });

    ipcMain.handle('congress:queryMembers', async (_e, filters: any) => {
      if (backendApiClient) {
        try {
          const cached = readCongressCache<unknown[]>('congress:queryMembers', filters);
          if (cached) {
            return cached;
          }
          const response = await backendApiClient.congressQueryMembers(filters?.limit ?? 100);
          const rows = response.items ?? [];
          writeCongressCache('congress:queryMembers', filters, rows);
          return rows;
        } catch (error) {
          if (!canUseLocalFallback()) {
            throw error;
          }
        }
      }

      return CongressRepo.queryCongressionalMembers(filters);
    });

    ipcMain.handle('congress:queryLobbying', async (_e, filters: any) => {
      if (backendApiClient) {
        try {
          const cached = readCongressCache<unknown[]>('congress:queryLobbying', filters);
          if (cached) {
            return cached;
          }
          const response = await backendApiClient.congressQueryLobbying(filters?.limit ?? 100);
          const rows = response.items ?? [];
          writeCongressCache('congress:queryLobbying', filters, rows);
          return rows;
        } catch (error) {
          if (!canUseLocalFallback()) {
            throw error;
          }
        }
      }

      return CongressRepo.queryLobbyingActivities(filters);
    });

    ipcMain.handle('congress:queryContracts', async (_e, filters: any) => {
      if (backendApiClient) {
        try {
          const cached = readCongressCache<unknown[]>('congress:queryContracts', filters);
          if (cached) {
            return cached;
          }
          const response = await backendApiClient.congressQueryContracts(filters?.limit ?? 100);
          const rows = response.items ?? [];
          writeCongressCache('congress:queryContracts', filters, rows);
          return rows;
        } catch (error) {
          if (!canUseLocalFallback()) {
            throw error;
          }
        }
      }

      return CongressRepo.queryFederalContracts(filters);
    });

    ipcMain.handle('congress:insertTrades', (_e, trades: any[]) => {
      clearCongressBackendCache();
      return CongressRepo.insertCongressionalTrades(trades);
    });

    ipcMain.handle('congress:insertLobbying', (_e, activities: any[]) => {
      clearCongressBackendCache();
      return CongressRepo.insertLobbyingActivities(activities);
    });

    ipcMain.handle('congress:insertContracts', (_e, contracts: any[]) => {
      clearCongressBackendCache();
      return CongressRepo.insertFederalContracts(contracts);
    });

    ipcMain.handle('congress:upsertMembers', (_e, members: any[]) => {
      clearCongressBackendCache();
      return CongressRepo.upsertCongressionalMembers(members);
    });

    ipcMain.handle('congress:findTicker', (_e, companyName: string) => {
      return CongressRepo.findTickerByCompanyName(companyName);
    });

    ipcMain.handle('congress:insertIngestionLog', (_e, log: any) => {
      return CongressRepo.insertIngestionLog(log);
    });

    ipcMain.handle('congress:queryIngestionLogs', (_e, domain?: string, limit?: number) => {
      return CongressRepo.queryIngestionLogs(domain, limit);
    });

    ipcMain.handle('congress:fetchHouseTrades', async (_e, limit?: number) => {
      clearCongressBackendCache();
      const service = getCongressDataService();
      return await service.fetchHouseTrades(limit);
    });

    ipcMain.handle('congress:fetchSenateTrades', async (_e, limit?: number) => {
      clearCongressBackendCache();
      const service = getCongressDataService();
      return await service.fetchSenateTrades(limit);
    });

    ipcMain.handle('congress:fetchLobbyingActivities', async (_e, limit?: number) => {
      clearCongressBackendCache();
      const service = getCongressDataService();
      return await service.fetchLobbyingActivities(limit);
    });

    ipcMain.handle('congress:fetchFederalContracts', async (_e, limit?: number) => {
      clearCongressBackendCache();
      const service = getCongressDataService();
      return await service.fetchFederalContracts(limit);
    });

    ipcMain.handle('congress:fetchAllTrades', async (_e, limit?: number) => {
      clearCongressBackendCache();
      const service = getCongressDataService();
      return await service.fetchAll(limit);
    });

    ipcMain.handle('congress:scanAiSources', async () => {
      try {
        const data = await scanCongressAiIntel();
        return { success: true, data };
      } catch (err) {
        console.error('[main] congress:scanAiSources error', err);
        return { success: false, error: String(err) };
      }
    });

    ipcMain.handle(
      'congress:ai:analyzeTrade',
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
            const analysis = await backendApiClient.congressAnalyzeTrade(tradeId, tradeData, model);
            return { ok: true, data: analysis, source: 'backend' };
          }

          if (!canUseLocalFallback()) {
            return {
              ok: false,
              error: 'backend_only_processing_enabled',
              source: 'backend-required',
            };
          }

          const intel = await scanCongressAiIntel();
          return {
            ok: true,
            data: {
              tradeId: tradeId ?? 'local-fallback',
              summary: intel.summary,
              highlights: intel.highlights,
              sentiment: intel.sentiment,
              watchlist: intel.watchlist,
              model: intel.model,
              generatedAt: intel.generatedAt,
            },
            source: 'local',
          };
        } catch (error) {
          if (!canUseLocalFallback()) {
            return { ok: false, error: String(error), source: 'backend-required' };
          }
          try {
            const intel = await scanCongressAiIntel();
            return {
              ok: true,
              data: {
                tradeId: tradeId ?? 'local-fallback',
                summary: intel.summary,
                highlights: intel.highlights,
                sentiment: intel.sentiment,
                watchlist: intel.watchlist,
                model: intel.model,
                generatedAt: intel.generatedAt,
              },
              source: 'local-fallback',
            };
          } catch (fallbackError) {
            return { ok: false, error: String(fallbackError) };
          }
        }
      },
    );

    ipcMain.handle(
      'congress:ai:watchlist:get',
      async (_e, { authToken }: { authToken?: string } = {}) => {
        try {
          if (await bindBackendToken(authToken)) {
            const watchlist = await backendApiClient.congressGetWatchlist();
            return { ok: true, data: watchlist, source: 'backend' };
          }

          if (!canUseLocalFallback()) {
            return {
              ok: false,
              error: 'backend_only_processing_enabled',
              source: 'backend-required',
            };
          }

          return {
            ok: true,
            data: {
              items: [...congressAiWatchlistFallback],
            },
            source: 'local',
          };
        } catch (error) {
          if (!canUseLocalFallback()) {
            return { ok: false, error: String(error), source: 'backend-required' };
          }
          return {
            ok: true,
            data: {
              items: [...congressAiWatchlistFallback],
            },
            source: 'local-fallback',
          };
        }
      },
    );

    ipcMain.handle(
      'congress:ai:watchlist:add',
      async (
        _e,
        {
          ticker,
          reason,
          priority,
          authToken,
        }: { ticker?: string; reason?: string; priority?: number; authToken?: string } = {},
      ) => {
        try {
          if (ticker && reason && (await bindBackendToken(authToken))) {
            const created = await backendApiClient.congressAddToWatchlist(ticker, reason, priority);
            return { ok: true, data: created, source: 'backend' };
          }

          if (!canUseLocalFallback()) {
            return {
              ok: false,
              error: 'backend_only_processing_enabled',
              source: 'backend-required',
            };
          }

          if (!ticker || !reason) {
            return { ok: false, error: 'ticker_and_reason_required' };
          }

          const item: CongressAiWatchlistFallbackItem = {
            id: congressAiWatchlistFallbackSeq++,
            ticker,
            reason,
            priority: Number.isFinite(priority) ? Number(priority) : 1,
            createdAt: new Date().toISOString(),
          };
          congressAiWatchlistFallback = [item, ...congressAiWatchlistFallback];
          return { ok: true, data: item, source: 'local' };
        } catch (error) {
          if (!canUseLocalFallback()) {
            return { ok: false, error: String(error), source: 'backend-required' };
          }
          if (!ticker || !reason) {
            return { ok: false, error: 'ticker_and_reason_required' };
          }
          const item: CongressAiWatchlistFallbackItem = {
            id: congressAiWatchlistFallbackSeq++,
            ticker,
            reason,
            priority: Number.isFinite(priority) ? Number(priority) : 1,
            createdAt: new Date().toISOString(),
          };
          congressAiWatchlistFallback = [item, ...congressAiWatchlistFallback];
          return { ok: true, data: item, source: 'local-fallback' };
        }
      },
    );

    ipcMain.handle(
      'congress:ai:watchlist:remove',
      async (
        _e,
        { watchlistId, authToken }: { watchlistId?: number; authToken?: string } = {},
      ) => {
        try {
          if (typeof watchlistId === 'number' && (await bindBackendToken(authToken))) {
            const result = await backendApiClient.congressDismissFromWatchlist(watchlistId);
            return { ok: true, data: result, source: 'backend' };
          }

          if (!canUseLocalFallback()) {
            return {
              ok: false,
              error: 'backend_only_processing_enabled',
              source: 'backend-required',
            };
          }

          if (typeof watchlistId !== 'number') {
            return { ok: false, error: 'watchlist_id_required' };
          }

          const before = congressAiWatchlistFallback.length;
          congressAiWatchlistFallback = congressAiWatchlistFallback.filter(
            (item) => item.id !== watchlistId,
          );
          return {
            ok: true,
            data: { removed: congressAiWatchlistFallback.length < before },
            source: 'local',
          };
        } catch (error) {
          if (!canUseLocalFallback()) {
            return { ok: false, error: String(error), source: 'backend-required' };
          }
          if (typeof watchlistId !== 'number') {
            return { ok: false, error: 'watchlist_id_required' };
          }
          const before = congressAiWatchlistFallback.length;
          congressAiWatchlistFallback = congressAiWatchlistFallback.filter(
            (item) => item.id !== watchlistId,
          );
          return {
            ok: true,
            data: { removed: congressAiWatchlistFallback.length < before },
            source: 'local-fallback',
          };
        }
      },
    );

    // --- AI Research IPC handlers ---
    ipcMain.handle('ai:config:get', async (_e, { authToken }: { authToken?: string } = {}) => {
      try {
        // Try backend first
        if (await bindBackendToken(authToken)) {
          const config = await backendApiClient.researchGetConfig();
          return { ok: true, data: config, source: 'backend' };
        }
        // Fall back to local
        const config = await aiManager?.getConfig();
        return { ok: true, data: config, source: 'local' };
      } catch (error) {
        // Try local fallback if backend fails
        try {
          const config = await aiManager?.getConfig();
          return { ok: true, data: config, source: 'local-fallback' };
        } catch (fallbackError) {
          return { ok: false, error: (fallbackError as Error).message };
        }
      }
    });

    ipcMain.handle(
      'ai:config:set',
      async (_e, { config, authToken }: { config?: unknown; authToken?: string } = {}) => {
        try {
          // Try backend first
          if (await bindBackendToken(authToken)) {
            const result = await backendApiClient.researchSetConfig(config);
            return { ok: true, data: result, source: 'backend' };
          }
          // Fall back to local
          const result = aiManager?.setConfig(config);
          return { ok: true, data: result, source: 'local' };
        } catch (error) {
          // Try local fallback if backend fails
          try {
            const result = aiManager?.setConfig(config);
            return { ok: true, data: result, source: 'local-fallback' };
          } catch (fallbackError) {
            return { ok: false, error: (fallbackError as Error).message };
          }
        }
      },
    );

    ipcMain.handle(
      'ai:run',
      async (
        _e,
        {
          items,
          authToken,
        }: { items?: Array<{ title: string; text: string }>; authToken?: string } = {},
      ) => {
        if (!aiManager && !backendApiClient) return { ok: false, error: 'AI manager not ready' };
        try {
          // Try backend first
          if (await bindBackendToken(authToken)) {
            const result = await backendApiClient.researchRun(items);
            return { ok: true, data: result, source: 'backend' };
          }
          if (!canUseLocalFallback()) {
            return {
              ok: false,
              error: 'backend_only_processing_enabled',
              source: 'backend-required',
            };
          }
          // Fall back to local
          const result = await aiManager!.runNow('manual', items ?? []);
          return { ok: true, data: result, source: 'local' };
        } catch (error) {
          // Try local fallback if backend fails
          try {
            if (!canUseLocalFallback()) {
              return {
                ok: false,
                error: (error as Error).message || 'backend_only_processing_enabled',
                source: 'backend-required',
              };
            }
            const result = await aiManager!.runNow('manual', items ?? []);
            return { ok: true, data: result, source: 'local-fallback' };
          } catch (fallbackError) {
            return { ok: false, error: (fallbackError as Error).message };
          }
        }
      },
    );

    ipcMain.handle(
      'ai:briefs:list',
      async (_e, { limit, authToken }: { limit?: number; authToken?: string } = {}) => {
        try {
          // Try backend first
          if (await bindBackendToken(authToken)) {
            const briefs = await backendApiClient.researchGetBriefs(limit);
            return { ok: true, data: briefs, source: 'backend' };
          }
          // Fall back to local
          const { AiResearchRepo } = require('./persistence/aiResearchRepo');
          const briefs = AiResearchRepo.listBriefs(limit ?? 5);
          return { ok: true, data: briefs, source: 'local' };
        } catch (error) {
          // Try local fallback if backend fails
          try {
            const { AiResearchRepo } = require('./persistence/aiResearchRepo');
            const briefs = AiResearchRepo.listBriefs(limit ?? 5);
            return { ok: true, data: briefs, source: 'local-fallback' };
          } catch (fallbackError) {
            return { ok: false, error: (fallbackError as Error).message };
          }
        }
      },
    );

    ipcMain.handle('ai:status:get', async (_e, { authToken }: { authToken?: string } = {}) => {
      try {
        // Try backend first
        if (await bindBackendToken(authToken)) {
          const status = await backendApiClient.researchGetStatus();
          return { ok: true, data: status, source: 'backend' };
        }
        // Fall back to local
        const status = aiManager?.getStatus();
        return { ok: true, data: status, source: 'local' };
      } catch (error) {
        // Try local fallback if backend fails
        try {
          const status = aiManager?.getStatus();
          return { ok: true, data: status, source: 'local-fallback' };
        } catch (fallbackError) {
          return { ok: false, error: (fallbackError as Error).message };
        }
      }
    });

    ipcMain.handle('ai:runtime:check', async () => {
      console.log('[main] IPC: ai:runtime:check called, aiManager ready:', !!aiManager);
      if (!aiManager) {
        console.warn('[main] IPC: ai:runtime:check - aiManager not initialized yet');
        return { available: false, message: 'AI manager initializing...' };
      }
      try {
        const result = await aiManager.checkRuntime();
        console.log('[main] IPC: ai:runtime:check result:', result);
        return result;
      } catch (err) {
        console.error('[main] IPC: ai:runtime:check error:', err);
        return { available: false, message: String(err) };
      }
    });

    ipcMain.handle('ai:models:list', async () => {
      console.log('[main] IPC: ai:models:list called, aiManager ready:', !!aiManager);
      if (!aiManager) {
        console.warn('[main] IPC: ai:models:list - aiManager not initialized yet');
        return { ok: false, error: 'AI manager initializing...', models: [] };
      }
      try {
        const result = await aiManager.listLocalModels();
        console.log('[main] IPC: ai:models:list result:', result);
        return result;
      } catch (err) {
        console.error('[main] IPC: ai:models:list error:', err);
        return { ok: false, error: String(err), models: [] };
      }
    });

    ipcMain.handle(
      'aiSteward:getOverview',
      async (_e, { authToken }: { authToken?: string } = {}) => {
        try {
          // Try backend first
          if (await bindBackendToken(authToken)) {
            const overview = await backendApiClient.stewardGetOverview();
            return { ok: true, data: overview, source: 'backend' };
          }
          // Fall back to local
          const overview = aiStewardService?.getOverview() ?? null;
          return { ok: true, data: overview, source: 'local' };
        } catch (error) {
          // Try local fallback if backend fails
          try {
            const overview = aiStewardService?.getOverview() ?? null;
            return { ok: true, data: overview, source: 'local-fallback' };
          } catch (fallbackError) {
            return { ok: false, error: (fallbackError as Error).message };
          }
        }
      },
    );

    ipcMain.handle(
      'aiSteward:getConfig',
      async (_e, { authToken }: { authToken?: string } = {}) => {
        try {
          // Try backend first
          if (await bindBackendToken(authToken)) {
            const config = await backendApiClient.stewardGetConfig();
            return { ok: true, data: config, source: 'backend' };
          }
          // Fall back to local
          const config = aiStewardService?.getConfig() ?? null;
          return { ok: true, data: config, source: 'local' };
        } catch (error) {
          // Try local fallback if backend fails
          try {
            const config = aiStewardService?.getConfig() ?? null;
            return { ok: true, data: config, source: 'local-fallback' };
          } catch (fallbackError) {
            return { ok: false, error: (fallbackError as Error).message };
          }
        }
      },
    );

    ipcMain.handle(
      'aiSteward:setConfig',
      async (
        _e,
        { patch, authToken }: { patch?: Partial<AiStewardConfig>; authToken?: string } = {},
      ) => {
        if (!aiStewardService && !backendApiClient)
          return { ok: false, error: 'AI steward not ready' };
        try {
          // Try backend first
          if (await bindBackendToken(authToken)) {
            const result = await backendApiClient.stewardSetConfig(patch);
            return { ok: true, data: result, source: 'backend' };
          }
          // Fall back to local
          const result = aiStewardService?.setConfig(patch ?? {});
          return { ok: true, data: result, source: 'local' };
        } catch (error) {
          // Try local fallback if backend fails
          try {
            const result = aiStewardService?.setConfig(patch ?? {});
            return { ok: true, data: result, source: 'local-fallback' };
          } catch (fallbackError) {
            return { ok: false, error: (fallbackError as Error).message };
          }
        }
      },
    );

    ipcMain.handle(
      'aiSteward:runModule',
      async (_e, { module, authToken }: { module?: AiStewardModule; authToken?: string } = {}) => {
        if (!aiStewardService && !backendApiClient)
          return { ok: false, error: 'AI steward not ready' };
        try {
          // Try backend first
          if (module && (await bindBackendToken(authToken))) {
            const result = await backendApiClient.stewardRunModule(module);
            return { ok: true, data: result, source: 'backend' };
          }
          // Fall back to local
          if (module) {
            await aiStewardService!.runModule(module);
          }
          return { ok: true, source: 'local' };
        } catch (error) {
          // Try local fallback if backend fails
          try {
            if (module) {
              await aiStewardService!.runModule(module);
            }
            return { ok: true, source: 'local-fallback' };
          } catch (fallbackError) {
            return { ok: false, message: (fallbackError as Error).message };
          }
        }
      },
    );

    ipcMain.handle(
      'aiSteward:applyTask',
      async (_e, { taskId, authToken }: { taskId?: string; authToken?: string } = {}) => {
        if (!aiStewardService && !backendApiClient)
          return { ok: false, message: 'AI steward not ready' };
        try {
          // Try backend first
          if (taskId && (await bindBackendToken(authToken))) {
            const result = await backendApiClient.stewardApplyTask(taskId);
            return { ok: true, data: result, source: 'backend' };
          }
          // Fall back to local
          if (taskId) {
            const result = await aiStewardService!.applyTask(taskId);
            return { ok: true, data: result, source: 'local' };
          }
          return { ok: false, message: 'No taskId provided' };
        } catch (error) {
          // Try local fallback if backend fails
          try {
            if (taskId) {
              const result = await aiStewardService!.applyTask(taskId);
              return { ok: true, data: result, source: 'local-fallback' };
            }
            return { ok: false, message: 'No taskId provided' };
          } catch (fallbackError) {
            return { ok: false, message: (fallbackError as Error).message };
          }
        }
      },
    );

    ipcMain.handle('aiSteward:test', async (_e, prompt?: string) => {
      if (!aiStewardService) return { ok: false, message: 'AI steward not ready' };
      try {
        const response = await aiStewardService.testResponse(prompt);
        return { ok: true, response };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
    });

    // --- Central AI Orchestrator IPC handlers ---
    ipcMain.handle(
      'centralAI:track',
      async (_e, { type = 'symbol_search', symbol, action, authToken }: any = {}) => {
        try {
          // Try backend first
          if (await bindBackendToken(authToken)) {
            await backendApiClient.orchestratorTrackInteraction(type, symbol, {
              action,
              timestamp: new Date().toISOString(),
            });
            return { success: true, source: 'backend' };
          }
          // Fall back to local
          centralAI.trackInteraction({
            type: type as
              | 'symbol_search'
              | 'supply_chain_view'
              | 'intelligence_read'
              | 'portfolio_add'
              | 'portfolio_remove'
              | 'trade_executed',
            symbol: symbol as string | undefined,
            timestamp: Date.now(),
            metadata: action ? { action } : undefined,
          } as UserInteraction);
          return { success: true, source: 'local' };
        } catch (error) {
          // Try local fallback
          try {
            centralAI.trackInteraction({
              type: type as
                | 'symbol_search'
                | 'supply_chain_view'
                | 'intelligence_read'
                | 'portfolio_add'
                | 'portfolio_remove'
                | 'trade_executed',
              symbol: symbol as string | undefined,
              timestamp: Date.now(),
              metadata: action ? { action } : undefined,
            } as UserInteraction);
            return { success: true, source: 'local-fallback' };
          } catch (fallbackError) {
            console.error('[main] centralAI:track error', fallbackError);
            return { success: false, error: String(fallbackError) };
          }
        }
      },
    );

    ipcMain.handle(
      'centralAI:predict',
      async (_e, { limit, authToken }: { limit?: number; authToken?: string } = {}) => {
        try {
          // Try backend first
          if (await bindBackendToken(authToken)) {
            const predictions = await backendApiClient.orchestratorGetPredictions();
            return { success: true, predictions, source: 'backend' };
          }
          // Fall back to local
          const predictions = centralAI.predictNextSymbols(limit ?? 5);
          return { success: true, predictions, source: 'local' };
        } catch (error) {
          // Try local fallback
          try {
            const predictions = centralAI.predictNextSymbols(limit ?? 5);
            return { success: true, predictions, source: 'local-fallback' };
          } catch (fallbackError) {
            console.error('[main] centralAI:predict error', fallbackError);
            return { success: false, error: String(fallbackError) };
          }
        }
      },
    );

    ipcMain.handle('centralAI:validate', async (_e, response: string, context: any) => {
      try {
        const result = await centralAI.validateAIResponse(response, context);
        return { success: true, ...result };
      } catch (err) {
        console.error('[main] centralAI:validate error', err);
        return { success: false, error: String(err) };
      }
    });

    // --- Economic Calendar AI handlers ---
    ipcMain.handle(
      'economicCalendar:insights',
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
            const result = await backendApiClient.economicCalendarGetInsights(payload.request);
            return { success: true, result, source: 'backend' };
          }
          if (!canUseLocalFallback()) {
            return {
              success: false,
              error: 'backend_only_processing_enabled',
              source: 'backend-required',
            };
          }
          const result = await generateEconomicCalendarInsights(payload.request, {
            preference: payload.preference,
          });
          return { success: true, result, source: 'local' };
        } catch (err) {
          console.error('[main] economicCalendar:insights error', err);
          if (!canUseLocalFallback()) {
            return { success: false, error: String(err), source: 'backend-required' };
          }
          try {
            const result = await generateEconomicCalendarInsights(payload.request, {
              preference: payload.preference,
            });
            return { success: true, result, source: 'local-fallback' };
          } catch (fallbackErr) {
            return { success: false, error: String(fallbackErr) };
          }
        }
      },
    );

    ipcMain.handle('centralAI:getIntelligence', () => {
      try {
        return { success: true, intelligence: centralAI.getPersonalizedIntelligence() };
      } catch (err) {
        console.error('[main] centralAI:getIntelligence error', err);
        return { success: false, error: String(err) };
      }
    });

    ipcMain.handle('centralAI:getStats', () => {
      try {
        return { success: true, stats: centralAI.getStats() };
      } catch (err) {
        console.error('[main] centralAI:getStats error', err);
        return { success: false, error: String(err) };
      }
    });

    // --- Supply Chain IPC handlers ---
    ipcMain.handle(
      'supplyChain:generate',
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
        try {
          if (await bindBackendToken(options.authToken)) {
            const backendResult = await backendApiClient.supplyChainGenerateMap(
              options.ticker,
              {
                globalTickers: options.globalTickers,
                includeHypothesis: options.includeHypothesis,
                hops: options.hops,
              },
            );
            return {
              success: true,
              ...((backendResult as Record<string, unknown>) ?? {}),
              source: 'backend',
            };
          }

          if (!canUseLocalFallback()) {
            return {
              success: false,
              error: 'backend_only_processing_enabled',
              fromCache: false,
              source: 'backend-required',
            };
          }

          const {
            generateOfficialSupplyChain,
          } = require('./services/supplyChain/officialSupplyChain');
          const { AiResearchRepo } = require('./persistence/aiResearchRepo');

          // Get globally configured AI model from settings
          const config = AiResearchRepo.getConfig();
          const model = config?.model || 'deepseek-r1:14b';

          console.log(`[supplyChain] Generating for ${options.ticker} using model: ${model}`);

          const result = await generateOfficialSupplyChain(model, {
            ticker: options.ticker,
            globalTickers: options.globalTickers,
            strictMode: options.strictMode,
            includeHypothesis: options.includeHypothesis,
            hops: options.hops,
            minEdgeWeight: options.minEdgeWeight,
            refresh: options.refresh,
          });

          console.log(`[supplyChain] Generated successfully for ${options.ticker}`);
          return {
            success: true,
            data: result.data,
            fromCache: result.fromCache,
            needsRefresh: result.needsRefresh,
            source: 'local',
          };
        } catch (err) {
          console.error('[main] supplyChain:generate error:', err);
          if (!canUseLocalFallback()) {
            return {
              success: false,
              error: String(err),
              fromCache: false,
              source: 'backend-required',
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

    ipcMain.handle('supplyChain:clearCache', (_e, ticker: string) => {
      try {
        const { SupplyChainGraphRepo } = require('./persistence/supplyChainGraphRepo');
        SupplyChainGraphRepo.clearEgoGraphCache(ticker);
        return { success: true };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    });

    ipcMain.handle('supplyChain:openGlobalMap', (_e, tickers: string[]) => {
      try {
        const sanitized = Array.isArray(tickers) ? tickers.filter(Boolean) : [];
        if (sanitized.length === 0) return { success: false, error: 'No tickers provided' };
        openSupplyChainGlobalWindow(sanitized);
        return { success: true };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    });

    ipcMain.handle('supplyChain:listCached', () => {
      try {
        const { SupplyChainGraphRepo } = require('./persistence/supplyChainGraphRepo');
        return { success: true, tickers: SupplyChainGraphRepo.listCachedTickers() };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    });

    ipcMain.handle('supplyChain:advisorAsk', async (_e, payload) => {
      try {
        const { AiResearchRepo } = require('./persistence/aiResearchRepo');
        const { askSupplyChainAdvisor } = require('./services/supplyChain/ollamaSupplyChain');
        const config = AiResearchRepo.getConfig();
        const model = config?.model || 'deepseek-r1:14b';
        return await askSupplyChainAdvisor(model, payload);
      } catch (err) {
        console.error('[main] supplyChain:advisorAsk error', err);
        return { success: false, error: String(err) };
      }
    });

    // --- GWMD Map IPC handlers ---
    ipcMain.handle('gwmdMap:search', async (_e, payload: { ticker: string; model: any }) => {
      try {
        const {
          companyRelationshipService,
        } = require('./services/GWMD/companyRelationshipService');

        console.log(`[gwmdMap] Searching for relationships: ${payload.ticker}`);

        const result = await companyRelationshipService.generateRelationships(payload.ticker, {
          model: payload.model,
        });

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
        console.error('[main] gwmdMap:search error', err);
        const message = err instanceof Error ? err.message : String(err);
        const status =
          err instanceof Error &&
          (err.name === 'GwmdParseError' || /parse|quality checks/i.test(err.message))
            ? 'parse_fail'
            : 'error';
        return {
          success: false,
          status,
          error: message,
          companies: [],
          edges: [],
        };
      }
    });

    ipcMain.handle('gwmdMap:loadAll', async () => {
      try {
        const { gwmdMapRepo } = require('./persistence/gwmdMapRepo');
        const {
          companyRelationshipService,
        } = require('./services/GWMD/companyRelationshipService');

        try {
          const repair = await companyRelationshipService.repairMissingCoordinates(200);
          if (repair.updated > 0) {
            console.log(
              `[gwmdMap] Repaired ${repair.updated}/${repair.attempted} missing coordinates`,
            );
          }
        } catch (err) {
          console.warn('[gwmdMap] Repair missing coordinates failed', err);
        }

        const companies = gwmdMapRepo.getAllCompanies();
        const graph = gwmdMapRepo.buildGraph();

        return {
          success: true,
          status: 'ok',
          companies,
          graph,
          meta: {
            source: 'db_snapshot',
            unlocatedCount: companies.filter(
              (company: { hq_lat?: number | null; hq_lon?: number | null }) =>
                company.hq_lat == null || company.hq_lon == null,
            ).length,
          },
        };
      } catch (err) {
        console.error('[main] gwmdMap:loadAll error', err);
        return {
          success: false,
          status: 'error',
          error: String(err),
          companies: [],
          graph: null,
        };
      }
    });

    ipcMain.handle('gwmdMap:clear', async () => {
      try {
        const { gwmdMapRepo } = require('./persistence/gwmdMapRepo');
        gwmdMapRepo.clear();
        return { success: true };
      } catch (err) {
        console.error('[main] gwmdMap:clear error', err);
        return { success: false, error: String(err) };
      }
    });

    // --- IPC handlers (Prompt 7: persistence) ---
    ipcMain.handle('cockpit:config:watchlists:list', async () => {
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
    ipcMain.handle('cockpit:config:watchlists:add', async (_e, symbol: string, note?: string) => {
      if (backendApiClient) {
        try {
          const item = await backendApiClient.userAddWatchlist(symbol, note ?? '');
          AuditRepo.record('watchlist.add', `symbol=${symbol},source=backend`);
          return item;
        } catch (error) {
          if (!canUseLocalFallback()) {
            throw error;
          }
        }
      }

      const w = WatchlistsRepo.add(symbol, note ?? '');
      AuditRepo.record('watchlist.add', `symbol=${symbol}`);
      return w;
    });
    ipcMain.handle(
      'cockpit:config:watchlists:update',
      async (_e, id: number, fields: { symbol?: string; note?: string }) => {
        if (backendApiClient) {
          try {
            const item = await backendApiClient.userUpdateWatchlist(id, fields);
            AuditRepo.record('watchlist.update', `id=${id},source=backend`);
            return item;
          } catch (error) {
            if (!canUseLocalFallback()) {
              throw error;
            }
          }
        }

        const w = WatchlistsRepo.update(id, fields) as any;
        if (w) AuditRepo.record('watchlist.update', `id=${id}`);
        return w;
      },
    );
    ipcMain.handle('cockpit:config:watchlists:remove', async (_e, id: number) => {
      if (backendApiClient) {
        try {
          const result = await backendApiClient.userRemoveWatchlist(id);
          if (result.ok) AuditRepo.record('watchlist.remove', `id=${id},source=backend`);
          return result.ok;
        } catch (error) {
          if (!canUseLocalFallback()) {
            throw error;
          }
        }
      }

      const ok = WatchlistsRepo.remove(id);
      if (ok) AuditRepo.record('watchlist.remove', `id=${id}`);
      return ok;
    });

    ipcMain.handle('cockpit:config:layouts:list', (_e, symbol?: string) => {
      return LayoutsRepo.list(symbol);
    });
    ipcMain.handle(
      'cockpit:config:layouts:setPreset',
      (_e, symbol: string, preset: string, data?: unknown) => {
        const res = LayoutsRepo.setPreset(symbol, preset, data);
        const settings = AppSettingsRepo.get();
        AppSettingsRepo.set({ ...settings, layoutSelection: { symbol, preset } });
        AuditRepo.record('layout.setPreset', `symbol=${symbol},preset=${preset}`);
        return res;
      },
    );
    ipcMain.handle('cockpit:config:settings:get', async () => {
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
    ipcMain.handle('cockpit:config:settings:set', async (_e, next: Record<string, unknown>) => {
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
      if (typeof next.backendUrl === 'string') {
        rebuildBackendApiClient();
        const normalized = normalizeBackendUrl(next.backendUrl);
        if (normalized) {
          broadcastBackendUrlChanged(normalized);
        }
      }
      return true;
    });
    ipcMain.handle('cockpit:config:backendUrl:get', async () => {
      return getBackendUrl();
    });
    ipcMain.handle('cockpit:config:backendUrl:set', async (_e, nextUrl: string) => {
      const normalized = normalizeBackendUrl(nextUrl);
      if (!normalized) {
        throw new Error('invalid_backend_url');
      }

      const settings = AppSettingsRepo.get();
      AppSettingsRepo.set({ ...settings, backendUrl: normalized });
      rebuildBackendApiClient();
      broadcastBackendUrlChanged(normalized);
      return true;
    });

    ipcMain.handle(
      'cockpit:secrets:set',
      async (_e, account: string, secret: string, passphrase?: string) => {
        return setSecret(account, secret, passphrase);
      },
    );
    ipcMain.handle('cockpit:secrets:get', async (_e, account: string, passphrase?: string) => {
      return getSecret(account, passphrase);
    });

    // API Key Validation
    ipcMain.handle(
      'cockpit:apikey:validate',
      async (_e, provider: string, credentials: Record<string, string>) => {
        try {
          const { validateApiKey } = await import('./services/apiKeyValidator');
          return await validateApiKey(provider as any, credentials);
        } catch (err) {
          return {
            valid: false,
            message: `Validation error: ${err instanceof Error ? err.message : 'Unknown error'}`,
          };
        }
      },
    );

    ipcMain.handle(
      'cockpit:apikey:validateStored',
      async (
        _e,
        apiKeyId: string,
        provider: string,
        fields: Array<{ key: string; account: string }>,
        config?: Record<string, string>,
      ) => {
        try {
          const { validateStoredApiKey } = await import('./services/apiKeyValidator');
          return await validateStoredApiKey(apiKeyId, provider as any, fields, config);
        } catch (err) {
          return {
            valid: false,
            message: `Validation error: ${err instanceof Error ? err.message : 'Unknown error'}`,
          };
        }
      },
    );

    ipcMain.handle('cockpit:stream:setSource', (_e, source: 'demo' | 'replay' | 'live') => {
      stream.setSource(source);
      return true;
    });

    ipcMain.handle('cockpit:stream:getStatus', () => {
      return stream.getStatus();
    });

    ipcMain.handle('cockpit:replay:play', () => {
      stream.getReplay().play();
      return true;
    });

    ipcMain.handle('cockpit:replay:pause', () => {
      stream.getReplay().pause();
      return true;
    });

    ipcMain.handle('cockpit:replay:stop', (_e, resetToStart: boolean = true) => {
      stream.getReplay().stop(resetToStart);
      return true;
    });

    ipcMain.handle('cockpit:replay:setSpeed', (_e, speed: number) => {
      stream.getReplay().setSpeed(speed);
      return true;
    });

    ipcMain.handle('cockpit:replay:scrub', (_e, ts: number) => {
      stream.getReplay().scrubTo(ts);
      return true;
    });

    // Paper trading IPC handlers
    ipcMain.handle('cockpit:trading:placeOrder', async (_e, req: PlaceOrderRequest) => {
      const guard = riskGuardian?.checkCanTrade();
      if (guard && !guard.allowed) {
        return { orderId: '', accepted: false, reason: guard.reason };
      }
      return await paperAdapter.placeOrder(req);
    });

    ipcMain.handle('cockpit:trading:cancelOrder', async (_e, orderId: string) => {
      return await paperAdapter.cancelOrder(orderId);
    });

    ipcMain.handle('cockpit:trading:getOrders', () => {
      return paperAdapter.getOrders();
    });

    ipcMain.handle('cockpit:trading:getPositions', () => {
      return paperAdapter.getPositions();
    });

    ipcMain.handle('cockpit:trading:getAccount', () => {
      return paperAdapter.getAccount();
    });

    // Journal IPC handlers
    ipcMain.handle('cockpit:journal:getTodayTrades', () => {
      return journalManager.getTodayTrades();
    });

    ipcMain.handle('cockpit:journal:getClosedTrades', (_e, limit?: number) => {
      return journalManager.getClosedTrades(limit ?? 100);
    });

    ipcMain.handle('cockpit:journal:getTradeById', (_e, tradeId: number) => {
      return journalManager.getTradeById(tradeId);
    });

    ipcMain.handle('cockpit:journal:getSessionStats', (_e, startTs: number, endTs: number) => {
      return journalManager.getSessionStats(startTs, endTs);
    });

    ipcMain.handle('cockpit:journal:updateTradeMetadata', (_e, tradeId: number, metadata: any) => {
      const result = journalManager.updateTradeMetadata(tradeId, metadata);
      if (result) {
        AuditRepo.record('journal.updateMetadata', `trade_id=${tradeId}`);
      }
      return result;
    });

    ipcMain.handle('cockpit:journal:addTags', (_e, tradeId: number, tags: any) => {
      journalManager.addTags(tradeId, tags);
      AuditRepo.record('journal.addTags', `trade_id=${tradeId},count=${tags.length}`);
      return true;
    });

    // Forward market data updates to paper adapter for fills
    bus.subscribe((event: any) => {
      if (event.type === 'market.print') {
        paperAdapter.updateMarketPrice(event.symbol, event.price);
      }
    });

    app.on('window-all-closed', () => {
      console.log('[main] [event] window-all-closed fired');
      stream.shutdown();
      // In dev mode, don't auto-quit so we can reopen windows with cmd+shift+delete or F12
      if (!isDev && process.platform !== 'darwin') {
        console.log('[main] exiting: not in dev mode and not macOS');
        app.quit();
      } else {
        console.log('[main] not exiting: dev mode or macOS');
      }
    });

    app.on('activate', () => {
      console.log('[main] activate event');
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow();
      }
    });

    console.log('[main] Event handlers registered, app is running');
    console.log('[main] ===== MAIN PROCESS READY - WAITING FOR RENDERER =====');
  } catch (e) {
    console.error('[main] ===== FATAL ERROR IN APP.WHENREADY() =====');
    console.error('[main] Error:', e);
    console.error('[main] Error stack:', (e as any).stack);
    process.exit(1);
  }
});

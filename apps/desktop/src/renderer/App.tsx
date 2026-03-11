import React, { useMemo, useState, useEffect, useRef, Component, type ErrorInfo, type ReactNode } from "react";

declare global {
  interface Window {
    updates?: {
      onAvailable: (cb: (info: { version: string }) => void) => void;
      onDownloaded: (cb: (info: { version: string }) => void) => void;
      install: () => Promise<void>;
    };
  }
}
import { LastPricePill } from "./components/LastPricePill";
import { startStreamController } from "./store/streamController";
import { useMarketData } from "./marketData/useMarketData";
import { useStreamStore } from "./store/streamStore";
import { useTrading } from "./hooks/useTrading";
import { useTradingStore } from "./store/tradingStore";
import { useThemeStore } from "./store/themeStore";
import EconomicCalendar from "./components/EconomicCalendar";

import Panorama from "./pages/Panorama";
import SettingsLogs from "./pages/SettingsLogs";
import { useConfigStore } from "./store/configStore";
import LocalAI from "./pages/LocalAI";
import Intelligence from "./pages/Intelligence";
import SupplyChainMindMap from "./pages/SupplyChainMindMap";
import GlobalSupplyChainMap from "./pages/GlobalSupplyChainMap";
import GwmdMapPage from "./pages/GwmdMapPage";
import { CongressActivity } from "./pages/CongressActivity";
import { Macro } from "./pages/Macro";
import ApiHub from "./pages/ApiHub";
import SmartRoutingOverview from "./pages/SmartRoutingOverview";
import Cam from "./pages/Cam";
import { AuthPanel } from "./components/AuthPanel";
import {
  login,
  logout,
  probeSessionValid,
  readStoredSession,
  refresh,
  signup,
  writeStoredSession,
  type AuthSession,
} from "./lib/apiClient";

// Robust imports: work whether pages export default OR named
import * as MicroscapeMod from "./pages/Microscape";
import * as StructureMod from "./pages/Structure";
import * as FlowMod from "./pages/Flow";
import * as ExecuteMod from "./pages/Execute";
import * as JournalMod from "./pages/Journal";

console.log("[App] component file loaded");

let Microscape: React.ComponentType;
let Structure: React.ComponentType;
let Flow: React.ComponentType;
let Execute: React.ComponentType;
let Journal: React.ComponentType;

function resolvePageComponent(moduleValue: unknown, namedExport: string): React.ComponentType {
  if (!moduleValue || typeof moduleValue !== "object") {
    throw new Error(`[App] invalid module for ${namedExport}`);
  }
  const candidate = moduleValue as Record<string, unknown>;
  const resolved = candidate.default ?? candidate[namedExport];
  if (typeof resolved !== "function") {
    throw new Error(`[App] missing component export: ${namedExport}`);
  }
  return resolved as React.ComponentType;
}

try {
  console.log("[App] resolving imports...");
  Microscape = resolvePageComponent(MicroscapeMod, "Microscape");
  Structure = resolvePageComponent(StructureMod, "Structure");
  Flow = resolvePageComponent(FlowMod, "Flow");
  Execute = resolvePageComponent(ExecuteMod, "Execute");
  Journal = resolvePageComponent(JournalMod, "Journal");
  console.log("[App] ✓ imports resolved successfully");
} catch (e) {
  console.error("[App] ✗ FATAL error importing pages:", e);
  throw e;
}

const TABS = [
  { label: "PANORAMA", icon: "📊" },
  { label: "CAM", icon: "🧠" },
  { label: "MACRO", icon: "🧭" },
  { label: "MICROSCAPE", icon: "🔍" },
  { label: "STRUCTURE", icon: "🏗️" },
  { label: "FLOW", icon: "🌊" },
  { label: "EXECUTE", icon: "⚡" },
  { label: "JOURNAL", icon: "📖" },
  { label: "ECONOMIC CALENDAR", icon: "📈" },
  { label: "INTELLIGENCE", icon: "🧠" },
  { label: "CONGRESS ACTIVITY", icon: "🏛️" },
  { label: "LOCAL AI", icon: "🤖" },
  { label: "SUPPLY CHAIN", icon: "🔗" },
  { label: "GWMD MAP", icon: "🗺️" },
  // { label: "OIL TANKERS", icon: "🚢" },
  // { label: "CARGO FLIGHTS", icon: "✈️" },
  { label: "SETTINGS & LOGS", icon: "⚙️" },
] as const;

type Tab = (typeof TABS)[number]["label"];

type StatCardProps = {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "pos" | "neg" | "warn";
};

function StatCard({ label, value, hint, tone }: StatCardProps) {
  return (
    <div className="statCard">
      <div className="statLabel">{label}</div>
      <div className={`statValue ${tone ?? ""}`}>{value}</div>
      {hint && <div className="statHint">{hint}</div>}
    </div>
  );
}

function TerminalWorkspace({ onLogout }: { onLogout: () => void }) {
  console.log("[App] ✓ rendering component");
  const [viewMode] = useState(() => {
    if (typeof window === "undefined") return "main";
    return new URLSearchParams(window.location.search).get("view") ?? "main";
  });

  const loadConfig = useConfigStore((s) => s.loadInitial);
  const prices = useMarketData();

  // Initialize trading system
  useTrading();
  const account = useTradingStore((s) => s.account);
  const positions = useTradingStore((s) => s.positions);
  const uiProfile = useThemeStore((s) => s.uiProfile);
  const colorway = useThemeStore((s) => s.colorway);

  const [tab, setTab] = useState<Tab>("SETTINGS & LOGS");
  const [priceChange, setPriceChange] = useState<number>(0);
  const prevPriceRef = useRef<number | null>(null);

  const [updateState, setUpdateState] = useState<{ version: string; downloaded: boolean } | null>(null);

  useEffect(() => {
    window.updates?.onAvailable((info) => setUpdateState({ version: info.version, downloaded: false }));
    window.updates?.onDownloaded((info) => setUpdateState({ version: info.version, downloaded: true }));
  }, []);

  const currentSymbol = "AAPL";

  const preloadOk = useStreamStore((s) => s.preloadOk);
  const hb = useStreamStore((s) => s.lastHeartbeat);
  const source = useStreamStore((s) => s.source);

  const hbSeq = hb?.seq ?? 0;
  const hbTs = hb?.ts ?? null;

  const hbTime = useMemo(() => {
    if (!hbTs) return "—";
    try {
      return new Date(hbTs).toLocaleTimeString("de-DE", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
    } catch {
      return "—";
    }
  }, [hbTs]);

  const last = prices?.[currentSymbol];

  // Calculate total position info
  const totalPositionQty = positions.reduce((sum, p) => sum + Math.abs(p.qty), 0);

  // Detect price changes for visual feedback
  useEffect(() => {
    // Load persisted config (watchlists, layout selection)
    loadConfig?.();
  }, [loadConfig]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const body = document.body;
    body.dataset.uiProfile = uiProfile;
    body.dataset.colorway = colorway;
  }, [uiProfile, colorway]);

  useEffect(() => {
    if (typeof last === "number") {
      if (prevPriceRef.current !== null) {
        setPriceChange(last - prevPriceRef.current);
      }
      prevPriceRef.current = last;
    }
  }, [last]);

  const sourceLabel = source === "demo" ? "Simulated" : source === "replay" ? "Replay" : "Live";
  const sourceTone = source === "demo" ? "sim" : source === "replay" ? "replay" : "live";
  const hbLabel = hbTime === "—" ? "Waiting" : hbTime;
  const showTabIcons = uiProfile === "friendly";

  if (viewMode === "api-hub") {
    return <ApiHub />;
  }

  if (viewMode === "smart-routing") {
    return <SmartRoutingOverview />;
  }

  if (viewMode === "global-map") {
    return <GlobalSupplyChainMap />;
  }

  return (
    <div className={`appFrame theme-${uiProfile}`}>
      {updateState && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
          background: updateState.downloaded ? 'var(--pos, #16a34a)' : '#d97706',
          color: '#fff', padding: '6px 16px', fontSize: 12,
          fontFamily: "'IBM Plex Mono', monospace", letterSpacing: '0.08em',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span>
            {updateState.downloaded
              ? `● UPDATE READY — v${updateState.version} downloaded. Restart to install.`
              : `○ UPDATE AVAILABLE — v${updateState.version} is downloading in the background…`}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {updateState.downloaded && (
              <button
                onClick={() => window.updates?.install()}
                style={{
                  background: '#fff', color: '#15803d', border: 'none',
                  padding: '2px 10px', borderRadius: 3, cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: 11, fontWeight: 700,
                }}
              >
                RESTART &amp; INSTALL
              </button>
            )}
            <button
              onClick={() => setUpdateState(null)}
              style={{
                background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.4)',
                padding: '2px 8px', borderRadius: 3, cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 11,
              }}
            >
              DISMISS
            </button>
          </div>
        </div>
      )}
      <div className="chrome">
        <header className="proHeader">
          <div className="headerLeft">
            <div className="brandCluster">
              <div className="brandMark">TC</div>
              <div className="brandMeta">
                <div className="brandTitle">Trading Terminal</div>
                <div className="brandSubline">Flow · Execution · Journal</div>
              </div>
            </div>

            <div className="liveRail">
              <LastPricePill symbol={currentSymbol} />

              <div className={`badge source ${sourceTone}`}>
                <span className={`statusIndicator ${source === "demo" ? "ok" : source === "replay" ? "warn" : "ok"} pulse`} />
                <span className="badgeLabel">{sourceLabel}</span>
              </div>

              <div className={`badge delta ${priceChange === 0 ? "neutral" : priceChange > 0 ? "pos" : "neg"}`}>
                <div className="pillLabel">Tick</div>
                <div className="pillValue">
                  {priceChange === 0 ? "Flat" : priceChange > 0 ? "▲" : "▼"}
                  {priceChange !== 0 ? ` ${Math.abs(priceChange).toFixed(2)}` : ""}
                </div>
              </div>

              <div className="badge subtle">
                <div className="pillLabel">Heartbeat</div>
                <div className="pillValue">{hbLabel}</div>
              </div>
            </div>
          </div>

          <div className="headerRight">
            <button className="tab" type="button" onClick={onLogout}>
              Logout
            </button>
            <div className="statGrid">
              <StatCard
                label="Daily P&L"
                value={account ? `${account.dailyPnl >= 0 ? "+" : ""}$${account.dailyPnl.toFixed(2)}` : "—"}
                hint={account ? "Marked to market" : "Waiting for account"}
                {...(account ? { tone: account.dailyPnl >= 0 ? "pos" : "neg" } : {})}
              />

              <StatCard
                label="Open Positions"
                value={totalPositionQty > 0 ? `${positions.length} / ${totalPositionQty} shs` : "Flat"}
                hint={totalPositionQty > 0 ? "Gross exposure" : "No active risk"}
              />

              <StatCard
                label="HB Seq"
                value={hbSeq}
                hint="Stream health"
                {...(!preloadOk ? { tone: "warn" as const } : {})}
              />

              <StatCard
                label="Preload"
                value={preloadOk ? "Ready" : "Missing"}
                hint={preloadOk ? "Bridge online" : "Check preload script"}
                tone={preloadOk ? "pos" : "neg"}
              />
            </div>
          </div>
        </header>

        <nav className="tabs proTabs">
          {TABS.map((tabConfig) => {
            const active = tabConfig.label === tab;
            return (
              <button
                key={tabConfig.label}
                onClick={() => setTab(tabConfig.label)}
                className={`tab ${active ? "active" : ""}`}
              >
                {showTabIcons && <span className="tabIcon">{tabConfig.icon}</span>}
                <span className="tabLabel">{tabConfig.label}</span>
              </button>
            );
          })}
        </nav>

        <main className="contentShell">
          <div className="contentPanel">
            {tab === "PANORAMA" && <Panorama />}
            {tab === "CAM" && <Cam />}
            {tab === "MACRO" && <Macro />}
            {tab === "MICROSCAPE" && <Microscape />}
            {tab === "STRUCTURE" && <Structure />}
            {tab === "FLOW" && <Flow />}
            {tab === "EXECUTE" && <Execute />}
            {tab === "JOURNAL" && <Journal />}
            {tab === "ECONOMIC CALENDAR" && <EconomicCalendar />}
            {tab === "INTELLIGENCE" && <Intelligence />}
            {tab === "CONGRESS ACTIVITY" && <CongressActivity />}
            {tab === "LOCAL AI" && <LocalAI />}
            {tab === "SUPPLY CHAIN" && <SupplyChainMindMap />}
            {tab === "GWMD MAP" && <GwmdMapPage />}
            {/* {tab === "OIL TANKERS" && <OilTankerMap />} */}
            {/* {tab === "CARGO FLIGHTS" && <CargoFlightsMap />} */}
            {tab === "SETTINGS & LOGS" && <SettingsLogs />}
          </div>
        </main>
      </div>
    </div>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] caught:', error, info);
  }
  override render() {
    if (this.state.error) {
      return (
        <div className="authGateRoot">
          <div className="authCard">
            <div className="authHeader">
              <div className="brandMark">TC</div>
              <div>
                <div className="brandTitle">Something went wrong</div>
                <div className="brandSubline" style={{ color: 'var(--neg)' }}>{this.state.error.message}</div>
              </div>
            </div>
            <button className="authSubmit" onClick={() => this.setState({ error: null })} type="button">
              Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const bootstrapAuth = async () => {
      try {
        const existing = await readStoredSession();
        if (!mounted) return;

        if (!existing) {
          // No stored session — show the login form
          return;
        }

        if (existing.expiresAtMs - Date.now() > 30_000) {
          // Probe the backend to catch stale Electron-issued tokens before they
          // cause a jarring mid-session kick. If backend is unreachable (null)
          // we trust the token and let normal error handling apply.
          const valid = await probeSessionValid(existing.token);
          if (valid === false) {
            // Backend is reachable but rejected the token — stale IPC session.
            // Show login form silently (no error message needed).
            await writeStoredSession(null);
            return;
          }
          setSession(existing);
          return;
        }

        // Session present but near/past expiry — try refresh
        try {
          const refreshed = await refresh(existing.refreshToken);
          if (mounted) setSession(refreshed);
        } catch {
          // Refresh failed — clear stale session and show clean login form
          await writeStoredSession(null);
          // (no authError: user simply needs to log in again)
        }
      } catch {
        if (mounted) await writeStoredSession(null);
      } finally {
        if (mounted) setAuthReady(true);
      }
    };

    void bootstrapAuth();
    return () => {
      mounted = false;
    };
  }, []);

  const handleAuthenticated = (nextSession: AuthSession) => {
    setSession(nextSession);
    setAuthError(null);
    // (Re-)start stream now that a valid session token is available
    try { startStreamController(); } catch { /* already running or non-fatal */ }
  };

  useEffect(() => {
    const onSessionExpired = async () => {
      // Double-check: only kick out if the session is genuinely gone.
      // A freshly-issued token that hits a feature-level 401 should NOT log the
      // user out — the event would have been suppressed at the source, but be
      // defensive here too.
      const live = await readStoredSession();
      if (live && live.expiresAtMs > Date.now() + 5_000) {
        // Session is still valid in storage — ignore the spurious event.
        return;
      }
      setSession(null);
      setAuthError(null); // show clean login form, no pre-filled error
    };
    window.addEventListener('tc:session-expired', onSessionExpired);
    return () => window.removeEventListener('tc:session-expired', onSessionExpired);
  }, []);

  const handleLogout = async () => {
    await logout();
    setSession(null);
    setAuthError(null);
  };

  if (!authReady) {
    return (
      <div className="loginScreen">
        <div className="loginCard">
          <div className="loginHeader">
            <div className="loginHeaderTitle">TRADING TERMINAL  //  AUTH</div>
            <div className="loginHeaderSep">{'\u2550'.repeat(48)}</div>
            <div className="loginHeaderMeta">SYSTEM: TRADING COCKPIT v2.0 &nbsp;&nbsp; &copy; 2026</div>
          </div>
          <div style={{ color: '#ff6600', fontSize: 12, letterSpacing: '0.12em', fontFamily: "'IBM Plex Mono', 'Courier New', monospace" }}>
            AUTHENTICATING...<span className="loginCursor">█</span>
          </div>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <AuthPanel
        onLogin={login}
        onSignup={signup}
        onAuthenticated={handleAuthenticated}
        initialError={authError}
      />
    );
  }

  return (
    <ErrorBoundary>
      <TerminalWorkspace onLogout={handleLogout} />
    </ErrorBoundary>
  );
}

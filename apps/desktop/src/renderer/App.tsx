import React, { useMemo, useState, useEffect, useRef, useCallback, Component, type ErrorInfo, type ReactNode } from "react";

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
import TerminalAI from "./pages/LocalAI";
import Intelligence from "./pages/Intelligence";
import SupplyChainMindMap from "./pages/SupplyChainMindMap";
import DataVault from "./pages/DataVault";
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
  { label: "TERMINAL AI", icon: "🤖" },
  { label: "SUPPLY CHAIN", icon: "🔗" },
  { label: "DATA VAULT", icon: "🗄️" },
  { label: "GWMD MAP", icon: "🗺️" },
  // { label: "OIL TANKERS", icon: "🚢" },
  // { label: "CARGO FLIGHTS", icon: "✈️" },
  { label: "SETTINGS & LOGS", icon: "⚙️" },
] as const;

type Tab = (typeof TABS)[number]["label"];

const TAB_LABELS = new Set<Tab>(TABS.map((tab) => tab.label));

function asTabLabel(value: string | null): Tab | null {
  if (!value) return null;
  return TAB_LABELS.has(value as Tab) ? (value as Tab) : null;
}

const DETACH_DRAG_DISTANCE_PX = 8;
const DETACH_OUTSIDE_MARGIN_PX = 12;
const TAB_SYNC_CHANNEL = "tc:tabs:sync";

type TabSyncMessage =
  | { type: "detached"; tab: Tab }
  | { type: "reattach"; tab: Tab; activate?: boolean };

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
  const [bootQuery] = useState(() => {
    if (typeof window === "undefined") {
      return {
        viewMode: "main",
        initialTab: null as Tab | null,
      };
    }
    const params = new URLSearchParams(window.location.search);
    return {
      viewMode: params.get("view") ?? "main",
      initialTab: asTabLabel(params.get("tab")),
    };
  });

  const loadConfig = useConfigStore((s) => s.loadInitial);
  const prices = useMarketData();

  // Initialize trading system
  useTrading();
  const account = useTradingStore((s) => s.account);
  const positions = useTradingStore((s) => s.positions);
  const uiProfile = useThemeStore((s) => s.uiProfile);
  const colorway = useThemeStore((s) => s.colorway);

  const [tab, setTab] = useState<Tab>(bootQuery.initialTab ?? "SETTINGS & LOGS");
  const [detachedTabs, setDetachedTabs] = useState<Set<Tab>>(() => new Set());
  const [draggingTab, setDraggingTab] = useState<Tab | null>(null);
  const [priceChange, setPriceChange] = useState<number>(0);
  const prevPriceRef = useRef<number | null>(null);
  const tabStripRef = useRef<HTMLElement | null>(null);
  const tabSyncChannelRef = useRef<BroadcastChannel | null>(null);
  const suppressClickTabRef = useRef<Tab | null>(null);
  const dragStateRef = useRef<{
    tab: Tab;
    pointerId: number;
    startX: number;
    startY: number;
    detached: boolean;
  } | null>(null);

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
  const isDetachedView = bootQuery.viewMode === "detached-tab" && bootQuery.initialTab !== null;
  const detachedViewTab = bootQuery.initialTab;

  const publishTabSync = useCallback((message: TabSyncMessage) => {
    try {
      tabSyncChannelRef.current?.postMessage(message);
    } catch (error) {
      console.warn("[App] tab sync publish failed", error);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
      return;
    }

    const channel = new BroadcastChannel(TAB_SYNC_CHANNEL);
    tabSyncChannelRef.current = channel;

    channel.onmessage = (event: MessageEvent<TabSyncMessage>) => {
      const payload = event.data;
      if (!payload || typeof payload !== "object" || !("type" in payload)) {
        return;
      }

      if (!isDetachedView && payload.type === "detached") {
        setDetachedTabs((prev) => {
          if (prev.has(payload.tab)) return prev;
          const next = new Set(prev);
          next.add(payload.tab);
          return next;
        });
        return;
      }

      if (!isDetachedView && payload.type === "reattach") {
        setDetachedTabs((prev) => {
          if (!prev.has(payload.tab)) return prev;
          const next = new Set(prev);
          next.delete(payload.tab);
          return next;
        });
        if (payload.activate) {
          setTab(payload.tab);
        }
      }
    };

    return () => {
      channel.close();
      if (tabSyncChannelRef.current === channel) {
        tabSyncChannelRef.current = null;
      }
    };
  }, [isDetachedView]);

  useEffect(() => {
    if (isDetachedView && detachedViewTab) {
      publishTabSync({ type: "detached", tab: detachedViewTab });
    }
  }, [isDetachedView, detachedViewTab, publishTabSync]);

  const visibleTabs = useMemo(() => {
    if (isDetachedView) {
      return detachedViewTab ? TABS.filter((item) => item.label === detachedViewTab) : [];
    }
    return TABS.filter((item) => !detachedTabs.has(item.label));
  }, [isDetachedView, detachedViewTab, detachedTabs]);

  useEffect(() => {
    if (isDetachedView) {
      return;
    }
    if (detachedTabs.has(tab)) {
      const firstVisible = TABS.find((item) => !detachedTabs.has(item.label))?.label;
      if (firstVisible) {
        setTab(firstVisible);
      }
    }
  }, [isDetachedView, detachedTabs, tab]);

  const clearDetachGesture = useCallback(() => {
    setDraggingTab(null);
    dragStateRef.current = null;
  }, []);

  const openDetachedTabWindow = useCallback(async (detachedTab: Tab) => {
    if (!isDetachedView) {
      setDetachedTabs((prev) => {
        if (prev.has(detachedTab)) return prev;
        const next = new Set(prev);
        next.add(detachedTab);
        return next;
      });
      publishTabSync({ type: "detached", tab: detachedTab });
    }

    try {
      const opened = await window.cockpit?.tabs?.openWindow?.(detachedTab);
      if (!opened && typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.set("view", "detached-tab");
        url.searchParams.set("tab", detachedTab);
        window.open(url.toString(), "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      console.warn("[App] failed to open detached tab window", error);
    }
  }, [isDetachedView, publishTabSync]);

  const reattachTabToMain = useCallback((targetTab: Tab, activate = true) => {
    setDetachedTabs((prev) => {
      if (!prev.has(targetTab)) return prev;
      const next = new Set(prev);
      next.delete(targetTab);
      return next;
    });
    publishTabSync({ type: "reattach", tab: targetTab, activate });
  }, [publishTabSync]);

  const addDetachedTabBackAndClose = useCallback((targetTab: Tab) => {
    reattachTabToMain(targetTab, true);
    if (typeof window !== "undefined") {
      window.close();
    }
  }, [reattachTabToMain]);

  const onTabPointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>, nextTab: Tab) => {
    if (event.button !== 0) return;

    clearDetachGesture();
    dragStateRef.current = {
      tab: nextTab,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      detached: false,
    };

    event.currentTarget.setPointerCapture(event.pointerId);
  }, [clearDetachGesture]);

  const onTabPointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const state = dragStateRef.current;
    if (!state || state.pointerId !== event.pointerId || state.detached) {
      return;
    }

    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    const dragDistance = Math.hypot(dx, dy);
    if (dragDistance < DETACH_DRAG_DISTANCE_PX) {
      return;
    }

    if (draggingTab !== state.tab) {
      setDraggingTab(state.tab);
    }

    const tabStrip = tabStripRef.current;
    if (!tabStrip) {
      return;
    }
    const rect = tabStrip.getBoundingClientRect();
    const draggedOutsideStrip =
      event.clientX < rect.left - DETACH_OUTSIDE_MARGIN_PX ||
      event.clientX > rect.right + DETACH_OUTSIDE_MARGIN_PX ||
      event.clientY < rect.top - DETACH_OUTSIDE_MARGIN_PX ||
      event.clientY > rect.bottom + DETACH_OUTSIDE_MARGIN_PX;

    if (!draggedOutsideStrip) {
      return;
    }

    state.detached = true;
    suppressClickTabRef.current = state.tab;

    event.preventDefault();
    event.stopPropagation();
    void openDetachedTabWindow(state.tab);
  }, [draggingTab, openDetachedTabWindow]);

  const onTabPointerEnd = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const state = dragStateRef.current;
    if (!state || state.pointerId !== event.pointerId) {
      return;
    }

    setDraggingTab(null);
    dragStateRef.current = null;
  }, []);

  const renderTabContent = (activeTab: Tab) => {
    return (
      <>
        {activeTab === "PANORAMA" && <Panorama />}
        {activeTab === "CAM" && <Cam />}
        {activeTab === "MACRO" && <Macro />}
        {activeTab === "MICROSCAPE" && <Microscape />}
        {activeTab === "STRUCTURE" && <Structure />}
        {activeTab === "FLOW" && <Flow />}
        {activeTab === "EXECUTE" && <Execute />}
        {activeTab === "JOURNAL" && <Journal />}
        {activeTab === "ECONOMIC CALENDAR" && <EconomicCalendar />}
        {activeTab === "INTELLIGENCE" && <Intelligence />}
        {activeTab === "CONGRESS ACTIVITY" && <CongressActivity />}
        {activeTab === "TERMINAL AI" && <TerminalAI />}
        {activeTab === "SUPPLY CHAIN" && <SupplyChainMindMap />}
        {activeTab === "DATA VAULT" && <DataVault />}
        {activeTab === "GWMD MAP" && <GwmdMapPage />}
        {activeTab === "SETTINGS & LOGS" && <SettingsLogs />}
      </>
    );
  };

  if (bootQuery.viewMode === "api-hub") {
    return <ApiHub />;
  }

  if (bootQuery.viewMode === "smart-routing") {
    return <SmartRoutingOverview />;
  }

  if (bootQuery.viewMode === "global-map") {
    return <GlobalSupplyChainMap />;
  }

  if (
    bootQuery.viewMode === "gwmd-wall" ||
    bootQuery.viewMode === "gwmd-analyst" ||
    bootQuery.viewMode === "gwmd-mirror"
  ) {
    return (
      <div
        style={{
          width: "100vw",
          height: "100vh",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <GwmdMapPage />
      </div>
    );
  }

  if (isDetachedView && detachedViewTab) {
    return (
      <div className={`appFrame theme-${uiProfile}`}>
        <div className="chrome detachedWindowChrome">
          <div className="detachedTabBar">
            <div className="detachedTabTitle">Detached Tab: {detachedViewTab}</div>
            <button
              className="tab detachedTabAction"
              type="button"
              onClick={() => addDetachedTabBackAndClose(detachedViewTab)}
            >
              Add Back To Main
            </button>
          </div>
          <main className="contentShell">
            <div className="contentPanel">
              {renderTabContent(detachedViewTab)}
            </div>
          </main>
        </div>
      </div>
    );
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

        <nav className="tabs proTabs" ref={tabStripRef}>
          {visibleTabs.map((tabConfig) => {
            const active = tabConfig.label === tab;
            const dragging = draggingTab === tabConfig.label;
            return (
              <button
                key={tabConfig.label}
                onPointerDown={(event) => onTabPointerDown(event, tabConfig.label)}
                onPointerMove={onTabPointerMove}
                onPointerUp={onTabPointerEnd}
                onPointerCancel={onTabPointerEnd}
                onLostPointerCapture={onTabPointerEnd}
                onClick={() => {
                  if (suppressClickTabRef.current === tabConfig.label) {
                    suppressClickTabRef.current = null;
                    return;
                  }
                  setTab(tabConfig.label);
                }}
                className={`tab ${active ? "active" : ""} ${dragging ? "dragging" : ""}`}
              >
                {showTabIcons && <span className="tabIcon">{tabConfig.icon}</span>}
                <span className="tabLabel">{tabConfig.label}</span>
              </button>
            );
          })}
          {Array.from(detachedTabs).map((detachedTabLabel) => (
            <button
              key={`restore-${detachedTabLabel}`}
              className="tab tabDetachedRestore"
              type="button"
              onClick={() => reattachTabToMain(detachedTabLabel, true)}
              title={`Add ${detachedTabLabel} back`}
            >
              + {detachedTabLabel}
            </button>
          ))}
        </nav>

        <main className="contentShell">
          <div className="contentPanel">
            {renderTabContent(tab)}
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

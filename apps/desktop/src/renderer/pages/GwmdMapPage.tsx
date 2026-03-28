/**
 * GWMD Map Page
 * Global World Mind-Map Data for company supply chain relationships
 * Search companies, visualize relationships incrementally, persist across sessions
 */

import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useGwmdMapStore } from "../store/gwmdMapStore";
import { useSettingsStore } from "../store/settingsStore";
import GwmdWorldMap from "../components/supplyChain/GwmdWorldMap";
import ContextPanel from "../components/supplyChain/ContextPanel";
import { TedMapOverlayPanel } from "../components/tedIntel/TedIntelWidgets";
import ExposureBriefPanel from "../components/exposureBrief/ExposureBriefPanel";
import type { MindMapData, SupplyChainGraph } from "@tc/shared/supplyChain";

const COLORS = {
  bg: "#0a0e1a",
  bgSecondary: "#151923",
  border: "#1f2937",
  text: "#e5e7eb",
  textMuted: "#9ca3af",
  accent: "#3b82f6",
  success: "#22c55e",
  warning: "#eab308",
  error: "#ef4444",
};

const GWMD_VIEW_SNAPSHOT_KEY = "gwmd:display-snapshot:v1";
const GWMD_VIEW_SNAPSHOT_TTL = 1000 * 60 * 20;
const GWMD_WALL_SYNC_CHANNEL_PREFIX = "gwmd-wall-sync";

type GwmdDisplayMonitor = {
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

type GwmdDisplaySurfaceState = {
  enabled: boolean;
  mode: "standard" | "wall" | "analyst" | "mirror";
  monitorCount: number;
  arrangement: "single" | "multi";
  bounds: { x: number; y: number; width: number; height: number };
  selectedMonitorIds?: number[];
  primaryMonitorId?: number | null;
  displayMode?: "standard" | "wall" | "analyst" | "mirror";
  wallSessionId?: string | null;
  monitors?: GwmdDisplayMonitor[];
};

export default function GwmdMapPage() {
  const {
    loading,
    error,
    runStatus,
    runMeta,
    searchTrace,
    graph,
    companies,
    searchTicker,
    search,
    reset,
    clearPersisted,
    selectedNodeId,
    setSelectedNode,
    selectedEdgeId,
    setSelectedEdge,
    showEmpty,
    setShowEmpty,
    gwmdFilters,
    setGwmdFilters,
    loadFromDb,
    syncState,
    pushToCloud,
    pullFromCloud,
    refreshCloudSyncStatus,
  } = useGwmdMapStore();

  const [searchInput, setSearchInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchInFlight, setSearchInFlight] = useState(false);
  const [displaySurfaceBusy, setDisplaySurfaceBusy] = useState(false);
  const [displaySurfaceNotice, setDisplaySurfaceNotice] = useState<string | null>(null);
  const [showMonitorPicker, setShowMonitorPicker] = useState(false);
  const [availableMonitors, setAvailableMonitors] = useState<GwmdDisplayMonitor[]>([]);
  const [selectedMonitorIds, setSelectedMonitorIds] = useState<number[]>([]);
  const [primaryMonitorId, setPrimaryMonitorId] = useState<number | null>(null);
  const [targetDisplayMode, setTargetDisplayMode] = useState<"wall" | "analyst" | "mirror">("wall");
  const [showExposureBrief, setShowExposureBrief] = useState(false);
  const [viewportSize, setViewportSize] = useState({
    width: typeof window !== "undefined" ? window.innerWidth : 1440,
    height: typeof window !== "undefined" ? window.innerHeight : 900,
  });
  const [displaySurfaceState, setDisplaySurfaceState] =
    useState<GwmdDisplaySurfaceState | null>(null);

  const wallContext = useMemo(() => {
    if (typeof window === "undefined") {
      return {
        isDisplayMode: false,
        displayMode: "standard" as "standard" | "wall" | "analyst" | "mirror",
        wallSessionId: null,
        wallRole: "primary" as "primary" | "satellite",
        wallMonitorId: null as number | null,
        wallPrimaryMonitorId: null as number | null,
      };
    }

    const params = new URLSearchParams(window.location.search);
    const monitorIdRaw = Number(params.get("monitorId"));
    const primaryMonitorRaw = Number(params.get("primaryMonitorId"));
    const view = params.get("view");
    const inferredMode: "standard" | "wall" | "analyst" | "mirror" =
      view === "gwmd-wall"
        ? "wall"
        : view === "gwmd-analyst"
          ? "analyst"
          : view === "gwmd-mirror"
            ? "mirror"
            : "standard";

    return {
      isDisplayMode: inferredMode !== "standard",
      displayMode: inferredMode,
      wallSessionId: params.get("wallSession"),
      wallRole: params.get("wallRole") === "satellite" ? "satellite" : "primary",
      wallMonitorId: Number.isFinite(monitorIdRaw) ? monitorIdRaw : null,
      wallPrimaryMonitorId: Number.isFinite(primaryMonitorRaw)
        ? primaryMonitorRaw
        : null,
    };
  }, []);
  const wallSyncChannelRef = useRef<BroadcastChannel | null>(null);
  const wallSyncClientIdRef = useRef(
    `gwmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  const wallSyncApplyRef = useRef(false);

  const getCloudModelFor = useSettingsStore((s) => s.getCloudModelFor);
  const aiFeatureRouting = useSettingsStore((s) => s.aiFeatureRouting);
  const cloudAiModels = useSettingsStore((s) => s.cloudAiModels);
  const isWallMode = wallContext.displayMode === "wall";
  const isAnalystMode = wallContext.displayMode === "analyst";
  const isMirrorMode = wallContext.displayMode === "mirror";
  const isDisplayMode = wallContext.isDisplayMode;
  const isWallSatellite = isDisplayMode && wallContext.wallRole === "satellite";
  const isWallPrimary = isDisplayMode && wallContext.wallRole !== "satellite";

  const [showTedOverlay, setShowTedOverlay] = useState(false);

  const restoreDisplaySnapshot = useCallback(() => {
    if (typeof window === "undefined") return false;
    try {
      const raw = window.localStorage.getItem(GWMD_VIEW_SNAPSHOT_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw) as {
        timestamp?: number;
        searchInput?: string;
        graph?: SupplyChainGraph | null;
        companies?: unknown[];
        selectedNodeId?: string | null;
        selectedEdgeId?: string | null;
        showEmpty?: boolean;
        gwmdFilters?: {
          region: string;
          relation: string;
          showFlows: boolean;
          showOnlyImpacted: boolean;
          hops?: number;
        };
      };
      const ts = typeof parsed.timestamp === "number" ? parsed.timestamp : 0;
      if (!ts || Date.now() - ts > GWMD_VIEW_SNAPSHOT_TTL) {
        return false;
      }
      if (!parsed.graph || !Array.isArray(parsed.graph.nodes) || parsed.graph.nodes.length === 0) {
        return false;
      }

      useGwmdMapStore.setState((state) => ({
        ...state,
        graph: parsed.graph ?? state.graph,
        companies: Array.isArray(parsed.companies) ? (parsed.companies as typeof state.companies) : state.companies,
        selectedNodeId:
          typeof parsed.selectedNodeId === "string" || parsed.selectedNodeId === null
            ? parsed.selectedNodeId
            : state.selectedNodeId,
        selectedEdgeId:
          typeof parsed.selectedEdgeId === "string" || parsed.selectedEdgeId === null
            ? parsed.selectedEdgeId
            : state.selectedEdgeId,
        showEmpty: typeof parsed.showEmpty === "boolean" ? parsed.showEmpty : state.showEmpty,
        gwmdFilters: {
          ...state.gwmdFilters,
          ...(parsed.gwmdFilters ?? {}),
        },
      }));

      if (typeof parsed.searchInput === "string") {
        setSearchInput(parsed.searchInput);
      }
      return true;
    } catch {
      return false;
    }
  }, []);

  const saveDisplaySnapshot = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      const state = useGwmdMapStore.getState();
      window.localStorage.setItem(
        GWMD_VIEW_SNAPSHOT_KEY,
        JSON.stringify({
          timestamp: Date.now(),
          searchInput,
          graph: state.graph,
          companies: state.companies,
          selectedNodeId: state.selectedNodeId,
          selectedEdgeId: state.selectedEdgeId,
          showEmpty: state.showEmpty,
          gwmdFilters: state.gwmdFilters,
        }),
      );
    } catch {
      // Ignore snapshot persistence failures.
    }
  }, [searchInput]);

  const refreshDisplayMonitors = useCallback(async () => {
    const api = window.cockpit?.gwmdMap;
    if (!api?.listDisplayMonitors) {
      setDisplaySurfaceNotice("Display monitor API is not available in this session.");
      return [] as GwmdDisplayMonitor[];
    }

    try {
      const monitors = await api.listDisplayMonitors();
      if (!Array.isArray(monitors)) {
        setDisplaySurfaceNotice("Unable to read connected monitors.");
        return [] as GwmdDisplayMonitor[];
      }

      const typed = monitors as GwmdDisplayMonitor[];
      setAvailableMonitors(typed);

      if (typed.length === 0) {
        setDisplaySurfaceNotice("No displays were detected for Wall Mode.");
        return typed;
      }

      setDisplaySurfaceNotice(null);
      return typed;
    } catch {
      setDisplaySurfaceNotice("Failed to query displays. Try again after reopening GWMD.");
      return [] as GwmdDisplayMonitor[];
    }
  }, []);

  // Load persisted data on mount
  useEffect(() => {
    const restored = isDisplayMode ? restoreDisplaySnapshot() : false;
    if (!restored) {
      loadFromDb();
    } else {
      window.setTimeout(() => {
        void loadFromDb();
      }, 1800);
    }
    refreshCloudSyncStatus();
  }, [isDisplayMode, loadFromDb, refreshCloudSyncStatus, restoreDisplaySnapshot]);

  useEffect(() => {
    const onResize = () => {
      setViewportSize({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const api = window.cockpit?.gwmdMap;
    if (!api?.getDisplaySurfaceState) {
      return;
    }

    const pullState = async () => {
      try {
        const [state, monitors, selection] = await Promise.all([
          api.getDisplaySurfaceState?.(),
          api.listDisplayMonitors?.(),
          api.getDisplaySurfaceSelection?.(),
        ]);
        if (active && state) {
          const typedState = state as GwmdDisplaySurfaceState;
          setDisplaySurfaceState(typedState);
          if (
            typedState.mode === "wall" ||
            typedState.mode === "analyst" ||
            typedState.mode === "mirror"
          ) {
            setTargetDisplayMode(typedState.mode);
          }
        }
        if (active && Array.isArray(monitors)) {
          const typedMonitors = monitors as GwmdDisplayMonitor[];
          setAvailableMonitors(typedMonitors);
          if (!selection || !Array.isArray((selection as { monitorIds?: unknown[] }).monitorIds)) {
            const fallbackIds = typedMonitors.map((monitor) => monitor.id);
            setSelectedMonitorIds(fallbackIds);
            setPrimaryMonitorId(fallbackIds[0] ?? null);
          }
        }
        if (active && selection) {
          const typedSelection = selection as {
            monitorIds?: number[];
            primaryMonitorId?: number | null;
            mode?: "standard" | "wall" | "analyst" | "mirror";
          };
          const monitorIds = Array.isArray(typedSelection.monitorIds)
            ? typedSelection.monitorIds.filter(
                (id) => typeof id === "number" && Number.isFinite(id),
              )
            : [];
          if (monitorIds.length > 0) {
            setSelectedMonitorIds(monitorIds);
            setPrimaryMonitorId(
              typeof typedSelection.primaryMonitorId === "number" &&
                monitorIds.includes(typedSelection.primaryMonitorId)
                ? typedSelection.primaryMonitorId
                : monitorIds[0] ?? null,
            );
          }
          if (
            typedSelection.mode === "wall" ||
            typedSelection.mode === "analyst" ||
            typedSelection.mode === "mirror"
          ) {
            setTargetDisplayMode(typedSelection.mode);
          }
        }
      } catch {
        setDisplaySurfaceNotice("Wall Mode controls are waiting for display services.");
      }
    };

    void pullState();
    const off = api.onDisplaySurfaceChanged?.((state) => {
      if (active) {
        const typed = state as GwmdDisplaySurfaceState;
        setDisplaySurfaceState(typed);
        if (typed.mode === "wall" || typed.mode === "analyst" || typed.mode === "mirror") {
          setTargetDisplayMode(typed.mode);
        }
        if (Array.isArray(typed.monitors)) {
          setAvailableMonitors(typed.monitors);
        }
        if (Array.isArray(typed.selectedMonitorIds) && typed.selectedMonitorIds.length > 0) {
          setSelectedMonitorIds(typed.selectedMonitorIds);
          setPrimaryMonitorId(
            typeof typed.primaryMonitorId === "number" &&
              typed.selectedMonitorIds.includes(typed.primaryMonitorId)
              ? typed.primaryMonitorId
              : typed.selectedMonitorIds[0] ?? null,
          );
        }
      }
    });

    return () => {
      active = false;
      off?.();
    };
  }, []);

  const handleToggleMonitorPicker = useCallback(async () => {
    if (showMonitorPicker) {
      setShowMonitorPicker(false);
      return;
    }

    const monitors =
      availableMonitors.length > 0 ? availableMonitors : await refreshDisplayMonitors();
    if (monitors.length === 0) {
      setShowMonitorPicker(false);
      return;
    }

    if (selectedMonitorIds.length === 0) {
      const ids = monitors.map((monitor) => monitor.id);
      setSelectedMonitorIds(ids);
      setPrimaryMonitorId(ids[0] ?? null);
    }

    setShowMonitorPicker(true);
  }, [
    availableMonitors,
    refreshDisplayMonitors,
    selectedMonitorIds.length,
    showMonitorPicker,
  ]);

  useEffect(() => {
    const api = window.cockpit?.gwmdMap;
    if (!api?.onGraphUpdated) {
      return;
    }

    let timer: number | null = null;
    const off = api.onGraphUpdated(() => {
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      timer = window.setTimeout(() => {
        void loadFromDb();
        timer = null;
      }, 400);
    });

    return () => {
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      off?.();
    };
  }, [loadFromDb]);

  useEffect(() => {
    if (
      !isDisplayMode ||
      !wallContext.wallSessionId ||
      typeof BroadcastChannel === "undefined"
    ) {
      return;
    }

    const channel = new BroadcastChannel(
      `${GWMD_WALL_SYNC_CHANNEL_PREFIX}:${wallContext.wallSessionId}`,
    );
    wallSyncChannelRef.current = channel;

    channel.onmessage = (
      event: MessageEvent<{
        type?: string;
        senderId?: string;
        payload?: {
          selectedNodeId?: string | null;
          selectedEdgeId?: string | null;
          gwmdFilters?: {
            region: string;
            relation: string;
            showFlows: boolean;
            showOnlyImpacted: boolean;
            hops?: number;
          };
          showEmpty?: boolean;
          searchInput?: string;
        };
      }>,
    ) => {
      const message = event.data;
      if (!message || message.type !== "ui-sync") return;
      if (message.senderId === wallSyncClientIdRef.current) return;
      const payload = message.payload;
      if (!payload) return;

      wallSyncApplyRef.current = true;
      try {
        if (
          typeof payload.selectedNodeId === "string" ||
          payload.selectedNodeId === null
        ) {
          setSelectedNode(payload.selectedNodeId);
        }
        if (
          typeof payload.selectedEdgeId === "string" ||
          payload.selectedEdgeId === null
        ) {
          setSelectedEdge(payload.selectedEdgeId);
        }
        if (payload.gwmdFilters) {
          setGwmdFilters({
            ...useGwmdMapStore.getState().gwmdFilters,
            ...payload.gwmdFilters,
          });
        }
        if (typeof payload.showEmpty === "boolean") {
          setShowEmpty(payload.showEmpty);
        }
        if (typeof payload.searchInput === "string") {
          setSearchInput(payload.searchInput);
        }
      } finally {
        wallSyncApplyRef.current = false;
      }
    };

    return () => {
      channel.close();
      if (wallSyncChannelRef.current === channel) {
        wallSyncChannelRef.current = null;
      }
    };
  }, [
    isWallMode,
    setGwmdFilters,
    setSelectedEdge,
    setSelectedNode,
    setShowEmpty,
    wallContext.wallSessionId,
  ]);

  useEffect(() => {
    if (!isDisplayMode || !isWallPrimary) {
      return;
    }
    if (wallSyncApplyRef.current) {
      return;
    }
    const channel = wallSyncChannelRef.current;
    if (!channel) {
      return;
    }

    try {
      channel.postMessage({
        type: "ui-sync",
        senderId: wallSyncClientIdRef.current,
        payload: {
          selectedNodeId,
          selectedEdgeId,
          gwmdFilters,
          showEmpty,
          searchInput,
        },
      });
    } catch {
      // Ignore transient BroadcastChannel failures.
    }
  }, [
    gwmdFilters,
    isDisplayMode,
    isWallPrimary,
    searchInput,
    selectedEdgeId,
    selectedNodeId,
    showEmpty,
  ]);

  const syncStatusLabel = useMemo(() => {
    if (syncState.mode === "pushing") return "Pushing";
    if (syncState.mode === "pulling") return "Pulling";
    return syncState.status;
  }, [syncState.mode, syncState.status]);

  const syncStatusColor = useMemo(() => {
    if (syncState.mode === "pushing" || syncState.mode === "pulling") return COLORS.warning;
    if (syncState.status === "ok") return COLORS.success;
    if (syncState.status === "error") return COLORS.error;
    return COLORS.textMuted;
  }, [syncState.mode, syncState.status]);

  const syncMetaLine = useMemo(() => {
    const when = syncState.lastSyncAt
      ? new Date(syncState.lastSyncAt).toLocaleString()
      : "Never";
    return `Cloud v${syncState.cloudVersion} • Last sync: ${when} • Cloud counts: ${syncState.companiesCount} companies / ${syncState.relationshipsCount} relationships`;
  }, [
    syncState.cloudVersion,
    syncState.lastSyncAt,
    syncState.companiesCount,
    syncState.relationshipsCount,
  ]);

  const handleSyncToCloud = useCallback(async () => {
    try {
      await pushToCloud(true);
    } catch {
      // Store captures and surfaces sync error state.
    }
  }, [pushToCloud]);

  const handleSyncFromCloud = useCallback(async () => {
    try {
      await pullFromCloud({ replace: true });
    } catch {
      // Store captures and surfaces sync error state.
    }
  }, [pullFromCloud]);

  const suggestions = useMemo(() => {
    if (!searchInput.trim()) return [] as Array<{ ticker: string; name: string }>;

    const term = searchInput.toUpperCase();
    const all = new Map<string, string>();

    companies.forEach((cmp) => {
      if (cmp.ticker && !all.has(cmp.ticker)) {
        all.set(cmp.ticker, cmp.name || cmp.ticker);
      }
      if (cmp.name && cmp.name.toUpperCase().includes(term) && !all.has(cmp.ticker)) {
        all.set(cmp.ticker, cmp.name);
      }
    });

    return Array.from(all.entries())
      .filter(([ticker, name]) => ticker.includes(term) || name.toUpperCase().includes(term))
      .map(([ticker, name]) => ({ ticker, name }))
      .slice(0, 8);
  }, [searchInput, companies]);

  const resolveSelectedGwmdModel = useCallback(async () => {
    const routedProvider = aiFeatureRouting?.supplyChain;
    if (routedProvider && routedProvider !== "auto") {
      const routed = cloudAiModels.find(
        (entry) => entry.enabled && entry.provider === routedProvider,
      );
      if (routed?.model) {
        return {
          provider: routed.provider.toLowerCase(),
          model: routed.model,
        };
      }
    }

    const settingsApi = window.cockpit?.journal;
    if (settingsApi?.settingsGet) {
      try {
        const settings = await settingsApi.settingsGet();
        const primary = settings?.primaryAiModel as
          | { provider?: string; model?: string }
          | undefined;
        if (primary?.model && primary.model.trim().length > 0) {
          return {
            provider: (primary.provider || "ollama").toLowerCase(),
            model: primary.model.trim(),
          };
        }
      } catch (err) {
        console.warn("[GWMD] failed to load primaryAiModel from settings", err);
      }
    }

    // Fallback to existing GWMD cloud-model feature assignment.
    return getCloudModelFor?.("supplyChain") || null;
  }, [aiFeatureRouting?.supplyChain, cloudAiModels, getCloudModelFor]);

  const handleSearch = useCallback(async (ticker: string) => {
    if (!ticker.trim() || searchInFlight) return;

    const normalizedTicker = ticker.trim().toUpperCase();
    const requestedHops = Math.max(1, Math.min(3, gwmdFilters.hops ?? 2));
    setSearchInput(normalizedTicker);
    setShowSuggestions(false);
    setSearchInFlight(true);

    const model = await resolveSelectedGwmdModel();
    console.log("[GWMD] Searching for", normalizedTicker, "with model:", model || "default");

    try {
      await search(normalizedTicker, { model, hops: requestedHops });
    } finally {
      setSearchInFlight(false);
    }
  }, [gwmdFilters.hops, search, resolveSelectedGwmdModel, searchInFlight]);

  const handleSuggestionClick = useCallback(
    (ticker: string) => {
      handleSearch(ticker);
    },
    [handleSearch]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const ticker = searchInput.trim().toUpperCase();
      if (ticker) handleSearch(ticker);
    }
  };

  const statusLine = useMemo(() => {
    const base = `Loaded: ${companies.length} companies • Relationships: ${(graph?.edges ?? []).length}`;
    const hopText = `Display hops: ${Math.max(1, Math.min(3, gwmdFilters.hops ?? 2))}`;
    const source = typeof runMeta?.source === "string" ? runMeta.source : "";
    const unlocatedCount = typeof runMeta?.unlocatedCount === "number" ? runMeta.unlocatedCount : undefined;

    const modeText =
      runStatus === "degraded_cache"
        ? "Mode: Scoped cache fallback"
        : runStatus === "parse_fail"
          ? "Mode: Parse failure"
          : "Mode: Fresh";

    const sourceText = source ? `Source: ${source}` : null;
    const unlocatedText = typeof unlocatedCount === "number" ? `Unlocated: ${unlocatedCount}` : null;

    return [base, hopText, modeText, sourceText, unlocatedText].filter(Boolean).join(" • ");
  }, [companies.length, graph, gwmdFilters.hops, runStatus, runMeta]);

  const showSearchLoadingBar = searchInFlight || (loading && Boolean(searchInput.trim()));

  const searchTraceColor = useMemo(() => {
    if (searchTrace.phase === "error") return COLORS.error;
    if (
      searchTrace.phase === "ipc_timeout" ||
      searchTrace.phase === "http_fallback" ||
      searchTrace.phase === "waiting_ipc_after_503"
    ) {
      return COLORS.warning;
    }
    if (searchTrace.phase === "success") return COLORS.success;
    return COLORS.textMuted;
  }, [searchTrace.phase]);

  const searchTraceLine = useMemo(() => {
    if (searchTrace.phase === "idle") return "Search trace: idle";
    const ticker = searchTrace.ticker ? `${searchTrace.ticker} ` : "";
    const source = `via ${searchTrace.source}`;
    const when = new Date(searchTrace.updatedAt).toLocaleTimeString();
    return `Search trace: ${ticker}${searchTrace.phase} (${source}) at ${when} • ${searchTrace.message}`;
  }, [searchTrace]);

  const geoStats = useMemo(() => {
    const located = companies.reduce((count, company) => {
      const lat = typeof company.hqLat === "number" && Number.isFinite(company.hqLat);
      const lon = typeof company.hqLon === "number" && Number.isFinite(company.hqLon);
      return lat && lon ? count + 1 : count;
    }, 0);
    return {
      located,
      unlocated: Math.max(0, companies.length - located),
    };
  }, [companies]);

  const handleDeleteStoredData = useCallback(async () => {
    const confirmed = window.confirm("Delete all stored GWMD map data from local database?");
    if (!confirmed) return;
    await clearPersisted();
  }, [clearPersisted]);

  const handleEnableDisplaySurface = useCallback(async () => {
    const api = window.cockpit?.gwmdMap;
    if (!api?.enterDisplaySurface) {
      return;
    }

    const chosenMonitorIds = selectedMonitorIds.length
      ? selectedMonitorIds
      : availableMonitors.map((monitor) => monitor.id);
    if (chosenMonitorIds.length === 0) {
      return;
    }
    const chosenPrimary =
      typeof primaryMonitorId === "number" && chosenMonitorIds.includes(primaryMonitorId)
        ? primaryMonitorId
        : chosenMonitorIds[0] ?? null;

    saveDisplaySnapshot();
    setDisplaySurfaceBusy(true);
    try {
      await api.setDisplaySurfaceSelection?.({
        monitorIds: chosenMonitorIds,
        primaryMonitorId: chosenPrimary,
        mode: targetDisplayMode,
      });
      const next = await api.enterDisplaySurface({
        monitorIds: chosenMonitorIds,
        primaryMonitorId: chosenPrimary,
        mode: targetDisplayMode,
      });
      setDisplaySurfaceState(next as GwmdDisplaySurfaceState);
      setShowMonitorPicker(false);
    } finally {
      setDisplaySurfaceBusy(false);
    }
  }, [
    availableMonitors,
    primaryMonitorId,
    saveDisplaySnapshot,
    selectedMonitorIds,
    targetDisplayMode,
  ]);

  const handleExitDisplaySurface = useCallback(async () => {
    const api = window.cockpit?.gwmdMap;
    if (!api?.exitDisplaySurface) {
      return;
    }
    setDisplaySurfaceBusy(true);
    try {
      const next = await api.exitDisplaySurface();
      setDisplaySurfaceState(next as GwmdDisplaySurfaceState);
    } finally {
      setDisplaySurfaceBusy(false);
    }
  }, []);

  const toggleMonitorSelection = useCallback(
    async (monitorId: number) => {
      const next = selectedMonitorIds.includes(monitorId)
        ? selectedMonitorIds.filter((id) => id !== monitorId)
        : [...selectedMonitorIds, monitorId];
      const fallback = next.length > 0 ? next : [monitorId];
      const nextPrimary =
        typeof primaryMonitorId === "number" && fallback.includes(primaryMonitorId)
          ? primaryMonitorId
          : fallback[0] ?? null;

      setSelectedMonitorIds(fallback);
      setPrimaryMonitorId(nextPrimary);
      await window.cockpit?.gwmdMap?.setDisplaySurfaceSelection?.({
        monitorIds: fallback,
        primaryMonitorId: nextPrimary,
        mode: targetDisplayMode,
      });
    },
    [primaryMonitorId, selectedMonitorIds, targetDisplayMode],
  );

  const setPrimaryMonitor = useCallback(
    async (monitorId: number) => {
      if (!selectedMonitorIds.includes(monitorId)) {
        return;
      }
      setPrimaryMonitorId(monitorId);
      await window.cockpit?.gwmdMap?.setDisplaySurfaceSelection?.({
        monitorIds: selectedMonitorIds,
        primaryMonitorId: monitorId,
        mode: targetDisplayMode,
      });
    },
    [selectedMonitorIds, targetDisplayMode],
  );

  const displaySurfaceLabel = useMemo(() => {
    if (!displaySurfaceState) {
      return "Display Surface: unavailable";
    }

    const mode = displaySurfaceState.enabled
      ? displaySurfaceState.mode === "wall"
        ? "Wall Mode"
        : displaySurfaceState.mode === "analyst"
          ? "Analyst Mode"
          : "Mirror Mode"
      : "Standard Mode";
    const selectedCount = Array.isArray(displaySurfaceState.selectedMonitorIds)
      ? displaySurfaceState.selectedMonitorIds.length
      : displaySurfaceState.monitorCount;
    const monitors = `${selectedCount} monitor${selectedCount === 1 ? "" : "s"}`;
    const size = `${displaySurfaceState.bounds.width}x${displaySurfaceState.bounds.height}`;
    return `Display Surface: ${mode} • ${monitors} • ${size}`;
  }, [displaySurfaceState]);

  const effectiveWidth = displaySurfaceState?.bounds.width ?? viewportSize.width;
  const effectiveHeight = displaySurfaceState?.bounds.height ?? viewportSize.height;
  const showOperationalControls = !isWallSatellite;
  const showContextPanel = !isWallMode;
  const showMapPanel = !(isAnalystMode && isWallSatellite);
  const showAnalystHeader = isAnalystMode && isWallSatellite;
  const useStackedLayout =
    showContextPanel && (effectiveWidth < 1320 || effectiveHeight < 760);
  const shellPadding = isWallMode ? 0 : effectiveWidth < 900 ? 12 : 20;
  const mapPanelGap = effectiveWidth < 1000 ? 12 : 16;
  const mapMinHeight = Math.max(320, Math.min(820, Math.floor(effectiveHeight * 0.58)));
  const panelMinHeight = Math.max(240, Math.min(420, Math.floor(effectiveHeight * 0.35)));
  const mapLayoutSignature = useMemo(
    () => `${useStackedLayout ? "stack" : "split"}-${displaySurfaceState?.enabled ? "multi" : "windowed"}-${Math.round(effectiveWidth / 20)}x${Math.round(effectiveHeight / 20)}`,
    [useStackedLayout, displaySurfaceState?.enabled, effectiveWidth, effectiveHeight]
  );
  const displayGraph: SupplyChainGraph = graph ?? { nodes: [], edges: [] };
  // Convert companies and graph to MindMapData for ContextPanel
  const mockMindMap: MindMapData = useMemo(
    () => ({
      centerTicker: "GWMD",
      centerName: "Global World Mind-Map Data",
      generatedAt: new Date().toISOString(),
      categories: [],
      ...(graph ? { graph } : {}),
    }),
    [graph]
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        flex: 1,
        minHeight: "min(100dvh, 100vh)",
        height: "100%",
        minWidth: 0,
        width: "100%",
        maxWidth: "100%",
        padding: shellPadding,
        boxSizing: "border-box",
      }}
    >
      <style>{`@keyframes gwmdSearchBar { 0% { transform: translateX(-120%); } 100% { transform: translateX(320%); } }`}</style>

      {/* Header with search and controls */}
      {showOperationalControls && (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          padding: "12px 16px",
          borderRadius: 12,
          border: "1px solid rgba(148,163,184,0.15)",
          background: "rgba(15,23,42,0.75)",
        }}
      >
        {/* Search bar */}
        <div>
          <label style={{ display: "block", fontSize: 12, color: COLORS.textMuted, marginBottom: 8 }}>
            Search Company
          </label>
          <div style={{ position: "relative" }}>
            <input
              type="text"
              placeholder="e.g., NVDA, TSMC, AAPL..."
              value={searchInput}
              onChange={(e) => {
                const next = e.target.value.toUpperCase();
                setSearchInput(next);
                setShowSuggestions(next.trim().length > 0);
              }}
              onKeyDown={handleKeyDown}
              onFocus={() => searchInput && setShowSuggestions(suggestions.length > 0)}
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: 8,
                border: `1px solid ${COLORS.border}`,
                background: "rgba(30,41,59,0.8)",
                color: COLORS.text,
                fontSize: 14,
                boxSizing: "border-box",
              }}
            />

            {/* Suggestions dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  right: 0,
                  marginTop: 4,
                  borderRadius: 8,
                  border: `1px solid ${COLORS.border}`,
                  background: COLORS.bgSecondary,
                  zIndex: 100,
                  maxHeight: 200,
                  overflowY: "auto",
                }}
              >
                {suggestions.map((sug) => (
                  <div
                    key={sug.ticker}
                    onClick={() => handleSuggestionClick(sug.ticker)}
                    style={{
                      padding: "8px 12px",
                      cursor: "pointer",
                      borderBottom: `1px solid ${COLORS.border}`,
                      transition: "background 0.2s",
                      fontSize: 13,
                      color: COLORS.text,
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background = COLORS.border;
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background = "transparent";
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{sug.ticker}</div>
                    <div style={{ fontSize: 11, color: COLORS.textMuted }}>{sug.name}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {showSearchLoadingBar && (
            <div
              style={{
                marginTop: 8,
                width: "100%",
                height: 4,
                borderRadius: 999,
                background: "rgba(59,130,246,0.18)",
                overflow: "hidden",
                position: "relative",
              }}
              aria-live="polite"
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "35%",
                  borderRadius: 999,
                  background: "linear-gradient(90deg, rgba(59,130,246,0.3), rgba(59,130,246,1), rgba(59,130,246,0.3))",
                  animation: "gwmdSearchBar 1.1s linear infinite",
                }}
              />
            </div>
          )}

          {(searchInFlight || searchTrace.phase !== "idle") && (
            <div
              style={{
                marginTop: 8,
                fontSize: 11,
                color: searchTraceColor,
                letterSpacing: 0.2,
              }}
            >
              {searchTraceLine}
            </div>
          )}
        </div>

        {/* Controls row */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={() => handleSearch(searchInput)}
            disabled={searchInFlight || !searchInput.trim()}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "none",
              background: searchInFlight || !searchInput.trim() ? COLORS.border : COLORS.accent,
              color: "white",
              fontSize: 12,
              fontWeight: 600,
              cursor: searchInFlight || !searchInput.trim() ? "not-allowed" : "pointer",
              opacity: searchInFlight || !searchInput.trim() ? 0.6 : 1,
            }}
          >
            {searchInFlight ? "Searching..." : "Search"}
          </button>

          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: COLORS.textMuted, fontSize: 12 }}>Hops</span>
            <select
              value={Math.max(1, Math.min(3, gwmdFilters.hops ?? 2))}
              onChange={(e) => {
                setGwmdFilters({
                  ...gwmdFilters,
                  hops: Number(e.target.value),
                });
              }}
              style={{
                padding: "7px 10px",
                borderRadius: 6,
                border: `1px solid ${COLORS.border}`,
                background: COLORS.bgSecondary,
                color: COLORS.text,
                fontSize: 12,
              }}
            >
              <option value={1}>1 hop</option>
              <option value={2}>2 hops</option>
              <option value={3}>3 hops</option>
            </select>
          </label>

          <button
            onClick={() => setShowExposureBrief(true)}
            disabled={!graph}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: `1px solid ${COLORS.accent}`,
              background: "transparent",
              color: COLORS.accent,
              fontSize: 12,
              fontWeight: 600,
              cursor: graph ? "pointer" : "not-allowed",
              opacity: graph ? 1 : 0.6,
            }}
          >
            Exposure Brief
          </button>

          <button
            onClick={() => setShowEmpty(!showEmpty)}
              disabled={isAnalystMode && isWallSatellite}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: `1px solid ${COLORS.border}`,
              background: showEmpty ? COLORS.bgSecondary : "transparent",
              color: COLORS.text,
              fontSize: 12,
              fontWeight: 600,
                cursor: isAnalystMode && isWallSatellite ? "not-allowed" : "pointer",
                opacity: isAnalystMode && isWallSatellite ? 0.65 : 1,
            }}
          >
                      {!displaySurfaceState?.enabled && (
                        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ color: COLORS.textMuted, fontSize: 12 }}>Mode</span>
                          <select
                            value={targetDisplayMode}
                            onChange={(e) => {
                              const value = e.target.value;
                              if (value === "wall" || value === "analyst" || value === "mirror") {
                                setTargetDisplayMode(value);
                              }
                            }}
                            style={{
                              padding: "7px 10px",
                              borderRadius: 6,
                              border: `1px solid ${COLORS.border}`,
                              background: COLORS.bgSecondary,
                              color: COLORS.text,
                              fontSize: 12,
                            }}
                          >
                            <option value="wall">Wall Mode</option>
                            <option value="analyst">Analyst Mode</option>
                            <option value="mirror">Mirror Mode</option>
                          </select>
                        </label>
                      )}

            {showEmpty ? "Show All Loaded" : "Empty Map"}
          </button>

          {displaySurfaceState?.enabled ? (
            <button
              onClick={handleExitDisplaySurface}
              disabled={displaySurfaceBusy}
              style={{
                padding: "8px 16px",
                borderRadius: 6,
                border: `1px solid ${COLORS.warning}`,
                background: "transparent",
                color: COLORS.warning,
                fontSize: 12,
                fontWeight: 600,
                cursor: displaySurfaceBusy ? "not-allowed" : "pointer",
                opacity: displaySurfaceBusy ? 0.7 : 1,
              }}
            >
              {displaySurfaceBusy ? "Exiting..." : "Exit Multi-Screen"}
            </button>
          ) : (
            <button
              onClick={handleEnableDisplaySurface}
              disabled={displaySurfaceBusy || !displaySurfaceState}
              style={{
                padding: "8px 16px",
                borderRadius: 6,
                border: `1px solid ${COLORS.accent}`,
                background: "transparent",
                color: COLORS.accent,
                fontSize: 12,
                fontWeight: 600,
                cursor: displaySurfaceBusy || !displaySurfaceState ? "not-allowed" : "pointer",
                opacity: displaySurfaceBusy || !displaySurfaceState ? 0.7 : 1,
              }}
            >
              {displaySurfaceBusy ? "Launching..." : "Enable Multi-Screen"}
            </button>
          )}

          {!displaySurfaceState?.enabled && (
            <button
              onClick={() => {
                void handleToggleMonitorPicker();
              }}
              disabled={displaySurfaceBusy}
              style={{
                padding: "8px 16px",
                borderRadius: 6,
                border: `1px solid ${COLORS.border}`,
                background: showMonitorPicker ? COLORS.bgSecondary : "transparent",
                color: COLORS.text,
                fontSize: 12,
                fontWeight: 600,
                cursor: displaySurfaceBusy ? "not-allowed" : "pointer",
                opacity: displaySurfaceBusy ? 0.7 : 1,
              }}
            >
              Wall Screens ({selectedMonitorIds.length || availableMonitors.length})
            </button>
          )}

          {companies.length > 0 && (
            <>
              <button
                onClick={handleSyncToCloud}
                disabled={loading || syncState.busy || !graph}
                style={{
                  padding: "8px 16px",
                  borderRadius: 6,
                  border: `1px solid ${COLORS.success}`,
                  background: "transparent",
                  color: COLORS.success,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: loading || syncState.busy || !graph ? "not-allowed" : "pointer",
                  opacity: loading || syncState.busy || !graph ? 0.7 : 1,
                }}
              >
                {syncState.mode === "pushing" ? "Syncing..." : "Sync to Cloud"}
              </button>

              <button
                onClick={handleSyncFromCloud}
                disabled={loading || syncState.busy}
                style={{
                  padding: "8px 16px",
                  borderRadius: 6,
                  border: `1px solid ${COLORS.accent}`,
                  background: "transparent",
                  color: COLORS.accent,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: loading || syncState.busy ? "not-allowed" : "pointer",
                  opacity: loading || syncState.busy ? 0.7 : 1,
                }}
              >
                {syncState.mode === "pulling" ? "Syncing..." : "Sync from Cloud"}
              </button>

              <button
                onClick={refreshCloudSyncStatus}
                disabled={loading || syncState.busy}
                style={{
                  padding: "8px 16px",
                  borderRadius: 6,
                  border: `1px solid ${COLORS.border}`,
                  background: "transparent",
                  color: COLORS.text,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: loading || syncState.busy ? "not-allowed" : "pointer",
                  opacity: loading || syncState.busy ? 0.7 : 1,
                }}
              >
                Refresh Cloud Status
              </button>

              <button
                onClick={reset}
                style={{
                  padding: "8px 16px",
                  borderRadius: 6,
                  border: `1px solid ${COLORS.border}`,
                  background: "transparent",
                  color: COLORS.text,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Reset View
              </button>

              <button
                onClick={handleDeleteStoredData}
                disabled={loading}
                style={{
                  padding: "8px 16px",
                  borderRadius: 6,
                  border: `1px solid ${COLORS.error}`,
                  background: "transparent",
                  color: COLORS.error,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: loading ? "not-allowed" : "pointer",
                  opacity: loading ? 0.7 : 1,
                }}
              >
                Delete Stored Data
              </button>
            </>
          )}

          <div style={{ fontSize: 11, color: COLORS.textMuted, width: "100%" }}>
            <div>{displaySurfaceLabel}</div>
            <div>{statusLine}</div>
            {displaySurfaceNotice && <div style={{ color: COLORS.warning }}>{displaySurfaceNotice}</div>}
          </div>

          {!displaySurfaceState?.enabled && showMonitorPicker && availableMonitors.length > 0 && (
            <div
              style={{
                width: "100%",
                marginTop: 8,
                padding: "10px 12px",
                borderRadius: 8,
                border: `1px solid ${COLORS.border}`,
                background: "rgba(2,6,23,0.65)",
                display: "grid",
                gap: 8,
              }}
            >
              <div style={{ fontSize: 12, color: COLORS.text, fontWeight: 600 }}>
                Wall Monitor Selection
              </div>
              {availableMonitors.map((monitor) => {
                const selected = selectedMonitorIds.includes(monitor.id);
                const isPrimary = primaryMonitorId === monitor.id;
                return (
                  <div
                    key={monitor.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: 8,
                      padding: "8px 10px",
                      background: selected ? "rgba(30,41,59,0.7)" : "rgba(15,23,42,0.5)",
                    }}
                  >
                    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => {
                          void toggleMonitorSelection(monitor.id);
                        }}
                      />
                      <span style={{ fontSize: 12, color: COLORS.text }}>
                        {monitor.label} • {monitor.bounds.width}x{monitor.bounds.height} • Scale {monitor.scaleFactor.toFixed(2)}
                      </span>
                    </label>
                    <button
                      disabled={!selected}
                      onClick={() => {
                        void setPrimaryMonitor(monitor.id);
                      }}
                      style={{
                        padding: "5px 9px",
                        borderRadius: 6,
                        border: `1px solid ${isPrimary ? COLORS.accent : COLORS.border}`,
                        background: isPrimary ? "rgba(59,130,246,0.2)" : "transparent",
                        color: isPrimary ? COLORS.accent : COLORS.textMuted,
                        fontSize: 11,
                        cursor: selected ? "pointer" : "not-allowed",
                        opacity: selected ? 1 : 0.6,
                      }}
                    >
                      {isPrimary ? "Primary" : "Set Primary"}
                    </button>
                  </div>
                );
              })}
              <div style={{ fontSize: 11, color: COLORS.textMuted }}>
                Choose monitors before enabling Wall Mode. The primary monitor is the interactive control surface.
              </div>
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 12px",
            borderRadius: 8,
            border: `1px solid ${COLORS.border}`,
            background: "rgba(15,23,42,0.5)",
            fontSize: 12,
            color: COLORS.text,
            flexWrap: "wrap",
          }}
        >
          <span style={{ color: syncStatusColor, fontWeight: 700, textTransform: "uppercase" }}>
            Cloud Sync: {syncStatusLabel}
          </span>
          <span style={{ color: COLORS.textMuted }}>{syncMetaLine}</span>
        </div>

        {/* Error display */}
        {error && (
          <div style={{ padding: "8px 12px", borderRadius: 6, background: COLORS.error + "22", color: COLORS.error, fontSize: 12 }}>
            {error}
          </div>
        )}

        {syncState.message && (
          <div
            style={{
              padding: "8px 12px",
              borderRadius: 6,
              background: (syncState.status === "error" ? COLORS.error : COLORS.success) + "22",
              color: syncState.status === "error" ? COLORS.error : COLORS.success,
              fontSize: 12,
            }}
          >
            {syncState.message}
          </div>
        )}

        {runStatus === "degraded_cache" && (
          <div style={{ padding: "8px 12px", borderRadius: 6, background: COLORS.warning + "22", color: COLORS.warning, fontSize: 12 }}>
            Running in degraded mode from scoped cache. Unlocated: {String((runMeta?.unlocatedCount as number | undefined) ?? 0)} • Hypothesis ratio: {String((runMeta?.hypothesisRatio as number | undefined) ?? 0)}
          </div>
        )}

        {companies.length > 0 && geoStats.located === 0 && (
          <div
            style={{
              padding: "8px 12px",
              borderRadius: 6,
              background: COLORS.warning + "22",
              color: COLORS.warning,
              fontSize: 12,
            }}
          >
            Loaded {companies.length} companies, but none have valid coordinates yet. The relationship list is available in the side panel while location enrichment retries.
          </div>
        )}
      </div>
      )}

      {/* Main content: Map + Sidebar */}
      <div
        style={{
          display: "grid",
          gap: mapPanelGap,
          flex: 1,
          minHeight: 0,
          alignItems: "stretch",
          gridTemplateColumns: !showContextPanel
            ? "minmax(0, 1fr)"
            : useStackedLayout
            ? "minmax(0, 1fr)"
            : "minmax(0, 1fr) clamp(300px, 32vw, 460px)",
          gridTemplateRows: !showContextPanel
            ? "minmax(0, 1fr)"
            : useStackedLayout
            ? `minmax(${mapMinHeight}px, 1fr) minmax(${panelMinHeight}px, auto)`
            : "minmax(0, 1fr)",
        }}
      >
        {/* Map container */}
        {!showMapPanel ? (
          <div
            style={{
              minWidth: 0,
              minHeight: 0,
              height: "100%",
              borderRadius: 12,
              border: `1px solid ${COLORS.border}`,
              background: "rgba(8,15,29,0.72)",
              display: "flex",
              flexDirection: "column",
              padding: 16,
              gap: 10,
              overflow: "auto",
            }}
          >
            {showAnalystHeader && (
              <div style={{ fontSize: 13, color: COLORS.textMuted }}>
                Analyst Surface: contextual intelligence panel synchronized with the primary map screen.
              </div>
            )}
            <ContextPanel
              mindMap={mockMindMap}
              selectedNodeId={selectedNodeId}
              selectedEdgeId={selectedEdgeId}
              viewMode="global"
              strictMode={false}
              includeHypothesis={true}
              simulation={{
                failedNodeIds: [],
                failedEdgeIds: [],
                params: { severity: 0.5, damping: 0.3 },
              }}
              gwmdFilters={gwmdFilters}
              onGwmdFiltersChange={setGwmdFilters}
              onSelectNode={setSelectedNode}
              onSelectEdge={setSelectedEdge}
              onSimulateNode={() => {}}
              onSimulateEdge={() => {}}
              onRunShock={() => {}}
              onSetShockSeverity={() => {}}
              onSetShockDamping={() => {}}
              onSetShockIncludeKinds={() => {}}
              onResetSimulation={() => {}}
              intelligenceSettings={{
                confidenceThreshold: 0.6,
                dataStyle: "blended",
                scenario: "Baseline",
                timeHorizon: "1M",
                rankingMethod: "exposure",
                exposureMethod: "hybrid",
                activeOverlays: ["Geopolitical", "Shipping"],
              }}
              layout="stacked"
            />
          </div>
        ) : showEmpty ? (
          <div
            style={{
              minWidth: 0,
              minHeight: 0,
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 12,
              border: `2px dashed ${COLORS.border}`,
              color: COLORS.textMuted,
              fontSize: 14,
              background: "rgba(15,23,42,0.5)",
            }}
          >
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🗺️</div>
              <div>Search for a company to load relationships</div>
              <div style={{ fontSize: 12, marginTop: 8, color: COLORS.textMuted }}>
                The map builds incrementally, storing companies for quick access
              </div>
            </div>
          </div>
        ) : (
          <div
            style={{
              minWidth: 0,
              minHeight: 0,
              height: "100%",
              position: "relative",
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            {graph ? (
              <GwmdWorldMap
                graph={displayGraph}
                selectedNodeId={selectedNodeId}
                selectedEdgeId={selectedEdgeId}
                focalNodeId={searchTicker}
                hopLimit={Math.max(1, Math.min(3, gwmdFilters.hops ?? 2))}
                simulation={{ failedNodeIds: [], failedEdgeIds: [] }}
                filters={gwmdFilters}
                onFiltersChange={setGwmdFilters}
                onSelectNode={setSelectedNode}
                onSelectEdge={setSelectedEdge}
                layoutVersion={mapLayoutSignature}
                wallMode={isWallMode || isMirrorMode}
                wallIsPrimary={isWallPrimary}
                wallSyncChannel={wallContext.wallSessionId}
                wallMonitorId={wallContext.wallMonitorId}
                wallPrimaryMonitorId={wallContext.wallPrimaryMonitorId}
                wallDisplayMode={wallContext.displayMode}
                wallSurfaceState={displaySurfaceState}
              />
            ) : (
              <div style={{ position: "absolute", inset: 0 }}>
                <GwmdWorldMap
                  graph={displayGraph}
                  selectedNodeId={selectedNodeId}
                  selectedEdgeId={selectedEdgeId}
                  focalNodeId={searchTicker}
                  hopLimit={Math.max(1, Math.min(3, gwmdFilters.hops ?? 2))}
                  simulation={{ failedNodeIds: [], failedEdgeIds: [] }}
                  filters={gwmdFilters}
                  onFiltersChange={setGwmdFilters}
                  onSelectNode={setSelectedNode}
                  onSelectEdge={setSelectedEdge}
                  layoutVersion={mapLayoutSignature}
                  wallMode={isWallMode || isMirrorMode}
                  wallIsPrimary={isWallPrimary}
                  wallSyncChannel={wallContext.wallSessionId}
                  wallMonitorId={wallContext.wallMonitorId}
                  wallPrimaryMonitorId={wallContext.wallPrimaryMonitorId}
                  wallDisplayMode={wallContext.displayMode}
                  wallSurfaceState={displaySurfaceState}
                />
                <div
                  style={{
                    position: "absolute",
                    top: 12,
                    left: 12,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: `1px solid ${COLORS.border}`,
                    background: "rgba(2,6,23,0.72)",
                    color: COLORS.textMuted,
                    fontSize: 12,
                    pointerEvents: "none",
                  }}
                >
                  Search for a company to load relationships
                </div>
              </div>
            )}
          </div>
        )}

        {/* Right sidebar */}
        {showContextPanel && (
        <div style={{ minWidth: 0, minHeight: 0, overflow: "hidden" }}>
          <ContextPanel
            mindMap={mockMindMap}
            selectedNodeId={selectedNodeId}
            selectedEdgeId={selectedEdgeId}
            viewMode="global"
            strictMode={false}
            includeHypothesis={true}
            simulation={{
              failedNodeIds: [],
              failedEdgeIds: [],
              params: { severity: 0.5, damping: 0.3 },
            }}
            gwmdFilters={gwmdFilters}
            onGwmdFiltersChange={setGwmdFilters}
            onSelectNode={setSelectedNode}
            onSelectEdge={setSelectedEdge}
            onSimulateNode={() => {}}
            onSimulateEdge={() => {}}
            onRunShock={() => {}}
            onSetShockSeverity={() => {}}
            onSetShockDamping={() => {}}
            onSetShockIncludeKinds={() => {}}
            onResetSimulation={() => {}}
            intelligenceSettings={{
              confidenceThreshold: 0.6,
              dataStyle: "blended",
              scenario: "Baseline",
              timeHorizon: "1M",
              rankingMethod: "exposure",
              exposureMethod: "hybrid",
              activeOverlays: ["Geopolitical", "Shipping"],
            }}
            layout={useStackedLayout ? "stacked" : "side"}
          />

          {/* TED Spatial Intelligence overlay — collapsible */}
          <div style={{ marginTop: 10 }}>
            <button
              onClick={() => setShowTedOverlay((v) => !v)}
              style={{
                width: "100%",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "8px 12px",
                borderRadius: 10,
                border: `1px solid ${COLORS.border}`,
                background: showTedOverlay ? "rgba(59,130,246,0.12)" : "rgba(255,255,255,0.03)",
                color: showTedOverlay ? "#93c5fd" : COLORS.textMuted,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              <span>TED Procurement Overlay</span>
              <span style={{ fontSize: 10 }}>{showTedOverlay ? "▲" : "▼"}</span>
            </button>
            {showTedOverlay && (
              <div style={{ marginTop: 8 }}>
                <TedMapOverlayPanel windowDays="90d" />
              </div>
            )}
          </div>
        </div>
        )}
      </div>
      <ExposureBriefPanel
        open={showExposureBrief}
        onClose={() => setShowExposureBrief(false)}
      />
    </div>
  );
}

/**
 * Supply Chain Mind-Map Visualization
 * Interactive business relationship graph for companies
 * Supports both local and cloud AI models
 */

import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useSupplyChainStore, SupplyChainViewMode } from "../store/supplyChainStore";
import { useSettingsStore } from "../store/settingsStore";
import { useStreamStore } from "../store/streamStore";
import { useTradingStore } from "../store/tradingStore";
import VisualizationSurface from "../components/supplyChain/VisualizationSurface";
import ContextPanel from "../components/supplyChain/ContextPanel";
import { TedSupplyChainOverlayPanel } from "../components/tedIntel/TedIntelWidgets";
import ExposureBriefPanel from "../components/exposureBrief/ExposureBriefPanel";
import type { MindMapData, SupplyChainAdvisorRequest, SupplyChainGraph } from "@tc/shared/supplyChain";

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

const GWMD_FILTERS_KEY = "gwmdFilters.v1";
const SUPPLY_CHAIN_INTEL_SETTINGS_KEY = "supplyChainIntelligence.settings.v1";

type IntelligenceWorkspaceSettings = {
  upstreamDepth: number;
  downstreamDepth: number;
  totalVisibleTiers: number;
  relationScope: "suppliers" | "customers" | "both";
  showFacilities: boolean;
  showRoutes: boolean;
  confidenceThreshold: number;
  dataStyle: "reported-first" | "blended" | "inference-heavy";
  pointInTimeMode: "live" | "historical";
  displayDensity: "compact" | "balanced" | "dense";
  rankingMethod: "exposure" | "criticality" | "confidence";
  exposureMethod: "weight" | "hhi" | "hybrid";
  scenario: string;
  timeHorizon: "1D" | "1W" | "1M" | "1Q";
  activeOverlays: string[];
};

const DEFAULT_INTELLIGENCE_SETTINGS: IntelligenceWorkspaceSettings = {
  upstreamDepth: 2,
  downstreamDepth: 2,
  totalVisibleTiers: 3,
  relationScope: "both",
  showFacilities: true,
  showRoutes: true,
  confidenceThreshold: 0.6,
  dataStyle: "blended",
  pointInTimeMode: "live",
  displayDensity: "balanced",
  rankingMethod: "exposure",
  exposureMethod: "hybrid",
  scenario: "Baseline",
  timeHorizon: "1M",
  activeOverlays: ["Geopolitical", "Shipping", "Commodity"],
};

type EnrichmentInspectorPayload = {
  summary: {
    totalEntities: number;
    totalEdges: number;
    candidateItems: number;
    validationItems: number;
    productionItems: number;
    staleItems: number;
    lowConfidenceItems: number;
    pendingRevalidation: number;
    queuedSyncJobs: number;
    lastQueryAt: string | null;
    hotTargets: number;
    warmTargets: number;
    coldTargets: number;
  };
  staleEntities: Array<{
    id: string;
    canonicalName: string;
    confidenceScore: number;
    freshnessScore: number;
    zone: "candidate" | "validation" | "production";
    lastSeenAt: string;
  }>;
  lowConfidenceEdges: Array<{
    id: string;
    relationType: string;
    fromEntityId: string;
    toEntityId: string;
    confidenceScore: number;
    zone: "candidate" | "validation" | "production";
    validationStatus: "unvalidated" | "pending_validation" | "validated" | "contradicted" | "rejected";
  }>;
};

type SyncStatusPayload = {
  cloudEnabled: boolean;
  connected: boolean;
  provider: string;
  mode: "manual" | "pull" | "push" | "bidirectional";
  lastSyncAt: string | null;
  queueSize: number;
  message: string;
};

function loadIntelligenceSettings(): IntelligenceWorkspaceSettings {
  if (typeof window === "undefined") return DEFAULT_INTELLIGENCE_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SUPPLY_CHAIN_INTEL_SETTINGS_KEY);
    if (!raw) return DEFAULT_INTELLIGENCE_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<IntelligenceWorkspaceSettings>;
    return {
      ...DEFAULT_INTELLIGENCE_SETTINGS,
      ...parsed,
      activeOverlays: Array.isArray(parsed.activeOverlays)
        ? parsed.activeOverlays.filter((value): value is string => typeof value === "string")
        : DEFAULT_INTELLIGENCE_SETTINGS.activeOverlays,
    };
  } catch {
    return DEFAULT_INTELLIGENCE_SETTINGS;
  }
}

function saveIntelligenceSettings(settings: IntelligenceWorkspaceSettings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SUPPLY_CHAIN_INTEL_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore persistence failures
  }
}

function loadGwmdFilters() {
  if (typeof window === "undefined") {
    return { region: "All", relation: "all", showFlows: true, showOnlyImpacted: false };
  }
  try {
    const raw = window.sessionStorage.getItem(GWMD_FILTERS_KEY);
    if (!raw) return { region: "All", relation: "all", showFlows: true, showOnlyImpacted: false };
    const parsed = JSON.parse(raw) as { region?: string; relation?: string; showFlows?: boolean; showOnlyImpacted?: boolean };
    return {
      region: parsed.region ?? "All",
      relation: parsed.relation ?? "all",
      showFlows: parsed.showFlows ?? true,
      showOnlyImpacted: parsed.showOnlyImpacted ?? false,
    };
  } catch {
    return { region: "All", relation: "all", showFlows: true, showOnlyImpacted: false };
  }
}

function saveGwmdFilters(filters: { region: string; relation: string; showFlows: boolean; showOnlyImpacted: boolean }) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(GWMD_FILTERS_KEY, JSON.stringify(filters));
  } catch {
    // Ignore storage failures
  }
}

export default function SupplyChainMindMap() {
  const {
    searchTicker,
    loading,
    error,
    mindMapData,
    fromCache,
    setSearchTicker,
    generate,
    reset,
    viewMode,
    setViewMode,
    simulation,
    selectedNodeId,
    selectedEdgeId,
    setSelectedNode,
    setSelectedEdge,
    toggleNodeFailure,
    toggleEdgeFailure,
    setStrictMode,
    setIncludeHypothesis,
    setHops,
    setMinEdgeWeight,
    setShockSeverity,
    setShockDamping,
    setShockIncludeKinds,
    runShockSimulation,
    resetSimulation,
    strictMode,
    includeHypothesis,
    hops,
    minEdgeWeight,
    globalTickers,
    loadGlobalGraph,
    seedShockParamsFromNode,
  } = useSupplyChainStore();

  // Cloud AI models support
  const cloudModels = useSettingsStore((s) => s.cloudAiModels);
  const getCloudModelFor = useSettingsStore((s) => s.getCloudModelFor);
  useMemo(
    () => cloudModels.filter((m) => m.enabled && m.useForSupplyChain),
    [cloudModels]
  );
  const currentModel = getCloudModelFor("supplyChain");
  const lastOptionsRef = useRef({ strictMode, includeHypothesis, hops, minEdgeWeight });
  const regenerateTimerRef = useRef<number | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(true);
  const [showEnrichmentPanel, setShowEnrichmentPanel] = useState(false);
  const [showExposureBrief, setShowExposureBrief] = useState(false);
  const [enrichmentInspector, setEnrichmentInspector] = useState<EnrichmentInspectorPayload | null>(null);
  const [enrichmentSync, setEnrichmentSync] = useState<SyncStatusPayload | null>(null);
  const [enrichmentSubgraphQuery, setEnrichmentSubgraphQuery] = useState("");
  const [enrichmentSubgraphStats, setEnrichmentSubgraphStats] = useState<{ entities: number; edges: number; staleDetected: number } | null>(null);
  const [enrichmentStatusText, setEnrichmentStatusText] = useState<string | null>(null);
  const [enrichmentLoading, setEnrichmentLoading] = useState(false);
  const [workspaceSettings, setWorkspaceSettings] = useState<IntelligenceWorkspaceSettings>(loadIntelligenceSettings);
  
  const [gwmdFilters, setGwmdFilters] = useState(loadGwmdFilters);

  const refreshEnrichmentInspector = useCallback(async () => {
    const api = window.cockpit?.supplyChain;
    if (!api?.getEnrichmentInspector || !api.getEnrichmentSyncStatus) return;
    setEnrichmentLoading(true);
    setEnrichmentStatusText(null);
    try {
      const [inspectorRes, syncRes] = await Promise.all([
        api.getEnrichmentInspector(),
        api.getEnrichmentSyncStatus(),
      ]);
      if (inspectorRes?.success && inspectorRes.data) {
        setEnrichmentInspector(inspectorRes.data as EnrichmentInspectorPayload);
      }
      if (syncRes?.success && syncRes.data) {
        setEnrichmentSync(syncRes.data as SyncStatusPayload);
      }
    } catch (err) {
      setEnrichmentStatusText(`Inspector refresh failed: ${String(err)}`);
    } finally {
      setEnrichmentLoading(false);
    }
  }, []);

  useEffect(() => {
    saveGwmdFilters(gwmdFilters);
  }, [gwmdFilters]);

  useEffect(() => {
    saveIntelligenceSettings(workspaceSettings);
  }, [workspaceSettings]);

  useEffect(() => {
    if (showEnrichmentPanel) {
      void refreshEnrichmentInspector();
    }
  }, [showEnrichmentPanel, refreshEnrichmentInspector]);

  const resolveNodeIdByTicker = useCallback(
    (ticker: string) => {
      const graph = mindMapData?.graph;
      if (!graph) return null;
      const match = graph.nodes.find((node) => node.id === ticker || node.tickers?.includes(ticker));
      return match?.id ?? null;
    },
    [mindMapData]
  );

  const suggestionItems = useMemo(() => {
    const items: Array<{ id: string; ticker: string; name?: string }> = [];
    if (mindMapData) {
      for (const category of mindMapData.categories) {
        for (const company of category.companies) {
          const ticker = (company.id || company.name || "").toUpperCase();
          if (!ticker) continue;
          items.push({ id: company.id, ticker, name: company.name });
        }
      }
    }
    globalTickers.forEach((ticker) => {
      items.push({ id: ticker, ticker });
    });
    const unique = new Map<string, { id: string; ticker: string; name?: string }>();
    items.forEach((item) => {
      if (!unique.has(item.ticker)) {
        unique.set(item.ticker, item);
      }
    });
    return Array.from(unique.values());
  }, [mindMapData, globalTickers]);

  const filteredSuggestions = useMemo(() => {
    const term = searchTicker.trim().toUpperCase();
    if (!term) return [];
    return suggestionItems
      .filter((item) => item.ticker.includes(term) || item.name?.toUpperCase().includes(term))
      .slice(0, 8);
  }, [searchTicker, suggestionItems]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const ticker = searchTicker.trim().toUpperCase();
    if (!ticker) return;
    const existingNode = resolveNodeIdByTicker(ticker);
    if (existingNode && mindMapData) {
      setSelectedNode(existingNode);
      setViewMode("flow");
      return;
    }
    generate();
  };

  useEffect(() => {
    const last = lastOptionsRef.current;
    const changed =
      last.strictMode !== strictMode ||
      last.includeHypothesis !== includeHypothesis ||
      last.hops !== hops ||
      last.minEdgeWeight !== minEdgeWeight;
    if (changed && searchTicker.trim() && !loading) {
      lastOptionsRef.current = { strictMode, includeHypothesis, hops, minEdgeWeight };
      if (mindMapData) {
        if (regenerateTimerRef.current !== null) {
          window.clearTimeout(regenerateTimerRef.current);
        }
        regenerateTimerRef.current = window.setTimeout(() => {
          regenerateTimerRef.current = null;
          void generate();
        }, 220);
      }
    }
    return () => {
      if (regenerateTimerRef.current !== null) {
        window.clearTimeout(regenerateTimerRef.current);
        regenerateTimerRef.current = null;
      }
    };
  }, [strictMode, includeHypothesis, hops, minEdgeWeight, generate, loading, mindMapData, searchTicker]);

  useEffect(() => {
    if (selectedNodeId) {
      seedShockParamsFromNode(selectedNodeId);
    }
  }, [selectedNodeId, seedShockParamsFromNode]);

  const handleExportSnapshot = useCallback(() => {
    const exportRoot = document.querySelector("[data-export-target='supply-chain-canvas'] svg") as SVGSVGElement | null;
    if (!exportRoot || !mindMapData) return;

    const serializer = new XMLSerializer();
    const svgData = serializer.serializeToString(exportRoot);
    const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const image = new Image();
    image.onload = () => {
      const viewBox = exportRoot.viewBox.baseVal;
      const width = viewBox?.width || exportRoot.clientWidth || 1400;
      const height = viewBox?.height || exportRoot.clientHeight || 900;
      const canvas = document.createElement("canvas");
      const scale = window.devicePixelRatio || 1;
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(scale, scale);
      ctx.drawImage(image, 0, 0, width, height);
      canvas.toBlob((pngBlob) => {
        if (!pngBlob) return;
        const pngUrl = URL.createObjectURL(pngBlob);
        const link = document.createElement("a");
        link.href = pngUrl;
        link.download = `supply-chain-snapshot-${mindMapData.centerTicker}.png`;
        link.click();
        URL.revokeObjectURL(pngUrl);
      }, "image/png");
    };
    image.src = url;

    const evidenceItems = mindMapData.graph?.edges.flatMap((edge) =>
      (edge.evidence ?? []).map((ev) => ({
        edgeId: edge.id,
        relation: edge.kind,
        sourceKind: ev.sourceKind,
        docDate: ev.docDate,
        location: ev.locationPointer,
        snippet: ev.snippet,
      }))
    ) ?? [];
    const evidenceBlob = new Blob([JSON.stringify({
      generatedAt: mindMapData.generatedAt,
      center: mindMapData.centerTicker,
      evidence: evidenceItems,
    }, null, 2)], { type: "application/json" });
    const evidenceUrl = URL.createObjectURL(evidenceBlob);
    const evidenceLink = document.createElement("a");
    evidenceLink.href = evidenceUrl;
    evidenceLink.download = `supply-chain-evidence-${mindMapData.centerTicker}.json`;
    evidenceLink.click();
    URL.revokeObjectURL(evidenceUrl);
  }, [mindMapData]);

  const handlePinnedFocus = useCallback((ticker: string) => {
    const nodeId = resolveNodeIdByTicker(ticker);
    if (nodeId) {
      setSelectedNode(nodeId);
      setViewMode("flow");
    }
  }, [resolveNodeIdByTicker, setSelectedNode, setViewMode]);

  const handleRemoveTicker = useCallback((ticker: string) => {
    const next = globalTickers.filter((t) => t !== ticker);
    if (next.length === 0) {
      reset();
      return;
    }
    loadGlobalGraph(next);
  }, [globalTickers, loadGlobalGraph, reset]);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: COLORS.bg,
        color: COLORS.text,
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Header */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          padding: "16px 20px",
          borderBottom: `1px solid ${COLORS.border}`,
          background: "linear-gradient(180deg, rgba(10,14,26,0.98), rgba(10,14,26,0.9))",
          backdropFilter: "blur(10px)",
        }}
      >
        <div style={{ display: "flex", gap: 16, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
          <div style={{ minWidth: 260 }}>
            <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: 0.4 }}>AI Supply Chain Intelligence</div>
            <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2 }}>
              Institutional network, risk, and scenario monitor
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 320 }}>
            <form onSubmit={handleSubmit} style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
              <div style={{ position: "relative", flex: 1 }}>
                <input
                  type="text"
                  value={searchTicker}
                  onChange={(e) => setSearchTicker(e.target.value)}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  placeholder="Search ticker or company"
                  disabled={loading}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    background: COLORS.bg,
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: "10px",
                    color: COLORS.text,
                    fontSize: "13px",
                    outline: "none",
                  }}
                />
                {showSuggestions && filteredSuggestions.length > 0 && (
                  <div
                    style={{
                      position: "absolute",
                      top: "100%",
                      left: 0,
                      right: 0,
                      marginTop: 6,
                      background: "rgba(15,23,42,0.98)",
                      border: "1px solid rgba(148,163,184,0.2)",
                      borderRadius: 12,
                      padding: 6,
                      boxShadow: "0 12px 24px rgba(0,0,0,0.35)",
                      zIndex: 60,
                    }}
                  >
                    {filteredSuggestions.map((item) => (
                      <div
                        key={item.ticker}
                        onMouseDown={() => {
                          setSearchTicker(item.ticker);
                          setShowSuggestions(false);
                        }}
                        style={{
                          padding: "8px 10px",
                          borderRadius: 8,
                          cursor: "pointer",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          color: COLORS.text,
                          fontSize: 12,
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>{item.ticker}</span>
                        <span style={{ color: COLORS.textMuted }}>{item.name ?? ""}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="submit"
                disabled={loading || !searchTicker.trim()}
                style={{
                  padding: "10px 16px",
                  background: loading ? COLORS.border : COLORS.accent,
                  color: COLORS.text,
                  border: "none",
                  borderRadius: "10px",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: loading ? "not-allowed" : "pointer",
                  opacity: loading || !searchTicker.trim() ? 0.6 : 1,
                }}
              >
                {loading ? "Loading" : "Search"}
              </button>
            </form>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {globalTickers.map((ticker) => (
                <div
                  key={ticker}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 10px",
                    borderRadius: 999,
                    border: "1px solid rgba(59,130,246,0.35)",
                    background: "rgba(59,130,246,0.12)",
                    fontSize: 11,
                    cursor: "pointer",
                  }}
                  onClick={() => handlePinnedFocus(ticker)}
                >
                  <span style={{ fontWeight: 600 }}>{ticker}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveTicker(ticker);
                    }}
                    style={{
                      border: "none",
                      background: "transparent",
                      color: COLORS.textMuted,
                      cursor: "pointer",
                      fontSize: 12,
                    }}
                    title={`Remove ${ticker}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 6 }}>
              {[
                { id: "flow", label: "Graph" },
                { id: "impact", label: "Map" },
                { id: "radial", label: "Flow" },
                { id: "risk", label: "Risk" },
                { id: "shock", label: "Top Paths" },
                { id: "global", label: "Global" },
              ].map((mode) => (
                <button
                  key={mode.id}
                  onClick={() => setViewMode(mode.id as SupplyChainViewMode)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 999,
                    border: viewMode === mode.id ? `1px solid ${COLORS.accent}` : `1px solid ${COLORS.border}`,
                    background: viewMode === mode.id ? COLORS.accent : "rgba(15,23,42,0.6)",
                    color: COLORS.text,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {mode.label}
                </button>
              ))}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, color: COLORS.textMuted }}>Hops</span>
              <input
                type="range"
                min={1}
                max={3}
                step={1}
                value={hops}
                onChange={(e) => setHops(Number(e.target.value))}
              />
              <span style={{ fontSize: 11, color: COLORS.textMuted }}>{hops}</span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, color: COLORS.textMuted }}>Weight</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={minEdgeWeight}
                onChange={(e) => setMinEdgeWeight(Number(e.target.value))}
              />
              <span style={{ fontSize: 11, color: COLORS.textMuted }}>{minEdgeWeight.toFixed(2)}</span>
            </div>

            <label style={{ fontSize: 11, color: COLORS.textMuted, display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={strictMode}
                onChange={(e) => setStrictMode(e.target.checked)}
              />
              Strict official-only
            </label>
            <label style={{ fontSize: 11, color: COLORS.textMuted, display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={includeHypothesis}
                onChange={(e) => setIncludeHypothesis(e.target.checked)}
              />
              Show hypotheses
            </label>

            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                onClick={() => generate()}
                title="Refresh"
                style={{
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: `1px solid ${COLORS.border}`,
                  background: "rgba(15,23,42,0.6)",
                  color: COLORS.text,
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                ⟳
              </button>
              <button
                type="button"
                onClick={() => setShowSettingsPanel((value) => !value)}
                title="Settings"
                style={{
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: `1px solid ${COLORS.border}`,
                  background: showSettingsPanel ? "rgba(59,130,246,0.2)" : "rgba(15,23,42,0.6)",
                  color: COLORS.text,
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                ⚙
              </button>
              <button
                type="button"
                onClick={handleExportSnapshot}
                title="Export snapshot"
                style={{
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: `1px solid ${COLORS.border}`,
                  background: "rgba(15,23,42,0.6)",
                  color: COLORS.text,
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                ⤓
              </button>
              <button
                type="button"
                onClick={() => setShowExposureBrief(true)}
                title="Exposure Brief"
                style={{
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: `1px solid ${COLORS.accent}`,
                  background: "rgba(59,130,246,0.16)",
                  color: COLORS.accent,
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                Brief
              </button>
              <button
                type="button"
                onClick={() => setShowEnrichmentPanel((value) => !value)}
                title="Graph enrichment memory inspector"
                style={{
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: `1px solid ${COLORS.border}`,
                  background: showEnrichmentPanel ? "rgba(34,197,94,0.2)" : "rgba(15,23,42,0.6)",
                  color: COLORS.text,
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                MEM
              </button>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <ContextChip label="Name" value={(mindMapData?.centerTicker ?? searchTicker) || "-"} />
          <ContextChip label="Mode" value={viewMode.toUpperCase()} />
          <ContextChip label="Scenario" value={workspaceSettings.scenario} />
          <ContextChip label="Horizon" value={workspaceSettings.timeHorizon} />
          <ContextChip label="Style" value={workspaceSettings.dataStyle} />
          <ContextChip label="Confidence" value={`${Math.round(workspaceSettings.confidenceThreshold * 100)}%+`} />
          <ContextChip label="Overlays" value={workspaceSettings.activeOverlays.slice(0, 2).join(" + ")} />
          {currentModel && (
            <div style={{ fontSize: 11, color: COLORS.textMuted }}>
              Model: <b>{currentModel.provider}</b> • <b>{currentModel.model}</b>
            </div>
          )}
          {strictMode && (
            <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.8, color: "#22c55e" }}>
              Official-only active
            </span>
          )}
          {fromCache && (
            <span style={{ fontSize: 11, color: COLORS.success }}>✓ Cached graph shown</span>
          )}
          {loading && mindMapData && (
            <span style={{ fontSize: 11, color: COLORS.warning }}>Refreshing / expanding…</span>
          )}
        </div>

        <div style={{ marginTop: 12 }}>
          <TedSupplyChainOverlayPanel
            tickerOrName={mindMapData?.centerTicker ?? searchTicker}
            windowDays="90d"
          />
        </div>

        {error && (
          <div
            style={{
              marginTop: "12px",
              padding: "12px",
              background: `${COLORS.error}20`,
              border: `1px solid ${COLORS.error}`,
              borderRadius: "6px",
              fontSize: "14px",
              color: COLORS.error,
            }}
          >
            {error}
          </div>
        )}

        {showEnrichmentPanel && (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 12,
              border: "1px solid rgba(34,197,94,0.35)",
              background: "rgba(15,23,42,0.85)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 12, fontWeight: 700 }}>Graph Enrichment Memory Inspector</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => void refreshEnrichmentInspector()}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: `1px solid ${COLORS.border}`,
                    background: "rgba(15,23,42,0.65)",
                    color: COLORS.text,
                    fontSize: 11,
                    cursor: "pointer",
                  }}
                >
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const api = window.cockpit?.supplyChain;
                    if (!api?.exportEnrichmentSnapshot) return;
                    setEnrichmentStatusText(null);
                    try {
                      const result = await api.exportEnrichmentSnapshot();
                      if (result?.success && result.data) {
                        setEnrichmentStatusText(`Exported JSON: ${result.data.jsonPath}`);
                      } else {
                        setEnrichmentStatusText(result?.error || "Export failed");
                      }
                    } catch (err) {
                      setEnrichmentStatusText(`Export failed: ${String(err)}`);
                    }
                  }}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: `1px solid ${COLORS.border}`,
                    background: "rgba(15,23,42,0.65)",
                    color: COLORS.text,
                    fontSize: 11,
                    cursor: "pointer",
                  }}
                >
                  Export JSON/CSV
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const api = window.cockpit?.supplyChain;
                    if (!api?.runEnrichmentMaintenance) return;
                    setEnrichmentStatusText(null);
                    try {
                      const result = await api.runEnrichmentMaintenance();
                      if (result?.success && result.data) {
                        setEnrichmentStatusText(
                          `Maintenance: stale entities ${result.data.staleEntities}, stale edges ${result.data.staleEdges}, queued revalidations ${result.data.queuedRevalidations}`,
                        );
                        await refreshEnrichmentInspector();
                      } else {
                        setEnrichmentStatusText(result?.error || "Maintenance failed");
                      }
                    } catch (err) {
                      setEnrichmentStatusText(`Maintenance failed: ${String(err)}`);
                    }
                  }}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: `1px solid ${COLORS.border}`,
                    background: "rgba(15,23,42,0.65)",
                    color: COLORS.text,
                    fontSize: 11,
                    cursor: "pointer",
                  }}
                >
                  Run Maintenance
                </button>
              </div>
            </div>

            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11, color: COLORS.textMuted }}>
              <span>Entities: {enrichmentInspector?.summary.totalEntities ?? 0}</span>
              <span>Edges: {enrichmentInspector?.summary.totalEdges ?? 0}</span>
              <span>Candidate: {enrichmentInspector?.summary.candidateItems ?? 0}</span>
              <span>Validation: {enrichmentInspector?.summary.validationItems ?? 0}</span>
              <span>Production: {enrichmentInspector?.summary.productionItems ?? 0}</span>
              <span>Stale: {enrichmentInspector?.summary.staleItems ?? 0}</span>
              <span>Low confidence: {enrichmentInspector?.summary.lowConfidenceItems ?? 0}</span>
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <input
                value={enrichmentSubgraphQuery}
                onChange={(e) => setEnrichmentSubgraphQuery(e.target.value)}
                placeholder="Lookup cached subgraph by entity/alias"
                style={{
                  flex: 1,
                  minWidth: 260,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: `1px solid ${COLORS.border}`,
                  background: "rgba(2,6,23,0.6)",
                  color: COLORS.text,
                  fontSize: 12,
                }}
              />
              <button
                type="button"
                onClick={async () => {
                  const api = window.cockpit?.supplyChain;
                  if (!api?.getEnrichmentCachedSubgraph) return;
                  try {
                    const result = await api.getEnrichmentCachedSubgraph({ query: enrichmentSubgraphQuery, hops: 1 });
                    if (result?.success && result.data) {
                      setEnrichmentSubgraphStats({
                        entities: result.data.entities.length,
                        edges: result.data.edges.length,
                        staleDetected: result.data.staleDetected,
                      });
                    } else {
                      setEnrichmentStatusText(result?.error || "Subgraph lookup failed");
                    }
                  } catch (err) {
                    setEnrichmentStatusText(`Subgraph lookup failed: ${String(err)}`);
                  }
                }}
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: `1px solid ${COLORS.border}`,
                  background: "rgba(15,23,42,0.65)",
                  color: COLORS.text,
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                Cached Lookup
              </button>
              {enrichmentSubgraphStats && (
                <span style={{ fontSize: 11, color: COLORS.textMuted }}>
                  Subgraph entities {enrichmentSubgraphStats.entities}, edges {enrichmentSubgraphStats.edges}, stale {enrichmentSubgraphStats.staleDetected}
                </span>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
              <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 10, minHeight: 84 }}>
                <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 6 }}>Stale Entities</div>
                {(enrichmentInspector?.staleEntities ?? []).slice(0, 4).map((item) => (
                  <div key={item.id} style={{ fontSize: 11, marginBottom: 4 }}>
                    {item.canonicalName} ({item.zone}) c={item.confidenceScore.toFixed(2)}
                  </div>
                ))}
              </div>
              <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 10, minHeight: 84 }}>
                <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 6 }}>Low Confidence Edges</div>
                {(enrichmentInspector?.lowConfidenceEdges ?? []).slice(0, 4).map((item) => (
                  <div key={item.id} style={{ fontSize: 11, marginBottom: 4 }}>
                    {item.fromEntityId} → {item.toEntityId} ({item.relationType}) c={item.confidenceScore.toFixed(2)}
                  </div>
                ))}
              </div>
              <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 10, minHeight: 84 }}>
                <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 6 }}>Cloud-Ready Sync</div>
                <div style={{ fontSize: 11 }}>Provider: {enrichmentSync?.provider ?? "placeholder"}</div>
                <div style={{ fontSize: 11 }}>Mode: {enrichmentSync?.mode ?? "manual"}</div>
                <div style={{ fontSize: 11 }}>Connected: {enrichmentSync?.connected ? "yes" : "no"}</div>
                <div style={{ fontSize: 11 }}>Queue: {enrichmentSync?.queueSize ?? 0}</div>
              </div>
            </div>

            {(enrichmentStatusText || enrichmentLoading) && (
              <div style={{ fontSize: 11, color: enrichmentStatusText?.toLowerCase().includes("failed") ? COLORS.error : COLORS.textMuted }}>
                {enrichmentLoading ? "Loading inspector..." : enrichmentStatusText}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Content Area */}
      <div style={{ flex: 1, overflow: "auto", position: "relative" }}>
        {loading && <LoadingSpinner />}
        
        {!loading && !mindMapData && !error && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: COLORS.textMuted,
              fontSize: "16px",
            }}
          >
            Enter a ticker symbol to generate supply chain visualization
          </div>
        )}
        
        {!loading && mindMapData && (
          <SupplyChainWorkspace
            data={mindMapData}
            viewMode={viewMode}
            simulation={simulation}
            strictMode={strictMode}
            includeHypothesis={includeHypothesis}
            hops={hops}
            minEdgeWeight={minEdgeWeight}
            globalTickers={globalTickers}
            selectedNodeId={selectedNodeId}
            selectedEdgeId={selectedEdgeId}
            gwmdFilters={gwmdFilters}
            onGwmdFiltersChange={setGwmdFilters}
            onSelectNode={setSelectedNode}
            onSelectEdge={setSelectedEdge}
            onSelectRisk={(nodeIds) => setSelectedNode(nodeIds[0] ?? null)}
            onViewModeChange={setViewMode}
            onSimulateNode={toggleNodeFailure}
            onSimulateEdge={toggleEdgeFailure}
            onRunShock={runShockSimulation}
            onSetShockSeverity={setShockSeverity}
            onSetShockDamping={setShockDamping}
            onSetShockIncludeKinds={setShockIncludeKinds}
            onResetSimulation={resetSimulation}
            settings={workspaceSettings}
            showSettingsPanel={showSettingsPanel}
            onSettingsChange={setWorkspaceSettings}
          />
        )}
      </div>

      <SupplyChainAdvisorPopup mindMapData={mindMapData} />
      <ExposureBriefPanel
        open={showExposureBrief}
        onClose={() => setShowExposureBrief(false)}
        preferredSource="supplyChain"
      />
    </div>
  );
}

function LoadingSpinner() {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: `${COLORS.bg}dd`,
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        style={{
          width: "48px",
          height: "48px",
          border: `4px solid ${COLORS.border}`,
          borderTopColor: COLORS.accent,
          borderRadius: "50%",
          animation: "spin 1s linear infinite",
        }}
      />
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes pulseDots {
          0% { content: ""; }
          33% { content: "."; }
          66% { content: ".."; }
          100% { content: "..."; }
        }
        .loading-dots::after {
          content: "";
          display: inline-block;
          animation: pulseDots 1.2s infinite steps(1, end);
        }
      `}</style>
      <div style={{ marginTop: "16px", fontSize: "14px", color: COLORS.textMuted }}>
        Llama AI is analyzing supply chain relationships
        <span style={{ marginLeft: 6, display: "inline-block" }} className="loading-dots" />
      </div>
      <div
        style={{
          marginTop: 12,
          fontSize: "12px",
          color: COLORS.textMuted,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          alignItems: "center",
        }}
      >
        <div>• Contacting local model</div>
        <div>• Validating response</div>
        <div>• Enriching with live signals</div>
      </div>
    </div>
  );
}

interface SupplyChainWorkspaceProps {
  data: MindMapData;
  viewMode: SupplyChainViewMode;
  simulation: {
    failedNodeIds: string[];
    failedEdgeIds: string[];
    impactScores?: Record<string, number>;
    impactRanges?: Record<string, { min: number; max: number }>;
    impactedEdgeIds?: string[];
    rankedImpacts?: Array<{ nodeId: string; score: number; minScore?: number; maxScore?: number }>;
    params: { severity: number; damping: number; includeKinds?: SupplyChainGraph["edges"][number]["kind"][] };
  };
  strictMode: boolean;
  includeHypothesis: boolean;
  hops: number;
  minEdgeWeight: number;
  globalTickers: string[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  gwmdFilters: {
    region: string;
    relation: string;
    showFlows: boolean;
    showOnlyImpacted: boolean;
  };
  onGwmdFiltersChange: (next: { region: string; relation: string; showFlows: boolean; showOnlyImpacted: boolean }) => void;
  onSelectNode: (nodeId: string | null) => void;
  onSelectEdge: (edgeId: string | null) => void;
  onSelectRisk: (nodeIds: string[]) => void;
  onViewModeChange: (mode: SupplyChainViewMode) => void;
  onSimulateNode: (nodeId: string) => void;
  onSimulateEdge: (edgeId: string) => void;
  onRunShock: (nodeId: string) => void;
  onSetShockSeverity: (value: number) => void;
  onSetShockDamping: (value: number) => void;
  onSetShockIncludeKinds: (kinds: SupplyChainGraph["edges"][number]["kind"][] | undefined) => void;
  onResetSimulation: () => void;
  settings: IntelligenceWorkspaceSettings;
  showSettingsPanel: boolean;
  onSettingsChange: React.Dispatch<React.SetStateAction<IntelligenceWorkspaceSettings>>;
}

function SupplyChainWorkspace(props: SupplyChainWorkspaceProps) {
  const legendItems = useMemo(() => {
    const edges = props.data.graph?.edges ?? [];
    const kinds = Array.from(new Set(edges.map((edge) => edge.kind)));
    const palette: Record<string, string> = {
      supplier: "#22c55e",
      customer: "#38bdf8",
      partner: "#a855f7",
      license: "#f59e0b",
      financing: "#f97316",
      competitor: "#ef4444",
      other: "#64748b",
    };
    return kinds.slice(0, 6).map((kind) => ({
      kind,
      color: palette[kind] ?? "#64748b",
    }));
  }, [props.data.graph]);

  const statusLine = useMemo(() => {
    const time = new Date(props.data.generatedAt).toLocaleTimeString();
    const selected = props.selectedNodeId ? `Selected ${props.selectedNodeId}` : props.selectedEdgeId ? `Edge ${props.selectedEdgeId}` : "Idle";
    return `Last action: ${selected} • Updated ${time}`;
  }, [props.data.generatedAt, props.selectedEdgeId, props.selectedNodeId]);

  return (
    <div style={{ display: "flex", gap: 16, flex: 1, minHeight: 0, padding: 20 }}>
      {props.showSettingsPanel && (
        <IntelligenceSettingsPanel
          settings={props.settings}
          onChange={props.onSettingsChange}
        />
      )}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "10px 14px",
            borderRadius: 12,
            border: "1px solid rgba(148,163,184,0.15)",
            background: "rgba(15,23,42,0.75)",
          }}
        >
          {props.viewMode !== "global" ? (
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => props.onViewModeChange("flow")}
                style={{
                  padding: "6px 12px",
                  borderRadius: 999,
                  border: props.viewMode === "flow" ? `1px solid ${COLORS.accent}` : `1px solid ${COLORS.border}`,
                  background: props.viewMode === "flow" ? COLORS.accent : "transparent",
                  color: COLORS.text,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Graph
              </button>
              <button
                onClick={() => props.onViewModeChange("shock")}
                style={{
                  padding: "6px 12px",
                  borderRadius: 999,
                  border: props.viewMode === "shock" ? `1px solid ${COLORS.accent}` : `1px solid ${COLORS.border}`,
                  background: props.viewMode === "shock" ? COLORS.accent : "transparent",
                  color: COLORS.text,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Top Paths
              </button>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: COLORS.textMuted }}>GWMD • Global World Map Display</div>
          )}

          <div style={{ display: "flex", gap: 10, fontSize: 11, color: COLORS.textMuted, alignItems: "center" }}>
            {props.viewMode !== "global" && (
              <>
                {legendItems.map((item) => (
                  <div key={item.kind} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: item.color, display: "inline-block" }} />
                    {item.kind}
                  </div>
                ))}
                {props.includeHypothesis && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, border: "1px dashed rgba(148,163,184,0.6)" }} />
                    Hypothesis
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div
          style={{ flex: 1, minHeight: 0, position: "relative" }}
          data-export-target="supply-chain-canvas"
        >
          <VisualizationSurface
            data={props.data}
            viewMode={props.viewMode}
            simulation={props.simulation}
            selectedNodeId={props.selectedNodeId}
            selectedEdgeId={props.selectedEdgeId}
            strictMode={props.strictMode}
            includeHypothesis={props.includeHypothesis}
            hops={props.hops}
            minEdgeWeight={props.minEdgeWeight}
            intelligenceSettings={props.settings}
            globalTickers={props.globalTickers}
            gwmdFilters={props.gwmdFilters}
            onGwmdFiltersChange={props.onGwmdFiltersChange}
            onSelectNode={(nodeId) => props.onSelectNode(nodeId)}
            onSelectEdge={(edgeId) => props.onSelectEdge(edgeId)}
            onSelectRisk={props.onSelectRisk}
          />

          <div
            style={{
              position: "absolute",
              bottom: 12,
              left: 12,
              right: 12,
              padding: "8px 12px",
              borderRadius: 10,
              background: "rgba(10,14,26,0.75)",
              border: "1px solid rgba(148,163,184,0.12)",
              fontSize: 11,
              color: "#94a3b8",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>{statusLine}</span>
            <span>{props.data.generatedAt ? new Date(props.data.generatedAt).toLocaleString() : ""}</span>
          </div>
        </div>
      </div>

      <ContextPanel
        mindMap={props.data}
        selectedNodeId={props.selectedNodeId}
        selectedEdgeId={props.selectedEdgeId}
        viewMode={props.viewMode}
        strictMode={props.strictMode}
        includeHypothesis={props.includeHypothesis}
        simulation={props.simulation}
        gwmdFilters={props.gwmdFilters}
        onGwmdFiltersChange={props.onGwmdFiltersChange}
        onSelectNode={(nodeId) => props.onSelectNode(nodeId)}
        onSelectEdge={(edgeId) => props.onSelectEdge(edgeId)}
        onSimulateNode={(nodeId) => props.onSimulateNode(nodeId)}
        onSimulateEdge={(edgeId) => props.onSimulateEdge(edgeId)}
        onRunShock={(nodeId) => props.onRunShock(nodeId)}
        onSetShockSeverity={props.onSetShockSeverity}
        onSetShockDamping={props.onSetShockDamping}
        onSetShockIncludeKinds={props.onSetShockIncludeKinds}
        onResetSimulation={props.onResetSimulation}
        intelligenceSettings={props.settings}
      />
    </div>
  );
}

function ContextChip({ label, value }: { label: string; value: string }) {
  return (
    <span
      style={{
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: 0.8,
        color: "#bfdbfe",
        border: "1px solid rgba(59,130,246,0.3)",
        background: "rgba(59,130,246,0.12)",
        borderRadius: 999,
        padding: "4px 8px",
      }}
    >
      {label}: <strong style={{ color: "#e2e8f0" }}>{value}</strong>
    </span>
  );
}

function IntelligenceSettingsPanel({
  settings,
  onChange,
}: {
  settings: IntelligenceWorkspaceSettings;
  onChange: React.Dispatch<React.SetStateAction<IntelligenceWorkspaceSettings>>;
}) {
  const toggleOverlay = (overlay: string) => {
    onChange((previous) => {
      const exists = previous.activeOverlays.includes(overlay);
      return {
        ...previous,
        activeOverlays: exists
          ? previous.activeOverlays.filter((value) => value !== overlay)
          : [...previous.activeOverlays, overlay],
      };
    });
  };

  return (
    <aside
      style={{
        width: 290,
        minWidth: 260,
        border: "1px solid rgba(148,163,184,0.16)",
        borderRadius: 16,
        background: "rgba(15,23,42,0.86)",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        overflowY: "auto",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700 }}>Filters & Methods</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <SelectControl
          label="Upstream"
          value={String(settings.upstreamDepth)}
          options={["1", "2", "3"]}
          onChange={(value) => onChange((previous) => ({ ...previous, upstreamDepth: Number(value) }))}
        />
        <SelectControl
          label="Downstream"
          value={String(settings.downstreamDepth)}
          options={["1", "2", "3"]}
          onChange={(value) => onChange((previous) => ({ ...previous, downstreamDepth: Number(value) }))}
        />
      </div>
      <SelectControl
        label="Relation scope"
        value={settings.relationScope}
        options={["suppliers", "customers", "both"]}
        onChange={(value) => onChange((previous) => ({ ...previous, relationScope: value as IntelligenceWorkspaceSettings["relationScope"] }))}
      />
      <SelectControl
        label="Point in time"
        value={settings.pointInTimeMode}
        options={["live", "historical"]}
        onChange={(value) => onChange((previous) => ({ ...previous, pointInTimeMode: value as IntelligenceWorkspaceSettings["pointInTimeMode"] }))}
      />
      <SelectControl
        label="Data style"
        value={settings.dataStyle}
        options={["reported-first", "blended", "inference-heavy"]}
        onChange={(value) => onChange((previous) => ({ ...previous, dataStyle: value as IntelligenceWorkspaceSettings["dataStyle"] }))}
      />
      <SelectControl
        label="Ranking"
        value={settings.rankingMethod}
        options={["exposure", "criticality", "confidence"]}
        onChange={(value) => onChange((previous) => ({ ...previous, rankingMethod: value as IntelligenceWorkspaceSettings["rankingMethod"] }))}
      />
      <SelectControl
        label="Exposure model"
        value={settings.exposureMethod}
        options={["weight", "hhi", "hybrid"]}
        onChange={(value) => onChange((previous) => ({ ...previous, exposureMethod: value as IntelligenceWorkspaceSettings["exposureMethod"] }))}
      />
      <SelectControl
        label="Scenario"
        value={settings.scenario}
        options={["Baseline", "Supplier Outage", "Sanctions", "Tariff Shock", "Shipping Delay"]}
        onChange={(value) => onChange((previous) => ({ ...previous, scenario: value }))}
      />
      <SelectControl
        label="Horizon"
        value={settings.timeHorizon}
        options={["1D", "1W", "1M", "1Q"]}
        onChange={(value) => onChange((previous) => ({ ...previous, timeHorizon: value as IntelligenceWorkspaceSettings["timeHorizon"] }))}
      />
      <label style={{ fontSize: 11, color: "#94a3b8" }}>
        Confidence floor {Math.round(settings.confidenceThreshold * 100)}%
      </label>
      <input
        type="range"
        min={0.3}
        max={0.95}
        step={0.05}
        value={settings.confidenceThreshold}
        onChange={(event) => onChange((previous) => ({ ...previous, confidenceThreshold: Number(event.target.value) }))}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <label style={{ fontSize: 11, color: "#94a3b8", display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={settings.showFacilities}
            onChange={(event) => onChange((previous) => ({ ...previous, showFacilities: event.target.checked }))}
          />
          Facilities
        </label>
        <label style={{ fontSize: 11, color: "#94a3b8", display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={settings.showRoutes}
            onChange={(event) => onChange((previous) => ({ ...previous, showRoutes: event.target.checked }))}
          />
          Routes
        </label>
      </div>
      <div style={{ fontSize: 11, color: "#94a3b8" }}>Risk overlays</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {["Geopolitical", "Tariff", "Shipping", "Weather", "Energy", "Default"].map((overlay) => {
          const active = settings.activeOverlays.includes(overlay);
          return (
            <button
              key={overlay}
              onClick={() => toggleOverlay(overlay)}
              style={{
                border: active ? "1px solid rgba(59,130,246,0.65)" : "1px solid rgba(148,163,184,0.28)",
                borderRadius: 999,
                background: active ? "rgba(59,130,246,0.2)" : "transparent",
                color: active ? "#bfdbfe" : "#94a3b8",
                fontSize: 10,
                padding: "4px 8px",
                cursor: "pointer",
              }}
            >
              {overlay}
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function SelectControl({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "#94a3b8" }}>
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{
          border: "1px solid rgba(148,163,184,0.25)",
          borderRadius: 8,
          background: "rgba(2,6,23,0.9)",
          color: "#e2e8f0",
          fontSize: 11,
          padding: "6px 8px",
        }}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}



type ChatMessage = {
  role: "user" | "assistant";
  text: string;
};

/**
 * Capture all visible cockpit data for AI context sharing
 */
function captureCockpitContext(): Record<string, unknown> {
  try {
    const streamStore = useStreamStore.getState?.();
    const tradingStore = useTradingStore.getState?.();

    const context: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      source: streamStore?.source ?? "unknown",
    };

    // Market data
    if (streamStore?.lastHeartbeat) {
      context.heartbeat = streamStore.lastHeartbeat;
    }

    // Trading account info
    if (tradingStore?.account) {
      context.account = {
        balance: tradingStore.account.balance,
        equity: tradingStore.account.equity,
        buyingPower: tradingStore.account.buyingPower,
        dailyPnl: tradingStore.account.dailyPnl,
        dailyPnlPercent: tradingStore.account.dailyPnlPercent,
      };
    }

    // Positions
    if (tradingStore?.positions) {
      context.positions = tradingStore.positions.map((p) => ({
        symbol: p.symbol,
        qty: p.qty,
        avgPrice: p.avgPrice,
        unrealizedPnl: p.unrealizedPnl,
        realizedPnl: p.realizedPnl,
        side: p.qty > 0 ? "long" : "short",
      }));
    }

    // Recent orders (last 5)
    if (tradingStore?.orders) {
      context.recentOrders = tradingStore.orders.slice(0, 5).map((o) => ({
        orderId: o.orderId,
        symbol: o.symbol,
        qty: o.qty,
        avgFillPrice: o.avgFillPrice,
        side: o.side,
        status: o.status,
        createdAt: o.createdAt,
      }));
    }

    return context;
  } catch (err) {
    console.warn("[advisor] Failed to capture cockpit context:", err);
    return { timestamp: new Date().toISOString(), error: String(err) };
  }
}

function SupplyChainAdvisorPopup({ mindMapData }: { mindMapData: MindMapData | null }) {
  const aiContextSharingEnabled = useSettingsStore((s) => s.aiContextSharingEnabled);
  const [open, setOpen] = useState(true);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text: "Ask Llama where the supply chain facts came from, or share a screenshot for quick review.",
    },
  ]);
  const [imageName, setImageName] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Window dimensions for resizable popup
  const [width, setWidth] = useState(380);
  const [height, setHeight] = useState(500);
  const resizeRef = useRef<HTMLDivElement>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const positionInitializedRef = useRef(false);
  const [position, setPosition] = useState({ x: 16, y: 16 });

  const maxImageSize = 5 * 1024 * 1024; // 5MB guardrail for base64 payloads

  const handleFileChange = (file?: File) => {
    if (!file) return;
    if (file.size > maxImageSize) {
      setError("Screenshot too large (max 5MB)");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setImagePreview(reader.result as string);
      setImageName(file.name);
    };
    reader.readAsDataURL(file);
  };

  // Initialize popup position (bottom-right by default)
  useEffect(() => {
    if (positionInitializedRef.current) return;
    if (typeof window === "undefined") return;
    const nextX = Math.max(16, window.innerWidth - width - 24);
    const nextY = Math.max(16, window.innerHeight - height - 24);
    setPosition({ x: nextX, y: nextY });
    positionInitializedRef.current = true;
  }, [width, height]);

  // Resize handler
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !resizeRef.current) return;

      const container = resizeRef.current.parentElement;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const newWidth = Math.max(300, e.clientX - rect.left - 16);
      const newHeight = Math.max(300, e.clientY - rect.top - 16);

      setWidth(newWidth);
      setHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isResizing]);

  // Drag handler
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !dragOffsetRef.current) return;
      if (typeof window === "undefined") return;

      const nextX = Math.min(
        window.innerWidth - 120,
        Math.max(8, e.clientX - dragOffsetRef.current.x)
      );
      const nextY = Math.min(
        window.innerHeight - 120,
        Math.max(8, e.clientY - dragOffsetRef.current.y)
      );

      setPosition({ x: nextX, y: nextY });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      dragOffsetRef.current = null;
    };

    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging]);

  const askAdvisor = async () => {
    const trimmed = question.trim();
    if (!trimmed) {
      setError("Please enter a question first");
      return;
    }

    setError(null);
    setLoading(true);
    setMessages((prev) => [...prev, { role: "user", text: trimmed }]);

    try {
      const payload: SupplyChainAdvisorRequest = {
        question: trimmed,
        mindMapData: mindMapData ?? null,
      };

      // Add optional fields if available
      if (imagePreview) {
        payload.imageBase64 = imagePreview;
      }
      if (imageName) {
        payload.imageName = imageName;
      }

      // Add cockpit context if enabled
      if (aiContextSharingEnabled) {
        payload.cockpitContext = captureCockpitContext();
      }

      const api = window.cockpit?.supplyChain;
      const response = await api?.askAdvisor?.(payload);

      if (!response?.success) {
        setError(response?.error || "Advisor unavailable");
        return;
      }

      const sourcesLine = response.sources?.length
        ? `\n\n📎 Sources:\n${response.sources.map((s) => `• ${s}`).join("\n")}`
        : "";
      const followupsLine = response.followups?.length
        ? `\n\n💡 Ask next:\n${response.followups.map((f) => `• ${f}`).join("\n")}`
        : "";

      const answerText = `${response.answer ?? "No answer returned."}${sourcesLine}${followupsLine}`.trim();

      setMessages((prev) => [...prev, { role: "assistant", text: answerText }]);
      setQuestion("");
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button
        style={{
          position: "absolute",
          right: 16,
          bottom: 16,
          padding: "10px 16px",
          background: COLORS.accent,
          color: COLORS.text,
          border: "none",
          borderRadius: "999px",
          cursor: "pointer",
          boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
        }}
        onClick={() => setOpen(true)}
      >
        🧭 Llama advisor
      </button>
    );
  }

  return (
    <div
      ref={resizeRef}
      style={{
        position: "fixed",
        left: position.x,
        top: position.y,
        width,
        height,
        background: COLORS.bgSecondary,
        border: `2px solid ${COLORS.accent}44`,
        borderRadius: "16px",
        boxShadow: "0 20px 50px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(255,255,255,0.05)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        zIndex: 10000,
      }}
    >
      <div
        style={{
          padding: "12px 14px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: `1px solid ${COLORS.border}`,
          background: `linear-gradient(180deg, ${COLORS.bg}ee 0%, ${COLORS.bg}cc 100%)`,
          cursor: "move",
          userSelect: "none",
        }}
          onMouseDown={(e) => {
            const target = e.target as HTMLElement | null;
            if (target?.closest("button")) return;
            dragOffsetRef.current = {
              x: e.clientX - position.x,
              y: e.clientY - position.y,
            };
            setIsDragging(true);
            e.currentTarget.style.background = `linear-gradient(180deg, ${COLORS.accent}33 0%, ${COLORS.accent}22 100%)`;
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.background = `linear-gradient(180deg, ${COLORS.bg}ee 0%, ${COLORS.bg}cc 100%)`;
          }}
      >
        <div style={{ fontWeight: 600, fontSize: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
          🧭 Llama supply chain advisor
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {mindMapData ? (
            <span style={{ fontSize: "11px", color: COLORS.textMuted }}>
              Context: {mindMapData.centerTicker}
            </span>
          ) : (
            <span style={{ fontSize: "11px", color: COLORS.warning }}>Generate a map for better answers</span>
          )}
          {aiContextSharingEnabled && (
            <span style={{ fontSize: "11px", color: COLORS.success }}>📊 Cockpit data shared</span>
          )}
          <button
            onClick={() => setOpen(false)}
            style={{
              border: `1px solid ${COLORS.border}`,
              background: COLORS.bgSecondary,
              color: COLORS.text,
              borderRadius: "999px",
              width: 28,
              height: 28,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              fontSize: "16px",
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = COLORS.accent;
              e.currentTarget.style.transform = "scale(1.1)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = COLORS.bgSecondary;
              e.currentTarget.style.transform = "scale(1)";
            }}
            aria-label="Hide advisor"
          >
            ✕
          </button>
        </div>
      </div>

      <div
        style={{
          padding: "12px",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          flex: 1,
          overflow: "hidden",
          position: "relative",
        }}
      >
        {loading && (
          <div
            style={{
              position: "absolute",
              inset: 12,
              background: "rgba(10, 14, 26, 0.78)",
              border: `1px solid ${COLORS.border}`,
              borderRadius: 12,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 5,
              backdropFilter: "blur(6px)",
              gap: 8,
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                border: `3px solid ${COLORS.border}`,
                borderTopColor: COLORS.accent,
                borderRadius: "50%",
                animation: "spin 1s linear infinite",
              }}
            />
            <div style={{ fontSize: 13, color: COLORS.textMuted, textAlign: "center" }}>
              Thinking through your question…
            </div>
            <div style={{ fontSize: 11, color: COLORS.textMuted, textAlign: "center" }}>
              • Searching sources • Running model • Formatting reply
            </div>
          </div>
        )}
        <div
          style={{
            maxHeight: height - 280,
            overflowY: "auto",
            background: COLORS.bg,
            border: `1px solid ${COLORS.border}`,
            borderRadius: "10px",
            padding: "10px",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          {messages.map((msg, idx) => (
            <div
              key={`${msg.role}-${idx}`}
              style={{
                alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                background: msg.role === "user" ? `${COLORS.accent}33` : `${COLORS.bgSecondary}`,
                border: `1px solid ${COLORS.border}`,
                borderRadius: "10px",
                padding: "8px 10px",
                fontSize: "13px",
                whiteSpace: "pre-wrap",
                maxWidth: "100%",
                wordBreak: "break-word",
              }}
            >
              {msg.role === "assistant" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {msg.text.split("\n\n").map((para, pidx) => (
                    <div key={pidx}>
                      {para.startsWith("📎") || para.startsWith("💡") ? (
                        <div style={{ color: COLORS.textMuted, fontSize: "12px" }}>
                          {para.split("\n").map((line, lidx) => (
                            <div key={lidx}>
                              {line.match(/^https?:\/\//) ? (
                                <a
                                  href={line.replace("• ", "")}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{
                                    color: COLORS.accent,
                                    textDecoration: "underline",
                                    cursor: "pointer",
                                  }}
                                >
                                  {line}
                                </a>
                              ) : (
                                line
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        para
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                msg.text
              )}
            </div>
          ))}
        </div>

        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask where a fact came from, or how confident Llama is..."
          rows={2}
          style={{
            width: "100%",
            padding: "10px",
            background: COLORS.bg,
            color: COLORS.text,
            border: `1px solid ${COLORS.border}`,
            borderRadius: "10px",
            fontSize: "13px",
            resize: "none",
            minHeight: 60,
          }}
        />

        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 10px",
              background: COLORS.bgSecondary,
              border: `1px solid ${COLORS.border}`,
              borderRadius: "8px",
              cursor: "pointer",
              fontSize: "12px",
            }}
          >
            📎 Upload screenshot
            <input
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => handleFileChange(e.target.files?.[0])}
            />
          </label>
          {imageName && (
            <div style={{ fontSize: "12px", color: COLORS.textMuted }}>
              {imageName}
              <button
                onClick={() => {
                  setImageName(null);
                  setImagePreview(null);
                }}
                style={{
                  marginLeft: 6,
                  background: "transparent",
                  color: COLORS.text,
                  border: "none",
                  cursor: "pointer",
                }}
                aria-label="Remove screenshot"
              >
                ✕
              </button>
            </div>
          )}
        </div>

        {error && (
          <div
            style={{
              padding: "8px 10px",
              background: `${COLORS.error}22`,
              border: `1px solid ${COLORS.error}55`,
              color: COLORS.error,
              borderRadius: "8px",
              fontSize: "12px",
            }}
          >
            {error}
          </div>
        )}

        <button
          onClick={askAdvisor}
          disabled={loading}
          style={{
            padding: "10px",
            background: loading ? COLORS.border : COLORS.accent,
            color: COLORS.text,
            border: "none",
            borderRadius: "10px",
            fontWeight: 600,
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.65 : 1,
            width: "100%",
          }}
        >
          {loading ? "Talking to Llama..." : "Ask Llama"}
        </button>
      </div>

      {/* Resize Handle - Bottom Right Corner */}
      <div
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsResizing(true);
        }}
        style={{
          position: "absolute",
          bottom: 0,
          right: 0,
          width: 24,
          height: 24,
          cursor: "nwse-resize",
          background: `linear-gradient(135deg, transparent 50%, ${COLORS.accent}66 50%)`,
          borderRadius: "0 0 16px 0",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "flex-end",
          padding: "4px",
          opacity: 0.7,
          transition: "opacity 0.2s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.opacity = "1";
        }}
        onMouseLeave={(e) => {
          if (!isResizing) {
            e.currentTarget.style.opacity = "0.7";
          }
        }}
        title="Drag to resize window"
      >
        <span style={{ fontSize: "12px", color: COLORS.text, userSelect: "none" }}>⤡</span>
      </div>
    </div>
  );
}

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
  const [showSuggestions, setShowSuggestions] = useState(false);
  
  const [gwmdFilters, setGwmdFilters] = useState(loadGwmdFilters);

  useEffect(() => {
    saveGwmdFilters(gwmdFilters);
  }, [gwmdFilters]);

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
    if (changed && searchTicker.trim()) {
      lastOptionsRef.current = { strictMode, includeHypothesis, hops, minEdgeWeight };
      if (mindMapData) {
        generate();
      }
    }
  }, [strictMode, includeHypothesis, hops, minEdgeWeight, generate, mindMapData, searchTicker]);

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
                { id: "shock", label: "Top Paths" },
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
                title="Settings"
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
            </div>
          </div>
        </div>

        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
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
          />
        )}
      </div>

      <SupplyChainAdvisorPopup mindMapData={mindMapData} />
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
      />
    </div>
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

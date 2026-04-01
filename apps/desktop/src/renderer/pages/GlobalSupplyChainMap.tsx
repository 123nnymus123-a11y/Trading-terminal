import React, { useEffect, useState } from "react";
import { useSupplyChainStore } from "../store/supplyChainStore";
import VisualizationSurface from "../components/supplyChain/VisualizationSurface";

const COLORS = {
  bg: "#0a0e1a",
  text: "#e5e7eb",
  textMuted: "#9ca3af",
  border: "#1f2937",
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

function parseTickers(): string[] {
  if (typeof window === "undefined") return [];
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("tickers") ?? "";
  return raw
    .split("|")
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);
}

export default function GlobalSupplyChainMap() {
  const {
    mindMapData,
    loading,
    error,
    viewMode,
    setViewMode,
    simulation,
    strictMode,
    includeHypothesis,
    hops,
    minEdgeWeight,
    globalTickers,
    selectedNodeId,
    selectedEdgeId,
    setSelectedNode,
    setSelectedEdge,
    loadGlobalGraph,
  } = useSupplyChainStore();

  const [gwmdFilters, setGwmdFilters] = useState(loadGwmdFilters);

  useEffect(() => {
    saveGwmdFilters(gwmdFilters);
  }, [gwmdFilters]);

  useEffect(() => {
    const tickers = parseTickers();
    if (tickers.length > 0) {
      loadGlobalGraph(tickers);
    }
    setViewMode("global");
  }, [loadGlobalGraph, setViewMode]);

  if (loading) {
    return (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.textMuted, background: COLORS.bg }}>
        Loading global map...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.textMuted, background: COLORS.bg }}>
        {error}
      </div>
    );
  }

  if (!mindMapData) {
    return (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.textMuted, background: COLORS.bg }}>
        No global graph loaded
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100%", background: COLORS.bg, color: COLORS.text, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${COLORS.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontWeight: 600 }}>Global Supply Chain Map</div>
        <div style={{ fontSize: 12, color: COLORS.textMuted }}>
          {mindMapData.focalTickers?.join(" • ")}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <VisualizationSurface
          data={mindMapData}
          viewMode={viewMode}
          simulation={simulation}
          selectedNodeId={selectedNodeId}
          selectedEdgeId={selectedEdgeId}
          strictMode={strictMode}
          includeHypothesis={includeHypothesis}
          hops={hops}
          minEdgeWeight={minEdgeWeight}
          intelligenceSettings={{
            upstreamDepth: 2,
            downstreamDepth: 2,
            totalVisibleTiers: 3,
            relationScope: "both",
            showFacilities: true,
            showRoutes: true,
            confidenceThreshold: 0.45,
          }}
          globalTickers={globalTickers}
          gwmdFilters={gwmdFilters}
          onGwmdFiltersChange={setGwmdFilters}
          onSelectNode={setSelectedNode}
          onSelectEdge={setSelectedEdge}
          onSelectRisk={() => undefined}
        />
      </div>
    </div>
  );
}

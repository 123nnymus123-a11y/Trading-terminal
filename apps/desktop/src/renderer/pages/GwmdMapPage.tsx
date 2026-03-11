/**
 * GWMD Map Page
 * Global World Mind-Map Data for company supply chain relationships
 * Search companies, visualize relationships incrementally, persist across sessions
 */

import React, { useState, useMemo, useCallback, useEffect } from "react";
import { useGwmdMapStore } from "../store/gwmdMapStore";
import { useSettingsStore } from "../store/settingsStore";
import GwmdWorldMap from "../components/supplyChain/GwmdWorldMap";
import ContextPanel from "../components/supplyChain/ContextPanel";
import type { MindMapData } from "@tc/shared/supplyChain";

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

export default function GwmdMapPage() {
  const {
    loading,
    error,
    runStatus,
    runMeta,
    graph,
    companies,
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
  } = useGwmdMapStore();

  const [searchInput, setSearchInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

  const getCloudModelFor = useSettingsStore((s) => s.getCloudModelFor);

  // Load persisted data on mount
  useEffect(() => {
    loadFromDb();
  }, [loadFromDb]);

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

  const handleSearch = useCallback(async (ticker: string) => {
    if (!ticker.trim()) return;

    setSearchInput(ticker.toUpperCase());
    setShowSuggestions(false);

    // Try to get cloud model, otherwise use null and backend will use default
    const model = getCloudModelFor?.("supplyChain") || null;
    console.log("[GWMD] Searching for", ticker, "with model:", model || "default");

    await search(ticker.toUpperCase(), { model });
  }, [search, getCloudModelFor]);

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

    return [base, modeText, sourceText, unlocatedText].filter(Boolean).join(" • ");
  }, [companies.length, graph, runStatus, runMeta]);

  const handleDeleteStoredData = useCallback(async () => {
    const confirmed = window.confirm("Delete all stored GWMD map data from local database?");
    if (!confirmed) return;
    await clearPersisted();
  }, [clearPersisted]);

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
    <div style={{ display: "flex", flexDirection: "column", gap: 16, flex: 1, minHeight: 0, padding: 20 }}>
      {/* Header with search and controls */}
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
        </div>

        {/* Controls row */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={() => handleSearch(searchInput)}
            disabled={loading || !searchInput.trim()}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "none",
              background: loading || !searchInput.trim() ? COLORS.border : COLORS.accent,
              color: "white",
              fontSize: 12,
              fontWeight: 600,
              cursor: loading || !searchInput.trim() ? "not-allowed" : "pointer",
              opacity: loading || !searchInput.trim() ? 0.6 : 1,
            }}
          >
            {loading ? "Searching..." : "Search"}
          </button>

          <button
            onClick={() => setShowEmpty(!showEmpty)}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: `1px solid ${COLORS.border}`,
              background: showEmpty ? COLORS.bgSecondary : "transparent",
              color: COLORS.text,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {showEmpty ? "Show All Loaded" : "Empty Map"}
          </button>

          {companies.length > 0 && (
            <>
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

          <div style={{ fontSize: 11, color: COLORS.textMuted, marginLeft: "auto" }}>
            {statusLine}
          </div>
        </div>

        {/* Error display */}
        {error && (
          <div style={{ padding: "8px 12px", borderRadius: 6, background: COLORS.error + "22", color: COLORS.error, fontSize: 12 }}>
            {error}
          </div>
        )}

        {runStatus === "degraded_cache" && (
          <div style={{ padding: "8px 12px", borderRadius: 6, background: COLORS.warning + "22", color: COLORS.warning, fontSize: 12 }}>
            Running in degraded mode from scoped cache. Unlocated: {String((runMeta?.unlocatedCount as number | undefined) ?? 0)} • Hypothesis ratio: {String((runMeta?.hypothesisRatio as number | undefined) ?? 0)}
          </div>
        )}
      </div>

      {/* Main content: Map + Sidebar */}
      <div style={{ display: "flex", gap: 16, flex: 1, minHeight: 0 }}>
        {/* Map container */}
        {showEmpty || companies.length === 0 ? (
          <div
            style={{
              flex: 1,
              minHeight: 0,
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
          <div style={{ flex: 1, minHeight: 0, position: "relative", borderRadius: 12, overflow: "hidden" }}>
            {graph ? (
              <GwmdWorldMap
                graph={graph}
                selectedNodeId={selectedNodeId}
                selectedEdgeId={selectedEdgeId}
                simulation={{ failedNodeIds: [], failedEdgeIds: [] }}
                filters={gwmdFilters}
                onFiltersChange={setGwmdFilters}
                onSelectNode={setSelectedNode}
                onSelectEdge={setSelectedEdge}
              />
            ) : (
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: COLORS.textMuted,
                }}
              >
                <div>Loading map...</div>
              </div>
            )}
          </div>
        )}

        {/* Right sidebar */}
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
        />
      </div>
    </div>
  );
}

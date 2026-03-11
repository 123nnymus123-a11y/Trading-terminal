import React, { useState, useEffect, useMemo } from "react";
import type { MindMapData, SupplyChainGraph, SupplyChainGraphEdge, SupplyChainGraphNode } from "@tc/shared/supplyChain";
import { ensureCanonicalStructures } from "@tc/shared/supplyChainGraph";
import { findTopDependencyPaths } from "@tc/shared/supplyChainSimulation";
import type { SupplyChainViewMode } from "../../store/supplyChainStore";
import HierarchicalTree from "./HierarchicalTree";
import FlowDiagram from "./FlowDiagram";
import RadialEcosystem from "./RadialEcosystem";
import RiskHeatmapLens from "./RiskHeatmapLens";
import GwmdWorldMap from "./GwmdWorldMap";
import GlobalMapView from "./GlobalMapView";

export interface VisualizationSurfaceProps {
  data: MindMapData;
  viewMode: SupplyChainViewMode;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  simulation: {
    failedNodeIds: string[];
    failedEdgeIds: string[];
    impactScores?: Record<string, number>;
    impactRanges?: Record<string, { min: number; max: number }>;
    impactedEdgeIds?: string[];
    rankedImpacts?: Array<{ nodeId: string; score: number; minScore?: number; maxScore?: number }>;
    params?: { severity: number; damping: number; includeKinds?: SupplyChainGraphEdge["kind"][] };
  };
  strictMode: boolean;
  includeHypothesis: boolean;
  hops: number;
  minEdgeWeight: number;
  globalTickers: string[];
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
}

const surfaceStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  position: "relative",
  background: "radial-gradient(circle at top, rgba(59,130,246,0.12), rgba(10,14,26,0.95))",
  border: "1px solid rgba(148,163,184,0.15)",
  borderRadius: 16,
  overflow: "hidden",
  overscrollBehavior: "contain",
};

const fullscreenSurfaceStyle: React.CSSProperties = {
  width: "100vw",
  height: "100vh",
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: "radial-gradient(circle at center, rgba(15,23,42,0.98), rgba(10,14,26,1))",
  border: "none",
  borderRadius: 0,
  overflow: "hidden",
  overscrollBehavior: "contain",
  zIndex: 999999,
};

function normalizedEdgeWeight(edge: SupplyChainGraphEdge) {
  const base = edge.weightRange
    ? (edge.weightRange.min + edge.weightRange.max) / 2
    : typeof edge.weight === "number"
    ? edge.weight
    : edge.criticality ?? 1;
  if (base <= 1) return Math.max(0, Math.min(1, base));
  return Math.max(0, Math.min(1, Math.log1p(base) / 6));
}

function resolveFocalNodeIds(graph: SupplyChainGraph, tickers: string[], center: string) {
  const ids = new Set<string>();
  const candidates = tickers.length ? tickers : [center];
  candidates.forEach((ticker) => {
    const node = graph.nodes.find((n) => n.id === ticker || n.tickers?.includes(ticker));
    if (node) ids.add(node.id);
  });
  const first = graph.nodes[0];
  if (!ids.size && first) ids.add(first.id);
  return Array.from(ids);
}

function filterByHops(graph: SupplyChainGraph, focalNodeIds: string[], hops: number) {
  if (hops <= 0) return graph;
  const adjacency = new Map<string, Set<string>>();
  graph.nodes.forEach((node) => adjacency.set(node.id, new Set()));
  graph.edges.forEach((edge) => {
    adjacency.get(edge.from)?.add(edge.to);
    adjacency.get(edge.to)?.add(edge.from);
  });
  const visited = new Set<string>(focalNodeIds);
  let frontier = new Set<string>(focalNodeIds);
  for (let depth = 0; depth < hops; depth += 1) {
    const next = new Set<string>();
    frontier.forEach((nodeId) => {
      adjacency.get(nodeId)?.forEach((neighbor) => {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          next.add(neighbor);
        }
      });
    });
    frontier = next;
  }
  const nodes = graph.nodes.filter((node) => visited.has(node.id));
  const nodeSet = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter((edge) => nodeSet.has(edge.from) && nodeSet.has(edge.to));
  return { nodes, edges };
}

export default function VisualizationSurface(props: VisualizationSurfaceProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const canonical = ensureCanonicalStructures(props.data);
  const baseGraph: SupplyChainGraph = canonical.graph!;
  const riskLens = canonical.riskLens ?? [];
  const filteredEdges = baseGraph.edges.filter((edge) => {
    const isHypothesis = edge.evidenceStatus === "hypothesis";
    if (props.strictMode) {
      if (edge.evidenceStatus !== "verified_official" && !(props.includeHypothesis && isHypothesis)) {
        return false;
      }
    } else if (!props.includeHypothesis && isHypothesis) {
      return false;
    }
    const weight = normalizedEdgeWeight(edge);
    return weight >= props.minEdgeWeight;
  });
  const nodeIds = new Set<string>();
  filteredEdges.forEach((edge) => {
    nodeIds.add(edge.from);
    nodeIds.add(edge.to);
  });
  const focalNodeIds = resolveFocalNodeIds(baseGraph, props.globalTickers, canonical.centerNodeId ?? canonical.centerTicker);
  focalNodeIds.forEach((id) => nodeIds.add(id));
  const graph = filterByHops({
    nodes: baseGraph.nodes.filter((node) => nodeIds.has(node.id)),
    edges: filteredEdges,
  }, focalNodeIds, props.hops);

  const selectedNode: SupplyChainGraphNode | null = graph.nodes.find((n) => n.id === props.selectedNodeId) ?? null;
  const selectedEdge: SupplyChainGraphEdge | null = graph.edges.find((e) => e.id === props.selectedEdgeId) ?? null;
  const focalNodeId = focalNodeIds[0] ?? canonical.centerNodeId ?? canonical.centerTicker;
  const isEmpty = props.viewMode !== "global" && graph.edges.length === 0;
  const emptyMessage = props.strictMode
    ? "Official sources do not disclose more links yet"
    : "No relationships available for this view";

  // Handle ESC key to exit fullscreen
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isFullscreen) {
        setIsFullscreen(false);
      }
    };

    if (isFullscreen) {
      window.addEventListener("keydown", handleKeyPress);
      return () => window.removeEventListener("keydown", handleKeyPress);
    }
  }, [isFullscreen]);

  const visualizationContent = (
    <>
      {props.viewMode === "hierarchy" && (
        <HierarchicalTree
          graph={graph}
          focusNodeId={selectedNode?.id ?? canonical.centerNodeId ?? canonical.centerTicker}
          simulation={props.simulation}
          onSelectNode={props.onSelectNode}
          onSelectEdge={props.onSelectEdge}
        />
      )}
      {props.viewMode === "flow" && (
        <FlowDiagram
          graph={graph}
          focalNodeId={focalNodeId}
          selectedNodeId={selectedNode?.id ?? null}
          simulation={props.simulation}
          selectedEdgeId={selectedEdge?.id ?? null}
          onSelectEdge={props.onSelectEdge}
          onSelectNode={props.onSelectNode}
        />
      )}
      {props.viewMode === "impact" && (
        <GlobalMapView
          graph={graph}
          focalNodeId={focalNodeId}
          selectedNodeId={selectedNode?.id ?? null}
          selectedEdgeId={selectedEdge?.id ?? null}
          simulation={props.simulation}
          onSelectNode={(nodeId) => props.onSelectNode(nodeId)}
          onSelectEdge={(edgeId) => props.onSelectEdge(edgeId)}
        />
      )}
      {props.viewMode === "radial" && (
        <RadialEcosystem
          graph={graph}
          selectedNodeId={selectedNode?.id ?? null}
          focalNodeId={focalNodeId}
          simulation={props.simulation}
          onSelectNode={props.onSelectNode}
        />
      )}
      {props.viewMode === "shock" && (
        <TopPathsView
          graph={graph}
          baseGraph={baseGraph}
          focalNodeId={focalNodeId}
          selectedNodeId={selectedNode?.id ?? null}
        />
      )}
      {props.viewMode === "global" && (
        <GwmdWorldMap
          graph={graph}
          selectedNodeId={selectedNode?.id ?? null}
          selectedEdgeId={selectedEdge?.id ?? null}
          simulation={props.simulation}
          filters={props.gwmdFilters}
          onFiltersChange={props.onGwmdFiltersChange}
          onSelectNode={props.onSelectNode}
          onSelectEdge={props.onSelectEdge}
        />
      )}
      {props.viewMode === "risk" && (
        <RiskHeatmapLens
          riskLens={riskLens}
          onSelectCell={(affected: string[]) => props.onSelectRisk(affected)}
        />
      )}
    </>
  );

  if (isFullscreen) {
    return (
      <div style={fullscreenSurfaceStyle}>
        {/* Fullscreen Controls Overlay */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            padding: "20px 24px",
            background: "rgba(10,14,26,0.6)",
            zIndex: 1000000,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          {/* Company Info */}
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#e5e7eb" }}>
              {props.data.centerName}
            </div>
            <div
              style={{
                fontSize: 12,
                padding: "4px 12px",
                background: "rgba(59,130,246,0.2)",
                border: "1px solid rgba(59,130,246,0.4)",
                borderRadius: 999,
                color: "#60a5fa",
              }}
            >
              {props.viewMode === "hierarchy" && "Hierarchy View"}
              {props.viewMode === "flow" && "Value Flow"}
              {props.viewMode === "impact" && "Impact Map"}
              {props.viewMode === "radial" && "Radial Ecosystem"}
              {props.viewMode === "global" && "GWMD"}
              {props.viewMode === "risk" && "Risk Matrix"}
              {props.viewMode === "shock" && "Top Paths"}
            </div>
          </div>

          {/* Exit Button */}
          <button
            onClick={() => setIsFullscreen(false)}
            style={{
              padding: "10px 20px",
              background: "rgba(239,68,68,0.15)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: "8px",
              color: "#fca5a5",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.2s ease",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLButtonElement).style.background = "rgba(239,68,68,0.25)";
              (e.target as HTMLButtonElement).style.borderColor = "rgba(239,68,68,0.5)";
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLButtonElement).style.background = "rgba(239,68,68,0.15)";
              (e.target as HTMLButtonElement).style.borderColor = "rgba(239,68,68,0.3)";
            }}
          >
            <span style={{ fontSize: 16 }}>✕</span> Exit Fullscreen
          </button>
        </div>

        {/* Visualization Content */}
        <div style={{ width: "100%", height: "100%", position: "relative" }}>
          {isEmpty ? <EmptyState message={emptyMessage} /> : visualizationContent}
        </div>

        {/* Bottom Info Bar */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            padding: "16px 24px",
            background: "rgba(10,14,26,0.6)",
            zIndex: 1000000,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 12,
            color: "#94a3b8",
          }}
        >
          <div style={{ display: "flex", gap: 24 }}>
            <span>
              <strong style={{ color: "#e5e7eb" }}>{graph.nodes.length}</strong> companies
            </span>
            <span>
              <strong style={{ color: "#e5e7eb" }}>{graph.edges.length}</strong> connections
            </span>
            {props.simulation.failedNodeIds.length > 0 && (
              <span style={{ color: "#fca5a5" }}>
                <strong>{props.simulation.failedNodeIds.length}</strong> failures simulated
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, opacity: 0.7 }}>
            Press <kbd style={{ padding: "2px 6px", background: "rgba(148,163,184,0.2)", borderRadius: 4 }}>ESC</kbd> to exit • Click nodes to explore
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={surfaceStyle}>
      <button
        onClick={() => setIsFullscreen(true)}
        style={{
          position: "absolute",
          top: 12,
          right: 12,
          zIndex: 10,
          padding: "8px 12px",
          background: "rgba(59,130,246,0.2)",
          border: "1px solid rgba(96,165,250,0.35)",
          borderRadius: "8px",
          color: "#ffffff",
          fontSize: "12px",
          fontWeight: 600,
          cursor: "pointer",
          backdropFilter: "blur(8px)",
          transition: "all 0.2s ease",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
        title="Fullscreen"
      >
        ⤢ Fullscreen
      </button>
      {isEmpty ? <EmptyState message={emptyMessage} /> : visualizationContent}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#94a3b8",
        fontSize: 14,
        textAlign: "center",
        padding: 24,
      }}
    >
      {message}
    </div>
  );
}

function TopPathsView({
  graph,
  baseGraph,
  focalNodeId,
  selectedNodeId,
}: {
  graph: SupplyChainGraph;
  baseGraph: SupplyChainGraph;
  focalNodeId: string;
  selectedNodeId: string | null;
}) {
  const [retryCount, setRetryCount] = useState(0);
  const [retryPending, setRetryPending] = useState(false);
  const target = selectedNodeId && selectedNodeId !== focalNodeId ? selectedNodeId : focalNodeId;
  const retryKey = `${target}-${focalNodeId}-${graph.edges.length}-${baseGraph.edges.length}`;

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setRetryCount(0);
      setRetryPending(false);
    }, 0);
    return () => window.clearTimeout(handle);
  }, [retryKey]);

  const paths = useMemo(() => {
    const attempts = [
      { g: graph, depth: 4, width: 3 },
      { g: baseGraph, depth: 4, width: 3 },
      { g: baseGraph, depth: 5, width: 5 },
      { g: baseGraph, depth: 6, width: 6 },
    ];
    const attemptCount = Math.min(attempts.length, 1 + retryCount);
    for (const attempt of attempts.slice(0, attemptCount)) {
      const result = findTopDependencyPaths(attempt.g, target, focalNodeId, attempt.depth, attempt.width);
      if (result.length > 0) return result;
    }
    return [];
  }, [graph, baseGraph, target, focalNodeId, retryCount]);

  useEffect(() => {
    if (paths.length > 0) return;
    if (retryCount >= 3) return;
    if (retryPending) return;
    if (baseGraph.edges.length === 0 && graph.edges.length === 0) return;
    const pendingHandle = window.setTimeout(() => {
      setRetryPending(true);
    }, 0);
    const handle = window.setTimeout(() => {
      setRetryCount((count) => count + 1);
      setRetryPending(false);
    }, 600 + retryCount * 300);
    return () => {
      window.clearTimeout(pendingHandle);
      window.clearTimeout(handle);
    };
  }, [paths.length, baseGraph.edges.length, graph.edges.length, retryCount, retryPending]);

  return (
    <div style={{ width: "100%", height: "100%", padding: 24, overflow: "auto" }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0", marginBottom: 12 }}>
        Top Paths
      </div>
      {paths.length === 0 && (
        <div style={{ color: "#94a3b8", fontSize: 12 }}>
          {retryPending ? "Retrying path discovery..." : "No contributing paths available for this selection."}
        </div>
      )}
      {paths.map((path, idx) => (
        <div
          key={`path-${idx}`}
          style={{
            borderRadius: 12,
            border: "1px solid rgba(148,163,184,0.2)",
            padding: 14,
            marginBottom: 12,
            background: "rgba(15,23,42,0.7)",
          }}
        >
          <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 10 }}>
            Score {(path.score * 100).toFixed(0)}%
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            {path.steps.map((step, stepIdx) => {
              const edge = graph.edges.find((e) => e.id === step.edgeId) ?? baseGraph.edges.find((e) => e.id === step.edgeId);
              return (
                <div key={`${step.edgeId}-${stepIdx}`} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 600 }}>{step.from}</span>
                  <span
                    style={{
                      padding: "2px 6px",
                      borderRadius: 999,
                      background: "rgba(59,130,246,0.2)",
                      fontSize: 10,
                      color: "#bfdbfe",
                      textTransform: "uppercase",
                    }}
                  >
                    {edge?.kind ?? "link"}
                  </span>
                  <span style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 600 }}>{step.to}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}


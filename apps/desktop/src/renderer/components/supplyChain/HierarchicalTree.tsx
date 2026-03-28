import React, { useMemo, useState } from "react";
import type { SupplyChainGraph, SupplyChainGraphEdge, SupplyChainGraphNode } from "@tc/shared/supplyChain";
import { Transitions, RelationColors, StatusColors, BorderRadius, Spacing } from "./tokens";

interface Props {
  graph: SupplyChainGraph;
  focusNodeId: string;
  simulation: {
    failedNodeIds: string[];
    failedEdgeIds: string[];
    impactScores?: Record<string, number>;
    impactedEdgeIds?: string[];
  };
  onSelectNode: (nodeId: string) => void;
  onSelectEdge: (edgeId: string) => void;
}

const columnStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  gap: 12,
  padding: 12,
  position: "relative",
  minWidth: 0,
};

function nodeStatusColor(nodeId: string, simulation: Props["simulation"]): string {
  if (simulation.failedNodeIds.includes(nodeId)) return "rgba(239,68,68,0.18)";
  if ((simulation.impactScores?.[nodeId] ?? 0) > 0) return "rgba(249,115,22,0.12)";
  return "rgba(30,41,59,0.8)";
}

function edgeStatus(edge: SupplyChainGraphEdge, simulation: Props["simulation"]): string {
  if (simulation.failedEdgeIds.includes(edge.id)) return StatusColors.failed;
  if (simulation.impactedEdgeIds?.includes(edge.id)) return StatusColors.impacted;
  return RelationColors[edge.kind as keyof typeof RelationColors] || RelationColors.other;
}

export default function HierarchicalTree(props: Props) {
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  
  const focusNode = props.graph.nodes.find((n) => n.id === props.focusNodeId) ?? props.graph.nodes[0] ?? null;
  const { upstream, downstream } = useMemo(() => {
    if (!focusNode) {
      return { upstream: [], downstream: [] as Array<{ edge: SupplyChainGraphEdge; node: SupplyChainGraphNode }> };
    }
    const upstreamEdges = props.graph.edges.filter((edge) => edge.to === focusNode.id);
    const downstreamEdges = props.graph.edges.filter((edge) => edge.from === focusNode.id);
    return {
      upstream: upstreamEdges.map((edge) => ({ edge, node: props.graph.nodes.find((n) => n.id === edge.from) })).filter((item): item is { edge: SupplyChainGraphEdge; node: SupplyChainGraphNode } => Boolean(item.node)),
      downstream: downstreamEdges.map((edge) => ({ edge, node: props.graph.nodes.find((n) => n.id === edge.to) })).filter((item): item is { edge: SupplyChainGraphEdge; node: SupplyChainGraphNode } => Boolean(item.node)),
    };
  }, [props.graph.edges, props.graph.nodes, focusNode]);

  if (!focusNode) {
    return <div style={{ padding: 24, color: "#94a3b8" }}>No graph data available</div>;
  }

  return (
    <div style={{ display: "flex", gap: 16, height: "100%", position: "relative" }}>
      {/* SVG connection paths overlay */}
      <svg
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          zIndex: 10,
        }}
        viewBox={`0 0 ${typeof window !== 'undefined' ? window.innerWidth : 1920} ${typeof window !== 'undefined' ? window.innerHeight : 1080}`}
      >
        <defs>
          <linearGradient id="connection-gradient-up" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={RelationColors.supplier} stopOpacity="0.4" />
            <stop offset="100%" stopColor={RelationColors.supplier} stopOpacity="0.8" />
          </linearGradient>
          <linearGradient id="connection-gradient-down" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={RelationColors.customer} stopOpacity="0.8" />
            <stop offset="100%" stopColor={RelationColors.customer} stopOpacity="0.4" />
          </linearGradient>
          <filter id="connection-glow">
            <feGaussianBlur stdDeviation="2" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Animated connection lines (simplified: focus on stroke animation) */}
        <style>
          {`
            @keyframes connection-flow {
              0% { stroke-dashoffset: 0; }
              100% { stroke-dashoffset: -8px; }
            }
          `}
        </style>
      </svg>

      <div style={columnStyle}>
        <SectionTitle>Upstream Dependencies</SectionTitle>
        {upstream.length === 0 && <Placeholder>None linked</Placeholder>}
        {upstream.map(({ node, edge }) => (
          <NodeCard
            key={node.id}
            node={node}
            edge={edge}
            placement="upstream"
            simulation={props.simulation}
            isHovered={hoveredEdgeId === edge.id}
            onSelectNode={props.onSelectNode}
            onSelectEdge={props.onSelectEdge}
            onHoverEdge={setHoveredEdgeId}
          />
        ))}
      </div>

      <div style={{ ...columnStyle, maxWidth: 280, justifyContent: "center" }}>
        <SectionTitle>Focus</SectionTitle>
        <div
          style={{
            padding: 16,
            borderRadius: BorderRadius.lg,
            border: "1px solid rgba(148,163,184,0.25)",
            background: `linear-gradient(135deg, rgba(30,41,82,0.35) 0%, rgba(10,14,26,0.5) 100%)`,
            boxShadow: "0 10px 40px rgba(15,23,42,0.45)",
            cursor: "pointer",
            transition: Transitions.base,
          }}
          onClick={() => props.onSelectNode(focusNode.id)}
        >
          <div style={{ fontSize: 18, fontWeight: 600 }}>{focusNode.label}</div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 6 }}>{focusNode.role}</div>
          <div style={{ marginTop: 8, display: "flex", gap: 12, fontSize: 12 }}>
            <span>Criticality {focusNode.criticality ?? "-"}</span>
            <span>Confidence {(focusNode.confidence * 100).toFixed(0)}%</span>
          </div>
        </div>
      </div>

      <div style={columnStyle}>
        <SectionTitle>Downstream Impact</SectionTitle>
        {downstream.length === 0 && <Placeholder>None linked</Placeholder>}
        {downstream.map(({ node, edge }) => (
          <NodeCard
            key={node.id}
            node={node}
            edge={edge}
            placement="downstream"
            simulation={props.simulation}
            isHovered={hoveredEdgeId === edge.id}
            onSelectNode={props.onSelectNode}
            onSelectEdge={props.onSelectEdge}
            onHoverEdge={setHoveredEdgeId}
          />
        ))}
      </div>

      <div
        style={{
          position: "absolute",
          right: 12,
          bottom: 12,
          padding: "8px 12px",
          fontSize: 10,
          color: "#94a3b8",
          borderRadius: 999,
          background: "rgba(15,23,42,0.8)",
          backdropFilter: "blur(8px)",
        }}
      >
        Select a node to change the focal entity
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 1.2, color: "#64748b" }}>
      {children}
    </div>
  );
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: 12,
        borderRadius: 12,
        border: "1px dashed rgba(148,163,184,0.3)",
        color: "#475569",
        fontSize: 12,
      }}
    >
      {children}
    </div>
  );
}

interface NodeCardProps {
  node: SupplyChainGraphNode;
  edge: SupplyChainGraphEdge;
  placement: "upstream" | "downstream";
  simulation: Props["simulation"];
  isHovered: boolean;
  onSelectNode: (nodeId: string) => void;
  onSelectEdge: (edgeId: string) => void;
  onHoverEdge: (edgeId: string | null) => void;
}

function NodeCard({ node, edge, placement: _placement, simulation, isHovered, onSelectNode, onSelectEdge, onHoverEdge }: NodeCardProps) {
  const [isHoveringCard, setIsHoveringCard] = useState(false);
  
  const isImpacted = simulation.impactedEdgeIds?.includes(edge.id) ?? false;
  const isFailed = simulation.failedEdgeIds.includes(edge.id);
  
  return (
    <div
      style={{
        borderRadius: BorderRadius.md,
        padding: 12,
        border: `1px solid ${isHoveringCard || isHovered ? 'rgba(148,163,184,0.4)' : 'rgba(148,163,184,0.15)'}`,
        background: `linear-gradient(135deg, ${nodeStatusColor(node.id, simulation)} 0%, rgba(15,23,42,0.3) 100%)`,
        display: "flex",
        gap: 8,
        alignItems: "center",
        cursor: "pointer",
        transition: Transitions.base,
        transform: isHoveringCard ? "translateY(-2px)" : "translateY(0)",
        boxShadow: isHoveringCard ? "0 8px 24px rgba(15,23,42,0.4)" : "0 4px 12px rgba(15,23,42,0.2)",
        opacity: isHovered || isHoveringCard ? 1 : 0.95,
      }}
      onMouseEnter={() => {
        setIsHoveringCard(true);
        onHoverEdge(edge.id);
      }}
      onMouseLeave={() => {
        setIsHoveringCard(false);
        onHoverEdge(null);
      }}
    >
      <div
        style={{
          width: 32,
          height: 3,
          background: edgeStatus(edge, simulation),
          borderRadius: 999,
          transition: Transitions.base,
          boxShadow: (isImpacted || isFailed) ? `0 0 8px ${edgeStatus(edge, simulation)}` : 'none',
        }}
      />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{node.label}</div>
        <div style={{ fontSize: 11, color: "#94a3b8" }}>{node.role}</div>
        <div style={{ fontSize: 10, color: RelationColors[edge.kind as keyof typeof RelationColors] || RelationColors.other, marginTop: 6 }}>{edge.kind}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <button
          style={buttonStyle(false)}
          onClick={() => onSelectNode(node.id)}
        >
          Focus
        </button>
        <button
          style={buttonStyle(true)}
          onClick={() => onSelectEdge(edge.id)}
        >
          Edge
        </button>
      </div>
    </div>
  );
}

function buttonStyle(isEdge: boolean): React.CSSProperties {
  return {
    border: `1px solid ${isEdge ? 'rgba(59,130,246,0.3)' : 'rgba(148,163,184,0.3)'}`,
    background: "rgba(15,23,42,0.6)",
    color: "#e2e8f0",
    fontSize: 10,
    borderRadius: 999,
    padding: "4px 12px",
    cursor: "pointer",
    transition: Transitions.fast,
  };
}

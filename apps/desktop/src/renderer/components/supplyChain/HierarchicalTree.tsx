import React, { useMemo } from "react";
import type { SupplyChainGraph, SupplyChainGraphEdge, SupplyChainGraphNode } from "@tc/shared/supplyChain";

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
};

function nodeStatusColor(nodeId: string, simulation: Props["simulation"]): string {
  if (simulation.failedNodeIds.includes(nodeId)) return "rgba(239,68,68,0.35)";
  if ((simulation.impactScores?.[nodeId] ?? 0) > 0) return "rgba(249,115,22,0.18)";
  return "rgba(30,41,59,0.9)";
}

function edgeStatus(edge: SupplyChainGraphEdge, simulation: Props["simulation"]): string {
  if (simulation.failedEdgeIds.includes(edge.id)) return "rgba(239,68,68,0.8)";
  if (simulation.impactedEdgeIds?.includes(edge.id)) return "rgba(249,115,22,0.8)";
  return "rgba(59,130,246,0.35)";
}

export default function HierarchicalTree(props: Props) {
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
    <div style={{ display: "flex", gap: 16, height: "100%" }}>
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
            onSelectNode={props.onSelectNode}
            onSelectEdge={props.onSelectEdge}
          />
        ))}
      </div>
      <div style={{ ...columnStyle, maxWidth: 280 }}>
        <SectionTitle>Focus</SectionTitle>
        <div
          style={{
            padding: 16,
            borderRadius: 16,
            border: "1px solid rgba(148,163,184,0.3)",
            background: nodeStatusColor(focusNode.id, props.simulation),
            boxShadow: "0 10px 40px rgba(15,23,42,0.45)",
            cursor: "pointer",
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
            onSelectNode={props.onSelectNode}
            onSelectEdge={props.onSelectEdge}
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
  onSelectNode: (nodeId: string) => void;
  onSelectEdge: (edgeId: string) => void;
}

function NodeCard({ node, edge, placement: _placement, simulation, onSelectNode, onSelectEdge }: NodeCardProps) {
  return (
    <div
      style={{
        borderRadius: 16,
        padding: 12,
        border: "1px solid rgba(148,163,184,0.2)",
        background: nodeStatusColor(node.id, simulation),
        display: "flex",
        gap: 8,
        alignItems: "center",
      }}
    >
      <div style={{ width: 32, height: 2, background: edgeStatus(edge, simulation) }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{node.label}</div>
        <div style={{ fontSize: 11, color: "#94a3b8" }}>{node.role}</div>
        <div style={{ fontSize: 10, color: "#818cf8", marginTop: 6 }}>{edge.kind}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <button
          style={buttonStyle}
          onClick={() => onSelectNode(node.id)}
        >
          Focus
        </button>
        <button
          style={{ ...buttonStyle, borderColor: "rgba(59,130,246,0.4)" }}
          onClick={() => onSelectEdge(edge.id)}
        >
          Edge
        </button>
      </div>
    </div>
  );
}

const buttonStyle: React.CSSProperties = {
  border: "1px solid rgba(148,163,184,0.4)",
  background: "rgba(15,23,42,0.6)",
  color: "#e2e8f0",
  fontSize: 10,
  borderRadius: 999,
  padding: "4px 12px",
  cursor: "pointer",
};

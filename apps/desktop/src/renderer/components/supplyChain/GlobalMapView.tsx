import React, { useMemo } from "react";
import type { SupplyChainGraph } from "@tc/shared/supplyChain";

interface Props {
  graph: SupplyChainGraph;
  focalNodeId: string;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  simulation: {
    failedNodeIds: string[];
    failedEdgeIds: string[];
    impactScores?: Record<string, number>;
    impactedEdgeIds?: string[];
  };
  onSelectNode: (nodeId: string) => void;
  onSelectEdge: (edgeId: string) => void;
}

const BASE_WIDTH = 1400;
const BASE_HEIGHT = 900;
const RING_TIERS = ["direct", "indirect", "systemic"] as const;

const RING_RADIUS = {
  focal: 70,
  direct: 210,
  indirect: 320,
  systemic: 430,
} as const;

export default function GlobalMapView({
  graph,
  focalNodeId,
  selectedNodeId,
  selectedEdgeId,
  simulation,
  onSelectNode,
  onSelectEdge,
}: Props) {
  const layout = useMemo(() => {
    const center = graph.nodes.find((n) => n.id === focalNodeId) ?? graph.nodes[0] ?? null;
    if (!center) return null;

    const positions: Record<string, { x: number; y: number; tier: string; label: string }> = {};
    positions[center.id] = {
      x: BASE_WIDTH / 2,
      y: BASE_HEIGHT / 2,
      tier: "focal",
      label: center.label,
    };

    const forward = new Map<string, Set<string>>();
    const reverse = new Map<string, Set<string>>();
    graph.nodes.forEach((node) => {
      forward.set(node.id, new Set());
      reverse.set(node.id, new Set());
    });
    graph.edges.forEach((edge) => {
      forward.get(edge.from)?.add(edge.to);
      reverse.get(edge.to)?.add(edge.from);
    });

    const bfs = (adj: Map<string, Set<string>>) => {
      const dist = new Map<string, number>();
      const queue: string[] = [center.id];
      dist.set(center.id, 0);
      while (queue.length) {
        const current = queue.shift() as string;
        const depth = dist.get(current) ?? 0;
        if (depth >= 3) continue;
        adj.get(current)?.forEach((neighbor) => {
          if (!dist.has(neighbor)) {
            dist.set(neighbor, depth + 1);
            queue.push(neighbor);
          }
        });
      }
      return dist;
    };

    const upstreamDist = bfs(reverse);
    const downstreamDist = bfs(forward);

    const groupByTier = (dist: Map<string, number>) => {
      const byTier = {
        direct: [] as typeof graph.nodes,
        indirect: [] as typeof graph.nodes,
        systemic: [] as typeof graph.nodes,
      };
      dist.forEach((depth, nodeId) => {
        if (nodeId === center.id) return;
        const node = graph.nodes.find((n) => n.id === nodeId);
        if (!node) return;
        if (depth === 1) byTier.direct.push(node);
        if (depth === 2) byTier.indirect.push(node);
        if (depth >= 3) byTier.systemic.push(node);
      });
      return byTier;
    };

    const upstream = groupByTier(upstreamDist);
    const downstream = groupByTier(downstreamDist);

    const placed = new Set<string>([center.id]);
    const placeArc = (nodes: typeof graph.nodes, radius: number, startAngle: number, endAngle: number, tierLabel: string) => {
      if (nodes.length === 0) return;
      const slice = (endAngle - startAngle) / Math.max(1, nodes.length);
      nodes.forEach((node, idx) => {
        if (placed.has(node.id)) return;
        const angle = startAngle + slice * idx;
        positions[node.id] = {
          x: BASE_WIDTH / 2 + radius * Math.cos(angle),
          y: BASE_HEIGHT / 2 + radius * Math.sin(angle),
          tier: tierLabel,
          label: node.label,
        };
        placed.add(node.id);
      });
    };

    const leftStart = (120 * Math.PI) / 180;
    const leftEnd = (240 * Math.PI) / 180;
    const rightStart = (-60 * Math.PI) / 180;
    const rightEnd = (60 * Math.PI) / 180;

    placeArc(upstream.direct, RING_RADIUS.direct, leftStart, leftEnd, "direct");
    placeArc(upstream.indirect, RING_RADIUS.indirect, leftStart, leftEnd, "indirect");
    placeArc(upstream.systemic, RING_RADIUS.systemic, leftStart, leftEnd, "systemic");

    placeArc(downstream.direct, RING_RADIUS.direct, rightStart, rightEnd, "direct");
    placeArc(downstream.indirect, RING_RADIUS.indirect, rightStart, rightEnd, "indirect");
    placeArc(downstream.systemic, RING_RADIUS.systemic, rightStart, rightEnd, "systemic");

    const remaining = graph.nodes.filter((n) => !placed.has(n.id));
    placeArc(remaining, RING_RADIUS.systemic + 80, (250 * Math.PI) / 180, (470 * Math.PI) / 180, "other");

    return { center, positions };
  }, [graph, focalNodeId]);

  if (!layout) {
    return <div style={{ padding: 24, color: "#94a3b8" }}>No graph data available</div>;
  }

  const { positions, center } = layout;

  return (
    <svg viewBox={`0 0 ${BASE_WIDTH} ${BASE_HEIGHT}`} style={{ width: "100%", height: "100%" }}>
      <defs>
        <radialGradient id="global-map-bg" cx="50%" cy="50%" r="70%">
          <stop offset="0%" stopColor="rgba(59,130,246,0.15)" />
          <stop offset="100%" stopColor="rgba(10,14,26,0.95)" />
        </radialGradient>
      </defs>
      <rect width={BASE_WIDTH} height={BASE_HEIGHT} fill="url(#global-map-bg)" />

      {RING_TIERS.map((tier) => (
        <circle
          key={tier}
          cx={BASE_WIDTH / 2}
          cy={BASE_HEIGHT / 2}
          r={RING_RADIUS[tier]}
          fill="none"
          stroke="rgba(148,163,184,0.2)"
          strokeDasharray="6 10"
        />
      ))}

      {graph.edges.map((edge) => {
        const from = positions[edge.from];
        const to = positions[edge.to];
        if (!from || !to) return null;
        const failed = simulation.failedEdgeIds.includes(edge.id);
        const impacted = simulation.impactedEdgeIds?.includes(edge.id);
        const selected = selectedEdgeId === edge.id;
        return (
          <line
            key={edge.id}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke={failed ? "#ef4444" : impacted ? "#f97316" : "rgba(59,130,246,0.6)"}
            strokeWidth={selected ? 3 : 1.5}
            opacity={selectedEdgeId && !selected ? 0.3 : 0.8}
            onClick={() => onSelectEdge(edge.id)}
            style={{ cursor: "pointer" }}
          />
        );
      })}

      {Object.entries(positions).map(([nodeId, pos]) => {
        const failed = simulation.failedNodeIds.includes(nodeId);
        const impactScore = simulation.impactScores?.[nodeId] ?? 0;
        const isCenter = nodeId === center.id;
        const isSelected = selectedNodeId === nodeId;
        const radius = isCenter ? 44 : 26;
        return (
          <g key={nodeId} onClick={() => onSelectNode(nodeId)} style={{ cursor: "pointer" }}>
            <circle
              cx={pos.x}
              cy={pos.y}
              r={radius}
              fill={failed ? "rgba(239,68,68,0.6)" : impactScore > 0 ? "rgba(249,115,22,0.35)" : "rgba(15,23,42,0.9)"}
              stroke={isSelected ? "#f9a8d4" : isCenter ? "#60a5fa" : "rgba(94,234,212,0.5)"}
              strokeWidth={isSelected ? 3 : 2}
            />
            <text
              x={pos.x}
              y={pos.y}
              textAnchor="middle"
              fontSize={isCenter ? 12 : 10}
              fill="#e2e8f0"
              style={{ pointerEvents: "none", fontWeight: isCenter ? 700 : 500 }}
            >
              {pos.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

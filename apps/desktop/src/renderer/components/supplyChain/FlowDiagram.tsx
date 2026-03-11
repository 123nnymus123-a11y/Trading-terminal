import React, { useMemo, useRef, useState, useEffect } from "react";
import type { SupplyChainGraph, SupplyChainGraphEdge } from "@tc/shared/supplyChain";

interface Props {
  graph: SupplyChainGraph;
  focalNodeId: string;
  selectedNodeId: string | null;
  simulation: {
    failedNodeIds: string[];
    failedEdgeIds: string[];
    impactScores?: Record<string, number>;
    impactedEdgeIds?: string[];
  };
  selectedEdgeId: string | null;
  onSelectEdge: (edgeId: string) => void;
  onSelectNode: (nodeId: string) => void;
}

interface PositionedNode {
  id: string;
  label: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  criticality: number;
  connectionCount: number;
}

const BASE_WIDTH = 1400;
const BASE_HEIGHT = 900;

const RELATION_COLORS: Record<string, string> = {
  supplier: "#22c55e",
  customer: "#38bdf8",
  partner: "#a855f7",
  license: "#f59e0b",
  financing: "#f97316",
  competitor: "#ef4444",
  other: "#64748b",
};

function relationColor(kind: string) {
  return RELATION_COLORS[kind] ?? "#64748b";
}

function normalizedWeight(edge: SupplyChainGraphEdge) {
  const base = edge.weightRange
    ? (edge.weightRange.min + edge.weightRange.max) / 2
    : typeof edge.weight === "number"
    ? edge.weight
    : edge.criticality ?? 1;
  if (base <= 1) return Math.max(0.1, base);
  return Math.max(0.1, Math.min(1, Math.log1p(base) / 6));
}

export default function FlowDiagram(props: Props) {
  const { graph, focalNodeId, selectedNodeId, simulation, selectedEdgeId, onSelectEdge, onSelectNode } = props;
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const panRef = useRef(pan);
  const zoomRef = useRef(zoom);
  const panRafRef = useRef<number | null>(null);
  const zoomRafRef = useRef<number | null>(null);
  const pendingPanRef = useRef<{ x: number; y: number } | null>(null);
  const pendingZoomRef = useRef<number | null>(null);

  useEffect(() => {
    panRef.current = pan;
  }, [pan]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  const schedulePan = (next: { x: number; y: number }) => {
    pendingPanRef.current = next;
    if (panRafRef.current !== null) return;
    panRafRef.current = window.requestAnimationFrame(() => {
      if (pendingPanRef.current) {
        setPan(pendingPanRef.current);
      }
      pendingPanRef.current = null;
      panRafRef.current = null;
    });
  };

  const scheduleZoom = (next: number) => {
    pendingZoomRef.current = next;
    if (zoomRafRef.current !== null) return;
    zoomRafRef.current = window.requestAnimationFrame(() => {
      if (pendingZoomRef.current !== null) {
        setZoom(pendingZoomRef.current);
      }
      pendingZoomRef.current = null;
      zoomRafRef.current = null;
    });
  };

  const center = useMemo(
    () => graph.nodes.find((node) => node.id === focalNodeId) ?? graph.nodes[0] ?? null,
    [graph, focalNodeId]
  );

  const { nodes, edges, neighbors } = useMemo(() => {
    if (!center) {
      return { nodes: {}, edges: [] as typeof graph.edges, neighbors: new Set<string>() };
    }

    const adjacency = new Map<string, Set<string>>();
    graph.nodes.forEach((node) => adjacency.set(node.id, new Set()));
    graph.edges.forEach((edge) => {
      adjacency.get(edge.from)?.add(edge.to);
      adjacency.get(edge.to)?.add(edge.from);
    });

    const distances = new Map<string, number>();
    const queue: string[] = [center.id];
    distances.set(center.id, 0);
    while (queue.length) {
      const current = queue.shift() as string;
      const depth = distances.get(current) ?? 0;
      adjacency.get(current)?.forEach((neighbor) => {
        if (!distances.has(neighbor)) {
          distances.set(neighbor, depth + 1);
          queue.push(neighbor);
        }
      });
    }

    const tierBuckets = new Map<number, SupplyChainGraph["nodes"]>();
    graph.nodes.forEach((node) => {
      const tier = Math.min(3, distances.get(node.id) ?? 3);
      const bucket = tierBuckets.get(tier) ?? [];
      bucket.push(node);
      tierBuckets.set(tier, bucket);
    });

    const positioned: Record<string, PositionedNode> = {};
    const ringBase = [0, 190, 330, 470];
    const centerX = BASE_WIDTH / 2;
    const centerY = BASE_HEIGHT / 2;

    const computeSize = (label: string, name: string) => {
      const baseWidth = Math.max(120, Math.min(200, label.length * 10 + name.length * 4));
      return { width: baseWidth, height: 46 };
    };

    const hashString = (value: string) => {
      let hash = 7;
      for (let i = 0; i < value.length; i += 1) {
        hash = (hash * 31 + value.charCodeAt(i)) % 100000;
      }
      return hash;
    };

    tierBuckets.forEach((bucket, tier) => {
      const base = ringBase[tier] ?? 470;
      const densityBoost = Math.max(0, bucket.length - 8) * 8;
      const radius = base + densityBoost;
      const slice = (2 * Math.PI) / Math.max(1, bucket.length);
      const sorted = [...bucket].sort(
        (a, b) => (adjacency.get(b.id)?.size ?? 0) - (adjacency.get(a.id)?.size ?? 0)
      );
      sorted.forEach((node, idx) => {
        const jitter = ((hashString(node.id) % 1000) / 1000 - 0.5) * Math.min(0.45, 2 / Math.max(6, bucket.length));
        const angle = slice * idx - Math.PI / 2 + jitter;
        const name = node.canonicalName ?? node.label;
        const size = computeSize(node.label, name);
        const radialJitter = ((hashString(node.id + "r") % 9) - 4) * 6;
        positioned[node.id] = {
          id: node.id,
          label: node.label,
          name,
          x: tier === 0 ? centerX : centerX + (radius + radialJitter) * Math.cos(angle),
          y: tier === 0 ? centerY : centerY + (radius + radialJitter) * Math.sin(angle),
          width: size.width,
          height: size.height,
          criticality: node.criticality ?? 1,
          connectionCount: adjacency.get(node.id)?.size ?? 0,
        };
      });
    });

    const neighborSet = new Set<string>();
    if (selectedNodeId) {
      adjacency.get(selectedNodeId)?.forEach((n) => neighborSet.add(n));
    }

    return {
      nodes: positioned,
      edges: graph.edges.filter((edge) => positioned[edge.from] && positioned[edge.to]),
      neighbors: neighborSet,
    };
  }, [graph, center, selectedNodeId]);

  if (!center) {
    return <div style={{ padding: 24, color: "#94a3b8" }}>No graph data available</div>;
  }

  const viewWidth = BASE_WIDTH / zoom;
  const viewHeight = BASE_HEIGHT / zoom;
  const viewX = (BASE_WIDTH - viewWidth) / 2 + pan.x;
  const viewY = (BASE_HEIGHT - viewHeight) / 2 + pan.y;

  const nodeCount = Object.keys(nodes).length;
  const showEdges = zoom >= 0.85 || nodeCount <= 80;
  const showLabels = zoom >= 0.95 && nodeCount <= 140;
  const showNames = zoom >= 1.15 && nodeCount <= 90;

  return (
    <svg
      viewBox={`${viewX} ${viewY} ${viewWidth} ${viewHeight}`}
      style={{
        width: "100%",
        height: "100%",
        cursor: isDragging ? "grabbing" : "grab",
        userSelect: "none",
        touchAction: "none",
      }}
      onMouseDown={(e) => {
        e.preventDefault();
        dragRef.current = { x: e.clientX, y: e.clientY };
        setIsDragging(true);
      }}
      onMouseMove={(e) => {
        if (!dragRef.current) return;
        const dx = (e.clientX - dragRef.current.x) / zoom;
        const dy = (e.clientY - dragRef.current.y) / zoom;
        schedulePan({ x: panRef.current.x - dx, y: panRef.current.y - dy });
        dragRef.current = { x: e.clientX, y: e.clientY };
      }}
      onMouseUp={() => {
        dragRef.current = null;
        setIsDragging(false);
      }}
      onMouseLeave={() => {
        dragRef.current = null;
        setIsDragging(false);
      }}
      onWheel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const delta = e.deltaY > 0 ? -0.08 : 0.08;
        const next = Math.min(2.6, Math.max(0.65, zoomRef.current + delta));
        scheduleZoom(next);
      }}
    >
      <defs>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(148,163,184,0.08)" strokeWidth="1" />
        </pattern>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        {Object.entries(RELATION_COLORS).map(([key, color]) => (
          <marker
            key={key}
            id={`arrow-${key}`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
          </marker>
        ))}
      </defs>

      <rect width={BASE_WIDTH} height={BASE_HEIGHT} fill="url(#grid)" />
      <rect width={BASE_WIDTH} height={BASE_HEIGHT} fill="rgba(10,14,26,0.25)" />

      {showEdges && edges.map((edge) => {
        const from = nodes[edge.from];
        const to = nodes[edge.to];
        if (!from || !to) return null;
        const weight = normalizedWeight(edge);
        const strokeWidth = Math.max(1.5, Math.min(6, weight * 6));
        const color = relationColor(edge.kind);
        const failed = simulation.failedEdgeIds.includes(edge.id);
        const impacted = simulation.impactedEdgeIds?.includes(edge.id);
        const isHypothesis = edge.evidenceStatus === "hypothesis";
        const connectedToSelection = selectedNodeId
          ? edge.from === selectedNodeId || edge.to === selectedNodeId
          : true;
        const selected = selectedEdgeId === edge.id;
        const opacityBase = edge.confidence ?? 0.6;
        const opacity = selected ? 0.95 : connectedToSelection ? opacityBase : 0.15;
        const stroke = failed ? "#ef4444" : impacted ? "#f97316" : color;
        return (
          <g key={edge.id} onClick={() => onSelectEdge(edge.id)} style={{ cursor: "pointer" }}>
            <path
              d={`M ${from.x} ${from.y} C ${(from.x + to.x) / 2} ${from.y - 30}, ${(from.x + to.x) / 2} ${to.y + 30}, ${to.x} ${to.y}`}
              stroke={stroke}
              strokeWidth={selected ? strokeWidth + 1 : strokeWidth}
              fill="transparent"
              opacity={selectedEdgeId && !selected ? 0.2 : opacity}
              markerEnd={`url(#arrow-${RELATION_COLORS[edge.kind] ? edge.kind : "other"})`}
              strokeDasharray={isHypothesis ? "6 6" : "0"}
            />
          </g>
        );
      })}

      {Object.values(nodes).map((node) => {
        const failed = simulation.failedNodeIds.includes(node.id);
        const impactScore = simulation.impactScores?.[node.id] ?? 0;
        const isCenter = node.id === center.id;
        const isSelected = node.id === selectedNodeId;
        const dimmed = selectedNodeId && node.id !== selectedNodeId && !neighbors.has(node.id);
        const x = node.x - node.width / 2;
        const y = node.y - node.height / 2;
        return (
          <g key={node.id} onClick={() => onSelectNode(node.id)} style={{ cursor: "pointer" }} opacity={dimmed ? 0.2 : 1}>
            <rect
              x={x}
              y={y}
              width={node.width}
              height={node.height}
              rx={16}
              fill={failed ? "rgba(239,68,68,0.45)" : impactScore > 0 ? "rgba(249,115,22,0.35)" : "rgba(15,23,42,0.9)"}
              stroke={isSelected ? "#f9a8d4" : isCenter ? "#60a5fa" : "rgba(94,234,212,0.4)"}
              strokeWidth={isSelected ? 2.5 : 1.5}
              filter={isSelected ? "url(#glow)" : "none"}
            />
            {showLabels && (
              <text
                x={node.x}
                y={node.y - 4}
                textAnchor="middle"
                fontSize={12}
                fill="#e2e8f0"
                style={{ pointerEvents: "none", fontWeight: 700 }}
              >
                {node.label}
              </text>
            )}
            {showNames && (
              <text
                x={node.x}
                y={node.y + 12}
                textAnchor="middle"
                fontSize={9}
                fill="#94a3b8"
                style={{ pointerEvents: "none" }}
              >
                {node.name}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

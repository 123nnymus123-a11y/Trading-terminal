import React, { useMemo, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Node,
  Edge,
  Connection,
  addEdge,
  useNodesState,
  useEdgesState,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { SupplyChainGraph, SupplyChainGraphEdge } from '@tc/shared/supplyChain';
import { SupplyChainNode } from './nodes/SupplyChainNode';
import { getRelationColor, Backgrounds } from './tokens';

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

const BASE_WIDTH = 1400;
const BASE_HEIGHT = 900;

function normalizedWeight(edge: SupplyChainGraphEdge) {
  const base = edge.weightRange
    ? (edge.weightRange.min + edge.weightRange.max) / 2
    : typeof edge.weight === 'number'
    ? edge.weight
    : edge.criticality ?? 1;
  if (base <= 1) return Math.max(0.1, base);
  return Math.max(0.1, Math.min(1, Math.log1p(base) / 6));
}

/**
 * Convert graph data to React Flow nodes and edges
 */
function buildFlowData(
  graph: SupplyChainGraph,
  focalNodeId: string,
  selectedNodeId?: string | null
) {
  const center = graph.nodes.find((n) => n.id === focalNodeId) ?? graph.nodes[0];
  if (!center) return { nodes: [], edges: [] };

  // Build adjacency
  const adjacency = new Map<string, Set<string>>();
  graph.nodes.forEach((node) => adjacency.set(node.id, new Set()));
  graph.edges.forEach((edge) => {
    adjacency.get(edge.from)?.add(edge.to);
    adjacency.get(edge.to)?.add(edge.from);
  });

  // BFS to compute distances
  const distances = new Map<string, number>();
  const queue: string[] = [center.id];
  distances.set(center.id, 0);
  while (queue.length) {
    const current = queue.shift()!;
    const depth = distances.get(current) ?? 0;
    adjacency.get(current)?.forEach((neighbor) => {
      if (!distances.has(neighbor)) {
        distances.set(neighbor, depth + 1);
        queue.push(neighbor);
      }
    });
  }

  // Group nodes into tier buckets
  const tierBuckets = new Map<number, typeof graph.nodes>();
  graph.nodes.forEach((node) => {
    const tier = Math.min(3, distances.get(node.id) ?? 3);
    const bucket = tierBuckets.get(tier) ?? [];
    bucket.push(node);
    tierBuckets.set(tier, bucket);
  });

  // Compute positions using radial ring layout
  const positions = new Map<string, { x: number; y: number }>();
  const ringBase = [0, 190, 330, 470];
  const centerX = 0;
  const centerY = 0;

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
      const jitter =
        ((hashString(node.id) % 1000) / 1000 - 0.5) * Math.min(0.45, 2 / Math.max(6, bucket.length));
      const angle = slice * idx - Math.PI / 2 + jitter;
      const radialJitter = ((hashString(node.id + 'r') % 9) - 4) * 6;

      positions.set(node.id, {
        x: tier === 0 ? centerX : centerX + (radius + radialJitter) * Math.cos(angle),
        y: tier === 0 ? centerY : centerY + (radius + radialJitter) * Math.sin(angle),
      });
    });
  });

  // Build React Flow nodes
  const nodes: Node[] = graph.nodes.map((node) => {
    const pos = positions.get(node.id) ?? { x: 0, y: 0 };
    const tier = Math.min(3, distances.get(node.id) ?? 3);

    return {
      id: node.id,
      position: pos,
      data: {
        id: node.id,
        label: node.label,
        entityType: node.entityType,
        tier: ['focal', 'direct', 'indirect', 'systemic'][tier] as any,
        confidence: node.confidence ?? 0.7,
        criticality: node.criticality ?? 1,
        isSelected: node.id === selectedNodeId,
      },
      type: 'supplyChainNode',
    };
  });

  // Build React Flow edges
  const rfEdges: Edge[] = graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    animated: false,
    data: {
      kind: edge.kind,
      weight: edge.weight,
      criticality: edge.criticality,
      confidence: edge.confidence,
    },
  }));

  return { nodes, edges: rfEdges };
}

export default function FlowDiagram(props: Props) {
  const { graph, focalNodeId, selectedNodeId, simulation, onSelectNode, onSelectEdge } = props;

  // Build flow data
  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => buildFlowData(graph, focalNodeId, selectedNodeId),
    [graph, focalNodeId, selectedNodeId]
  );

  // React Flow hooks
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Custom node types
  const nodeTypes = useMemo(
    () => ({
      supplyChainNode: (props: NodeProps) => (
        <SupplyChainNode data={props.data} selected={props.selected} />
      ),
    }),
    []
  );

  // Handle node click
  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      onSelectNode(node.id);
    },
    [onSelectNode]
  );

  // Handle edge click
  const onEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      onSelectEdge(edge.id);
    },
    [onSelectEdge]
  );

  if (!graph.nodes.length) {
    return (
      <div style={{ padding: 24, color: '#94a3b8' }}>No graph data available</div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <style>
        {`
          .rf-nodes {
            background: linear-gradient(135deg, #0a0e1a 0%, #0f1320 100%);
          }
          .react-flow {
            background: linear-gradient(135deg, #0a0e1a 0%, #0f1320 100%);
          }
        `}
      </style>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.5}
        maxZoom={3}
      >
        <Background color="#64748b" gap={40} size={1} style={{ opacity: 0.1 }} />
        <Controls position="top-right" showInteractive={true} />
        <MiniMap
          position="bottom-left"
          nodeColor={(node) => {
            const data = node.data as any;
            return data?.color || '#3b82f6';
          }}
          style={{
            backgroundColor: 'rgba(10, 14, 26, 0.7)',
            border: '1px solid rgba(148, 163, 184, 0.2)',
            borderRadius: '8px',
          }}
        />
      </ReactFlow>
    </div>
  );
}

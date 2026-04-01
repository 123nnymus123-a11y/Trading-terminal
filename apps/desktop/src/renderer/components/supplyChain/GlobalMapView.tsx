import React, { useMemo, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Node,
  Edge,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { SupplyChainGraph } from '@tc/shared/supplyChain';
import { SupplyChainNode, type SupplyChainNodeData } from './nodes/SupplyChainNode';
import { getRelationColor } from './tokens';

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

const RING_RADIUS = {
  focal: 70,
  direct: 210,
  indirect: 320,
  systemic: 430,
} as const;

/**
 * Build ring-based layout for React Flow
 */
function buildRingLayout(
  graph: SupplyChainGraph,
  focalNodeId: string,
  selectedNodeId: string | null,
  selectedEdgeId: string | null,
  simulation: Props['simulation']
) {
  const center = graph.nodes.find((n) => n.id === focalNodeId) ?? graph.nodes[0];
  if (!center) return { nodes: [], edges: [] };
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const failedNodeIds = new Set(simulation.failedNodeIds);
  const impactedNodeIds = new Set(
    Object.entries(simulation.impactScores ?? {})
      .filter(([, score]) => typeof score === 'number' && score > 0)
      .map(([nodeId]) => nodeId)
  );
  const failedEdgeIds = new Set(simulation.failedEdgeIds);

  const positions: Record<string, { x: number; y: number }> = {};
  positions[center.id] = { x: 0, y: 0 };

  // Build adjacency
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

  // BFS to compute distances
  const bfs = (adj: Map<string, Set<string>>) => {
    const dist = new Map<string, number>();
    const queue: string[] = [center.id];
    let queueIndex = 0;
    dist.set(center.id, 0);
    while (queueIndex < queue.length) {
      const current = queue[queueIndex++];
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
      const node = nodeById.get(nodeId);
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
  const placeArc = (
    nodes: typeof graph.nodes,
    radius: number,
    startAngle: number,
    endAngle: number
  ) => {
    if (nodes.length === 0) return;
    const slice = (endAngle - startAngle) / Math.max(1, nodes.length);
    nodes.forEach((node, idx) => {
      if (placed.has(node.id)) return;
      const angle = startAngle + slice * idx;
      positions[node.id] = {
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
      };
      placed.add(node.id);
    });
  };

  const leftStart = (120 * Math.PI) / 180;
  const leftEnd = (240 * Math.PI) / 180;
  const rightStart = (-60 * Math.PI) / 180;
  const rightEnd = (60 * Math.PI) / 180;

  placeArc(upstream.direct, RING_RADIUS.direct, leftStart, leftEnd);
  placeArc(upstream.indirect, RING_RADIUS.indirect, leftStart, leftEnd);
  placeArc(upstream.systemic, RING_RADIUS.systemic, leftStart, leftEnd);

  placeArc(downstream.direct, RING_RADIUS.direct, rightStart, rightEnd);
  placeArc(downstream.indirect, RING_RADIUS.indirect, rightStart, rightEnd);
  placeArc(downstream.systemic, RING_RADIUS.systemic, rightStart, rightEnd);

  const remaining = graph.nodes.filter((n) => !placed.has(n.id));
  placeArc(remaining, RING_RADIUS.systemic + 80, (250 * Math.PI) / 180, (470 * Math.PI) / 180);

  // Convert to React Flow nodes
  const nodes: Node[] = graph.nodes.map((node) => ({
    id: node.id,
    position: positions[node.id] ?? { x: 0, y: 0 },
    data: {
      id: node.id,
      label: node.label,
      entityType: node.entityType,
      confidence: node.confidence ?? 0.7,
      criticality: node.criticality ?? 1,
      status: failedNodeIds.has(node.id)
        ? 'failed'
        : impactedNodeIds.has(node.id)
        ? 'impacted'
        : 'normal',
      isSelected: node.id === selectedNodeId,
    },
    type: 'supplyChainNode',
  }));

  const edges: Edge[] = graph.edges.map((edge) => {
    const isSelected = edge.id === selectedEdgeId;
    const isRelatedToSelection = edge.from === selectedNodeId || edge.to === selectedNodeId;
    return {
      id: edge.id,
      source: edge.from,
      target: edge.to,
      data: {
        kind: edge.kind,
        weight: edge.weight,
        confidence: edge.confidence,
      },
      style: {
        stroke: failedEdgeIds.has(edge.id) ? '#ef4444' : getRelationColor(edge.kind),
        strokeOpacity: isSelected ? 1 : isRelatedToSelection ? 0.85 : 0.5,
        strokeWidth: isSelected ? 3 : 1.4,
      },
      zIndex: isSelected ? 2 : 1,
    };
  });

  return { nodes, edges };
}

export default function GlobalMapView(props: Props) {
  const { graph, focalNodeId, selectedNodeId, selectedEdgeId, simulation, onSelectNode, onSelectEdge } = props;

  const { nodes, edges } = useMemo(
    () => buildRingLayout(graph, focalNodeId, selectedNodeId, selectedEdgeId, simulation),
    [graph, focalNodeId, selectedEdgeId, selectedNodeId, simulation]
  );

  const nodeTypes = useMemo(
    () => ({
      supplyChainNode: (nodeProps: NodeProps) => (
        <SupplyChainNode data={nodeProps.data as SupplyChainNodeData} selected={nodeProps.selected} />
      ),
    }),
    []
  );

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      onSelectNode(node.id);
    },
    [onSelectNode]
  );

  const onEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      onSelectEdge(edge.id);
    },
    [onSelectEdge]
  );

  if (!graph.nodes.length) {
    return <div style={{ padding: 24, color: '#94a3b8' }}>No graph data available</div>;
  }

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <style>
        {`
          .react-flow {
            background: linear-gradient(135deg, #0a0e1a 0%, #0f1320 100%);
          }
        `}
      </style>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.18, duration: 0 }}
        minZoom={0.3}
        maxZoom={4}
        nodesDraggable={false}
        nodesConnectable={false}
        onlyRenderVisibleElements
        elevateEdgesOnSelect={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#64748b" gap={40} size={1} style={{ opacity: 0.1 }} />
        <Controls position="top-right" showInteractive={true} />
        <MiniMap
          position="bottom-left"
          nodeColor={(node) => '#3b82f6'}
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

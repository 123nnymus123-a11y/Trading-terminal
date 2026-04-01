import React, { useMemo, useState } from 'react';
import type { SupplyChainGraph } from '@tc/shared/supplyChain';
import { Transitions, getEntityColor } from './tokens';

interface Props {
  graph: SupplyChainGraph;
  selectedNodeId: string | null;
  focalNodeId: string;
  simulation: {
    failedNodeIds: string[];
    failedEdgeIds: string[];
    impactScores?: Record<string, number>;
  };
  onSelectNode: (nodeId: string) => void;
}

const RADII: Record<string, number> = {
  focal: 64,
  direct: 140,
  indirect: 210,
  systemic: 280,
};

interface ImpactMetrics {
  [nodeId: string]: {
    incomingConnections: number;
    outgoingConnections: number;
    totalImpact: number;
    criticalityScore: number;
  };
}

export default function RadialEcosystem({
  graph,
  selectedNodeId,
  focalNodeId,
  simulation,
  onSelectNode,
}: Props) {
  const { grouped, impactMetrics } = useMemo(() => {
    // Calculate impact metrics
    const metrics: ImpactMetrics = {};

    // Initialize all nodes
    graph.nodes.forEach((node) => {
      metrics[node.id] = {
        incomingConnections: 0,
        outgoingConnections: 0,
        totalImpact: 0,
        criticalityScore: 0,
      };
    });

    // Count connections and calculate criticality
    graph.edges.forEach((edge) => {
      const fromMetrics = metrics[edge.from];
      const toMetrics = metrics[edge.to];
      if (fromMetrics) fromMetrics.outgoingConnections += 1;
      if (toMetrics) toMetrics.incomingConnections += 1;

      // Higher weight = higher impact
      const weight =
        typeof edge.weight === 'number' ? edge.weight : edge.criticality ?? 1;
      if (toMetrics) toMetrics.totalImpact += weight;
    });

    // Normalize criticality scores (0-1)
    const maxImpact = Math.max(
      ...Object.values(metrics).map((m) => m.totalImpact),
      1
    );
    Object.values(metrics).forEach((metric) => {
      metric.criticalityScore = metric.totalImpact / maxImpact;
    });

    return {
      grouped: {
        direct: graph.nodes.filter(
          (node) => node.tier === 'direct' && node.id !== focalNodeId
        ),
        indirect: graph.nodes.filter(
          (node) => node.tier === 'indirect' && node.id !== focalNodeId
        ),
        systemic: graph.nodes.filter(
          (node) => node.tier === 'systemic' && node.id !== focalNodeId
        ),
      },
      impactMetrics: metrics,
    };
  }, [graph.nodes, graph.edges, focalNodeId]);

  const center = graph.nodes.find((node) => node.id === focalNodeId) ?? graph.nodes[0];
  if (!center) {
    return (
      <div style={{ padding: 24, color: '#94a3b8' }}>
        No graph data available
      </div>
    );
  }

  return (
    <svg
      viewBox="0 0 800 800"
      style={{
        width: '100%',
        height: '100%',
        willChange: 'transform',
      }}
    >
      <defs>
        <radialGradient id="radial-bg" cx="50%" cy="50%" r="70%">
          <stop offset="0%" stopColor="rgba(14,165,233,0.25)" />
          <stop offset="100%" stopColor="rgba(15,23,42,0.95)" />
        </radialGradient>

        {/* Enhanced glow filters */}
        <filter id="glow-soft">
          <feGaussianBlur stdDeviation="3" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        <filter id="glow-intense">
          <feGaussianBlur stdDeviation="5" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <rect width="800" height="800" fill="url(#radial-bg)" />

      {(['direct', 'indirect', 'systemic'] as const).map((tier) => (
        <circle
          key={tier}
          cx={400}
          cy={400}
          r={RADII[tier]}
          fill="none"
          stroke="rgba(148,163,184,0.15)"
          strokeDasharray="6 10"
          strokeWidth="1"
        />
      ))}

      <Node
        id={center.id}
        label={center.label}
        x={400}
        y={400}
        radius={RADII.focal ?? 64}
        isSelected={selectedNodeId === center.id}
        failed={simulation.failedNodeIds.includes(center.id)}
        onSelect={onSelectNode}
        criticalityScore={impactMetrics[center.id]?.criticalityScore ?? 0}
        incomingConnections={
          impactMetrics[center.id]?.incomingConnections ?? 0
        }
        impactScore={simulation.impactScores?.[center.id] ?? 0}
        entityType={center.entityType}
      />

      <TierNodes
        nodes={grouped.direct}
        radius={RADII.direct ?? 140}
        selectedNodeId={selectedNodeId}
        failedNodes={simulation.failedNodeIds}
        onSelect={onSelectNode}
        impactMetrics={impactMetrics}
        impactScores={simulation.impactScores ?? {}}
      />
      <TierNodes
        nodes={grouped.indirect}
        radius={RADII.indirect ?? 210}
        selectedNodeId={selectedNodeId}
        failedNodes={simulation.failedNodeIds}
        onSelect={onSelectNode}
        impactMetrics={impactMetrics}
        impactScores={simulation.impactScores ?? {}}
      />
      <TierNodes
        nodes={grouped.systemic}
        radius={RADII.systemic ?? 280}
        selectedNodeId={selectedNodeId}
        failedNodes={simulation.failedNodeIds}
        onSelect={onSelectNode}
        impactMetrics={impactMetrics}
        impactScores={simulation.impactScores ?? {}}
      />
    </svg>
  );
}

interface TierProps {
  nodes: SupplyChainGraph['nodes'];
  radius: number;
  selectedNodeId: string | null;
  failedNodes: string[];
  onSelect: (nodeId: string) => void;
  impactMetrics: ImpactMetrics;
  impactScores: Record<string, number>;
}

function TierNodes({
  nodes,
  radius,
  selectedNodeId,
  failedNodes,
  onSelect,
  impactMetrics,
  impactScores,
}: TierProps) {
  if (nodes.length === 0) return null;
  const slice = (2 * Math.PI) / nodes.length;

  return (
    <>
      {nodes.map((node, idx) => {
        const angle = slice * idx - Math.PI / 2;
        const x = 400 + radius * Math.cos(angle);
        const y = 400 + radius * Math.sin(angle);
        const nodeMetrics = impactMetrics[node.id];
        return (
          <Node
            key={node.id}
            id={node.id}
            label={node.label}
            x={x}
            y={y}
            radius={32}
            isSelected={selectedNodeId === node.id}
            failed={failedNodes.includes(node.id)}
            onSelect={onSelect}
            criticalityScore={nodeMetrics?.criticalityScore ?? 0}
            incomingConnections={nodeMetrics?.incomingConnections ?? 0}
            impactScore={impactScores?.[node.id] ?? 0}
            entityType={node.entityType}
          />
        );
      })}
    </>
  );
}

interface NodeProps {
  id: string;
  label: string;
  x: number;
  y: number;
  radius: number;
  failed: boolean;
  isSelected: boolean;
  onSelect: (nodeId: string) => void;
  criticalityScore: number;
  incomingConnections: number;
  impactScore: number;
  entityType?: string;
}

function Node({
  id,
  label,
  x,
  y,
  radius,
  failed,
  isSelected,
  onSelect,
  criticalityScore,
  incomingConnections,
  impactScore,
  entityType,
}: NodeProps) {
  const entityColor = getEntityColor(entityType);
  
  const fill = failed
    ? 'rgba(239,68,68,0.5)'
    : impactScore > 0
    ? 'rgba(249,115,22,0.35)'
    : isSelected
    ? 'rgba(244,114,182,0.35)'
    : 'rgba(15,23,42,0.75)';
  
  const stroke = failed
    ? '#ef4444'
    : impactScore > 0
    ? '#fb923c'
    : isSelected
    ? '#f9a8d4'
    : entityColor;

  // Impact ring intensity based on criticality (0-1)
  const impactIntensity = criticalityScore;
  const impactStrokeWidth = 2 + impactIntensity * 4; // 2-6px based on criticality
  const impactOpacity = 0.3 + impactIntensity * 0.5; // 0.3-0.8 opacity

  return (
    <g
      onClick={() => onSelect(id)}
      style={{
        cursor: 'pointer',
        transition: Transitions.fast,
      }}
      opacity={isSelected ? 1 : 0.9}
    >
      {/* Impact ring - shows criticality */}
      {impactIntensity > 0.15 && (
        <circle
          cx={x}
          cy={y}
          r={radius + 8}
          fill="none"
          stroke={failed ? '#ef4444' : '#fbbf24'}
          strokeWidth={impactStrokeWidth}
          opacity={impactOpacity}
          filter={impactIntensity > 0.5 ? 'url(#glow-soft)' : 'none'}
        />
      )}

      {/* Main node circle */}
      <circle
        cx={x}
        cy={y}
        r={radius}
        fill={fill}
        stroke={stroke}
        strokeWidth={isSelected ? 3.5 : 2.5}
        filter={isSelected ? 'url(#glow-intense)' : 'url(#glow-soft)'}
      />

      {/* Company label */}
      <text
        x={x}
        y={y - 2}
        textAnchor="middle"
        fontSize={10}
        fill="#e2e8f0"
        fontWeight="600"
        style={{ pointerEvents: 'none' }}
      >
        {label}
      </text>

      {/* Tooltip info */}
      <title>{`Impact: ${(criticalityScore * 100).toFixed(0)}% | Dependencies: ${incomingConnections}`}</title>

      {/* Impact indicator - small text below */}
      {impactIntensity > 0.2 && (
        <text
          x={x}
          y={y + 10}
          textAnchor="middle"
          fontSize={8}
          fill="#fbbf24"
          opacity={0.8}
          style={{ pointerEvents: 'none' }}
        >
          {incomingConnections > 0 ? `●${incomingConnections}` : ''}
        </text>
      )}
    </g>
  );
}

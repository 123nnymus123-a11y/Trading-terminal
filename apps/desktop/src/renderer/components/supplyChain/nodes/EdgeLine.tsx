/**
 * Premium Edge Line Component
 * Animated supply chain edge with gradient stroke, direction arrows, and flow indicators
 */

import React, { useMemo } from 'react';
import {
  EdgeProps,
  getBezierPath,
  MarkerType,
} from '@xyflow/react';
import {
  RelationColors,
  EdgeStyles,
  Transitions,
  getStrokeWidth,
  getRelationColor,
} from '../tokens';

interface EdgeLineProps extends EdgeProps {
  animated?: boolean;
  data?: {
    kind?: string;
    weight?: number;
    criticality?: number;
    confidence?: number;
  };
}

export const EdgeLine: React.FC<EdgeLineProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  animated = false,
  markerEnd,
}) => {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  // Determine colors and weights
  const relationKind = data?.kind || 'other';
  const weight = data?.weight || 1;
  const confidence = data?.confidence ?? 0.7;
  const strokeWidth = getStrokeWidth(weight);
  const baseColor = getRelationColor(relationKind);

  // Create gradient for the edge
  const gradientId = `edge-gradient-${id}`;
  const sourceColor = baseColor;
  const targetColor = baseColor;
  const markerId = `edge-arrow-${id}`;

  // Opacity based on confidence
  const strokeOpacity = Math.max(0.3, confidence);

  const edgeStyle: React.CSSProperties = {
    strokeWidth,
    stroke: `url(#${gradientId})`,
    fill: 'none',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    opacity: strokeOpacity,
    transition: Transitions.base,
  };

  const animationStyle = animated
    ? {
        animation: 'flow-dash 20s linear infinite',
        strokeDasharray: '5,5',
      }
    : {};

  return (
    <>
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={sourceColor} />
          <stop offset="100%" stopColor={targetColor} />
        </linearGradient>
        {markerEnd && (
          <marker
            id={markerId}
            markerWidth="10"
            markerHeight="10"
            refX="8"
            refY="5"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={baseColor} />
          </marker>
        )}
        <style>{`
          @keyframes flow-dash {
            to { stroke-dashoffset: -10; }
          }
          #edge-${id} {
            transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);
          }
        `}</style>
      </defs>

      {/* Main edge stroke */}
      <path
        id={`edge-${id}`}
        d={edgePath}
        markerEnd={markerEnd ? `url(#${markerId})` : undefined}
        style={{
          ...edgeStyle,
          ...animationStyle,
        }}
      />

      {/* Optional: Glow effect for emphasized edges */}
      {confidence > 0.8 && (
        <path
          d={edgePath}
          markerEnd={markerEnd ? `url(#${markerId})` : undefined}
          style={{
            ...edgeStyle,
            strokeWidth: strokeWidth * 3,
            opacity: 0.15,
            filter: 'blur(2px)',
          }}
        />
      )}
    </>
  );
};

export default EdgeLine;

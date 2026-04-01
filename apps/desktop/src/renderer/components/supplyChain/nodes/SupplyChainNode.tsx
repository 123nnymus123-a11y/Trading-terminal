/**
 * Premium Supply Chain Node Component
 * Glassmorphism card with animated status indicators, confidence bars, and refined styling
 */

import React, { memo } from 'react';
import {
  RelationColors,
  Backgrounds,
  Borders,
  NodeDimensions,
  NodeStyles,
  Spacing,
  BorderRadius,
  Transitions,
  getConfidenceOpacity,
  getStatusColor,
  getEntityColor,
} from '../tokens';

export interface SupplyChainNodeData {
  id: string;
  label: string;
  entityType?: 'company' | 'facility' | 'infrastructure' | 'region';
  status?: 'normal' | 'impacted' | 'failed';
  confidence?: number;
  criticality?: 1 | 2 | 3 | 4 | 5;
  tier?: 'focal' | 'direct' | 'indirect' | 'systemic';
  relationKind?: string;
  isSelected?: boolean;
  isHovered?: boolean;
}

interface SupplyChainNodeProps {
  data: SupplyChainNodeData;
  isConnectable?: boolean;
  selected?: boolean;
}

/**
 * Entity type icon generator (inline SVG)
 */
const EntityIcon: React.FC<{ type?: string; color?: string; size?: number }> = ({
  type = 'company',
  color = '#3b82f6',
  size = 48,
}) => {
  const iconProps = {
    width: size,
    height: size,
    viewBox: '0 0 64 64',
    shapeRendering: 'geometricPrecision' as const,
  };

  switch (type) {
    case 'facility':
      return (
        <svg {...iconProps} fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="8" y="16" width="48" height="40" rx="6" fill={color} fillOpacity="0.18" />
          <rect x="8" y="16" width="48" height="40" rx="6" stroke={color} strokeWidth="2" fill="none" />
          <rect x="16" y="24" width="8" height="12" fill={color} fillOpacity="0.82" />
          <rect x="28" y="24" width="8" height="12" fill={color} fillOpacity="0.82" />
          <rect x="40" y="24" width="8" height="12" fill={color} fillOpacity="0.82" />
        </svg>
      );

    case 'infrastructure':
      return (
        <svg {...iconProps} fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M32 8L52 20V44L32 56L12 44V20L32 8Z" fill={color} fillOpacity="0.16" />
          <path d="M32 8L52 20V44L32 56L12 44V20L32 8Z" stroke={color} strokeWidth="2" fill="none" />
          <circle cx="32" cy="32" r="6" fill={color} fillOpacity="0.82" />
        </svg>
      );

    case 'region':
      return (
        <svg {...iconProps} fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M32 8C19.27 8 9 18.27 9 31C9 43.73 32 56 32 56C32 56 55 43.73 55 31C55 18.27 44.73 8 32 8Z"
            fill={color}
            fillOpacity="0.16"
          />
          <path
            d="M32 8C19.27 8 9 18.27 9 31C9 43.73 32 56 32 56C32 56 55 43.73 55 31C55 18.27 44.73 8 32 8Z"
            stroke={color}
            strokeWidth="2"
            fill="none"
          />
          <circle cx="32" cy="28" r="4" fill={color} fillOpacity="0.82" />
        </svg>
      );

    case 'company':
    default:
      return (
        <svg {...iconProps} fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="32" cy="32" r="24" fill={color} fillOpacity="0.16" />
          <circle cx="32" cy="32" r="24" stroke={color} strokeWidth="2" fill="none" />
          <rect x="24" y="24" width="16" height="16" fill={color} fillOpacity="0.82" rx="2" />
        </svg>
      );
  }
};

/**
 * Criticality dots indicator (1-5 dots)
 */
const CriticalityDots: React.FC<{ level?: number }> = ({ level = 1 }) => {
  const maxDots = 5;
  const dotCount = Math.min(Math.max(level || 1, 1), maxDots);

  return (
    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
      {Array.from({ length: dotCount }).map((_, i) => (
        <div
          key={i}
          style={{
            width: '5px',
            height: '5px',
            borderRadius: '50%',
            backgroundColor: level && level >= 4 ? '#ef4444' : level && level >= 3 ? '#f97316' : '#38bdf8',
          }}
        />
      ))}
    </div>
  );
};

/**
 * Confidence bar indicator
 */
const ConfidenceBar: React.FC<{ confidence?: number }> = ({ confidence = 0.5 }) => {
  const safeConfidence = Math.max(0, Math.min(1, confidence || 0));
  const barColor = safeConfidence >= 0.8 ? '#22c55e' : safeConfidence >= 0.5 ? '#f59e0b' : '#ef4444';

  return (
    <div
      style={{
        width: '100%',
        height: '4px',
        backgroundColor: 'rgba(100, 116, 139, 0.2)',
        borderRadius: BorderRadius.full,
        overflow: 'hidden',
        marginTop: Spacing.sm,
      }}
    >
      <div
        style={{
          height: '100%',
          width: `${safeConfidence * 100}%`,
          backgroundColor: barColor,
          borderRadius: BorderRadius.full,
          transition: Transitions.base,
        }}
      />
    </div>
  );
};

/**
 * Status ring indicator
 */
const StatusRing: React.FC<{ status?: string }> = ({ status = 'normal' }) => {
  const statusColor = getStatusColor(status);
  return <div
    style={{
    position: 'absolute',
    top: '-6px',
    right: '-6px',
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    backgroundColor: statusColor,
    border: `2px solid ${Backgrounds.darkCard}`,
    boxShadow: `0 0 0 1px ${statusColor}55`,
    transition: Transitions.base,
  }}
  />;
};

/**
 * Main SupplyChainNode Component
 */
export const SupplyChainNode: React.FC<SupplyChainNodeProps> = memo(({ data, selected }) => {
  const entityColor = getEntityColor(data.entityType);
  const confidence = data.confidence ?? 0.7;

  const containerStyle: React.CSSProperties = {
    position: 'relative',
    width: NodeDimensions.width,
    height: NodeDimensions.height,
    backgroundColor: 'rgba(15, 23, 42, 0.94)',
    borderRadius: NodeStyles.borderRadiusNode,
    border: selected ? `1px solid ${entityColor}88` : Borders.light,
    padding: NodeStyles.paddingNode,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    alignItems: 'center',
    cursor: 'pointer',
    opacity: Math.max(0.88, getConfidenceOpacity(confidence)),
    transition: Transitions.base,
    boxShadow: selected
      ? `0 0 0 1px ${entityColor}55, 0 12px 24px rgba(2, 6, 23, 0.5)`
      : `0 8px 18px rgba(2, 6, 23, 0.32)`,
    borderLeftWidth: '3px',
    borderLeftColor: data.relationKind ? RelationColors[data.relationKind as keyof typeof RelationColors] || entityColor : entityColor,
    overflow: 'hidden',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: '12px',
    fontWeight: '600',
    color: Backgrounds.textPrimary,
    textAlign: 'center',
    marginTop: Spacing.xs,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '100%',
    transition: Transitions.fast,
  };

  const topSectionStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    width: '100%',
    position: 'relative',
  };

  return (
    <div style={containerStyle}>
      {/* Status Ring (top-right) */}
      <StatusRing status={data.status} />

      {/* Top Section: Icon + Criticality */}
      <div style={topSectionStyle}>
        <EntityIcon type={data.entityType} color={entityColor} size={40} />
        <div style={{ position: 'absolute', right: 0, top: 0 }}>
          <CriticalityDots level={data.criticality} />
        </div>
      </div>

      {/* Label */}
      <div style={labelStyle}>{data.label}</div>

      {/* Confidence Bar */}
      <ConfidenceBar confidence={confidence} />
    </div>
  );
});

SupplyChainNode.displayName = 'SupplyChainNode';

export default SupplyChainNode;

/**
 * Premium Supply Chain Node Component
 * Glassmorphism card with animated status indicators, confidence bars, and refined styling
 */

import React, { useMemo } from 'react';
import {
  RelationColors,
  EntityTypeColors,
  StatusColors,
  Backgrounds,
  Borders,
  Shadows,
  NodeDimensions,
  NodeStyles,
  Spacing,
  BorderRadius,
  Transitions,
  getPulseAnimation,
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
  };

  switch (type) {
    case 'facility':
      return (
        <svg {...iconProps} fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="facility-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={color} />
              <stop offset="100%" stopColor={color} stopOpacity="0.6" />
            </linearGradient>
          </defs>
          <rect x="8" y="16" width="48" height="40" rx="6" fill="url(#facility-grad)" />
          <rect x="8" y="16" width="48" height="40" rx="6" stroke={color} strokeWidth="2" fill="none" />
          <rect x="16" y="24" width="8" height="12" fill={color} opacity="0.8" />
          <rect x="28" y="24" width="8" height="12" fill={color} opacity="0.8" />
          <rect x="40" y="24" width="8" height="12" fill={color} opacity="0.8" />
        </svg>
      );

    case 'infrastructure':
      return (
        <svg {...iconProps} fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="infra-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={color} />
              <stop offset="100%" stopColor={color} stopOpacity="0.6" />
            </linearGradient>
          </defs>
          <path d="M32 8L52 20V44L32 56L12 44V20L32 8Z" fill="url(#infra-grad)" />
          <path d="M32 8L52 20V44L32 56L12 44V20L32 8Z" stroke={color} strokeWidth="2" fill="none" />
          <circle cx="32" cy="32" r="6" fill={color} opacity="0.8" />
        </svg>
      );

    case 'region':
      return (
        <svg {...iconProps} fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="region-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={color} />
              <stop offset="100%" stopColor={color} stopOpacity="0.6" />
            </linearGradient>
          </defs>
          <path
            d="M32 8C19.27 8 9 18.27 9 31C9 43.73 32 56 32 56C32 56 55 43.73 55 31C55 18.27 44.73 8 32 8Z"
            fill="url(#region-grad)"
          />
          <path
            d="M32 8C19.27 8 9 18.27 9 31C9 43.73 32 56 32 56C32 56 55 43.73 55 31C55 18.27 44.73 8 32 8Z"
            stroke={color}
            strokeWidth="2"
            fill="none"
          />
          <circle cx="32" cy="28" r="4" fill={color} opacity="0.8" />
        </svg>
      );

    case 'company':
    default:
      return (
        <svg {...iconProps} fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="company-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={color} />
              <stop offset="100%" stopColor={color} stopOpacity="0.6" />
            </linearGradient>
          </defs>
          <circle cx="32" cy="32" r="24" fill="url(#company-grad)" />
          <circle cx="32" cy="32" r="24" stroke={color} strokeWidth="2" fill="none" />
          <rect x="24" y="24" width="16" height="16" fill={color} opacity="0.8" rx="2" />
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
 * Status ring indicator with animation
 */
const StatusRing: React.FC<{ status?: string }> = ({ status = 'normal' }) => {
  const statusColor = getStatusColor(status);
  const isAnimated = status === 'impacted' || status === 'failed';

  const ringStyle: React.CSSProperties = {
    position: 'absolute',
    top: '-6px',
    right: '-6px',
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    backgroundColor: statusColor,
    border: `2px solid ${Backgrounds.darkCard}`,
    boxShadow: isAnimated ? `0 0 12px ${statusColor}` : `0 0 8px ${statusColor}CC`,
    transition: Transitions.base,
  };

  if (isAnimated) {
    return (
      <style>
        {`
          @keyframes pulse-ring {
            0%, 100% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.15); opacity: 0.7; }
          }
        `}
        <div
          style={{
            ...ringStyle,
            animation: 'pulse-ring 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
          }}
        />
      </style>
    );
  }

  return <div style={ringStyle} />;
};

/**
 * Main SupplyChainNode Component
 */
export const SupplyChainNode: React.FC<SupplyChainNodeProps> = ({ data, selected }) => {
  const entityColor = getEntityColor(data.entityType);
  const statusColor = getStatusColor(data.status);
  const confidence = data.confidence ?? 0.7;

  const containerStyle: React.CSSProperties = {
    position: 'relative',
    width: NodeDimensions.width,
    height: NodeDimensions.height,
    backgroundColor: Backgrounds.glassLight,
    backdropFilter: NodeStyles.backdropBlur,
    borderRadius: NodeStyles.borderRadiusNode,
    border: Borders.light,
    padding: NodeStyles.paddingNode,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    alignItems: 'center',
    cursor: 'pointer',
    opacity: getConfidenceOpacity(confidence),
    transition: Transitions.base,
    boxShadow: selected
      ? `0 0 40px ${entityColor}66, ${Shadows.lg}`
      : `inset 0 1px 0 rgba(255, 255, 255, 0.1), ${Shadows.md}`,
    borderLeftWidth: '3px',
    borderLeftColor: data.relationKind ? RelationColors[data.relationKind as keyof typeof RelationColors] || entityColor : entityColor,
    transform: selected ? 'scale(1.08)' : 'scale(1)',
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
};

export default SupplyChainNode;

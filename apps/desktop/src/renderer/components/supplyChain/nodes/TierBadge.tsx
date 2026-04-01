/**
 * Tier Badge Component
 * Visual indicator for supply chain relationship tier (Direct, Indirect, Systemic, Focal)
 */

import React from 'react';
import {
  TierColors,
  Backgrounds,
  BorderRadius,
  Spacing,
  Transitions,
} from '../tokens';

export type TierType = 'focal' | 'direct' | 'indirect' | 'systemic';

export const tierLabels: Record<TierType, string> = {
  focal: 'Focal',
  direct: 'Direct',
  indirect: 'Indirect',
  systemic: 'Systemic',
};

export const tierDescriptions: Record<TierType, string> = {
  focal: 'Core focal company',
  direct: 'Direct suppliers/customers',
  indirect: 'Indirect relationships',
  systemic: 'Market-level impact',
};

interface TierBadgeProps {
  tier?: TierType;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  variant?: 'filled' | 'outline' | 'ghost';
  className?: string;
}

export const TierBadge: React.FC<TierBadgeProps> = ({
  tier = 'direct',
  size = 'md',
  showLabel = true,
  variant = 'filled',
}) => {
  const tierColor = TierColors[tier];

  const sizeMap = {
    sm: {
      padding: `${Spacing.xs} ${Spacing.sm}`,
      fontSize: '11px',
      height: '20px',
    },
    md: {
      padding: `${Spacing.sm} ${Spacing.md}`,
      fontSize: '12px',
      height: '28px',
    },
    lg: {
      padding: `${Spacing.md} ${Spacing.lg}`,
      fontSize: '13px',
      height: '36px',
    },
  };

  const variantStyles = {
    filled: {
      backgroundColor: tierColor,
      color: Backgrounds.darkBase,
      border: 'none',
      boxShadow: `0 0 16px ${tierColor}40`,
    },
    outline: {
      backgroundColor: 'transparent',
      color: tierColor,
      border: `1.5px solid ${tierColor}`,
      boxShadow: 'none',
    },
    ghost: {
      backgroundColor: `${tierColor}15`,
      color: tierColor,
      border: 'none',
      boxShadow: 'none',
    },
  };

  const badgeStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    ...sizeMap[size],
    borderRadius: BorderRadius.full,
    fontWeight: '600',
    whiteSpace: 'nowrap',
    cursor: 'default',
    transition: Transitions.fast,
    ...variantStyles[variant],
  };

  return (
    <div style={badgeStyle} title={tierDescriptions[tier]}>
      {showLabel && tierLabels[tier]}
    </div>
  );
};

export default TierBadge;

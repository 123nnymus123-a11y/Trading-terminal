/**
 * Supply Chain Tab Design Tokens
 * Centralized color, shadow, spacing, and styling system for all supply chain visualizations
 */

// ============================================================================
// RELATION KIND COLORS (dependency types)
// ============================================================================
export const RelationColors = {
  supplier: "#22c55e", // green-500
  customer: "#38bdf8", // sky-400
  partner: "#a855f7", // purple-500
  license: "#f59e0b", // amber-500
  financing: "#f97316", // orange-500
  competitor: "#ef4444", // red-500
  other: "#64748b", // slate-500
  default: "#64748b", // slate-500
} as const;

export type RelationKind = keyof typeof RelationColors;

export const getRelationColor = (kind?: string): string => {
  if (!kind) return RelationColors.default;
  return RelationColors[kind as RelationKind] ?? RelationColors.default;
};

// ============================================================================
// ENTITY TYPE COLORS
// ============================================================================
export const EntityTypeColors = {
  company: "#3b82f6", // blue-500
  facility: "#8b5cf6", // violet-500
  infrastructure: "#ec4899", // pink-500
  region: "#06b6d4", // cyan-500
} as const;

export type EntityType = keyof typeof EntityTypeColors;

export const getEntityColor = (type?: string): string => {
  if (!type) return EntityTypeColors.company;
  return EntityTypeColors[type as EntityType] ?? EntityTypeColors.company;
};

// ============================================================================
// STATUS COLORS (node state indicators)
// ============================================================================
export const StatusColors = {
  normal: "#38bdf8", // sky-400 (light blue)
  impacted: "#f97316", // orange-500
  failed: "#ef4444", // red-500
} as const;

export type StatusType = keyof typeof StatusColors;

export const getStatusColor = (status?: string): string => {
  if (!status || status === "normal") return StatusColors.normal;
  return StatusColors[status as StatusType] ?? StatusColors.normal;
};

// ============================================================================
// TIER COLORS (hierarchy level)
// ============================================================================
export const TierColors = {
  focal: "#f59e0b", // amber-500 - core company
  direct: "#3b82f6", // blue-500 - direct suppliers/customers
  indirect: "#8b5cf6", // violet-500 - indirect relationships
  systemic: "#ec4899", // pink-500 - market-level impact
} as const;

export type TierName = keyof typeof TierColors;

export const getTierColor = (tier?: string): string => {
  if (!tier) return TierColors.focal;
  return TierColors[tier as TierName] ?? TierColors.focal;
};

// ============================================================================
// BACKGROUND & SURFACE COLORS
// ============================================================================
export const Backgrounds = {
  // Dark surfaces (matching current Tailwind-inspired palette)
  darkBase: "#0a0e1a", // navy-950
  darkSurface: "#0f1320", // navy-900
  darkCard: "#1a1f3a", // navy-800
  glassLight: "rgba(30, 41, 82, 0.4)", // Glassmorphism light
  glassDark: "rgba(10, 14, 26, 0.5)", // Glassmorphism dark

  // Text
  textPrimary: "#e2e8f0", // slate-100
  textSecondary: "#94a3b8", // slate-400
  textMuted: "#64748b", // slate-500
} as const;

// ============================================================================
// BORDERS & OUTLINES
// ============================================================================
export const Borders = {
  light: "1px solid rgba(148, 163, 184, 0.15)", // Light transparent border
  medium: "1px solid rgba(100, 116, 139, 0.3)", // Medium border
  dark: "1px solid rgba(51, 65, 85, 0.5)", // Dark border
  focusRing: "2px solid rgba(56, 189, 248, 0.5)", // Focus ring (sky-400)
} as const;

// ============================================================================
// SHADOWS & GLOWS
// ============================================================================
export const Shadows = {
  xs: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
  sm: "0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)",
  md: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
  lg: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
  xl: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
} as const;

export const Glows = {
  soft: "0 0 20px rgba(56, 189, 248, 0.3)", // Soft blue glow
  node: "0 0 30px rgba(56, 189, 248, 0.4)", // Node glow
  nodeActive: "0 0 40px rgba(96, 165, 250, 0.6)", // Active node glow
  high: "0 0 50px rgba(125, 211, 252, 0.8)", // High intensity
} as const;

// ============================================================================
// BORDER RADIUS
// ============================================================================
export const BorderRadius = {
  none: "0px",
  xs: "2px",
  sm: "4px",
  md: "8px",
  lg: "12px",
  xl: "16px",
  full: "9999px",
} as const;

// ============================================================================
// SPACING
// ============================================================================
export const Spacing = {
  xs: "4px",
  sm: "8px",
  md: "12px",
  lg: "16px",
  xl: "24px",
  xxl: "32px",
} as const;

// ============================================================================
// TRANSITIONS & ANIMATIONS
// ============================================================================
export const Transitions = {
  fast: "all 150ms cubic-bezier(0.4, 0, 0.2, 1)",
  base: "all 200ms cubic-bezier(0.4, 0, 0.2, 1)",
  slow: "all 300ms cubic-bezier(0.4, 0, 0.2, 1)",
  verySlow: "all 500ms cubic-bezier(0.4, 0, 0.2, 1)",
} as const;

// ============================================================================
// NODE STYLING CONSTANTS
// ============================================================================
export const NodeDimensions = {
  width: 140,
  height: 100,
  iconSize: 48,
  badgeSize: 24,
  borderWidth: 2,
} as const;

export const NodeStyles = {
  backdropBlur: "blur(12px)",
  borderRadiusNode: BorderRadius.lg,
  paddingNode: Spacing.md,
} as const;

// ============================================================================
// EDGE STYLING CONSTANTS
// ============================================================================
export const EdgeStyles = {
  strokeWidthMin: 0.6,
  strokeWidthMax: 3.5,
  strokeWidthDefault: 1.5,
  animationDuration: 2000, // ms
  arrowSize: 20,
} as const;

// ============================================================================
// CONFIDENCE & CRITICALITY VISUALIZATION
// ============================================================================
export const ConfidenceThresholds = {
  high: 0.8,
  medium: 0.5,
  low: 0.2,
} as const;

export const CriticalityLevels = {
  critical: { color: "#ef4444", level: 5 }, // red-500
  high: { color: "#f97316", level: 4 }, // orange-500
  medium: { color: "#eab308", level: 3 }, // yellow-500
  low: { color: "#22c55e", level: 2 }, // green-500
  minimal: { color: "#38bdf8", level: 1 }, // sky-400
} as const;

// ============================================================================
// Z-INDEX LAYERS
// ============================================================================
export const ZIndex = {
  background: 0,
  edges: 10,
  nodes: 20,
  selected: 30,
  hover: 40,
  toolbar: 100,
  modal: 200,
  tooltip: 300,
} as const;

// ============================================================================
// BREAKPOINTS (for responsive behavior)
// ============================================================================
export const Breakpoints = {
  xs: 320,
  sm: 640,
  md: 1024,
  lg: 1280,
  xl: 1536,
} as const;

// ============================================================================
// HELPER FUNCTIONS FOR COMMON PATTERNS
// ============================================================================

export const glassBackground = (opacity: number = 0.4): string => {
  return `rgba(30, 41, 82, ${opacity})`;
};

export const glassBorder = (): string => {
  return Borders.light;
};

export const getPulseAnimation = (
  color: string,
  intensity: number = 1,
): React.CSSProperties => {
  return {
    animation: `pulse ${2 + intensity * 0.5}s cubic-bezier(0.4, 0, 0.6, 1) infinite`,
    boxShadow: `0 0 ${20 * intensity}px ${color}`,
  };
};

export const getConfidenceOpacity = (confidence: number): number => {
  if (confidence >= ConfidenceThresholds.high) return 1.0;
  if (confidence >= ConfidenceThresholds.medium) return 0.75;
  if (confidence >= ConfidenceThresholds.low) return 0.5;
  return 0.3;
};

export const getStrokeWidth = (weight?: number): number => {
  if (!weight || weight === 0) return EdgeStyles.strokeWidthDefault;
  return Math.max(
    EdgeStyles.strokeWidthMin,
    Math.min(EdgeStyles.strokeWidthMax, Math.log1p(weight) * 0.8),
  );
};

/**
 * Create a linear gradient string from source color to target color
 * Useful for edge gradients and many visual effects
 */
export const createGradient = (fromColor: string, toColor: string): string => {
  return `linear-gradient(90deg, ${fromColor}, ${toColor})`;
};

/**
 * Get contrasting text color based on background
 */
export const getTextColorForBackground = (bgColor?: string): string => {
  // For light backgrounds, use dark text; for dark, use light
  // Default implementation returns light text (assuming dark backgrounds)
  return Backgrounds.textPrimary;
};

export const gwmdEntityTypes = [
  "company",
  "facility",
  "infrastructure",
  "region",
] as const;
export const gwmdStatusTypes = ["normal", "impacted", "failed"] as const;

export type GwmdEntityType = (typeof gwmdEntityTypes)[number];
export type GwmdStatusType = (typeof gwmdStatusTypes)[number];

const entityColors: Record<GwmdEntityType, string> = {
  company: "#3b82f6",
  facility: "#22c55e",
  infrastructure: "#f59e0b",
  region: "#a855f7",
};

const statusColors: Record<GwmdStatusType, string> = {
  normal: "#38bdf8",
  impacted: "#f97316",
  failed: "#ef4444",
};

function shapePath(entityType: GwmdEntityType) {
  switch (entityType) {
    case "company":
      return '<circle cx="32" cy="30" r="18" />';
    case "facility":
      return '<rect x="15" y="13" width="34" height="34" rx="6" ry="6" />';
    case "infrastructure":
      return '<path d="M32 10 L52 30 L32 50 L12 30 Z" />';
    case "region":
      return '<path d="M20 14 L44 14 L56 32 L44 50 L20 50 L8 32 Z" />';
    default:
      return '<circle cx="32" cy="30" r="18" />';
  }
}

export function getGwmdIconName(
  entityType: GwmdEntityType,
  status: GwmdStatusType,
) {
  return `${entityType}-${status}`;
}

export function buildGwmdIconSvg(
  entityType: GwmdEntityType,
  status: GwmdStatusType,
) {
  const baseColor = entityColors[entityType];
  const badgeColor = statusColors[status];
  const shape = shapePath(entityType);
  const gradientId = `grad-${entityType}-${status}`;
  const isAnimated = status !== "normal";

  const animationStyle = isAnimated
    ? `
    <style>
      @keyframes pulse-badge {
        0%, 100% { r: 8; opacity: 1; }
        50% { r: 9.5; opacity: 0.7; }
      }
      .status-badge-${status} {
        animation: pulse-badge 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
      }
    </style>
    `
    : "";

  return `
<svg width="64" height="64" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- Main gradient for entity shape -->
    <linearGradient id="${gradientId}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${baseColor}" stop-opacity="1"/>
      <stop offset="100%" stop-color="${baseColor}" stop-opacity="0.6"/>
    </linearGradient>
    
    <!-- Drop shadow filter -->
    <filter id="shadow-${entityType}" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#0f172a" flood-opacity="0.6" />
    </filter>
    
    <!-- Glow filter for status badge -->
    <filter id="glow-${status}">
      <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
      <feMerge>
        <feMergeNode in="coloredBlur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>

    ${animationStyle}
  </defs>
  
  <!-- Entity shape with gradient and shadow -->
  <g filter="url(#shadow-${entityType})">
    <g fill="url(${gradientId})" stroke="rgba(255,255,255,0.9)" stroke-width="1.5">
      ${shape}
    </g>
  </g>
  
  <!-- Status badge with glow -->
  <circle 
    class="status-badge-${status}"
    cx="47" cy="47" r="8" 
    fill="${badgeColor}" 
    stroke="#0b1120" 
    stroke-width="2" 
    filter="url(#glow-${status})"
  />
  
  <!-- Optional: shine effect on top -->
  <circle cx="22" cy="20" r="5" fill="white" opacity="0.15" />
</svg>`;
}

export function buildGwmdIconDataUrl(
  entityType: GwmdEntityType,
  status: GwmdStatusType,
) {
  const svg = buildGwmdIconSvg(entityType, status).trim();
  const encoded = encodeURIComponent(svg)
    .replace(/%0A/g, "")
    .replace(/%20/g, " ");
  return `data:image/svg+xml;charset=utf-8,${encoded}`;
}

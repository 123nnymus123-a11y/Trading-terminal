export const gwmdEntityTypes = ["company", "facility", "infrastructure", "region"] as const;
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

export function getGwmdIconName(entityType: GwmdEntityType, status: GwmdStatusType) {
  return `${entityType}-${status}`;
}

export function buildGwmdIconSvg(entityType: GwmdEntityType, status: GwmdStatusType) {
  const baseColor = entityColors[entityType];
  const badgeColor = statusColors[status];
  const shape = shapePath(entityType);
  return `
<svg width="64" height="64" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#0f172a" flood-opacity="0.6" />
    </filter>
  </defs>
  <g filter="url(#shadow)">
    <g fill="${baseColor}" stroke="rgba(255,255,255,0.85)" stroke-width="2">
      ${shape}
    </g>
  </g>
  <circle cx="47" cy="47" r="8" fill="${badgeColor}" stroke="#0b1120" stroke-width="2" />
</svg>`;
}

export function buildGwmdIconDataUrl(entityType: GwmdEntityType, status: GwmdStatusType) {
  const svg = buildGwmdIconSvg(entityType, status).trim();
  const encoded = encodeURIComponent(svg)
    .replace(/%0A/g, "")
    .replace(/%20/g, " ");
  return `data:image/svg+xml;charset=utf-8,${encoded}`;
}

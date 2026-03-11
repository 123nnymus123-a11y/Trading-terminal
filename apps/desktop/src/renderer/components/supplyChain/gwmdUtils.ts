import type { SupplyChainGraphNode } from "@tc/shared/supplyChain";

export type GwmdRegion = "Americas" | "Europe" | "APAC" | "MEA" | "Other" | "Unlocated";

export function resolveNodeRegion(node: SupplyChainGraphNode): GwmdRegion {
  const meta = node.metadata as { hqLat?: number; hqLon?: number; hqRegion?: string } | undefined;
  if (meta?.hqRegion) {
    const upper = meta.hqRegion.toUpperCase();
    if (upper.includes("AMER")) return "Americas";
    if (upper.includes("EURO")) return "Europe";
    if (upper.includes("APAC") || upper.includes("ASIA") || upper.includes("PAC")) return "APAC";
    if (upper.includes("MEA") || upper.includes("AFR") || upper.includes("MIDDLE")) return "MEA";
  }
  const lat = meta?.hqLat;
  const lon = meta?.hqLon;
  if (typeof lat !== "number" || typeof lon !== "number") return "Unlocated";
  if (lon < -30) return "Americas";
  if (lon >= -30 && lon < 60) return lat >= 15 ? "Europe" : "MEA";
  if (lon >= 60 && lon <= 180) return "APAC";
  return "Other";
}

import type { SupplyChainGraphEdge, SupplyChainGraphNode } from "@tc/shared/supplyChain";
import type { GwmdRegion } from "./gwmdUtils";

type Position = [number, number];

interface PointGeometry {
  type: "Point";
  coordinates: Position;
}

interface LineStringGeometry {
  type: "LineString";
  coordinates: Position[];
}

interface Feature<G, P> {
  type: "Feature";
  geometry: G;
  properties: P;
}

interface FeatureCollection<G, P> {
  type: "FeatureCollection";
  features: Array<Feature<G, P>>;
}

export const relationColors: Record<string, string> = {
  supplier: "#22c55e",
  customer: "#38bdf8",
  partner: "#a855f7",
  license: "#f59e0b",
  financing: "#f97316",
  competitor: "#ef4444",
  other: "#64748b",
};

export interface GwmdGeoNode {
  node: SupplyChainGraphNode;
  region: GwmdRegion;
  hasGeo: boolean;
  lat: number | null;
  lon: number | null;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function offsetCoordinate(lat: number, lon: number, radiusKm: number, angleRad: number): { lat: number; lon: number } {
  const latOffset = (radiusKm / 111) * Math.sin(angleRad);
  const cosLat = Math.cos(toRadians(lat));
  const lonDivisor = 111 * (Math.abs(cosLat) < 0.2 ? 0.2 : Math.abs(cosLat));
  const lonOffset = (radiusKm / lonDivisor) * Math.cos(angleRad);
  return {
    lat: clamp(lat + latOffset, -89.999, 89.999),
    lon: clamp(lon + lonOffset, -179.999, 179.999),
  };
}

export function spreadOverlappingGeoNodes(nodes: GwmdGeoNode[]): GwmdGeoNode[] {
  const groups = new Map<string, GwmdGeoNode[]>();

  nodes.forEach((item) => {
    if (!item.hasGeo || item.lat === null || item.lon === null) return;
    const key = `${item.lat.toFixed(5)}|${item.lon.toFixed(5)}`;
    const group = groups.get(key);
    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  });

  const adjustedById = new Map<string, { lat: number; lon: number }>();

  groups.forEach((group) => {
    if (group.length < 2) return;
    const ordered = [...group].sort((a, b) => a.node.id.localeCompare(b.node.id));
    ordered.forEach((item, index) => {
      const baseLat = item.lat as number;
      const baseLon = item.lon as number;
      const angle = ((index * 137.508) % 360) * (Math.PI / 180);
      const radiusKm = 4 * Math.sqrt(index + 1);
      const adjusted = offsetCoordinate(baseLat, baseLon, radiusKm, angle);
      adjustedById.set(item.node.id, adjusted);
    });
  });

  return nodes.map((item) => {
    if (!item.hasGeo) return item;
    const adjusted = adjustedById.get(item.node.id);
    if (!adjusted) return item;
    return {
      ...item,
      lat: adjusted.lat,
      lon: adjusted.lon,
    };
  });
}

export function edgeWeight(edge: SupplyChainGraphEdge) {
  if (edge.weightRange) {
    return (edge.weightRange.min + edge.weightRange.max) / 2;
  }
  if (typeof edge.weight === "number") return edge.weight;
  return edge.criticality ?? 1;
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function toDegrees(value: number) {
  return (value * 180) / Math.PI;
}

function greatCircleArc(start: Position, end: Position, steps = 64): Position[] {
  const [lon1, lat1] = start;
  const [lon2, lat2] = end;
  const φ1 = toRadians(lat1);
  const λ1 = toRadians(lon1);
  const φ2 = toRadians(lat2);
  const λ2 = toRadians(lon2);

  const v1: [number, number, number] = [Math.cos(φ1) * Math.cos(λ1), Math.cos(φ1) * Math.sin(λ1), Math.sin(φ1)];
  const v2: [number, number, number] = [Math.cos(φ2) * Math.cos(λ2), Math.cos(φ2) * Math.sin(λ2), Math.sin(φ2)];

  const dot = Math.min(1, Math.max(-1, v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]));
  const angle = Math.acos(dot);
  if (!Number.isFinite(angle) || angle === 0) {
    return [start, end];
  }

  const sinAngle = Math.sin(angle);
  const coords: Position[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const a = Math.sin((1 - t) * angle) / sinAngle;
    const b = Math.sin(t * angle) / sinAngle;
    const x = a * v1[0] + b * v2[0];
    const y = a * v1[1] + b * v2[1];
    const z = a * v1[2] + b * v2[2];
    const lat = Math.atan2(z, Math.sqrt(x * x + y * y));
    const lon = Math.atan2(y, x);
    coords.push([toDegrees(lon), toDegrees(lat)]);
  }
  return coords;
}

function bearingDegrees(start: Position, end: Position) {
  const [lon1, lat1] = start;
  const [lon2, lat2] = end;
  const φ1 = toRadians(lat1);
  const φ2 = toRadians(lat2);
  const Δλ = toRadians(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return (toDegrees(θ) + 360) % 360;
}

export function toNodeFeatures(
  nodes: GwmdGeoNode[],
  simulation: {
    failedNodeIds: string[];
    impactScores?: Record<string, number>;
  }
): FeatureCollection<
  PointGeometry,
  { id: string; label: string; region: GwmdRegion; status: string; impactScore: number; entityType: string }
> {
  const features: Array<
    Feature<PointGeometry, { id: string; label: string; region: GwmdRegion; status: string; impactScore: number; entityType: string }>
  > = nodes
    .filter((item) => item.hasGeo && typeof item.lon === "number" && typeof item.lat === "number")
    .map((item) => {
      const impactScore = simulation.impactScores?.[item.node.id] ?? 0;
      const failed = simulation.failedNodeIds.includes(item.node.id);
      const status = failed ? "failed" : impactScore > 0 ? "impacted" : "normal";
      return {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [item.lon as number, item.lat as number],
        },
        properties: {
          id: item.node.id,
          label: item.node.label,
          region: item.region,
          status,
          impactScore,
          entityType: item.node.entityType ?? "company",
        },
      };
    });
  return { type: "FeatureCollection", features };
}

export function toEdgeFeatures(
  edges: SupplyChainGraphEdge[],
  nodeIndex: Map<string, GwmdGeoNode>
): FeatureCollection<LineStringGeometry, { id: string; kind: string; confidence: number; strokeWidth: number; from: string; to: string }> {
  const features: Array<Feature<LineStringGeometry, { id: string; kind: string; confidence: number; strokeWidth: number; from: string; to: string }>> = [];
  edges.forEach((edge) => {
    const from = nodeIndex.get(edge.from);
    const to = nodeIndex.get(edge.to);
    if (!from?.hasGeo || !to?.hasGeo || typeof from.lon !== "number" || typeof from.lat !== "number" || typeof to.lon !== "number" || typeof to.lat !== "number") {
      return;
    }
    const weight = edgeWeight(edge);
    const strokeWidth = Math.max(1, Math.min(6, Math.log1p(weight)));
    const start: Position = [from.lon, from.lat];
    const end: Position = [to.lon, to.lat];
    features.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: greatCircleArc(start, end),
      },
      properties: {
        id: edge.id,
        kind: edge.kind,
        confidence: edge.confidence ?? 0.6,
        strokeWidth,
        from: edge.from,
        to: edge.to,
      },
    });
  });
  return { type: "FeatureCollection", features };
}

export function toArrowFeatures(
  edges: SupplyChainGraphEdge[],
  nodeIndex: Map<string, GwmdGeoNode>
): FeatureCollection<PointGeometry, { id: string; kind: string; bearing: number; from: string; to: string }> {
  const features: Array<Feature<PointGeometry, { id: string; kind: string; bearing: number; from: string; to: string }>> = [];
  edges.forEach((edge) => {
    const from = nodeIndex.get(edge.from);
    const to = nodeIndex.get(edge.to);
    if (!from?.hasGeo || !to?.hasGeo || typeof from.lon !== "number" || typeof from.lat !== "number" || typeof to.lon !== "number" || typeof to.lat !== "number") {
      return;
    }
    const start: Position = [from.lon, from.lat];
    const end: Position = [to.lon, to.lat];
    const arc = greatCircleArc(start, end, 32);
    if (arc.length < 2) return;
    const midIndex = Math.floor(arc.length * 0.6);
    const anchor = arc[Math.min(arc.length - 2, Math.max(0, midIndex))];
    const next = arc[Math.min(arc.length - 1, Math.max(1, midIndex + 1))];
    if (!anchor || !next) return;
    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: anchor,
      },
      properties: {
        id: edge.id,
        kind: edge.kind,
        bearing: bearingDegrees(anchor, next),
        from: edge.from,
        to: edge.to,
      },
    });
  });
  return { type: "FeatureCollection", features };
}

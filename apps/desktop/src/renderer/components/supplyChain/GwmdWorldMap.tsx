import React, { useMemo, useRef, useState, useEffect, memo } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { SupplyChainGraph } from "@tc/shared/supplyChain";
import { resolveNodeRegion } from "./gwmdUtils";
import { edgeWeight, relationColors, spreadOverlappingGeoNodes, toArrowFeatures, toEdgeFeatures, toNodeFeatures, type GwmdGeoNode } from "./gwmdMapUtils";
import { buildGwmdIconDataUrl, getGwmdIconName, gwmdEntityTypes, gwmdStatusTypes } from "./gwmdIcons";
import {
  decodePlaceCode,
  isValidLatLon,
  parseCoordinate,
} from "../../lib/gwmdPlaceCode";

const CARTO_DARK_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const GWMD_FALLBACK_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: [
        "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution:
        "&copy; OpenStreetMap contributors",
    },
  },
  layers: [
    {
      id: "osm",
      type: "raster",
      source: "osm",
      minzoom: 0,
      maxzoom: 19,
    },
  ],
} as const;
const GWMD_MAP_STATE_KEY = "gwmdMapState.v1";
const GWMD_MAP_STATE_TTL = 1000 * 60 * 60 * 8;
const GWMD_SAFE_MAX_TEXTURE_FALLBACK = 8192;

type GwmdWallCameraMessage = {
  type: "camera-sync";
  senderId: string;
  leaderId?: string;
  at: number;
  center: [number, number];
  virtualCenter?: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
} | {
  type: "leader-claim";
  senderId: string;
  at: number;
} | {
  type: "leader-release";
  senderId: string;
  at: number;
};

type GwmdDisplaySurfaceState = {
  enabled: boolean;
  mode: "standard" | "wall" | "analyst" | "mirror";
  bounds: { x: number; y: number; width: number; height: number };
  monitors?: Array<{
    id: number;
    bounds: { x: number; y: number; width: number; height: number };
  }>;
};

function getMaxTextureSizeSafe() {
  if (typeof document === "undefined") return GWMD_SAFE_MAX_TEXTURE_FALLBACK;
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl) return GWMD_SAFE_MAX_TEXTURE_FALLBACK;
    const size = (gl as WebGLRenderingContext).getParameter(
      (gl as WebGLRenderingContext).MAX_TEXTURE_SIZE,
    );
    return typeof size === "number" && Number.isFinite(size)
      ? Math.max(4096, size)
      : GWMD_SAFE_MAX_TEXTURE_FALLBACK;
  } catch {
    return GWMD_SAFE_MAX_TEXTURE_FALLBACK;
  }
}

function computeSafeMapPixelRatio(
  containerWidth: number,
  containerHeight: number,
  rawDpr: number,
  isMultiDisplayLayout: boolean,
) {
  const maxTexture = getMaxTextureSizeSafe();
  const maxSafeTexture = Math.floor(maxTexture * 0.9);
  const maxByWidth = maxSafeTexture / Math.max(1, containerWidth);
  const maxByHeight = maxSafeTexture / Math.max(1, containerHeight);
  const textureCap = Math.max(1, Math.min(maxByWidth, maxByHeight));
  const dprCap = isMultiDisplayLayout ? Math.min(rawDpr, 2.25) : Math.min(rawDpr, 3);
  const area = Math.max(1, containerWidth * containerHeight);
  const areaCap = area > 28_000_000 ? 1.2 : area > 18_000_000 ? 1.45 : area > 10_000_000 ? 1.75 : 2.4;

  const resolved = Math.max(1, Math.min(dprCap, textureCap, areaCap));
  if (rawDpr >= 1.25 && area <= 18_000_000) {
    return Math.max(1.25, resolved);
  }
  return resolved;
}

function isGwmdDebugEnabled() {
  if (!import.meta.env.DEV || typeof window === "undefined") return false;
  return window.sessionStorage.getItem("gwmd:debug") === "1";
}

function gwmdDebugLog(...args: unknown[]) {
  if (!isGwmdDebugEnabled()) return;
  console.log(...args);
}

function normalizeLabel(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function dedupeVisualGeoNodes(nodes: GwmdGeoNode[]): GwmdGeoNode[] {
  const byKey = new Map<string, GwmdGeoNode>();

  for (const item of nodes) {
    const metadata = (item.node.metadata ?? {}) as {
      hqCity?: string;
      hqCountry?: string;
    };
    const label = normalizeLabel(item.node.label);
    const city = normalizeLabel(metadata.hqCity);
    const country = normalizeLabel(metadata.hqCountry);

    if (!label || !city) {
      byKey.set(`id:${item.node.id}`, item);
      continue;
    }

    const key = `${label}|${city}|${country}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      continue;
    }

    const existingScore =
      (existing.hasGeo ? 1000 : 0) + (existing.node.confidence ?? 0) * 100;
    const nextScore = (item.hasGeo ? 1000 : 0) + (item.node.confidence ?? 0) * 100;
    if (nextScore >= existingScore) {
      byKey.set(key, item);
    }
  }

  return Array.from(byKey.values());
}

function normalizeLabel(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function dedupeVisualGeoNodes(nodes: GwmdGeoNode[]): GwmdGeoNode[] {
  const byKey = new Map<string, GwmdGeoNode>();

  for (const item of nodes) {
    const metadata = (item.node.metadata ?? {}) as {
      hqCity?: string;
      hqCountry?: string;
    };
    const label = normalizeLabel(item.node.label);
    const city = normalizeLabel(metadata.hqCity);
    const country = normalizeLabel(metadata.hqCountry);

    if (!label || !city) {
      byKey.set(`id:${item.node.id}`, item);
      continue;
    }

    const key = `${label}|${city}|${country}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      continue;
    }

    const existingScore =
      (existing.hasGeo ? 1000 : 0) + (existing.node.confidence ?? 0) * 100;
    const nextScore = (item.hasGeo ? 1000 : 0) + (item.node.confidence ?? 0) * 100;
    if (nextScore >= existingScore) {
      byKey.set(key, item);
    }
  }

  return Array.from(byKey.values());
}

function formatGeoSourceLabel(value?: string) {
  if (!value) return "Unknown";
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getGeoProvenanceTone(value?: string) {
  switch (value) {
    case "curated":
      return { label: "Curated", border: "rgba(34,197,94,0.45)", bg: "rgba(20,83,45,0.35)", text: "#86efac" };
    case "nominatim":
      return { label: "Nominatim", border: "rgba(56,189,248,0.45)", bg: "rgba(14,116,144,0.28)", text: "#7dd3fc" };
    case "ai_model":
      return { label: "AI Model", border: "rgba(251,146,60,0.45)", bg: "rgba(124,45,18,0.3)", text: "#fdba74" };
    case "stored_snapshot":
      return { label: "Stored Snapshot", border: "rgba(168,85,247,0.45)", bg: "rgba(88,28,135,0.28)", text: "#d8b4fe" };
    case "vault":
      return { label: "Vault", border: "rgba(34,197,94,0.55)", bg: "rgba(20,83,45,0.45)", text: "#86efac" };
    case "country_centroid":
      return { label: "Country Est.", border: "rgba(234,179,8,0.45)", bg: "rgba(113,63,18,0.35)", text: "#fde047" };
    case "unresolved":
      return { label: "Unresolved", border: "rgba(148,163,184,0.35)", bg: "rgba(30,41,59,0.6)", text: "#cbd5e1" };
    default:
      return { label: formatGeoSourceLabel(value), border: "rgba(148,163,184,0.35)", bg: "rgba(30,41,59,0.6)", text: "#cbd5e1" };
  }
}

function formatGeoQuality(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  const percent = Math.max(0, Math.min(100, Math.round(value * 100)));
  return `${percent}%`;
}

function loadCachedMapState() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(GWMD_MAP_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      center?: unknown;
      zoom?: unknown;
      timestamp?: unknown;
    } | null;
    if (!parsed || typeof parsed !== "object") return null;

    const timestamp =
      typeof parsed.timestamp === "number" && Number.isFinite(parsed.timestamp)
        ? parsed.timestamp
        : null;
    if (timestamp === null || Date.now() - timestamp > GWMD_MAP_STATE_TTL) return null;

    const centerArray = Array.isArray(parsed.center) ? parsed.center : null;
    if (!centerArray || centerArray.length !== 2) return null;
    const centerLng =
      typeof centerArray[0] === "number" && Number.isFinite(centerArray[0])
        ? centerArray[0]
        : null;
    const centerLat =
      typeof centerArray[1] === "number" && Number.isFinite(centerArray[1])
        ? centerArray[1]
        : null;
    if (centerLng === null || centerLat === null) return null;

    const zoom =
      typeof parsed.zoom === "number" && Number.isFinite(parsed.zoom)
        ? parsed.zoom
        : null;
    if (zoom === null) return null;

    return {
      center: [centerLng, centerLat] as [number, number],
      zoom,
      timestamp,
    };
  } catch {
    return null;
  }
}

function isFiniteLngLat(value: unknown): value is [number, number] {
  if (!Array.isArray(value) || value.length < 2) return false;
  const lng = value[0];
  const lat = value[1];
  return (
    typeof lng === "number" &&
    Number.isFinite(lng) &&
    typeof lat === "number" &&
    Number.isFinite(lat) &&
    lng >= -180 &&
    lng <= 180 &&
    lat >= -90 &&
    lat <= 90
  );
}

function clampZoom(value: unknown, fallback = 1.2) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(-2, Math.min(22, value));
}

function saveCachedMapState(map: maplibregl.Map) {
  if (typeof window === "undefined") return;
  try {
    const center = map.getCenter();
    const zoom = map.getZoom();
    const state = {
      center: [center.lng, center.lat] as [number, number],
      zoom,
      timestamp: Date.now(),
    };
    window.sessionStorage.setItem(GWMD_MAP_STATE_KEY, JSON.stringify(state));
  } catch {
    // Ignore cache write failures
  }
}

function collectVisibleNodesByHop(
  graph: SupplyChainGraph,
  focalNodeId: string | null,
  hopLimit: number,
): Set<string> | null {
  if (!focalNodeId) return null;
  const normalizedHopLimit = Math.max(1, Math.floor(hopLimit));
  if (!graph.nodes.some((node) => node.id === focalNodeId)) return null;

  const adjacency = new Map<string, Set<string>>();
  for (const node of graph.nodes) {
    adjacency.set(node.id, new Set<string>());
  }
  for (const edge of graph.edges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, new Set<string>());
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, new Set<string>());
    adjacency.get(edge.from)?.add(edge.to);
    adjacency.get(edge.to)?.add(edge.from);
  }

  const visible = new Set<string>([focalNodeId]);
  const queue: Array<{ id: string; depth: number }> = [
    { id: focalNodeId, depth: 0 },
  ];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    if (current.depth >= normalizedHopLimit) continue;

    for (const next of adjacency.get(current.id) ?? []) {
      if (visible.has(next)) continue;
      visible.add(next);
      queue.push({ id: next, depth: current.depth + 1 });
    }
  }

  return visible;
}

function registerGwmdIcons(map: maplibregl.Map) {
  gwmdEntityTypes.forEach((entityType) => {
    gwmdStatusTypes.forEach((status) => {
      const name = getGwmdIconName(entityType, status);
      if (map.hasImage(name)) return;
      const image = new Image(64, 64);
      image.onload = () => {
        try {
          if (!map.hasImage(name)) {
            map.addImage(name, image, { pixelRatio: 2 });
          }
        } catch {
          // Map was removed before image finished loading — ignore
        }
      };
      image.src = buildGwmdIconDataUrl(entityType, status);
    });
  });
}

function GwmdWorldMap({
  graph,
  selectedNodeId,
  selectedEdgeId,
  focalNodeId = null,
  hopLimit = 2,
  simulation,
  filters,
  onFiltersChange,
  onSelectNode,
  onSelectEdge,
  layoutVersion,
  wallMode = false,
  wallIsPrimary = true,
  wallSyncChannel = null,
  wallMonitorId = null,
  wallPrimaryMonitorId = null,
  wallDisplayMode = "standard",
  wallSurfaceState = null,
  globalTickers = [],
}: {
  graph: SupplyChainGraph;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  focalNodeId?: string | null;
  hopLimit?: number;
  simulation: {
    failedNodeIds: string[];
    failedEdgeIds: string[];
    impactScores?: Record<string, number>;
    impactedEdgeIds?: string[];
  };
  filters: {
    region: string;
    relation: string;
    showFlows: boolean;
    showOnlyImpacted: boolean;
    hops?: number;
    minConfidence?: number;
    showUnresolved?: boolean;
    sourceMode?: "cache_only" | "hybrid" | "fresh";
  };
  onFiltersChange: (next: {
    region: string;
    relation: string;
    showFlows: boolean;
    showOnlyImpacted: boolean;
    hops?: number;
    minConfidence?: number;
    showUnresolved?: boolean;
    sourceMode?: "cache_only" | "hybrid" | "fresh";
  }) => void;
  onSelectNode: (nodeId: string | null) => void;
  onSelectEdge: (edgeId: string | null) => void;
  layoutVersion?: string | number;
  wallMode?: boolean;
  wallIsPrimary?: boolean;
  wallSyncChannel?: string | null;
  wallMonitorId?: number | null;
  wallPrimaryMonitorId?: number | null;
  wallDisplayMode?: "standard" | "wall" | "analyst" | "mirror";
  wallSurfaceState?: GwmdDisplaySurfaceState | null;
  globalTickers?: string[];
}) {
  const isMultiDisplayLayout =
    typeof layoutVersion === "string" && layoutVersion.includes("-multi-");
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const zoomRafRef = useRef<number | null>(null);
  const zoomValueRef = useRef(1);
  const [mapError, setMapError] = useState<string | null>(null);
  const [repairingGeo, setRepairingGeo] = useState(false);
  const [regeneratingGraph, setRegeneratingGraph] = useState(false);
  const debounceTimerRef = useRef<number | null>(null);
  const onSelectNodeRef = useRef(onSelectNode);
  const onSelectEdgeRef = useRef(onSelectEdge);
  const showFlowsRef = useRef(filters.showFlows);
  const isInteractingRef = useRef(false);
  const wallChannelRef = useRef<BroadcastChannel | null>(null);
  const wallClientIdRef = useRef(
    `gwmd-map-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  const applyingRemoteCameraRef = useRef(false);
  const currentLeaderRef = useRef<string | null>(null);
  const localLeaderSinceRef = useRef<number>(0);
  const cameraSyncRafRef = useRef<number | null>(null);
  const wallOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const wallUsesVirtualViewportRef = useRef(false);
  const isCoordinatedWall = wallMode && (wallDisplayMode === "wall" || wallDisplayMode === "mirror");
  const interactionEnabled = !isCoordinatedWall || wallIsPrimary || wallDisplayMode === "wall" || wallDisplayMode === "mirror";
  const usedCachedStateRef = useRef(false);
  const styleFallbackAppliedRef = useRef(false);
  const hasFitBoundsRef = useRef(false);
  const lastLayoutModeRef = useRef<string | null>(null);
  const pendingDataRef = useRef<{
    nodeFeatures: ReturnType<typeof toNodeFeatures>;
    edgeFeatures: ReturnType<typeof toEdgeFeatures>;
    arrowFeatures: ReturnType<typeof toArrowFeatures>;
    showFlows: boolean;
  } | null>(null);

  useEffect(() => {
    onSelectNodeRef.current = onSelectNode;
  }, [onSelectNode]);

  useEffect(() => {
    onSelectEdgeRef.current = onSelectEdge;
  }, [onSelectEdge]);

  useEffect(() => {
    showFlowsRef.current = filters.showFlows;
  }, [filters.showFlows]);

  const wallViewportOffset = useMemo(() => {
    if (!isCoordinatedWall || !wallSurfaceState || !Array.isArray(wallSurfaceState.monitors)) {
      return { x: 0, y: 0, active: false };
    }
    if (typeof wallMonitorId !== "number") {
      return { x: 0, y: 0, active: false };
    }
    const monitor = wallSurfaceState.monitors.find((item) => item.id === wallMonitorId);
    if (!monitor) {
      return { x: 0, y: 0, active: false };
    }

    const wallBounds = wallSurfaceState.bounds;
    const monitorCenterX = monitor.bounds.x + monitor.bounds.width / 2;
    const monitorCenterY = monitor.bounds.y + monitor.bounds.height / 2;
    const wallCenterX = wallBounds.x + wallBounds.width / 2;
    const wallCenterY = wallBounds.y + wallBounds.height / 2;

    return {
      x: monitorCenterX - wallCenterX,
      y: monitorCenterY - wallCenterY,
      active: true,
    };
  }, [isCoordinatedWall, wallMonitorId, wallSurfaceState]);

  useEffect(() => {
    wallOffsetRef.current = { x: wallViewportOffset.x, y: wallViewportOffset.y };
    wallUsesVirtualViewportRef.current = wallViewportOffset.active;
  }, [wallViewportOffset]);

  useEffect(() => {
    if (!wallMode || !wallSyncChannel || typeof BroadcastChannel === "undefined") {
      return;
    }

    const channel = new BroadcastChannel(`gwmd-wall-sync:${wallSyncChannel}`);
    wallChannelRef.current = channel;

    channel.onmessage = (event: MessageEvent<GwmdWallCameraMessage>) => {
      const message = event.data;
      if (!message) return;
      if (message.senderId === wallClientIdRef.current) return;

      if (message.type === "leader-claim") {
        if (message.at >= localLeaderSinceRef.current) {
          currentLeaderRef.current = message.senderId;
        }
        return;
      }

      if (message.type === "leader-release") {
        if (currentLeaderRef.current === message.senderId) {
          currentLeaderRef.current = null;
        }
        return;
      }

      if (message.type !== "camera-sync") return;

      if (message.leaderId) {
        currentLeaderRef.current = message.leaderId;
      }

      const map = mapRef.current;
      if (!map) return;
      if (isInteractingRef.current && currentLeaderRef.current === wallClientIdRef.current) {
        return;
      }

      let center = message.center;
      if (
        wallUsesVirtualViewportRef.current &&
        Array.isArray(message.virtualCenter) &&
        message.virtualCenter.length >= 2
      ) {
        try {
          const projected = map.project(message.virtualCenter as [number, number]);
          const offset = wallOffsetRef.current;
          const localPoint = new maplibregl.Point(projected.x + offset.x, projected.y + offset.y);
          const localCenter = map.unproject(localPoint);
          center = [localCenter.lng, localCenter.lat];
        } catch {
          center = message.center;
        }
      }

      applyingRemoteCameraRef.current = true;
      try {
        map.jumpTo({
          center,
          zoom: message.zoom,
          bearing: message.bearing,
          pitch: message.pitch,
        });
      } catch {
        // Ignore transient camera sync failures during map lifecycle churn.
      } finally {
        applyingRemoteCameraRef.current = false;
      }
    };

    return () => {
      channel.close();
      if (wallChannelRef.current === channel) {
        wallChannelRef.current = null;
      }
    };
  }, [wallMode, wallSyncChannel]);

  const setFlowVisibility = (map: maplibregl.Map, visible: boolean) => {
    const value = visible ? "visible" : "none";
    try {
      map.setLayoutProperty("gwmd-edges", "visibility", value);
      map.setLayoutProperty("gwmd-edges-selected", "visibility", value);
      map.setLayoutProperty("gwmd-edge-arrows", "visibility", value);
      map.setLayoutProperty("gwmd-edges-selected-upstream", "visibility", value);
      map.setLayoutProperty("gwmd-edges-selected-downstream", "visibility", value);
      map.setLayoutProperty("gwmd-edge-arrows-selected-upstream", "visibility", value);
      map.setLayoutProperty("gwmd-edge-arrows-selected-downstream", "visibility", value);
    } catch {
      // Ignore layout changes if layers are missing during init
    }
  };

  const publishCameraSync = (map: maplibregl.Map) => {
    if (!wallMode || applyingRemoteCameraRef.current) {
      return;
    }
    const channel = wallChannelRef.current;
    if (!channel) {
      return;
    }

    try {
      const center = map.getCenter();
      let virtualCenter: [number, number] | undefined;
      if (wallUsesVirtualViewportRef.current) {
        try {
          const projected = map.project([center.lng, center.lat]);
          const offset = wallOffsetRef.current;
          const virtualPoint = new maplibregl.Point(projected.x - offset.x, projected.y - offset.y);
          const wallCenter = map.unproject(virtualPoint);
          virtualCenter = [wallCenter.lng, wallCenter.lat];
        } catch {
          virtualCenter = undefined;
        }
      }

      channel.postMessage({
        type: "camera-sync",
        senderId: wallClientIdRef.current,
        leaderId: currentLeaderRef.current ?? wallClientIdRef.current,
        at: Date.now(),
        center: [center.lng, center.lat],
        virtualCenter,
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      } as GwmdWallCameraMessage);
    } catch {
      // Ignore transient camera sync publish failures.
    }
  };


  const geoNodes = useMemo<GwmdGeoNode[]>(() => {
    const nodes = graph.nodes.map((node) => {
      const meta = node.metadata as {
        hqPlaceCode?: string;
        hqLat?: number | string;
        hqLon?: number | string;
        geoSource?: string;
      } | undefined;
      const fromPlaceCode = decodePlaceCode(meta?.hqPlaceCode);
      const fallbackLat = parseCoordinate(meta?.hqLat);
      const fallbackLon = parseCoordinate(meta?.hqLon);
      const lat = fromPlaceCode?.lat ?? fallbackLat;
      const lon = fromPlaceCode?.lon ?? fallbackLon;
      const hasGeo = isValidLatLon(lat, lon);
      const isCentroid = hasGeo && meta?.geoSource === "country_centroid";

      return {
        node,
        region: resolveNodeRegion(node),
        hasGeo,
        lat: hasGeo ? (lat as number) : null,
        lon: hasGeo ? (lon as number) : null,
        isCentroid,
      };
    });
    
    const withGeo = nodes.filter(n => n.hasGeo).length;
    gwmdDebugLog('[GWMD] Parsed geo nodes:', withGeo, 'with coordinates out of', nodes.length, 'total nodes');
    if (withGeo > 0) {
      const samples = nodes.filter(n => n.hasGeo).slice(0, 3);
      gwmdDebugLog('[GWMD] Sample node coords:', samples.map(n => ({ id: n.node.id, lat: n.lat, lon: n.lon })));
    }
    return nodes;
  }, [graph.nodes]);

  const dedupedGeoNodes = useMemo(() => dedupeVisualGeoNodes(geoNodes), [geoNodes]);

  const spreadGeoNodes = useMemo(
    () => spreadOverlappingGeoNodes(dedupedGeoNodes),
    [dedupedGeoNodes],
  );

  const nodeIndex = useMemo(() => new Map(spreadGeoNodes.map((item) => [item.node.id, item])), [spreadGeoNodes]);
  
  const geoStats = useMemo(() => {
    const precislyLocated = geoNodes.filter((item) => item.hasGeo && !item.isCentroid).length;
    const centroid = geoNodes.filter((item) => item.hasGeo && item.isCentroid).length;
    const unlocated = geoNodes.filter((item) => !item.hasGeo).length;
    // Keep "located" as total rendered nodes (precise + centroid) for back-compat
    const located = precislyLocated + centroid;
    return { located, precislyLocated, centroid, unlocated };
  }, [geoNodes]);

  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    return graph.nodes.find((node) => node.id === selectedNodeId) ?? null;
  }, [graph.nodes, selectedNodeId]);

  const nodeLabelById = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node.label])),
    [graph.nodes],
  );

  const partnerIndex = useMemo(() => {
    const index = new Map<
      string,
      Array<{
        id: string;
        label: string;
        kind: string;
        weight: number;
        confidence: number;
      }>
    >();

    const addPartner = (
      sourceId: string,
      targetId: string,
      kind: string,
      weight: number,
      confidence: number,
    ) => {
      const current = index.get(sourceId) ?? [];
      current.push({
        id: targetId,
        label: nodeLabelById.get(targetId) ?? targetId,
        kind,
        weight,
        confidence,
      });
      index.set(sourceId, current);
    };

    for (const edge of graph.edges) {
      const weight = edgeWeight(edge);
      const confidence = edge.confidence ?? 0.6;
      addPartner(edge.from, edge.to, edge.kind, weight, confidence);
      addPartner(edge.to, edge.from, edge.kind, weight, confidence);
    }

    for (const [nodeId, partners] of index.entries()) {
      partners.sort((a, b) => b.weight - a.weight);
      index.set(nodeId, partners.slice(0, 12));
    }

    return index;
  }, [graph.edges, nodeLabelById]);

  const selectedPartners = useMemo(() => {
    if (!selectedNodeId) return [] as Array<{ id: string; label: string; kind: string; weight: number; confidence: number }>;
    return (partnerIndex.get(selectedNodeId) ?? []).slice(0, 6);
  }, [partnerIndex, selectedNodeId]);

  const visibleNodeIdsByHop = useMemo(
    () => collectVisibleNodesByHop(graph, focalNodeId, hopLimit),
    [graph, focalNodeId, hopLimit],
  );


  // Extract impact scores to avoid re-creating filteredNodes when other simulation properties change
  const impactScores = useMemo(() => simulation.impactScores ?? {}, [simulation.impactScores]);
  const impactedEdgeIds = useMemo(() => simulation.impactedEdgeIds ?? [], [simulation.impactedEdgeIds]);
  const impactedEdgeIdSet = useMemo(() => new Set(impactedEdgeIds), [impactedEdgeIds]);
  
  const filteredNodes = useMemo(() => {
    return spreadGeoNodes.filter((item) => {
      if (visibleNodeIdsByHop && !visibleNodeIdsByHop.has(item.node.id)) {
        return false;
      }
      if (filters.region !== "All" && item.region !== filters.region) return false;
      if (filters.showOnlyImpacted) {
        const score = impactScores[item.node.id] ?? 0;
        if (score <= 0) return false;
      }
      return true;
    });
  }, [spreadGeoNodes, visibleNodeIdsByHop, filters.region, filters.showOnlyImpacted, impactScores]);

  const filteredEdges = useMemo(() => {
    const visibleEdges = graph.edges.filter((edge) => {
      if (
        visibleNodeIdsByHop &&
        (!visibleNodeIdsByHop.has(edge.from) || !visibleNodeIdsByHop.has(edge.to))
      ) {
        return false;
      }
      if (filters.relation !== "all" && edge.kind !== filters.relation) return false;
      if ((edge.confidence ?? 0) < (filters.minConfidence ?? 0)) return false;
      if (filters.showOnlyImpacted && !impactedEdgeIdSet.has(edge.id)) return false;
      const from = nodeIndex.get(edge.from);
      const to = nodeIndex.get(edge.to);
      if (!from || !to) return false;
      if (filters.region !== "All" && from.region !== filters.region && to.region !== filters.region) return false;
      return true;
    });

    const bySemanticKey = new Map<string, SupplyChainGraph["edges"][number]>();
    for (const edge of visibleEdges) {
      const key = `${edge.kind}|${edge.from}|${edge.to}`;
      const existing = bySemanticKey.get(key);
      if (!existing) {
        bySemanticKey.set(key, edge);
        continue;
      }
      const existingScore = edgeWeight(existing) * (existing.confidence ?? 0.6);
      const nextScore = edgeWeight(edge) * (edge.confidence ?? 0.6);
      if (nextScore >= existingScore) {
        bySemanticKey.set(key, edge);
      }
    }
    const deduped = Array.from(bySemanticKey.values());

    if (selectedNodeId || selectedEdgeId) {
      const selectedSet = new Set<string>();
      if (selectedEdgeId) {
        selectedSet.add(selectedEdgeId);
      }
      if (selectedNodeId) {
        for (const edge of deduped) {
          if (edge.from === selectedNodeId || edge.to === selectedNodeId) {
            selectedSet.add(edge.id);
          }
        }
      }

      const focused = deduped
        .filter((edge) => selectedSet.has(edge.id))
        .sort((a, b) => edgeWeight(b) * (b.confidence ?? 0.6) - edgeWeight(a) * (a.confidence ?? 0.6));
      const spillover = deduped
        .filter((edge) => !selectedSet.has(edge.id))
        .sort((a, b) => edgeWeight(b) * (b.confidence ?? 0.6) - edgeWeight(a) * (a.confidence ?? 0.6))
        .slice(0, 120);
      return [...focused.slice(0, 520), ...spillover];
    }

    const ranked = deduped.sort(
      (a, b) => edgeWeight(b) * (b.confidence ?? 0.6) - edgeWeight(a) * (a.confidence ?? 0.6),
    );

    if (ranked.length <= 900) {
      return ranked;
    }

    return ranked.slice(0, 900);
  }, [
    graph.edges,
    visibleNodeIdsByHop,
    filters.relation,
    filters.region,
    filters.showOnlyImpacted,
    filters.minConfidence,
    nodeIndex,
    impactedEdgeIdSet,
  ]);

  const showFlows = filters.showFlows && (zoom >= 0.8 || filteredEdges.length <= 260);
  const showDetailedArrows = showFlows && (Boolean(selectedNodeId || selectedEdgeId) || zoom >= 3.2);

  const nodeFeatures = useMemo(() => {
    const features = toNodeFeatures(filteredNodes, simulation);
    gwmdDebugLog('[GWMD] Generated node features:', features.features.length, 'from', filteredNodes.length, 'filtered nodes');
    return features;
  }, [filteredNodes, simulation]);
  const edgeFeatures = useMemo(() => {
    const features = showFlows ? toEdgeFeatures(filteredEdges, nodeIndex) : ({ type: "FeatureCollection" as const, features: [] });
    gwmdDebugLog('[GWMD] Generated edge features:', features.features.length, 'from', filteredEdges.length, 'filtered edges');
    return features;
  }, [filteredEdges, nodeIndex, showFlows]);
  const arrowFeatures = useMemo(
    () => (showDetailedArrows ? toArrowFeatures(filteredEdges, nodeIndex) : ({ type: "FeatureCollection" as const, features: [] })),
    [filteredEdges, nodeIndex, showDetailedArrows]
  );

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;
    const container = mapContainer.current;
    if (!container) return;
    const containerWidth = Math.max(1, container.clientWidth);
    const containerHeight = Math.max(1, container.clientHeight);
    const rawDpr =
      typeof window !== "undefined" && Number.isFinite(window.devicePixelRatio)
        ? window.devicePixelRatio
        : 1;
    const mapPixelRatio = computeSafeMapPixelRatio(
      containerWidth,
      containerHeight,
      rawDpr,
      isMultiDisplayLayout,
    );

    const cached = loadCachedMapState();
    if (cached) {
      usedCachedStateRef.current = true;
    }

    const initialCenter = isFiniteLngLat(cached?.center) ? cached.center : ([0, 20] as [number, number]);
    const initialZoom = clampZoom(cached?.zoom, 1.2);

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container,
        style: CARTO_DARK_STYLE,
        center: initialCenter,
        zoom: initialZoom,
        pitch: 0,
        bearing: 0,
        attributionControl: false,
        renderWorldCopies: false,
        trackResize: false,
        pixelRatio: mapPixelRatio,
        maxBounds: [
          [-180, -85],
          [180, 85],
        ],
      });
    } catch (error) {
      gwmdDebugLog("[GWMD] Primary map init failed, retrying with minimal config", error);
      try {
        map = new maplibregl.Map({
          container,
          style: CARTO_DARK_STYLE,
          center: [0, 20],
          zoom: 1.2,
          pitch: 0,
          bearing: 0,
          attributionControl: false,
          renderWorldCopies: false,
          trackResize: false,
          pixelRatio: mapPixelRatio,
        });
      } catch (retryError) {
        const message = retryError instanceof Error ? retryError.message : "Map init failed";
        setMapError(message);
        gwmdDebugLog("[GWMD] Map init retry failed", retryError);
        return;
      }
    }

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "bottom-right");

    map.on("load", () => {
      registerGwmdIcons(map);
      // Create arrow icon from canvas
      const arrowCanvas = document.createElement('canvas');
      const logicalArrowSize = 20;
      const scaledArrowSize = logicalArrowSize * mapPixelRatio;
      arrowCanvas.width = scaledArrowSize;
      arrowCanvas.height = scaledArrowSize;
      const ctx = arrowCanvas.getContext('2d');
      if (ctx) {
        ctx.scale(mapPixelRatio, mapPixelRatio);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(10, 2);
        ctx.lineTo(18, 10);
        ctx.lineTo(10, 18);
        ctx.lineTo(10, 13);
        ctx.lineTo(2, 13);
        ctx.lineTo(2, 7);
        ctx.lineTo(10, 7);
        ctx.closePath();
        ctx.fill();
      }
      
      // Convert canvas to ImageData
      const imageData = ctx?.getImageData(0, 0, scaledArrowSize, scaledArrowSize);
      if (imageData) {
        map.addImage('arrow', {
          width: scaledArrowSize,
          height: scaledArrowSize,
          data: new Uint8Array(imageData.data.buffer),
        }, { pixelRatio: mapPixelRatio });
      }

      map.addSource("gwmd-nodes", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        cluster: true,
        clusterRadius: 50,
        clusterMaxZoom: 4,
      });
      map.addSource("gwmd-edges", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addSource("gwmd-edge-arrows", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: "gwmd-edges",
        type: "line",
        source: "gwmd-edges",
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": [
            "match",
            ["get", "kind"],
            "supplier",
            relationColors.supplier ?? "#22c55e",
            "customer",
            relationColors.customer ?? "#38bdf8",
            "partner",
            relationColors.partner ?? "#a855f7",
            "license",
            relationColors.license ?? "#f59e0b",
            "financing",
            relationColors.financing ?? "#f97316",
            "competitor",
            relationColors.competitor ?? "#ef4444",
            relationColors.other ?? "#64748b",
          ],
          "line-width": ["get", "strokeWidth"],
          // Cap opacity so low-confidence edges stay faint and the map is readable
          "line-opacity": ["min", 0.55, ["max", 0.12, ["*", ["coalesce", ["get", "confidence"], 0.6], 0.65]]],
        },
      });

      // Dashed overlay for edges where ≥1 endpoint uses country-centroid estimation
      map.addLayer({
        id: "gwmd-edges-partial-dash",
        type: "line",
        source: "gwmd-edges",
        layout: {
          "line-join": "round",
          "line-cap": "butt",
        },
        paint: {
          "line-color": "rgba(234,179,8,0.65)",
          "line-width": ["get", "strokeWidth"],
          "line-dasharray": [5, 4],
          "line-opacity": 0.45,
        },
        filter: ["==", ["get", "partial"], true],
      });

      map.addLayer({
        id: "gwmd-edges-selected",
        type: "line",
        source: "gwmd-edges",
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#f9a8d4",
          "line-width": ["+", ["get", "strokeWidth"], 1.5],
          "line-opacity": 0.95,
        },
        filter: ["==", ["get", "id"], "__none__"],
      });

      map.addLayer({
        id: "gwmd-edges-selected-upstream",
        type: "line",
        source: "gwmd-edges",
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#ef4444",
          "line-width": ["+", ["get", "strokeWidth"], 1.5],
          "line-opacity": 0.95,
        },
        filter: ["==", ["get", "id"], "__none__"],
      });

      map.addLayer({
        id: "gwmd-edges-selected-downstream",
        type: "line",
        source: "gwmd-edges",
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#22c55e",
          "line-width": ["+", ["get", "strokeWidth"], 1.5],
          "line-opacity": 0.95,
        },
        filter: ["==", ["get", "id"], "__none__"],
      });

      map.addLayer({
        id: "gwmd-clusters",
        type: "circle",
        source: "gwmd-nodes",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "rgba(59,130,246,0.25)",
          "circle-radius": [
            "step",
            ["get", "point_count"],
            18,
            10,
            22,
            25,
            28,
            50,
            34,
            100,
            40,
          ],
          "circle-stroke-color": "rgba(59,130,246,0.6)",
          "circle-stroke-width": 2,
        },
      });

      map.addLayer({
        id: "gwmd-cluster-count",
        type: "symbol",
        source: "gwmd-nodes",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-size": 12,
          "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
        },
        paint: {
          "text-color": "#e2e8f0",
        },
      });

      map.addLayer({
        id: "gwmd-edge-arrows",
        type: "symbol",
        source: "gwmd-edge-arrows",
        // Only render arrows when zoomed in enough to avoid clutter at world view
        minzoom: 2.5,
        layout: {
          "symbol-placement": "point",
          "icon-image": "arrow",
          "icon-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            2.5, 0.55,
            4, 0.80,
            6, 1.05
          ],
          "icon-rotate": ["get", "bearing"],
          "icon-rotation-alignment": "map",
          // Allow overlap so arrows aren't hidden; icons are small enough not to clutter
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: {
          "icon-color": [
            "match",
            ["get", "kind"],
            "supplier",
            relationColors.supplier ?? "#22c55e",
            "customer",
            relationColors.customer ?? "#38bdf8",
            "partner",
            relationColors.partner ?? "#a855f7",
            "license",
            relationColors.license ?? "#f59e0b",
            "financing",
            relationColors.financing ?? "#f97316",
            "competitor",
            relationColors.competitor ?? "#ef4444",
            relationColors.other ?? "#64748b",
          ],
          "icon-opacity": 0.85,
        },
      });

      map.addLayer({
        id: "gwmd-edge-arrows-selected-upstream",
        type: "symbol",
        source: "gwmd-edge-arrows",
        // Show selection arrows at lower zoom so direction is visible when a node is selected
        minzoom: 1.5,
        layout: {
          "symbol-placement": "point",
          "icon-image": "arrow",
          "icon-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            1.5, 0.6,
            3, 0.85,
            5, 1.1
          ],
          "icon-rotate": ["get", "bearing"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: {
          "icon-color": "#ef4444",
          "icon-opacity": 0.95,
        },
        filter: ["==", ["get", "id"], "__none__"],
      });

      map.addLayer({
        id: "gwmd-edge-arrows-selected-downstream",
        type: "symbol",
        source: "gwmd-edge-arrows",
        minzoom: 1.5,
        layout: {
          "symbol-placement": "point",
          "icon-image": "arrow",
          "icon-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            1.5, 0.6,
            3, 0.85,
            5, 1.1
          ],
          "icon-rotate": ["get", "bearing"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: {
          "icon-color": "#22c55e",
          "icon-opacity": 0.95,
        },
        filter: ["==", ["get", "id"], "__none__"],
      });


      map.addLayer({
        id: "gwmd-nodes-glow",
        type: "circle",
        source: "gwmd-nodes",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": [
            "match",
            ["get", "status"],
            "failed",
            "rgba(239,68,68,0.35)",
            "impacted",
            "rgba(249,115,22,0.3)",
            "rgba(59,130,246,0.3)",
          ],
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, 9, 2, 12, 4, 15],
          "circle-blur": 0,
        },
      });

      map.addLayer({
        id: "gwmd-nodes",
        type: "symbol",
        source: "gwmd-nodes",
        filter: ["!", ["has", "point_count"]],
        layout: {
          "icon-image": ["concat", ["get", "entityType"], "-", ["get", "status"]],
          "icon-size": ["interpolate", ["linear"], ["zoom"], 0, 0.45, 2, 0.6, 4, 0.78],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
      });

      map.addLayer({
        id: "gwmd-node-labels",
        type: "symbol",
        source: "gwmd-nodes",
        minzoom: 3,
        filter: ["!", ["has", "point_count"]],
        layout: {
          "text-field": ["coalesce", ["get", "label"], ["get", "id"]],
          "text-size": ["interpolate", ["linear"], ["zoom"], 3, 9, 6, 11],
          "text-offset": [0, 1.3],
          "text-anchor": "top",
          "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
          "text-optional": true,
        },
        paint: {
          "text-color": "#e2e8f0",
          "text-halo-color": "rgba(10,14,26,0.85)",
          "text-halo-width": 1.5,
        },
      });

      map.addLayer({
        id: "gwmd-nodes-selected",
        type: "circle",
        source: "gwmd-nodes",
        filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "id"], "__none__"]],
        paint: {
          "circle-color": "rgba(59,130,246,0.2)",
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 10, 3, 13, 5.5, 16],
          "circle-stroke-color": "#f9a8d4",
          "circle-stroke-width": 2,
        },
      });

      if (!interactionEnabled) {
        map.boxZoom.disable();
        map.dragPan.disable();
        map.dragRotate.disable();
        map.doubleClickZoom.disable();
        map.scrollZoom.disable();
        map.keyboard.disable();
        map.touchZoomRotate.disable();
      }

      map.on("click", "gwmd-nodes", (event) => {
        if (!interactionEnabled) return;
        const feature = event.features?.[0];
        const id = feature?.properties?.id;
        const label = feature?.properties?.label;
        gwmdDebugLog('[GWMD] Node clicked:', { id, label, feature });
        if (typeof id === "string") {
          onSelectNodeRef.current(id);
        }
      });

      map.on("click", "gwmd-clusters", (event) => {
        if (!interactionEnabled) return;
        const feature = event.features?.[0];
        if (!feature || feature.geometry.type !== "Point") return;
        const clusterId = feature.properties?.cluster_id;
        if (typeof clusterId !== "number") return;
        const source = map.getSource("gwmd-nodes") as maplibregl.GeoJSONSource & {
          getClusterExpansionZoom: (id: number, cb: (err: unknown, zoomLevel: number) => void) => void;
        };
        source.getClusterExpansionZoom(clusterId, (err: unknown, zoomLevel: number) => {
          if (err || typeof zoomLevel !== "number") return;
          const coordinates = (feature.geometry as unknown as { coordinates: [number, number] }).coordinates;
          try {
            map.easeTo({ center: coordinates, zoom: zoomLevel });
          } catch (error) {
            gwmdDebugLog("[GWMD] Cluster expansion failed", error);
          }
        });
      });

      map.on("click", "gwmd-edges", (event) => {
        if (!interactionEnabled) return;
        const id = event.features?.[0]?.properties?.id;
        const kind = event.features?.[0]?.properties?.kind;
        gwmdDebugLog('[GWMD] Edge clicked:', { id, kind, feature: event.features?.[0] });
        if (typeof id === "string") {
          onSelectEdgeRef.current(id);
        }
      });


      map.on("mouseenter", "gwmd-nodes", () => {
        map.getCanvas().style.cursor = interactionEnabled ? "pointer" : "";
      });
      map.on("mouseleave", "gwmd-nodes", () => {
        map.getCanvas().style.cursor = "";
      });
      map.on("mouseenter", "gwmd-clusters", () => {
        map.getCanvas().style.cursor = interactionEnabled ? "pointer" : "";
      });
      map.on("mouseleave", "gwmd-clusters", () => {
        map.getCanvas().style.cursor = "";
      });
      map.on("mouseenter", "gwmd-edges", () => {
        map.getCanvas().style.cursor = interactionEnabled ? "pointer" : "";
      });
      map.on("mouseleave", "gwmd-edges", () => {
        map.getCanvas().style.cursor = "";
      });

      map.on("zoom", () => {
        if (zoomRafRef.current !== null) return;
        zoomRafRef.current = window.requestAnimationFrame(() => {
          zoomRafRef.current = null;
          const nextZoom = map.getZoom();
          const crossedFlowThreshold =
            (zoomValueRef.current < 0.8 && nextZoom >= 0.8) ||
            (zoomValueRef.current >= 0.8 && nextZoom < 0.8);
          const crossedArrowThreshold =
            (zoomValueRef.current < 3.2 && nextZoom >= 3.2) ||
            (zoomValueRef.current >= 3.2 && nextZoom < 3.2);

          if (
            crossedFlowThreshold ||
            crossedArrowThreshold ||
            Math.abs(nextZoom - zoomValueRef.current) >= 0.12
          ) {
            zoomValueRef.current = nextZoom;
            setZoom(nextZoom);
          }
        });
      });


      map.on("movestart", () => {
        isInteractingRef.current = true;
        setFlowVisibility(map, false);
        if (wallMode && !applyingRemoteCameraRef.current) {
          const claimAt = Date.now();
          currentLeaderRef.current = wallClientIdRef.current;
          localLeaderSinceRef.current = claimAt;
          try {
            wallChannelRef.current?.postMessage({
              type: "leader-claim",
              senderId: wallClientIdRef.current,
              at: claimAt,
            } as GwmdWallCameraMessage);
          } catch {
            // Ignore transient leader-claim failures.
          }
        }
      });

      map.on("move", () => {
        if (!wallMode || applyingRemoteCameraRef.current) {
          return;
        }
        if (cameraSyncRafRef.current !== null) {
          return;
        }
        cameraSyncRafRef.current = window.requestAnimationFrame(() => {
          cameraSyncRafRef.current = null;
          publishCameraSync(map);
        });
      });

      map.on("moveend", () => {
        isInteractingRef.current = false;
        setFlowVisibility(map, showFlowsRef.current);
        if (cameraSyncRafRef.current !== null) {
          window.cancelAnimationFrame(cameraSyncRafRef.current);
          cameraSyncRafRef.current = null;
        }
        if (wallMode && !applyingRemoteCameraRef.current) {
          publishCameraSync(map);
          try {
            wallChannelRef.current?.postMessage({
              type: "leader-release",
              senderId: wallClientIdRef.current,
              at: Date.now(),
            } as GwmdWallCameraMessage);
          } catch {
            // Ignore transient leader-release failures.
          }
        }
        if (pendingDataRef.current) {
          const pending = pendingDataRef.current;
          pendingDataRef.current = null;
          const nodeSource = map.getSource("gwmd-nodes") as maplibregl.GeoJSONSource | undefined;
          const edgeSource = map.getSource("gwmd-edges") as maplibregl.GeoJSONSource | undefined;
          const arrowSource = map.getSource("gwmd-edge-arrows") as maplibregl.GeoJSONSource | undefined;
          if (nodeSource && edgeSource && arrowSource) {
            nodeSource.setData(pending.nodeFeatures);
            edgeSource.setData(pending.edgeFeatures);
            arrowSource.setData(pending.arrowFeatures);
            setFlowVisibility(map, pending.showFlows);
          }
        }
        saveCachedMapState(map);
      });

      map.on("error", (event) => {
        const message = (event?.error as { message?: string } | undefined)?.message ?? "MapLibre error";

        const lower = message.toLowerCase();
        const looksLikeStyleLoadFailure =
          lower.includes("style") ||
          lower.includes("sprite") ||
          lower.includes("glyph") ||
          lower.includes("failed to load") ||
          lower.includes("http");

        if (!styleFallbackAppliedRef.current && looksLikeStyleLoadFailure) {
          styleFallbackAppliedRef.current = true;
          try {
            map.setStyle(GWMD_FALLBACK_STYLE as unknown as string);
            setMapError("Primary basemap unavailable, switched to fallback map style.");
            return;
          } catch {
            // Fall through and surface the original error.
          }
        }

        setMapError(message);
      });

      setMapReady(true);
    });

    mapRef.current = map;

    const observer = new ResizeObserver(() => {
      try {
        map.resize();
      } catch {
        // Ignore resize races during strict-mode remounts and teardown.
      }
    });
    observer.observe(container);

    return () => {
      if (cameraSyncRafRef.current !== null) {
        window.cancelAnimationFrame(cameraSyncRafRef.current);
        cameraSyncRafRef.current = null;
      }
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [isMultiDisplayLayout]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    if (usedCachedStateRef.current || hasFitBoundsRef.current) return;
    if (!geoNodes.some((node) => node.hasGeo && node.lat !== null && node.lon !== null)) return;

    const bounds = geoNodes
      .filter((node) => node.hasGeo && node.lat !== null && node.lon !== null)
      .reduce(
        (acc, node) => ({
          minLat: Math.min(acc.minLat, node.lat as number),
          maxLat: Math.max(acc.maxLat, node.lat as number),
          minLon: Math.min(acc.minLon, node.lon as number),
          maxLon: Math.max(acc.maxLon, node.lon as number),
        }),
        { minLat: 90, maxLat: -90, minLon: 180, maxLon: -180 }
      );

    mapRef.current.fitBounds(
      [
        [bounds.minLon, bounds.minLat],
        [bounds.maxLon, bounds.maxLat],
      ],
      {
        padding: 110,
        maxZoom: 4,
        duration: 900,
      }
    );
    hasFitBoundsRef.current = true;
  }, [geoNodes, mapReady]);

  // Track last data state to avoid unnecessary updates
  const lastDataKeyRef = useRef<string>("");

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    
    const map = mapRef.current;
    const nodeSource = map.getSource("gwmd-nodes") as maplibregl.GeoJSONSource | undefined;
    const edgeSource = map.getSource("gwmd-edges") as maplibregl.GeoJSONSource | undefined;
    const arrowSource = map.getSource("gwmd-edge-arrows") as maplibregl.GeoJSONSource | undefined;
    
    if (!nodeSource || !edgeSource || !arrowSource) return;

    // Create a key to detect actual data changes (not just reference changes)
    // Include sample coordinates to detect geocoding updates
    let sampleCoordKey = "";
    if (nodeFeatures.features.length > 0) {
      const firstNode = nodeFeatures.features[0];
      if (firstNode && firstNode.geometry.type === "Point") {
        const coords = firstNode.geometry.coordinates;
        if (
          Array.isArray(coords) &&
          coords.length >= 2 &&
          typeof coords[0] === "number" &&
          Number.isFinite(coords[0]) &&
          typeof coords[1] === "number" &&
          Number.isFinite(coords[1])
        ) {
          sampleCoordKey = `${Math.round(coords[0])}|${Math.round(coords[1])}`;
        }
      }
    }
    const dataKey = `${nodeFeatures.features.length}|${edgeFeatures.features.length}|${arrowFeatures.features.length}|${showFlows}|${sampleCoordKey}`;
    
    // Skip if data hasn't actually changed
    if (lastDataKeyRef.current === dataKey) {
      return;
    }
    
    lastDataKeyRef.current = dataKey;
    
    gwmdDebugLog('[GWMD] Data changed - updating map with nodes:', nodeFeatures.features.length, 'edges:', edgeFeatures.features.length, 'showFlows:', showFlows);

    if (isInteractingRef.current) {
      pendingDataRef.current = { nodeFeatures, edgeFeatures, arrowFeatures, showFlows };
      return;
    }

    // Debounce the actual setData calls with a minimal timeout
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = window.setTimeout(() => {
      nodeSource.setData(nodeFeatures);
      edgeSource.setData(edgeFeatures);
      arrowSource.setData(arrowFeatures);
      setFlowVisibility(map, showFlows);
      debounceTimerRef.current = null;
    }, 50);

    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
    };
  }, [mapReady, nodeFeatures, edgeFeatures, arrowFeatures, showFlows]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const nodeFilter = selectedNodeId
      ? ["all", ["!", ["has", "point_count"]], ["==", ["get", "id"], selectedNodeId]]
      : ["==", ["get", "id"], "__none__"];
    const edgeFilter = selectedEdgeId ? ["==", ["get", "id"], selectedEdgeId] : ["==", ["get", "id"], "__none__"];
    const upstreamFilter = selectedNodeId
      ? [
          "any",
          ["all", ["==", ["get", "kind"], "supplier"], ["==", ["get", "from"], selectedNodeId]],
          ["all", ["==", ["get", "kind"], "customer"], ["==", ["get", "to"], selectedNodeId]],
        ]
      : ["==", ["get", "id"], "__none__"];
    const downstreamFilter = selectedNodeId
      ? [
          "any",
          ["all", ["==", ["get", "kind"], "customer"], ["==", ["get", "from"], selectedNodeId]],
          ["all", ["==", ["get", "kind"], "supplier"], ["==", ["get", "to"], selectedNodeId]],
        ]
      : ["==", ["get", "id"], "__none__"];
    map.setFilter("gwmd-nodes-selected", nodeFilter as maplibregl.FilterSpecification);
    map.setFilter("gwmd-edges-selected", edgeFilter as maplibregl.FilterSpecification);
    map.setFilter("gwmd-edges-selected-upstream", upstreamFilter as maplibregl.FilterSpecification);
    map.setFilter("gwmd-edges-selected-downstream", downstreamFilter as maplibregl.FilterSpecification);
    map.setFilter("gwmd-edge-arrows-selected-upstream", upstreamFilter as maplibregl.FilterSpecification);
    map.setFilter("gwmd-edge-arrows-selected-downstream", downstreamFilter as maplibregl.FilterSpecification);
  }, [mapReady, selectedNodeId, selectedEdgeId]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    let rafId1: number | null = null;
    let rafId2: number | null = null;
    let timeoutId: number | null = null;

    const safeResize = () => {
      try {
        map.resize();
      } catch {
        // Ignore transient resize races during display-surface transitions.
      }
    };

    safeResize();
    rafId1 = window.requestAnimationFrame(() => {
      safeResize();
      rafId2 = window.requestAnimationFrame(() => {
        safeResize();
      });
    });
    timeoutId = window.setTimeout(() => {
      safeResize();
    }, 180);

    return () => {
      if (rafId1 !== null) window.cancelAnimationFrame(rafId1);
      if (rafId2 !== null) window.cancelAnimationFrame(rafId2);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [mapReady, layoutVersion]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const mode = typeof layoutVersion === "string" && layoutVersion.includes("-multi-") ? "multi" : "windowed";
    const previousMode = lastLayoutModeRef.current;
    lastLayoutModeRef.current = mode;
    if (mode !== "multi" || previousMode === "multi") return;

    const located = geoNodes.filter(
      (node) => node.hasGeo && node.lat !== null && node.lon !== null,
    );
    if (located.length === 0) return;

    const bounds = located.reduce(
      (acc, node) => ({
        minLat: Math.min(acc.minLat, node.lat as number),
        maxLat: Math.max(acc.maxLat, node.lat as number),
        minLon: Math.min(acc.minLon, node.lon as number),
        maxLon: Math.max(acc.maxLon, node.lon as number),
      }),
      { minLat: 90, maxLat: -90, minLon: 180, maxLon: -180 },
    );

    try {
      mapRef.current.fitBounds(
        [
          [bounds.minLon, bounds.minLat],
          [bounds.maxLon, bounds.maxLat],
        ],
        {
          padding: 140,
          maxZoom: 3.8,
          duration: 700,
        },
      );
    } catch {
      // Ignore fitBounds race if map is mid-transition.
    }
  }, [mapReady, layoutVersion, geoNodes]);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        borderRadius: 16,
        overflow: "hidden",
        background: "#0a0e1a",
        boxShadow: "inset 0 0 0 1px rgba(148,163,184,0.12)",
      }}
    >
      <div
        ref={mapContainer}
        style={{
          position: "absolute",
          inset: 0,
          backgroundColor: "#0a0e1a",
          touchAction: interactionEnabled ? "none" : "auto",
          pointerEvents: interactionEnabled ? "auto" : "none",
          userSelect: "none",
          WebkitUserSelect: "none",
        }}
        onWheel={(e) => {
          // Prevent page scroll when interacting with map
          e.stopPropagation();
        }}
        onTouchStart={(e) => {
          e.stopPropagation();
        }}
        onTouchMove={(e) => {
          e.stopPropagation();
        }}
      />

      {(geoStats.located === 0 || geoStats.centroid > 0 || geoStats.unlocated > 0) && (
        <div
          style={{
            position: "absolute",
            bottom: 12,
            left: 12,
            padding: "8px 12px",
            borderRadius: 12,
            background: "rgba(2,6,23,0.78)",
            border: "1px solid rgba(148,163,184,0.18)",
            color: "#cbd5f5",
            fontSize: 11,
            maxWidth: 380,
            lineHeight: 1.4,
            backdropFilter: "blur(8px)",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {geoStats.located === 0
            ? "No nodes have valid coordinates yet. Searching will geocode them."
            : [
                geoStats.centroid > 0 && `${geoStats.centroid} node${geoStats.centroid !== 1 ? "s" : ""} shown at country centroid (estimated).`,
                geoStats.unlocated > 0 && `${geoStats.unlocated} node${geoStats.unlocated !== 1 ? "s" : ""} still unlocated.`,
              ].filter(Boolean).join(" ")}
          <button
            disabled={repairingGeo}
            onClick={() => {
              const repairGeo = (window as unknown as { cockpit?: { gwmdMap?: { repairGeo?: () => Promise<unknown> } } }).cockpit?.gwmdMap?.repairGeo;
              if (!repairGeo) return;
              setRepairingGeo(true);
              void repairGeo().finally(() => setRepairingGeo(false));
            }}
            style={{
              background: repairingGeo ? "rgba(30,41,59,0.6)" : "rgba(59,130,246,0.18)",
              border: "1px solid rgba(59,130,246,0.4)",
              color: repairingGeo ? "#64748b" : "#93c5fd",
              borderRadius: 8,
              padding: "4px 10px",
              fontSize: 10,
              cursor: repairingGeo ? "not-allowed" : "pointer",
              alignSelf: "flex-start",
            }}
          >
            {repairingGeo ? "Geocoding…" : "Re-geocode"}
          </button>
          <button
            disabled={regeneratingGraph || globalTickers.length === 0}
            onClick={() => {
              const search = (window as unknown as { cockpit?: { gwmdMap?: { search?: (ticker: string) => Promise<unknown> } } }).cockpit?.gwmdMap?.search;
              if (!search || globalTickers.length === 0) return;
              setRegeneratingGraph(true);
              const ticker = globalTickers[0];
              void search(ticker).finally(() => setRegeneratingGraph(false));
            }}
            style={{
              background: regeneratingGraph ? "rgba(30,41,59,0.6)" : "rgba(34,197,94,0.18)",
              border: "1px solid rgba(34,197,94,0.4)",
              color: regeneratingGraph ? "#64748b" : globalTickers.length === 0 ? "#64748b" : "#86efac",
              borderRadius: 8,
              padding: "4px 10px",
              fontSize: 10,
              cursor: regeneratingGraph || globalTickers.length === 0 ? "not-allowed" : "pointer",
              alignSelf: "flex-start",
            }}
          >
            {regeneratingGraph ? "Regenerating…" : "Regenerate"}
          </button>
        </div>
      )}


      {selectedNode && (
        <div
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            padding: "14px 16px",
            borderRadius: 16,
            background: "linear-gradient(160deg, rgba(11,18,32,0.95), rgba(6,9,16,0.9))",
            border: "1px solid rgba(148,163,184,0.22)",
            boxShadow: "0 18px 40px rgba(2,6,23,0.5)",
            color: "#e2e8f0",
            width: 260,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em" }}>Company</div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{selectedNode.label}</div>
              <div style={{ fontSize: 11, color: "#94a3b8" }}>{selectedNode.role ?? "entity"}</div>
            </div>
            <button
              onClick={() => onSelectNodeRef.current(null)}
              style={{
                border: "1px solid rgba(148,163,184,0.3)",
                background: "transparent",
                color: "#94a3b8",
                borderRadius: 8,
                padding: "2px 6px",
                cursor: "pointer",
                fontSize: 11,
              }}
            >
              Close
            </button>
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8 }}>
            {(() => {
              const meta = selectedNode.metadata as { hqCity?: string; hqState?: string; hqCountry?: string } | undefined;
              const hq = [meta?.hqCity, meta?.hqState, meta?.hqCountry].filter(Boolean).join(", ");
              return hq ? `HQ: ${hq}` : "HQ: Unknown";
            })()}
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
            {(() => {
              const meta = selectedNode.metadata as { geoSource?: string; geoConfidence?: number } | undefined;
              const tone = getGeoProvenanceTone(meta?.geoSource);
              const confidence = formatGeoQuality(meta?.geoConfidence);
              return (
                <>
                  <span
                    style={{
                      fontSize: 10,
                      padding: "3px 8px",
                      borderRadius: 999,
                      border: `1px solid ${tone.border}`,
                      background: tone.bg,
                      color: tone.text,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}
                  >
                    Geo: {tone.label}
                  </span>
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>Quality: {confidence}</span>
                </>
              );
            })()}
          </div>
          <div style={{ fontSize: 11, color: "#cbd5f5", marginBottom: 8 }}>
            Confidence: {Math.round((selectedNode.confidence ?? 0) * 100)}%
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
            Main Trade Partners
          </div>
          {selectedPartners.length === 0 ? (
            <div style={{ fontSize: 11, color: "#94a3b8" }}>No partners found in current graph.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {selectedPartners.map((partner) => (
                <div key={`${partner.id}-${partner.kind}`} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontSize: 11, color: "#e2e8f0" }}>{partner.label}</div>
                  <div style={{ fontSize: 10, color: "#94a3b8" }}>{partner.kind}</div>
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
              Subsidiaries
            </div>
            {(() => {
              const meta = selectedNode.metadata as { subsidiaries?: string[] } | undefined;
              const subsidiaries = meta?.subsidiaries ?? [];
              if (subsidiaries.length === 0) {
                return <div style={{ fontSize: 11, color: "#94a3b8" }}>No subsidiary data available.</div>;
              }
              return subsidiaries.slice(0, 4).map((name) => (
                <div key={name} style={{ fontSize: 11, color: "#e2e8f0", marginBottom: 4 }}>{name}</div>
              ));
            })()}
          </div>
        </div>
      )}

      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          padding: "12px 14px",
          borderRadius: 14,
          background: "linear-gradient(135deg, rgba(15,23,42,0.92), rgba(8,11,20,0.85))",
          border: "1px solid rgba(148,163,184,0.25)",
          boxShadow: "0 10px 30px rgba(2,6,23,0.45)",
          backdropFilter: "blur(12px)",
          display: "flex",
          flexDirection: "column",
          gap: 9,
          fontSize: 11,
          color: "#e2e8f0",
          minWidth: 180,
        }}
      >
        <div style={{ fontWeight: 600, letterSpacing: "0.02em" }}>Filters</div>
        <div style={{ fontSize: 10, color: "#94a3b8" }}>
          Located: {geoStats.precislyLocated} • Centroid: {geoStats.centroid} • Unlocated: {geoStats.unlocated}
        </div>
        <div style={{ fontSize: 10, color: mapError ? "#f87171" : "#94a3b8" }}>
          {mapError ? `Map error: ${mapError}` : ""}
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ color: "#94a3b8" }}>Region</span>
          <select
            value={filters.region}
            onChange={(e) => onFiltersChange({ ...filters, region: e.target.value })}
            style={{ background: "rgba(15,23,42,0.9)", color: "#e2e8f0", border: "1px solid rgba(148,163,184,0.2)", borderRadius: 8, padding: "6px 8px" }}
          >
            {"All,Americas,Europe,APAC,MEA,Other".split(",").map((region) => (
              <option key={region} value={region}>{region}</option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ color: "#94a3b8" }}>Relation</span>
          <select
            value={filters.relation}
            onChange={(e) => onFiltersChange({ ...filters, relation: e.target.value })}
            style={{ background: "rgba(15,23,42,0.9)", color: "#e2e8f0", border: "1px solid rgba(148,163,184,0.2)", borderRadius: 8, padding: "6px 8px" }}
          >
            <option value="all">All</option>
            {Array.from(new Set(graph.edges.map((edge) => edge.kind))).map((kind) => (
              <option key={kind} value={kind}>{kind}</option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={filters.showFlows}
            onChange={(e) => onFiltersChange({ ...filters, showFlows: e.target.checked })}
          />
          Show flows
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={filters.showOnlyImpacted}
            onChange={(e) => onFiltersChange({ ...filters, showOnlyImpacted: e.target.checked })}
          />
          Show only impacted
        </label>
      </div>
    </div>
  );
}

export default memo(GwmdWorldMap, (prevProps, nextProps) => {
  // Custom comparison: only re-render if key data changed
  return (
    prevProps.layoutVersion === nextProps.layoutVersion &&
    prevProps.wallMode === nextProps.wallMode &&
    prevProps.wallIsPrimary === nextProps.wallIsPrimary &&
    prevProps.wallSyncChannel === nextProps.wallSyncChannel &&
    prevProps.wallMonitorId === nextProps.wallMonitorId &&
    prevProps.wallPrimaryMonitorId === nextProps.wallPrimaryMonitorId &&
    prevProps.wallDisplayMode === nextProps.wallDisplayMode &&
    prevProps.wallSurfaceState === nextProps.wallSurfaceState &&
    prevProps.selectedNodeId === nextProps.selectedNodeId &&
    prevProps.selectedEdgeId === nextProps.selectedEdgeId &&
    prevProps.filters.region === nextProps.filters.region &&
    prevProps.filters.relation === nextProps.filters.relation &&
    prevProps.filters.showFlows === nextProps.filters.showFlows &&
    prevProps.filters.showOnlyImpacted === nextProps.filters.showOnlyImpacted &&
    prevProps.filters.minConfidence === nextProps.filters.minConfidence &&
    prevProps.filters.showUnresolved === nextProps.filters.showUnresolved &&
    prevProps.filters.sourceMode === nextProps.filters.sourceMode &&
    prevProps.simulation === nextProps.simulation &&
    prevProps.graph === nextProps.graph &&
    prevProps.globalTickers === nextProps.globalTickers
  );
});

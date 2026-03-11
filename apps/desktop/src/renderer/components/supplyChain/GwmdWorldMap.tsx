import React, { useMemo, useRef, useState, useEffect, memo } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { SupplyChainGraph } from "@tc/shared/supplyChain";
import { resolveNodeRegion } from "./gwmdUtils";
import { edgeWeight, relationColors, spreadOverlappingGeoNodes, toArrowFeatures, toEdgeFeatures, toNodeFeatures, type GwmdGeoNode } from "./gwmdMapUtils";
import { buildGwmdIconDataUrl, getGwmdIconName, gwmdEntityTypes, gwmdStatusTypes } from "./gwmdIcons";

const CARTO_DARK_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const GWMD_MAP_STATE_KEY = "gwmdMapState.v1";
const GWMD_MAP_STATE_TTL = 1000 * 60 * 60 * 8;

function isGwmdDebugEnabled() {
  if (!import.meta.env.DEV || typeof window === "undefined") return false;
  return window.sessionStorage.getItem("gwmd:debug") === "1";
}

function gwmdDebugLog(...args: unknown[]) {
  if (!isGwmdDebugEnabled()) return;
  console.log(...args);
}

function parseCoordinate(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isValidCoordinate(lat: number | null, lon: number | null) {
  if (lat === null || lon === null) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
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
    const parsed = JSON.parse(raw) as { center: [number, number]; zoom: number; timestamp: number };
    if (!parsed?.timestamp || Date.now() - parsed.timestamp > GWMD_MAP_STATE_TTL) return null;
    if (!Array.isArray(parsed.center) || parsed.center.length !== 2) return null;
    if (!Number.isFinite(parsed.center[0]) || !Number.isFinite(parsed.center[1])) return null;
    if (!Number.isFinite(parsed.zoom)) return null;
    return parsed;
  } catch {
    return null;
  }
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

function registerGwmdIcons(map: maplibregl.Map) {
  gwmdEntityTypes.forEach((entityType) => {
    gwmdStatusTypes.forEach((status) => {
      const name = getGwmdIconName(entityType, status);
      if (map.hasImage(name)) return;
      const image = new Image(64, 64);
      image.onload = () => {
        if (!map.hasImage(name)) {
          map.addImage(name, image, { pixelRatio: 2 });
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
  simulation,
  filters,
  onFiltersChange,
  onSelectNode,
  onSelectEdge,
}: {
  graph: SupplyChainGraph;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
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
  };
  onFiltersChange: (next: { region: string; relation: string; showFlows: boolean; showOnlyImpacted: boolean }) => void;
  onSelectNode: (nodeId: string | null) => void;
  onSelectEdge: (edgeId: string | null) => void;
}) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const zoomRafRef = useRef<number | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const onSelectNodeRef = useRef(onSelectNode);
  const onSelectEdgeRef = useRef(onSelectEdge);
  const showFlowsRef = useRef(filters.showFlows);
  const isInteractingRef = useRef(false);
  const usedCachedStateRef = useRef(false);
  const hasFitBoundsRef = useRef(false);
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


  const geoNodes = useMemo<GwmdGeoNode[]>(() => {
    const nodes = graph.nodes.map((node) => {
      const meta = node.metadata as { hqLat?: number | string; hqLon?: number | string } | undefined;
      const lat = parseCoordinate(meta?.hqLat);
      const lon = parseCoordinate(meta?.hqLon);
      const hasGeo = isValidCoordinate(lat, lon);

      return {
        node,
        region: resolveNodeRegion(node),
        hasGeo,
        lat: hasGeo ? (lat as number) : null,
        lon: hasGeo ? (lon as number) : null,
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

  const spreadGeoNodes = useMemo(() => spreadOverlappingGeoNodes(geoNodes), [geoNodes]);

  const nodeIndex = useMemo(() => new Map(spreadGeoNodes.map((item) => [item.node.id, item])), [spreadGeoNodes]);
  
  const geoStats = useMemo(() => {
    const located = geoNodes.filter((item) => item.hasGeo).length;
    const unlocated = geoNodes.length - located;
    return { located, unlocated };
  }, [geoNodes]);

  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    return graph.nodes.find((node) => node.id === selectedNodeId) ?? null;
  }, [graph.nodes, selectedNodeId]);

  const selectedPartners = useMemo(() => {
    if (!selectedNodeId) return [] as Array<{ id: string; label: string; kind: string; weight: number; confidence: number }>;
    return graph.edges
      .filter((edge) => edge.from === selectedNodeId || edge.to === selectedNodeId)
      .map((edge) => {
        const otherId = edge.from === selectedNodeId ? edge.to : edge.from;
        const otherNode = graph.nodes.find((node) => node.id === otherId);
        return {
          id: otherId,
          label: otherNode?.label ?? otherId,
          kind: edge.kind,
          weight: edgeWeight(edge),
          confidence: edge.confidence ?? 0.6,
        };
      })
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 6);
  }, [graph.edges, graph.nodes, selectedNodeId]);


  // Extract impact scores to avoid re-creating filteredNodes when other simulation properties change
  const impactScores = useMemo(() => simulation.impactScores ?? {}, [simulation.impactScores]);
  const impactedEdgeIds = useMemo(() => simulation.impactedEdgeIds ?? [], [simulation.impactedEdgeIds]);
  
  const filteredNodes = useMemo(() => {
    return spreadGeoNodes.filter((item) => {
      if (filters.region !== "All" && item.region !== filters.region) return false;
      if (filters.showOnlyImpacted) {
        const score = impactScores[item.node.id] ?? 0;
        if (score <= 0) return false;
      }
      return true;
    });
  }, [spreadGeoNodes, filters.region, filters.showOnlyImpacted, impactScores]);

  const filteredEdges = useMemo(() => {
    return graph.edges.filter((edge) => {
      if (filters.relation !== "all" && edge.kind !== filters.relation) return false;
      if (filters.showOnlyImpacted && !impactedEdgeIds.includes(edge.id)) return false;
      const from = nodeIndex.get(edge.from);
      const to = nodeIndex.get(edge.to);
      if (!from || !to) return false;
      if (filters.region !== "All" && from.region !== filters.region && to.region !== filters.region) return false;
      return true;
    });
  }, [graph.edges, filters.relation, filters.region, filters.showOnlyImpacted, nodeIndex, impactedEdgeIds]);

  const showFlows = filters.showFlows && (zoom >= 0.9 || filteredEdges.length <= 180);

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
    () => (showFlows ? toArrowFeatures(filteredEdges, nodeIndex) : ({ type: "FeatureCollection" as const, features: [] })),
    [filteredEdges, nodeIndex, showFlows]
  );

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    const cached = loadCachedMapState();
    if (cached) {
      usedCachedStateRef.current = true;
    }

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: CARTO_DARK_STYLE,
      center: cached?.center ?? [0, 20],
      zoom: cached?.zoom ?? 1.2,
      pitch: 0,
      bearing: 0,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "bottom-right");

    map.on("load", () => {
      registerGwmdIcons(map);
      // Create arrow icon from canvas
      const arrowCanvas = document.createElement('canvas');
      arrowCanvas.width = 20;
      arrowCanvas.height = 20;
      const ctx = arrowCanvas.getContext('2d');
      if (ctx) {
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
      const imageData = ctx?.getImageData(0, 0, 20, 20);
      if (imageData) {
        map.addImage('arrow', {
          width: 20,
          height: 20,
          data: new Uint8Array(imageData.data.buffer),
        });
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
          "line-opacity": ["coalesce", ["get", "confidence"], 0.6],
          "line-dasharray": [1.5, 1.5],
        },
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
        minzoom: 0,
        layout: {
          "symbol-placement": "point",
          "icon-image": "arrow",
          "icon-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            0, 0.4,
            2, 0.6,
            4, 0.8,
            6, 1.0
          ],
          "icon-rotate": ["get", "bearing"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": false,
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
          "icon-opacity": 0.9,
        },
      });

      map.addLayer({
        id: "gwmd-edge-arrows-selected-upstream",
        type: "symbol",
        source: "gwmd-edge-arrows",
        minzoom: 0,
        layout: {
          "symbol-placement": "point",
          "icon-image": "arrow",
          "icon-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            0, 0.5,
            2, 0.7,
            4, 0.9,
            6, 1.1
          ],
          "icon-rotate": ["get", "bearing"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": false,
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
        minzoom: 0,
        layout: {
          "symbol-placement": "point",
          "icon-image": "arrow",
          "icon-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            0, 0.5,
            2, 0.7,
            4, 0.9,
            6, 1.1
          ],
          "icon-rotate": ["get", "bearing"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": false,
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
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, 14, 2, 18, 4, 22],
          "circle-blur": 0.6,
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

      map.on("click", "gwmd-nodes", (event) => {
        const feature = event.features?.[0];
        const id = feature?.properties?.id;
        const label = feature?.properties?.label;
        gwmdDebugLog('[GWMD] Node clicked:', { id, label, feature });
        if (typeof id === "string") {
          onSelectNodeRef.current(id);
        }
      });

      map.on("click", "gwmd-clusters", (event) => {
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
          map.easeTo({ center: coordinates, zoom: zoomLevel });
        });
      });

      map.on("click", "gwmd-edges", (event) => {
        const id = event.features?.[0]?.properties?.id;
        const kind = event.features?.[0]?.properties?.kind;
        gwmdDebugLog('[GWMD] Edge clicked:', { id, kind, feature: event.features?.[0] });
        if (typeof id === "string") {
          onSelectEdgeRef.current(id);
        }
      });


      map.on("mouseenter", "gwmd-nodes", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "gwmd-nodes", () => {
        map.getCanvas().style.cursor = "";
      });
      map.on("mouseenter", "gwmd-clusters", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "gwmd-clusters", () => {
        map.getCanvas().style.cursor = "";
      });
      map.on("mouseenter", "gwmd-edges", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "gwmd-edges", () => {
        map.getCanvas().style.cursor = "";
      });

      map.on("zoom", () => {
        if (zoomRafRef.current !== null) return;
        zoomRafRef.current = window.requestAnimationFrame(() => {
          zoomRafRef.current = null;
          setZoom(map.getZoom());
        });
      });


      map.on("movestart", () => {
        isInteractingRef.current = true;
        setFlowVisibility(map, false);
      });

      map.on("moveend", () => {
        isInteractingRef.current = false;
        setFlowVisibility(map, showFlowsRef.current);
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
        setMapError(message);
      });

      setMapReady(true);
    });

    mapRef.current = map;

    const observer = new ResizeObserver(() => {
      map.resize();
    });
    observer.observe(mapContainer.current);

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

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
        sampleCoordKey = `${Math.round(coords[0])}|${Math.round(coords[1])}`;
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
          touchAction: "none",
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

      {(geoStats.located === 0 || geoStats.unlocated > 0) && (
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
            maxWidth: 320,
            lineHeight: 1.4,
            backdropFilter: "blur(8px)",
          }}
        >
          {geoStats.located === 0
            ? "No nodes have valid coordinates yet. Unlocated entities are listed in the panel."
            : `${geoStats.unlocated} unlocated node${geoStats.unlocated !== 1 ? "s" : ""} hidden for accuracy.`}
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
            backdropFilter: "blur(12px)",
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
          Located: {geoStats.located} • Unlocated: {geoStats.unlocated}
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
    prevProps.selectedNodeId === nextProps.selectedNodeId &&
    prevProps.selectedEdgeId === nextProps.selectedEdgeId &&
    prevProps.filters.region === nextProps.filters.region &&
    prevProps.filters.relation === nextProps.filters.relation &&
    prevProps.filters.showFlows === nextProps.filters.showFlows &&
    prevProps.filters.showOnlyImpacted === nextProps.filters.showOnlyImpacted &&
    prevProps.simulation.failedNodeIds.length === nextProps.simulation.failedNodeIds.length &&
    prevProps.simulation.failedEdgeIds.length === nextProps.simulation.failedEdgeIds.length &&
    prevProps.graph.nodes.length === nextProps.graph.nodes.length &&
    prevProps.graph.edges.length === nextProps.graph.edges.length
  );
});

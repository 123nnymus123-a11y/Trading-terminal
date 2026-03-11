import React, { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { OilTanker } from "@tc/shared";
import { fetchOilTankers, subscribeToTankerUpdates } from "../services/maritimeData";
import "../styles/map.css";

interface SelectedTanker {
  data: OilTanker;
  pixelX: number;
  pixelY: number;
}

export default function OilTankerMap() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [tankers, setTankers] = useState<OilTanker[]>([]);
  const [selectedTanker, setSelectedTanker] = useState<SelectedTanker | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [filter, setFilter] = useState({
    search: "",
    status: "all",
    minSpeed: 0,
  });

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: "https://demotiles.maplibre.org/style.json",
      center: [0, 20],
      zoom: 2,
      pitch: 0,
      bearing: 0,
    });

    map.current.on("load", () => {
      // Add tanker layer
      map.current?.addSource("tankers", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        },
      });

      map.current?.addLayer({
        id: "tanker-points",
        type: "symbol",
        source: "tankers",
        layout: {
          "icon-image": "marker-15",
          "icon-size": 2,
          "icon-allow-overlap": true,
          "text-field": ["get", "name"],
          "text-font": ["Open Sans Regular"],
          "text-size": 10,
          "text-offset": [0, 1.5],
          "text-anchor": "top",
        },
        paint: {
          "text-color": "#fff",
          "text-halo-color": "#333",
          "text-halo-width": 1,
        },
      });

      setLoading(false);
    });

    return () => {
      map.current?.remove();
    };
  }, []);

  // Fetch and update tanker data
  useEffect(() => {
    console.log("🔄 Initializing tanker data subscription...");
    const unsubscribe = subscribeToTankerUpdates((newTankers) => {
      console.log(`📡 Received ${newTankers.length} tankers from subscription`);
      setTankers(newTankers);
    }, 5000);

    // Initial fetch
    fetchOilTankers().then((tankerData) => {
      console.log(`🎯 Initial fetch: ${tankerData.length} tankers`);
      setTankers(tankerData);
    });

    return unsubscribe;
  }, []);

  // Update map with tanker data
  useEffect(() => {
    if (!map.current || !map.current.getSource("tankers")) return;

    // Clear existing markers
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    const filteredTankers = tankers.filter((t) => {
      if (filter.search && !t.name.toLowerCase().includes(filter.search.toLowerCase())) {
        return false;
      }
      if (filter.status !== "all" && t.status !== filter.status) {
        return false;
      }
      if (t.speed < filter.minSpeed) {
        return false;
      }
      return true;
    });

    const features = filteredTankers.map((tanker) => ({
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [tanker.longitude, tanker.latitude],
      },
      properties: {
        id: tanker.mmsi,
        name: tanker.name,
        speed: tanker.speed.toFixed(1),
        heading: tanker.heading,
        status: tanker.status,
        destination: tanker.destination || "N/A",
        cargoType: tanker.cargoType || "Unknown",
        shipType: tanker.shipType,
      },
    }));

    (map.current.getSource("tankers") as maplibregl.GeoJSONSource).setData({
      type: "FeatureCollection",
      features,
    });

    // Rotate markers based on heading
    features.forEach((feature) => {
      if (feature.geometry.type === "Point") {
        const markerEl = document.createElement("div");
        markerEl.className = "tanker-marker";
        markerEl.innerHTML = `<svg width="32" height="32" viewBox="0 0 32 32" style="transform: rotate(${feature.properties.heading}deg);">
          <path d="M16 2 L22 30 L16 26 L10 30 Z" fill="#FF6B6B" stroke="#fff" stroke-width="1"/>
          <circle cx="16" cy="16" r="3" fill="#fff"/>
        </svg>`;
        markerEl.style.cursor = "pointer";
        markerEl.onclick = () => {
          const tanker = tankers.find((t) => t.mmsi === feature.properties.id);
          if (tanker) {
            const coords = map.current!.project([tanker.longitude, tanker.latitude]);
            setSelectedTanker({
              data: tanker,
              pixelX: coords.x,
              pixelY: coords.y,
            });
          }
        };

        const marker = new maplibregl.Marker(markerEl)
          .setLngLat([
            feature.geometry.coordinates[0] as number,
            feature.geometry.coordinates[1] as number,
          ])
          .addTo(map.current!);

        markersRef.current.push(marker);
      }
    });
  }, [tankers, filter]);

  const statusOptions = ["all", ...new Set(tankers.map((t) => t.status))];

  return (
    <div className="map-container">
      <div className="map-header">
        <h1>🚢 Global Oil Tanker Tracker</h1>
        <div className="map-stats">
          <span>Total Tankers: {tankers.length}</span>
          <span>Underway: {tankers.filter((t) => t.status === "underway").length}</span>
          <span>Anchored: {tankers.filter((t) => t.status === "anchored").length}</span>
        </div>
      </div>

      <div className="map-controls">
        <div className="control-group">
          <label>Search</label>
          <input
            type="text"
            placeholder="Search vessel name..."
            value={filter.search}
            onChange={(e) => setFilter({ ...filter, search: e.target.value })}
          />
        </div>

        <div className="control-group">
          <label>Status</label>
          <select
            value={filter.status}
            onChange={(e) => setFilter({ ...filter, status: e.target.value })}
          >
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>

        <div className="control-group">
          <label>Min Speed (knots)</label>
          <input
            type="number"
            min="0"
            value={filter.minSpeed}
            onChange={(e) =>
              setFilter({ ...filter, minSpeed: parseFloat(e.target.value) || 0 })
            }
          />
        </div>
      </div>

      <div
        ref={mapContainer}
        className="map-canvas"
        style={{ width: "100%", height: "600px" }}
      >
        {loading && <div className="loading-spinner">Loading map...</div>}
      </div>

      {selectedTanker && (
        <div className="tanker-popup">
          <button className="close-btn" onClick={() => setSelectedTanker(null)}>
            ✕
          </button>
          <h3>{selectedTanker.data.name}</h3>
          <div className="popup-content">
            <div className="info-row">
              <span className="label">MMSI:</span>
              <span>{selectedTanker.data.mmsi}</span>
            </div>
            <div className="info-row">
              <span className="label">Status:</span>
              <span className="badge">{selectedTanker.data.status}</span>
            </div>
            <div className="info-row">
              <span className="label">Speed:</span>
              <span>{selectedTanker.data.speed.toFixed(1)} knots</span>
            </div>
            <div className="info-row">
              <span className="label">Heading:</span>
              <span>{selectedTanker.data.heading}°</span>
            </div>
            <div className="info-row">
              <span className="label">Cargo Type:</span>
              <span>{selectedTanker.data.cargoType || "Unknown"}</span>
            </div>
            <div className="info-row">
              <span className="label">Cargo Tonnage:</span>
              <span>{selectedTanker.data.cargoTonnage?.toLocaleString()} t</span>
            </div>
            <div className="info-row">
              <span className="label">Destination:</span>
              <span>{selectedTanker.data.destination || "N/A"}</span>
            </div>
            <div className="info-row">
              <span className="label">Dimensions:</span>
              <span>
                {selectedTanker.data.length}m × {selectedTanker.data.beam}m
              </span>
            </div>
            <div className="info-row">
              <span className="label">Position:</span>
              <span>
                {selectedTanker.data.latitude.toFixed(4)}, {selectedTanker.data.longitude.toFixed(4)}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="legend">
        <h4>Legend</h4>
        <div className="legend-item">
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path d="M8 1 L11 15 L8 13 L5 15 Z" fill="#FF6B6B" />
          </svg>
          <span>Oil Tanker</span>
        </div>
      </div>
    </div>
  );
}

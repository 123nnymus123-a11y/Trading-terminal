import React, { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { CargoFlight } from "@tc/shared";
import { fetchCargoFlights, subscribeToFlightUpdates } from "../services/maritimeData";
import "../styles/map.css";

interface SelectedFlight {
  data: CargoFlight;
  pixelX: number;
  pixelY: number;
}

export default function CargoFlightsMap() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [flights, setFlights] = useState<CargoFlight[]>([]);
  const [selectedFlight, setSelectedFlight] = useState<SelectedFlight | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({
    search: "",
    status: "all",
    minAltitude: 0,
  });
  const markersRef = useRef<maplibregl.Marker[]>([]);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: "https://demotiles.maplibre.org/style.json",
      center: [0, 20],
      zoom: 3,
      pitch: 15,
      bearing: 0,
    });

    map.current.on("load", () => {
      // Add flight paths layer
      map.current?.addSource("flight-paths", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        },
      });

      map.current?.addLayer({
        id: "flight-paths-line",
        type: "line",
        source: "flight-paths",
        paint: {
          "line-color": "#4CAF50",
          "line-width": 2,
          "line-opacity": 0.7,
          "line-dasharray": [5, 5],
        },
      });

      setLoading(false);
    });

    return () => {
      map.current?.remove();
    };
  }, []);

  // Fetch and update flight data
  useEffect(() => {
    console.log("🔄 Initializing flight data subscription...");
    const unsubscribe = subscribeToFlightUpdates((newFlights) => {
      console.log(`📡 Received ${newFlights.length} flights from subscription`);
      setFlights(newFlights);
    }, 3000);

    // Initial fetch
    fetchCargoFlights().then((flightData) => {
      console.log(`🎯 Initial fetch: ${flightData.length} flights`);
      setFlights(flightData);
    });

    return unsubscribe;
  }, []);

  // Update map with flight data
  useEffect(() => {
    if (!map.current || !map.current.getSource("flight-paths")) return;

    // Clear existing markers
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    const filteredFlights = flights.filter((f) => {
      if (
        filter.search &&
        !f.callSign.toLowerCase().includes(filter.search.toLowerCase()) &&
        !f.airline?.toLowerCase().includes(filter.search.toLowerCase())
      ) {
        return false;
      }
      if (filter.status !== "all" && f.status !== filter.status) {
        return false;
      }
      if (f.altitude < filter.minAltitude) {
        return false;
      }
      return true;
    });

    // Create GeoJSON features for flight paths
    const pathFeatures = filteredFlights.map((flight) => ({
      type: "Feature" as const,
      geometry: {
        type: "LineString" as const,
        coordinates: [
          [flight.longitude - flight.speed / 100, flight.latitude - flight.speed / 100],
          [flight.longitude, flight.latitude],
        ],
      },
      properties: {
        icao24: flight.icao24,
        callSign: flight.callSign,
      },
    }));

    (map.current.getSource("flight-paths") as maplibregl.GeoJSONSource).setData({
      type: "FeatureCollection",
      features: pathFeatures,
    });

    // Add flight markers
    filteredFlights.forEach((flight) => {
      const statusColor = {
        climbing: "#4CAF50",
        cruise: "#2196F3",
        descending: "#FF9800",
        ground: "#9E9E9E",
        unknown: "#BDBDBD",
      }[flight.status] || "#BDBDBD";

      const markerEl = document.createElement("div");
      markerEl.className = "flight-marker";
      markerEl.innerHTML = `
        <div class="flight-marker-container" style="transform: rotate(${flight.heading}deg)">
          <svg width="28" height="28" viewBox="0 0 28 28">
            <path d="M14 2 L18 15 L14 12 L10 15 Z" fill="${statusColor}" stroke="#fff" stroke-width="1.5"/>
            <circle cx="14" cy="16" r="2.5" fill="#fff"/>
          </svg>
        </div>
        <div class="flight-label">${flight.callSign}</div>
        <div class="flight-altitude">${Math.round(flight.altitude / 100) * 100} ft</div>
      `;
      markerEl.style.cursor = "pointer";
      markerEl.onclick = () => {
        const flight_data = flights.find((f) => f.icao24 === flight.icao24);
        if (flight_data) {
          const coords = map.current!.project([flight_data.longitude, flight_data.latitude]);
          setSelectedFlight({
            data: flight_data,
            pixelX: coords.x,
            pixelY: coords.y,
          });
        }
      };

      const marker = new maplibregl.Marker(markerEl)
        .setLngLat([flight.longitude, flight.latitude])
        .addTo(map.current!);

      markersRef.current.push(marker);
    });
  }, [flights, filter]);

  const statusOptions = ["all", ...new Set(flights.map((f) => f.status))];

  return (
    <div className="map-container">
      <div className="map-header">
        <h1>✈️ Global Cargo Flight Tracker</h1>
        <div className="map-stats">
          <span>Active Flights: {flights.length}</span>
          <span>Climbing: {flights.filter((f) => f.status === "climbing").length}</span>
          <span>Cruising: {flights.filter((f) => f.status === "cruise").length}</span>
          <span>Descending: {flights.filter((f) => f.status === "descending").length}</span>
        </div>
      </div>

      <div className="map-controls">
        <div className="control-group">
          <label>Search</label>
          <input
            type="text"
            placeholder="Search callsign or airline..."
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
          <label>Min Altitude (ft)</label>
          <input
            type="number"
            min="0"
            step="1000"
            value={filter.minAltitude}
            onChange={(e) =>
              setFilter({ ...filter, minAltitude: parseFloat(e.target.value) || 0 })
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

      {selectedFlight && (
        <div className="flight-popup">
          <button className="close-btn" onClick={() => setSelectedFlight(null)}>
            ✕
          </button>
          <h3>{selectedFlight.data.callSign}</h3>
          <div className="popup-content">
            <div className="info-row">
              <span className="label">Aircraft:</span>
              <span>
                {selectedFlight.data.manufacturer} {selectedFlight.data.model}
              </span>
            </div>
            <div className="info-row">
              <span className="label">Registration:</span>
              <span>{selectedFlight.data.registration || "Unknown"}</span>
            </div>
            <div className="info-row">
              <span className="label">Airline:</span>
              <span>{selectedFlight.data.airline || "Unknown"}</span>
            </div>
            <div className="info-row">
              <span className="label">Status:</span>
              <span className="badge">{selectedFlight.data.status}</span>
            </div>
            <div className="info-row">
              <span className="label">Altitude:</span>
              <span>{selectedFlight.data.altitude.toLocaleString()} ft</span>
            </div>
            <div className="info-row">
              <span className="label">Speed:</span>
              <span>{selectedFlight.data.speed} knots</span>
            </div>
            <div className="info-row">
              <span className="label">Heading:</span>
              <span>{selectedFlight.data.heading}°</span>
            </div>
            <div className="info-row">
              <span className="label">Vertical Rate:</span>
              <span>
                {selectedFlight.data.verticalRate ? `${selectedFlight.data.verticalRate} ft/min` : "—"}
              </span>
            </div>
            <div className="info-row">
              <span className="label">Origin → Destination:</span>
              <span>
                {selectedFlight.data.origin || "—"} → {selectedFlight.data.destination || "—"}
              </span>
            </div>
            <div className="info-row">
              <span className="label">Cargo Type:</span>
              <span>{selectedFlight.data.cargoType || "Unknown"}</span>
            </div>
            <div className="info-row">
              <span className="label">Position:</span>
              <span>
                {selectedFlight.data.latitude.toFixed(4)}, {selectedFlight.data.longitude.toFixed(4)}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="legend">
        <h4>Legend</h4>
        <div className="legend-item">
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path d="M8 2 L11 11 L8 9 L5 11 Z" fill="#4CAF50" />
          </svg>
          <span>Climbing</span>
        </div>
        <div className="legend-item">
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path d="M8 2 L11 11 L8 9 L5 11 Z" fill="#2196F3" />
          </svg>
          <span>Cruise</span>
        </div>
        <div className="legend-item">
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path d="M8 2 L11 11 L8 9 L5 11 Z" fill="#FF9800" />
          </svg>
          <span>Descending</span>
        </div>
      </div>
    </div>
  );
}

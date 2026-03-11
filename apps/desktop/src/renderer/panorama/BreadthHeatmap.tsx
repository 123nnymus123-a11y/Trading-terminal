/**
 * Breadth Heatmap Component
 * ETF/sector proxy with clear labeling
 */

import React from "react";
import type { BreadthData } from "./types";

interface BreadthHeatmapProps {
  data: BreadthData;
}

export function BreadthHeatmap({ data }: BreadthHeatmapProps): React.ReactElement {
  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 8,
        padding: 12,
        background: "rgba(0,0,0,0.3)",
        marginBottom: 16,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>📊 Breadth Heatmap</h3>
        <div
          style={{
            fontSize: 10,
            opacity: 0.6,
            padding: "2px 6px",
            background: "rgba(100,150,200,0.2)",
            borderRadius: 3,
          }}
        >
          {data.source === "etf-proxy"
            ? "ETF Proxy"
            : data.source === "sector-proxy"
              ? "Sector Proxy"
              : "Simulated"}
        </div>
      </div>

      {/* Note */}
      <div style={{ fontSize: 11, opacity: 0.65, marginBottom: 10 }}>
        {data.note}
      </div>

      {/* Grid of components */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(60px, 1fr))",
          gap: 8,
        }}
      >
        {data.components.map((comp) => {
          // Strength: -1 (red) to +1 (green)
          const hue = ((comp.strength + 1) / 2) * 120; // 0-120 (red to green)
          const saturation = Math.abs(comp.strength) * 80 + 20;
          const lightness = 50 - Math.abs(comp.strength) * 20;
          const bgColor = `hsl(${hue}, ${saturation}%, ${lightness}%)`;

          return (
            <div
              key={comp.name}
              style={{
                padding: 8,
                borderRadius: 4,
                background: bgColor,
                textAlign: "center",
                fontSize: 11,
                fontWeight: 600,
                opacity: 0.9,
                transition: "all 0.3s ease",
              }}
              title={`Strength: ${(comp.strength * 100).toFixed(0)}%`}
            >
              <div>{comp.label}</div>
              <div style={{ fontSize: 10, opacity: 0.8 }}>
                {comp.strength > 0 ? "↑" : comp.strength < 0 ? "↓" : "→"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

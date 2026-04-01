/**
 * Regime Label Component
 * Trend/Chop + High/Low Vol quadrant from compute engine
 */

import React from "react";
import type { RegimeLabel } from "./types";

interface RegimeLabelProps {
  regime: RegimeLabel;
}

export function RegimeLabelComponent({ regime }: RegimeLabelProps): React.ReactElement {
  const isTrending = regime.trend.includes("trending");
  const isUp = regime.trend === "trending-up";
  const isHighVol = regime.vol === "high-vol";

  // Quadrant coloring
  let quadrantColor = "#666";
  let quadrantLabel = "";

  if (isTrending && isUp && !isHighVol) {
    quadrantColor = "#4ade80";
    quadrantLabel = "Trending Up, Low Vol";
  } else if (isTrending && isUp && isHighVol) {
    quadrantColor = "#fbbf24";
    quadrantLabel = "Trending Up, High Vol";
  } else if (isTrending && !isUp && !isHighVol) {
    quadrantColor = "#60a5fa";
    quadrantLabel = "Trending Down, Low Vol";
  } else if (isTrending && !isUp && isHighVol) {
    quadrantColor = "#ef4444";
    quadrantLabel = "Trending Down, High Vol";
  } else if (!isTrending && !isHighVol) {
    quadrantColor = "#a78bfa";
    quadrantLabel = "Choppy, Low Vol";
  } else {
    quadrantColor = "#ec4899";
    quadrantLabel = "Choppy, High Vol";
  }

  const confidencePercent = Math.round(regime.confidence * 100);

  return (
    <div
      style={{
        border: `2px solid ${quadrantColor}`,
        borderRadius: 8,
        padding: 14,
        background: `${quadrantColor}20`,
        marginBottom: 16,
      }}
    >
      {/* Main label */}
      <div
        style={{
          fontSize: 16,
          fontWeight: 700,
          color: quadrantColor,
          marginBottom: 6,
        }}
      >
        {quadrantLabel}
      </div>

      {/* Confidence */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <div
          style={{
            flex: 1,
            height: 6,
            background: "rgba(255,255,255,0.1)",
            borderRadius: 3,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${confidencePercent}%`,
              background: quadrantColor,
              transition: "width 0.3s ease",
            }}
          />
        </div>
        <div style={{ fontSize: 12, opacity: 0.8, minWidth: 35 }}>{confidencePercent}%</div>
      </div>

      {/* Source */}
      <div style={{ fontSize: 10, opacity: 0.6 }}>
        Source: {regime.source === "compute" ? "🔄 Compute Engine" : "⚪ Simulated"}
      </div>
    </div>
  );
}

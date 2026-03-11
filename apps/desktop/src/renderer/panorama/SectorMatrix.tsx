/**
 * Sector Relative Strength Matrix Component
 * Proxy-based sector momentum visualization
 */

import React from "react";
import type { SectorMatrix } from "./types";

interface SectorMatrixProps {
  data: SectorMatrix;
}

export function SectorMatrixComponent({ data }: SectorMatrixProps): React.ReactElement {
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
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>📈 Sector Relative Strength</h3>
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
            : data.source === "factor-proxy"
              ? "Factor-based"
              : "Simulated"}
        </div>
      </div>

      {/* Note */}
      <div style={{ fontSize: 11, opacity: 0.65, marginBottom: 10 }}>
        {data.note}
      </div>

      {/* Sectors as bars */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {data.sectors.map((sector) => {
          // Relative strength: -1 to +1
          const pct = ((sector.relativeStrength + 1) / 2) * 100;
          const color = sector.relativeStrength > 0 ? "#4ade80" : "#ef4444";

          return (
            <div key={sector.name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {/* Label */}
              <div style={{ minWidth: 90, fontSize: 12, fontWeight: 500 }}>{sector.label}</div>

              {/* Bar background */}
              <div
                style={{
                  flex: 1,
                  height: 24,
                  background: "rgba(100,100,100,0.2)",
                  borderRadius: 3,
                  overflow: "hidden",
                  position: "relative",
                }}
              >
                {/* Fill bar */}
                <div
                  style={{
                    height: "100%",
                    width: `${pct}%`,
                    background: color,
                    opacity: 0.7,
                    transition: "width 0.3s ease",
                  }}
                />

                {/* Center line (50%) */}
                <div
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: 0,
                    height: "100%",
                    width: 1,
                    background: "rgba(255,255,255,0.1)",
                  }}
                />
              </div>

              {/* Value label */}
              <div style={{ minWidth: 50, textAlign: "right", fontSize: 12 }}>
                {sector.relativeStrength > 0 ? "+" : ""}
                {(sector.relativeStrength * 100).toFixed(0)}%
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

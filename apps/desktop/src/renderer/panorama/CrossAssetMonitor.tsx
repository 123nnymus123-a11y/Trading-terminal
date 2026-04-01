/**
 * Cross-Asset Monitor Component
 * 10Y yield, DXY, VIX, crude with graceful degradation
 */

import React from "react";
import type { CrossAssetMonitor } from "./types";

interface CrossAssetMonitorProps {
  data: CrossAssetMonitor;
}

interface AssetDisplayProps {
  label: string;
  value: number | null;
  unit: string;
  source: "live" | "delayed" | "stub";
  prior?: number;
}

function AssetDisplay({ label, value, unit, source, prior }: AssetDisplayProps): React.ReactElement {
  const isNull = value === null || value === undefined;
  const sourceLabel =
    source === "live" ? "🔴 Live" : source === "delayed" ? "🟡 Delayed" : "⚪ Stub";
  const change =
    prior !== undefined && value !== null && !isNull
      ? ((value - prior) / prior) * 100
      : null;
  const changeColor = change === null ? "inherit" : change >= 0 ? "#4ade80" : "#ef4444";

  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 6,
        padding: 10,
        background: "rgba(0,0,0,0.4)",
        minWidth: 140,
      }}
    >
      <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
        {isNull ? "—" : `${value!.toFixed(2)} ${unit}`}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, opacity: 0.7 }}>
        <span>{sourceLabel}</span>
        {change !== null && (
          <span style={{ color: changeColor }}>
            {change >= 0 ? "+" : ""}
            {change.toFixed(2)}%
          </span>
        )}
      </div>
    </div>
  );
}

export function CrossAssetMonitorComponent({
  data,
}: CrossAssetMonitorProps): React.ReactElement {
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
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>🌍 Cross-Asset Monitor</h3>
        <div
          style={{
            fontSize: 10,
            opacity: 0.6,
            padding: "2px 6px",
            background: "rgba(100,150,200,0.2)",
            borderRadius: 3,
          }}
        >
          {data.sources.yield10Y === "stub" &&
          data.sources.dxy === "stub" &&
          data.sources.vix === "stub" &&
          data.sources.crude === "stub"
            ? "Demo Data"
            : "Mixed Sources"}
        </div>
      </div>

      {/* Asset Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 10,
          marginBottom: 10,
        }}
      >
        <AssetDisplay
          label="10Y Yield"
          value={data.yield10Y}
          unit="%"
          source={data.sources.yield10Y}
        />
        <AssetDisplay
          label="US Dollar Index"
          value={data.dxy}
          unit=""
          source={data.sources.dxy}
        />
        <AssetDisplay
          label="VIX Index"
          value={data.vix}
          unit=""
          source={data.sources.vix}
        />
        <AssetDisplay
          label="Crude Oil"
          value={data.crude}
          unit="$/bbl"
          source={data.sources.crude}
        />
      </div>

      {/* Failed queries notice */}
      {data.failedQueries.length > 0 && (
        <div
          style={{
            fontSize: 11,
            opacity: 0.6,
            padding: 8,
            background: "rgba(239,68,68,0.1)",
            borderRadius: 4,
            borderLeft: "2px solid #ef4444",
          }}
        >
          ⚠️ Failed: {data.failedQueries.join(", ")}
        </div>
      )}
    </div>
  );
}

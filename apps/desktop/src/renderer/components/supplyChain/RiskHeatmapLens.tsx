import React, { useMemo } from "react";
import type { RiskLensCell, SupplyChainRiskType } from "@tc/shared/supplyChain";

interface Props {
  riskLens: RiskLensCell[];
  onSelectCell: (affectedNodes: string[]) => void;
}

const RISK_TYPES: SupplyChainRiskType[] = [
  "geopolitical",
  "regulatory",
  "capacity",
  "single-supplier",
  "logistics",
  "financial",
  "cyber",
  "other",
];

const COLORS = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#22c55e",
};

export default function RiskHeatmapLens({ riskLens, onSelectCell }: Props) {
  const categories = useMemo(() => Array.from(new Set(riskLens.map((cell) => cell.category))), [riskLens]);

  const lookup = useMemo(() => {
    const map = new Map<string, RiskLensCell>();
    for (const cell of riskLens) {
      map.set(`${cell.category}:${cell.riskType}`, cell);
    }
    return map;
  }, [riskLens]);

  if (riskLens.length === 0) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#94a3b8" }}>
        No risk data available yet
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: 24, gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Risk Heatmap Overlay</h3>
        <span style={{ fontSize: 12, color: "#94a3b8" }}>Click a cell to highlight impacted nodes</span>
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={headerCellStyle}>Category</th>
              {RISK_TYPES.map((type) => (
                <th key={type} style={headerCellStyle}>{type}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => (
              <tr key={category}>
                <td style={{ ...bodyCellStyle, fontWeight: 600 }}>{category}</td>
                {RISK_TYPES.map((type) => {
                  const cell = lookup.get(`${category}:${type}`);
                  if (!cell) {
                    return <td key={type} style={bodyCellStyle}>-</td>;
                  }
                  return (
                    <td
                      key={type}
                      style={{
                        ...bodyCellStyle,
                        cursor: "pointer",
                        background: `${COLORS[cell.severity]}33`,
                        color: COLORS[cell.severity],
                        fontSize: 12,
                      }}
                      onClick={() => onSelectCell(cell.affectedNodes)}
                    >
                      {cell.severity.toUpperCase()} ({cell.affectedNodes.length})
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const headerCellStyle: React.CSSProperties = {
  padding: "8px 12px",
  textTransform: "uppercase",
  fontSize: 11,
  color: "#94a3b8",
  borderBottom: "1px solid rgba(148,163,184,0.2)",
  position: "sticky",
  top: 0,
  background: "rgba(10,14,26,0.95)",
};

const bodyCellStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid rgba(148,163,184,0.08)",
  textAlign: "center",
};

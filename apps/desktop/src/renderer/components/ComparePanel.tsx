/**
 * Strategy Compare Panel Component
 * Compare multiple backtest runs side-by-side
 */

import React, { useState } from "react";

export type CompareRun = {
  runId: string;
  name: string;
  sharpe: number;
  return: number;
  maxDD: number;
  winRate: number;
  trades: number;
};

export type ComparePanelProps = {
  availableRuns: CompareRun[];
  selectedRunIds: string[];
  onToggleRun: (runId: string) => void;
  onCompare?: () => void;
  comparisonResult?: {
    winner?: string;
    metrics: Array<{
      metric: string;
      "run-1": string;
      "run-2": string;
      "run-3"?: string;
    }>;
  };
};

export function ComparePanel({
  availableRuns,
  selectedRunIds,
  onToggleRun,
  onCompare,
  comparisonResult,
}: ComparePanelProps) {
  const [sortMetric, setSortMetric] = useState<"sharpe" | "return" | "maxDD">("sharpe");

  const sorted = [...availableRuns].sort((a, b) => {
    switch (sortMetric) {
      case "sharpe":
        return b.sharpe - a.sharpe;
      case "return":
        return b.return - a.return;
      case "maxDD":
        return a.maxDD - b.maxDD;
      default:
        return 0;
    }
  });

  const selectedRuns = sorted.filter((r) => selectedRunIds.includes(r.runId));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <h3
            style={{
              margin: 0,
              fontSize: 14,
              fontWeight: 600,
              color: "#ccc",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Compare Runs
          </h3>
          <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>
            Select {selectedRunIds.length} / max 3 runs
          </div>
        </div>
        {onCompare && (
          <button
            onClick={onCompare}
            disabled={selectedRunIds.length < 2}
            style={{
              padding: "6px 12px",
              background: selectedRunIds.length >= 2 ? "#6ea8fe" : "#4b5563",
              color: "white",
              border: "none",
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 600,
              cursor: selectedRunIds.length >= 2 ? "pointer" : "default",
              opacity: selectedRunIds.length >= 2 ? 1 : 0.6,
            }}
          >
            Compare
          </button>
        )}
      </div>

      {/* Sort Control */}
      <select
        value={sortMetric}
        onChange={(e) => setSortMetric(e.target.value as any)}
        style={{
          padding: "6px 8px",
          background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 4,
          color: "white",
          fontSize: 12,
        }}
      >
        <option value="sharpe">Sort by Sharpe</option>
        <option value="return">Sort by Return</option>
        <option value="maxDD">Sort by Max DD (best)</option>
      </select>

      {/* Run Selection List */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          maxHeight: 300,
          overflow: "auto",
        }}
      >
        {sorted.map((run) => (
          <button
            key={run.runId}
            onClick={() => onToggleRun(run.runId)}
            disabled={selectedRunIds.length >= 3 && !selectedRunIds.includes(run.runId)}
            style={{
              padding: 10,
              background: selectedRunIds.includes(run.runId)
                ? "rgba(110, 168, 254, 0.2)"
                : "rgba(255,255,255,0.05)",
              border: selectedRunIds.includes(run.runId)
                ? "2px solid #6ea8fe"
                : "1px solid rgba(255,255,255,0.1)",
              borderRadius: 4,
              color: "white",
              textAlign: "left",
              fontSize: 12,
              cursor:
                selectedRunIds.length >= 3 && !selectedRunIds.includes(run.runId)
                  ? "not-allowed"
                  : "pointer",
              opacity:
                selectedRunIds.length >= 3 && !selectedRunIds.includes(run.runId)
                  ? 0.5
                  : 1,
              transition: "all 0.2s ease",
            }}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div
                style={{
                  width: 16,
                  height: 16,
                  border: "2px solid rgba(255,255,255,0.3)",
                  borderRadius: 3,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: selectedRunIds.includes(run.runId)
                    ? "#6ea8fe"
                    : "transparent",
                }}
              >
                {selectedRunIds.includes(run.runId) && <span style={{ fontSize: 10 }}>✓</span>}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, marginBottom: 2 }}>{run.name}</div>
                <div style={{ fontSize: 11, color: "#888" }}>
                  {run.trades} trades • Sharpe: {run.sharpe.toFixed(2)}
                </div>
              </div>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 6,
                marginTop: 8,
                fontSize: 10,
              }}
            >
              <div>
                <span style={{ color: "#888" }}>Return</span>
                <div
                  style={{
                    color: run.return >= 0 ? "#10b981" : "#ef4444",
                    fontWeight: 600,
                  }}
                >
                  {(run.return * 100).toFixed(1)}%
                </div>
              </div>
              <div>
                <span style={{ color: "#888" }}>DD</span>
                <div style={{ color: "#ef4444", fontWeight: 600 }}>
                  {(run.maxDD * 100).toFixed(1)}%
                </div>
              </div>
              <div>
                <span style={{ color: "#888" }}>Win Rate</span>
                <div style={{ color: "#ccc", fontWeight: 600 }}>
                  {(run.winRate * 100).toFixed(0)}%
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Comparison Result */}
      {comparisonResult && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {comparisonResult.winner && (
            <div
              style={{
                padding: 12,
                background: "rgba(16, 185, 129, 0.1)",
                border: "1px solid rgba(16, 185, 129, 0.3)",
                borderRadius: 4,
                color: "#10b981",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              🏆 Winner: {comparisonResult.winner}
            </div>
          )}

          {comparisonResult.metrics && (
            <div
              style={{
                padding: 12,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 4,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10, color: "#ccc" }}>
                Metrics Comparison
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 11 }}>
                {comparisonResult.metrics.map((row) => (
                  <div key={row.metric} style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: 12 }}>
                    <span style={{ color: "#888" }}>{row.metric}</span>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: selectedRunIds.length === 2 ? "1fr 1fr" : "1fr 1fr 1fr",
                        gap: 8,
                      }}
                    >
                      <span style={{ color: "#ccc" }}>{row["run-1"]}</span>
                      <span style={{ color: "#ccc" }}>{row["run-2"]}</span>
                      {row["run-3"] && <span style={{ color: "#ccc" }}>{row["run-3"]}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

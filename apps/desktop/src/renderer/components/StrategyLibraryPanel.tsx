/**
 * Strategy Library Panel Component
 * Shows list of strategies with filtering and creation
 */

import React, { useState } from "react";

export type StrategyLibraryItem = {
  id: string;
  name: string;
  mode: "paper-spec" | "minimal-runnable" | "robust-research";
  status: "draft" | "validated" | "pinned" | "archived";
  lastRun?: string;
  sharpe?: number;
  maxDD?: number;
};

export type StrategyLibraryPanelProps = {
  strategies: StrategyLibraryItem[];
  selectedId?: string;
  onSelectStrategy: (id: string) => void;
  onCreateNew: () => void;
  loading?: boolean;
};

export function StrategyLibraryPanel({
  strategies,
  selectedId,
  onSelectStrategy,
  onCreateNew,
  loading,
}: StrategyLibraryPanelProps) {
  const [searchFilter, setSearchFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [modeFilter, setModeFilter] = useState<string | null>(null);

  const filtered = strategies.filter((s) => {
    if (searchFilter && !s.name.toLowerCase().includes(searchFilter.toLowerCase())) {
      return false;
    }
    if (statusFilter && s.status !== statusFilter) {
      return false;
    }
    if (modeFilter && s.mode !== modeFilter) {
      return false;
    }
    return true;
  });

  function getModeColor(mode: string): string {
    switch (mode) {
      case "paper-spec":
        return "#8b5cf6";
      case "minimal-runnable":
        return "#06b6d4";
      case "robust-research":
        return "#10b981";
      default:
        return "#888";
    }
  }

  function getStatusIcon(status: string): string {
    switch (status) {
      case "draft":
        return "⭕";
      case "validated":
        return "✓";
      case "pinned":
        return "📌";
      case "archived":
        return "📦";
      default:
        return "-";
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Header */}
      <div style={{ display: "flex", gap: 8, flexDirection: "column" }}>
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
          Strategy Library
        </h3>
        <button
          onClick={onCreateNew}
          style={{
            padding: "8px 12px",
            background: "#6ea8fe",
            color: "white",
            border: "none",
            borderRadius: 4,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            width: "100%",
          }}
        >
          + New Strategy
        </button>
      </div>

      {/* Search & Filters */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <input
          type="text"
          placeholder="Search strategies..."
          value={searchFilter}
          onChange={(e) => setSearchFilter(e.target.value)}
          style={{
            padding: "6px 10px",
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 4,
            color: "white",
            fontSize: 12,
          }}
        />

        <div style={{ display: "flex", gap: 6 }}>
          <select
            value={modeFilter || ""}
            onChange={(e) => setModeFilter(e.target.value || null)}
            style={{
              flex: 1,
              padding: "4px 8px",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 4,
              color: "white",
              fontSize: 11,
            }}
          >
            <option value="">All Modes</option>
            <option value="paper-spec">Paper Spec</option>
            <option value="minimal-runnable">Minimal Runnable</option>
            <option value="robust-research">Robust Research</option>
          </select>

          <select
            value={statusFilter || ""}
            onChange={(e) => setStatusFilter(e.target.value || null)}
            style={{
              flex: 1,
              padding: "4px 8px",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 4,
              color: "white",
              fontSize: 11,
            }}
          >
            <option value="">All Status</option>
            <option value="draft">Draft</option>
            <option value="validated">Validated</option>
            <option value="pinned">Pinned</option>
            <option value="archived">Archived</option>
          </select>
        </div>
      </div>

      {/* Strategy List */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          maxHeight: 400,
          overflow: "auto",
        }}
      >
        {loading ? (
          <div
            style={{
              padding: 12,
              textAlign: "center",
              color: "#666",
              fontSize: 12,
            }}
          >
            Loading...
          </div>
        ) : filtered.length === 0 ? (
          <div
            style={{
              padding: 12,
              textAlign: "center",
              color: "#666",
              fontSize: 12,
            }}
          >
            No strategies found
          </div>
        ) : (
          filtered.map((strategy) => (
            <button
              key={strategy.id}
              onClick={() => onSelectStrategy(strategy.id)}
              style={{
                padding: "10px",
                background:
                  selectedId === strategy.id
                    ? "rgba(110, 168, 254, 0.15)"
                    : "rgba(255,255,255,0.05)",
                border:
                  selectedId === strategy.id
                    ? "1px solid rgba(110, 168, 254, 0.3)"
                    : "1px solid rgba(255,255,255,0.1)",
                borderRadius: 4,
                color: "white",
                textAlign: "left",
                fontSize: 12,
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
            >
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ fontSize: 14 }}>
                  {getStatusIcon(strategy.status)}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>
                    {strategy.name}
                  </div>
                  <div style={{ fontSize: 10, color: "#888" }}>
                    <span
                      style={{
                        color: getModeColor(strategy.mode),
                        marginRight: 6,
                      }}
                    >
                      {strategy.mode.replace(/-/g, " ")}
                    </span>
                    {strategy.lastRun ? (
                      <span>{new Date(strategy.lastRun).toLocaleDateString()}</span>
                    ) : (
                      <span>No runs</span>
                    )}
                  </div>
                </div>
              </div>
              {strategy.sharpe !== undefined && (
                <div
                  style={{
                    fontSize: 10,
                    color: "#888",
                    marginTop: 4,
                    paddingLeft: 20,
                  }}
                >
                  Sharpe: {strategy.sharpe.toFixed(2)} | DD:{" "}
                  {strategy.maxDD?.toFixed(1)}%
                </div>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

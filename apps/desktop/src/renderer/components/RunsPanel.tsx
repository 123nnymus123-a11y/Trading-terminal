/**
 * Strategy Runs Panel Component
 * Shows backtest run history, metrics, and run controls
 */

import React, { useState } from "react";

export type BacktestRun = {
  id: string;
  timestamp: string;
  strategyVersion: string;
  dataset: string;
  mode: "paper" | "paper-live-sync" | "live";
  status: "running" | "completed" | "failed";
  metrics: {
    totalReturn: number;
    cagr: number;
    sharpe: number;
    sortino: number;
    maxDD: number;
    winRate: number;
    profitFactor: number;
    tradingCost: number;
  };
  trades: number;
};

export type RunsPanelProps = {
  runs: BacktestRun[];
  selectedRunId?: string;
  onSelectRun: (id: string) => void;
  onRunBacktest?: () => void;
  onDownloadArtifacts?: (runId: string) => void;
  isRunning?: boolean;
  error?: string;
  pageSize?: number;
};

export function RunsPanel({
  runs,
  selectedRunId,
  onSelectRun,
  onRunBacktest,
  onDownloadArtifacts,
  isRunning,
  error,
  pageSize = 10,
}: RunsPanelProps) {
  const [sortBy, setSortBy] = useState<"date" | "sharpe" | "return">("date");
  const [filterStatus, setFilterStatus] = useState<"all" | "running" | "completed" | "failed">("all");
  const [currentPage, setCurrentPage] = useState(0);

  const filtered = runs.filter((run) => {
    if (filterStatus === "all") return true;
    return run.status === filterStatus;
  });

  const sorted = [...filtered].sort((a, b) => {
    switch (sortBy) {
      case "date":
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      case "sharpe":
        return b.metrics.sharpe - a.metrics.sharpe;
      case "return":
        return b.metrics.totalReturn - a.metrics.totalReturn;
      default:
        return 0;
    }
  });

  const paginated = sorted.slice(
    currentPage * pageSize,
    (currentPage + 1) * pageSize
  );

  const getStatusColor = (status: string): string => {
    switch (status) {
      case "running":
        return "#f59e0b";
      case "completed":
        return "#10b981";
      case "failed":
        return "#ef4444";
      default:
        return "#888";
    }
  };

  const getModeLabel = (mode: string): string => {
    switch (mode) {
      case "paper":
        return "📄 Paper";
      case "paper-live-sync":
        return "🔄 Sync";
      case "live":
        return "🔴 Live";
      default:
        return mode;
    }
  };

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
          Backtest Runs
        </h3>
        {onRunBacktest && (
          <button
            onClick={onRunBacktest}
            disabled={isRunning}
            style={{
              padding: "6px 12px",
              background: isRunning ? "#4b5563" : "#6ea8fe",
              color: "white",
              border: "none",
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 600,
              cursor: isRunning ? "default" : "pointer",
              opacity: isRunning ? 0.6 : 1,
            }}
          >
            {isRunning ? "Running..." : "Run Backtest"}
          </button>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div
          style={{
            padding: 10,
            background: "rgba(239, 68, 68, 0.1)",
            border: "1px solid #ef4444",
            borderRadius: 4,
            color: "#fca5a5",
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}

      {/* Controls */}
      <div style={{ display: "flex", gap: 8 }}>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as any)}
          style={{
            flex: 1,
            padding: "6px 8px",
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 4,
            color: "white",
            fontSize: 12,
          }}
        >
          <option value="date">Sort by Date</option>
          <option value="sharpe">Sort by Sharpe</option>
          <option value="return">Sort by Return</option>
        </select>

        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as any)}
          style={{
            flex: 1,
            padding: "6px 8px",
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 4,
            color: "white",
            fontSize: 12,
          }}
        >
          <option value="all">All Runs</option>
          <option value="running">Running</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {/* Runs List */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          maxHeight: 500,
          overflow: "auto",
        }}
      >
        {paginated.length === 0 ? (
          <div
            style={{
              padding: 20,
              textAlign: "center",
              color: "#666",
              fontSize: 12,
            }}
          >
            No runs found
          </div>
        ) : (
          paginated.map((run) => (
            <button
              key={run.id}
              onClick={() => onSelectRun(run.id)}
              style={{
                padding: 12,
                background:
                  selectedRunId === run.id
                    ? "rgba(110, 168, 254, 0.15)"
                    : "rgba(255,255,255,0.05)",
                border:
                  selectedRunId === run.id
                    ? "1px solid rgba(110, 168, 254, 0.3)"
                    : "1px solid rgba(255,255,255,0.1)",
                borderRadius: 4,
                color: "white",
                textAlign: "left",
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
            >
              {/* Run Header */}
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                <div
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    background: getStatusColor(run.status),
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>
                    {new Date(run.timestamp).toLocaleString()}
                  </div>
                  <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
                    {getModeLabel(run.mode)} • {run.trades} trades
                  </div>
                </div>
                <div style={{ fontSize: 11, color: "#888", whiteSpace: "nowrap" }}>
                  v{run.strategyVersion}
                </div>
              </div>

              {/* Metrics Grid */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gap: 8,
                  fontSize: 11,
                  marginBottom: 8,
                }}
              >
                <div>
                  <div style={{ color: "#888", marginBottom: 2 }}>Return</div>
                  <div
                    style={{
                      color: run.metrics.totalReturn >= 0 ? "#10b981" : "#ef4444",
                      fontWeight: 600,
                    }}
                  >
                    {(run.metrics.totalReturn * 100).toFixed(1)}%
                  </div>
                </div>
                <div>
                  <div style={{ color: "#888", marginBottom: 2 }}>CAGR</div>
                  <div
                    style={{
                      color: run.metrics.cagr >= 0 ? "#10b981" : "#ef4444",
                      fontWeight: 600,
                    }}
                  >
                    {(run.metrics.cagr * 100).toFixed(1)}%
                  </div>
                </div>
                <div>
                  <div style={{ color: "#888", marginBottom: 2 }}>Sharpe</div>
                  <div style={{ fontWeight: 600 }}>
                    {run.metrics.sharpe.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div style={{ color: "#888", marginBottom: 2 }}>MaxDD</div>
                  <div style={{ color: "#ef4444", fontWeight: 600 }}>
                    {run.metrics.maxDD.toFixed(1)}%
                  </div>
                </div>
              </div>

              {/* Additional Metrics */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: 8,
                  fontSize: 10,
                  color: "#888",
                }}
              >
                <div>
                  Sortino: {run.metrics.sortino.toFixed(2)}
                </div>
                <div>
                  Win Rate: {(run.metrics.winRate * 100).toFixed(0)}%
                </div>
                <div>
                  PF: {run.metrics.profitFactor.toFixed(2)}
                </div>
              </div>

              {/* Download Button (if selected) */}
              {selectedRunId === run.id && onDownloadArtifacts && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDownloadArtifacts(run.id);
                  }}
                  style={{
                    marginTop: 8,
                    padding: "6px 10px",
                    background: "rgba(34, 197, 94, 0.1)",
                    border: "1px solid #22c55e",
                    borderRadius: 3,
                    color: "#22c55e",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                    width: "100%",
                  }}
                >
                  ⬇ Download Artifacts
                </button>
              )}
            </button>
          ))
        )}
      </div>

      {/* Pagination */}
      {sorted.length > pageSize && (
        <div
          style={{
            display: "flex",
            gap: 6,
            justifyContent: "center",
            alignItems: "center",
            fontSize: 12,
            color: "#888",
          }}
        >
          <button
            onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
            disabled={currentPage === 0}
            style={{
              background: "rgba(255,255,255,0.1)",
              border: "none",
              borderRadius: 3,
              color: "white",
              width: 24,
              height: 24,
              cursor: currentPage === 0 ? "default" : "pointer",
              opacity: currentPage === 0 ? 0.5 : 1,
            }}
          >
            ←
          </button>
          <span>
            {currentPage + 1} / {Math.ceil(sorted.length / pageSize)}
          </span>
          <button
            onClick={() =>
              setCurrentPage(
                Math.min(
                  currentPage + 1,
                  Math.ceil(sorted.length / pageSize) - 1
                )
              )
            }
            disabled={currentPage >= Math.ceil(sorted.length / pageSize) - 1}
            style={{
              background: "rgba(255,255,255,0.1)",
              border: "none",
              borderRadius: 3,
              color: "white",
              width: 24,
              height: 24,
              cursor:
                currentPage >= Math.ceil(sorted.length / pageSize) - 1
                  ? "default"
                  : "pointer",
              opacity:
                currentPage >= Math.ceil(sorted.length / pageSize) - 1
                  ? 0.5
                  : 1,
            }}
          >
            →
          </button>
        </div>
      )}
    </div>
  );
}

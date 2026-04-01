/**
 * Strategy Reports Panel Component
 * Displays detailed performance analysis, equity curve, trade breakdown
 */

import React, { useState } from "react";

export type ReportMetrics = {
  totalReturn: number;
  cagr: number;
  sharpe: number;
  sortino: number;
  calmar: number;
  maxDD: number;
  maxDDDate: string;
  currentDD: number;
  winRate: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  avgRiskReward: number;
  bestTrade: number;
  worstTrade: number;
  tradingCost: number;
  alpha?: number;
  beta?: number;
  correlation?: number;
  monthlyReturn: number;
  yearlyReturn: number;
};

export type ReportData = {
  runId: string;
  strategyName: string;
  timestamp: string;
  metrics: ReportMetrics;
  equityCurve: Array<{ date: string; value: number }>;
  drawdownCurve: Array<{ date: string; value: number }>;
  monthlyReturns: Array<{ month: string; return: number }>;
  summary: string;
};

export type ReportsPanelProps = {
  report?: ReportData;
  loading?: boolean;
  onExportReport?: (format: "pdf" | "html" | "csv") => void;
};

export function ReportsPanel({
  report,
  loading,
  onExportReport,
}: ReportsPanelProps) {
  const [activeTab, setActiveTab] = useState<"summary" | "metrics" | "curves" | "monthly">("summary");

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: 300,
          color: "#666",
          fontSize: 12,
        }}
      >
        Loading report...
      </div>
    );
  }

  if (!report) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: 300,
          color: "#666",
          fontSize: 12,
        }}
      >
        Select a backtest run to view report
      </div>
    );
  }

  const m = report.metrics;

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
            Performance Report
          </h3>
          <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>
            {report.strategyName} • {new Date(report.timestamp).toLocaleDateString()}
          </div>
        </div>
        {onExportReport && (
          <select
            onChange={(e) => {
              if (e.target.value) onExportReport(e.target.value as any);
              e.target.value = "";
            }}
            style={{
              padding: "6px 10px",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 4,
              color: "white",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            <option value="">Export As...</option>
            <option value="pdf">PDF Report</option>
            <option value="html">HTML</option>
            <option value="csv">CSV</option>
          </select>
        )}
      </div>

      {/* Tab Navigation */}
      <div style={{ display: "flex", gap: 8, borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
        {(["summary", "metrics", "curves", "monthly"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "8px 12px",
              background: activeTab === tab ? "rgba(110, 168, 254, 0.1)" : "transparent",
              border: "none",
              borderBottom: activeTab === tab ? "2px solid #6ea8fe" : "none",
              color: activeTab === tab ? "#6ea8fe" : "#888",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Summary Tab */}
      {activeTab === "summary" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Key Metrics Grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 12,
            }}
          >
            <MetricCard
              label="Total Return"
              value={(m.totalReturn * 100).toFixed(2)}
              unit="%"
              color={m.totalReturn >= 0 ? "#10b981" : "#ef4444"}
            />
            <MetricCard
              label="CAGR"
              value={(m.cagr * 100).toFixed(2)}
              unit="%"
              color={m.cagr >= 0 ? "#10b981" : "#ef4444"}
            />
            <MetricCard
              label="Sharpe Ratio"
              value={m.sharpe.toFixed(2)}
              color={m.sharpe > 1 ? "#10b981" : m.sharpe > 0.5 ? "#f59e0b" : "#ef4444"}
            />
            <MetricCard
              label="Sortino Ratio"
              value={m.sortino.toFixed(2)}
              color={m.sortino > 1 ? "#10b981" : m.sortino > 0.5 ? "#f59e0b" : "#ef4444"}
            />
            <MetricCard
              label="Max Drawdown"
              value={(m.maxDD * 100).toFixed(2)}
              unit="%"
              color="#ef4444"
            />
            <MetricCard
              label="Calmar Ratio"
              value={m.calmar.toFixed(2)}
              color={m.calmar > 0.5 ? "#10b981" : m.calmar > 0 ? "#f59e0b" : "#ef4444"}
            />
          </div>

          {/* Summary Text */}
          <div
            style={{
              padding: 12,
              background: "rgba(255,255,255,0.05)",
              borderRadius: 4,
              fontSize: 12,
              lineHeight: "1.6",
              color: "#bbb",
              fontStyle: "italic",
            }}
          >
            {report.summary || "No summary generated for this run."}
          </div>
        </div>
      )}

      {/* Metrics Tab */}
      {activeTab === "metrics" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <MetricGroup title="Risk Metrics">
            <MetricRow label="Max Drawdown" value={(m.maxDD * 100).toFixed(2) + "%"} />
            <MetricRow label="Current Drawdown" value={(m.currentDD * 100).toFixed(2) + "%"} />
            <MetricRow label="Sortino Ratio" value={m.sortino.toFixed(2)} />
            <MetricRow label="Beta" value={m.beta?.toFixed(2) || "N/A"} />
          </MetricGroup>

          <MetricGroup title="Return Metrics">
            <MetricRow label="Total Return" value={(m.totalReturn * 100).toFixed(2) + "%"} />
            <MetricRow label="CAGR" value={(m.cagr * 100).toFixed(2) + "%"} />
            <MetricRow label="Sharpe Ratio" value={m.sharpe.toFixed(2)} />
            <MetricRow label="Alpha" value={m.alpha?.toFixed(2) || "N/A"} />
          </MetricGroup>

          <MetricGroup title="Trade Statistics">
            <MetricRow label="Total Trades" value={report.metrics.bestTrade ? "Multiple" : "N/A"} />
            <MetricRow label="Win Rate" value={(m.winRate * 100).toFixed(0) + "%"} />
            <MetricRow label="Profit Factor" value={m.profitFactor.toFixed(2)} />
            <MetricRow label="Best Trade" value={(m.bestTrade * 100).toFixed(2) + "%"} />
          </MetricGroup>

          <MetricGroup title="Cost Analysis">
            <MetricRow label="Trading Costs" value={"$" + m.tradingCost.toFixed(2)} />
            <MetricRow label="Avg Win/Loss" value={m.avgRiskReward.toFixed(2) + "x"} />
            <MetricRow label="Worst Trade" value={(m.worstTrade * 100).toFixed(2) + "%"} />
            <MetricRow label="Monthly Return" value={(m.monthlyReturn * 100).toFixed(2) + "%"} />
          </MetricGroup>
        </div>
      )}

      {/* Equity Curve Tab (Simplified Text) */}
      {activeTab === "curves" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div
            style={{
              padding: 12,
              background: "rgba(255,255,255,0.05)",
              borderRadius: 4,
              border: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: "#ccc" }}>
              Equity Curve
            </div>
            <div style={{ fontSize: 11, color: "#888", lineHeight: "1.6" }}>
              {report.equityCurve?.length ? (
                <>
                  <div>Start: {report.equityCurve[0].date}</div>
                  <div>End: {report.equityCurve[report.equityCurve.length - 1].date}</div>
                  <div>Final Value: ${report.equityCurve[report.equityCurve.length - 1].value.toFixed(2)}</div>
                  <div style={{ marginTop: 6, fontSize: 10, fontStyle: "italic" }}>
                    (Detailed charting available in UI integration)
                  </div>
                </>
              ) : (
                "No equity curve data available"
              )}
            </div>
          </div>

          <div
            style={{
              padding: 12,
              background: "rgba(255,255,255,0.05)",
              borderRadius: 4,
              border: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: "#ccc" }}>
              Drawdown Curve
            </div>
            <div style={{ fontSize: 11, color: "#888" }}>
              Max Drawdown: {(m.maxDD * 100).toFixed(2)}% on {m.maxDDDate}
            </div>
          </div>
        </div>
      )}

      {/* Monthly Returns Tab */}
      {activeTab === "monthly" && (
        <div
          style={{
            padding: 12,
            background: "rgba(255,255,255,0.05)",
            borderRadius: 4,
            border: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: "#ccc" }}>
            Monthly Returns
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {report.monthlyReturns?.slice(0, 12).map((mr) => (
              <div
                key={mr.month}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: 11,
                }}
              >
                <span style={{ color: "#888" }}>{mr.month}</span>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      width: 100,
                      height: 4,
                      background:
                        mr.return >= 0
                          ? "rgba(16, 185, 129, 0.5)"
                          : "rgba(239, 68, 68, 0.5)",
                      borderRadius: 2,
                    }}
                  />
                  <span
                    style={{
                      color: mr.return >= 0 ? "#10b981" : "#ef4444",
                      fontWeight: 600,
                      minWidth: 40,
                      textAlign: "right",
                    }}
                  >
                    {(mr.return * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  unit,
  color,
}: {
  label: string;
  value: string;
  unit?: string;
  color?: string;
}) {
  return (
    <div
      style={{
        padding: 12,
        background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 4,
      }}
    >
      <div style={{ fontSize: 11, color: "#888", marginBottom: 6 }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 18,
          fontWeight: 700,
          color: color || "#ccc",
        }}
      >
        {value}{unit}
      </div>
    </div>
  );
}

function MetricGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        padding: 12,
        background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 4,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 12, color: "#ccc" }}>
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {children}
      </div>
    </div>
  );
}

function MetricRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        fontSize: 11,
        paddingBottom: 6,
        borderBottom: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      <span style={{ color: "#888" }}>{label}</span>
      <span style={{ color: "#ccc", fontWeight: 600 }}>{value}</span>
    </div>
  );
}

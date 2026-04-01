import React from "react";

export interface SessionStats {
  totalTrades: number;
  closedTrades: number;
  winningTrades: number;
  losingTrades: number;
  totalPnl: number;
  winRate: number;
  avgMae: number;
  avgMfe: number;
  avgTimeInTrade: number;
}

export interface SessionDebriefProps {
  todayStats: SessionStats | null;
  historicalStats: SessionStats | null;
  loading?: boolean;
}

function formatCurrency(num: number): string {
  return `$${num.toFixed(2)}`;
}

function formatPercent(num: number): string {
  return `${num.toFixed(1)}%`;
}

function formatTime(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export function SessionDebrief({ todayStats, historicalStats, loading }: SessionDebriefProps) {
  if (loading) {
    return <div style={{ padding: 20, textAlign: "center", opacity: 0.6 }}>Loading stats...</div>;
  }

  if (!todayStats && !historicalStats) {
    return <div style={{ padding: 20, textAlign: "center", opacity: 0.6 }}>No data available</div>;
  }

  const stats = todayStats || historicalStats;
  if (!stats) return null;

  return (
    <div className="card">
      <div className="cardTitle">Session Debrief</div>
      <div className="cardBody" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Summary Row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
          {/* Total Trades */}
          <div style={{ padding: 12, background: "rgba(255,255,255,0.03)", borderRadius: 6 }}>
            <div style={{ fontSize: 10, opacity: 0.6, marginBottom: 6 }}>TOTAL TRADES</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{stats.totalTrades}</div>
            <div style={{ fontSize: 9, opacity: 0.5, marginTop: 2 }}>
              {stats.closedTrades} closed
            </div>
          </div>

          {/* Win Rate */}
          <div style={{ padding: 12, background: "rgba(255,255,255,0.03)", borderRadius: 6 }}>
            <div style={{ fontSize: 10, opacity: 0.6, marginBottom: 6 }}>WIN RATE</div>
            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                color:
                  stats.winRate >= 60
                    ? "rgba(100, 200, 100, 1)"
                    : stats.winRate >= 45
                      ? "rgba(200, 200, 100, 1)"
                      : "rgba(255, 100, 100, 1)",
              }}
            >
              {formatPercent(stats.winRate)}
            </div>
            <div style={{ fontSize: 9, opacity: 0.5, marginTop: 2 }}>
              {stats.winningTrades}W / {stats.losingTrades}L
            </div>
          </div>

          {/* Total P&L */}
          <div style={{ padding: 12, background: "rgba(255,255,255,0.03)", borderRadius: 6 }}>
            <div style={{ fontSize: 10, opacity: 0.6, marginBottom: 6 }}>TOTAL P&L</div>
            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: stats.totalPnl > 0 ? "rgba(100, 200, 100, 1)" : "rgba(255, 100, 100, 1)",
              }}
            >
              {formatCurrency(stats.totalPnl)}
            </div>
            <div style={{ fontSize: 9, opacity: 0.5, marginTop: 2 }}>
              Avg per trade: {formatCurrency(stats.closedTrades > 0 ? stats.totalPnl / stats.closedTrades : 0)}
            </div>
          </div>

          {/* Avg MAE */}
          <div style={{ padding: 12, background: "rgba(255,255,255,0.03)", borderRadius: 6 }}>
            <div style={{ fontSize: 10, opacity: 0.6, marginBottom: 6 }}>AVG MAE</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "rgba(255, 150, 100, 1)" }}>
              {formatCurrency(stats.avgMae)}
            </div>
            <div style={{ fontSize: 9, opacity: 0.5, marginTop: 2 }}>
              {formatPercent((stats.avgMae / 100) * 100)} (est)
            </div>
          </div>

          {/* Avg MFE */}
          <div style={{ padding: 12, background: "rgba(255,255,255,0.03)", borderRadius: 6 }}>
            <div style={{ fontSize: 10, opacity: 0.6, marginBottom: 6 }}>AVG MFE</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "rgba(100, 200, 100, 1)" }}>
              {formatCurrency(stats.avgMfe)}
            </div>
            <div style={{ fontSize: 9, opacity: 0.5, marginTop: 2 }}>
              {formatPercent((stats.avgMfe / 100) * 100)} (est)
            </div>
          </div>
        </div>

        {/* Detailed Stats */}
        <div style={{ padding: 12, background: "rgba(255,255,255,0.02)", borderRadius: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 12, opacity: 0.8 }}>TRADE TIMING</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
            <div>
              <div style={{ fontSize: 10, opacity: 0.6, marginBottom: 6 }}>Avg Time in Trade</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{formatTime(stats.avgTimeInTrade)}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, opacity: 0.6, marginBottom: 6 }}>Fastest Trade</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>N/A</div>
            </div>
            <div>
              <div style={{ fontSize: 10, opacity: 0.6, marginBottom: 6 }}>Longest Trade</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>N/A</div>
            </div>
          </div>
        </div>

        {/* Risk/Reward */}
        <div style={{ padding: 12, background: "rgba(255,255,255,0.02)", borderRadius: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 12, opacity: 0.8 }}>RISK/REWARD ANALYSIS</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <div>
              <div style={{ fontSize: 10, opacity: 0.6, marginBottom: 4 }}>Average MFE / Average MAE Ratio</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "rgba(110, 168, 254, 1)" }}>
                {stats.avgMae > 0 ? (stats.avgMfe / stats.avgMae).toFixed(2) : 0}x
              </div>
              <div style={{ fontSize: 9, opacity: 0.5, marginTop: 4 }}>
                {stats.avgMae > 0 && stats.avgMfe / stats.avgMae > 1
                  ? "✓ Favorable risk/reward"
                  : "✗ Need better exits"}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, opacity: 0.6, marginBottom: 4 }}>Win Rate Target: 45%</div>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: stats.winRate >= 45 ? "rgba(100, 200, 100, 1)" : "rgba(255, 100, 100, 1)",
                }}
              >
                {stats.winRate >= 45 ? "✓ Met" : `✗ ${(45 - stats.winRate).toFixed(1)}% behind`}
              </div>
              <div style={{ fontSize: 9, opacity: 0.5, marginTop: 4 }}>Currently at {formatPercent(stats.winRate)}</div>
            </div>
          </div>
        </div>

        {/* Historical Comparison */}
        {historicalStats && todayStats && (
          <div style={{ padding: 12, background: "rgba(255,255,255,0.02)", borderRadius: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 12, opacity: 0.8 }}>TODAY vs HISTORICAL</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, fontSize: 10 }}>
              <div>
                <div style={{ opacity: 0.6, marginBottom: 4 }}>Win Rate</div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <div>Today: {formatPercent(todayStats.winRate)}</div>
                  <div style={{ opacity: 0.6 }}>Avg: {formatPercent(historicalStats.winRate)}</div>
                </div>
              </div>
              <div>
                <div style={{ opacity: 0.6, marginBottom: 4 }}>P&L per Trade</div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <div>
                    {todayStats.closedTrades > 0 ? formatCurrency(todayStats.totalPnl / todayStats.closedTrades) : "$0"}
                  </div>
                  <div style={{ opacity: 0.6 }}>
                    {historicalStats.closedTrades > 0 ? formatCurrency(historicalStats.totalPnl / historicalStats.closedTrades) : "$0"}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

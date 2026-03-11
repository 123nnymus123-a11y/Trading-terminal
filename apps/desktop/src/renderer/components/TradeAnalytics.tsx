import React from "react";
import type { PaperTrade } from "../../main/persistence/repos";

export interface TradeAnalyticsProps {
  trade: PaperTrade;
  onEdit?: (trade: PaperTrade) => void;
}

function formatTime(ms: number): string {
  if (!ms) return "-";
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function formatCurrency(num: number | undefined): string {
  if (num === undefined || num === null) return "-";
  return `$${num.toFixed(2)}`;
}

function formatPercent(num: number | undefined): string {
  if (num === undefined || num === null) return "-";
  return `${num.toFixed(2)}%`;
}

export function TradeAnalytics({ trade, onEdit }: TradeAnalyticsProps) {
  const isProfitable = trade.exit_price ? trade.side === "buy" ? trade.exit_price > trade.entry_price : trade.exit_price < trade.entry_price : false;
  const pnl = trade.exit_price ? (trade.side === "buy" ? 1 : -1) * (trade.exit_price - trade.entry_price) * trade.entry_qty : 0;
  const pnlPercent = (pnl / (trade.entry_price * trade.entry_qty)) * 100;

  return (
    <div style={{ padding: 16, background: "rgba(255,255,255,0.02)", borderRadius: 8, marginBottom: 12 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            {trade.symbol} - {trade.side.toUpperCase()} {trade.entry_qty} @ ${trade.entry_price.toFixed(2)}
          </div>
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>
            Entry: {new Date(trade.entry_ts).toLocaleString()} | Exit: {trade.exit_ts ? new Date(trade.exit_ts).toLocaleString() : "OPEN"}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: isProfitable ? "rgba(100, 200, 100, 1)" : trade.exit_price ? "rgba(255, 100, 100, 1)" : "rgba(200, 200, 200, 0.5)",
            }}
          >
            {formatCurrency(pnl)}
          </div>
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
            {trade.exit_price ? `${isProfitable ? "+" : ""}${formatPercent(pnlPercent)}` : "Open"}
          </div>
        </div>
      </div>

      {/* Analytics Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        {/* MAE */}
        <div style={{ padding: 10, background: "rgba(255,255,255,0.03)", borderRadius: 6 }}>
          <div style={{ fontSize: 10, opacity: 0.6, marginBottom: 4 }}>MAX ADVERSE EXCURSION</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "rgba(255, 150, 100, 1)" }}>
            {formatCurrency(trade.mae ? trade.entry_qty * trade.mae : 0)}
          </div>
          <div style={{ fontSize: 9, opacity: 0.5, marginTop: 2 }}>{formatPercent(trade.mae ? (trade.mae / trade.entry_price) * 100 : 0)}</div>
        </div>

        {/* MFE */}
        <div style={{ padding: 10, background: "rgba(255,255,255,0.03)", borderRadius: 6 }}>
          <div style={{ fontSize: 10, opacity: 0.6, marginBottom: 4 }}>MAX FAVORABLE EXCURSION</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "rgba(100, 200, 100, 1)" }}>
            {formatCurrency(trade.mfe ? trade.entry_qty * trade.mfe : 0)}
          </div>
          <div style={{ fontSize: 9, opacity: 0.5, marginTop: 2 }}>{formatPercent(trade.mfe ? (trade.mfe / trade.entry_price) * 100 : 0)}</div>
        </div>

        {/* Time in Trade */}
        <div style={{ padding: 10, background: "rgba(255,255,255,0.03)", borderRadius: 6 }}>
          <div style={{ fontSize: 10, opacity: 0.6, marginBottom: 4 }}>TIME IN TRADE</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{formatTime(trade.time_in_trade || 0)}</div>
        </div>

        {/* Slippage */}
        <div style={{ padding: 10, background: "rgba(255,255,255,0.03)", borderRadius: 6 }}>
          <div style={{ fontSize: 10, opacity: 0.6, marginBottom: 4 }}>SLIPPAGE</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "rgba(200, 150, 100, 1)" }}>
            {formatCurrency(trade.slippage ? trade.entry_qty * trade.slippage : 0)}
          </div>
        </div>
      </div>

      {/* Metadata */}
      {(trade.setup || trade.regime || trade.catalyst || trade.execution_type) && (
        <div style={{ padding: 10, background: "rgba(255,255,255,0.02)", borderRadius: 6, marginBottom: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, fontSize: 11 }}>
            {trade.setup && (
              <div>
                <div style={{ opacity: 0.6, marginBottom: 2 }}>Setup</div>
                <div style={{ fontWeight: 600 }}>{trade.setup}</div>
              </div>
            )}
            {trade.regime && (
              <div>
                <div style={{ opacity: 0.6, marginBottom: 2 }}>Regime</div>
                <div style={{ fontWeight: 600 }}>{trade.regime}</div>
              </div>
            )}
            {trade.catalyst && (
              <div>
                <div style={{ opacity: 0.6, marginBottom: 2 }}>Catalyst</div>
                <div style={{ fontWeight: 600 }}>{trade.catalyst}</div>
              </div>
            )}
            {trade.execution_type && (
              <div>
                <div style={{ opacity: 0.6, marginBottom: 2 }}>Execution</div>
                <div style={{ fontWeight: 600 }}>{trade.execution_type}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Screenshots and Notes */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {trade.entry_screenshot_path && (
          <div style={{ padding: 10, background: "rgba(255,255,255,0.03)", borderRadius: 6 }}>
            <div style={{ fontSize: 10, opacity: 0.6, marginBottom: 6 }}>ENTRY SCREENSHOT</div>
            <img
              src={`screenshot://${encodeURIComponent(trade.entry_screenshot_path)}`}
              alt="Entry"
              style={{ width: "100%", borderRadius: 4, maxHeight: 200, objectFit: "cover" }}
            />
          </div>
        )}
        {trade.exit_screenshot_path && (
          <div style={{ padding: 10, background: "rgba(255,255,255,0.03)", borderRadius: 6 }}>
            <div style={{ fontSize: 10, opacity: 0.6, marginBottom: 6 }}>EXIT SCREENSHOT</div>
            <img
              src={`screenshot://${encodeURIComponent(trade.exit_screenshot_path)}`}
              alt="Exit"
              style={{ width: "100%", borderRadius: 4, maxHeight: 200, objectFit: "cover" }}
            />
          </div>
        )}
      </div>

      {/* Notes */}
      {trade.notes && (
        <div style={{ padding: 10, background: "rgba(255,255,255,0.02)", borderRadius: 6, marginTop: 12, fontSize: 12 }}>
          <div style={{ opacity: 0.6, marginBottom: 4 }}>NOTES</div>
          <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{trade.notes}</div>
        </div>
      )}

      {/* Edit Button */}
      {onEdit && (
        <button
          onClick={() => onEdit(trade)}
          style={{
            marginTop: 12,
            padding: 8,
            background: "rgba(110, 168, 254, 0.15)",
            border: "1px solid rgba(110, 168, 254, 0.3)",
            borderRadius: 4,
            color: "white",
            fontSize: 11,
            cursor: "pointer",
            width: "100%",
          }}
        >
          Edit Tags & Notes
        </button>
      )}
    </div>
  );
}

import React, { useMemo } from "react";
import { useStrategyStore } from "../store/strategyStore";

export default function Cam() {
  const camSignals = useStrategyStore((s) => s.camSignals);

  const ranked = useMemo(() => {
    return Object.values(camSignals)
      .sort((a, b) => b.compositeScore - a.compositeScore)
      .slice(0, 12);
  }, [camSignals]);

  return (
    <div style={{ display: "grid", gap: 12, opacity: 0.95 }}>
      <h2 style={{ margin: 0 }}>CAM — Capital Momentum</h2>
      <div style={{ fontSize: 12, opacity: 0.75 }}>
        Weighted psychology + flow model with hard viability gates and freshness diagnostics.
      </div>

      {ranked.length === 0 ? (
        <div style={{ padding: 12, border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, opacity: 0.7 }}>
          Waiting for CAM signals...
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {ranked.map((signal) => (
            <div
              key={`${signal.symbol}-${signal.ts}`}
              style={{
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 12,
                padding: 12,
                background: "rgba(255,255,255,0.03)",
                display: "grid",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontWeight: 700 }}>{signal.symbol}</div>
                <div style={{ fontSize: 12, color: signal.passes ? "#4ade80" : "#fbbf24", fontWeight: 700 }}>
                  {signal.passes ? "PASS" : "BLOCKED"}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8, fontSize: 12 }}>
                <div>Score: <b>{signal.compositeScore.toFixed(1)}</b> / {signal.threshold}</div>
                <div>Trend: <b>{signal.trendScore.toFixed(2)}</b></div>
                <div>Flow: <b>{signal.flowScore.toFixed(2)}</b></div>
                <div>Vol: <b>{signal.volatilityScore.toFixed(2)}</b> ({signal.volatilityState})</div>
                <div>Breakout: <b>{signal.breakoutScore.toFixed(2)}</b></div>
                <div>Confidence: <b>{(signal.confidence * 100).toFixed(0)}%</b></div>
              </div>

              <div style={{ fontSize: 12, opacity: 0.8 }}>
                Gates: {signal.gatesFailed.length ? signal.gatesFailed.join(" · ") : "All clear"}
              </div>

              <div style={{ fontSize: 12, opacity: 0.8 }}>
                Freshness(ms): PF {signal.dataFreshness.publicFlowAgeMs} · Theme {signal.dataFreshness.themeAgeMs} · Congress {signal.dataFreshness.congressAgeMs} · 2nd {signal.dataFreshness.secondOrderAgeMs}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

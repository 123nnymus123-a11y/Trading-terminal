import React, { useMemo, useState, useEffect } from "react";
import { useStreamStore } from "../store/streamStore";
import { useIndicatorStore } from "../store/indicatorStore";
import { useIndicatorUpdates } from "../hooks/useIndicatorUpdates";
import { DataUnavailableCard } from "../components/DataUnavailable";
import StructureChart, { type StructureLevel } from "../components/StructureChart";

const POPULAR_SYMBOLS = [
  "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "TSLA", "META", "SPY", "QQQ", "DIA"
];

export default function Structure() {
  useIndicatorUpdates();

  const [currentSymbol, setCurrentSymbol] = useState("AAPL");
  const indicator = useIndicatorStore((s) => s.getIndicator(currentSymbol));
  const lastPrices = useStreamStore((s) => s.lastPrices);
  const lastPrice = lastPrices[currentSymbol]?.price;
  const setIndicator = useIndicatorStore((s) => s.setIndicator);

  // Generate mock indicators for demo mode if real data isn't available
  useEffect(() => {
    if (!indicator && lastPrice) {
      const mockIndicator = {
        symbol: currentSymbol,
        vwap: {
          value: lastPrice * (0.98 + Math.random() * 0.04),
          slope: (Math.random() - 0.5) * 0.002,
          deviation: (Math.random() - 0.5) * 50,
        },
        atr: {
          value: lastPrice * 0.01,
          period: 14,
        },
        openingRange: {
          high: lastPrice * 1.005,
          low: lastPrice * 0.995,
        },
        priorDayHLC: {
          high: lastPrice * 1.01,
          low: lastPrice * 0.99,
          close: lastPrice * 1.002,
        },
        realizedVol: {
          value: 0.18,
          annualized: 0.18 * Math.sqrt(252),
        },
      };
      setIndicator(currentSymbol, mockIndicator as any);
    }
  }, [currentSymbol, lastPrice, indicator, setIndicator]);

  const [levels, setLevels] = useState<StructureLevel[]>([]);
  const [levelPrice, setLevelPrice] = useState("");
  const [levelLabel, setLevelLabel] = useState("");

  const fmt = (val: number | null | undefined) => {
    if (val === null || val === undefined) return "—";
    if (typeof val === "number") {
      if (val > 10) return val.toFixed(2);
      if (val < 0.01) return val.toExponential(2);
      return val.toFixed(4);
    }
    return "—";
  };

  const addLevel = () => {
    const price = Number(levelPrice);
    if (!Number.isFinite(price)) return;
    const id = `lvl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const label = levelLabel.trim();
    const payload: StructureLevel = { id, price };
    if (label) payload.label = label;
    setLevels((prev) => [...prev, payload]);
    setLevelPrice("");
    setLevelLabel("");
  };

  const removeLevel = (id: string) => setLevels((prev) => prev.filter((lvl) => lvl.id !== id));

  const structureHealth = useMemo(() => {
    const bias = indicator?.vwap?.deviation ?? null;
    const slope = indicator?.vwap?.slope ?? null;
    const orLocked = indicator?.openingRange ? "Locked" : "Building";
    const atr = indicator?.atr?.value ?? null;
    const price = lastPrice ?? null;

    return [
      {
        label: "Price vs VWAP",
        value: bias === null ? "—" : bias > 0 ? "Above" : bias < 0 ? "Below" : "At VWAP",
        detail: bias === null ? "Waiting for bars" : `${bias.toFixed(2)} bps dispersion`,
      },
      {
        label: "VWAP slope",
        value: slope === null ? "—" : slope > 0 ? "Rising" : slope < 0 ? "Falling" : "Flat",
        detail: slope === null ? "Need more samples" : `${slope.toFixed(4)} slope`,
      },
      {
        label: "Opening range",
        value: orLocked,
        detail: indicator?.openingRange ? "OR complete" : "First 5m in progress",
      },
      {
        label: "ATR pulse",
        value: atr === null ? "—" : atr.toFixed(2),
        detail: atr === null ? "Awaiting bars" : "14 period ATR",
      },
      {
        label: "Last price",
        value: price === null ? "—" : price.toFixed(2),
        detail: "Live or replay feed",
      },
    ];
  }, [indicator, lastPrice]);

  return (
    <div className="page">
      <div className="pageTitleRow">
        <h1 className="pageTitle">STRUCTURE</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div className="pageSubtitle">Market structure + indicators</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ fontSize: 13, opacity: 0.8 }}>Symbol:</label>
            <select 
              value={currentSymbol}
              onChange={(e) => setCurrentSymbol(e.target.value)}
              style={{
                padding: "6px 12px",
                fontSize: 14,
                fontWeight: 600,
                background: "rgba(100, 150, 255, 0.15)",
                border: "1px solid rgba(100, 150, 255, 0.3)",
                borderRadius: 6,
                color: "#e5e7eb",
                cursor: "pointer",
                outline: "none",
              }}
            >
              {POPULAR_SYMBOLS.map(sym => (
                <option key={sym} value={sym} style={{ background: "#1a1f2e", color: "#e5e7eb" }}>
                  {sym}
                </option>
              ))}
            </select>
            {lastPrice && (
              <span style={{ 
                fontSize: 16, 
                fontWeight: 700, 
                color: "#33d17a",
                marginLeft: 8 
              }}>
                ${lastPrice.toFixed(2)}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="structureLayout">
        <div className="structureMain">
          <StructureChart key={currentSymbol} symbol={currentSymbol} indicator={indicator} lastPrice={lastPrice} levels={levels} />

          <div className="structureGrid">
            {indicator ? (
              <>
                {indicator.openingRange && (
                  <div className="structureCard">
                    <div className="structureCardTitle">Opening Range (5m)</div>
                    <div className="structureCardRow">
                      <span>High</span>
                      <span className="pos">{fmt(indicator.openingRange.high)}</span>
                    </div>
                    <div className="structureCardRow">
                      <span>Low</span>
                      <span className="neg">{fmt(indicator.openingRange.low)}</span>
                    </div>
                  </div>
                )}

                {indicator.vwap && (
                  <div className="structureCard">
                    <div className="structureCardTitle">VWAP</div>
                    <div className="structureCardRow">
                      <span>Value</span>
                      <span>{fmt(indicator.vwap.value)}</span>
                    </div>
                    <div className="structureCardRow">
                      <span>Slope</span>
                      <span className={indicator.vwap.slope > 0 ? "pos" : "neg"}>{fmt(indicator.vwap.slope)}</span>
                    </div>
                    <div className="structureCardRow">
                      <span>Deviation (bps)</span>
                      <span className={indicator.vwap.deviation > 0 ? "pos" : "neg"}>{fmt(indicator.vwap.deviation)}</span>
                    </div>
                  </div>
                )}

                {indicator.atr && (
                  <div className="structureCard">
                    <div className="structureCardTitle">ATR</div>
                    <div className="structureCardRow">
                      <span>Value</span>
                      <span>{fmt(indicator.atr.value)}</span>
                    </div>
                    <div className="structureCardRow">
                      <span>Period</span>
                      <span>{indicator.atr.period} bars</span>
                    </div>
                  </div>
                )}

                {indicator.realizedVol && (
                  <div className="structureCard">
                    <div className="structureCardTitle">Realized Vol</div>
                    <div className="structureCardRow">
                      <span>Daily (%)</span>
                      <span>{fmt(indicator.realizedVol.value * 100)}</span>
                    </div>
                    <div className="structureCardRow">
                      <span>Annualized (%)</span>
                      <span>{fmt(indicator.realizedVol.annualized * 100)}</span>
                    </div>
                  </div>
                )}

                {indicator.priorDayHLC && (
                  <div className="structureCard">
                    <div className="structureCardTitle">Prior Day</div>
                    <div className="structureCardRow">
                      <span>High</span>
                      <span>{fmt(indicator.priorDayHLC.high)}</span>
                    </div>
                    <div className="structureCardRow">
                      <span>Close</span>
                      <span>{fmt(indicator.priorDayHLC.close)}</span>
                    </div>
                    <div className="structureCardRow">
                      <span>Low</span>
                      <span>{fmt(indicator.priorDayHLC.low)}</span>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <DataUnavailableCard title="Opening Range" hint="Waiting for data..." />
                <DataUnavailableCard title="VWAP" hint="Waiting for data..." />
                <DataUnavailableCard title="ATR" hint="Waiting for data..." />
                <DataUnavailableCard title="Realized Vol" hint="Waiting for data..." />
              </>
            )}
          </div>
        </div>

        <aside className="structureSidebar">
          <div className="structureSidebarCard">
            <div className="structureSidebarTitle">Level manager</div>
            <div className="structureLevelForm">
              <input
                className="structureInput"
                placeholder="Price"
                value={levelPrice}
                onChange={(e) => setLevelPrice(e.target.value)}
                inputMode="decimal"
              />
              <input
                className="structureInput"
                placeholder="Label (optional)"
                value={levelLabel}
                onChange={(e) => setLevelLabel(e.target.value)}
              />
              <button className="structureButton" onClick={addLevel}>Add level</button>
            </div>
            <div className="structureLevelsList">
              {levels.length === 0 && <div className="structureEmpty">No manual levels yet.</div>}
              {levels.map((lvl) => (
                <div key={lvl.id} className="structureLevelRow">
                  <div>
                    <div className="structureLevelPrice">{lvl.price.toFixed(2)}</div>
                    {lvl.label && <div className="structureLevelLabel">{lvl.label}</div>}
                  </div>
                  <button className="structureRemove" onClick={() => removeLevel(lvl.id)}>✕</button>
                </div>
              ))}
            </div>
          </div>

          <div className="structureSidebarCard">
            <div className="structureSidebarTitle">Structure health</div>
            <div className="structureHealthList">
              {structureHealth.map((item) => (
                <div key={item.label} className="structureHealthRowItem">
                  <div className="structureHealthLabel">{item.label}</div>
                  <div className="structureHealthValue">{item.value}</div>
                  <div className="structureHealthDetail">{item.detail}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="structureSidebarCard">
            <div className="structureSidebarTitle">Drawing tools</div>
            <div className="structureHint">Right-click the chart to open stub drawing tools (trendline, fib, zone).</div>
          </div>
        </aside>
      </div>
    </div>
  );
}
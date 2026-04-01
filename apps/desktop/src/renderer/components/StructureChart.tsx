import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ColorType,
  LineStyle,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type UTCTimestamp,
} from "lightweight-charts";
import type { IndicatorUpdate } from "@tc/shared";

export type StructureLevel = { id: string; price: number; label?: string };

type PriceLine = ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]>;

type Props = {
  symbol: string;
  indicator: IndicatorUpdate | null;
  lastPrice?: number | undefined;
  levels: StructureLevel[];
};

function tsToTime(ts: number): UTCTimestamp {
  return Math.floor(ts / 1000) as UTCTimestamp;
}

export function StructureChart({ symbol, indicator, lastPrice, levels }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const vwapSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  const openingRangeLines = useRef<{ high?: PriceLine; low?: PriceLine }>({});
  const priorDayLines = useRef<{ high?: PriceLine; low?: PriceLine; close?: PriceLine }>({});
  const levelLines = useRef<Record<string, PriceLine>>({});

  const [candles, setCandles] = useState<CandlestickData<UTCTimestamp>[]>([]);
  const [showVwap, setShowVwap] = useState(true);
  const [showOpeningRange, setShowOpeningRange] = useState(true);
  const [showPriorDay, setShowPriorDay] = useState(true);
  const [toolMenu, setToolMenu] = useState<{ x: number; y: number } | null>(null);
  const [dataSource, setDataSource] = useState<"live" | "demo" | "loading">("loading");
  const hasReceivedData = useRef(false);

  // Generate demo candles if no data arrives within 2 seconds
  useEffect(() => {
    hasReceivedData.current = false;
    
    const demoTimeout = setTimeout(() => {
      if (hasReceivedData.current) return; // Live data already arrived
      
      // Generate synthetic demo candles with realistic movement
      setDataSource("demo");
      const basePrice = lastPrice || 150;
      const demoCandles: CandlestickData<UTCTimestamp>[] = [];
      const now = Math.floor(Date.now() / 1000);
      
      let currentPrice = basePrice;
      const volatility = basePrice * 0.005; // 0.5% volatility per candle
      
      for (let i = 0; i < 50; i++) {
        const time = (now - (50 - i - 1) * 60) as UTCTimestamp;
        
        // Realistic price movement
        const trend = (Math.random() - 0.48) * volatility; // Slight upward bias
        currentPrice = currentPrice + trend;
        
        // Generate realistic OHLC
        const open = currentPrice;
        const bodySize = volatility * (Math.random() * 0.8 + 0.2);
        const close = currentPrice + bodySize * (Math.random() > 0.5 ? 1 : -1);
        const high = Math.max(open, close) + Math.abs(Math.random() * volatility * 0.5);
        const low = Math.min(open, close) - Math.abs(Math.random() * volatility * 0.5);
        
        demoCandles.push({ 
          time, 
          open: Math.round(open * 100) / 100,
          high: Math.round(high * 100) / 100,
          low: Math.round(low * 100) / 100,
          close: Math.round(close * 100) / 100
        });
        
        currentPrice = close;
      }
      
      setCandles(demoCandles);
    }, 2000);
    
    return () => clearTimeout(demoTimeout);
  }, [lastPrice]);

  const priorDay = useMemo(() => {
    if (indicator?.priorDayHLC) return indicator.priorDayHLC;
    if (!lastPrice) return null;
    return {
      high: Number((lastPrice * 1.01).toFixed(2)),
      low: Number((lastPrice * 0.99).toFixed(2)),
      close: Number((lastPrice * 0.995).toFixed(2)),
      tooltip: "Mock prior day levels (fallback)",
    };
  }, [indicator?.priorDayHLC, lastPrice]);

  useEffect(() => {
    if (!containerRef.current || chartRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: "#0b0f17" }, textColor: "#e5e7eb" },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, secondsVisible: true },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.05)" },
        horzLines: { color: "rgba(255,255,255,0.07)" },
      },
      crosshair: { mode: 1 },
    });

    const candle = chart.addCandlestickSeries({
      upColor: "#33d17a",
      downColor: "#ff6b6b",
      borderVisible: false,
      wickUpColor: "#33d17a",
      wickDownColor: "#ff6b6b",
    });

    const vwap = chart.addLineSeries({
      color: "#6ea8fe",
      lineWidth: 2,
      lastValueVisible: true,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
      visible: true,
    });

    chartRef.current = chart;
    candleSeriesRef.current = candle;
    vwapSeriesRef.current = vwap;

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      chart.applyOptions({ width, height });
    });

    resizeObserver.observe(containerRef.current);
    chart.timeScale().fitContent();

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      vwapSeriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series || candles.length === 0) return;
    series.setData(candles);
  }, [candles]);

  useEffect(() => {
    const series = vwapSeriesRef.current;
    if (!series) return;
    if (!showVwap || !indicator?.vwap) {
      series.setData([]);
      series.applyOptions({ visible: showVwap });
      return;
    }

    const value = indicator.vwap.value;
    const data: LineData<UTCTimestamp>[] = candles.map((c) => ({ time: c.time, value }));
    series.setData(data);
    series.applyOptions({ visible: showVwap });
  }, [indicator?.vwap, candles, showVwap]);

  useEffect(() => {
    const onBatch = (batchLike: unknown) => {
      // Handle different event formats
      let events: Array<{ type?: string; symbol?: string; price?: number; ts?: number }> = [];
      
      if (Array.isArray(batchLike)) {
        events = batchLike;
      } else if (batchLike && typeof batchLike === 'object') {
        const maybeBatch = batchLike as { events?: unknown };
        if (Array.isArray(maybeBatch?.events)) {
          events = maybeBatch.events;
        }
      }
      
      if (events.length === 0) return;

      let updated = false;
      setCandles((prev) => {
        let next = prev;
        for (const evt of events) {
          if (!evt || evt.type !== "market.print" || evt.symbol !== symbol) continue;
          
          const price = Number(evt.price);
          if (!Number.isFinite(price)) continue;
          
          // Mark as live data when we receive real events
          if (!hasReceivedData.current) {
            hasReceivedData.current = true;
            setDataSource("live");
          }
          
          const ts = tsToTime(evt.ts ?? Date.now());
          const last = next[next.length - 1];

          if (!last || last.time !== ts) {
            // New candle
            next = [...next, { time: ts, open: price, high: price, low: price, close: price }];
            updated = true;
          } else {
            // Update existing candle
            const merged = {
              ...last,
              high: Math.max(last.high, price),
              low: Math.min(last.low, price),
              close: price,
            } as CandlestickData<UTCTimestamp>;
            next = [...next.slice(0, -1), merged];
            updated = true;
          }
        }
        // Keep only last 500 candles
        if (next.length > 500) next = next.slice(-500);
        return next;
      });
      
      // Auto-scroll to latest data
      if (updated && chartRef.current) {
        chartRef.current.timeScale().scrollToRealTime();
      }
    };

    const streaming = window.streaming;
    const cockpit = window.cockpit;

    let unsubStreaming: (() => void) | undefined;
    let unsubCockpit: (() => void) | undefined;

    // Try streaming first
    if (typeof streaming?.onEvents === "function") {
      const result = streaming.onEvents(onBatch);
      if (typeof result === "function") unsubStreaming = result;
    } else if (typeof streaming?.subscribeBatch === "function") {
      const result = streaming.subscribeBatch(onBatch);
      if (typeof result === "function") unsubStreaming = result;
    }

    // Fallback to cockpit events
    if (!unsubStreaming && cockpit?.events?.subscribe) {
      const result = cockpit.events.subscribe(onBatch);
      if (typeof result === "function") unsubCockpit = result;
    }

    return () => {
      if (unsubStreaming) unsubStreaming();
      if (unsubCockpit) unsubCockpit();
    };
  }, [symbol]);

  useEffect(() => {
    if (!toolMenu) return;
    const close = () => setToolMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [toolMenu]);

  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    const cleanLine = (line?: PriceLine) => {
      if (line) series.removePriceLine(line);
    };

    cleanLine(openingRangeLines.current.high);
    cleanLine(openingRangeLines.current.low);
    openingRangeLines.current = {};

    if (showOpeningRange && indicator?.openingRange) {
      openingRangeLines.current.high = series.createPriceLine({
        price: indicator.openingRange.high,
        color: "#9d7dff",
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        title: "OR High",
      });
      openingRangeLines.current.low = series.createPriceLine({
        price: indicator.openingRange.low,
        color: "#9d7dff",
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        title: "OR Low",
      });
    }
  }, [indicator?.openingRange, showOpeningRange]);

  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    const clean = (line?: PriceLine) => {
      if (line) series.removePriceLine(line);
    };

    clean(priorDayLines.current.high);
    clean(priorDayLines.current.low);
    clean(priorDayLines.current.close);
    priorDayLines.current = {};

    if (showPriorDay && priorDay) {
      priorDayLines.current.high = series.createPriceLine({
        price: priorDay.high,
        color: "#f59e0b",
        lineStyle: LineStyle.Solid,
        title: "Prior High",
      });
      priorDayLines.current.low = series.createPriceLine({
        price: priorDay.low,
        color: "#f59e0b",
        lineStyle: LineStyle.Solid,
        title: "Prior Low",
      });
      priorDayLines.current.close = series.createPriceLine({
        price: priorDay.close,
        color: "#f59e0b",
        lineStyle: LineStyle.Dotted,
        title: "Prior Close",
      });
    }
  }, [priorDay, showPriorDay]);

  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    const existingIds = Object.keys(levelLines.current);
    for (const id of existingIds) {
      if (!levels.find((lvl) => lvl.id === id)) {
        const line = levelLines.current[id];
        if (line) series.removePriceLine(line);
        delete levelLines.current[id];
      }
    }

    levels.forEach((lvl, idx) => {
      const opts = {
        price: lvl.price,
        color: "#94a3b8",
        lineStyle: LineStyle.Dotted,
        title: lvl.label ?? `Level ${idx + 1}`,
      } as const;

      const existing = levelLines.current[lvl.id];
      if (existing) {
        existing.applyOptions(opts);
      } else {
        levelLines.current[lvl.id] = series.createPriceLine(opts);
      }
    });
  }, [levels]);

  const health = useMemo(() => {
    const deviation = indicator?.vwap?.deviation ?? 0;
    const slope = indicator?.vwap?.slope ?? 0;
    const orRange = indicator?.openingRange ? indicator.openingRange.high - indicator.openingRange.low : null;
    const atr = indicator?.atr?.value ?? null;

    return [
      {
        label: "VWAP bias",
        value: deviation === 0 ? "Flat" : deviation > 0 ? "Above" : "Below",
        detail: `${deviation.toFixed(2)} bps vs VWAP`,
      },
      {
        label: "VWAP slope",
        value: slope === 0 ? "Neutral" : slope > 0 ? "Rising" : "Falling",
        detail: `${slope.toFixed(4)} slope`,
      },
      {
        label: "Opening range",
        value: orRange ? `${orRange.toFixed(2)} pts` : "Building",
        detail: indicator?.openingRange ? "Locked after 5m" : "Waiting for window",
      },
      {
        label: "ATR pulse",
        value: atr ? `${atr.toFixed(2)}` : "—",
        detail: atr ? "14-period ATR" : "Need more bars",
      },
    ];
  }, [indicator]);

  const emptyState = candles.length === 0;

  return (
    <div className="structureChartShell" onContextMenu={(e) => { e.preventDefault(); setToolMenu({ x: e.clientX, y: e.clientY }); }}>
      <div className="structureToolbar">
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span className="structureToolbarLabel" style={{ fontSize: 16, fontWeight: 700 }}>
            📊 {symbol}
          </span>
          <span className="structureToolbarHint" style={{ 
            padding: "4px 8px", 
            background: dataSource === "live" 
              ? "rgba(50, 205, 50, 0.15)" 
              : dataSource === "demo" 
              ? "rgba(255, 165, 0, 0.15)"
              : "rgba(100, 100, 100, 0.15)",
            borderRadius: 4,
            fontSize: 11,
            border: `1px solid ${
              dataSource === "live" 
                ? "rgba(50, 205, 50, 0.3)" 
                : dataSource === "demo"
                ? "rgba(255, 165, 0, 0.3)"
                : "rgba(100, 100, 100, 0.3)"
            }`
          }}>
            {dataSource === "live" ? "🟢 LIVE" : dataSource === "demo" ? "🟠 DEMO" : "⚪ LOADING"}
            {candles.length > 0 && ` • ${candles.length} bars`}
          </span>
          {lastPrice && (
            <span style={{ 
              fontSize: 15, 
              fontWeight: 600, 
              color: "#33d17a",
            }}>
              ${lastPrice.toFixed(2)}
            </span>
          )}
        </div>
        <div className="structureToolbarButtons">
          <label className="structureToggle">
            <input type="checkbox" checked={showVwap} onChange={(e) => setShowVwap(e.target.checked)} /> VWAP
          </label>
          <label className="structureToggle">
            <input type="checkbox" checked={showOpeningRange} onChange={(e) => setShowOpeningRange(e.target.checked)} /> OR H/L
          </label>
          <label className="structureToggle">
            <input type="checkbox" checked={showPriorDay} onChange={(e) => setShowPriorDay(e.target.checked)} /> Prior H/L/C
          </label>
        </div>
      </div>

      <div ref={containerRef} className="structureChartCanvas">
        {emptyState && (
          <div className="structureChartEmpty">
            <div style={{ fontSize: 16, marginBottom: 8 }}>⏳ Loading {symbol} data...</div>
            <div style={{ fontSize: 12, opacity: 0.6 }}>
              Connecting to demo/live stream or generating synthetic data
            </div>
          </div>
        )}
      </div>

      {toolMenu && (
        <div
          className="structureToolMenu"
          style={{ left: toolMenu.x, top: toolMenu.y }}
          onClick={() => setToolMenu(null)}
        >
          <div className="structureToolItem">Trendline (stub)</div>
          <div className="structureToolItem">Ray (stub)</div>
          <div className="structureToolItem">Fib retracement (stub)</div>
          <div className="structureToolItem">Zone (stub)</div>
        </div>
      )}

      <div className="structureHealthRow">
        {health.map((h) => (
          <div key={h.label} className="structureHealthItem">
            <div className="structureHealthLabel">{h.label}</div>
            <div className="structureHealthValue">{h.value}</div>
            <div className="structureHealthDetail">{h.detail}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default StructureChart;

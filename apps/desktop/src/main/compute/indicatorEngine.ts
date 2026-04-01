import type {
  AlphaSignal,
  Bar,
  CapitalMomentumSignal,
  IndicatorUpdate,
  Quote,
  RegimeMode,
  RegimeUpdate,
  TrendDirection,
} from "@tc/shared";
import { capitalMomentumService } from "../services/capitalMomentum/capitalMomentumService";
import { PublicFlowRepo } from "../persistence/publicFlowRepo";
import { CongressRepo } from "../persistence/congressRepo";

interface SymbolState {
  bars: Bar[];
  quotes: Map<number, Quote>;
  vwapSum: number;
  vwapVolume: number;
  sessionStartTs: number;
  sessionStartPrice: number;
  trHistory: number[];
  returnHistory: number[];
  priorDayHLC: IndicatorUpdate["priorDayHLC"];
  orStartTs: number | null;
  orHigh: number | null;
  orLow: number | null;
  emaFast: number | null;
  emaSlow: number | null;
}

/**
 * Indicator Engine - Computes technical indicators from market data
 * Runs in worker thread and produces IndicatorUpdate events
 */
export class IndicatorEngine {
  private symbolStates = new Map<string, SymbolState>();

  private readonly OR_DURATION_MS = 5 * 60 * 1000; // 5m default
  private readonly ATR_PERIOD = 14;
  private readonly VWAP_SLOPE_PERIOD = 10;
  private readonly VOL_PERIOD = 20;

  private readonly EMA_FAST_PERIOD = 8;
  private readonly EMA_SLOW_PERIOD = 21;

  private readonly REGIME_SYMBOL = "SPY";
  private readonly REGIME_EMIT_INTERVAL = 30_000;
  private readonly SIGNAL_EMIT_INTERVAL = 15_000;

  private lastRegimeTs = 0;
  private lastSignalTs = new Map<string, number>();
  private currentRegimeMode: RegimeMode = "mean-reversion-day";

  constructor(private publish: (evt: unknown) => void) {}

  /**
   * Ingest a bar for a symbol
   */
  ingestBar(bar: Bar): IndicatorUpdate | null {
    let state = this.symbolStates.get(bar.symbol);
    if (!state) {
      state = this.initSymbolState(bar);
      this.symbolStates.set(bar.symbol, state);
    }

    state.bars.push(bar);

    // Update VWAP (session to date)
    state.vwapSum += bar.close * bar.volume;
    state.vwapVolume += bar.volume;

    // Track opening range
    if (!state.orStartTs) {
      state.orStartTs = bar.ts;
      state.orHigh = bar.high;
      state.orLow = bar.low;
    } else if (bar.ts - state.orStartTs < this.OR_DURATION_MS) {
      state.orHigh = Math.max(state.orHigh!, bar.high);
      state.orLow = Math.min(state.orLow!, bar.low);
    }

    // Calculate True Range for ATR
    if (state.bars.length > 1) {
      const prev = state.bars[state.bars.length - 2];
      if (prev) {
        const tr = Math.max(
          bar.high - bar.low,
          Math.abs(bar.high - prev.close),
          Math.abs(bar.low - prev.close),
        );
        state.trHistory.push(tr);

        // Calculate log return
        const ret = Math.log(bar.close / prev.close);
        state.returnHistory.push(ret);
      }
    }

    // Update EMAs for trend detection
    state.emaFast = this.updateEma(
      state.emaFast,
      bar.close,
      this.EMA_FAST_PERIOD,
    );
    state.emaSlow = this.updateEma(
      state.emaSlow,
      bar.close,
      this.EMA_SLOW_PERIOD,
    );

    const update = this.computeUpdate(bar.symbol, bar.ts, state);

    this.maybeEmitRegime(bar.symbol, bar.ts, state, update);
    this.maybeEmitAlphaSignal(bar.symbol, bar.ts, state, update);

    return update;
  }

  private initSymbolState(firstBar: Bar): SymbolState {
    return {
      bars: [firstBar],
      quotes: new Map(),
      vwapSum: firstBar.close * firstBar.volume,
      vwapVolume: firstBar.volume,
      sessionStartTs: firstBar.ts,
      sessionStartPrice: firstBar.close,
      trHistory: [],
      returnHistory: [],
      priorDayHLC: this.getMockPriorDayHLC(firstBar.symbol),
      orStartTs: firstBar.ts,
      orHigh: firstBar.high,
      orLow: firstBar.low,
      emaFast: firstBar.close,
      emaSlow: firstBar.close,
    };
  }

  private computeUpdate(
    symbol: string,
    ts: number,
    state: SymbolState,
  ): IndicatorUpdate {
    const vwap = this.computeVWAP(state);
    const orUpdate = this.computeOpeningRange(state);
    const atr = this.computeATR(state);
    const vol = this.computeRealizedVol(state);

    return {
      type: "compute.indicator.update",
      ts,
      symbol,
      openingRange: orUpdate,
      vwap,
      atr,
      realizedVol: vol,
      priorDayHLC: state.priorDayHLC,
    };
  }

  private computeVWAP(state: SymbolState): IndicatorUpdate["vwap"] {
    if (state.vwapVolume === 0) return null;

    const value = state.vwapSum / state.vwapVolume;
    const slope = this.computeVWAPSlope(state);
    const lastBar = state.bars[state.bars.length - 1];
    if (!lastBar) return null;

    const deviation = ((lastBar.close - value) / value) * 10000; // basis points

    return {
      value,
      slope,
      deviation,
      tooltip: "Session VWAP with 10-bar slope and price deviation (bps).",
    };
  }

  private computeVWAPSlope(state: SymbolState): number {
    if (state.bars.length < this.VWAP_SLOPE_PERIOD) return 0;

    const recent = state.bars.slice(-this.VWAP_SLOPE_PERIOD);
    const vwaps: number[] = [];

    let cumSum = 0;
    let cumVol = 0;
    for (const bar of recent) {
      cumSum += bar.close * bar.volume;
      cumVol += bar.volume;
      vwaps.push(cumVol > 0 ? cumSum / cumVol : bar.close);
    }

    // Simple linear regression slope
    const n = vwaps.length;
    if (n === 0) return 0;

    const xMean = (n - 1) / 2;
    const yMean = vwaps.reduce((a, b) => a + b, 0) / n;

    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < n; i++) {
      const vwap = vwaps[i];
      if (vwap !== undefined) {
        const dx = i - xMean;
        const dy = vwap - yMean;
        numerator += dx * dy;
        denominator += dx * dx;
      }
    }

    return denominator === 0 ? 0 : numerator / denominator;
  }

  private computeOpeningRange(
    state: SymbolState,
  ): IndicatorUpdate["openingRange"] {
    if (!state.orStartTs || state.orHigh === null || state.orLow === null) {
      return null;
    }

    const currentBar = state.bars[state.bars.length - 1];
    if (!currentBar) return null;

    const elapsed = currentBar.ts - state.orStartTs;

    const withinWindow = elapsed <= this.OR_DURATION_MS;
    return {
      high: state.orHigh,
      low: state.orLow,
      duration: this.OR_DURATION_MS,
      tooltip: withinWindow
        ? "Opening range high/low for the first 5 minutes of the session."
        : "Opening range high/low (frozen after the first 5 minutes).",
    };
  }

  private computeATR(state: SymbolState): IndicatorUpdate["atr"] {
    if (state.trHistory.length < this.ATR_PERIOD) {
      if (state.trHistory.length === 0) return null;
      // Use SMA of available data
      const avg =
        state.trHistory.reduce((a, b) => a + b) / state.trHistory.length;
      return {
        value: avg,
        period: state.trHistory.length,
        tooltip: "ATR: SMA of true range (period 14 default).",
      };
    }

    const recent = state.trHistory.slice(-this.ATR_PERIOD);
    const atr = recent.reduce((a, b) => a + b) / this.ATR_PERIOD;

    return {
      value: atr,
      period: this.ATR_PERIOD,
      tooltip: "ATR: SMA of true range (period 14 default).",
    };
  }

  private computeRealizedVol(
    state: SymbolState,
  ): IndicatorUpdate["realizedVol"] {
    if (state.returnHistory.length < this.VOL_PERIOD) {
      if (state.returnHistory.length === 0) return null;

      const mean =
        state.returnHistory.reduce((a, b) => a + b) /
        state.returnHistory.length;
      const variance =
        state.returnHistory.reduce((a, r) => a + Math.pow(r - mean, 2), 0) /
        state.returnHistory.length;
      const stdev = Math.sqrt(variance);
      const annualized = stdev * Math.sqrt(252);

      return {
        value: stdev,
        period: state.returnHistory.length,
        annualized,
        tooltip: "Rolling stdev of log returns; annualized via sqrt(252).",
      };
    }

    const recent = state.returnHistory.slice(-this.VOL_PERIOD);
    const mean = recent.reduce((a, b) => a + b) / this.VOL_PERIOD;
    const variance =
      recent.reduce((a, r) => a + Math.pow(r - mean, 2), 0) / this.VOL_PERIOD;
    const stdev = Math.sqrt(variance);
    const annualized = stdev * Math.sqrt(252);

    return {
      value: stdev,
      period: this.VOL_PERIOD,
      annualized,
      tooltip: "Rolling stdev of log returns; annualized via sqrt(252).",
    };
  }

  private updateEma(
    current: number | null,
    value: number,
    period: number,
  ): number {
    const k = 2 / (period + 1);
    if (current === null || Number.isNaN(current)) return value;
    return current + k * (value - current);
  }

  private clamp(x: number, min: number, max: number): number {
    if (x < min) return min;
    if (x > max) return max;
    return x;
  }

  private maybeEmitRegime(
    symbol: string,
    ts: number,
    state: SymbolState,
    update: IndicatorUpdate,
  ) {
    if (symbol !== this.REGIME_SYMBOL) return;
    if (ts - this.lastRegimeTs < this.REGIME_EMIT_INTERVAL) return;

    const regime = this.classifyRegime(ts, state, update);
    if (!regime) return;

    this.lastRegimeTs = ts;
    this.currentRegimeMode = regime.mode;
    this.publish(regime);
  }

  private classifyRegime(
    ts: number,
    state: SymbolState,
    update: IndicatorUpdate,
  ): RegimeUpdate | null {
    const lastBar = state.bars[state.bars.length - 1];
    if (!lastBar || !update.vwap) return null;

    const emaFast = state.emaFast ?? lastBar.close;
    const emaSlow = state.emaSlow ?? lastBar.close;
    const slope = emaSlow !== 0 ? ((emaFast - emaSlow) / emaSlow) * 10000 : 0;
    const vol = update.realizedVol?.value ?? null;
    const volZ = vol !== null ? vol / Math.max(0.0004, 1e-6) : null; // baseline 40bps

    let trendDirection: TrendDirection = "flat";
    if (emaFast > emaSlow * 1.001) trendDirection = "up";
    else if (emaFast < emaSlow * 0.999) trendDirection = "down";
    else trendDirection = "flat";

    let mode: RegimeMode = "mean-reversion-day";
    if ((volZ ?? 0) > 1.5) {
      mode = "high-vol-risk-off";
    } else if (slope > 6 && (update.vwap.slope ?? 0) >= 0) {
      mode = "trend-day";
    } else {
      mode = "mean-reversion-day";
    }

    const slopeStrength = this.clamp(Math.abs(slope) / 12, 0, 1);
    const volPenalty = mode === "high-vol-risk-off" ? 0.4 : 0;
    const confidence = this.clamp(
      0.35 + slopeStrength * 0.4 - volPenalty,
      0.2,
      0.95,
    );

    const notes: string[] = [];
    notes.push(`EMA slope ${slope.toFixed(1)}bps`);
    if (vol !== null) notes.push(`Realized vol ${(vol * 100).toFixed(2)}%`);
    if (mode === "high-vol-risk-off") notes.push("Risk-off: vol spike");
    if (mode === "trend-day" && slope > 0) notes.push("Trend bias up");
    if (mode === "trend-day" && slope < 0) notes.push("Trend bias down");

    return {
      type: "compute.regime.update",
      ts,
      source: "compute",
      mode,
      trendDirection,
      volState:
        volZ !== null
          ? volZ > 1.5
            ? "high"
            : volZ < 0.7
              ? "low"
              : "normal"
          : "normal",
      confidence,
      indexSymbol: this.REGIME_SYMBOL,
      features: {
        indexSlope: slope,
        emaFast,
        emaSlow,
        realizedVol: vol,
        volZScore: volZ,
        spreadPct: null,
        breadthAboveVwap: null,
      },
      notes,
    };
  }

  private maybeEmitAlphaSignal(
    symbol: string,
    ts: number,
    state: SymbolState,
    update: IndicatorUpdate,
  ) {
    const lastTs = this.lastSignalTs.get(symbol) ?? 0;
    if (ts - lastTs < this.SIGNAL_EMIT_INTERVAL) return;

    const alpha = this.buildAlphaSignal(symbol, ts, state, update);
    if (!alpha) return;

    this.lastSignalTs.set(symbol, ts);
    this.publish(alpha);

    const cam = this.buildCamSignal(symbol, ts, state, update);
    if (cam) this.publish(cam);
  }

  private buildCamSignal(
    symbol: string,
    ts: number,
    state: SymbolState,
    update: IndicatorUpdate,
  ): CapitalMomentumSignal | null {
    const lastBar = state.bars[state.bars.length - 1];
    if (!lastBar) return null;

    const bars20 = state.bars.slice(-20);
    const highest20 =
      bars20.length > 0 ? Math.max(...bars20.map((b) => b.high)) : lastBar.high;
    const close20HighDistancePct =
      highest20 > 0 ? (highest20 - lastBar.close) / highest20 : 0;

    const volBars = state.bars.slice(-20);
    const avgVol20 =
      volBars.length > 0
        ? volBars.reduce((sum, b) => sum + b.volume, 0) / volBars.length
        : lastBar.volume;
    const volumeRatio = avgVol20 > 0 ? lastBar.volume / avgVol20 : 1;

    const breakoutStrength =
      close20HighDistancePct <= 0.001
        ? this.clamp(0.5 + (volumeRatio - 1) * 0.25, 0, 1)
        : 0;
    const relativeStrength =
      (state.emaSlow ?? lastBar.close) > 0
        ? ((state.emaFast ?? lastBar.close) -
            (state.emaSlow ?? lastBar.close)) /
          (state.emaSlow ?? lastBar.close)
        : 0;

    const asOfIso = new Date(ts).toISOString();
    const flowSnapshot = PublicFlowRepo.getTickerFlowSnapshotAsOf(
      symbol,
      asOfIso,
    );
    const congressSnapshot = CongressRepo.getTickerCongressNetBuyAsOf(
      symbol,
      asOfIso,
    );

    const fallbackObservedAt = asOfIso;
    const publicFlowObservedAt =
      flowSnapshot.observedAt.publicFlow ?? fallbackObservedAt;
    const themeObservedAt = flowSnapshot.observedAt.theme ?? fallbackObservedAt;
    const congressObservedAt =
      congressSnapshot.observedAt ?? fallbackObservedAt;
    const secondOrderObservedAt =
      flowSnapshot.observedAt.secondOrder ?? fallbackObservedAt;
    const congressTransactionDate = congressSnapshot.transactionDate
      ? this.parseIsoToMs(congressSnapshot.transactionDate, ts)
      : null;
    const congressDisclosureDate = congressSnapshot.disclosureDate
      ? this.parseIsoToMs(congressSnapshot.disclosureDate, ts)
      : null;

    return capitalMomentumService.evaluate({
      symbol,
      ts,
      regimeMode: this.currentRegimeMode,
      price: lastBar.close,
      atr: update.atr?.value ?? null,
      realizedVol: update.realizedVol?.value ?? null,
      emaFast: state.emaFast ?? lastBar.close,
      emaSlow: state.emaSlow ?? lastBar.close,
      close20HighDistancePct,
      relativeStrength,
      breakoutStrength,
      volumeRatio,
      priorClose: state.priorDayHLC?.close ?? null,
      barIntervalMs: 60_000,
      flow: {
        publicFlowBuy: flowSnapshot.publicFlowBuy,
        themeAccel: flowSnapshot.themeAccel,
        congressNetBuy: congressSnapshot.congressNetBuy,
        secondOrderMomentum: flowSnapshot.secondOrderMomentum,
        observedAt: {
          publicFlow: this.parseIsoToMs(publicFlowObservedAt, ts),
          theme: this.parseIsoToMs(themeObservedAt, ts),
          congress: this.parseIsoToMs(congressObservedAt, ts),
          secondOrder: this.parseIsoToMs(secondOrderObservedAt, ts),
        },
      },
      congressTradeTiming: {
        transactionDate: congressTransactionDate,
        disclosureDate: congressDisclosureDate,
      },
    });
  }

  private parseIsoToMs(iso: string, fallbackTs: number): number {
    const parsed = Date.parse(iso);
    if (Number.isNaN(parsed)) return fallbackTs;
    return parsed;
  }

  private buildAlphaSignal(
    symbol: string,
    ts: number,
    state: SymbolState,
    update: IndicatorUpdate,
  ): AlphaSignal | null {
    const lastBar = state.bars[state.bars.length - 1];
    if (!lastBar || !update.vwap) return null;

    const price = lastBar.close;
    const vwap = update.vwap.value;
    const vwapDevBps = update.vwap.deviation ?? 0;
    const realizedVol = update.realizedVol?.value ?? null;
    const atr = update.atr?.value ?? null;

    const zEntryBps = 40;
    const s1 = this.clamp(-vwapDevBps / Math.max(zEntryBps, 1), -1, 1);

    const emaSlow = state.emaSlow ?? price;
    const emaFast = state.emaFast ?? price;
    const slopeBps =
      emaSlow !== 0 ? ((emaFast - emaSlow) / emaSlow) * 10000 : 0;
    const pullbackBps = ((price - emaFast) / price) * 10000;
    const s2 = this.clamp(slopeBps / 10 - pullbackBps / 15, -1, 1);

    const rangeExpansion =
      atr && state.sessionStartPrice ? atr / state.sessionStartPrice : null;
    const s3 = rangeExpansion
      ? this.clamp((rangeExpansion - 0.005) * 20, -1, 1)
      : 0;

    let composite = 0;
    if (this.currentRegimeMode === "trend-day") {
      composite = 0.6 * s2 + 0.4 * s3;
    } else if (this.currentRegimeMode === "mean-reversion-day") {
      composite = 0.8 * s1 + 0.2 * s3;
    } else {
      composite = 0.3 * ((s1 + s2) / 2);
    }

    const featureCount = [update.vwap, update.atr, update.realizedVol].filter(
      Boolean,
    ).length;
    const compositeConfidence = this.clamp(
      0.3 + featureCount * 0.15 + Math.min(0.3, Math.abs(composite) * 0.3),
      0.3,
      0.95,
    );

    const riskBudgetPerSymbol = 5_000;
    const targetVol = 0.02;
    const volScale = realizedVol
      ? this.clamp(targetVol / Math.max(realizedVol, 1e-4), 0.5, 2.5)
      : 1;
    const targetDollars = composite * riskBudgetPerSymbol * volScale;

    const spreadBps = 5;
    const targetShares = Math.max(
      0,
      Math.abs(targetDollars) / Math.max(price, 1e-6),
    );
    const expectedMove = Math.abs(composite) * price * 0.002; // 20bps move proxy
    const expectedEdge = expectedMove * targetShares;
    const expectedCost = (spreadBps / 10000) * price * targetShares + 0.5; // +fees buffer
    const allowed = expectedEdge > expectedCost * 1.1;

    const reasons: string[] = [];
    reasons.push(`VWAP dev ${vwapDevBps.toFixed(1)}bps`);
    reasons.push(`EMA slope ${slopeBps.toFixed(1)}bps`);
    if (rangeExpansion !== null)
      reasons.push(`Range ${(rangeExpansion * 100).toFixed(2)}%`);
    reasons.push(allowed ? "Edge > cost" : "Edge <= cost");

    return {
      type: "compute.alpha.signal",
      ts,
      symbol,
      regimeMode: this.currentRegimeMode,
      compositeScore: composite,
      compositeConfidence,
      signals: [
        {
          id: "vwap-mean-revert",
          score: s1,
          confidence: compositeConfidence,
          detail: "VWAP deviation",
        },
        {
          id: "trend-pullback",
          score: s2,
          confidence: compositeConfidence,
          detail: "EMA slope & pullback",
        },
        {
          id: "vol-breakout-filter",
          score: s3,
          confidence: compositeConfidence,
          detail: "Range expansion filter",
        },
      ],
      sizing: {
        targetDollars,
        volScale,
        riskBudgetPerSymbol,
        grossExposureCap: 50_000,
        perSymbolCap: 10_000,
      },
      execution: {
        allowed,
        orderType: Math.abs(composite) > 0.6 ? "aggressive" : "passive",
        maxSlippageBps: 8,
        expectedEdgeDollars: expectedEdge,
        expectedCostDollars: expectedCost,
        reasons,
      },
      features: {
        vwapZ:
          vwap !== 0 && realizedVol
            ? (price - vwap) / (vwap * Math.max(realizedVol, 1e-4))
            : null,
        realizedVol,
        atr,
        spreadPct: spreadBps / 10000,
        volumeAnomaly: null,
        rangeExpansion,
      },
    };
  }

  /**
   * Mock prior day data (in production, load from persistent store/db)
   */
  private getMockPriorDayHLC(symbol: string): IndicatorUpdate["priorDayHLC"] {
    // Mock data for common symbols
    const mocks: Record<string, { high: number; low: number; close: number }> =
      {
        AAPL: { high: 235.5, low: 230.2, close: 232.8 },
        MSFT: { high: 420.3, low: 405.1, close: 418.5 },
        TSLA: { high: 280.9, low: 265.4, close: 275.2 },
      };

    const base = mocks[symbol];
    if (!base) return null;
    return {
      ...base,
      tooltip: "Prior day high/low/close (mocked if dataset missing).",
    };
  }
}

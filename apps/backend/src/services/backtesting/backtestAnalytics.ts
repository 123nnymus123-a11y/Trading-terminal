import type {
  FillRecord,
  Order,
  PositionRecord,
  SimulatedTrade,
} from "./advancedBacktestEngine.js";
import type { OHLCVBar } from "./historicalDataProvider.js";

export type EquityPoint = { timestamp: string; value: number };
export type ExposurePoint = {
  timestamp: string;
  grossExposure: number;
  netExposure: number;
  longExposure: number;
  shortExposure: number;
  cash: number;
  turnoverPct: number;
  drawdownPct: number;
};

export type MonthlyReturn = {
  month: string;
  returnPct: number;
};

export type LongShortDecomposition = {
  longPnL: number;
  shortPnL: number;
  longTrades: number;
  shortTrades: number;
};

export type TailRiskMetrics = {
  valueAtRisk95: number;
  expectedShortfall95: number;
  downsideDeviation: number;
  tailRatio: number;
};

export type AttributionEntry = {
  key: string;
  grossExposurePct: number;
  pnlContribution: number;
};

export type AlphaBetaMetrics = {
  alpha: number | null;
  beta: number | null;
  benchmarkSymbol: string | null;
  correlation: number | null;
  benchmarkTotalReturn: number | null;
};

export type AdvancedBacktestMetrics = {
  cagr: number;
  annualizedVolatility: number;
  sortinoRatio: number;
  calmarRatio: number;
  turnoverPct: number;
  averageHoldingPeriodBars: number;
  exposureUtilizationPct: number;
  expectancy: number;
  longShort: LongShortDecomposition;
  tailRisk: TailRiskMetrics;
  alphaBeta: AlphaBetaMetrics;
  sectorAttribution: AttributionEntry[];
  factorAttribution: AttributionEntry[];
  monthlyReturns: MonthlyReturn[];
};

export type RunComparisonMetrics = {
  runId: string;
  baselineRunId: string;
  deltas: Record<string, number>;
  improved: string[];
  degraded: string[];
};

function round(value: number, digits = 4): number {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

function buildReturns(equityCurve: EquityPoint[]): number[] {
  const returns: number[] = [];
  for (let index = 1; index < equityCurve.length; index++) {
    const previous = equityCurve[index - 1];
    const current = equityCurve[index];
    if (!previous || !current || previous.value <= 0) {
      continue;
    }
    returns.push((current.value - previous.value) / previous.value);
  }
  return returns;
}

function stdDev(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) /
    values.length;
  return Math.sqrt(variance);
}

function covariance(left: number[], right: number[]): number {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0;
  }
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let total = 0;
  for (let index = 0; index < left.length; index++) {
    total += (left[index]! - leftMean) * (right[index]! - rightMean);
  }
  return total / left.length;
}

function correlation(left: number[], right: number[]): number | null {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return null;
  }
  const denom = stdDev(left) * stdDev(right);
  if (denom === 0) {
    return null;
  }
  return covariance(left, right) / denom;
}

function monthlyReturns(equityCurve: EquityPoint[]): MonthlyReturn[] {
  const buckets = new Map<string, { start: number; end: number }>();
  for (const point of equityCurve) {
    const month = point.timestamp.slice(0, 7);
    const existing = buckets.get(month);
    if (!existing) {
      buckets.set(month, { start: point.value, end: point.value });
    } else {
      existing.end = point.value;
    }
  }
  return Array.from(buckets.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, value]) => ({
      month,
      returnPct:
        value.start > 0 ? round((value.end - value.start) / value.start, 6) : 0,
    }));
}

function averageHoldingPeriod(trades: SimulatedTrade[]): number {
  const openLots = new Map<
    string,
    Array<{ timestamp: string; quantity: number }>
  >();
  const periods: number[] = [];
  for (const trade of trades) {
    const lots = openLots.get(trade.symbol) ?? [];
    if (trade.side === "buy") {
      lots.push({ timestamp: trade.timestamp, quantity: trade.quantity });
      openLots.set(trade.symbol, lots);
      continue;
    }
    let remaining = trade.quantity;
    while (remaining > 0 && lots.length > 0) {
      const lot = lots[0]!;
      const matched = Math.min(lot.quantity, remaining);
      const start = new Date(lot.timestamp).getTime();
      const end = new Date(trade.timestamp).getTime();
      const bars = Math.max(
        1,
        Math.round((end - start) / (24 * 60 * 60 * 1000)),
      );
      periods.push(bars);
      lot.quantity -= matched;
      remaining -= matched;
      if (lot.quantity <= 0) {
        lots.shift();
      }
    }
    openLots.set(trade.symbol, lots);
  }
  if (periods.length === 0) {
    return 0;
  }
  return round(
    periods.reduce((sum, value) => sum + value, 0) / periods.length,
    2,
  );
}

function tailRiskMetrics(returns: number[]): TailRiskMetrics {
  if (returns.length === 0) {
    return {
      valueAtRisk95: 0,
      expectedShortfall95: 0,
      downsideDeviation: 0,
      tailRatio: 0,
    };
  }
  const sorted = returns.slice().sort((a, b) => a - b);
  const varIndex = Math.max(0, Math.floor(sorted.length * 0.05) - 1);
  const valueAtRisk95 = sorted[varIndex] ?? 0;
  const tail = sorted.filter((value) => value <= valueAtRisk95);
  const expectedShortfall95 =
    tail.length > 0
      ? tail.reduce((sum, value) => sum + value, 0) / tail.length
      : valueAtRisk95;
  const downside = returns.filter((value) => value < 0);
  const downsideDeviation = stdDev(downside);
  const positives = returns.filter((value) => value > 0);
  const positives95 = positives.slice().sort((a, b) => a - b);
  const upsideIndex = Math.floor(positives95.length * 0.95) - 1;
  const upside = upsideIndex >= 0 ? (positives95[upsideIndex] ?? 0) : 0;
  const tailRatio = valueAtRisk95 !== 0 ? Math.abs(upside / valueAtRisk95) : 0;
  return {
    valueAtRisk95: round(valueAtRisk95, 6),
    expectedShortfall95: round(expectedShortfall95, 6),
    downsideDeviation: round(downsideDeviation, 6),
    tailRatio: round(tailRatio, 6),
  };
}

function attributionFromExposure(
  exposureCurve: ExposurePoint[],
  positions: PositionRecord[],
  mapping: Record<string, string | Record<string, number>> | undefined,
): AttributionEntry[] {
  if (!mapping || Object.keys(mapping).length === 0) {
    return [];
  }
  const totalAbsExposure = exposureCurve.reduce(
    (sum, point) => sum + Math.abs(point.grossExposure),
    0,
  );
  if (totalAbsExposure <= 0) {
    return [];
  }
  const byKey = new Map<string, { exposure: number; pnl: number }>();
  for (const position of positions) {
    const mappingValue = mapping[position.symbol];
    if (typeof mappingValue === "string") {
      const current = byKey.get(mappingValue) ?? { exposure: 0, pnl: 0 };
      current.exposure += Math.abs(position.quantity * position.avgCostBasis);
      current.pnl += position.realizedPnL + position.unrealizedPnL;
      byKey.set(mappingValue, current);
      continue;
    }
    if (mappingValue && typeof mappingValue === "object") {
      for (const [key, weight] of Object.entries(mappingValue)) {
        const current = byKey.get(key) ?? { exposure: 0, pnl: 0 };
        current.exposure +=
          Math.abs(position.quantity * position.avgCostBasis) * Number(weight);
        current.pnl +=
          (position.realizedPnL + position.unrealizedPnL) * Number(weight);
        byKey.set(key, current);
      }
    }
  }
  return Array.from(byKey.entries())
    .map(([key, value]) => ({
      key,
      grossExposurePct: round(value.exposure / totalAbsExposure, 6),
      pnlContribution: round(value.pnl, 4),
    }))
    .sort((left, right) => right.grossExposurePct - left.grossExposurePct);
}

function computeAlphaBeta(
  equityCurve: EquityPoint[],
  benchmarkBars: OHLCVBar[] | undefined,
  benchmarkSymbol: string | undefined,
): AlphaBetaMetrics {
  if (!benchmarkBars || benchmarkBars.length < 2) {
    return {
      alpha: null,
      beta: null,
      benchmarkSymbol: benchmarkSymbol ?? null,
      correlation: null,
      benchmarkTotalReturn: null,
    };
  }
  const benchmarkReturns = buildReturns(
    benchmarkBars.map((bar) => ({
      timestamp: bar.timestamp,
      value: bar.close,
    })),
  );
  const strategyReturns = buildReturns(equityCurve).slice(
    0,
    benchmarkReturns.length,
  );
  const alignedBenchmark = benchmarkReturns.slice(0, strategyReturns.length);
  if (strategyReturns.length === 0 || alignedBenchmark.length === 0) {
    return {
      alpha: null,
      beta: null,
      benchmarkSymbol: benchmarkSymbol ?? null,
      correlation: null,
      benchmarkTotalReturn: null,
    };
  }
  const betaDenom = Math.pow(stdDev(alignedBenchmark), 2);
  const beta =
    betaDenom > 0
      ? covariance(strategyReturns, alignedBenchmark) / betaDenom
      : null;
  const strategyMean =
    strategyReturns.reduce((sum, value) => sum + value, 0) /
    strategyReturns.length;
  const benchmarkMean =
    alignedBenchmark.reduce((sum, value) => sum + value, 0) /
    alignedBenchmark.length;
  const alpha = beta !== null ? strategyMean - beta * benchmarkMean : null;
  const benchmarkTotalReturn =
    benchmarkBars[0] && benchmarkBars[benchmarkBars.length - 1]
      ? (benchmarkBars[benchmarkBars.length - 1]!.close -
          benchmarkBars[0]!.close) /
        benchmarkBars[0]!.close
      : null;
  return {
    alpha: alpha === null ? null : round(alpha * 252, 6),
    beta: beta === null ? null : round(beta, 6),
    benchmarkSymbol: benchmarkSymbol ?? null,
    correlation: correlation(strategyReturns, alignedBenchmark),
    benchmarkTotalReturn:
      benchmarkTotalReturn === null ? null : round(benchmarkTotalReturn, 6),
  };
}

export function computeAdvancedBacktestMetrics(input: {
  equityCurve: EquityPoint[];
  trades: SimulatedTrade[];
  fills: FillRecord[];
  orders: Order[];
  positions: PositionRecord[];
  exposureCurve: ExposurePoint[];
  startingCapital: number;
  endingCapital: number;
  benchmarkBars?: OHLCVBar[];
  benchmarkSymbol?: string;
  sectorMap?: Record<string, string>;
  factorMap?: Record<string, Record<string, number>>;
  peakDrawdownPct?: number;
}): AdvancedBacktestMetrics {
  const returns = buildReturns(input.equityCurve);
  const years = Math.max(
    1 / 252,
    (new Date(
      input.equityCurve[input.equityCurve.length - 1]?.timestamp ?? Date.now(),
    ).getTime() -
      new Date(input.equityCurve[0]?.timestamp ?? Date.now()).getTime()) /
      (365.25 * 24 * 60 * 60 * 1000),
  );
  const totalReturn =
    input.startingCapital > 0
      ? (input.endingCapital - input.startingCapital) / input.startingCapital
      : 0;
  const cagr = Math.pow(1 + totalReturn, 1 / years) - 1;
  const annualizedVolatility = stdDev(returns) * Math.sqrt(252);
  const downside = returns.filter((value) => value < 0);
  const downsideDeviation = stdDev(downside) * Math.sqrt(252);
  const sortinoRatio = downsideDeviation > 0 ? cagr / downsideDeviation : 0;
  const maxDrawdown = Math.max(0.000001, input.peakDrawdownPct ?? 0);
  const calmarRatio = maxDrawdown > 0 ? cagr / maxDrawdown : 0;
  const turnoverPct =
    input.exposureCurve.length > 0
      ? input.exposureCurve.reduce((sum, value) => sum + value.turnoverPct, 0) /
        input.exposureCurve.length
      : 0;
  const exposureUtilizationPct =
    input.exposureCurve.length > 0
      ? input.exposureCurve.reduce(
          (sum, value) => sum + value.grossExposure,
          0,
        ) / input.exposureCurve.length
      : 0;
  const wins = input.trades.filter((item) => (item.realizedPnL ?? 0) > 0);
  const losses = input.trades.filter((item) => (item.realizedPnL ?? 0) < 0);
  const expectancy =
    input.trades.length > 0
      ? input.trades.reduce((sum, item) => sum + (item.realizedPnL ?? 0), 0) /
        input.trades.length
      : 0;
  const longPnL = input.trades
    .filter((item) => item.side === "sell")
    .reduce((sum, item) => sum + (item.realizedPnL ?? 0), 0);
  const shortPnL = input.positions
    .filter((item) => item.direction === "short")
    .reduce((sum, item) => sum + item.realizedPnL + item.unrealizedPnL, 0);

  return {
    cagr: round(cagr, 6),
    annualizedVolatility: round(annualizedVolatility, 6),
    sortinoRatio: round(sortinoRatio, 6),
    calmarRatio: round(calmarRatio, 6),
    turnoverPct: round(turnoverPct, 6),
    averageHoldingPeriodBars: averageHoldingPeriod(input.trades),
    exposureUtilizationPct: round(exposureUtilizationPct, 6),
    expectancy: round(expectancy, 4),
    longShort: {
      longPnL: round(longPnL, 4),
      shortPnL: round(shortPnL, 4),
      longTrades: input.trades.filter((item) => item.side === "buy").length,
      shortTrades: input.trades.filter((item) => item.side === "sell").length,
    },
    tailRisk: tailRiskMetrics(returns),
    alphaBeta: computeAlphaBeta(
      input.equityCurve,
      input.benchmarkBars,
      input.benchmarkSymbol,
    ),
    sectorAttribution: attributionFromExposure(
      input.exposureCurve,
      input.positions,
      input.sectorMap,
    ),
    factorAttribution: attributionFromExposure(
      input.exposureCurve,
      input.positions,
      input.factorMap,
    ),
    monthlyReturns: monthlyReturns(input.equityCurve),
  };
}

export function compareRunMetrics(input: {
  runId: string;
  baselineRunId: string;
  runMetrics: Record<string, unknown>;
  baselineMetrics: Record<string, unknown>;
  trackedFields: string[];
}): RunComparisonMetrics {
  const deltas: Record<string, number> = {};
  const improved: string[] = [];
  const degraded: string[] = [];
  for (const field of input.trackedFields) {
    const current = Number(input.runMetrics[field]);
    const baseline = Number(input.baselineMetrics[field]);
    if (!Number.isFinite(current) || !Number.isFinite(baseline)) {
      continue;
    }
    const delta = current - baseline;
    deltas[field] = round(delta, 6);
    const lowerIsBetter =
      field.toLowerCase().includes("drawdown") ||
      field.toLowerCase().includes("vol") ||
      field.toLowerCase().includes("turnover");
    if (delta === 0) {
      continue;
    }
    if ((lowerIsBetter && delta < 0) || (!lowerIsBetter && delta > 0)) {
      improved.push(field);
    } else {
      degraded.push(field);
    }
  }
  return {
    runId: input.runId,
    baselineRunId: input.baselineRunId,
    deltas,
    improved,
    degraded,
  };
}

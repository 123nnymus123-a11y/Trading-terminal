import type {
  IHistoricalDataProvider,
  OHLCVBar,
} from "./historicalDataProvider.js";
import type {
  IStrategyExecutor,
  StrategyContext,
  TradeSignal,
} from "./scriptExecutor.js";
import { detectTimeframe, groupBarsBySymbol } from "./timeframeUtils.js";
import { createLogger } from "../../logger.js";

const logger = createLogger("advanced-backtest-engine");

export type OrderState =
  | "pending"
  | "open"
  | "partial"
  | "filled"
  | "rejected"
  | "cancelled";

export type OrderType = "market" | "limit" | "stop" | "stop_limit";
export type OrderSide = "buy" | "sell";

export type Order = {
  orderId: string;
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  quantity: number;
  limitPrice: number | null;
  stopPrice: number | null;
  state: OrderState;
  filledQty: number;
  submittedAt: string;
  updatedAt: string;
  rejectReason?: string;
  cancelReason?: string;
  metadata?: Record<string, unknown>;
};

export type FillRecord = {
  fillId: string;
  orderId: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  price: number;
  fees: number;
  slippage: number;
  spreadCost: number;
  marketImpact: number;
  timestamp: string;
};

export type PositionDirection = "long" | "short" | "flat";

export type PositionRecord = {
  symbol: string;
  quantity: number;
  direction: PositionDirection;
  avgCostBasis: number;
  realizedPnL: number;
  unrealizedPnL: number;
  accruedBorrow: number;
  sector?: string;
  industry?: string;
};

export type SimulatedTrade = {
  timestamp: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  fees: number;
  slippage: number;
  orderId?: string;
  partial?: boolean;
  realizedPnL?: number;
};

export type ExposurePoint = {
  timestamp: string;
  cash: number;
  equity: number;
  grossExposure: number;
  netExposure: number;
  longExposure: number;
  shortExposure: number;
  turnoverPct: number;
  drawdownPct: number;
};

export type BacktestDiagnostic = {
  code: string;
  severity: "info" | "warning" | "error";
  timestamp?: string;
  symbol?: string;
  message: string;
};

export type BacktestMetrics = {
  totalReturn: number;
  annualizedReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  numTrades: number;
  winningTrades: number;
  losingTrades: number;
  averageWinSize: number;
  averageLossSize: number;
  profitFactor: number;
  startDate: string;
  endDate: string;
  startingCapital: number;
  endingCapital: number;
  totalRealizedPnL: number;
  grossLeverage: number;
  peakGrossLeverage: number;
  totalFees: number;
  totalSlippage: number;
  totalBorrowCharges: number;
  shortTrades: number;
  winRate: number;
  annualizedVolatility: number;
  exposureUtilizationPct: number;
  turnoverPct: number;
  averageHoldingPeriodBars: number;
  expectancy: number;
};

export type BacktestResult = {
  success: boolean;
  metrics: BacktestMetrics | null;
  trades: SimulatedTrade[];
  fills: FillRecord[];
  orders: Order[];
  positions: PositionRecord[];
  equityCurve: Array<{ timestamp: string; value: number }>;
  exposureCurve: ExposurePoint[];
  diagnostics: BacktestDiagnostic[];
  errors: string[];
};

type SymbolClassification = {
  sector?: string;
  industry?: string;
};

type RiskControls = {
  maxPositionWeightPct: number;
  maxSectorExposurePct: number;
  maxIndustryExposurePct: number;
  maxGrossExposurePct: number;
  maxNetExposurePct: number;
  maxTurnoverPct: number;
  maxDrawdownPct: number;
  maxConcurrentPositions: number;
  minCashBufferPct: number;
  stopLossPct: number;
  haltTradingOnDrawdownPct: number;
  maxActiveWeightPct: number;
  factorConstraints: Record<string, { min?: number; max?: number }>;
};

type ExecutionPolicy = {
  timing: "open" | "close" | "next-open" | "next-close";
  fillPolicy: "open" | "close" | "vwap" | "custom";
  customPriceFormula: "hl2" | "hlc3" | "ohlc4";
  spreadBps: number;
  slippageBps: number;
  transactionCostBps: number;
  marketImpactBpsPer10PctADV: number;
  liquidityCapPct: number;
  allowShorts: boolean;
  hardToBorrowSymbols: Set<string>;
  borrowAvailableSymbols: Set<string> | null;
  shortBorrowRateBps: number;
  shortBorrowMaxBps: number;
  allowedTradingWeekdays: Set<number> | null;
  blockedDates: Set<string>;
  staleBarMaxGapDays: number;
  staleBarPolicy: "warn" | "skip" | "block";
  missingBarPolicy: "warn" | "skip" | "block";
  maxParticipationPct: number;
};

type EngineConfig = {
  initialCapital: number;
  benchmarkSymbol?: string;
  benchmarkWeights: Record<string, number>;
  symbolClassification: Record<string, SymbolClassification>;
  factorExposureMap: Record<string, Record<string, number>>;
  executionPolicy: ExecutionPolicy;
  riskControls: RiskControls;
  missingDataStressEveryNthBar: number | null;
};

type MutableState = {
  cash: number;
  positions: Map<string, PositionRecord>;
  priceBySymbol: Map<string, number>;
  dailyTurnoverByDate: Map<string, number>;
  peakEquity: number;
  tradingHalted: boolean;
  lastBorrowAccrualDate: string | null;
};

let orderCounter = 0;
let fillCounter = 0;

function nextOrderId(): string {
  orderCounter += 1;
  return `ord-${orderCounter}-${Date.now()}`;
}

function nextFillId(): string {
  fillCounter += 1;
  return `fill-${fillCounter}-${Date.now()}`;
}

function round(value: number, digits = 6): number {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

function normalizePercent(value: unknown, fallback: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }
  if (value > 1) return value / 100;
  if (value < 0) return 0;
  return value;
}

function normalizeNumeric(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parseStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function parseNumberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is number =>
          typeof item === "number" && Number.isFinite(item),
      )
    : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function resolveConfig(assumptions: Record<string, unknown>): EngineConfig {
  const riskRaw = asRecord(assumptions.riskControls);
  const executionTiming = assumptions.executionTiming;
  const fillPolicyRaw = assumptions.fillPolicy;
  const executionPolicy: ExecutionPolicy = {
    timing:
      executionTiming === "open" ||
      executionTiming === "close" ||
      executionTiming === "next-open" ||
      executionTiming === "next-close"
        ? executionTiming
        : "close",
    fillPolicy:
      fillPolicyRaw === "open" ||
      fillPolicyRaw === "vwap" ||
      fillPolicyRaw === "custom"
        ? fillPolicyRaw
        : "close",
    customPriceFormula:
      assumptions.customPriceFormula === "hl2" ||
      assumptions.customPriceFormula === "hlc3"
        ? assumptions.customPriceFormula
        : "ohlc4",
    spreadBps: normalizeNumeric(assumptions.spreadBps, 0),
    slippageBps: normalizeNumeric(assumptions.slippageBps, 2),
    transactionCostBps: normalizeNumeric(assumptions.transactionCostBps, 5),
    marketImpactBpsPer10PctADV: normalizeNumeric(
      assumptions.marketImpactBpsPer10PctADV,
      10,
    ),
    liquidityCapPct: normalizeNumeric(assumptions.liquidityCapPct, 0),
    allowShorts: assumptions.allowShorts !== false,
    hardToBorrowSymbols: new Set(
      parseStringArray(assumptions.hardToBorrowSymbols).map((item) =>
        item.toUpperCase(),
      ),
    ),
    borrowAvailableSymbols: Array.isArray(assumptions.borrowAvailableSymbols)
      ? new Set(
          parseStringArray(assumptions.borrowAvailableSymbols).map((item) =>
            item.toUpperCase(),
          ),
        )
      : null,
    shortBorrowRateBps: normalizeNumeric(
      assumptions.shortBorrowRateBps ?? assumptions.borrowCostBps,
      50,
    ),
    shortBorrowMaxBps: normalizeNumeric(assumptions.shortBorrowMaxBps, 500),
    allowedTradingWeekdays: Array.isArray(assumptions.allowedTradingWeekdays)
      ? new Set(parseNumberArray(assumptions.allowedTradingWeekdays))
      : null,
    blockedDates: new Set(parseStringArray(assumptions.blockedDates)),
    staleBarMaxGapDays: normalizeNumeric(assumptions.staleBarMaxGapDays, 7),
    staleBarPolicy:
      assumptions.staleBarPolicy === "skip" ||
      assumptions.staleBarPolicy === "block"
        ? assumptions.staleBarPolicy
        : "warn",
    missingBarPolicy:
      assumptions.missingBarPolicy === "skip" ||
      assumptions.missingBarPolicy === "block"
        ? assumptions.missingBarPolicy
        : "warn",
    maxParticipationPct: normalizeNumeric(assumptions.maxParticipationPct, 0),
  };

  const symbolClassification = Object.fromEntries(
    Object.entries(asRecord(assumptions.symbolClassification)).map(
      ([key, value]) => {
        const record = asRecord(value);
        const classification: SymbolClassification = {};
        if (typeof record.sector === "string") {
          classification.sector = record.sector;
        }
        if (typeof record.industry === "string") {
          classification.industry = record.industry;
        }
        return [key.toUpperCase(), classification];
      },
    ),
  ) as Record<string, SymbolClassification>;

  const factorConstraints = Object.fromEntries(
    Object.entries(asRecord(riskRaw.factorConstraints)).map(([key, value]) => {
      const record = asRecord(value);
      const constraint: { min?: number; max?: number } = {};
      if (typeof record.min === "number") {
        constraint.min = record.min;
      }
      if (typeof record.max === "number") {
        constraint.max = record.max;
      }
      return [key, constraint];
    }),
  ) as Record<string, { min?: number; max?: number }>;

  const benchmarkSymbol =
    typeof assumptions.benchmarkSymbol === "string" &&
    assumptions.benchmarkSymbol.trim()
      ? assumptions.benchmarkSymbol.trim().toUpperCase()
      : null;

  return {
    initialCapital: normalizeNumeric(assumptions.initialCapital, 100_000),
    ...(benchmarkSymbol ? { benchmarkSymbol } : {}),
    benchmarkWeights: Object.fromEntries(
      Object.entries(asRecord(assumptions.benchmarkWeights)).map(
        ([key, value]) => [key.toUpperCase(), normalizePercent(value, 0)],
      ),
    ),
    symbolClassification,
    factorExposureMap: Object.fromEntries(
      Object.entries(asRecord(assumptions.factorExposureMap)).map(
        ([key, value]) => {
          const record = asRecord(value);
          return [
            key.toUpperCase(),
            Object.fromEntries(
              Object.entries(record).map(([factor, amount]) => [
                factor,
                normalizeNumeric(amount, 0),
              ]),
            ),
          ];
        },
      ),
    ),
    executionPolicy,
    riskControls: {
      maxPositionWeightPct: normalizePercent(
        riskRaw.maxPositionWeightPct ?? assumptions.maxPositionSizePct,
        1,
      ),
      maxSectorExposurePct: normalizePercent(riskRaw.maxSectorExposurePct, 1),
      maxIndustryExposurePct: normalizePercent(
        riskRaw.maxIndustryExposurePct,
        1,
      ),
      maxGrossExposurePct: normalizePercent(
        riskRaw.maxGrossExposurePct ?? assumptions.maxGrossLeverage,
        1,
      ),
      maxNetExposurePct: normalizePercent(riskRaw.maxNetExposurePct, 1),
      maxTurnoverPct: normalizePercent(riskRaw.maxTurnoverPct, 1),
      maxDrawdownPct: normalizePercent(riskRaw.maxDrawdownPct, 1),
      maxConcurrentPositions: Math.max(
        1,
        normalizeNumeric(riskRaw.maxConcurrentPositions, 1000),
      ),
      minCashBufferPct: normalizePercent(
        riskRaw.minCashBufferPct ?? assumptions.minCashBufferPct,
        0,
      ),
      stopLossPct: normalizePercent(riskRaw.stopLossPct, 0),
      haltTradingOnDrawdownPct: normalizePercent(
        riskRaw.haltTradingOnDrawdownPct ?? riskRaw.maxDrawdownPct,
        1,
      ),
      maxActiveWeightPct: normalizePercent(riskRaw.maxActiveWeightPct, 1),
      factorConstraints,
    },
    missingDataStressEveryNthBar:
      typeof assumptions.missingDataStressEveryNthBar === "number" &&
      assumptions.missingDataStressEveryNthBar > 0
        ? assumptions.missingDataStressEveryNthBar
        : null,
  };
}

function averageHoldingPeriodBars(trades: SimulatedTrade[]): number {
  const lots = new Map<
    string,
    Array<{ timestamp: string; quantity: number }>
  >();
  const spans: number[] = [];
  for (const trade of trades) {
    const queue = lots.get(trade.symbol) ?? [];
    if (trade.side === "buy") {
      queue.push({ timestamp: trade.timestamp, quantity: trade.quantity });
      lots.set(trade.symbol, queue);
      continue;
    }
    let remaining = trade.quantity;
    while (remaining > 0 && queue.length > 0) {
      const lot = queue[0]!;
      const matched = Math.min(remaining, lot.quantity);
      const barsHeld = Math.max(
        1,
        Math.round(
          (new Date(trade.timestamp).getTime() -
            new Date(lot.timestamp).getTime()) /
            (24 * 60 * 60 * 1000),
        ),
      );
      spans.push(barsHeld);
      lot.quantity -= matched;
      remaining -= matched;
      if (lot.quantity <= 0) {
        queue.shift();
      }
    }
    lots.set(trade.symbol, queue);
  }
  if (spans.length === 0) return 0;
  return round(spans.reduce((sum, value) => sum + value, 0) / spans.length, 2);
}

function dailyReturns(
  equityCurve: Array<{ timestamp: string; value: number }>,
): number[] {
  const values: number[] = [];
  for (let index = 1; index < equityCurve.length; index++) {
    const previous = equityCurve[index - 1];
    const current = equityCurve[index];
    if (!previous || !current || previous.value <= 0) continue;
    values.push((current.value - previous.value) / previous.value);
  }
  return values;
}

function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) /
    values.length;
  return Math.sqrt(variance);
}

function priceByFillPolicy(
  bar: OHLCVBar,
  fillPolicy: EngineConfig["executionPolicy"]["fillPolicy"],
  customFormula: EngineConfig["executionPolicy"]["customPriceFormula"],
): number {
  if (fillPolicy === "open") return bar.open;
  if (fillPolicy === "vwap")
    return (bar.open + bar.high + bar.low + bar.close) / 4;
  if (fillPolicy === "custom") {
    if (customFormula === "hl2") return (bar.high + bar.low) / 2;
    if (customFormula === "hlc3") return (bar.high + bar.low + bar.close) / 3;
    return (bar.open + bar.high + bar.low + bar.close) / 4;
  }
  return bar.close;
}

function detectGapDays(current: string, previous?: string): number {
  if (!previous) return 0;
  return Math.floor(
    (new Date(current).getTime() - new Date(previous).getTime()) /
      (24 * 60 * 60 * 1000),
  );
}

function isTradingBlockedBySession(
  timestamp: string,
  policy: ExecutionPolicy,
): boolean {
  const date = new Date(timestamp);
  const iso = timestamp.slice(0, 10);
  const weekday = date.getUTCDay();
  if (
    policy.allowedTradingWeekdays &&
    !policy.allowedTradingWeekdays.has(weekday)
  )
    return true;
  if (policy.blockedDates.has(iso)) return true;
  return false;
}

function computeSpreadAndImpact(
  basePrice: number,
  quantity: number,
  barVolume: number,
  policy: ExecutionPolicy,
): { spreadCost: number; marketImpact: number } {
  const spreadCost = (basePrice * policy.spreadBps) / 10_000;
  const participation = barVolume > 0 ? quantity / barVolume : 1;
  const impactBps = (participation / 0.1) * policy.marketImpactBpsPer10PctADV;
  const marketImpact = (basePrice * impactBps) / 10_000;
  return { spreadCost, marketImpact };
}

function calculateFillPrice(
  side: OrderSide,
  order: Order,
  bar: OHLCVBar,
  previousBar: OHLCVBar | undefined,
  config: EngineConfig,
): number | null {
  const policy = config.executionPolicy;
  const basePrice = priceByFillPolicy(
    bar,
    policy.fillPolicy,
    policy.customPriceFormula,
  );
  const slippageAbs = (basePrice * policy.slippageBps) / 10_000;

  if (order.orderType === "market") {
    const { spreadCost, marketImpact } = computeSpreadAndImpact(
      basePrice,
      order.quantity - order.filledQty,
      bar.volume,
      policy,
    );
    const signedCosts = slippageAbs + spreadCost / 2 + marketImpact;
    return side === "buy"
      ? basePrice + signedCosts
      : Math.max(0.01, basePrice - signedCosts);
  }

  if (order.orderType === "limit") {
    const limitPrice = order.limitPrice ?? null;
    if (limitPrice === null) return null;
    if (side === "buy" && bar.low <= limitPrice)
      return Math.min(
        limitPrice,
        bar.open <= limitPrice ? bar.open : limitPrice,
      );
    if (side === "sell" && bar.high >= limitPrice)
      return Math.max(
        limitPrice,
        bar.open >= limitPrice ? bar.open : limitPrice,
      );
    return null;
  }

  if (order.orderType === "stop") {
    const stopPrice = order.stopPrice ?? null;
    if (stopPrice === null) return null;
    if (side === "buy" && bar.high >= stopPrice)
      return (bar.open >= stopPrice ? bar.open : stopPrice) + slippageAbs;
    if (side === "sell" && bar.low <= stopPrice)
      return Math.max(
        0.01,
        (bar.open <= stopPrice ? bar.open : stopPrice) - slippageAbs,
      );
    return null;
  }

  if (order.orderType === "stop_limit") {
    const stopPrice = order.stopPrice ?? null;
    const limitPrice = order.limitPrice ?? null;
    if (stopPrice === null || limitPrice === null) return null;
    const triggered =
      side === "buy" ? bar.high >= stopPrice : bar.low <= stopPrice;
    if (!triggered) return null;
    if (side === "buy" && bar.low <= limitPrice)
      return Math.min(
        limitPrice,
        bar.open <= limitPrice ? bar.open : limitPrice,
      );
    if (side === "sell" && bar.high >= limitPrice)
      return Math.max(
        limitPrice,
        bar.open >= limitPrice ? bar.open : limitPrice,
      );
    if (previousBar) {
      const gapCrossed =
        side === "buy"
          ? previousBar.close < stopPrice && bar.open > limitPrice
          : previousBar.close > stopPrice && bar.open < limitPrice;
      if (gapCrossed) return null;
    }
  }

  return null;
}

function upsertPosition(
  positions: Map<string, PositionRecord>,
  fill: FillRecord,
  classification: SymbolClassification | undefined,
): number {
  const existing = positions.get(fill.symbol) ?? {
    symbol: fill.symbol,
    quantity: 0,
    direction: "flat" as PositionDirection,
    avgCostBasis: 0,
    realizedPnL: 0,
    unrealizedPnL: 0,
    accruedBorrow: 0,
    ...(classification?.sector ? { sector: classification.sector } : {}),
    ...(classification?.industry ? { industry: classification.industry } : {}),
  };

  const signedQty = fill.side === "buy" ? fill.quantity : -fill.quantity;
  const previousQty = existing.quantity;
  const nextQty = previousQty + signedQty;
  let realized = 0;

  if (previousQty === 0 || Math.sign(previousQty) === Math.sign(signedQty)) {
    const totalAbs = Math.abs(previousQty) + Math.abs(signedQty);
    existing.avgCostBasis =
      totalAbs > 0
        ? (Math.abs(previousQty) * existing.avgCostBasis +
            Math.abs(signedQty) * fill.price) /
          totalAbs
        : fill.price;
    existing.quantity = nextQty;
  } else {
    const closingQty = Math.min(Math.abs(previousQty), Math.abs(signedQty));
    realized =
      previousQty > 0
        ? closingQty * (fill.price - existing.avgCostBasis)
        : closingQty * (existing.avgCostBasis - fill.price);
    existing.realizedPnL += realized;
    existing.quantity = nextQty;
    if (nextQty === 0) {
      existing.avgCostBasis = 0;
    } else if (Math.sign(previousQty) !== Math.sign(nextQty)) {
      existing.avgCostBasis = fill.price;
    }
  }

  existing.direction =
    existing.quantity > 0 ? "long" : existing.quantity < 0 ? "short" : "flat";
  if (classification?.sector) {
    existing.sector = classification.sector;
  }
  if (classification?.industry) {
    existing.industry = classification.industry;
  }
  positions.set(fill.symbol, existing);
  return realized;
}

function recomputeUnrealized(
  positions: Map<string, PositionRecord>,
  priceBySymbol: Map<string, number>,
): void {
  for (const position of positions.values()) {
    const price = priceBySymbol.get(position.symbol) ?? position.avgCostBasis;
    if (position.quantity > 0) {
      position.unrealizedPnL =
        position.quantity * (price - position.avgCostBasis);
    } else if (position.quantity < 0) {
      position.unrealizedPnL =
        Math.abs(position.quantity) * (position.avgCostBasis - price);
    } else {
      position.unrealizedPnL = 0;
    }
  }
}

function exposureBreakdown(
  positions: Map<string, PositionRecord>,
  priceBySymbol: Map<string, number>,
  equity: number,
): Omit<
  ExposurePoint,
  "timestamp" | "cash" | "equity" | "turnoverPct" | "drawdownPct"
> {
  let longExposure = 0;
  let shortExposure = 0;
  for (const position of positions.values()) {
    const price = priceBySymbol.get(position.symbol) ?? position.avgCostBasis;
    const exposure = position.quantity * price;
    if (exposure >= 0) longExposure += exposure;
    else shortExposure += Math.abs(exposure);
  }
  const grossExposure =
    equity > 0 ? (longExposure + shortExposure) / equity : 0;
  const netExposure = equity > 0 ? (longExposure - shortExposure) / equity : 0;
  return {
    grossExposure,
    netExposure,
    longExposure: equity > 0 ? longExposure / equity : 0,
    shortExposure: equity > 0 ? shortExposure / equity : 0,
  };
}

function portfolioEquity(
  cash: number,
  positions: Map<string, PositionRecord>,
  priceBySymbol: Map<string, number>,
): number {
  let equity = cash;
  for (const position of positions.values()) {
    const price = priceBySymbol.get(position.symbol) ?? position.avgCostBasis;
    equity += position.quantity * price;
  }
  return equity;
}

function recordDiagnostic(
  diagnostics: BacktestDiagnostic[],
  diagnostic: BacktestDiagnostic,
): void {
  diagnostics.push(diagnostic);
  if (diagnostic.severity === "error")
    logger.error(diagnostic.code, diagnostic);
  else if (diagnostic.severity === "warning")
    logger.warn(diagnostic.code, diagnostic);
  else logger.info(diagnostic.code, diagnostic);
}

function buildOrder(signal: TradeSignal, timestamp: string): Order {
  return {
    orderId: nextOrderId(),
    symbol: signal.symbol.toUpperCase(),
    side: signal.action === "buy" ? "buy" : "sell",
    orderType:
      signal.orderType ??
      (typeof signal.limitPrice === "number" ? "limit" : "market"),
    quantity: Math.max(1, Math.floor(signal.quantity ?? 1)),
    limitPrice:
      typeof signal.limitPrice === "number" ? signal.limitPrice : null,
    stopPrice: typeof signal.stopPrice === "number" ? signal.stopPrice : null,
    state: "pending",
    filledQty: 0,
    submittedAt: timestamp,
    updatedAt: timestamp,
    ...(signal.reason ? { metadata: { reason: signal.reason } } : {}),
  };
}

function normalizePositionsForStrategy(
  positions: Map<string, PositionRecord>,
): Map<string, number> {
  return new Map(
    Array.from(positions.entries()).map(([symbol, position]) => [
      symbol,
      position.quantity,
    ]),
  );
}

function projectedExposureByGroup(
  positions: Map<string, PositionRecord>,
  priceBySymbol: Map<string, number>,
  equity: number,
  groupSelector: (position: PositionRecord) => string | undefined,
): Record<string, number> {
  const totals: Record<string, number> = {};
  if (equity <= 0) return totals;
  for (const position of positions.values()) {
    const group = groupSelector(position);
    if (!group) continue;
    const price = priceBySymbol.get(position.symbol) ?? position.avgCostBasis;
    totals[group] =
      (totals[group] ?? 0) + Math.abs(position.quantity * price) / equity;
  }
  return totals;
}

function projectedFactorExposure(
  positions: Map<string, PositionRecord>,
  priceBySymbol: Map<string, number>,
  factorMap: Record<string, Record<string, number>>,
  equity: number,
): Record<string, number> {
  const totals: Record<string, number> = {};
  if (equity <= 0) return totals;
  for (const position of positions.values()) {
    const price = priceBySymbol.get(position.symbol) ?? position.avgCostBasis;
    const weight = (position.quantity * price) / equity;
    const factors = factorMap[position.symbol] ?? {};
    for (const [factor, value] of Object.entries(factors)) {
      totals[factor] = (totals[factor] ?? 0) + weight * value;
    }
  }
  return totals;
}

export class AdvancedBacktestEngine {
  constructor(
    private readonly dataProvider: IHistoricalDataProvider,
    private readonly executor: IStrategyExecutor,
  ) {}

  async run(input: {
    snapshotId: string;
    scriptSource: string;
    entrypoint: string;
    universe: string[];
    assumptions: Record<string, unknown>;
  }): Promise<BacktestResult> {
    const errors: string[] = [];
    const trades: SimulatedTrade[] = [];
    const fills: FillRecord[] = [];
    const orders: Order[] = [];
    const diagnostics: BacktestDiagnostic[] = [];
    const equityCurve: Array<{ timestamp: string; value: number }> = [];
    const exposureCurve: ExposurePoint[] = [];

    try {
      const snapshot = await this.dataProvider.loadSnapshot(input.snapshotId);
      if (!snapshot) {
        return {
          success: false,
          metrics: null,
          trades,
          fills,
          orders,
          positions: [],
          equityCurve,
          exposureCurve,
          diagnostics,
          errors: ["Snapshot not found"],
        };
      }

      const config = resolveConfig(input.assumptions);
      const requestedSymbols = input.universe
        .map((symbol) => symbol.trim().toUpperCase())
        .filter((symbol) => snapshot.symbols.has(symbol));
      if (requestedSymbols.length === 0) {
        return {
          success: false,
          metrics: null,
          trades,
          fills,
          orders,
          positions: [],
          equityCurve,
          exposureCurve,
          diagnostics,
          errors: ["No valid symbols were present in the dataset snapshot"],
        };
      }

      const allBars = requestedSymbols
        .flatMap((symbol) =>
          this.dataProvider.getBarsForSymbol(snapshot, symbol),
        )
        .sort(
          (left, right) =>
            new Date(left.timestamp).getTime() -
              new Date(right.timestamp).getTime() ||
            left.symbol.localeCompare(right.symbol),
        );

      if (allBars.length === 0) {
        return {
          success: false,
          metrics: null,
          trades,
          fills,
          orders,
          positions: [],
          equityCurve,
          exposureCurve,
          diagnostics,
          errors: ["Historical data set is empty"],
        };
      }

      const groupedBySymbol = groupBarsBySymbol(allBars);
      const timeframeSummary = detectTimeframe(
        groupedBySymbol.get(requestedSymbols[0]!) ?? allBars,
      );
      recordDiagnostic(diagnostics, {
        code: "dataset_frequency_detected",
        severity: "info",
        message: `Base dataset frequency detected as ${timeframeSummary.baseFrequency}.`,
      });

      const state: MutableState = {
        cash: config.initialCapital,
        positions: new Map<string, PositionRecord>(),
        priceBySymbol: new Map<string, number>(),
        dailyTurnoverByDate: new Map<string, number>(),
        peakEquity: config.initialCapital,
        tradingHalted: false,
        lastBorrowAccrualDate: null,
      };

      const restingOrders: Order[] = [];
      const previousBarBySymbol = new Map<string, OHLCVBar>();
      let totalFees = 0;
      let totalSlippage = 0;
      let totalBorrowCharges = 0;
      let totalRealizedPnL = 0;
      let peakGrossExposure = 0;
      let shortTrades = 0;

      for (let index = 0; index < allBars.length; index++) {
        const bar = allBars[index]!;
        const barDate = bar.timestamp.slice(0, 10);
        const previousBar = previousBarBySymbol.get(bar.symbol);

        if (
          config.missingDataStressEveryNthBar &&
          (index + 1) % config.missingDataStressEveryNthBar === 0
        ) {
          recordDiagnostic(diagnostics, {
            code: "stress_missing_bar_skip",
            severity: "warning",
            timestamp: bar.timestamp,
            symbol: bar.symbol,
            message: "Stress test removed this bar from execution.",
          });
          previousBarBySymbol.set(bar.symbol, bar);
          continue;
        }

        if (bar.volume <= 0) {
          const diagnostic: BacktestDiagnostic = {
            code: "missing_print_or_zero_volume",
            severity:
              config.executionPolicy.missingBarPolicy === "warn"
                ? "warning"
                : "error",
            timestamp: bar.timestamp,
            symbol: bar.symbol,
            message: "Bar volume is zero; fills may be unreliable.",
          };
          recordDiagnostic(diagnostics, diagnostic);
          if (
            config.executionPolicy.missingBarPolicy === "block" ||
            config.executionPolicy.missingBarPolicy === "skip"
          ) {
            previousBarBySymbol.set(bar.symbol, bar);
            if (config.executionPolicy.missingBarPolicy === "block") {
              errors.push(diagnostic.message);
              break;
            }
            continue;
          }
        }

        const gapDays = detectGapDays(bar.timestamp, previousBar?.timestamp);
        if (gapDays > config.executionPolicy.staleBarMaxGapDays) {
          const diagnostic: BacktestDiagnostic = {
            code: "stale_bar_gap_detected",
            severity:
              config.executionPolicy.staleBarPolicy === "warn"
                ? "warning"
                : "error",
            timestamp: bar.timestamp,
            symbol: bar.symbol,
            message: `Observed a ${gapDays}-day gap before this bar.`,
          };
          recordDiagnostic(diagnostics, diagnostic);
          if (config.executionPolicy.staleBarPolicy === "block") {
            errors.push(diagnostic.message);
            break;
          }
          if (config.executionPolicy.staleBarPolicy === "skip") {
            previousBarBySymbol.set(bar.symbol, bar);
            continue;
          }
        }

        state.priceBySymbol.set(bar.symbol, bar.close);

        if (state.lastBorrowAccrualDate !== barDate) {
          for (const position of state.positions.values()) {
            if (position.quantity >= 0) continue;
            const borrowRate =
              config.executionPolicy.shortBorrowRateBps / 10_000 / 252;
            const marketValue =
              Math.abs(position.quantity) *
              (state.priceBySymbol.get(position.symbol) ??
                position.avgCostBasis);
            const charge = marketValue * borrowRate;
            position.accruedBorrow += charge;
            state.cash -= charge;
            totalBorrowCharges += charge;
          }
          state.lastBorrowAccrualDate = barDate;
        }

        const tradableSession = !isTradingBlockedBySession(
          bar.timestamp,
          config.executionPolicy,
        );
        if (!tradableSession) {
          recordDiagnostic(diagnostics, {
            code: "session_blocked",
            severity: "warning",
            timestamp: bar.timestamp,
            symbol: bar.symbol,
            message:
              "Trading blocked by venue/session constraints for this bar.",
          });
        }

        if (config.riskControls.stopLossPct > 0) {
          const existing = state.positions.get(bar.symbol);
          if (existing && existing.quantity > 0 && existing.avgCostBasis > 0) {
            const drawdown =
              (bar.close - existing.avgCostBasis) / existing.avgCostBasis;
            if (drawdown <= -config.riskControls.stopLossPct) {
              const stopOrder: Order = {
                orderId: nextOrderId(),
                symbol: bar.symbol,
                side: "sell",
                orderType: "market",
                quantity: Math.abs(existing.quantity),
                limitPrice: null,
                stopPrice: null,
                state: "filled",
                filledQty: Math.abs(existing.quantity),
                submittedAt: bar.timestamp,
                updatedAt: bar.timestamp,
                metadata: { reason: "stop_loss_exit" },
              };
              orders.push(stopOrder);
              const basePrice =
                calculateFillPrice(
                  "sell",
                  stopOrder,
                  bar,
                  previousBar,
                  config,
                ) ?? bar.close;
              const execution = this.executeFill(
                stopOrder,
                basePrice,
                bar,
                config,
                state,
              );
              fills.push(execution.fill);
              trades.push(execution.trade);
              totalFees += execution.fill.fees;
              totalSlippage += execution.fill.slippage;
              totalRealizedPnL += execution.realizedPnL;
            }
          }
        }

        const remainingOrders: Order[] = [];
        for (const order of restingOrders) {
          if (order.symbol !== bar.symbol || !tradableSession) {
            remainingOrders.push(order);
            continue;
          }
          const price = calculateFillPrice(
            order.side,
            order,
            bar,
            previousBar,
            config,
          );
          if (price === null) {
            remainingOrders.push(order);
            continue;
          }
          const executionQty = this.resolveExecutableQuantity(
            order,
            bar,
            config,
          );
          if (executionQty <= 0) {
            remainingOrders.push(order);
            continue;
          }
          const execution = this.executeFill(
            order,
            price,
            bar,
            config,
            state,
            order.orderId,
            executionQty,
          );
          order.filledQty += executionQty;
          order.updatedAt = bar.timestamp;
          order.state =
            order.filledQty >= order.quantity ? "filled" : "partial";
          fills.push(execution.fill);
          trades.push(execution.trade);
          totalFees += execution.fill.fees;
          totalSlippage += execution.fill.slippage;
          totalRealizedPnL += execution.realizedPnL;
          if (order.state !== "filled") remainingOrders.push(order);
        }
        restingOrders.length = 0;
        restingOrders.push(...remainingOrders);

        recomputeUnrealized(state.positions, state.priceBySymbol);
        const equityBeforeSignals = portfolioEquity(
          state.cash,
          state.positions,
          state.priceBySymbol,
        );
        state.peakEquity = Math.max(state.peakEquity, equityBeforeSignals);
        const preExposure = exposureBreakdown(
          state.positions,
          state.priceBySymbol,
          equityBeforeSignals,
        );
        peakGrossExposure = Math.max(
          peakGrossExposure,
          preExposure.grossExposure,
        );
        const drawdownPct =
          state.peakEquity > 0
            ? (state.peakEquity - equityBeforeSignals) / state.peakEquity
            : 0;

        if (drawdownPct >= config.riskControls.haltTradingOnDrawdownPct) {
          state.tradingHalted = true;
          recordDiagnostic(diagnostics, {
            code: "portfolio_halt_drawdown",
            severity: "warning",
            timestamp: bar.timestamp,
            message: `Trading halted after drawdown reached ${(drawdownPct * 100).toFixed(2)}%.`,
          });
        }

        equityCurve.push({
          timestamp: bar.timestamp,
          value: round(equityBeforeSignals, 2),
        });
        exposureCurve.push({
          timestamp: bar.timestamp,
          cash: round(state.cash, 2),
          equity: round(equityBeforeSignals, 2),
          grossExposure: round(preExposure.grossExposure, 6),
          netExposure: round(preExposure.netExposure, 6),
          longExposure: round(preExposure.longExposure, 6),
          shortExposure: round(preExposure.shortExposure, 6),
          turnoverPct: round(state.dailyTurnoverByDate.get(barDate) ?? 0, 6),
          drawdownPct: round(drawdownPct, 6),
        });

        if (!state.tradingHalted && tradableSession) {
          const strategyContext: StrategyContext = {
            bars: allBars,
            currentIndex: index,
            positions: normalizePositionsForStrategy(state.positions),
            cash: state.cash,
            value: equityBeforeSignals,
          };

          const executionResult = await this.executor.execute(
            input.scriptSource,
            strategyContext,
            input.entrypoint,
          );
          if (!executionResult.success) {
            errors.push(
              `Execution failed at ${bar.timestamp}: ${executionResult.error}`,
            );
            previousBarBySymbol.set(bar.symbol, bar);
            continue;
          }

          for (const signal of executionResult.signals) {
            if (signal.action === "hold") continue;
            const order = buildOrder(signal, bar.timestamp);
            if (!requestedSymbols.includes(order.symbol)) {
              order.state = "rejected";
              order.rejectReason = "signal_symbol_not_in_universe";
              orders.push(order);
              continue;
            }
            const riskDecision = this.validateOrderRisk(
              order,
              state,
              config,
              bar,
            );
            if (!riskDecision.ok) {
              order.state = "rejected";
              order.rejectReason = riskDecision.reason;
              orders.push(order);
              recordDiagnostic(diagnostics, {
                code: "order_rejected_risk",
                severity: "warning",
                timestamp: bar.timestamp,
                symbol: bar.symbol,
                message: `${order.symbol} ${order.side} order rejected: ${riskDecision.reason}`,
              });
              continue;
            }

            orders.push(order);
            if (order.orderType === "market") {
              const price = calculateFillPrice(
                order.side,
                order,
                bar,
                previousBar,
                config,
              );
              if (price === null) {
                order.state = "rejected";
                order.rejectReason = "market_fill_price_unavailable";
                continue;
              }
              const execution = this.executeFill(
                order,
                price,
                bar,
                config,
                state,
              );
              order.state = "filled";
              order.filledQty = order.quantity;
              order.updatedAt = bar.timestamp;
              fills.push(execution.fill);
              trades.push(execution.trade);
              totalFees += execution.fill.fees;
              totalSlippage += execution.fill.slippage;
              totalRealizedPnL += execution.realizedPnL;
              if (execution.trade.side === "sell") {
                const position = state.positions.get(order.symbol);
                if (position?.direction === "short") shortTrades += 1;
              }
            } else {
              order.state = "open";
              restingOrders.push(order);
            }
          }
        }

        previousBarBySymbol.set(bar.symbol, bar);
      }

      for (const order of restingOrders) {
        order.state = "cancelled";
        order.cancelReason = "simulation_ended";
        order.updatedAt =
          equityCurve[equityCurve.length - 1]?.timestamp ?? order.updatedAt;
      }

      recomputeUnrealized(state.positions, state.priceBySymbol);
      const finalEquity = portfolioEquity(
        state.cash,
        state.positions,
        state.priceBySymbol,
      );
      const metrics = this.calculateMetrics({
        equityCurve,
        exposureCurve,
        trades,
        initialCapital: config.initialCapital,
        endingCapital: finalEquity,
        totalFees,
        totalSlippage,
        totalBorrowCharges,
        totalRealizedPnL,
        peakGrossExposure,
        shortTrades,
      });

      return {
        success: errors.length === 0,
        metrics,
        trades,
        fills,
        orders,
        positions: Array.from(state.positions.values()),
        equityCurve,
        exposureCurve,
        diagnostics,
        errors,
      };
    } catch (error) {
      logger.error("backtest_execution_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
      return {
        success: false,
        metrics: null,
        trades,
        fills,
        orders,
        positions: [],
        equityCurve,
        exposureCurve,
        diagnostics,
        errors: [
          error instanceof Error ? error.message : "Unknown backtest error",
        ],
      };
    }
  }

  private resolveExecutableQuantity(
    order: Order,
    bar: OHLCVBar,
    config: EngineConfig,
  ): number {
    const remaining = order.quantity - order.filledQty;
    if (remaining <= 0) return 0;
    const volumeCap =
      config.executionPolicy.liquidityCapPct > 0
        ? Math.floor(
            bar.volume * (config.executionPolicy.liquidityCapPct / 100),
          )
        : remaining;
    const participationCap =
      config.executionPolicy.maxParticipationPct > 0
        ? Math.floor(
            bar.volume * (config.executionPolicy.maxParticipationPct / 100),
          )
        : remaining;
    const qty = Math.min(
      remaining,
      volumeCap || remaining,
      participationCap || remaining,
    );
    return Math.max(0, qty);
  }

  private validateOrderRisk(
    order: Order,
    state: MutableState,
    config: EngineConfig,
    bar: OHLCVBar,
  ): { ok: true } | { ok: false; reason: string } {
    const policy = config.executionPolicy;
    const risk = config.riskControls;

    if (order.side === "sell") {
      const position = state.positions.get(order.symbol);
      const opensShort = !position || position.quantity - order.quantity < 0;
      if (opensShort) {
        if (!policy.allowShorts)
          return { ok: false, reason: "shorts_disabled" };
        if (policy.hardToBorrowSymbols.has(order.symbol))
          return { ok: false, reason: "hard_to_borrow" };
        if (
          policy.borrowAvailableSymbols &&
          !policy.borrowAvailableSymbols.has(order.symbol)
        )
          return { ok: false, reason: "borrow_unavailable" };
        if (policy.shortBorrowRateBps > policy.shortBorrowMaxBps)
          return { ok: false, reason: "borrow_cost_exceeds_limit" };
      }
    }

    const basePrice = bar.close;
    const notional = Math.abs(order.quantity * basePrice);
    const equity = portfolioEquity(
      state.cash,
      state.positions,
      state.priceBySymbol,
    );
    if (equity <= 0) return { ok: false, reason: "non_positive_equity" };

    if (order.side === "buy") {
      const totalCost = notional * (1 + policy.transactionCostBps / 10_000);
      if (state.cash - totalCost < equity * risk.minCashBufferPct)
        return { ok: false, reason: "cash_buffer_breach" };
    }

    const projectedPositions = new Map<string, PositionRecord>();
    for (const [symbol, position] of state.positions.entries()) {
      projectedPositions.set(symbol, { ...position });
    }
    const syntheticFill: FillRecord = {
      fillId: "synthetic",
      orderId: "synthetic",
      symbol: order.symbol,
      side: order.side,
      quantity: order.quantity,
      price: basePrice,
      fees: 0,
      slippage: 0,
      spreadCost: 0,
      marketImpact: 0,
      timestamp: bar.timestamp,
    };
    upsertPosition(
      projectedPositions,
      syntheticFill,
      config.symbolClassification[order.symbol],
    );
    const breakdown = exposureBreakdown(
      projectedPositions,
      state.priceBySymbol,
      equity,
    );

    if (breakdown.grossExposure > risk.maxGrossExposurePct)
      return { ok: false, reason: "gross_exposure_limit" };
    if (Math.abs(breakdown.netExposure) > risk.maxNetExposurePct)
      return { ok: false, reason: "net_exposure_limit" };

    const projected = projectedPositions.get(order.symbol);
    if (projected) {
      const symbolWeight = Math.abs((projected.quantity * basePrice) / equity);
      if (symbolWeight > risk.maxPositionWeightPct)
        return { ok: false, reason: "position_weight_limit" };
    }

    const concurrent = Array.from(projectedPositions.values()).filter(
      (position) => position.quantity !== 0,
    ).length;
    if (concurrent > risk.maxConcurrentPositions)
      return { ok: false, reason: "max_concurrent_positions" };

    const sectorExposure = projectedExposureByGroup(
      projectedPositions,
      state.priceBySymbol,
      equity,
      (position) => position.sector,
    );
    if (
      Object.values(sectorExposure).some(
        (value) => value > risk.maxSectorExposurePct,
      )
    )
      return { ok: false, reason: "sector_exposure_limit" };
    const industryExposure = projectedExposureByGroup(
      projectedPositions,
      state.priceBySymbol,
      equity,
      (position) => position.industry,
    );
    if (
      Object.values(industryExposure).some(
        (value) => value > risk.maxIndustryExposurePct,
      )
    )
      return { ok: false, reason: "industry_exposure_limit" };

    const factorExposure = projectedFactorExposure(
      projectedPositions,
      state.priceBySymbol,
      config.factorExposureMap,
      equity,
    );
    for (const [factor, constraint] of Object.entries(risk.factorConstraints)) {
      const exposure = factorExposure[factor] ?? 0;
      if (typeof constraint.min === "number" && exposure < constraint.min)
        return { ok: false, reason: `factor_${factor}_below_min` };
      if (typeof constraint.max === "number" && exposure > constraint.max)
        return { ok: false, reason: `factor_${factor}_above_max` };
    }

    if (Object.keys(config.benchmarkWeights).length > 0) {
      for (const [symbol, weight] of Object.entries(config.benchmarkWeights)) {
        const projectedPosition = projectedPositions.get(symbol);
        const activeWeight = Math.abs(
          ((projectedPosition?.quantity ?? 0) * basePrice) / equity - weight,
        );
        if (activeWeight > risk.maxActiveWeightPct)
          return { ok: false, reason: "benchmark_active_weight_limit" };
      }
    }

    const existingTurnover =
      state.dailyTurnoverByDate.get(bar.timestamp.slice(0, 10)) ?? 0;
    const projectedTurnover = existingTurnover + notional / equity;
    if (projectedTurnover > risk.maxTurnoverPct)
      return { ok: false, reason: "turnover_limit" };

    return { ok: true };
  }

  private executeFill(
    order: Order,
    fillPrice: number,
    bar: OHLCVBar,
    config: EngineConfig,
    state: MutableState,
    orderIdOverride?: string,
    quantityOverride?: number,
  ): { fill: FillRecord; trade: SimulatedTrade; realizedPnL: number } {
    const quantity = quantityOverride ?? order.quantity;
    const notional = quantity * fillPrice;
    const fees =
      notional * (config.executionPolicy.transactionCostBps / 10_000);
    const { spreadCost, marketImpact } = computeSpreadAndImpact(
      fillPrice,
      quantity,
      bar.volume,
      config.executionPolicy,
    );
    const slippage =
      Math.abs(fillPrice - bar.close) * quantity +
      spreadCost * quantity +
      marketImpact * quantity;
    if (order.side === "buy") state.cash -= notional + fees;
    else state.cash += notional - fees;
    state.dailyTurnoverByDate.set(
      bar.timestamp.slice(0, 10),
      (state.dailyTurnoverByDate.get(bar.timestamp.slice(0, 10)) ?? 0) +
        notional /
          Math.max(
            1,
            portfolioEquity(state.cash, state.positions, state.priceBySymbol),
          ),
    );
    const fill: FillRecord = {
      fillId: nextFillId(),
      orderId: orderIdOverride ?? order.orderId,
      symbol: order.symbol,
      side: order.side,
      quantity,
      price: round(fillPrice, 6),
      fees: round(fees, 4),
      slippage: round(slippage, 4),
      spreadCost: round(spreadCost * quantity, 4),
      marketImpact: round(marketImpact * quantity, 4),
      timestamp: bar.timestamp,
    };
    const realizedPnL = upsertPosition(
      state.positions,
      fill,
      config.symbolClassification[order.symbol],
    );
    recomputeUnrealized(state.positions, state.priceBySymbol);
    return {
      fill,
      trade: {
        timestamp: bar.timestamp,
        symbol: order.symbol,
        side: order.side,
        quantity,
        price: round(fillPrice, 4),
        fees: round(fees, 4),
        slippage: round(slippage, 4),
        orderId: order.orderId,
        partial: quantity < order.quantity,
        realizedPnL: round(realizedPnL, 4),
      },
      realizedPnL,
    };
  }

  private calculateMetrics(input: {
    equityCurve: Array<{ timestamp: string; value: number }>;
    exposureCurve: ExposurePoint[];
    trades: SimulatedTrade[];
    initialCapital: number;
    endingCapital: number;
    totalFees: number;
    totalSlippage: number;
    totalBorrowCharges: number;
    totalRealizedPnL: number;
    peakGrossExposure: number;
    shortTrades: number;
  }): BacktestMetrics {
    const returns = dailyReturns(input.equityCurve);
    const startDate =
      input.equityCurve[0]?.timestamp ?? new Date().toISOString();
    const endDate =
      input.equityCurve[input.equityCurve.length - 1]?.timestamp ?? startDate;
    const years = Math.max(
      1 / 252,
      (new Date(endDate).getTime() - new Date(startDate).getTime()) /
        (365.25 * 24 * 60 * 60 * 1000),
    );
    const totalReturn =
      input.initialCapital > 0
        ? (input.endingCapital - input.initialCapital) / input.initialCapital
        : 0;
    const annualizedReturn = Math.pow(1 + totalReturn, 1 / years) - 1;
    const volatility = standardDeviation(returns) * Math.sqrt(252);
    const sharpeRatio = volatility > 0 ? annualizedReturn / volatility : 0;
    let peak = input.equityCurve[0]?.value ?? input.initialCapital;
    let maxDrawdown = 0;
    for (const point of input.equityCurve) {
      peak = Math.max(peak, point.value);
      if (peak > 0)
        maxDrawdown = Math.max(maxDrawdown, (peak - point.value) / peak);
    }
    const wins = input.trades.filter((trade) => (trade.realizedPnL ?? 0) > 0);
    const losses = input.trades.filter((trade) => (trade.realizedPnL ?? 0) < 0);
    const grossProfit = wins.reduce(
      (sum, trade) => sum + (trade.realizedPnL ?? 0),
      0,
    );
    const grossLoss = Math.abs(
      losses.reduce((sum, trade) => sum + (trade.realizedPnL ?? 0), 0),
    );
    const expectancy =
      input.trades.length > 0
        ? input.trades.reduce(
            (sum, trade) => sum + (trade.realizedPnL ?? 0),
            0,
          ) / input.trades.length
        : 0;
    const turnoverPct =
      input.exposureCurve.length > 0
        ? input.exposureCurve.reduce(
            (sum, point) => sum + point.turnoverPct,
            0,
          ) / input.exposureCurve.length
        : 0;
    const exposureUtilizationPct =
      input.exposureCurve.length > 0
        ? input.exposureCurve.reduce(
            (sum, point) => sum + point.grossExposure,
            0,
          ) / input.exposureCurve.length
        : 0;
    const endingExposure = input.exposureCurve[input.exposureCurve.length - 1];
    return {
      totalReturn: round(totalReturn, 6),
      annualizedReturn: round(annualizedReturn, 6),
      sharpeRatio: round(sharpeRatio, 6),
      maxDrawdown: round(maxDrawdown, 6),
      numTrades: input.trades.length,
      winningTrades: wins.length,
      losingTrades: losses.length,
      averageWinSize: wins.length > 0 ? round(grossProfit / wins.length, 4) : 0,
      averageLossSize:
        losses.length > 0 ? round(grossLoss / losses.length, 4) : 0,
      profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 6) : 0,
      startDate,
      endDate,
      startingCapital: round(input.initialCapital, 2),
      endingCapital: round(input.endingCapital, 2),
      totalRealizedPnL: round(input.totalRealizedPnL, 4),
      grossLeverage: endingExposure
        ? round(endingExposure.grossExposure, 6)
        : 0,
      peakGrossLeverage: round(input.peakGrossExposure, 6),
      totalFees: round(input.totalFees, 4),
      totalSlippage: round(input.totalSlippage, 4),
      totalBorrowCharges: round(input.totalBorrowCharges, 4),
      shortTrades: input.shortTrades,
      winRate:
        input.trades.length > 0
          ? round(wins.length / input.trades.length, 6)
          : 0,
      annualizedVolatility: round(volatility, 6),
      exposureUtilizationPct: round(exposureUtilizationPct, 6),
      turnoverPct: round(turnoverPct, 6),
      averageHoldingPeriodBars: averageHoldingPeriodBars(input.trades),
      expectancy: round(expectancy, 4),
    };
  }
}

export function createAdvancedBacktestEngine(
  dataProvider: IHistoricalDataProvider,
  executor: IStrategyExecutor,
): AdvancedBacktestEngine {
  return new AdvancedBacktestEngine(dataProvider, executor);
}

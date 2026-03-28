import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { compareRunsForParity, type ParityDiagnostics } from "./parityHarness";

export type LocalHistoricalBar = {
  timestamp: string;
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type LocalTradeSignal = {
  action: "buy" | "sell" | "hold";
  symbol: string;
  quantity?: number;
  reason?: string;
};

export type LocalBacktestTrade = {
  timestamp: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  fees: number;
  slippage: number;
};

export type LocalBacktestRunResult = {
  runId: string;
  strategyId: string;
  strategyVersion: string;
  status: "completed" | "failed";
  startedAt: string;
  finishedAt: string;
  error?: string;
  metrics: {
    totalReturn: number;
    sharpeRatio: number;
    maxDrawdown: number;
    numTrades: number;
    endingCapital: number;
    startingCapital: number;
    winRate: number;
  };
  equityCurve: Array<{ timestamp: string; value: number }>;
  trades: LocalBacktestTrade[];
  historicalData: {
    symbols: string[];
    source: "internet";
    cacheDir: string;
  };
  runMetadata: {
    engineVersion: string;
    datasetSnapshotId: string;
    datasetChecksumSha256: string;
    strategyChecksumSha256: string;
    assumptionsChecksumSha256: string;
    assumptionsFrozen: Record<string, unknown>;
    dateRangeApplied?: { startDate?: string; endDate?: string };
    riskControlsApplied?: {
      maxPositionWeightPct?: number;
      haltTradingOnDrawdownPct?: number;
    };
    parityDiagnostics?: ParityDiagnostics;
  };
  runLogs: string[];
};

type LocalBacktestInput = {
  runId: string;
  strategyId: string;
  strategyVersion: string;
  scriptSource: string;
  universe: string[];
  assumptions?: Record<string, unknown>;
};

type DownloadHistoricalDataResult = {
  symbols: string[];
  downloaded: number;
  fromCache: number;
  failed: string[];
  cacheDir: string;
  barsBySymbol: Record<string, LocalHistoricalBar[]>;
};

type LocalHistoricalDataLoader = (
  symbols: string[],
) => Promise<DownloadHistoricalDataResult>;

type StrategyExecutionContext = {
  bars: LocalHistoricalBar[];
  currentIndex: number;
  positions: Map<string, number>;
  cash: number;
  value: number;
};

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const LOCAL_ENGINE_VERSION = "local-backtest-engine@1.1.0";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const objectValue = value as Record<string, unknown>;
  const keys = Object.keys(objectValue).sort();
  const entries = keys.map(
    (key) => `${JSON.stringify(key)}:${stableStringify(objectValue[key])}`,
  );
  return `{${entries.join(",")}}`;
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/\s+/g, "");
}

function toStooqSymbol(symbol: string): string {
  const normalized = normalizeSymbol(symbol).replace(/\./g, "-").toLowerCase();
  if (normalized.endsWith(".us")) {
    return normalized;
  }
  return `${normalized}.us`;
}

function toYahooSymbol(symbol: string): string {
  const normalized = normalizeSymbol(symbol);
  const aliases: Record<string, string> = {
    NIFTY: "^NSEI",
    NIFTY50: "^NSEI",
    BANKNIFTY: "^NSEBANK",
    SENSEX: "^BSESN",
  };

  if (aliases[normalized]) {
    return aliases[normalized]!;
  }

  if (normalized.endsWith(".US")) {
    return normalized.slice(0, -3);
  }

  return normalized;
}

function parseCsvBars(symbol: string, csv: string): LocalHistoricalBar[] {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= 1) {
    return [];
  }

  const bars: LocalHistoricalBar[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) {
      continue;
    }
    const [date, open, high, low, close, volume] = line.split(",");
    if (
      !date ||
      [open, high, low, close, volume].some(
        (value) => value === undefined || value === "N/D",
      )
    ) {
      continue;
    }

    const parsed = {
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume),
    };
    if (Object.values(parsed).some((value) => Number.isNaN(value))) {
      continue;
    }

    bars.push({
      timestamp: date,
      symbol,
      open: parsed.open,
      high: parsed.high,
      low: parsed.low,
      close: parsed.close,
      volume: parsed.volume,
    });
  }

  return bars.sort(
    (left, right) =>
      new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
  );
}

function parseYahooChartBars(
  symbol: string,
  payload: unknown,
): LocalHistoricalBar[] {
  const chart =
    typeof payload === "object" && payload !== null
      ? (payload as { chart?: unknown }).chart
      : null;
  const result =
    typeof chart === "object" && chart !== null
      ? (chart as { result?: unknown[] }).result
      : null;
  const first = Array.isArray(result) && result.length > 0 ? result[0] : null;
  if (!first || typeof first !== "object") {
    return [];
  }

  const timestamps = (first as { timestamp?: unknown }).timestamp;
  const indicators = (first as { indicators?: unknown }).indicators;
  const quote =
    typeof indicators === "object" && indicators !== null
      ? (indicators as { quote?: unknown[] }).quote
      : null;
  const q0 = Array.isArray(quote) && quote.length > 0 ? quote[0] : null;
  if (!Array.isArray(timestamps) || !q0 || typeof q0 !== "object") {
    return [];
  }

  const opens = Array.isArray((q0 as { open?: unknown }).open)
    ? ((q0 as { open?: unknown[] }).open ?? [])
    : [];
  const highs = Array.isArray((q0 as { high?: unknown }).high)
    ? ((q0 as { high?: unknown[] }).high ?? [])
    : [];
  const lows = Array.isArray((q0 as { low?: unknown }).low)
    ? ((q0 as { low?: unknown[] }).low ?? [])
    : [];
  const closes = Array.isArray((q0 as { close?: unknown }).close)
    ? ((q0 as { close?: unknown[] }).close ?? [])
    : [];
  const volumes = Array.isArray((q0 as { volume?: unknown }).volume)
    ? ((q0 as { volume?: unknown[] }).volume ?? [])
    : [];

  const bars: LocalHistoricalBar[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const tsRaw = timestamps[i];
    const openRaw = opens[i];
    const highRaw = highs[i];
    const lowRaw = lows[i];
    const closeRaw = closes[i];
    const volumeRaw = volumes[i];

    if (
      typeof tsRaw !== "number" ||
      typeof openRaw !== "number" ||
      typeof highRaw !== "number" ||
      typeof lowRaw !== "number" ||
      typeof closeRaw !== "number" ||
      typeof volumeRaw !== "number"
    ) {
      continue;
    }

    bars.push({
      timestamp: new Date(tsRaw * 1000).toISOString().slice(0, 10),
      symbol,
      open: openRaw,
      high: highRaw,
      low: lowRaw,
      close: closeRaw,
      volume: Math.max(0, Math.round(volumeRaw)),
    });
  }

  return bars.sort(
    (left, right) =>
      new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
  );
}

function calculateSharpeRatio(
  equityCurve: Array<{ timestamp: string; value: number }>,
): number {
  if (equityCurve.length < 2) {
    return 0;
  }

  const returns: number[] = [];
  for (let index = 1; index < equityCurve.length; index++) {
    const previous = equityCurve[index - 1];
    const current = equityCurve[index];
    if (!previous || !current || previous.value === 0) {
      continue;
    }
    returns.push((current.value - previous.value) / previous.value);
  }

  if (returns.length === 0) {
    return 0;
  }

  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) /
    returns.length;
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) {
    return 0;
  }
  return (mean / stdDev) * Math.sqrt(252);
}

function calculateMaxDrawdown(
  equityCurve: Array<{ timestamp: string; value: number }>,
): number {
  if (equityCurve.length === 0) {
    return 0;
  }
  let peak = equityCurve[0]?.value ?? 0;
  let maxDrawdown = 0;
  for (const point of equityCurve) {
    if (point.value > peak) {
      peak = point.value;
    }
    if (peak <= 0) {
      continue;
    }
    const drawdown = (peak - point.value) / peak;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }
  return maxDrawdown;
}

function calculatePortfolioValue(
  cash: number,
  positions: Map<string, number>,
  latestPriceBySymbol: Map<string, number>,
): number {
  let total = cash;
  for (const [symbol, quantity] of positions.entries()) {
    if (quantity <= 0) {
      continue;
    }
    const price = latestPriceBySymbol.get(symbol);
    if (price !== undefined) {
      total += quantity * price;
    }
  }
  return total;
}

function buildDefaultQuantity(
  cash: number,
  price: number,
  assumptions?: Record<string, unknown>,
): number {
  const positionSizePercent =
    typeof assumptions?.positionSize === "number"
      ? assumptions.positionSize
      : 10;
  const allocation = Math.max(0, Math.min(positionSizePercent, 100));
  const budget = cash * (allocation / 100);
  if (budget <= 0 || price <= 0) {
    return 1;
  }
  return Math.max(1, Math.floor(budget / price));
}

function validateLocalInput(input: LocalBacktestInput): string[] {
  const issues: string[] = [];

  if (!input.scriptSource || !input.scriptSource.trim()) {
    issues.push("Strategy script source is required.");
  }

  if (!/function\s+onBar\s*\(/.test(input.scriptSource)) {
    issues.push("Strategy script must define function onBar(ctx). ");
  }

  const universe = Array.from(new Set(input.universe.map(normalizeSymbol)));
  if (universe.length === 0) {
    issues.push("At least one valid symbol is required in the universe.");
  }

  const initialCapital = input.assumptions?.initialCapital;
  if (typeof initialCapital === "number" && initialCapital <= 0) {
    issues.push("initialCapital must be greater than 0.");
  }

  const slippage = input.assumptions?.slippage;
  if (typeof slippage === "number" && (slippage < 0 || slippage > 5000)) {
    issues.push("slippage must be between 0 and 5000 bps.");
  }

  const commission = input.assumptions?.commissionPercent;
  if (typeof commission === "number" && (commission < 0 || commission > 100)) {
    issues.push("commissionPercent must be between 0 and 100.");
  }

  return issues;
}

export class LocalStrategyResearchService {
  constructor(
    private readonly cacheDir: string,
    private readonly opts?: {
      historicalDataLoader?: LocalHistoricalDataLoader;
    },
  ) {}

  private async ensureCacheDir(): Promise<void> {
    await fs.mkdir(this.cacheDir, { recursive: true });
  }

  private getCachePath(symbol: string): string {
    return path.join(this.cacheDir, `${normalizeSymbol(symbol)}.json`);
  }

  private async readCachedBars(
    symbol: string,
  ): Promise<LocalHistoricalBar[] | null> {
    try {
      const filePath = this.getCachePath(symbol);
      const stats = await fs.stat(filePath);
      if (Date.now() - stats.mtimeMs > CACHE_TTL_MS) {
        return null;
      }
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as { bars?: LocalHistoricalBar[] };
      return Array.isArray(parsed.bars) ? parsed.bars : null;
    } catch {
      return null;
    }
  }

  private async writeCachedBars(
    symbol: string,
    bars: LocalHistoricalBar[],
  ): Promise<void> {
    const filePath = this.getCachePath(symbol);
    await fs.writeFile(
      filePath,
      JSON.stringify(
        {
          symbol: normalizeSymbol(symbol),
          updatedAt: new Date().toISOString(),
          bars,
        },
        null,
        2,
      ),
      "utf8",
    );
  }

  private async downloadSymbolBars(
    symbol: string,
  ): Promise<LocalHistoricalBar[]> {
    const normalized = normalizeSymbol(symbol);

    try {
      const response = await fetch(
        `https://stooq.com/q/d/l/?s=${encodeURIComponent(toStooqSymbol(symbol))}&i=d`,
      );
      if (response.ok) {
        const csv = await response.text();
        const bars = parseCsvBars(normalized, csv);
        if (bars.length > 0) {
          await this.writeCachedBars(symbol, bars);
          return bars;
        }
      }
    } catch {
      // Fall through to Yahoo fallback.
    }

    const yahooResponse = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(toYahooSymbol(symbol))}?interval=1d&range=10y&events=history`,
    );
    if (!yahooResponse.ok) {
      throw new Error(
        `historical_download_failed:${symbol}:${yahooResponse.status}`,
      );
    }

    const yahooPayload = (await yahooResponse.json()) as unknown;
    const bars = parseYahooChartBars(normalized, yahooPayload);
    if (bars.length === 0) {
      throw new Error(`historical_data_empty:${symbol}`);
    }

    await this.writeCachedBars(symbol, bars);
    return bars;
  }

  async downloadHistoricalData(
    symbols: string[],
  ): Promise<DownloadHistoricalDataResult> {
    await this.ensureCacheDir();
    const normalizedSymbols = Array.from(
      new Set(symbols.map(normalizeSymbol).filter(Boolean)),
    );

    if (this.opts?.historicalDataLoader) {
      return this.opts.historicalDataLoader(normalizedSymbols);
    }

    const barsBySymbol: Record<string, LocalHistoricalBar[]> = {};
    let downloaded = 0;
    let fromCache = 0;
    const failed: string[] = [];

    for (const symbol of normalizedSymbols) {
      try {
        const cached = await this.readCachedBars(symbol);
        if (cached && cached.length > 0) {
          barsBySymbol[symbol] = cached;
          fromCache += 1;
          continue;
        }

        const downloadedBars = await this.downloadSymbolBars(symbol);
        barsBySymbol[symbol] = downloadedBars;
        downloaded += 1;
      } catch {
        try {
          const stalePath = this.getCachePath(symbol);
          const raw = await fs.readFile(stalePath, "utf8");
          const parsed = JSON.parse(raw) as { bars?: LocalHistoricalBar[] };
          if (Array.isArray(parsed.bars) && parsed.bars.length > 0) {
            barsBySymbol[symbol] = parsed.bars;
            fromCache += 1;
            continue;
          }
        } catch {
          // Fall through to failed list.
        }
        failed.push(symbol);
      }
    }

    return {
      symbols: normalizedSymbols,
      downloaded,
      fromCache,
      failed,
      cacheDir: this.cacheDir,
      barsBySymbol,
    };
  }

  private executeStrategy(
    source: string,
    context: StrategyExecutionContext,
  ): LocalTradeSignal[] {
    const sandbox = vm.createContext({
      ctx: context,
      Math,
      currentBar: () => context.bars[context.currentIndex] ?? null,
      previousBar: (offset = 1) =>
        context.bars[Math.max(0, context.currentIndex - offset)] ?? null,
      barRange: (start: number, end: number) => context.bars.slice(start, end),
      buy: (symbol: string, quantity?: number, reason?: string) => ({
        action: "buy",
        symbol,
        quantity,
        reason,
      }),
      sell: (symbol: string, quantity?: number, reason?: string) => ({
        action: "sell",
        symbol,
        quantity,
        reason,
      }),
      hold: () => ({ action: "hold", symbol: "", quantity: 0 }),
      console: {
        log: () => {},
        warn: () => {},
        error: () => {},
      },
    });

    const script = new vm.Script(`
      ${source}
      if (typeof onBar !== "function") {
        throw new Error("Strategy script must define function onBar(ctx)");
      }
      onBar(ctx);
    `);

    const raw = script.runInContext(sandbox, { timeout: 1000 });
    if (!Array.isArray(raw)) {
      return [];
    }

    return raw.filter((signal): signal is LocalTradeSignal => {
      return (
        signal &&
        typeof signal === "object" &&
        (signal.action === "buy" ||
          signal.action === "sell" ||
          signal.action === "hold")
      );
    });
  }

  async runBacktest(
    input: LocalBacktestInput,
  ): Promise<LocalBacktestRunResult> {
    const validationIssues = validateLocalInput(input);
    if (validationIssues.length > 0) {
      throw new Error(
        `pre_run_validation_failed: ${validationIssues.join(" | ")}`,
      );
    }

    const startedAt = new Date().toISOString();
    const historicalData = await this.downloadHistoricalData(input.universe);
    const availableSymbols = Object.keys(historicalData.barsBySymbol);
    if (availableSymbols.length === 0) {
      throw new Error(
        "No historical data could be loaded for the selected symbols",
      );
    }

    const allBars = availableSymbols
      .flatMap((symbol) => historicalData.barsBySymbol[symbol] ?? [])
      .sort(
        (left, right) =>
          new Date(left.timestamp).getTime() -
            new Date(right.timestamp).getTime() ||
          left.symbol.localeCompare(right.symbol),
      );

    if (allBars.length === 0) {
      throw new Error("Historical data set is empty after parsing");
    }

    const startDateFilter =
      typeof input.assumptions?.startDate === "string" &&
      input.assumptions.startDate.length > 0
        ? input.assumptions.startDate
        : undefined;
    const endDateFilter =
      typeof input.assumptions?.endDate === "string" &&
      input.assumptions.endDate.length > 0
        ? input.assumptions.endDate
        : undefined;

    const filteredBars =
      startDateFilter != null || endDateFilter != null
        ? allBars.filter((bar) => {
            if (startDateFilter && bar.timestamp < startDateFilter) {
              return false;
            }
            if (endDateFilter && bar.timestamp > endDateFilter) {
              return false;
            }
            return true;
          })
        : allBars;

    if (filteredBars.length === 0) {
      throw new Error(
        "No historical bars remain after applying date range filter — check startDate/endDate assumptions",
      );
    }

    const maxPositionWeightPct =
      typeof input.assumptions?.maxPositionWeightPct === "number" &&
      input.assumptions.maxPositionWeightPct > 0
        ? input.assumptions.maxPositionWeightPct
        : undefined;

    const haltTradingOnDrawdownPct =
      typeof input.assumptions?.haltTradingOnDrawdownPct === "number" &&
      input.assumptions.haltTradingOnDrawdownPct > 0
        ? input.assumptions.haltTradingOnDrawdownPct
        : undefined;

    const assumptionsFrozen = { ...(input.assumptions ?? {}) };
    const assumptionsChecksumSha256 = sha256(
      stableStringify(assumptionsFrozen),
    );
    const strategyChecksumSha256 = sha256(input.scriptSource);
    const datasetMaterial = filteredBars
      .map(
        (bar) =>
          `${bar.timestamp}|${bar.symbol}|${bar.open}|${bar.high}|${bar.low}|${bar.close}|${bar.volume}`,
      )
      .join("\n");
    const datasetChecksumSha256 = sha256(datasetMaterial);
    const datasetSnapshotId = `local-snap-${startedAt.slice(0, 10)}-${datasetChecksumSha256.slice(0, 12)}`;

    const initialCapital =
      typeof input.assumptions?.initialCapital === "number"
        ? input.assumptions.initialCapital
        : 100_000;
    const commissionPercent =
      typeof input.assumptions?.commissionPercent === "number"
        ? input.assumptions.commissionPercent
        : 0.05;
    const slippageBps =
      typeof input.assumptions?.slippage === "number"
        ? input.assumptions.slippage
        : 2;

    let cash = initialCapital;
    const positions = new Map<string, number>();
    const latestPriceBySymbol = new Map<string, number>();
    const equityCurve: Array<{ timestamp: string; value: number }> = [];
    const trades: LocalBacktestTrade[] = [];
    let winningTrades = 0;
    let closedTrades = 0;

    let peakPortfolioValue = initialCapital;
    let tradingHalted = false;

    for (let index = 0; index < filteredBars.length; index++) {
      const bar = filteredBars[index];
      if (!bar) {
        continue;
      }
      latestPriceBySymbol.set(bar.symbol, bar.close);
      const portfolioValue = calculatePortfolioValue(
        cash,
        positions,
        latestPriceBySymbol,
      );
      equityCurve.push({ timestamp: bar.timestamp, value: portfolioValue });

      if (portfolioValue > peakPortfolioValue) {
        peakPortfolioValue = portfolioValue;
      }

      if (
        haltTradingOnDrawdownPct != null &&
        peakPortfolioValue > 0 &&
        (peakPortfolioValue - portfolioValue) / peakPortfolioValue >=
          haltTradingOnDrawdownPct / 100
      ) {
        tradingHalted = true;
      }

      if (tradingHalted) {
        continue;
      }

      const signals = this.executeStrategy(input.scriptSource, {
        bars: filteredBars,
        currentIndex: index,
        positions: new Map(positions),
        cash,
        value: portfolioValue,
      });

      for (const signal of signals) {
        if (signal.action === "hold") {
          continue;
        }
        if (!signal.symbol || normalizeSymbol(signal.symbol) !== bar.symbol) {
          continue;
        }

        const quantity = Math.max(
          1,
          Math.floor(
            signal.quantity ??
              buildDefaultQuantity(cash, bar.close, input.assumptions),
          ),
        );
        const fees = bar.close * quantity * (commissionPercent / 100);
        const slippage = bar.close * quantity * (slippageBps / 10_000);

        if (signal.action === "buy") {
          const totalCost = bar.close * quantity + fees + slippage;
          if (cash < totalCost) {
            continue;
          }
          if (maxPositionWeightPct != null) {
            const positionValue = bar.close * quantity;
            const portfolioNow = calculatePortfolioValue(
              cash,
              positions,
              latestPriceBySymbol,
            );
            if (
              portfolioNow > 0 &&
              positionValue / portfolioNow > maxPositionWeightPct / 100
            ) {
              continue;
            }
          }
          cash -= totalCost;
          positions.set(
            bar.symbol,
            (positions.get(bar.symbol) ?? 0) + quantity,
          );
          trades.push({
            timestamp: bar.timestamp,
            symbol: bar.symbol,
            side: "buy",
            quantity,
            price: bar.close,
            fees,
            slippage,
          });
          continue;
        }

        const currentPosition = positions.get(bar.symbol) ?? 0;
        if (currentPosition <= 0) {
          continue;
        }
        const sellQuantity = Math.min(quantity, currentPosition);
        const proceeds = bar.close * sellQuantity - fees - slippage;
        cash += proceeds;
        const nextQuantity = currentPosition - sellQuantity;
        if (nextQuantity <= 0) {
          positions.delete(bar.symbol);
        } else {
          positions.set(bar.symbol, nextQuantity);
        }
        trades.push({
          timestamp: bar.timestamp,
          symbol: bar.symbol,
          side: "sell",
          quantity: sellQuantity,
          price: bar.close,
          fees,
          slippage,
        });
        closedTrades += 1;
        if (proceeds > bar.close * sellQuantity * 0.99) {
          winningTrades += 1;
        }
      }
    }

    const finalValue = calculatePortfolioValue(
      cash,
      positions,
      latestPriceBySymbol,
    );
    const finishedAt = new Date().toISOString();
    const runLogs = [
      `engine=${LOCAL_ENGINE_VERSION}`,
      `symbols=${availableSymbols.join(",")}`,
      `bars=${filteredBars.length}`,
      `trades=${trades.length}`,
      `startingCapital=${initialCapital}`,
      `endingCapital=${Math.round(finalValue * 100) / 100}`,
      `datasetSnapshotId=${datasetSnapshotId}`,
      `datasetChecksum=${datasetChecksumSha256}`,
      `strategyChecksum=${strategyChecksumSha256}`,
      `assumptionsChecksum=${assumptionsChecksumSha256}`,
      ...(startDateFilter != null || endDateFilter != null
        ? [`dateRange=${startDateFilter ?? "*"}..${endDateFilter ?? "*"}`]
        : []),
      ...(tradingHalted ? ["haltedOnDrawdown=true"] : []),
    ];

    const localMetrics = {
      totalReturn:
        initialCapital === 0
          ? 0
          : (finalValue - initialCapital) / initialCapital,
      sharpeRatio: calculateSharpeRatio(equityCurve),
      maxDrawdown: calculateMaxDrawdown(equityCurve),
      numTrades: trades.length,
      endingCapital: finalValue,
      startingCapital: initialCapital,
      winRate: closedTrades === 0 ? 0 : winningTrades / closedTrades,
    };

    let parityDiagnostics: ParityDiagnostics | undefined;
    const companionRaw = input.assumptions?._companionBackendRunMetrics;
    if (
      companionRaw != null &&
      typeof companionRaw === "object" &&
      !Array.isArray(companionRaw)
    ) {
      const companion = companionRaw as Record<string, unknown>;
      const baselineRun = {
        runId:
          typeof companion.runId === "string"
            ? companion.runId
            : "companion-run",
        metrics: {
          totalReturn:
            typeof companion.totalReturn === "number"
              ? companion.totalReturn
              : undefined,
          sharpeRatio:
            typeof companion.sharpeRatio === "number"
              ? companion.sharpeRatio
              : undefined,
          maxDrawdown:
            typeof companion.maxDrawdown === "number"
              ? companion.maxDrawdown
              : undefined,
          numTrades:
            typeof companion.numTrades === "number"
              ? companion.numTrades
              : undefined,
          endingCapital:
            typeof companion.endingCapital === "number"
              ? companion.endingCapital
              : undefined,
        },
      };
      const candidateRun = {
        runId: input.runId,
        metrics: localMetrics,
      };
      parityDiagnostics = compareRunsForParity(baselineRun, candidateRun);
    }

    return {
      runId: input.runId,
      strategyId: input.strategyId,
      strategyVersion: input.strategyVersion,
      status: "completed",
      startedAt,
      finishedAt,
      metrics: localMetrics,
      equityCurve,
      trades,
      historicalData: {
        symbols: availableSymbols,
        source: "internet",
        cacheDir: this.cacheDir,
      },
      runMetadata: {
        engineVersion: LOCAL_ENGINE_VERSION,
        datasetSnapshotId,
        datasetChecksumSha256,
        strategyChecksumSha256,
        assumptionsChecksumSha256,
        assumptionsFrozen,
        ...(startDateFilter != null || endDateFilter != null
          ? {
              dateRangeApplied: {
                startDate: startDateFilter,
                endDate: endDateFilter,
              },
            }
          : {}),
        ...(maxPositionWeightPct != null || haltTradingOnDrawdownPct != null
          ? {
              riskControlsApplied: {
                ...(maxPositionWeightPct != null
                  ? { maxPositionWeightPct }
                  : {}),
                ...(haltTradingOnDrawdownPct != null
                  ? { haltTradingOnDrawdownPct }
                  : {}),
              },
            }
          : {}),
        ...(parityDiagnostics != null ? { parityDiagnostics } : {}),
      },
      runLogs,
    };
  }
}

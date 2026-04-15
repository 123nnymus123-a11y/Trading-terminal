import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LocalStrategyResearchService,
  type LocalHistoricalBar,
} from "./localStrategyResearchService.js";
import {
  compareRunsForParity,
  DEFAULT_PARITY_THRESHOLDS,
} from "./parityHarness.js";

type OHLCVBar = {
  timestamp: string;
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type HistoricalDataSnapshot = {
  snapshotId: string;
  name: string;
  version: string;
  createdAt: string;
  bars: Map<string, OHLCVBar[]>;
  symbols: Set<string>;
};

interface IHistoricalDataProvider {
  loadSnapshot(snapshotId: string): Promise<HistoricalDataSnapshot>;
  getAvailableSnapshots(): Promise<string[]>;
  getBarsForSymbol(
    snapshot: HistoricalDataSnapshot,
    symbol: string,
  ): OHLCVBar[];
}

const TEST_SCRIPT = `function onBar(ctx) {
  const bar = currentBar();
  const prev = previousBar();
  if (!bar || !prev || bar.symbol !== prev.symbol) {
    return [hold()];
  }

  if (bar.close > prev.close) {
    return [buy(bar.symbol, 1, "momentum_up")];
  }

  if (bar.close < prev.close) {
    return [sell(bar.symbol, 1, "momentum_down")];
  }

  return [hold()];
}`;

function fixtureBars(): LocalHistoricalBar[] {
  return [
    {
      timestamp: "2024-01-02",
      symbol: "AAPL",
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 1000,
    },
    {
      timestamp: "2024-01-03",
      symbol: "AAPL",
      open: 100,
      high: 102,
      low: 99,
      close: 101,
      volume: 1100,
    },
    {
      timestamp: "2024-01-04",
      symbol: "AAPL",
      open: 101,
      high: 102,
      low: 98,
      close: 100,
      volume: 1200,
    },
    {
      timestamp: "2024-01-05",
      symbol: "AAPL",
      open: 100,
      high: 103,
      low: 99,
      close: 102,
      volume: 1300,
    },
  ];
}

class FixtureProvider implements IHistoricalDataProvider {
  constructor(private readonly bars: OHLCVBar[]) {}

  async loadSnapshot(snapshotId: string): Promise<HistoricalDataSnapshot> {
    return {
      snapshotId,
      name: "fixture",
      version: "v1",
      createdAt: "2024-01-01T00:00:00.000Z",
      bars: new Map([["AAPL", [...this.bars]]]),
      symbols: new Set(["AAPL"]),
    };
  }

  async getAvailableSnapshots(): Promise<string[]> {
    return ["fixture-snapshot"];
  }

  getBarsForSymbol(
    snapshot: HistoricalDataSnapshot,
    symbol: string,
  ): OHLCVBar[] {
    return snapshot.bars.get(symbol) ?? [];
  }
}

function workspaceCacheDir(): string {
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    ".parity-test-cache",
  );
}

const backendParityModuleDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../backend/src/services/backtesting",
);

const backendParityAvailable =
  fs.existsSync(path.join(backendParityModuleDir, "backtestEngine.js")) &&
  fs.existsSync(path.join(backendParityModuleDir, "scriptExecutor.js"));

async function loadBackendParityModules(): Promise<{
  BacktestEngine: new (
    provider: IHistoricalDataProvider,
    executor: unknown,
  ) => { run(input: unknown): Promise<any> };
  createScriptExecutor: () => unknown;
} | null> {
  if (!backendParityAvailable) {
    return null;
  }

  const [{ BacktestEngine }, { createScriptExecutor }] = await Promise.all([
    import("../../../../../backend/src/services/backtesting/backtestEngine.js"),
    import("../../../../../backend/src/services/backtesting/scriptExecutor.js"),
  ]);

  return {
    BacktestEngine: BacktestEngine as new (
      provider: IHistoricalDataProvider,
      executor: unknown,
    ) => { run(input: unknown): Promise<any> },
    createScriptExecutor: createScriptExecutor as () => unknown,
  };
}

describe("strategy research parity harness", () => {
  it("golden scenario produces expected local fill sequence", async () => {
    const bars = fixtureBars();
    const localService = new LocalStrategyResearchService(workspaceCacheDir(), {
      historicalDataLoader: async (symbols) => ({
        symbols,
        downloaded: 0,
        fromCache: symbols.length,
        failed: [],
        cacheDir: workspaceCacheDir(),
        barsBySymbol: { AAPL: bars },
      }),
    });

    const localRun = await localService.runBacktest({
      runId: "golden-local-run",
      strategyId: "golden-strategy",
      strategyVersion: "v1",
      scriptSource: TEST_SCRIPT,
      universe: ["AAPL"],
      assumptions: {
        initialCapital: 1000,
        commissionPercent: 0,
        slippage: 0,
      },
    });

    expect(localRun.status).toBe("completed");
    expect(localRun.trades).toHaveLength(3);
    expect(localRun.trades.map((trade) => trade.side)).toEqual([
      "buy",
      "sell",
      "buy",
    ]);
    expect(localRun.metrics.numTrades).toBe(3);
    expect(localRun.metrics.endingCapital).toBeCloseTo(999, 6);
  });

  it("automated parity suite passes for deterministic backend/local scenario", async () => {
    const backendModules = await loadBackendParityModules();
    if (!backendModules) {
      console.warn(
        "Skipping backend parity assertion because private backend modules are unavailable in this repo.",
      );
      return;
    }

    const { BacktestEngine, createScriptExecutor } = backendModules;
    const bars = fixtureBars();

    const localService = new LocalStrategyResearchService(workspaceCacheDir(), {
      historicalDataLoader: async (symbols) => ({
        symbols,
        downloaded: 0,
        fromCache: symbols.length,
        failed: [],
        cacheDir: workspaceCacheDir(),
        barsBySymbol: { AAPL: bars },
      }),
    });

    const localRun = await localService.runBacktest({
      runId: "parity-local-run",
      strategyId: "parity-strategy",
      strategyVersion: "v1",
      scriptSource: TEST_SCRIPT,
      universe: ["AAPL"],
      assumptions: {
        initialCapital: 1000,
        commissionPercent: 0,
        slippage: 0,
      },
    });

    const backendEngine = new BacktestEngine(
      new FixtureProvider(bars),
      createScriptExecutor(),
    );

    const backendRun = await backendEngine.run({
      snapshotId: "fixture-snapshot",
      scriptSource: TEST_SCRIPT,
      entrypoint: "onBar",
      universe: ["AAPL"],
      assumptions: {
        initialCapital: 1000,
        transactionCostBps: 0,
        slippageBps: 0,
      },
    });

    expect(backendRun.success).toBe(true);
    expect(backendRun.metrics).not.toBeNull();

    const diagnostics = compareRunsForParity(
      {
        runId: "backend",
        metrics: {
          totalReturn: (backendRun.metrics?.totalReturn ?? 0) / 100,
          sharpeRatio: backendRun.metrics?.sharpeRatio ?? 0,
          maxDrawdown: (backendRun.metrics?.maxDrawdown ?? 0) / 100,
          endingCapital: backendRun.metrics?.endingCapital ?? 0,
          numTrades: backendRun.metrics?.numTrades ?? 0,
        },
      },
      {
        runId: "local",
        metrics: {
          totalReturn: localRun.metrics.totalReturn,
          sharpeRatio: localRun.metrics.sharpeRatio,
          maxDrawdown: localRun.metrics.maxDrawdown,
          endingCapital: localRun.metrics.endingCapital,
          numTrades: localRun.metrics.numTrades,
        },
      },
      DEFAULT_PARITY_THRESHOLDS,
    );

    expect(diagnostics.pass).toBe(true);
  });

  it("drift thresholds emit failure diagnostics when exceeded", () => {
    const diagnostics = compareRunsForParity(
      {
        runId: "baseline",
        metrics: {
          totalReturn: 0.05,
          sharpeRatio: 1.2,
          maxDrawdown: 0.08,
          endingCapital: 105000,
          numTrades: 25,
        },
      },
      {
        runId: "candidate",
        metrics: {
          totalReturn: 0.02,
          sharpeRatio: 0.8,
          maxDrawdown: 0.14,
          endingCapital: 102000,
          numTrades: 30,
        },
      },
      {
        totalReturnAbs: 0.005,
        sharpeAbs: 0.1,
        maxDrawdownAbs: 0.01,
        endingCapitalAbs: 500,
        numTradesAbs: 1,
      },
    );

    expect(diagnostics.pass).toBe(false);
    const failedMetrics = diagnostics.metrics.filter((metric) => !metric.pass);
    expect(failedMetrics.length).toBeGreaterThan(0);
    expect(
      failedMetrics.some((metric) => metric.metric === "totalReturn"),
    ).toBe(true);
    expect(
      failedMetrics.every((metric) =>
        metric.message.includes("exceeded threshold"),
      ),
    ).toBe(true);
  });
});

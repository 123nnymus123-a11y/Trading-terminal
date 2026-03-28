import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { BacktestingRepo } from "./backtestingRepo.js";
import { StrategyRepo } from "./strategyRepo.js";
import {
  createHistoricalDataProvider,
  type HistoricalDataSnapshot,
  type IHistoricalDataProvider,
  type OHLCVBar,
} from "./historicalDataProvider.js";
import { createScriptExecutor } from "./scriptExecutor.js";
import { createAdvancedBacktestEngine } from "./advancedBacktestEngine.js";
import { compareRunMetrics } from "./backtestAnalytics.js";

export type WalkForwardWindow = {
  trainStart: string;
  trainEnd: string;
  testStart: string;
  testEnd: string;
  totalReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
};

export type ParameterSweepResult = {
  label: string;
  assumptions: Record<string, unknown>;
  totalReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
};

export type RegimeSliceResult = {
  regime: "bull" | "bear" | "high-vol" | "low-vol";
  barCount: number;
  totalReturn: number;
  sharpeRatio: number;
};

export type BootstrapResult = {
  iterations: number;
  meanReturn: number;
  p05Return: number;
  p95Return: number;
};

export type StressTestResult = {
  scenario: string;
  totalReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
};

export type RobustnessReport = {
  walkForward: WalkForwardWindow[];
  rollingOutOfSample: WalkForwardWindow[];
  parameterSweep: ParameterSweepResult[];
  regimeSlices: RegimeSliceResult[];
  bootstrap: BootstrapResult;
  stressTests: StressTestResult[];
  benchmarkComparison: ReturnType<typeof compareRunMetrics> | null;
};

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class InMemoryHistoricalDataProvider implements IHistoricalDataProvider {
  constructor(
    private readonly snapshots: Map<string, HistoricalDataSnapshot>,
  ) {}

  async loadSnapshot(
    snapshotId: string,
  ): Promise<HistoricalDataSnapshot | null> {
    return this.snapshots.get(snapshotId) ?? null;
  }

  async getAvailableSnapshots(): Promise<string[]> {
    return Array.from(this.snapshots.keys());
  }

  getBarsForSymbol(
    snapshot: HistoricalDataSnapshot,
    symbol: string,
  ): OHLCVBar[] {
    return snapshot.bars.get(symbol) ?? [];
  }
}

export class BacktestRobustnessService {
  private readonly repo: BacktestingRepo;
  private readonly strategyRepo: StrategyRepo;

  constructor(private readonly pool: Pool) {
    this.repo = new BacktestingRepo(pool);
    this.strategyRepo = new StrategyRepo(pool);
  }

  private resolveTenant(tenantId?: string): string {
    return tenantId && tenantId.trim().length > 0 ? tenantId.trim() : "default";
  }

  async runSuite(input: {
    runId: string;
    userId: string;
    tenantId?: string;
  }): Promise<RobustnessReport> {
    const tenantId = this.resolveTenant(input.tenantId);
    const run = await this.repo.getRun(input.runId, input.userId, tenantId);
    if (!run) {
      throw new Error("robustness_run_not_found");
    }
    const strategyVersion = await this.strategyRepo.getVersion(
      run.strategyId,
      run.strategyVersion,
      input.userId,
      tenantId,
    );
    if (!strategyVersion) {
      throw new Error("robustness_strategy_version_not_found");
    }
    const assumptionsResult = await this.pool.query(
      `SELECT assumptions FROM strategy_run_assumptions WHERE run_id = $1`,
      [input.runId],
    );
    const assumptions = assumptionsResult.rows[0]?.assumptions ?? {};

    const dataProvider = createHistoricalDataProvider("database", {
      pool: this.pool,
      dataDir: "./data",
    });
    const snapshot = await dataProvider.loadSnapshot(run.snapshotId);
    if (!snapshot) {
      throw new Error("robustness_snapshot_not_found");
    }

    const allBars = strategyVersion.universe.flatMap((symbol) =>
      dataProvider.getBarsForSymbol(snapshot, symbol),
    );
    allBars.sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
    const windowSize = Math.max(20, Math.floor(allBars.length / 6));
    const testSize = Math.max(10, Math.floor(windowSize / 3));

    const makeWindow = async (
      startIndex: number,
      size: number,
      label: string,
      assumptionOverrides: Record<string, unknown> = {},
    ) => {
      const slice = allBars.slice(
        startIndex,
        Math.min(allBars.length, startIndex + size),
      );
      if (slice.length < 10) {
        return null;
      }
      const syntheticSnapshotId = `robust-${label}-${randomUUID()}`;
      const bars = new Map<string, OHLCVBar[]>();
      const symbols = new Set<string>();
      for (const bar of slice) {
        const existing = bars.get(bar.symbol) ?? [];
        existing.push(bar);
        bars.set(bar.symbol, existing);
        symbols.add(bar.symbol);
      }
      const engine = createAdvancedBacktestEngine(
        new InMemoryHistoricalDataProvider(
          new Map([
            [
              syntheticSnapshotId,
              {
                snapshotId: syntheticSnapshotId,
                name: `${run.snapshotId}-${label}`,
                version: label,
                createdAt: new Date().toISOString(),
                bars,
                symbols,
              },
            ],
          ]),
        ),
        createScriptExecutor(),
      );
      const result = await engine.run({
        snapshotId: syntheticSnapshotId,
        scriptSource: strategyVersion.scriptSource,
        entrypoint: strategyVersion.scriptEntrypoint,
        universe: strategyVersion.universe,
        assumptions: { ...assumptions, ...assumptionOverrides },
      });
      return result.success && result.metrics ? result : null;
    };

    const walkForward: WalkForwardWindow[] = [];
    for (
      let index = 0;
      index + windowSize + testSize < allBars.length;
      index += testSize
    ) {
      const train = allBars.slice(index, index + windowSize);
      const test = allBars.slice(
        index + windowSize,
        index + windowSize + testSize,
      );
      if (train.length < 10 || test.length < 5) {
        continue;
      }
      const result = await makeWindow(
        index + windowSize,
        testSize,
        `wf-${index}`,
      );
      if (!result?.metrics) {
        continue;
      }
      walkForward.push({
        trainStart: train[0]!.timestamp,
        trainEnd: train[train.length - 1]!.timestamp,
        testStart: test[0]!.timestamp,
        testEnd: test[test.length - 1]!.timestamp,
        totalReturn: result.metrics.totalReturn,
        sharpeRatio: result.metrics.sharpeRatio,
        maxDrawdown: result.metrics.maxDrawdown,
      });
    }

    const rollingOutOfSample = walkForward.slice();

    const parameterSweepMatrix = [
      { label: "base", overrides: {} },
      {
        label: "higher-costs",
        overrides: {
          transactionCostBps: Number(assumptions.transactionCostBps ?? 5) * 2,
        },
      },
      {
        label: "higher-slippage",
        overrides: { slippageBps: Number(assumptions.slippageBps ?? 2) * 2 },
      },
      {
        label: "lower-size",
        overrides: {
          maxPositionSizePct: Math.max(
            5,
            Number(assumptions.maxPositionSizePct ?? 100) / 2,
          ),
        },
      },
      {
        label: "higher-liquidity-friction",
        overrides: { liquidityCapPct: 2, marketImpactBpsPer10PctADV: 15 },
      },
    ];

    const parameterSweep: ParameterSweepResult[] = [];
    for (const scenario of parameterSweepMatrix) {
      const result = await makeWindow(
        0,
        allBars.length,
        `sweep-${scenario.label}`,
        scenario.overrides,
      );
      if (!result?.metrics) {
        continue;
      }
      parameterSweep.push({
        label: scenario.label,
        assumptions: scenario.overrides,
        totalReturn: result.metrics.totalReturn,
        sharpeRatio: result.metrics.sharpeRatio,
        maxDrawdown: result.metrics.maxDrawdown,
      });
    }

    const dailyReturns = allBars.map((bar, index) => {
      const previous = allBars[index - 1];
      if (!previous || previous.symbol !== bar.symbol || previous.close === 0) {
        return 0;
      }
      return (bar.close - previous.close) / previous.close;
    });
    const volatilityThreshold =
      dailyReturns.reduce((sum, value) => sum + Math.abs(value), 0) /
      Math.max(1, dailyReturns.length);
    const regimeBuckets: Record<RegimeSliceResult["regime"], number[]> = {
      bull: [],
      bear: [],
      "high-vol": [],
      "low-vol": [],
    };
    dailyReturns.forEach((value, index) => {
      if (value >= 0) regimeBuckets.bull.push(index);
      if (value < 0) regimeBuckets.bear.push(index);
      if (Math.abs(value) >= volatilityThreshold)
        regimeBuckets["high-vol"].push(index);
      if (Math.abs(value) < volatilityThreshold)
        regimeBuckets["low-vol"].push(index);
    });
    const regimeSlices: RegimeSliceResult[] = Object.entries(regimeBuckets).map(
      ([regime, indexes]) => {
        const subset = indexes.map((index) => dailyReturns[index] ?? 0);
        const totalReturn = subset.reduce(
          (acc, value) => (1 + acc) * (1 + value) - 1,
          0,
        );
        const volatility =
          subset.length > 1
            ? Math.sqrt(
                subset.reduce((sum, value) => sum + Math.pow(value, 2), 0) /
                  subset.length,
              ) * Math.sqrt(252)
            : 0;
        return {
          regime: regime as RegimeSliceResult["regime"],
          barCount: indexes.length,
          totalReturn,
          sharpeRatio:
            volatility > 0
              ? (subset.reduce((sum, value) => sum + value, 0) /
                  Math.max(1, subset.length) /
                  volatility) *
                Math.sqrt(252)
              : 0,
        };
      },
    );

    const rng = seededRandom(42);
    const bootstrapSamples: number[] = [];
    for (let iteration = 0; iteration < 250; iteration++) {
      let compounded = 1;
      for (let index = 0; index < Math.max(1, dailyReturns.length); index++) {
        const value =
          dailyReturns[Math.floor(rng() * Math.max(1, dailyReturns.length))] ??
          0;
        compounded *= 1 + value;
      }
      bootstrapSamples.push(compounded - 1);
    }
    bootstrapSamples.sort((a, b) => a - b);
    const bootstrap: BootstrapResult = {
      iterations: bootstrapSamples.length,
      meanReturn:
        bootstrapSamples.reduce((sum, value) => sum + value, 0) /
        bootstrapSamples.length,
      p05Return:
        bootstrapSamples[Math.floor(bootstrapSamples.length * 0.05)] ?? 0,
      p95Return:
        bootstrapSamples[Math.floor(bootstrapSamples.length * 0.95)] ?? 0,
    };

    const stressScenarios = [
      {
        scenario: "double-slippage",
        overrides: { slippageBps: Number(assumptions.slippageBps ?? 2) * 2 },
      },
      {
        scenario: "double-costs",
        overrides: {
          transactionCostBps: Number(assumptions.transactionCostBps ?? 5) * 2,
        },
      },
      {
        scenario: "missing-every-10th-bar",
        overrides: { missingDataStressEveryNthBar: 10 },
      },
      {
        scenario: "spread-shock",
        overrides: { spreadBps: Number(assumptions.spreadBps ?? 0) + 20 },
      },
    ];
    const stressTests: StressTestResult[] = [];
    for (const scenario of stressScenarios) {
      const result = await makeWindow(
        0,
        allBars.length,
        `stress-${scenario.scenario}`,
        scenario.overrides,
      );
      if (!result?.metrics) {
        continue;
      }
      stressTests.push({
        scenario: scenario.scenario,
        totalReturn: result.metrics.totalReturn,
        sharpeRatio: result.metrics.sharpeRatio,
        maxDrawdown: result.metrics.maxDrawdown,
      });
    }

    const currentMetrics = run.metrics ?? {};
    const baseline = parameterSweep[0];
    const benchmarkComparison = baseline
      ? compareRunMetrics({
          runId: input.runId,
          baselineRunId: `${input.runId}:base`,
          runMetrics: currentMetrics,
          baselineMetrics: {
            totalReturn: baseline.totalReturn,
            sharpeRatio: baseline.sharpeRatio,
            maxDrawdown: baseline.maxDrawdown,
          },
          trackedFields: ["totalReturn", "sharpeRatio", "maxDrawdown"],
        })
      : null;

    return {
      walkForward,
      rollingOutOfSample,
      parameterSweep,
      regimeSlices,
      bootstrap,
      stressTests,
      benchmarkComparison,
    };
  }
}

export function createBacktestRobustnessService(
  pool: Pool,
): BacktestRobustnessService {
  return new BacktestRobustnessService(pool);
}

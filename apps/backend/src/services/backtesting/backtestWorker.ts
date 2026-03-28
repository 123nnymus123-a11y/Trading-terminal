// Backtest worker - processes queued backtest runs
// Integrates all components: engine, data provider, executor, persistence

import type { Pool } from "pg";
import type DurableJobQueue from "../../queue.js";
import { createAdvancedBacktestEngine } from "./advancedBacktestEngine.js";
import { createScriptExecutor } from "./scriptExecutor.js";
import { createHistoricalDataProvider } from "./historicalDataProvider.js";
import { BacktestingRepo } from "./backtestingRepo.js";
import { StrategyRepo } from "./strategyRepo.js";
import { computeAdvancedBacktestMetrics } from "./backtestAnalytics.js";
import { createLogger } from "../../logger.js";
import { randomUUID } from "node:crypto";
import type { BacktestExecutionMode } from "./backtestingRepo.js";

const logger = createLogger("backtest-worker");

export type BacktestWorkerPayload = {
  runId: string;
  tenantId: string;
  userId: string;
  strategyId: string;
  strategyVersion: string;
  snapshotId: string;
  queueResourceClass?: "standard" | "heavy";
  executionMode?: BacktestExecutionMode;
};

export function createBacktestWorker(
  pool: Pool,
  queue: DurableJobQueue,
  dataProviderType: "mock" | "filesystem" | "database" = "mock",
) {
  const repo = new BacktestingRepo(pool);
  const strategyRepo = new StrategyRepo(pool);
  const executor = createScriptExecutor();
  const dataProvider = createHistoricalDataProvider(dataProviderType, {
    pool,
    dataDir: "./data",
  });
  const engine = createAdvancedBacktestEngine(dataProvider, executor);

  // Register the backtest processor
  queue.registerProcessor<BacktestWorkerPayload, { success: boolean }>(
    "backtest.run",
    async (payload, job) => {
      try {
        logger.info("backtest_job_started", { runId: payload.runId });

        await repo.updateRetryProgress(
          payload.runId,
          payload.userId,
          Math.max(0, job.attempts - 1),
          Math.max(1, job.maxAttempts),
          payload.tenantId,
        );

        // Update status to running
        await repo.setRunStatus(
          payload.runId,
          payload.userId,
          "running",
          payload.tenantId,
          {
            runMetadata: {
              worker: {
                startedAt: new Date().toISOString(),
                dataProviderType,
                executionMode: payload.executionMode ?? "backend",
              },
            },
          },
        );

        // Fetch strategy version
        const strategyVersion = await strategyRepo.getVersion(
          payload.strategyId,
          payload.strategyVersion,
          payload.userId,
          payload.tenantId,
        );

        if (!strategyVersion) {
          const errMsg = `Strategy version not found: ${payload.strategyId}@${payload.strategyVersion}`;
          logger.error("strategy_version_not_found", { ...payload });

          await repo.setRunStatus(
            payload.runId,
            payload.userId,
            "failed",
            payload.tenantId,
            { error: errMsg },
          );

          return { success: false };
        }

        // Fetch run assumptions
        const assumptions =
          (await repo.getRunAssumptions(
            payload.runId,
            payload.userId,
            payload.tenantId,
          )) ?? {};

        const snapshot = await dataProvider.loadSnapshot(payload.snapshotId);
        if (!snapshot) {
          throw new Error(`Snapshot not found: ${payload.snapshotId}`);
        }

        const snapshotBarCount = Array.from(snapshot.symbols).reduce(
          (sum, symbol) =>
            sum + dataProvider.getBarsForSymbol(snapshot, symbol).length,
          0,
        );
        if (snapshotBarCount === 0) {
          const errMsg =
            "Dataset snapshot loaded but contains zero bars. Backend runs require real snapshot bar data.";
          await repo.setRunStatus(
            payload.runId,
            payload.userId,
            "failed",
            payload.tenantId,
            { error: errMsg },
          );
          logger.error("backtest_snapshot_empty", {
            runId: payload.runId,
            snapshotId: payload.snapshotId,
          });
          return { success: false };
        }

        // Execute backtest
        const result = await engine.run({
          snapshotId: payload.snapshotId,
          scriptSource: strategyVersion.scriptSource,
          entrypoint: strategyVersion.scriptEntrypoint,
          universe: strategyVersion.universe,
          assumptions,
        });

        // Persist trades
        if (result.trades.length > 0) {
          for (const trade of result.trades) {
            const tradeId = `trd-${randomUUID()}`;
            await pool.query(
              `INSERT INTO strategy_run_trades
               (trade_id, run_id, tenant_id, symbol, side, quantity, fill_price, trade_ts, fees, slippage_bps)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
              [
                tradeId,
                payload.runId,
                payload.tenantId,
                trade.symbol,
                trade.side,
                trade.quantity,
                trade.price,
                trade.timestamp,
                trade.fees,
                (trade.slippage / (trade.quantity * trade.price)) * 10000,
              ],
            );
          }
        }

        // Persist metrics
        if (result.success && result.metrics) {
          const benchmarkSymbol =
            typeof assumptions.benchmarkSymbol === "string"
              ? assumptions.benchmarkSymbol.toUpperCase()
              : undefined;
          const benchmarkBars = benchmarkSymbol
            ? dataProvider.getBarsForSymbol(snapshot, benchmarkSymbol)
            : undefined;
          const advancedMetrics = computeAdvancedBacktestMetrics({
            equityCurve: result.equityCurve,
            trades: result.trades,
            fills: result.fills,
            orders: result.orders,
            positions: result.positions,
            exposureCurve: result.exposureCurve,
            startingCapital: result.metrics.startingCapital,
            endingCapital: result.metrics.endingCapital,
            sectorMap: Object.fromEntries(
              Object.entries(
                (assumptions.symbolClassification as Record<string, unknown>) ??
                  {},
              ).map(([symbol, classification]) => [
                symbol.toUpperCase(),
                typeof (classification as Record<string, unknown>)?.sector ===
                "string"
                  ? ((classification as Record<string, unknown>)
                      .sector as string)
                  : "",
              ]),
            ),
            peakDrawdownPct: result.metrics.maxDrawdown,
            ...(assumptions.factorExposureMap
              ? {
                  factorMap: assumptions.factorExposureMap as Record<
                    string,
                    Record<string, number>
                  >,
                }
              : {}),
            ...(benchmarkBars ? { benchmarkBars } : {}),
            ...(benchmarkSymbol ? { benchmarkSymbol } : {}),
          });

          const metrics = {
            ...result.metrics,
            ...advancedMetrics,
            engineVersion: "advanced-backtest-engine@2.0.0",
            benchmarkSymbol,
          };

          await repo.setRunStatus(
            payload.runId,
            payload.userId,
            "completed",
            payload.tenantId,
            {
              metrics,
              runMetadata: {
                worker: {
                  finishedAt: new Date().toISOString(),
                  dataProviderType,
                  executionMode: payload.executionMode ?? "backend",
                },
                reproducibility: {
                  engineVersion: "advanced-backtest-engine@2.0.0",
                },
              },
            },
          );

          await repo.saveArtifact({
            artifactId: `art-${randomUUID()}`,
            runId: payload.runId,
            tenantId: payload.tenantId,
            artifactKind: "equity_curve",
            artifactUri: `memory://equity-curve-${payload.runId}`,
            sizeBytes: JSON.stringify(result.equityCurve).length,
            payload: {
              snapshots: result.equityCurve,
              exposureCurve: result.exposureCurve,
            },
          });

          await repo.saveArtifact({
            artifactId: `art-${randomUUID()}`,
            runId: payload.runId,
            tenantId: payload.tenantId,
            artifactKind: "trades",
            artifactUri: `memory://trades-${payload.runId}`,
            sizeBytes: JSON.stringify(result.trades).length,
            payload: {
              trades: result.trades,
              fills: result.fills,
              orders: result.orders,
              positions: result.positions,
            },
          });

          await repo.saveArtifact({
            artifactId: `art-${randomUUID()}`,
            runId: payload.runId,
            tenantId: payload.tenantId,
            artifactKind: "report",
            artifactUri: `memory://analytics-${payload.runId}`,
            sizeBytes: JSON.stringify(advancedMetrics).length,
            payload: {
              analytics: advancedMetrics,
              diagnostics: result.diagnostics,
              assumptions,
            },
          });

          await repo.saveArtifact({
            artifactId: `art-${randomUUID()}`,
            runId: payload.runId,
            tenantId: payload.tenantId,
            artifactKind: "config_bundle",
            artifactUri: `memory://config-bundle-${payload.runId}`,
            sizeBytes:
              JSON.stringify(strategyVersion.universe).length +
              JSON.stringify(assumptions).length,
            payload: {
              strategyId: payload.strategyId,
              strategyVersion: payload.strategyVersion,
              scriptChecksum: strategyVersion.scriptChecksum,
              universe: strategyVersion.universe,
              datasetSnapshotId: payload.snapshotId,
              assumptionsFrozen: assumptions,
              executionMode: payload.executionMode ?? "backend",
              engineVersion: "advanced-backtest-engine@2.0.0",
              bundledAt: new Date().toISOString(),
            },
          });

          logger.info("backtest_completed", {
            runId: payload.runId,
            metrics: result.metrics,
            numTrades: result.trades.length,
          });

          return { success: true };
        } else {
          const errMsg = result.errors.join("; ") || "Unknown backtest error";

          await repo.setRunStatus(
            payload.runId,
            payload.userId,
            "failed",
            payload.tenantId,
            {
              error: errMsg,
              runMetadata: {
                worker: {
                  failedAt: new Date().toISOString(),
                  dataProviderType,
                  executionMode: payload.executionMode ?? "backend",
                },
              },
            },
          );

          logger.error("backtest_failed", {
            runId: payload.runId,
            error: errMsg,
          });

          return { success: false };
        }
      } catch (error) {
        logger.error("backtest_worker_error", {
          runId: payload.runId,
          attempt: job.attempts,
          maxAttempts: job.maxAttempts,
          error: error instanceof Error ? error.message : "unknown",
        });

        try {
          const errMsg =
            error instanceof Error ? error.message : "Worker execution error";
          const exhausted = job.attempts >= job.maxAttempts;
          await repo.updateRetryProgress(
            payload.runId,
            payload.userId,
            Math.max(0, job.attempts),
            Math.max(1, job.maxAttempts),
            payload.tenantId,
            errMsg,
          );
          await repo.setRunStatus(
            payload.runId,
            payload.userId,
            exhausted ? "failed" : "queued",
            payload.tenantId,
            {
              error: errMsg,
              runMetadata: {
                worker: {
                  retryAt: new Date().toISOString(),
                  retryAttempt: Math.max(0, job.attempts),
                  dataProviderType,
                  executionMode: payload.executionMode ?? "backend",
                },
              },
            },
          );
        } catch (persistError) {
          logger.error("backtest_worker_error_persistence", {
            runId: payload.runId,
            error:
              persistError instanceof Error ? persistError.message : "unknown",
          });
        }

        throw error; // Re-throw for queue retry logic
      }
    },
  );
}

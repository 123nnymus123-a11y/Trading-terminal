/**
 * Artifact Generation Service
 * Generates and persists run artifacts: manifests, CSV exports, warnings
 */

import { createHash, randomUUID } from "node:crypto";
import type { BacktestingRepo } from "./backtestingRepo.js";
import type { StrategyVersionRecord } from "./strategyRepo.js";
import type { AdvancedBacktestMetrics } from "./backtestAnalytics.js";
import type {
  SimulatedTrade,
  FillRecord,
  PositionRecord,
  Order,
} from "./advancedBacktestEngine.js";
import { createLogger } from "../../logger.js";

const logger = createLogger("artifact-generation");

export type GenerateArtifactsInput = {
  runId: string;
  tenantId: string;
  userId: string;
  strategyId: string;
  strategyVersion: StrategyVersionRecord;
  snapshotId: string;
  executionMode: "desktop-local" | "backend" | "paper" | "live";
  assumptions: Record<string, unknown>;
  metrics: Record<string, unknown> & { engineVersion?: string };
  equityCurve: Array<{ timestamp: string; value: number }>;
  exposureCurve: Array<{
    timestamp: string;
    grossExposure: number;
    netExposure: number;
    turnoverPct: number;
  }>;
  trades: SimulatedTrade[];
  fills: FillRecord[];
  orders: Order[];
  positions: PositionRecord[];
  advancedMetrics?: AdvancedBacktestMetrics;
  warnings?: Array<{
    code: string;
    message: string;
    severity: "info" | "warning" | "error";
  }>;
  diagnostics?: Array<{ code: string; message: string }>;
};

export type ManifestDocument = {
  runId: string;
  strategyId: string;
  strategyVersion: string;
  datasetSnapshotId: string;
  executionMode: string;
  generatedAt: string;
  engineVersion: string;
  strategy: {
    id: string;
    version: string;
    codeHash: string;
    notes?: string;
  };
  dataset: {
    snapshotId: string;
    datasetName: string;
    datasetVersion: string;
  };
  execution: {
    startCapital: number;
    endCapital: number;
    returnPct: number;
    period: {
      start: string;
      end: string;
    };
    tradesCount: number;
  };
  assumptions: Record<string, unknown>;
  keyMetrics: Record<string, number | undefined>;
  artifacts: Array<{ kind: string; uri: string; createdAt: string }>;
};

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function formatCsvRow(values: (string | number | null | undefined)[]): string {
  return values
    .map((v) => {
      if (v === null || v === undefined) return "";
      const str = String(v);
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    })
    .join(",");
}

function generateEquityCurveCsv(
  equityCurve: Array<{ timestamp: string; value: number }>,
): string {
  const lines: string[] = [];
  lines.push(formatCsvRow(["timestamp", "value"]));
  for (const point of equityCurve) {
    lines.push(formatCsvRow([point.timestamp, point.value]));
  }
  return lines.join("\n");
}

function generateTradesCsv(trades: SimulatedTrade[]): string {
  const lines: string[] = [];
  lines.push(
    formatCsvRow([
      "timestamp",
      "symbol",
      "side",
      "quantity",
      "price",
      "fees",
      "slippage",
      "notional",
      "pnl",
    ]),
  );
  for (const trade of trades) {
    const notional = trade.quantity * trade.price;
    lines.push(
      formatCsvRow([
        trade.timestamp,
        trade.symbol,
        trade.side,
        trade.quantity,
        trade.price,
        trade.fees ?? 0,
        trade.slippage ?? 0,
        notional,
        trade.realizedPnL ?? 0,
      ]),
    );
  }
  return lines.join("\n");
}

function generateDrawdownCsv(
  equityCurve: Array<{ timestamp: string; value: number }>,
): string {
  const lines: string[] = [];
  lines.push(formatCsvRow(["timestamp", "value", "peek", "drawdown_pct"]));

  let runningPeak = 0;
  for (const point of equityCurve) {
    runningPeak = Math.max(runningPeak, point.value);
    const drawdownPct =
      runningPeak > 0 ? ((runningPeak - point.value) / runningPeak) * 100 : 0;
    lines.push(
      formatCsvRow([
        point.timestamp,
        point.value,
        runningPeak,
        drawdownPct.toFixed(4),
      ]),
    );
  }
  return lines.join("\n");
}

function generateMonthlyReturnsCsv(
  equityCurve: Array<{ timestamp: string; value: number }>,
): string {
  const monthlyReturns = new Map<string, { start: number; end: number }>();

  for (const point of equityCurve) {
    const date = new Date(point.timestamp);
    const monthKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;

    if (!monthlyReturns.has(monthKey)) {
      monthlyReturns.set(monthKey, { start: point.value, end: point.value });
    } else {
      const entry = monthlyReturns.get(monthKey)!;
      entry.end = point.value;
    }
  }

  const lines: string[] = [];
  lines.push(formatCsvRow(["month", "return_pct"]));

  const sortedMonths = Array.from(monthlyReturns.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  for (const [month, { start, end }] of sortedMonths) {
    const returnPct = start > 0 ? ((end - start) / start) * 100 : 0;
    lines.push(formatCsvRow([month, returnPct.toFixed(4)]));
  }

  return lines.join("\n");
}

function generateWarningsJson(
  warnings?: Array<{
    code: string;
    message: string;
    severity: "info" | "warning" | "error";
  }>,
): string {
  return JSON.stringify(
    {
      warningCount: warnings?.length ?? 0,
      warnings: warnings ?? [],
      generatedAt: new Date().toISOString(),
    },
    null,
    2,
  );
}

function generateManifestJson(input: GenerateArtifactsInput): ManifestDocument {
  const startDate = input.equityCurve[0]?.timestamp ?? new Date().toISOString();
  const endDate =
    input.equityCurve[input.equityCurve.length - 1]?.timestamp ??
    new Date().toISOString();

  const startCapital = (input.metrics.startingCapital as number) ?? 100000;
  const endCapital = (input.metrics.endingCapital as number) ?? 100000;
  const returnPct = ((endCapital - startCapital) / startCapital) * 100;

  return {
    runId: input.runId,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion.version,
    datasetSnapshotId: input.snapshotId,
    executionMode: input.executionMode,
    generatedAt: new Date().toISOString(),
    engineVersion: (input.metrics.engineVersion as string) ?? "unknown",
    strategy: {
      id: input.strategyId,
      version: input.strategyVersion.version,
      codeHash: input.strategyVersion.scriptChecksum,
      notes: input.strategyVersion.notes,
    },
    dataset: {
      snapshotId: input.snapshotId,
      datasetName: "us_equities_daily", // TODO: get from snapshot metadata
      datasetVersion: "1.0",
    },
    execution: {
      startCapital,
      endCapital,
      returnPct,
      period: {
        start: startDate,
        end: endDate,
      },
      tradesCount: input.trades.length,
    },
    assumptions: input.assumptions,
    keyMetrics: {
      cagr: input.advancedMetrics?.cagr,
      sharpe: (input.metrics.sharpeRatio as number) ?? undefined,
      maxDrawdown: (input.metrics.maxDrawdown as number) ?? undefined,
      totalReturn: (input.metrics.totalReturn as number) ?? undefined,
      annualizedVolatility: input.advancedMetrics?.annualizedVolatility,
      sortinoRatio: input.advancedMetrics?.sortinoRatio,
      calmarRatio: input.advancedMetrics?.calmarRatio,
    },
    artifacts: [],
  };
}

function generateHumanReadableManifest(manifest: ManifestDocument): string {
  const lines: string[] = [];

  lines.push("# Strategy Research Run Manifest");
  lines.push("");
  lines.push(`**Generated:** ${manifest.generatedAt}`);
  lines.push(`**Run ID:** \`${manifest.runId}\``);
  lines.push("");

  lines.push("## Strategy");
  lines.push(`- **ID:** ${manifest.strategy.id}`);
  lines.push(`- **Version:** ${manifest.strategy.version}`);
  lines.push(`- **Code Hash:** \`${manifest.strategy.codeHash}\``);
  if (manifest.strategy.notes) {
    lines.push(`- **Notes:** ${manifest.strategy.notes}`);
  }
  lines.push("");

  lines.push("## Dataset");
  lines.push(`- **Snapshot ID:** ${manifest.dataset.snapshotId}`);
  lines.push(
    `- **Dataset:** ${manifest.dataset.datasetName} v${manifest.dataset.datasetVersion}`,
  );
  lines.push(
    `- **Period:** ${manifest.dataset.datasetVersion} to ${manifest.execution.period.end}`,
  );
  lines.push("");

  lines.push("## Execution");
  lines.push(`- **Mode:** ${manifest.executionMode}`);
  lines.push(
    `- **Starting Capital:** $${manifest.execution.startCapital.toLocaleString()}`,
  );
  lines.push(
    `- **Ending Capital:** $${manifest.execution.endCapital.toLocaleString()}`,
  );
  lines.push(`- **Total Return:** ${manifest.execution.returnPct.toFixed(2)}%`);
  lines.push(`- **Trades Count:** ${manifest.execution.tradesCount}`);
  lines.push("");

  lines.push("## Key Performance Metrics");
  if (manifest.keyMetrics.cagr !== undefined) {
    lines.push(`- **CAGR:** ${manifest.keyMetrics.cagr.toFixed(2)}%`);
  }
  if (manifest.keyMetrics.sharpe !== undefined) {
    lines.push(`- **Sharpe Ratio:** ${manifest.keyMetrics.sharpe.toFixed(4)}`);
  }
  if (manifest.keyMetrics.maxDrawdown !== undefined) {
    lines.push(
      `- **Max Drawdown:** ${manifest.keyMetrics.maxDrawdown.toFixed(2)}%`,
    );
  }
  if (manifest.keyMetrics.annualizedVolatility !== undefined) {
    lines.push(
      `- **Annualized Volatility:** ${manifest.keyMetrics.annualizedVolatility.toFixed(2)}%`,
    );
  }
  if (manifest.keyMetrics.sortinoRatio !== undefined) {
    lines.push(
      `- **Sortino Ratio:** ${manifest.keyMetrics.sortinoRatio.toFixed(4)}`,
    );
  }
  if (manifest.keyMetrics.calmarRatio !== undefined) {
    lines.push(
      `- **Calmar Ratio:** ${manifest.keyMetrics.calmarRatio.toFixed(4)}`,
    );
  }
  lines.push("");

  lines.push("## Assumptions");
  for (const [key, value] of Object.entries(manifest.assumptions)) {
    lines.push(`- **${key}:** ${JSON.stringify(value)}`);
  }
  lines.push("");

  lines.push("## Artifacts");
  if (manifest.artifacts.length > 0) {
    for (const artifact of manifest.artifacts) {
      lines.push(`- \`${artifact.kind}\` (${artifact.uri})`);
    }
  }
  lines.push("");

  lines.push("---");
  lines.push(`*Engine Version: ${manifest.engineVersion}*`);

  return lines.join("\n");
}

export async function generateArtifacts(
  input: GenerateArtifactsInput,
  repo: BacktestingRepo,
): Promise<void> {
  try {
    logger.info("artifact_generation_started", { runId: input.runId });

    // Generate manifest
    const manifestJson = generateManifestJson(input);
    const manifestJsonStr = JSON.stringify(manifestJson, null, 2);
    const manifestHumanStr = generateHumanReadableManifest(manifestJson);

    // Generate CSV exports
    const equityCtsvContent = generateEquityCurveCsv(input.equityCurve);
    const tradesCsvContent = generateTradesCsv(input.trades);
    const drawdownCsvContent = generateDrawdownCsv(input.equityCurve);
    const monthlyReturnsCsvContent = generateMonthlyReturnsCsv(
      input.equityCurve,
    );

    // Generate warnings
    const warningsJsonContent = generateWarningsJson(input.warnings);

    // Register artifacts
    const artifacts: Array<{
      kind: string;
      uri: string;
      contentType: string;
      content: string;
      payload?: Record<string, unknown>;
    }> = [
      {
        kind: "manifest_json",
        uri: `artifact://${input.runId}/manifest.json`,
        contentType: "application/json",
        content: manifestJsonStr,
        payload: { type: "manifest", format: "json", data: manifestJsonStr },
      },
      {
        kind: "manifest_text",
        uri: `artifact://${input.runId}/manifest.md`,
        contentType: "text/markdown",
        content: manifestHumanStr,
        payload: {
          type: "manifest",
          format: "markdown",
          data: manifestHumanStr,
        },
      },
      {
        kind: "equity_curve_csv",
        uri: `artifact://${input.runId}/equity_curve.csv`,
        contentType: "text/csv",
        content: equityCtsvContent,
        payload: {
          type: "data",
          dataType: "equity_curve",
          data: equityCtsvContent,
        },
      },
      {
        kind: "trades_csv",
        uri: `artifact://${input.runId}/trades.csv`,
        contentType: "text/csv",
        content: tradesCsvContent,
        payload: { type: "data", dataType: "trades", data: tradesCsvContent },
      },
      {
        kind: "drawdown_csv",
        uri: `artifact://${input.runId}/drawdown.csv`,
        contentType: "text/csv",
        content: drawdownCsvContent,
        payload: {
          type: "data",
          dataType: "drawdown",
          data: drawdownCsvContent,
        },
      },
      {
        kind: "monthly_returns_csv",
        uri: `artifact://${input.runId}/monthly_returns.csv`,
        contentType: "text/csv",
        content: monthlyReturnsCsvContent,
        payload: {
          type: "data",
          dataType: "monthly_returns",
          data: monthlyReturnsCsvContent,
        },
      },
      {
        kind: "warnings_json",
        uri: `artifact://${input.runId}/warnings.json`,
        contentType: "application/json",
        content: warningsJsonContent,
        payload: {
          type: "diagnostics",
          dataType: "warnings",
          data: warningsJsonContent,
        },
      },
    ];

    // Save each artifact to the database
    for (const artifact of artifacts) {
      const checksum = sha256(artifact.content);
      const sizeBytes = Buffer.byteLength(artifact.content, "utf8");

      await repo.saveArtifact({
        artifactId: `art-${randomUUID()}`,
        runId: input.runId,
        tenantId: input.tenantId,
        artifactKind: artifact.kind,
        artifactUri: artifact.uri,
        checksumSha256: checksum,
        sizeBytes,
        payload: {
          ...artifact.payload,
          contentType: artifact.contentType,
          dataChecksum: checksum,
        },
      });

      logger.info("artifact_saved", {
        runId: input.runId,
        kind: artifact.kind,
        uri: artifact.uri,
        bytes: sizeBytes,
      });
    }

    logger.info("artifact_generation_completed", {
      runId: input.runId,
      artifactCount: artifacts.length,
    });
  } catch (error) {
    logger.error("artifact_generation_failed", {
      runId: input.runId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

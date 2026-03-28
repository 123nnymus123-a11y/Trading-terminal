import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type DurableJobQueue from "../../queue.js";
import {
  BacktestingRepo,
  type BacktestExecutionMode,
  type BacktestRunRecord,
  type StrategyAcceptancePackRecord,
  type StrategyConnectorRecord,
  type StrategyConnectorStatus,
  type StrategyConnectorType,
  type StrategyForwardProfileRecord,
  type StrategyGovernanceProfileRecord,
} from "./backtestingRepo.js";
import {
  StrategyRepo,
  type StrategyStage,
  type StrategyDefinitionRecord,
  type StrategyVersionRecord,
} from "./strategyRepo.js";
import { createScriptExecutor } from "./scriptExecutor.js";
import {
  createHistoricalDataProvider,
  type IHistoricalDataProvider,
} from "./historicalDataProvider.js";
import { createLogger } from "../../logger.js";

const logger = createLogger("backtesting-service");

const MAX_QUEUED_RUNS_PER_USER = 25;
const MAX_QUEUED_RUNS_PER_TENANT = 200;
const MAX_RUNNING_RUNS_PER_TENANT = 4;

export type EnqueueBacktestRunInput = {
  tenantId?: string;
  userId: string;
  strategyId: string;
  strategyVersion: string;
  datasetSnapshotId: string;
  executionMode: BacktestExecutionMode;
  queuePriority: "low" | "normal" | "high";
  queueResourceClass: "standard" | "heavy";
  maxAttempts: number;
  assumptions: Record<string, unknown>;
  idempotencyKey?: string;
};

export type CreateStrategyInput = {
  tenantId: string | undefined;
  userId: string;
  name: string;
  description: string | undefined;
};

export type CreateStrategyVersionInput = {
  tenantId: string | undefined;
  userId: string;
  strategyId: string;
  scriptLanguage: "javascript" | "typescript";
  scriptEntrypoint: string;
  scriptSource: string;
  universe: string[];
  assumptions: Record<string, unknown>;
  notes: string | undefined;
};

export type UpdateStrategyInput = {
  tenantId: string | undefined;
  userId: string;
  strategyId: string;
  name: string | undefined;
  description: string | undefined;
  stage: StrategyStage | undefined;
  tags: string[] | undefined;
  metadata: Record<string, unknown> | undefined;
};

export type BacktestValidationIssue = {
  code: string;
  message: string;
  field?: string;
};

export type BacktestPreRunDiagnostics = {
  ok: boolean;
  errors: BacktestValidationIssue[];
  warnings: BacktestValidationIssue[];
  strategyChecksum?: string;
  datasetVersion?: string;
};

export type StrategyConnectorUpsertInput = {
  connectorId?: string;
  tenantId?: string;
  connectorType: StrategyConnectorType;
  status: StrategyConnectorStatus;
  displayName: string;
  config?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
};

export type StrategyGovernanceProfileUpsertInput = {
  profileId?: string;
  tenantId?: string;
  profileName: string;
  isDefault: boolean;
  transitionRules?: Record<string, unknown>;
  requiredReportSections?: string[];
  benchmarkRequired: boolean;
  oosMinimums?: Record<string, number>;
  drawdownHaltRules?: Record<string, unknown>;
  replayTolerance?: Record<string, number>;
};

export type StrategyAcceptancePackUpsertInput = {
  packId?: string;
  tenantId?: string;
  packName: string;
  isDefault: boolean;
  goldenStrategies?: string[];
  requiredReportSections?: string[];
  replayTolerance?: Record<string, number>;
  promotionChecklist?: Record<string, boolean>;
  definitionOfDone?: Record<string, unknown>;
};

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${entries.join(",")}}`;
}

function sha256Digest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function normalizeTransitionRule(
  rules: Record<string, unknown> | undefined,
  fromStage: string,
  toStage: string,
): Record<string, unknown> {
  if (!rules) {
    return {};
  }
  const direct = rules[`${fromStage}->${toStage}`];
  if (direct && typeof direct === "object") {
    return direct as Record<string, unknown>;
  }
  const nested = rules[fromStage];
  if (nested && typeof nested === "object") {
    const target = (nested as Record<string, unknown>)[toStage];
    if (target && typeof target === "object") {
      return target as Record<string, unknown>;
    }
  }
  return {};
}

function normalizeSectionChecklistKey(section: string): string {
  return `section:${section.trim().toLowerCase()}`;
}

function getDefinitionOfDoneChecklistKeys(
  definitionOfDone: Record<string, unknown>,
  executionMode: "paper" | "live",
): string[] {
  const modeScoped = definitionOfDone[executionMode];
  if (Array.isArray(modeScoped)) {
    return modeScoped.filter(
      (value): value is string => typeof value === "string",
    );
  }
  if (modeScoped && typeof modeScoped === "object") {
    return Object.entries(modeScoped as Record<string, unknown>)
      .filter(([, required]) => required === true)
      .map(([key]) => key);
  }

  const generic = definitionOfDone.requiredChecklist;
  if (Array.isArray(generic)) {
    return generic.filter(
      (value): value is string => typeof value === "string",
    );
  }
  if (generic && typeof generic === "object") {
    return Object.entries(generic as Record<string, unknown>)
      .filter(([, required]) => required === true)
      .map(([key]) => key);
  }
  return [];
}

function evaluateMetricLowerIsBetter(metricKey: string): boolean {
  return /drawdown|error|loss|slippage|cost|turnover/i.test(metricKey);
}

export class BacktestingService {
  private readonly repo: BacktestingRepo;
  private readonly strategyRepo: StrategyRepo;
  private readonly queue: DurableJobQueue | undefined;
  private readonly historicalDataProvider: IHistoricalDataProvider;

  constructor(pool: Pool, queue: DurableJobQueue | undefined) {
    this.repo = new BacktestingRepo(pool);
    this.strategyRepo = new StrategyRepo(pool);
    this.queue = queue;
    this.historicalDataProvider = createHistoricalDataProvider("database", {
      pool,
      dataDir: "./data",
    });
  }

  async enqueueRun(input: EnqueueBacktestRunInput): Promise<BacktestRunRecord> {
    const usage = await this.repo.getResourceUsage(
      input.userId,
      input.tenantId,
    );
    if (usage.queuedForUser >= MAX_QUEUED_RUNS_PER_USER) {
      throw new Error("backtest_resource_limit_user_queue");
    }
    if (usage.queuedForTenant >= MAX_QUEUED_RUNS_PER_TENANT) {
      throw new Error("backtest_resource_limit_tenant_queue");
    }
    if (usage.runningForTenant >= MAX_RUNNING_RUNS_PER_TENANT) {
      throw new Error("backtest_resource_limit_tenant_running");
    }

    const strategyVersionRecord = await this.strategyRepo.getVersion(
      input.strategyId,
      input.strategyVersion,
      input.userId,
      input.tenantId,
    );
    const snapshotRecord = await this.repo.getDatasetSnapshot(
      input.datasetSnapshotId,
      input.userId,
      input.tenantId,
    );
    const assumptionsHash = sha256Digest(stableStringify(input.assumptions));
    const requestedAtIso = new Date().toISOString();

    const runId = `btr-${randomUUID()}`;
    const createPayload = {
      runId,
      tenantId: input.tenantId ?? "default",
      userId: input.userId,
      strategyId: input.strategyId,
      strategyVersion: input.strategyVersion,
      snapshotId: input.datasetSnapshotId,
      executionMode: input.executionMode,
      queuePriority: input.queuePriority,
      queueResourceClass: input.queueResourceClass,
      maxAttempts: Math.max(1, input.maxAttempts),
      assumptions: input.assumptions,
      runMetadata: {
        runBundleVersion: "1.0",
        execution: {
          requestedMode: input.executionMode,
          modeClass:
            input.executionMode === "desktop-local"
              ? "quick-approximation"
              : "authoritative",
        },
        reproducibility: {
          strategyCodeHash: strategyVersionRecord?.scriptChecksum ?? null,
          assumptionsHash,
          datasetSnapshotHash: snapshotRecord?.checksumSha256 ?? null,
          engineVersion:
            input.executionMode === "backend"
              ? "advanced-backtest-engine@2.0.0"
              : "unassigned",
        },
        provenance: {
          createdByUserId: input.userId,
          createdAt: requestedAtIso,
        },
      },
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    };
    await this.repo.createRun(createPayload);

    const run = await this.repo.getRun(runId, input.userId, input.tenantId);
    if (!run) {
      throw new Error("backtest_run_not_found_after_create");
    }

    // Enqueue backtest job if queue is available and execution mode is backend
    if (this.queue && input.executionMode === "backend") {
      try {
        const queueOptions: {
          idempotencyKey?: string;
          maxAttempts: number;
          priority: "low" | "normal" | "high";
        } = {
          maxAttempts: Math.max(1, input.maxAttempts),
          priority: input.queuePriority,
        };
        if (input.idempotencyKey) {
          queueOptions.idempotencyKey = `backtest-${input.idempotencyKey}`;
        }

        const queuedJob = await this.queue.enqueue(
          "backtest.run",
          {
            runId,
            tenantId: createPayload.tenantId,
            userId: input.userId,
            strategyId: input.strategyId,
            strategyVersion: input.strategyVersion,
            snapshotId: input.datasetSnapshotId,
            executionMode: input.executionMode,
            queueResourceClass: input.queueResourceClass,
          },
          queueOptions,
        );

        await this.repo.attachQueueJob(
          runId,
          input.userId,
          queuedJob.id,
          input.tenantId,
        );
        await this.repo.updateRetryProgress(
          runId,
          input.userId,
          0,
          Math.max(1, input.maxAttempts),
          input.tenantId,
        );

        logger.info("backtest_job_enqueued", {
          runId,
          queueJobId: queuedJob.id,
          priority: input.queuePriority,
          resourceClass: input.queueResourceClass,
          maxAttempts: input.maxAttempts,
        });
      } catch (error) {
        logger.error("backtest_job_enqueue_failed", {
          runId,
          error: error instanceof Error ? error.message : "unknown",
        });
        // Note: don't rethrow - the run is already in DB, queue failure shouldn't fail the API response
      }
    }

    return run;
  }

  async validateRunInput(
    input: EnqueueBacktestRunInput,
  ): Promise<BacktestPreRunDiagnostics> {
    const errors: BacktestValidationIssue[] = [];
    const warnings: BacktestValidationIssue[] = [];

    const strategyVersion = await this.strategyRepo.getVersion(
      input.strategyId,
      input.strategyVersion,
      input.userId,
      input.tenantId,
    );

    if (!strategyVersion) {
      errors.push({
        code: "strategy_version_not_found",
        message: `Strategy version ${input.strategyId}@${input.strategyVersion} was not found for this user/tenant.`,
        field: "strategyVersion",
      });
    }

    const snapshot = await this.repo.getDatasetSnapshot(
      input.datasetSnapshotId,
      input.userId,
      input.tenantId,
    );

    if (!snapshot) {
      errors.push({
        code: "dataset_snapshot_not_found",
        message: `Dataset snapshot ${input.datasetSnapshotId} was not found for this user/tenant.`,
        field: "datasetSnapshotId",
      });
    }

    if (input.executionMode === "backend" && snapshot && errors.length === 0) {
      try {
        const loadedSnapshot = await this.historicalDataProvider.loadSnapshot(
          input.datasetSnapshotId,
        );
        if (!loadedSnapshot) {
          errors.push({
            code: "dataset_snapshot_load_failed",
            message:
              "Dataset snapshot metadata exists but historical bars could not be loaded.",
            field: "datasetSnapshotId",
          });
        } else {
          const targetUniverse = strategyVersion?.universe ?? [];
          const symbolsToScan =
            targetUniverse.length > 0
              ? targetUniverse
              : Array.from(loadedSnapshot.symbols);
          const barCount = symbolsToScan.reduce((sum, symbol) => {
            return (
              sum +
              this.historicalDataProvider.getBarsForSymbol(
                loadedSnapshot,
                symbol,
              ).length
            );
          }, 0);

          if (barCount === 0) {
            errors.push({
              code: "dataset_snapshot_no_bars",
              message:
                "Dataset snapshot has no loadable bars for backend execution. Update sourceManifest/manifest lineage to include bars data before enqueueing.",
              field: "datasetSnapshotId",
            });
          }
        }
      } catch (error) {
        errors.push({
          code: "dataset_snapshot_load_error",
          message: `Failed to load dataset snapshot bars: ${error instanceof Error ? error.message : "unknown_error"}`,
          field: "datasetSnapshotId",
        });
      }
    }

    const assumptions = input.assumptions ?? {};

    const [paperBrokerConnector, dataProviderConnector] = await Promise.all([
      this.repo.getConnector("paper-broker", input.tenantId),
      this.repo.getConnector("data-provider", input.tenantId),
    ]);

    if (input.executionMode === "paper") {
      if (
        !paperBrokerConnector ||
        paperBrokerConnector.status !== "configured"
      ) {
        errors.push({
          code: "paper_mode_not_configured",
          message:
            "Paper mode requires a configured paper-broker connector for this tenant.",
          field: "executionMode",
        });
      }
      if (
        !dataProviderConnector ||
        dataProviderConnector.status !== "configured"
      ) {
        errors.push({
          code: "paper_data_provider_not_configured",
          message:
            "Paper mode requires a configured data-provider connector for this tenant.",
          field: "executionMode",
        });
      }
    }
    if (input.executionMode === "live") {
      if (
        !paperBrokerConnector ||
        paperBrokerConnector.status !== "configured"
      ) {
        errors.push({
          code: "live_broker_not_configured",
          message:
            "Live mode requires a configured broker connector before activation.",
          field: "executionMode",
        });
      }
      if (
        !dataProviderConnector ||
        dataProviderConnector.status !== "configured"
      ) {
        errors.push({
          code: "live_data_provider_not_configured",
          message:
            "Live mode requires a configured data-provider connector before activation.",
          field: "executionMode",
        });
      }
      const governanceProfile = await this.repo.getDefaultGovernanceProfile(
        input.tenantId,
      );
      if (!governanceProfile) {
        errors.push({
          code: "live_mode_governance_missing",
          message:
            "Live mode requires a default governance profile to be configured.",
          field: "executionMode",
        });
      }
    }

    const initialCapital = assumptions.initialCapital;
    if (typeof initialCapital === "number" && initialCapital <= 0) {
      errors.push({
        code: "invalid_initial_capital",
        message: "initialCapital must be greater than 0.",
        field: "assumptions.initialCapital",
      });
    }

    const boundedBpsFields = [
      "transactionCostBps",
      "slippageBps",
      "borrowCostBps",
      "spreadBps",
      "marketImpactBpsPer10PctADV",
      "shortBorrowRateBps",
      "shortBorrowMaxBps",
    ] as const;
    for (const field of boundedBpsFields) {
      const value = assumptions[field];
      if (typeof value === "number" && (value < 0 || value > 5000)) {
        errors.push({
          code: "invalid_bps_value",
          message: `${field} must be between 0 and 5000 bps.`,
          field: `assumptions.${field}`,
        });
      }
    }

    const percentageFields = [
      "liquidityCapPct",
      "maxParticipationPct",
    ] as const;
    for (const field of percentageFields) {
      const value = assumptions[field];
      if (typeof value === "number" && (value < 0 || value > 100)) {
        errors.push({
          code: "invalid_percent_value",
          message: `${field} must be between 0 and 100.`,
          field: `assumptions.${field}`,
        });
      }
    }

    const allowedTradingWeekdays = assumptions.allowedTradingWeekdays;
    if (Array.isArray(allowedTradingWeekdays)) {
      const invalidDays = allowedTradingWeekdays.filter(
        (value) => typeof value !== "number" || value < 0 || value > 6,
      );
      if (invalidDays.length > 0) {
        errors.push({
          code: "invalid_allowed_trading_weekdays",
          message:
            "allowedTradingWeekdays must contain integers between 0 and 6.",
          field: "assumptions.allowedTradingWeekdays",
        });
      }
    }

    const fillPolicy = assumptions.fillPolicy;
    if (
      fillPolicy !== undefined &&
      fillPolicy !== "open" &&
      fillPolicy !== "close" &&
      fillPolicy !== "vwap" &&
      fillPolicy !== "custom"
    ) {
      errors.push({
        code: "invalid_fill_policy",
        message: "fillPolicy must be one of open, close, vwap, custom.",
        field: "assumptions.fillPolicy",
      });
    }

    const staleBarPolicy = assumptions.staleBarPolicy;
    if (
      staleBarPolicy !== undefined &&
      staleBarPolicy !== "warn" &&
      staleBarPolicy !== "skip" &&
      staleBarPolicy !== "block"
    ) {
      errors.push({
        code: "invalid_stale_bar_policy",
        message: "staleBarPolicy must be one of warn, skip, block.",
        field: "assumptions.staleBarPolicy",
      });
    }

    const missingBarPolicy = assumptions.missingBarPolicy;
    if (
      missingBarPolicy !== undefined &&
      missingBarPolicy !== "warn" &&
      missingBarPolicy !== "skip" &&
      missingBarPolicy !== "block"
    ) {
      errors.push({
        code: "invalid_missing_bar_policy",
        message: "missingBarPolicy must be one of warn, skip, block.",
        field: "assumptions.missingBarPolicy",
      });
    }

    const riskControls = assumptions.riskControls;
    if (riskControls && typeof riskControls === "object") {
      const rc = riskControls as Record<string, unknown>;
      const maxGross = rc.maxGrossExposurePct;
      const maxPosition = rc.maxPositionWeightPct;
      if (
        typeof maxGross === "number" &&
        typeof maxPosition === "number" &&
        maxPosition > maxGross
      ) {
        errors.push({
          code: "invalid_risk_controls",
          message: "maxPositionWeightPct cannot exceed maxGrossExposurePct.",
          field: "assumptions.riskControls",
        });
      }

      const maxNet = rc.maxNetExposurePct;
      if (
        typeof maxGross === "number" &&
        typeof maxNet === "number" &&
        maxNet > maxGross
      ) {
        errors.push({
          code: "invalid_net_exposure",
          message: "maxNetExposurePct cannot exceed maxGrossExposurePct.",
          field: "assumptions.riskControls",
        });
      }

      const minCashBufferPct = rc.minCashBufferPct;
      if (
        typeof minCashBufferPct === "number" &&
        (minCashBufferPct < 0 || minCashBufferPct > 1)
      ) {
        errors.push({
          code: "invalid_cash_buffer_pct",
          message: "minCashBufferPct must be between 0 and 1.",
          field: "assumptions.riskControls.minCashBufferPct",
        });
      }
    }

    const rebalanceFrequency = assumptions.rebalancingFrequency;
    const customDays = assumptions.customRebalanceDays;
    if (
      rebalanceFrequency === "custom" &&
      (!Array.isArray(customDays) || customDays.length === 0)
    ) {
      errors.push({
        code: "missing_custom_rebalance_days",
        message:
          "customRebalanceDays is required when rebalancingFrequency is custom.",
        field: "assumptions.customRebalanceDays",
      });
    }

    if (Array.isArray(customDays) && rebalanceFrequency !== "custom") {
      warnings.push({
        code: "unused_custom_rebalance_days",
        message:
          "customRebalanceDays was provided but rebalancingFrequency is not custom.",
        field: "assumptions.customRebalanceDays",
      });
    }

    if (Array.isArray(customDays) && rebalanceFrequency === "custom") {
      const invalidDays = customDays.filter(
        (value) => typeof value !== "number" || value < 1 || value > 31,
      );
      if (invalidDays.length > 0) {
        errors.push({
          code: "invalid_custom_rebalance_days",
          message:
            "customRebalanceDays must contain only integers between 1 and 31.",
          field: "assumptions.customRebalanceDays",
        });
      }
      const uniqueDays = new Set(customDays);
      if (uniqueDays.size !== customDays.length) {
        warnings.push({
          code: "duplicate_custom_rebalance_days",
          message:
            "customRebalanceDays contains duplicates; duplicates will be ignored by schedule logic.",
          field: "assumptions.customRebalanceDays",
        });
      }
    }

    if (snapshot) {
      const datasetIdentity =
        `${snapshot.datasetName} ${snapshot.datasetVersion}`.toLowerCase();
      const assumedTimeframe =
        typeof assumptions.timeframe === "string"
          ? assumptions.timeframe.trim().toLowerCase()
          : "";

      if (assumedTimeframe.length > 0) {
        const timeframeTokens = [
          assumedTimeframe,
          assumedTimeframe.replace(/\s+/g, ""),
        ];
        const hasMatch = timeframeTokens.some((token) =>
          datasetIdentity.includes(token),
        );
        if (!hasMatch) {
          warnings.push({
            code: "timeframe_dataset_mismatch",
            message: `Assumed timeframe '${assumedTimeframe}' does not appear to match dataset snapshot ${snapshot.datasetName}@${snapshot.datasetVersion}.`,
            field: "assumptions.timeframe",
          });
        }
      }

      if (
        rebalanceFrequency === "daily" &&
        /weekly|monthly/.test(datasetIdentity)
      ) {
        errors.push({
          code: "rebalancing_calendar_mismatch",
          message:
            "Daily rebalancing was requested, but dataset snapshot appears to be weekly/monthly frequency.",
          field: "assumptions.rebalancingFrequency",
        });
      }
      if (
        (rebalanceFrequency === "weekly" || rebalanceFrequency === "monthly") &&
        /intraday|minute|hourly|tick/.test(datasetIdentity)
      ) {
        warnings.push({
          code: "rebalancing_frequency_warning",
          message:
            "Selected rebalancing frequency may underutilize an intraday dataset; confirm this is intentional.",
          field: "assumptions.rebalancingFrequency",
        });
      }

      const executionTiming =
        typeof assumptions.executionTiming === "string"
          ? assumptions.executionTiming
          : undefined;
      if (
        executionTiming &&
        /daily|weekly|monthly/.test(datasetIdentity) &&
        (executionTiming === "next-close" || executionTiming === "next-open")
      ) {
        warnings.push({
          code: "signal_timing_dataset_warning",
          message:
            "Next-bar execution timing was requested on a low-frequency dataset. Confirm signal tradability timing is intentional.",
          field: "assumptions.executionTiming",
        });
      }

      if (
        /daily/.test(datasetIdentity) &&
        Array.isArray(assumptions.allowedTradingWeekdays) &&
        assumptions.allowedTradingWeekdays.length < 5
      ) {
        warnings.push({
          code: "restricted_session_calendar_warning",
          message:
            "allowedTradingWeekdays restricts a daily dataset to a subset of weekdays. Confirm venue/session constraints are intentional.",
          field: "assumptions.allowedTradingWeekdays",
        });
      }
    }

    if (typeof assumptions.benchmarkSymbol === "string") {
      const benchmark = assumptions.benchmarkSymbol.trim().toUpperCase();
      if (!/^[A-Z0-9._-]{1,20}$/.test(benchmark)) {
        errors.push({
          code: "invalid_benchmark_symbol",
          message: "benchmarkSymbol format is invalid.",
          field: "assumptions.benchmarkSymbol",
        });
      }
    }

    if (
      assumptions.benchmarkWeights &&
      typeof assumptions.benchmarkWeights === "object"
    ) {
      const weights = assumptions.benchmarkWeights as Record<string, unknown>;
      const totalWeight = Object.values(weights).reduce(
        (sum: number, value) => sum + (typeof value === "number" ? value : 0),
        0,
      );
      if (totalWeight > 1.5) {
        warnings.push({
          code: "benchmark_weights_total_warning",
          message:
            "benchmarkWeights sum exceeds 1.0 by a large margin; confirm benchmark-relative constraints are correctly normalized.",
          field: "assumptions.benchmarkWeights",
        });
      }
    }

    if (
      assumptions.factorExposureMap &&
      typeof assumptions.factorExposureMap === "object" &&
      (!riskControls || typeof riskControls !== "object")
    ) {
      warnings.push({
        code: "factor_map_without_constraints",
        message:
          "factorExposureMap was provided without factorConstraints; attribution will work, but neutrality constraints will not be enforced.",
        field: "assumptions.factorExposureMap",
      });
    }

    if (strategyVersion) {
      if (strategyVersion.universe.length === 0) {
        errors.push({
          code: "empty_universe",
          message: "Strategy universe is empty.",
          field: "strategyVersion.universe",
        });
      }

      const invalidSymbols = strategyVersion.universe.filter(
        (symbol) => !/^[A-Z0-9._-]{1,20}$/.test(symbol),
      );
      if (invalidSymbols.length > 0) {
        errors.push({
          code: "invalid_symbol_format",
          message: `Universe contains invalid symbol formats: ${invalidSymbols.join(", ")}`,
          field: "strategyVersion.universe",
        });
      }

      const scriptExecutor = createScriptExecutor();
      const validation = scriptExecutor.validate(strategyVersion.scriptSource);
      if (!validation.valid) {
        errors.push({
          code: "script_validation_failed",
          message: validation.errors.join("; "),
          field: "strategyVersion.scriptSource",
        });
      }

      const lookaheadWarningPatterns = [
        {
          regex: /nextBar\s*\(/i,
          message:
            "Script contains nextBar(...). Verify this does not introduce lookahead bias.",
        },
        {
          regex: /forward(?:\s+|_)return|future(?:\s+|_)return/i,
          message:
            "Script appears to reference forward/future returns; ensure labels are not used for execution logic.",
        },
      ];
      for (const pattern of lookaheadWarningPatterns) {
        if (pattern.regex.test(strategyVersion.scriptSource)) {
          warnings.push({
            code: "lookahead_risk_pattern",
            message: pattern.message,
            field: "strategyVersion.scriptSource",
          });
        }
      }

      const lookaheadErrorPatterns = [
        {
          regex: /bars\s*\[\s*ctx\.currentIndex\s*\+\s*\d+/i,
          message:
            "Script indexes bars with ctx.currentIndex + N, which is a direct lookahead access.",
        },
        {
          regex: /bars\s*\[\s*currentIndex\s*\+\s*\d+/i,
          message:
            "Script indexes bars with currentIndex + N, which is a direct lookahead access.",
        },
      ];
      for (const pattern of lookaheadErrorPatterns) {
        if (pattern.regex.test(strategyVersion.scriptSource)) {
          errors.push({
            code: "lookahead_direct_indexing",
            message: pattern.message,
            field: "strategyVersion.scriptSource",
          });
        }
      }

      const unsupportedFunctionMatrix = [
        {
          regex: /\bfetch\s*\(/i,
          category: "network",
          message:
            "fetch(...) is not supported in backtest scripts; use provided context data only.",
        },
        {
          regex: /\bXMLHttpRequest\b/i,
          category: "network",
          message:
            "XMLHttpRequest is not supported in backtest scripts; network IO is blocked.",
        },
        {
          regex: /\bWebSocket\b/i,
          category: "network",
          message:
            "WebSocket is not supported in backtest scripts; live sockets are disallowed.",
        },
        {
          regex: /\bsetInterval\s*\(/i,
          category: "timers",
          message:
            "setInterval(...) is not supported in backtest scripts; execution is bar-driven.",
        },
        {
          regex: /\bsetTimeout\s*\(/i,
          category: "timers",
          message:
            "setTimeout(...) is not supported in backtest scripts; execution is bar-driven.",
        },
      ] as const;
      for (const unsupported of unsupportedFunctionMatrix) {
        if (unsupported.regex.test(strategyVersion.scriptSource)) {
          errors.push({
            code: "unsupported_function_usage",
            message: `${unsupported.message} (category: ${unsupported.category})`,
            field: "strategyVersion.scriptSource",
          });
        }
      }
    }

    return {
      ok: errors.length === 0,
      errors,
      warnings,
      ...(strategyVersion
        ? { strategyChecksum: strategyVersion.scriptChecksum }
        : {}),
      ...(snapshot
        ? {
            datasetVersion: `${snapshot.datasetName}@${snapshot.datasetVersion}`,
          }
        : {}),
    };
  }

  async getRun(
    runId: string,
    userId: string,
    tenantId?: string,
  ): Promise<BacktestRunRecord | null> {
    return this.repo.getRun(runId, userId, tenantId);
  }

  async listRuns(
    userId: string,
    tenantId?: string,
    strategyId?: string,
    limit = 50,
  ): Promise<BacktestRunRecord[]> {
    return this.repo.listRuns(userId, tenantId, strategyId, limit);
  }

  async listDatasetSnapshots(userId: string, tenantId?: string, limit = 100) {
    return this.repo.listDatasetSnapshots(userId, tenantId, limit);
  }

  async upsertConnector(
    input: StrategyConnectorUpsertInput,
  ): Promise<{ connectorId: string }> {
    const connectorId = input.connectorId?.trim() || `spc-${randomUUID()}`;
    await this.repo.upsertConnector({
      connectorId,
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      connectorType: input.connectorType,
      status: input.status,
      displayName: input.displayName,
      ...(input.config ? { config: input.config } : {}),
      ...(input.capabilities ? { capabilities: input.capabilities } : {}),
    });
    return { connectorId };
  }

  async listConnectors(tenantId?: string): Promise<StrategyConnectorRecord[]> {
    return this.repo.listConnectors(tenantId);
  }

  async upsertGovernanceProfile(
    input: StrategyGovernanceProfileUpsertInput,
  ): Promise<{ profileId: string }> {
    const profileId = input.profileId?.trim() || `sgp-${randomUUID()}`;
    await this.repo.upsertGovernanceProfile({
      profileId,
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      profileName: input.profileName,
      isDefault: input.isDefault,
      ...(input.transitionRules
        ? { transitionRules: input.transitionRules }
        : {}),
      ...(input.requiredReportSections
        ? { requiredReportSections: input.requiredReportSections }
        : {}),
      benchmarkRequired: input.benchmarkRequired,
      ...(input.oosMinimums ? { oosMinimums: input.oosMinimums } : {}),
      ...(input.drawdownHaltRules
        ? { drawdownHaltRules: input.drawdownHaltRules }
        : {}),
      ...(input.replayTolerance
        ? { replayTolerance: input.replayTolerance }
        : {}),
    });
    return { profileId };
  }

  async listGovernanceProfiles(
    tenantId?: string,
  ): Promise<StrategyGovernanceProfileRecord[]> {
    return this.repo.listGovernanceProfiles(tenantId);
  }

  async upsertAcceptancePack(
    input: StrategyAcceptancePackUpsertInput,
  ): Promise<{ packId: string }> {
    const packId = input.packId?.trim() || `sap-${randomUUID()}`;
    await this.repo.upsertAcceptancePack({
      packId,
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      packName: input.packName,
      isDefault: input.isDefault,
      ...(input.goldenStrategies
        ? { goldenStrategies: input.goldenStrategies }
        : {}),
      ...(input.requiredReportSections
        ? { requiredReportSections: input.requiredReportSections }
        : {}),
      ...(input.replayTolerance
        ? { replayTolerance: input.replayTolerance }
        : {}),
      ...(input.promotionChecklist
        ? { promotionChecklist: input.promotionChecklist }
        : {}),
      ...(input.definitionOfDone
        ? { definitionOfDone: input.definitionOfDone }
        : {}),
    });
    return { packId };
  }

  async listAcceptancePacks(
    tenantId?: string,
  ): Promise<StrategyAcceptancePackRecord[]> {
    return this.repo.listAcceptancePacks(tenantId);
  }

  async getGovernanceReadiness(input: {
    tenantId?: string;
    executionMode: "paper" | "live";
  }): Promise<{
    executionMode: "paper" | "live";
    ready: boolean;
    checks: Array<{ code: string; passed: boolean; message: string }>;
    connectorStatuses: {
      dataProvider?: StrategyConnectorStatus;
      paperBroker?: StrategyConnectorStatus;
    };
    defaults: {
      governanceProfileId: string | null;
      acceptancePackId: string | null;
    };
  }> {
    const [
      paperBrokerConnector,
      dataProviderConnector,
      defaultProfile,
      defaultPack,
    ] = await Promise.all([
      this.repo.getConnector("paper-broker", input.tenantId),
      this.repo.getConnector("data-provider", input.tenantId),
      this.repo.getDefaultGovernanceProfile(input.tenantId),
      this.repo.getDefaultAcceptancePack(input.tenantId),
    ]);

    const checks: Array<{ code: string; passed: boolean; message: string }> = [
      {
        code: "paper_broker_configured",
        passed: paperBrokerConnector?.status === "configured",
        message:
          "Paper broker connector must be configured for execution bridge modes.",
      },
      {
        code: "data_provider_configured",
        passed: dataProviderConnector?.status === "configured",
        message:
          "Data provider connector must be configured for execution bridge modes.",
      },
    ];

    if (input.executionMode === "live") {
      checks.push(
        {
          code: "default_governance_profile_present",
          passed: defaultProfile !== null,
          message:
            "Live mode requires a default governance profile for transition gates.",
        },
        {
          code: "default_acceptance_pack_present",
          passed: defaultPack !== null,
          message:
            "Live mode requires a default acceptance pack for checklist policy.",
        },
      );
    }

    return {
      executionMode: input.executionMode,
      ready: checks.every((item) => item.passed),
      checks,
      connectorStatuses: {
        ...(dataProviderConnector
          ? { dataProvider: dataProviderConnector.status }
          : {}),
        ...(paperBrokerConnector
          ? { paperBroker: paperBrokerConnector.status }
          : {}),
      },
      defaults: {
        governanceProfileId: defaultProfile?.profileId ?? null,
        acceptancePackId: defaultPack?.packId ?? null,
      },
    };
  }

  async promoteStrategy(input: {
    tenantId?: string;
    userId: string;
    strategyId: string;
    fromStage: "candidate" | "validation" | "production" | "retired";
    toStage: "candidate" | "validation" | "production" | "retired";
    sourceRunId?: string;
    baselineRunId?: string;
    governanceProfileId?: string;
    acceptancePackId?: string;
    autoGatePassed: boolean;
    manualApprovedBy?: string;
    checklist?: Record<string, boolean>;
    rationale?: string;
  }): Promise<{ eventId: string }> {
    const governanceProfile = input.governanceProfileId
      ? await this.repo.getGovernanceProfileById(
          input.governanceProfileId,
          input.tenantId,
        )
      : await this.repo.getDefaultGovernanceProfile(input.tenantId);
    if (!governanceProfile) {
      throw new Error("governance_profile_default_missing");
    }

    const acceptancePack = input.acceptancePackId
      ? await this.repo.getAcceptancePackById(
          input.acceptancePackId,
          input.tenantId,
        )
      : await this.repo.getDefaultAcceptancePack(input.tenantId);
    if (!acceptancePack) {
      throw new Error("acceptance_pack_default_missing");
    }

    const transitionRule = normalizeTransitionRule(
      governanceProfile.transitionRules,
      input.fromStage,
      input.toStage,
    );

    let sourceRunMetrics: Record<string, unknown> | null = null;
    if (input.sourceRunId) {
      const sourceRun = await this.repo.getRun(
        input.sourceRunId,
        input.userId,
        input.tenantId,
      );
      if (!sourceRun) {
        throw new Error("governance_source_run_not_found");
      }
      if (sourceRun.strategyId !== input.strategyId) {
        throw new Error("governance_source_run_strategy_mismatch");
      }
      if (sourceRun.status !== "completed") {
        throw new Error("governance_source_run_not_completed");
      }
      sourceRunMetrics = sourceRun.metrics ?? {};
    }

    const checklist = input.checklist ?? {};
    const requiresAutoGate =
      transitionRule.requireAutoGate === undefined
        ? true
        : transitionRule.requireAutoGate === true;
    if (requiresAutoGate && input.autoGatePassed !== true) {
      throw new Error("governance_auto_gate_required");
    }

    if (
      transitionRule.requireManualApproval === true &&
      !input.manualApprovedBy?.trim()
    ) {
      throw new Error("governance_manual_approval_required");
    }

    if (transitionRule.disallow === true || transitionRule.allowed === false) {
      throw new Error("governance_transition_disallowed");
    }

    if (
      governanceProfile.benchmarkRequired &&
      checklist.benchmarkPass !== true
    ) {
      throw new Error("governance_benchmark_required");
    }

    const requiredChecklist = Object.entries(acceptancePack.promotionChecklist)
      .filter(([, required]) => required === true)
      .map(([key]) => key);
    const missingChecklist = requiredChecklist.filter(
      (key) => checklist[key] !== true,
    );
    if (missingChecklist.length > 0) {
      throw new Error(
        `governance_checklist_incomplete:${missingChecklist.join(",")}`,
      );
    }

    const requiredReportSections = Array.from(
      new Set([
        ...governanceProfile.requiredReportSections,
        ...acceptancePack.requiredReportSections,
      ]),
    );
    const missingReportSections = requiredReportSections.filter(
      (section) => checklist[normalizeSectionChecklistKey(section)] !== true,
    );
    if (missingReportSections.length > 0) {
      throw new Error(
        `governance_required_reports_incomplete:${missingReportSections.join(",")}`,
      );
    }

    const oosViolations: string[] = [];
    if (Object.keys(governanceProfile.oosMinimums).length > 0) {
      if (!sourceRunMetrics) {
        throw new Error("governance_source_run_required_for_oos");
      }
      for (const [metricKey, threshold] of Object.entries(
        governanceProfile.oosMinimums,
      )) {
        const rawValue = sourceRunMetrics[metricKey];
        if (typeof rawValue !== "number") {
          oosViolations.push(`${metricKey}:missing`);
          continue;
        }
        const lowerIsBetter = evaluateMetricLowerIsBetter(metricKey);
        const passed = lowerIsBetter
          ? rawValue <= threshold
          : rawValue >= threshold;
        if (!passed) {
          oosViolations.push(`${metricKey}:${rawValue}`);
        }
      }
    }
    if (oosViolations.length > 0) {
      throw new Error(
        `governance_oos_minimums_failed:${oosViolations.join(",")}`,
      );
    }

    const replayTolerance = {
      ...governanceProfile.replayTolerance,
      ...acceptancePack.replayTolerance,
    };
    const replayViolations: string[] = [];
    if (Object.keys(replayTolerance).length > 0 && input.baselineRunId) {
      if (!sourceRunMetrics) {
        throw new Error("governance_source_run_required_for_replay_tolerance");
      }
      const baselineRun = await this.repo.getRun(
        input.baselineRunId,
        input.userId,
        input.tenantId,
      );
      if (!baselineRun) {
        throw new Error("governance_baseline_run_not_found");
      }
      if (baselineRun.strategyId !== input.strategyId) {
        throw new Error("governance_baseline_run_strategy_mismatch");
      }
      const baselineMetrics = baselineRun.metrics ?? {};
      for (const [metricKey, tolerance] of Object.entries(replayTolerance)) {
        const candidateValue = sourceRunMetrics[metricKey];
        const baselineValue = baselineMetrics[metricKey];
        if (
          typeof candidateValue !== "number" ||
          typeof baselineValue !== "number"
        ) {
          replayViolations.push(`${metricKey}:missing`);
          continue;
        }
        const delta = Math.abs(candidateValue - baselineValue);
        if (delta > tolerance) {
          replayViolations.push(`${metricKey}:${delta}`);
        }
      }
    }
    if (replayViolations.length > 0) {
      throw new Error(
        `governance_replay_tolerance_failed:${replayViolations.join(",")}`,
      );
    }

    const eventId = `spv-${randomUUID()}`;
    const promotionPayload = {
      eventId,
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      strategyId: input.strategyId,
      fromStage: input.fromStage,
      toStage: input.toStage,
      autoGatePassed: input.autoGatePassed,
      governanceProfileId: governanceProfile.profileId,
      acceptancePackId: acceptancePack.packId,
      governanceValidation: {
        transitionRule,
        requiredChecklist,
        requiredReportSections,
        oosMinimums: governanceProfile.oosMinimums,
        replayTolerance,
        sourceRunId: input.sourceRunId ?? null,
        baselineRunId: input.baselineRunId ?? null,
      },
      ...(input.manualApprovedBy
        ? { manualApprovedBy: input.manualApprovedBy }
        : {}),
      ...(input.checklist ? { checklist: input.checklist } : {}),
      rationale: [
        input.rationale ?? "",
        `governanceProfile=${governanceProfile.profileId}`,
        `acceptancePack=${acceptancePack.packId}`,
      ]
        .filter((part) => part.length > 0)
        .join(" | "),
    };
    await this.repo.createPromotionEvent(promotionPayload);
    return { eventId };
  }

  async createForwardProfile(input: {
    tenantId?: string;
    userId: string;
    strategyId: string;
    sourceRunId: string;
    baselineRunId?: string;
    executionMode: "paper" | "live";
    governanceProfileId?: string;
    acceptancePackId?: string;
    autoGatePassed: boolean;
    manualApprovedBy?: string;
    checklist?: Record<string, boolean>;
    benchmark: string;
    rebalanceFrozenAt: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ profileId: string }> {
    const sourceRun = await this.repo.getForwardProfileSourceRun(
      input.sourceRunId,
      input.userId,
      input.tenantId,
    );
    if (!sourceRun) {
      throw new Error("source_run_not_found");
    }
    if (sourceRun.strategyId !== input.strategyId) {
      throw new Error("source_run_strategy_mismatch");
    }
    if (sourceRun.status !== "completed") {
      throw new Error("source_run_not_completed");
    }

    const governanceProfile = input.governanceProfileId
      ? await this.repo.getGovernanceProfileById(
          input.governanceProfileId,
          input.tenantId,
        )
      : await this.repo.getDefaultGovernanceProfile(input.tenantId);
    if (!governanceProfile) {
      throw new Error("governance_profile_default_missing");
    }

    const acceptancePack = input.acceptancePackId
      ? await this.repo.getAcceptancePackById(
          input.acceptancePackId,
          input.tenantId,
        )
      : await this.repo.getDefaultAcceptancePack(input.tenantId);
    if (!acceptancePack) {
      throw new Error("acceptance_pack_default_missing");
    }

    const strategy = await this.strategyRepo.getStrategy(
      input.strategyId,
      input.userId,
      input.tenantId,
    );
    if (!strategy) {
      throw new Error("strategy_not_found");
    }
    if (input.executionMode === "live" && strategy.stage !== "production") {
      throw new Error("strategy_stage_not_ready_for_live_activation");
    }
    if (
      input.executionMode === "paper" &&
      strategy.stage !== "validation" &&
      strategy.stage !== "production"
    ) {
      throw new Error("strategy_stage_not_ready_for_handoff");
    }

    const checklist = input.checklist ?? {};
    const transitionRule = normalizeTransitionRule(
      governanceProfile.transitionRules,
      input.executionMode === "paper" ? "validation" : "paper",
      input.executionMode,
    );
    const requiresAutoGate =
      transitionRule.requireAutoGate === undefined
        ? true
        : transitionRule.requireAutoGate === true;
    if (requiresAutoGate && input.autoGatePassed !== true) {
      throw new Error("governance_auto_gate_required");
    }
    if (
      transitionRule.requireManualApproval === true &&
      !input.manualApprovedBy?.trim()
    ) {
      throw new Error("governance_manual_approval_required");
    }
    if (transitionRule.disallow === true || transitionRule.allowed === false) {
      throw new Error("governance_transition_disallowed");
    }

    if (
      governanceProfile.benchmarkRequired &&
      checklist.benchmarkPass !== true
    ) {
      throw new Error("governance_benchmark_required");
    }

    const requiredChecklist = Object.entries(acceptancePack.promotionChecklist)
      .filter(([, required]) => required === true)
      .map(([key]) => key);
    const missingChecklist = requiredChecklist.filter(
      (key) => checklist[key] !== true,
    );
    if (missingChecklist.length > 0) {
      throw new Error(
        `governance_checklist_incomplete:${missingChecklist.join(",")}`,
      );
    }

    const definitionOfDoneKeys = getDefinitionOfDoneChecklistKeys(
      acceptancePack.definitionOfDone,
      input.executionMode,
    );
    const missingDefinitionOfDone = definitionOfDoneKeys.filter(
      (key) => checklist[key] !== true,
    );
    if (missingDefinitionOfDone.length > 0) {
      throw new Error(
        `governance_definition_of_done_incomplete:${missingDefinitionOfDone.join(",")}`,
      );
    }

    const requiredReportSections = Array.from(
      new Set([
        ...governanceProfile.requiredReportSections,
        ...acceptancePack.requiredReportSections,
      ]),
    );
    const missingReportSections = requiredReportSections.filter(
      (section) => checklist[normalizeSectionChecklistKey(section)] !== true,
    );
    if (missingReportSections.length > 0) {
      throw new Error(
        `governance_required_reports_incomplete:${missingReportSections.join(",")}`,
      );
    }

    const sourceRunMetrics = sourceRun.metrics ?? {};
    const oosViolations: string[] = [];
    for (const [metricKey, threshold] of Object.entries(
      governanceProfile.oosMinimums,
    )) {
      const rawValue = sourceRunMetrics[metricKey];
      if (typeof rawValue !== "number") {
        oosViolations.push(`${metricKey}:missing`);
        continue;
      }
      const lowerIsBetter = evaluateMetricLowerIsBetter(metricKey);
      const passed = lowerIsBetter
        ? rawValue <= threshold
        : rawValue >= threshold;
      if (!passed) {
        oosViolations.push(`${metricKey}:${rawValue}`);
      }
    }
    if (oosViolations.length > 0) {
      throw new Error(
        `governance_oos_minimums_failed:${oosViolations.join(",")}`,
      );
    }

    const replayTolerance = {
      ...governanceProfile.replayTolerance,
      ...acceptancePack.replayTolerance,
    };
    const replayViolations: string[] = [];
    if (Object.keys(replayTolerance).length > 0) {
      if (!input.baselineRunId) {
        throw new Error(
          "governance_baseline_run_required_for_replay_tolerance",
        );
      }
      const baselineRun = await this.repo.getRun(
        input.baselineRunId,
        input.userId,
        input.tenantId,
      );
      if (!baselineRun) {
        throw new Error("governance_baseline_run_not_found");
      }
      if (baselineRun.strategyId !== input.strategyId) {
        throw new Error("governance_baseline_run_strategy_mismatch");
      }
      if (baselineRun.status !== "completed") {
        throw new Error("governance_baseline_run_not_completed");
      }
      const baselineMetrics = baselineRun.metrics ?? {};
      for (const [metricKey, tolerance] of Object.entries(replayTolerance)) {
        const candidateValue = sourceRunMetrics[metricKey];
        const baselineValue = baselineMetrics[metricKey];
        if (
          typeof candidateValue !== "number" ||
          typeof baselineValue !== "number"
        ) {
          replayViolations.push(`${metricKey}:missing`);
          continue;
        }
        const delta = Math.abs(candidateValue - baselineValue);
        if (delta > tolerance) {
          replayViolations.push(`${metricKey}:${delta}`);
        }
      }
    }
    if (replayViolations.length > 0) {
      throw new Error(
        `governance_replay_tolerance_failed:${replayViolations.join(",")}`,
      );
    }

    const profileId = `sfp-${randomUUID()}`;
    const forwardPayload = {
      profileId,
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      userId: input.userId,
      strategyId: input.strategyId,
      sourceRunId: input.sourceRunId,
      executionMode: input.executionMode,
      governanceProfileId: governanceProfile.profileId,
      acceptancePackId: acceptancePack.packId,
      activationChecklist: checklist,
      governanceValidation: {
        transitionRule,
        requiredChecklist,
        definitionOfDoneChecklist: definitionOfDoneKeys,
        requiredReportSections,
        oosMinimums: governanceProfile.oosMinimums,
        replayTolerance,
        sourceRunId: input.sourceRunId,
        baselineRunId: input.baselineRunId ?? null,
      },
      benchmark: input.benchmark,
      rebalanceFrozenAt: input.rebalanceFrozenAt,
      metadata: {
        handoff: {
          sourceRunId: sourceRun.runId,
          sourceRunVersion: sourceRun.strategyVersion,
          sourceRunStatus: sourceRun.status,
          executionMode: input.executionMode,
          strategyStageAtHandoff: strategy.stage,
          governanceProfileId: governanceProfile.profileId,
          acceptancePackId: acceptancePack.packId,
          createdAt: new Date().toISOString(),
        },
        ...(input.metadata ?? {}),
      },
    };
    await this.repo.createForwardProfile(forwardPayload);
    return { profileId };
  }

  async listForwardProfiles(input: {
    tenantId?: string;
    userId: string;
    strategyId?: string;
    limit?: number;
  }): Promise<StrategyForwardProfileRecord[]> {
    return this.repo.listForwardProfiles(
      input.userId,
      input.tenantId,
      input.strategyId,
      input.limit ?? 100,
    );
  }

  async setForwardProfileStatus(input: {
    tenantId?: string;
    userId: string;
    profileId: string;
    status: "active" | "paused" | "stopped";
    reason?: string;
  }): Promise<void> {
    const profile = await this.repo.getForwardProfile(
      input.profileId,
      input.userId,
      input.tenantId,
    );
    if (!profile) {
      throw new Error("forward_profile_not_found");
    }
    if (profile.status === "stopped" && input.status !== "stopped") {
      throw new Error("forward_profile_stopped_terminal_state");
    }
    if (profile.status === input.status) {
      return;
    }
    await this.repo.setForwardProfileStatus({
      profileId: input.profileId,
      userId: input.userId,
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      status: input.status,
      metadataPatch: {
        lifecycle: {
          lastTransitionAt: new Date().toISOString(),
          fromStatus: profile.status,
          toStatus: input.status,
          reason: input.reason ?? null,
        },
      },
    });
  }

  async getForwardProfileDrift(input: {
    tenantId?: string;
    userId: string;
    profileId: string;
    candidateRunId?: string;
  }): Promise<{
    profileId: string;
    sourceRunId: string;
    candidateRunId: string;
    withinTolerance: boolean;
    tolerance: Record<string, number>;
    metrics: Array<{
      key: string;
      source: number;
      candidate: number;
      absoluteDelta: number;
      tolerance: number | null;
      withinTolerance: boolean;
    }>;
    violations: string[];
  }> {
    const profile = await this.repo.getForwardProfile(
      input.profileId,
      input.userId,
      input.tenantId,
    );
    if (!profile) {
      throw new Error("forward_profile_not_found");
    }

    const sourceRun = await this.repo.getRun(
      profile.sourceRunId,
      input.userId,
      input.tenantId,
    );
    if (!sourceRun) {
      throw new Error("forward_profile_source_run_not_found");
    }
    if (sourceRun.status !== "completed") {
      throw new Error("forward_profile_source_run_not_completed");
    }

    const candidateRun = input.candidateRunId
      ? await this.repo.getRun(
          input.candidateRunId,
          input.userId,
          input.tenantId,
        )
      : ((
          await this.repo.listRuns(
            input.userId,
            input.tenantId,
            profile.strategyId,
            50,
          )
        ).find(
          (run) =>
            run.status === "completed" && run.runId !== profile.sourceRunId,
        ) ?? null);

    if (!candidateRun) {
      throw new Error("forward_profile_drift_candidate_run_missing");
    }
    if (candidateRun.status !== "completed") {
      throw new Error("forward_profile_drift_candidate_run_not_completed");
    }
    if (candidateRun.strategyId !== profile.strategyId) {
      throw new Error("forward_profile_drift_candidate_strategy_mismatch");
    }

    const governanceProfile = profile.governanceProfileId
      ? await this.repo.getGovernanceProfileById(
          profile.governanceProfileId,
          input.tenantId,
        )
      : null;
    const acceptancePack = profile.acceptancePackId
      ? await this.repo.getAcceptancePackById(
          profile.acceptancePackId,
          input.tenantId,
        )
      : null;

    const tolerance = {
      ...(governanceProfile?.replayTolerance ?? {}),
      ...(acceptancePack?.replayTolerance ?? {}),
    };

    const keys = Object.keys(tolerance).length
      ? Object.keys(tolerance)
      : ["totalReturn", "sharpeRatio", "maxDrawdown", "cagr"];

    const sourceMetrics = sourceRun.metrics ?? {};
    const candidateMetrics = candidateRun.metrics ?? {};
    const metrics: Array<{
      key: string;
      source: number;
      candidate: number;
      absoluteDelta: number;
      tolerance: number | null;
      withinTolerance: boolean;
    }> = [];
    const violations: string[] = [];

    for (const key of keys) {
      const source = sourceMetrics[key];
      const candidate = candidateMetrics[key];
      if (typeof source !== "number" || typeof candidate !== "number") {
        continue;
      }
      const absoluteDelta = Math.abs(source - candidate);
      const metricTolerance =
        typeof tolerance[key] === "number" ? tolerance[key] : null;
      const withinTolerance =
        metricTolerance === null ? true : absoluteDelta <= metricTolerance;
      metrics.push({
        key,
        source,
        candidate,
        absoluteDelta,
        tolerance: metricTolerance,
        withinTolerance,
      });
      if (!withinTolerance) {
        violations.push(`${key}:${absoluteDelta}`);
      }
    }

    return {
      profileId: profile.profileId,
      sourceRunId: sourceRun.runId,
      candidateRunId: candidateRun.runId,
      withinTolerance: violations.length === 0,
      tolerance,
      metrics,
      violations,
    };
  }

  async getForwardProfileAlerts(input: {
    tenantId?: string;
    userId: string;
    profileId: string;
    candidateRunId?: string;
  }): Promise<{
    profileId: string;
    generatedAt: string;
    alerts: Array<{
      severity: "info" | "warning" | "critical";
      code: string;
      message: string;
      context: Record<string, unknown>;
    }>;
  }> {
    const profile = await this.repo.getForwardProfile(
      input.profileId,
      input.userId,
      input.tenantId,
    );
    if (!profile) {
      throw new Error("forward_profile_not_found");
    }

    const alerts: Array<{
      severity: "info" | "warning" | "critical";
      code: string;
      message: string;
      context: Record<string, unknown>;
    }> = [];

    if (profile.status === "paused") {
      alerts.push({
        severity: "warning",
        code: "forward_profile_paused",
        message: "Forward profile is paused and not actively rebalancing.",
        context: { status: profile.status },
      });
    }
    if (profile.status === "stopped") {
      alerts.push({
        severity: "critical",
        code: "forward_profile_stopped",
        message: "Forward profile is stopped and requires manual intervention.",
        context: { status: profile.status },
      });
    }

    try {
      const drift = await this.getForwardProfileDrift({
        ...(input.tenantId ? { tenantId: input.tenantId } : {}),
        userId: input.userId,
        profileId: input.profileId,
        ...(input.candidateRunId
          ? { candidateRunId: input.candidateRunId }
          : {}),
      });
      if (!drift.withinTolerance) {
        alerts.push({
          severity: "critical",
          code: "forward_profile_drift_violation",
          message: "Forward profile drift exceeds configured tolerances.",
          context: {
            candidateRunId: drift.candidateRunId,
            violations: drift.violations,
          },
        });
      } else {
        alerts.push({
          severity: "info",
          code: "forward_profile_drift_within_tolerance",
          message: "Forward profile drift is within configured tolerances.",
          context: { candidateRunId: drift.candidateRunId },
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_error";
      alerts.push({
        severity: "warning",
        code: "forward_profile_drift_unavailable",
        message: "Forward drift diagnostics are currently unavailable.",
        context: { reason: message },
      });
    }

    return {
      profileId: profile.profileId,
      generatedAt: new Date().toISOString(),
      alerts,
    };
  }

  // Strategy CRUD operations
  async createStrategy(
    input: CreateStrategyInput,
  ): Promise<StrategyDefinitionRecord> {
    const strategyId = `strat-${randomUUID()}`;
    return this.strategyRepo.createStrategy({
      strategyId,
      tenantId: input.tenantId ?? "default",
      userId: input.userId,
      name: input.name,
      description: input.description,
    });
  }

  async getStrategy(
    strategyId: string,
    userId: string,
    tenantId?: string,
  ): Promise<StrategyDefinitionRecord | null> {
    return this.strategyRepo.getStrategy(strategyId, userId, tenantId);
  }

  async listStrategies(
    userId: string,
    tenantId?: string,
    limit = 100,
  ): Promise<StrategyDefinitionRecord[]> {
    return this.strategyRepo.listStrategies(userId, tenantId, limit);
  }

  async updateStrategy(
    input: UpdateStrategyInput,
  ): Promise<StrategyDefinitionRecord | null> {
    const updates: Partial<{
      name: string;
      description: string;
      stage: StrategyStage;
      tags: string[];
      metadata: Record<string, unknown>;
    }> = {};

    if (input.name !== undefined) updates.name = input.name;
    if (input.description !== undefined)
      updates.description = input.description;
    if (input.stage !== undefined) updates.stage = input.stage;
    if (input.tags !== undefined) updates.tags = input.tags;
    if (input.metadata !== undefined) updates.metadata = input.metadata;

    return this.strategyRepo.updateStrategy(
      input.strategyId,
      input.userId,
      updates,
      input.tenantId,
    );
  }

  // Strategy version operations
  async createStrategyVersion(
    input: CreateStrategyVersionInput,
  ): Promise<StrategyVersionRecord> {
    const version = `v${Date.now()}-${randomUUID().slice(0, 8)}`;
    return this.strategyRepo.createVersion({
      strategyId: input.strategyId,
      version,
      tenantId: input.tenantId ?? "default",
      userId: input.userId,
      scriptLanguage: input.scriptLanguage,
      scriptEntrypoint: input.scriptEntrypoint,
      scriptSource: input.scriptSource,
      universe: input.universe,
      assumptions: input.assumptions,
      notes: input.notes,
    });
  }

  async getLatestStrategyVersion(
    strategyId: string,
    userId: string,
    tenantId?: string,
  ): Promise<StrategyVersionRecord | null> {
    return this.strategyRepo.getLatestVersion(strategyId, userId, tenantId);
  }

  async getStrategyVersion(
    strategyId: string,
    version: string,
    userId: string,
    tenantId?: string,
  ): Promise<StrategyVersionRecord | null> {
    return this.strategyRepo.getVersion(strategyId, version, userId, tenantId);
  }

  async listStrategyVersions(
    strategyId: string,
    userId: string,
    tenantId?: string,
    limit = 100,
  ): Promise<StrategyVersionRecord[]> {
    return this.strategyRepo.listVersions(strategyId, userId, tenantId, limit);
  }
}

export function createBacktestingService(
  pool: Pool,
  queue?: DurableJobQueue,
): BacktestingService {
  return new BacktestingService(pool, queue);
}

import type { Pool } from "pg";

export type BacktestRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type BacktestExecutionMode =
  | "desktop-local"
  | "backend"
  | "paper"
  | "live";

export type BacktestRunRecord = {
  runId: string;
  strategyId: string;
  strategyVersion: string;
  snapshotId: string;
  executionMode: BacktestExecutionMode;
  queueJobId?: string;
  queuePriority: "low" | "normal" | "high";
  queueResourceClass: "standard" | "heavy";
  retryCount: number;
  maxAttempts: number;
  lastRetryAt?: string;
  lastError?: string;
  status: BacktestRunStatus;
  requestedAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  metrics: Record<string, unknown>;
  runMetadata: Record<string, unknown>;
};

export type CreateBacktestRunInput = {
  runId: string;
  tenantId: string;
  userId: string;
  strategyId: string;
  strategyVersion: string;
  snapshotId: string;
  executionMode: BacktestExecutionMode;
  queuePriority: "low" | "normal" | "high";
  queueResourceClass: "standard" | "heavy";
  maxAttempts: number;
  assumptions: Record<string, unknown>;
  idempotencyKey?: string;
  runMetadata?: Record<string, unknown>;
};

export type DatasetSnapshotRecord = {
  snapshotId: string;
  datasetName: string;
  datasetVersion: string;
  snapshotAt: string;
  rowCount?: number | null;
  sourceManifest?: Record<string, unknown>;
  checksumSha256: string;
};

export type ForwardProfileSourceRun = {
  runId: string;
  strategyId: string;
  strategyVersion: string;
  status: BacktestRunStatus;
  metrics: Record<string, unknown>;
};

export type StrategyRunArtifactRecord = {
  artifactId: string;
  runId: string;
  artifactKind: string;
  artifactUri: string;
  checksumSha256?: string;
  sizeBytes?: number;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type StrategyRunExperimentRecord = {
  experimentId: string;
  runId: string;
  strategyId: string;
  experimentName: string;
  tags: string[];
  notes: string;
  parameters: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type StrategyConnectorType = "data-provider" | "paper-broker";

export type StrategyConnectorStatus =
  | "not_configured"
  | "configured"
  | "disabled";

export type StrategyConnectorRecord = {
  connectorId: string;
  tenantId: string;
  connectorType: StrategyConnectorType;
  status: StrategyConnectorStatus;
  displayName: string;
  config: Record<string, unknown>;
  capabilities: Record<string, unknown>;
  updatedAt: string;
};

export type StrategyGovernanceProfileRecord = {
  profileId: string;
  tenantId: string;
  profileName: string;
  isDefault: boolean;
  transitionRules: Record<string, unknown>;
  requiredReportSections: string[];
  benchmarkRequired: boolean;
  oosMinimums: Record<string, number>;
  drawdownHaltRules: Record<string, unknown>;
  replayTolerance: Record<string, number>;
  updatedAt: string;
};

export type StrategyAcceptancePackRecord = {
  packId: string;
  tenantId: string;
  packName: string;
  isDefault: boolean;
  goldenStrategies: string[];
  requiredReportSections: string[];
  replayTolerance: Record<string, number>;
  promotionChecklist: Record<string, boolean>;
  definitionOfDone: Record<string, unknown>;
  updatedAt: string;
};

export type StrategyForwardProfileRecord = {
  profileId: string;
  strategyId: string;
  sourceRunId: string;
  executionMode: "paper" | "live";
  status: "active" | "paused" | "stopped";
  benchmark: string;
  rebalanceFrozenAt: string;
  startedAt: string;
  stoppedAt: string | null;
  governanceProfileId: string | null;
  acceptancePackId: string | null;
  metadata: Record<string, unknown>;
};

export class BacktestingRepo {
  constructor(private readonly pool: Pool) {}

  private resolveTenant(tenantId?: string): string {
    return tenantId && tenantId.trim().length > 0 ? tenantId.trim() : "default";
  }

  async createRun(input: CreateBacktestRunInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO strategy_backtest_runs
       (run_id, tenant_id, user_id, strategy_id, strategy_version, snapshot_id, execution_mode, status, idempotency_key, queue_priority, queue_resource_class, max_attempts, run_metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued', $8, $9, $10, $11, $12::jsonb)`,
      [
        input.runId,
        this.resolveTenant(input.tenantId),
        input.userId,
        input.strategyId,
        input.strategyVersion,
        input.snapshotId,
        input.executionMode,
        input.idempotencyKey ?? null,
        input.queuePriority,
        input.queueResourceClass,
        Math.max(1, input.maxAttempts),
        JSON.stringify(input.runMetadata ?? {}),
      ],
    );

    await this.pool.query(
      `INSERT INTO strategy_run_assumptions (run_id, tenant_id, assumptions)
       VALUES ($1, $2, $3)`,
      [
        input.runId,
        this.resolveTenant(input.tenantId),
        JSON.stringify(input.assumptions ?? {}),
      ],
    );
  }

  async getDatasetSnapshot(
    snapshotId: string,
    userId: string,
    tenantId?: string,
  ): Promise<DatasetSnapshotRecord | null> {
    const tenant = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `SELECT snapshot_id, dataset_name, dataset_version, snapshot_at, checksum_sha256
       FROM strategy_dataset_snapshots
       WHERE snapshot_id = $1 AND user_id = $2 AND tenant_id = $3`,
      [snapshotId, userId, tenant],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      snapshotId: row.snapshot_id,
      datasetName: row.dataset_name,
      datasetVersion: row.dataset_version,
      snapshotAt: row.snapshot_at,
      rowCount: row.row_count ?? null,
      sourceManifest: row.source_manifest ?? {},
      checksumSha256: row.checksum_sha256,
    };
  }

  async listDatasetSnapshots(
    userId: string,
    tenantId?: string,
    limit = 100,
  ): Promise<DatasetSnapshotRecord[]> {
    const tenant = this.resolveTenant(tenantId);
    const boundedLimit = Math.max(1, Math.min(limit, 500));
    const result = await this.pool.query(
      `SELECT snapshot_id, dataset_name, dataset_version, snapshot_at, row_count, source_manifest, checksum_sha256
       FROM strategy_dataset_snapshots
       WHERE user_id = $1 AND tenant_id = $2
       ORDER BY snapshot_at DESC
       LIMIT $3`,
      [userId, tenant, boundedLimit],
    );

    return result.rows.map((row) => ({
      snapshotId: row.snapshot_id,
      datasetName: row.dataset_name,
      datasetVersion: row.dataset_version,
      snapshotAt: row.snapshot_at,
      rowCount: row.row_count ?? null,
      sourceManifest: row.source_manifest ?? {},
      checksumSha256: row.checksum_sha256,
    }));
  }

  async getRunAssumptions(
    runId: string,
    userId: string,
    tenantId?: string,
  ): Promise<Record<string, unknown> | null> {
    const tenant = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `SELECT rsa.assumptions
       FROM strategy_run_assumptions rsa
       JOIN strategy_backtest_runs r ON r.run_id = rsa.run_id
       WHERE rsa.run_id = $1 AND r.user_id = $2 AND r.tenant_id = $3`,
      [runId, userId, tenant],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return row.assumptions ?? {};
  }

  async setRunStatus(
    runId: string,
    userId: string,
    status: BacktestRunStatus,
    tenantId?: string,
    opts?: {
      error?: string;
      metrics?: Record<string, unknown>;
      runMetadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    const tenant = this.resolveTenant(tenantId);
    const startedAtSql =
      status === "running" ? "COALESCE(started_at, NOW())" : "started_at";
    const finishedAtSql =
      status === "completed" || status === "failed" || status === "cancelled"
        ? "NOW()"
        : "finished_at";

    await this.pool.query(
      `UPDATE strategy_backtest_runs
       SET status = $3,
           started_at = ${startedAtSql},
           finished_at = ${finishedAtSql},
           error = COALESCE($4, error),
           last_error = COALESCE($4, last_error),
           metrics = COALESCE($5, metrics),
           run_metadata = COALESCE(run_metadata, '{}'::jsonb) || COALESCE($6::jsonb, '{}'::jsonb),
           updated_at = NOW()
       WHERE run_id = $1 AND user_id = $2 AND tenant_id = $7`,
      [
        runId,
        userId,
        status,
        opts?.error ?? null,
        opts?.metrics ? JSON.stringify(opts.metrics) : null,
        opts?.runMetadata ? JSON.stringify(opts.runMetadata) : null,
        tenant,
      ],
    );
  }

  async attachQueueJob(
    runId: string,
    userId: string,
    queueJobId: string,
    tenantId?: string,
  ): Promise<void> {
    const tenant = this.resolveTenant(tenantId);
    await this.pool.query(
      `UPDATE strategy_backtest_runs
       SET queue_job_id = $3, updated_at = NOW()
       WHERE run_id = $1 AND user_id = $2 AND tenant_id = $4`,
      [runId, userId, queueJobId, tenant],
    );
  }

  async updateRetryProgress(
    runId: string,
    userId: string,
    retryCount: number,
    maxAttempts: number,
    tenantId?: string,
    lastError?: string,
  ): Promise<void> {
    const tenant = this.resolveTenant(tenantId);
    await this.pool.query(
      `UPDATE strategy_backtest_runs
       SET retry_count = $3,
           max_attempts = $4,
           last_retry_at = NOW(),
           last_error = COALESCE($5, last_error),
           updated_at = NOW()
       WHERE run_id = $1 AND user_id = $2 AND tenant_id = $6`,
      [
        runId,
        userId,
        Math.max(0, retryCount),
        Math.max(1, maxAttempts),
        lastError ?? null,
        tenant,
      ],
    );
  }

  async getResourceUsage(
    userId: string,
    tenantId?: string,
  ): Promise<{
    queuedForUser: number;
    runningForTenant: number;
    queuedForTenant: number;
  }> {
    const tenant = this.resolveTenant(tenantId);
    const [userQueuedResult, tenantRunningResult, tenantQueuedResult] =
      await Promise.all([
        this.pool.query(
          `SELECT COUNT(*)::int AS count
           FROM strategy_backtest_runs
           WHERE user_id = $1 AND tenant_id = $2 AND status = 'queued'`,
          [userId, tenant],
        ),
        this.pool.query(
          `SELECT COUNT(*)::int AS count
           FROM strategy_backtest_runs
           WHERE tenant_id = $1 AND status = 'running'`,
          [tenant],
        ),
        this.pool.query(
          `SELECT COUNT(*)::int AS count
           FROM strategy_backtest_runs
           WHERE tenant_id = $1 AND status = 'queued'`,
          [tenant],
        ),
      ]);

    return {
      queuedForUser: userQueuedResult.rows[0]?.count ?? 0,
      runningForTenant: tenantRunningResult.rows[0]?.count ?? 0,
      queuedForTenant: tenantQueuedResult.rows[0]?.count ?? 0,
    };
  }

  async getRun(
    runId: string,
    userId: string,
    tenantId?: string,
  ): Promise<BacktestRunRecord | null> {
    const tenant = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `SELECT run_id, strategy_id, strategy_version, snapshot_id, execution_mode, status,
              queue_job_id, queue_priority, queue_resource_class, retry_count, max_attempts,
              last_retry_at, last_error, requested_at, started_at, finished_at, error, metrics, run_metadata
       FROM strategy_backtest_runs
       WHERE run_id = $1 AND user_id = $2 AND tenant_id = $3`,
      [runId, userId, tenant],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      runId: row.run_id,
      strategyId: row.strategy_id,
      strategyVersion: row.strategy_version,
      snapshotId: row.snapshot_id,
      executionMode: row.execution_mode,
      queueJobId: row.queue_job_id,
      queuePriority: row.queue_priority,
      queueResourceClass: row.queue_resource_class,
      retryCount: row.retry_count ?? 0,
      maxAttempts: row.max_attempts ?? 1,
      lastRetryAt: row.last_retry_at,
      lastError: row.last_error,
      status: row.status,
      requestedAt: row.requested_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      error: row.error,
      metrics: row.metrics ?? {},
      runMetadata: row.run_metadata ?? {},
    };
  }

  async listRuns(
    userId: string,
    tenantId?: string,
    strategyId?: string,
    limit = 50,
  ): Promise<BacktestRunRecord[]> {
    const tenant = this.resolveTenant(tenantId);
    const clauses = ["user_id = $1", "tenant_id = $2"];
    const params: Array<string | number> = [userId, tenant];

    if (strategyId && strategyId.trim()) {
      clauses.push(`strategy_id = $${params.length + 1}`);
      params.push(strategyId.trim());
    }

    params.push(Math.max(1, Math.min(limit, 500)));

    const result = await this.pool.query(
      `SELECT run_id, strategy_id, strategy_version, snapshot_id, execution_mode, status,
              queue_job_id, queue_priority, queue_resource_class, retry_count, max_attempts,
              last_retry_at, last_error, requested_at, started_at, finished_at, error, metrics, run_metadata
       FROM strategy_backtest_runs
       WHERE ${clauses.join(" AND ")}
       ORDER BY requested_at DESC
       LIMIT $${params.length}`,
      params,
    );

    return result.rows.map((row) => ({
      runId: row.run_id,
      strategyId: row.strategy_id,
      strategyVersion: row.strategy_version,
      snapshotId: row.snapshot_id,
      executionMode: row.execution_mode,
      queueJobId: row.queue_job_id,
      queuePriority: row.queue_priority,
      queueResourceClass: row.queue_resource_class,
      retryCount: row.retry_count ?? 0,
      maxAttempts: row.max_attempts ?? 1,
      lastRetryAt: row.last_retry_at,
      lastError: row.last_error,
      status: row.status,
      requestedAt: row.requested_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      error: row.error,
      metrics: row.metrics ?? {},
      runMetadata: row.run_metadata ?? {},
    }));
  }

  async getForwardProfileSourceRun(
    runId: string,
    userId: string,
    tenantId?: string,
  ): Promise<ForwardProfileSourceRun | null> {
    const tenant = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `SELECT run_id, strategy_id, strategy_version, status, metrics
       FROM strategy_backtest_runs
       WHERE run_id = $1 AND user_id = $2 AND tenant_id = $3`,
      [runId, userId, tenant],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      runId: row.run_id,
      strategyId: row.strategy_id,
      strategyVersion: row.strategy_version,
      status: row.status,
      metrics: row.metrics ?? {},
    };
  }

  async saveArtifact(input: {
    artifactId: string;
    runId: string;
    tenantId?: string;
    artifactKind: string;
    artifactUri: string;
    payload?: Record<string, unknown>;
    checksumSha256?: string;
    sizeBytes?: number;
  }): Promise<void> {
    const tenant = this.resolveTenant(input.tenantId);
    await this.pool.query(
      `INSERT INTO strategy_run_artifacts
       (artifact_id, run_id, tenant_id, artifact_kind, artifact_uri, checksum_sha256, size_bytes, payload_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        input.artifactId,
        input.runId,
        tenant,
        input.artifactKind,
        input.artifactUri,
        input.checksumSha256 ?? null,
        input.sizeBytes ?? null,
        JSON.stringify(input.payload ?? {}),
      ],
    );
  }

  async listArtifacts(
    runId: string,
    userId: string,
    tenantId?: string,
  ): Promise<StrategyRunArtifactRecord[]> {
    const tenant = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `SELECT a.artifact_id, a.run_id, a.artifact_kind, a.artifact_uri,
              a.checksum_sha256, a.size_bytes, a.payload_json, a.created_at
       FROM strategy_run_artifacts a
       JOIN strategy_backtest_runs r ON r.run_id = a.run_id
       WHERE a.run_id = $1 AND r.user_id = $2 AND r.tenant_id = $3
       ORDER BY a.created_at DESC`,
      [runId, userId, tenant],
    );
    return result.rows.map((row) => ({
      artifactId: row.artifact_id,
      runId: row.run_id,
      artifactKind: row.artifact_kind,
      artifactUri: row.artifact_uri,
      checksumSha256: row.checksum_sha256 ?? undefined,
      sizeBytes: row.size_bytes ?? undefined,
      payload: row.payload_json ?? {},
      createdAt: row.created_at,
    }));
  }

  async upsertExperiment(input: {
    experimentId: string;
    tenantId?: string;
    userId: string;
    strategyId: string;
    runId: string;
    experimentName: string;
    tags: string[];
    notes: string;
    parameters?: Record<string, unknown>;
  }): Promise<void> {
    const tenant = this.resolveTenant(input.tenantId);
    await this.pool.query(
      `INSERT INTO strategy_run_experiments
       (experiment_id, tenant_id, user_id, strategy_id, run_id, experiment_name, tags, notes, parameters)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb)
       ON CONFLICT (tenant_id, run_id)
       DO UPDATE SET
         experiment_name = EXCLUDED.experiment_name,
         tags = EXCLUDED.tags,
         notes = EXCLUDED.notes,
         parameters = EXCLUDED.parameters,
         updated_at = NOW()`,
      [
        input.experimentId,
        tenant,
        input.userId,
        input.strategyId,
        input.runId,
        input.experimentName,
        JSON.stringify(input.tags),
        input.notes,
        JSON.stringify(input.parameters ?? {}),
      ],
    );
  }

  async getExperiment(
    runId: string,
    userId: string,
    tenantId?: string,
  ): Promise<StrategyRunExperimentRecord | null> {
    const tenant = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `SELECT experiment_id, run_id, strategy_id, experiment_name, tags, notes, parameters, created_at, updated_at
       FROM strategy_run_experiments
       WHERE run_id = $1 AND user_id = $2 AND tenant_id = $3`,
      [runId, userId, tenant],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return {
      experimentId: row.experiment_id,
      runId: row.run_id,
      strategyId: row.strategy_id,
      experimentName: row.experiment_name,
      tags: Array.isArray(row.tags) ? row.tags : [],
      notes: row.notes ?? "",
      parameters: row.parameters ?? {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async upsertConnector(input: {
    connectorId: string;
    tenantId?: string;
    connectorType: StrategyConnectorType;
    status: StrategyConnectorStatus;
    displayName: string;
    config?: Record<string, unknown>;
    capabilities?: Record<string, unknown>;
  }): Promise<void> {
    const tenant = this.resolveTenant(input.tenantId);
    await this.pool.query(
      `INSERT INTO strategy_provider_connectors
       (connector_id, tenant_id, connector_type, status, display_name, config_json, capabilities_json)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
       ON CONFLICT (tenant_id, connector_type)
       DO UPDATE SET
         connector_id = EXCLUDED.connector_id,
         status = EXCLUDED.status,
         display_name = EXCLUDED.display_name,
         config_json = EXCLUDED.config_json,
         capabilities_json = EXCLUDED.capabilities_json,
         updated_at = NOW()`,
      [
        input.connectorId,
        tenant,
        input.connectorType,
        input.status,
        input.displayName,
        JSON.stringify(input.config ?? {}),
        JSON.stringify(input.capabilities ?? {}),
      ],
    );
  }

  async listConnectors(tenantId?: string): Promise<StrategyConnectorRecord[]> {
    const tenant = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `SELECT connector_id, tenant_id, connector_type, status, display_name,
              config_json, capabilities_json, updated_at
       FROM strategy_provider_connectors
       WHERE tenant_id = $1
       ORDER BY connector_type ASC, updated_at DESC`,
      [tenant],
    );
    return result.rows.map((row) => ({
      connectorId: row.connector_id,
      tenantId: row.tenant_id,
      connectorType: row.connector_type,
      status: row.status,
      displayName: row.display_name ?? "",
      config: row.config_json ?? {},
      capabilities: row.capabilities_json ?? {},
      updatedAt: row.updated_at,
    }));
  }

  async getConnector(
    connectorType: StrategyConnectorType,
    tenantId?: string,
  ): Promise<StrategyConnectorRecord | null> {
    const tenant = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `SELECT connector_id, tenant_id, connector_type, status, display_name,
              config_json, capabilities_json, updated_at
       FROM strategy_provider_connectors
       WHERE tenant_id = $1 AND connector_type = $2`,
      [tenant, connectorType],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return {
      connectorId: row.connector_id,
      tenantId: row.tenant_id,
      connectorType: row.connector_type,
      status: row.status,
      displayName: row.display_name ?? "",
      config: row.config_json ?? {},
      capabilities: row.capabilities_json ?? {},
      updatedAt: row.updated_at,
    };
  }

  async upsertGovernanceProfile(input: {
    profileId: string;
    tenantId?: string;
    profileName: string;
    isDefault: boolean;
    transitionRules?: Record<string, unknown>;
    requiredReportSections?: string[];
    benchmarkRequired: boolean;
    oosMinimums?: Record<string, number>;
    drawdownHaltRules?: Record<string, unknown>;
    replayTolerance?: Record<string, number>;
  }): Promise<void> {
    const tenant = this.resolveTenant(input.tenantId);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (input.isDefault) {
        await client.query(
          `UPDATE strategy_governance_profiles
           SET is_default = FALSE, updated_at = NOW()
           WHERE tenant_id = $1 AND profile_id <> $2`,
          [tenant, input.profileId],
        );
      }

      await client.query(
        `INSERT INTO strategy_governance_profiles
         (profile_id, tenant_id, profile_name, is_default, transition_rules, required_report_sections,
          benchmark_required, oos_minimums, drawdown_halt_rules, replay_tolerance)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8::jsonb, $9::jsonb, $10::jsonb)
         ON CONFLICT (profile_id)
         DO UPDATE SET
           profile_name = EXCLUDED.profile_name,
           is_default = EXCLUDED.is_default,
           transition_rules = EXCLUDED.transition_rules,
           required_report_sections = EXCLUDED.required_report_sections,
           benchmark_required = EXCLUDED.benchmark_required,
           oos_minimums = EXCLUDED.oos_minimums,
           drawdown_halt_rules = EXCLUDED.drawdown_halt_rules,
           replay_tolerance = EXCLUDED.replay_tolerance,
           updated_at = NOW()`,
        [
          input.profileId,
          tenant,
          input.profileName,
          input.isDefault,
          JSON.stringify(input.transitionRules ?? {}),
          JSON.stringify(input.requiredReportSections ?? []),
          input.benchmarkRequired,
          JSON.stringify(input.oosMinimums ?? {}),
          JSON.stringify(input.drawdownHaltRules ?? {}),
          JSON.stringify(input.replayTolerance ?? {}),
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listGovernanceProfiles(
    tenantId?: string,
  ): Promise<StrategyGovernanceProfileRecord[]> {
    const tenant = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `SELECT profile_id, tenant_id, profile_name, is_default, transition_rules,
              required_report_sections, benchmark_required, oos_minimums,
              drawdown_halt_rules, replay_tolerance, updated_at
       FROM strategy_governance_profiles
       WHERE tenant_id = $1
       ORDER BY is_default DESC, updated_at DESC`,
      [tenant],
    );
    return result.rows.map((row) => ({
      profileId: row.profile_id,
      tenantId: row.tenant_id,
      profileName: row.profile_name,
      isDefault: row.is_default === true,
      transitionRules: row.transition_rules ?? {},
      requiredReportSections: Array.isArray(row.required_report_sections)
        ? row.required_report_sections
        : [],
      benchmarkRequired: row.benchmark_required === true,
      oosMinimums: row.oos_minimums ?? {},
      drawdownHaltRules: row.drawdown_halt_rules ?? {},
      replayTolerance: row.replay_tolerance ?? {},
      updatedAt: row.updated_at,
    }));
  }

  async getGovernanceProfileById(
    profileId: string,
    tenantId?: string,
  ): Promise<StrategyGovernanceProfileRecord | null> {
    const tenant = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `SELECT profile_id, tenant_id, profile_name, is_default, transition_rules,
              required_report_sections, benchmark_required, oos_minimums,
              drawdown_halt_rules, replay_tolerance, updated_at
       FROM strategy_governance_profiles
       WHERE tenant_id = $1 AND profile_id = $2
       LIMIT 1`,
      [tenant, profileId],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return {
      profileId: row.profile_id,
      tenantId: row.tenant_id,
      profileName: row.profile_name,
      isDefault: row.is_default === true,
      transitionRules: row.transition_rules ?? {},
      requiredReportSections: Array.isArray(row.required_report_sections)
        ? row.required_report_sections
        : [],
      benchmarkRequired: row.benchmark_required === true,
      oosMinimums: row.oos_minimums ?? {},
      drawdownHaltRules: row.drawdown_halt_rules ?? {},
      replayTolerance: row.replay_tolerance ?? {},
      updatedAt: row.updated_at,
    };
  }

  async getDefaultGovernanceProfile(
    tenantId?: string,
  ): Promise<StrategyGovernanceProfileRecord | null> {
    const tenant = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `SELECT profile_id, tenant_id, profile_name, is_default, transition_rules,
              required_report_sections, benchmark_required, oos_minimums,
              drawdown_halt_rules, replay_tolerance, updated_at
       FROM strategy_governance_profiles
       WHERE tenant_id = $1 AND is_default = TRUE
       ORDER BY updated_at DESC
       LIMIT 1`,
      [tenant],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return {
      profileId: row.profile_id,
      tenantId: row.tenant_id,
      profileName: row.profile_name,
      isDefault: row.is_default === true,
      transitionRules: row.transition_rules ?? {},
      requiredReportSections: Array.isArray(row.required_report_sections)
        ? row.required_report_sections
        : [],
      benchmarkRequired: row.benchmark_required === true,
      oosMinimums: row.oos_minimums ?? {},
      drawdownHaltRules: row.drawdown_halt_rules ?? {},
      replayTolerance: row.replay_tolerance ?? {},
      updatedAt: row.updated_at,
    };
  }

  async upsertAcceptancePack(input: {
    packId: string;
    tenantId?: string;
    packName: string;
    isDefault: boolean;
    goldenStrategies?: string[];
    requiredReportSections?: string[];
    replayTolerance?: Record<string, number>;
    promotionChecklist?: Record<string, boolean>;
    definitionOfDone?: Record<string, unknown>;
  }): Promise<void> {
    const tenant = this.resolveTenant(input.tenantId);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (input.isDefault) {
        await client.query(
          `UPDATE strategy_acceptance_packs
           SET is_default = FALSE, updated_at = NOW()
           WHERE tenant_id = $1 AND pack_id <> $2`,
          [tenant, input.packId],
        );
      }

      await client.query(
        `INSERT INTO strategy_acceptance_packs
         (pack_id, tenant_id, pack_name, is_default, golden_strategies, required_report_sections,
          replay_tolerance, promotion_checklist, definition_of_done)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb)
         ON CONFLICT (pack_id)
         DO UPDATE SET
           pack_name = EXCLUDED.pack_name,
           is_default = EXCLUDED.is_default,
           golden_strategies = EXCLUDED.golden_strategies,
           required_report_sections = EXCLUDED.required_report_sections,
           replay_tolerance = EXCLUDED.replay_tolerance,
           promotion_checklist = EXCLUDED.promotion_checklist,
           definition_of_done = EXCLUDED.definition_of_done,
           updated_at = NOW()`,
        [
          input.packId,
          tenant,
          input.packName,
          input.isDefault,
          JSON.stringify(input.goldenStrategies ?? []),
          JSON.stringify(input.requiredReportSections ?? []),
          JSON.stringify(input.replayTolerance ?? {}),
          JSON.stringify(input.promotionChecklist ?? {}),
          JSON.stringify(input.definitionOfDone ?? {}),
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listAcceptancePacks(
    tenantId?: string,
  ): Promise<StrategyAcceptancePackRecord[]> {
    const tenant = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `SELECT pack_id, tenant_id, pack_name, is_default, golden_strategies,
              required_report_sections, replay_tolerance, promotion_checklist,
              definition_of_done, updated_at
       FROM strategy_acceptance_packs
       WHERE tenant_id = $1
       ORDER BY is_default DESC, updated_at DESC`,
      [tenant],
    );
    return result.rows.map((row) => ({
      packId: row.pack_id,
      tenantId: row.tenant_id,
      packName: row.pack_name,
      isDefault: row.is_default === true,
      goldenStrategies: Array.isArray(row.golden_strategies)
        ? row.golden_strategies
        : [],
      requiredReportSections: Array.isArray(row.required_report_sections)
        ? row.required_report_sections
        : [],
      replayTolerance: row.replay_tolerance ?? {},
      promotionChecklist: row.promotion_checklist ?? {},
      definitionOfDone: row.definition_of_done ?? {},
      updatedAt: row.updated_at,
    }));
  }

  async getAcceptancePackById(
    packId: string,
    tenantId?: string,
  ): Promise<StrategyAcceptancePackRecord | null> {
    const tenant = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `SELECT pack_id, tenant_id, pack_name, is_default, golden_strategies,
              required_report_sections, replay_tolerance, promotion_checklist,
              definition_of_done, updated_at
       FROM strategy_acceptance_packs
       WHERE tenant_id = $1 AND pack_id = $2
       LIMIT 1`,
      [tenant, packId],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return {
      packId: row.pack_id,
      tenantId: row.tenant_id,
      packName: row.pack_name,
      isDefault: row.is_default === true,
      goldenStrategies: Array.isArray(row.golden_strategies)
        ? row.golden_strategies
        : [],
      requiredReportSections: Array.isArray(row.required_report_sections)
        ? row.required_report_sections
        : [],
      replayTolerance: row.replay_tolerance ?? {},
      promotionChecklist: row.promotion_checklist ?? {},
      definitionOfDone: row.definition_of_done ?? {},
      updatedAt: row.updated_at,
    };
  }

  async getDefaultAcceptancePack(
    tenantId?: string,
  ): Promise<StrategyAcceptancePackRecord | null> {
    const tenant = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `SELECT pack_id, tenant_id, pack_name, is_default, golden_strategies,
              required_report_sections, replay_tolerance, promotion_checklist,
              definition_of_done, updated_at
       FROM strategy_acceptance_packs
       WHERE tenant_id = $1 AND is_default = TRUE
       ORDER BY updated_at DESC
       LIMIT 1`,
      [tenant],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return {
      packId: row.pack_id,
      tenantId: row.tenant_id,
      packName: row.pack_name,
      isDefault: row.is_default === true,
      goldenStrategies: Array.isArray(row.golden_strategies)
        ? row.golden_strategies
        : [],
      requiredReportSections: Array.isArray(row.required_report_sections)
        ? row.required_report_sections
        : [],
      replayTolerance: row.replay_tolerance ?? {},
      promotionChecklist: row.promotion_checklist ?? {},
      definitionOfDone: row.definition_of_done ?? {},
      updatedAt: row.updated_at,
    };
  }

  async createPromotionEvent(input: {
    eventId: string;
    tenantId?: string;
    strategyId: string;
    fromStage: "candidate" | "validation" | "production" | "retired";
    toStage: "candidate" | "validation" | "production" | "retired";
    autoGatePassed: boolean;
    governanceProfileId?: string;
    acceptancePackId?: string;
    governanceValidation?: Record<string, unknown>;
    manualApprovedBy?: string;
    checklist?: Record<string, boolean>;
    rationale?: string;
  }): Promise<void> {
    const tenant = this.resolveTenant(input.tenantId);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO strategy_promotion_events
         (event_id, tenant_id, strategy_id, from_stage, to_stage, auto_gate_passed, governance_profile_id, acceptance_pack_id, governance_validation, manual_approved_by, checklist, rationale)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)`,
        [
          input.eventId,
          tenant,
          input.strategyId,
          input.fromStage,
          input.toStage,
          input.autoGatePassed,
          input.governanceProfileId ?? null,
          input.acceptancePackId ?? null,
          JSON.stringify(input.governanceValidation ?? {}),
          input.manualApprovedBy ?? null,
          JSON.stringify(input.checklist ?? {}),
          input.rationale ?? "",
        ],
      );

      await client.query(
        `UPDATE strategy_definitions
         SET stage = $2, updated_at = NOW()
         WHERE strategy_id = $1 AND tenant_id = $3`,
        [input.strategyId, input.toStage, tenant],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async createForwardProfile(input: {
    profileId: string;
    tenantId?: string;
    userId: string;
    strategyId: string;
    sourceRunId: string;
    executionMode: "paper" | "live";
    governanceProfileId?: string;
    acceptancePackId?: string;
    activationChecklist?: Record<string, boolean>;
    governanceValidation?: Record<string, unknown>;
    benchmark: string;
    rebalanceFrozenAt: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO strategy_forward_profiles
       (profile_id, tenant_id, user_id, strategy_id, source_run_id, execution_mode, governance_profile_id,
        acceptance_pack_id, activation_checklist, governance_validation, status, benchmark, rebalance_frozen_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, 'active', $11, $12, $13::jsonb)`,
      [
        input.profileId,
        this.resolveTenant(input.tenantId),
        input.userId,
        input.strategyId,
        input.sourceRunId,
        input.executionMode,
        input.governanceProfileId ?? null,
        input.acceptancePackId ?? null,
        JSON.stringify(input.activationChecklist ?? {}),
        JSON.stringify(input.governanceValidation ?? {}),
        input.benchmark,
        input.rebalanceFrozenAt,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  }

  async listForwardProfiles(
    userId: string,
    tenantId?: string,
    strategyId?: string,
    limit = 100,
  ): Promise<StrategyForwardProfileRecord[]> {
    const tenant = this.resolveTenant(tenantId);
    const boundedLimit = Math.max(1, Math.min(limit, 500));
    const clauses = ["tenant_id = $1", "user_id = $2"];
    const params: Array<string | number> = [tenant, userId];

    if (strategyId && strategyId.trim().length > 0) {
      clauses.push(`strategy_id = $${params.length + 1}`);
      params.push(strategyId.trim());
    }
    params.push(boundedLimit);

    const result = await this.pool.query(
      `SELECT profile_id, strategy_id, source_run_id, execution_mode, status, benchmark,
              rebalance_frozen_at, started_at, stopped_at, governance_profile_id,
              acceptance_pack_id, metadata
       FROM strategy_forward_profiles
       WHERE ${clauses.join(" AND ")}
       ORDER BY started_at DESC
       LIMIT $${params.length}`,
      params,
    );

    return result.rows.map((row) => ({
      profileId: row.profile_id,
      strategyId: row.strategy_id,
      sourceRunId: row.source_run_id,
      executionMode: row.execution_mode,
      status: row.status,
      benchmark: row.benchmark,
      rebalanceFrozenAt: row.rebalance_frozen_at,
      startedAt: row.started_at,
      stoppedAt: row.stopped_at,
      governanceProfileId: row.governance_profile_id ?? null,
      acceptancePackId: row.acceptance_pack_id ?? null,
      metadata: row.metadata ?? {},
    }));
  }

  async getForwardProfile(
    profileId: string,
    userId: string,
    tenantId?: string,
  ): Promise<StrategyForwardProfileRecord | null> {
    const tenant = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `SELECT profile_id, strategy_id, source_run_id, execution_mode, status, benchmark,
              rebalance_frozen_at, started_at, stopped_at, governance_profile_id,
              acceptance_pack_id, metadata
       FROM strategy_forward_profiles
       WHERE profile_id = $1 AND tenant_id = $2 AND user_id = $3
       LIMIT 1`,
      [profileId, tenant, userId],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return {
      profileId: row.profile_id,
      strategyId: row.strategy_id,
      sourceRunId: row.source_run_id,
      executionMode: row.execution_mode,
      status: row.status,
      benchmark: row.benchmark,
      rebalanceFrozenAt: row.rebalance_frozen_at,
      startedAt: row.started_at,
      stoppedAt: row.stopped_at,
      governanceProfileId: row.governance_profile_id ?? null,
      acceptancePackId: row.acceptance_pack_id ?? null,
      metadata: row.metadata ?? {},
    };
  }

  async setForwardProfileStatus(input: {
    profileId: string;
    userId: string;
    tenantId?: string;
    status: "active" | "paused" | "stopped";
    metadataPatch?: Record<string, unknown>;
  }): Promise<void> {
    const tenant = this.resolveTenant(input.tenantId);
    await this.pool.query(
      `UPDATE strategy_forward_profiles
       SET status = $4,
           stopped_at = CASE WHEN $4 = 'stopped' THEN NOW() ELSE stopped_at END,
           metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE($5::jsonb, '{}'::jsonb)
       WHERE profile_id = $1 AND tenant_id = $2 AND user_id = $3`,
      [
        input.profileId,
        tenant,
        input.userId,
        input.status,
        JSON.stringify(input.metadataPatch ?? {}),
      ],
    );
  }
}

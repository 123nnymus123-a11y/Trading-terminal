import { getDb } from "./db";

export type LocalStrategyStage =
  | "draft"
  | "candidate"
  | "validation"
  | "production"
  | "retired";

export type LocalStrategyDefinitionRecord = {
  id: string;
  name: string;
  description?: string;
  stage: LocalStrategyStage;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

export type LocalStrategyVersionRecord = {
  id: string;
  strategyId: string;
  version: string;
  scriptLanguage: "javascript" | "typescript";
  scriptSource: string;
  scriptChecksum: string;
  universe: string[];
  assumptions: Record<string, unknown>;
  createdAt: string;
};

export type LocalStrategyRunRecord = {
  runId: string;
  strategyId: string;
  strategyVersion: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  executionMode: "desktop-local" | "backend";
  requestedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  metrics?: Record<string, unknown>;
  equityCurve?: Array<{ timestamp: string; value: number }>;
  trades?: Array<Record<string, unknown>>;
  historicalData?: Record<string, unknown>;
  runMetadata?: Record<string, unknown>;
  runLogs?: string[];
};

export type LocalStrategyWorkspace = {
  strategies: LocalStrategyDefinitionRecord[];
  versions: Record<string, LocalStrategyVersionRecord>;
  runs: LocalStrategyRunRecord[];
  comparisonNotes: LocalStrategyComparisonNoteRecord[];
};

export type LocalStrategyComparisonNoteRecord = {
  id: string;
  strategyId: string;
  primaryRunId: string;
  baselineRunId: string;
  note: string;
  createdAt: string;
  updatedAt: string;
};

function parseJsonObject(
  value: unknown,
  fallback: Record<string, unknown> = {},
): Record<string, unknown> {
  if (typeof value !== "string") {
    return fallback;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : fallback;
  } catch {
    return fallback;
  }
}

function parseJsonArray<T>(value: unknown, fallback: T[] = []): T[] {
  if (typeof value !== "string") {
    return fallback;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeStage(value: unknown): LocalStrategyStage {
  return value === "draft" ||
    value === "candidate" ||
    value === "validation" ||
    value === "production" ||
    value === "retired"
    ? value
    : "candidate";
}

export const StrategyResearchRepo = {
  listWorkspace(): LocalStrategyWorkspace {
    const db = getDb();

    const strategies = db
      .prepare(
        `SELECT id, name, description, stage, tags_json, created_at, updated_at
         FROM strategy_local_definition
         ORDER BY updated_at DESC`,
      )
      .all() as Array<{
      id: string;
      name: string;
      description: string;
      stage: string;
      tags_json: string;
      created_at: string;
      updated_at: string;
    }>;

    const versionsList = db
      .prepare(
        `SELECT id, strategy_id, version, script_language, script_source, script_checksum, universe_json, assumptions_json, created_at
         FROM strategy_local_version
         ORDER BY created_at DESC`,
      )
      .all() as Array<{
      id: string;
      strategy_id: string;
      version: string;
      script_language: "javascript" | "typescript";
      script_source: string;
      script_checksum: string;
      universe_json: string;
      assumptions_json: string;
      created_at: string;
    }>;

    const versions: Record<string, LocalStrategyVersionRecord> = {};
    for (const row of versionsList) {
      if (versions[row.strategy_id]) {
        continue;
      }
      versions[row.strategy_id] = {
        id: row.id,
        strategyId: row.strategy_id,
        version: row.version,
        scriptLanguage: row.script_language,
        scriptSource: row.script_source,
        scriptChecksum: row.script_checksum,
        universe: parseJsonArray<string>(row.universe_json, []),
        assumptions: parseJsonObject(row.assumptions_json, {}),
        createdAt: row.created_at,
      };
    }

    const runs = db
      .prepare(
        `SELECT run_id, strategy_id, strategy_version, status, execution_mode, requested_at, started_at, finished_at,
               error, metrics_json, equity_curve_json, trades_json, historical_data_json, run_metadata_json, run_logs_json
         FROM strategy_local_run
         ORDER BY created_at DESC`,
      )
      .all() as Array<{
      run_id: string;
      strategy_id: string;
      strategy_version: string;
      status: "queued" | "running" | "completed" | "failed" | "cancelled";
      execution_mode: "desktop-local" | "backend";
      requested_at: string | null;
      started_at: string | null;
      finished_at: string | null;
      error: string | null;
      metrics_json: string;
      equity_curve_json: string | null;
      trades_json: string | null;
      historical_data_json: string | null;
      run_metadata_json: string | null;
      run_logs_json: string | null;
    }>;

    const comparisonNotes = db
      .prepare(
        `SELECT id, strategy_id, primary_run_id, baseline_run_id, note, created_at, updated_at
         FROM strategy_local_comparison_note
         ORDER BY updated_at DESC`,
      )
      .all() as Array<{
      id: string;
      strategy_id: string;
      primary_run_id: string;
      baseline_run_id: string;
      note: string;
      created_at: string;
      updated_at: string;
    }>;

    return {
      strategies: strategies.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description || undefined,
        stage: normalizeStage(row.stage),
        tags: parseJsonArray<string>(row.tags_json, []),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      versions,
      runs: runs.map((row) => ({
        runId: row.run_id,
        strategyId: row.strategy_id,
        strategyVersion: row.strategy_version,
        status: row.status,
        executionMode: row.execution_mode,
        requestedAt: row.requested_at ?? undefined,
        startedAt: row.started_at ?? undefined,
        finishedAt: row.finished_at ?? undefined,
        error: row.error ?? undefined,
        metrics: parseJsonObject(row.metrics_json, {}),
        equityCurve: parseJsonArray<{ timestamp: string; value: number }>(
          row.equity_curve_json,
          [],
        ),
        trades: parseJsonArray<Record<string, unknown>>(row.trades_json, []),
        historicalData: parseJsonObject(row.historical_data_json, {}),
        runMetadata: parseJsonObject(row.run_metadata_json, {}),
        runLogs: parseJsonArray<string>(row.run_logs_json, []),
      })),
      comparisonNotes: comparisonNotes.map((row) => ({
        id: row.id,
        strategyId: row.strategy_id,
        primaryRunId: row.primary_run_id,
        baselineRunId: row.baseline_run_id,
        note: row.note,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    };
  },

  upsertStrategy(strategy: LocalStrategyDefinitionRecord): void {
    const db = getDb();
    db.prepare(
      `INSERT INTO strategy_local_definition (id, name, description, stage, tags_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         stage = excluded.stage,
         tags_json = excluded.tags_json,
         updated_at = excluded.updated_at`,
    ).run(
      strategy.id,
      strategy.name,
      strategy.description ?? "",
      strategy.stage,
      JSON.stringify(strategy.tags ?? []),
      strategy.createdAt,
      strategy.updatedAt,
    );
  },

  upsertVersion(version: LocalStrategyVersionRecord): void {
    const db = getDb();
    db.prepare(
      `INSERT INTO strategy_local_version (id, strategy_id, version, script_language, script_source, script_checksum, universe_json, assumptions_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         strategy_id = excluded.strategy_id,
         version = excluded.version,
         script_language = excluded.script_language,
         script_source = excluded.script_source,
         script_checksum = excluded.script_checksum,
         universe_json = excluded.universe_json,
         assumptions_json = excluded.assumptions_json,
         created_at = excluded.created_at`,
    ).run(
      version.id,
      version.strategyId,
      version.version,
      version.scriptLanguage,
      version.scriptSource,
      version.scriptChecksum,
      JSON.stringify(version.universe ?? []),
      JSON.stringify(version.assumptions ?? {}),
      version.createdAt,
    );
  },

  upsertRun(run: LocalStrategyRunRecord): void {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO strategy_local_run (
         run_id, strategy_id, strategy_version, status, execution_mode,
         requested_at, started_at, finished_at, error,
         metrics_json, equity_curve_json, trades_json, historical_data_json, run_metadata_json, run_logs_json,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(run_id) DO UPDATE SET
         strategy_id = excluded.strategy_id,
         strategy_version = excluded.strategy_version,
         status = excluded.status,
         execution_mode = excluded.execution_mode,
         requested_at = excluded.requested_at,
         started_at = excluded.started_at,
         finished_at = excluded.finished_at,
         error = excluded.error,
         metrics_json = excluded.metrics_json,
         equity_curve_json = excluded.equity_curve_json,
         trades_json = excluded.trades_json,
         historical_data_json = excluded.historical_data_json,
         run_metadata_json = excluded.run_metadata_json,
            run_logs_json = excluded.run_logs_json,
         updated_at = excluded.updated_at`,
    ).run(
      run.runId,
      run.strategyId,
      run.strategyVersion,
      run.status,
      run.executionMode,
      run.requestedAt ?? null,
      run.startedAt ?? null,
      run.finishedAt ?? null,
      run.error ?? null,
      JSON.stringify(run.metrics ?? {}),
      JSON.stringify(run.equityCurve ?? []),
      JSON.stringify(run.trades ?? []),
      JSON.stringify(run.historicalData ?? {}),
      JSON.stringify(run.runMetadata ?? {}),
      JSON.stringify(run.runLogs ?? []),
      run.requestedAt ?? now,
      now,
    );
  },

  upsertComparisonNote(note: LocalStrategyComparisonNoteRecord): void {
    const db = getDb();
    db.prepare(
      `INSERT INTO strategy_local_comparison_note (
         id, strategy_id, primary_run_id, baseline_run_id, note, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         strategy_id = excluded.strategy_id,
         primary_run_id = excluded.primary_run_id,
         baseline_run_id = excluded.baseline_run_id,
         note = excluded.note,
         updated_at = excluded.updated_at`,
    ).run(
      note.id,
      note.strategyId,
      note.primaryRunId,
      note.baselineRunId,
      note.note,
      note.createdAt,
      note.updatedAt,
    );
  },

  recoverStuckRuns(): number {
    const db = getDb();
    const now = new Date().toISOString();
    const result = db
      .prepare(
        `UPDATE strategy_local_run
         SET status = 'failed',
             error  = 'Recovered: process restarted while run was in progress',
             finished_at = ?,
             updated_at  = ?
         WHERE status = 'running'`,
      )
      .run(now, now);
    return result.changes;
  },
};

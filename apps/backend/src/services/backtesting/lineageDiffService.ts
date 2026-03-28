// Full lineage diff API for strategy backtesting
//
// Compares two backtest runs across all lineage dimensions:
//   - code/script  (strategy version + checksum)
//   - config       (assumptions)
//   - data         (dataset version + snapshot checksum)
//   - engine       (engine version tag)
// Satisfies checklist item: "Full lineage diff API (code/config/data/engine)"

import type { Pool } from "pg";
import { createLogger } from "../../logger.js";

const logger = createLogger("lineage-diff");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LineageDimension =
  | "code"
  | "config"
  | "data"
  | "engine"
  | "universe";

export type FieldDiff = {
  field: string;
  runA: unknown;
  runB: unknown;
  changed: boolean;
};

export type DimensionDiff = {
  dimension: LineageDimension;
  changed: boolean;
  fields: FieldDiff[];
  summary: string;
};

export type LineageDiffResult = {
  runIdA: string;
  runIdB: string;
  identical: boolean;
  dimensions: DimensionDiff[];
  changedDimensions: LineageDimension[];
  diffSummary: string;
  computedAt: string;
};

// Internal run lineage snapshot fetched from DB
type RunLineageSnapshot = {
  runId: string;
  strategyId: string;
  strategyVersion: string;
  scriptChecksumSha256: string;
  scriptSource: string | null;
  scriptLanguage: string;
  scriptEntrypoint: string;
  universe: string[];
  assumptions: Record<string, unknown>;
  snapshotId: string;
  datasetName: string;
  datasetVersion: string;
  datasetChecksum: string;
  engineVersion: string | null;
  executionMode: string;
};

// ---------------------------------------------------------------------------
// LineageDiffService
// ---------------------------------------------------------------------------

export class LineageDiffService {
  constructor(private readonly pool: Pool) {}

  private resolveTenant(tenantId?: string): string {
    return tenantId && tenantId.trim().length > 0 ? tenantId.trim() : "default";
  }

  private async fetchRunLineage(
    runId: string,
    userId: string,
    tenantId: string,
  ): Promise<RunLineageSnapshot | null> {
    const result = await this.pool.query(
      `SELECT
         r.run_id,
         r.strategy_id,
         r.strategy_version,
         r.snapshot_id,
         r.execution_mode,
         r.metrics->>'engineVersion' AS engine_version,
         sv.script_checksum_sha256,
         sv.script_source,
         sv.script_language,
         sv.script_entrypoint,
         sv.universe,
         ra.assumptions,
         ds.dataset_name,
         ds.dataset_version,
         ds.checksum_sha256 AS dataset_checksum
       FROM strategy_backtest_runs r
       JOIN strategy_versions sv
         ON sv.strategy_id = r.strategy_id
        AND sv.version      = r.strategy_version
       JOIN strategy_run_assumptions ra
         ON ra.run_id = r.run_id
       JOIN strategy_dataset_snapshots ds
         ON ds.snapshot_id = r.snapshot_id
       WHERE r.run_id = $1
         AND r.user_id = $2
         AND r.tenant_id = $3`,
      [runId, userId, tenantId],
    );

    const row = result.rows[0];
    if (!row) return null;

    const parseJsonField = (
      val: unknown,
    ): Record<string, unknown> | string[] => {
      if (typeof val === "object" && val !== null)
        return val as Record<string, unknown>;
      try {
        return JSON.parse(String(val)) as Record<string, unknown>;
      } catch {
        return {};
      }
    };

    const universe = Array.isArray(row.universe)
      ? (row.universe as string[])
      : (() => {
          try {
            return JSON.parse(String(row.universe)) as string[];
          } catch {
            return [];
          }
        })();

    const assumptions = (() => {
      const v = row.assumptions;
      if (typeof v === "object" && v !== null && !Array.isArray(v))
        return v as Record<string, unknown>;
      try {
        return JSON.parse(String(v)) as Record<string, unknown>;
      } catch {
        return {};
      }
    })();

    void parseJsonField;

    return {
      runId: row.run_id,
      strategyId: row.strategy_id,
      strategyVersion: row.strategy_version,
      scriptChecksumSha256: row.script_checksum_sha256,
      scriptSource: row.script_source ?? null,
      scriptLanguage: row.script_language,
      scriptEntrypoint: row.script_entrypoint,
      universe,
      assumptions,
      snapshotId: row.snapshot_id,
      datasetName: row.dataset_name,
      datasetVersion: row.dataset_version,
      datasetChecksum: row.dataset_checksum,
      engineVersion: row.engine_version ?? null,
      executionMode: row.execution_mode,
    };
  }

  // -------------------------------------------------------------------------
  // Core diff
  // -------------------------------------------------------------------------

  async diff(
    runIdA: string,
    runIdB: string,
    userId: string,
    tenantId?: string,
  ): Promise<LineageDiffResult> {
    const tid = this.resolveTenant(tenantId);

    const [snapA, snapB] = await Promise.all([
      this.fetchRunLineage(runIdA, userId, tid),
      this.fetchRunLineage(runIdB, userId, tid),
    ]);

    if (!snapA) {
      throw new Error(`lineage_diff_run_not_found:${runIdA}`);
    }
    if (!snapB) {
      throw new Error(`lineage_diff_run_not_found:${runIdB}`);
    }

    const dimensions: DimensionDiff[] = [
      this.diffCode(snapA, snapB),
      this.diffConfig(snapA, snapB),
      this.diffData(snapA, snapB),
      this.diffEngine(snapA, snapB),
      this.diffUniverse(snapA, snapB),
    ];

    const changedDimensions = dimensions
      .filter((d) => d.changed)
      .map((d) => d.dimension);

    const identical = changedDimensions.length === 0;

    const diffSummary = identical
      ? "Runs are identical across all lineage dimensions."
      : `Differences detected in: ${changedDimensions.join(", ")}.`;

    logger.info("lineage_diff_computed", {
      runIdA,
      runIdB,
      changedDimensions,
      identical,
    });

    return {
      runIdA,
      runIdB,
      identical,
      dimensions,
      changedDimensions,
      diffSummary,
      computedAt: new Date().toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // Per-dimension diff helpers
  // -------------------------------------------------------------------------

  private diffCode(
    a: RunLineageSnapshot,
    b: RunLineageSnapshot,
  ): DimensionDiff {
    const fields: FieldDiff[] = [
      this.fieldDiff("strategyId", a.strategyId, b.strategyId),
      this.fieldDiff("strategyVersion", a.strategyVersion, b.strategyVersion),
      this.fieldDiff(
        "scriptChecksumSha256",
        a.scriptChecksumSha256,
        b.scriptChecksumSha256,
      ),
      this.fieldDiff("scriptLanguage", a.scriptLanguage, b.scriptLanguage),
      this.fieldDiff(
        "scriptEntrypoint",
        a.scriptEntrypoint,
        b.scriptEntrypoint,
      ),
    ];
    const changed = fields.some((f) => f.changed);
    const changedFields = fields.filter((f) => f.changed).map((f) => f.field);
    return {
      dimension: "code",
      changed,
      fields,
      summary: changed
        ? `Code differs in: ${changedFields.join(", ")}`
        : "Code is identical (same strategy version and checksum).",
    };
  }

  private diffConfig(
    a: RunLineageSnapshot,
    b: RunLineageSnapshot,
  ): DimensionDiff {
    const allKeys = new Set([
      ...Object.keys(a.assumptions),
      ...Object.keys(b.assumptions),
    ]);

    const fields: FieldDiff[] = Array.from(allKeys)
      .sort()
      .map((key) =>
        this.fieldDiff(
          `assumptions.${key}`,
          a.assumptions[key],
          b.assumptions[key],
        ),
      );

    const changed = fields.some((f) => f.changed);
    const changedKeys = fields.filter((f) => f.changed).map((f) => f.field);
    return {
      dimension: "config",
      changed,
      fields,
      summary: changed
        ? `Assumptions differ in: ${changedKeys.join(", ")}`
        : "Assumptions are identical.",
    };
  }

  private diffData(
    a: RunLineageSnapshot,
    b: RunLineageSnapshot,
  ): DimensionDiff {
    const fields: FieldDiff[] = [
      this.fieldDiff("snapshotId", a.snapshotId, b.snapshotId),
      this.fieldDiff("datasetName", a.datasetName, b.datasetName),
      this.fieldDiff("datasetVersion", a.datasetVersion, b.datasetVersion),
      this.fieldDiff("datasetChecksum", a.datasetChecksum, b.datasetChecksum),
    ];
    const changed = fields.some((f) => f.changed);
    const changedFields = fields.filter((f) => f.changed).map((f) => f.field);
    return {
      dimension: "data",
      changed,
      fields,
      summary: changed
        ? `Data differs in: ${changedFields.join(", ")}`
        : "Dataset and snapshot are identical.",
    };
  }

  private diffEngine(
    a: RunLineageSnapshot,
    b: RunLineageSnapshot,
  ): DimensionDiff {
    const fields: FieldDiff[] = [
      this.fieldDiff("engineVersion", a.engineVersion, b.engineVersion),
      this.fieldDiff("executionMode", a.executionMode, b.executionMode),
    ];
    const changed = fields.some((f) => f.changed);
    const changedFields = fields.filter((f) => f.changed).map((f) => f.field);
    return {
      dimension: "engine",
      changed,
      fields,
      summary: changed
        ? `Engine differs in: ${changedFields.join(", ")}`
        : "Engine version and execution mode are identical.",
    };
  }

  private diffUniverse(
    a: RunLineageSnapshot,
    b: RunLineageSnapshot,
  ): DimensionDiff {
    const setA = new Set(a.universe.map((s) => s.toUpperCase()).sort());
    const setB = new Set(b.universe.map((s) => s.toUpperCase()).sort());

    const added = Array.from(setB)
      .filter((s) => !setA.has(s))
      .sort();
    const removed = Array.from(setA)
      .filter((s) => !setB.has(s))
      .sort();
    const changed = added.length > 0 || removed.length > 0;

    const fields: FieldDiff[] = [
      this.fieldDiff(
        "universe",
        [...setA].sort().join(","),
        [...setB].sort().join(","),
      ),
    ];

    const parts: string[] = [];
    if (added.length > 0) parts.push(`added: ${added.join(", ")}`);
    if (removed.length > 0) parts.push(`removed: ${removed.join(", ")}`);

    return {
      dimension: "universe",
      changed,
      fields,
      summary: changed
        ? `Universe differs — ${parts.join("; ")}`
        : "Universe is identical.",
    };
  }

  private fieldDiff(field: string, valA: unknown, valB: unknown): FieldDiff {
    const normalize = (v: unknown): string => {
      if (v === null || v === undefined) return "null";
      if (typeof v === "object") return JSON.stringify(v);
      return String(v);
    };
    const changed = normalize(valA) !== normalize(valB);
    return { field, runA: valA, runB: valB, changed };
  }
}

export function createLineageDiffService(pool: Pool): LineageDiffService {
  return new LineageDiffService(pool);
}

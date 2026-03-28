import type { Pool } from "pg";
import { createHash } from "node:crypto";

export type StrategyStage =
  | "candidate"
  | "validation"
  | "production"
  | "retired";

export type StrategyDefinitionRecord = {
  strategyId: string;
  tenantId: string;
  userId: string;
  name: string;
  description: string;
  currentVersion: string;
  stage: StrategyStage;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type StrategyVersionRecord = {
  strategyId: string;
  version: string;
  tenantId: string;
  userId: string;
  scriptLanguage: "javascript" | "typescript";
  scriptEntrypoint: string;
  scriptSource: string;
  scriptChecksum: string;
  universe: string[];
  assumptions: Record<string, unknown>;
  notes: string;
  createdAt: string;
};

export type CreateStrategyInput = {
  strategyId: string;
  tenantId: string;
  userId: string;
  name: string;
  description: string | undefined;
};

export type CreateStrategyVersionInput = {
  strategyId: string;
  version: string;
  tenantId: string;
  userId: string;
  scriptLanguage: "javascript" | "typescript";
  scriptEntrypoint: string;
  scriptSource: string;
  universe: string[];
  assumptions: Record<string, unknown>;
  notes: string | undefined;
};

export class StrategyRepo {
  constructor(private readonly pool: Pool) {}

  private resolveTenant(tenantId?: string): string {
    return tenantId && tenantId.trim().length > 0 ? tenantId.trim() : "default";
  }

  private computeScriptChecksum(source: string): string {
    return createHash("sha256").update(source).digest("hex");
  }

  async createStrategy(
    input: CreateStrategyInput,
  ): Promise<StrategyDefinitionRecord> {
    const tenant = this.resolveTenant(input.tenantId);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `INSERT INTO strategy_definitions
         (strategy_id, tenant_id, user_id, name, description, current_version, stage)
         VALUES ($1, $2, $3, $4, $5, '', 'candidate')`,
        [
          input.strategyId,
          tenant,
          input.userId,
          input.name,
          input.description ?? "",
        ],
      );

      const result = await client.query(
        `SELECT 
          strategy_id, tenant_id, user_id, name, description, current_version, stage, 
          tags, metadata, created_at, updated_at
         FROM strategy_definitions
         WHERE strategy_id = $1 AND tenant_id = $2`,
        [input.strategyId, tenant],
      );

      await client.query("COMMIT");

      const row = result.rows[0];
      return {
        strategyId: row.strategy_id,
        tenantId: row.tenant_id,
        userId: row.user_id,
        name: row.name,
        description: row.description,
        currentVersion: row.current_version,
        stage: row.stage,
        tags: row.tags ?? [],
        metadata: row.metadata ?? {},
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getStrategy(
    strategyId: string,
    userId: string,
    tenantId?: string,
  ): Promise<StrategyDefinitionRecord | null> {
    const tenant = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `SELECT 
        strategy_id, tenant_id, user_id, name, description, current_version, stage, 
        tags, metadata, created_at, updated_at
       FROM strategy_definitions
       WHERE strategy_id = $1 AND user_id = $2 AND tenant_id = $3`,
      [strategyId, userId, tenant],
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      strategyId: row.strategy_id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      name: row.name,
      description: row.description,
      currentVersion: row.current_version,
      stage: row.stage,
      tags: row.tags ?? [],
      metadata: row.metadata ?? {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async listStrategies(
    userId: string,
    tenantId?: string,
    limit = 100,
  ): Promise<StrategyDefinitionRecord[]> {
    const tenant = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `SELECT 
        strategy_id, tenant_id, user_id, name, description, current_version, stage, 
        tags, metadata, created_at, updated_at
       FROM strategy_definitions
       WHERE user_id = $1 AND tenant_id = $2
       ORDER BY updated_at DESC
       LIMIT $3`,
      [userId, tenant, Math.max(1, Math.min(limit, 500))],
    );

    return result.rows.map((row) => ({
      strategyId: row.strategy_id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      name: row.name,
      description: row.description,
      currentVersion: row.current_version,
      stage: row.stage,
      tags: row.tags ?? [],
      metadata: row.metadata ?? {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async updateStrategy(
    strategyId: string,
    userId: string,
    updates: Partial<{
      name: string;
      description: string;
      stage: StrategyStage;
      tags: string[];
      metadata: Record<string, unknown>;
    }>,
    tenantId?: string,
  ): Promise<StrategyDefinitionRecord | null> {
    const tenant = this.resolveTenant(tenantId);
    const sets: string[] = [];
    const params: (string | string[] | Record<string, unknown>)[] = [
      strategyId,
      userId,
      tenant,
    ];
    let paramIdx = 4;

    if (updates.name !== undefined) {
      sets.push(`name = $${paramIdx}`);
      params.push(updates.name);
      paramIdx++;
    }
    if (updates.description !== undefined) {
      sets.push(`description = $${paramIdx}`);
      params.push(updates.description);
      paramIdx++;
    }
    if (updates.stage !== undefined) {
      sets.push(`stage = $${paramIdx}`);
      params.push(updates.stage);
      paramIdx++;
    }
    if (updates.tags !== undefined) {
      sets.push(`tags = $${paramIdx}`);
      params.push(updates.tags);
      paramIdx++;
    }
    if (updates.metadata !== undefined) {
      sets.push(`metadata = $${paramIdx}`);
      params.push(updates.metadata);
      paramIdx++;
    }

    if (sets.length === 0) {
      return this.getStrategy(strategyId, userId, tenantId);
    }

    sets.push("updated_at = NOW()");

    const result = await this.pool.query(
      `UPDATE strategy_definitions
       SET ${sets.join(", ")}
       WHERE strategy_id = $1 AND user_id = $2 AND tenant_id = $3
       RETURNING strategy_id, tenant_id, user_id, name, description, current_version, 
                 stage, tags, metadata, created_at, updated_at`,
      params,
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      strategyId: row.strategy_id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      name: row.name,
      description: row.description,
      currentVersion: row.current_version,
      stage: row.stage,
      tags: row.tags ?? [],
      metadata: row.metadata ?? {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async createVersion(
    input: CreateStrategyVersionInput,
  ): Promise<StrategyVersionRecord> {
    const tenant = this.resolveTenant(input.tenantId);
    const checksum = this.computeScriptChecksum(input.scriptSource);
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      // Insert version record
      await client.query(
        `INSERT INTO strategy_versions
         (strategy_id, version, tenant_id, user_id, script_language, script_entrypoint, 
          script_source, script_checksum_sha256, universe, assumptions, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          input.strategyId,
          input.version,
          tenant,
          input.userId,
          input.scriptLanguage,
          input.scriptEntrypoint,
          input.scriptSource,
          checksum,
          JSON.stringify(input.universe),
          JSON.stringify(input.assumptions),
          input.notes ?? "",
        ],
      );

      // Update strategy current_version
      await client.query(
        `UPDATE strategy_definitions
         SET current_version = $2, updated_at = NOW()
         WHERE strategy_id = $1 AND tenant_id = $3`,
        [input.strategyId, input.version, tenant],
      );

      // Fetch the created version
      const result = await client.query(
        `SELECT strategy_id, version, tenant_id, user_id, script_language, script_entrypoint,
                script_source, script_checksum_sha256, universe, assumptions, notes, created_at
         FROM strategy_versions
         WHERE strategy_id = $1 AND version = $2`,
        [input.strategyId, input.version],
      );

      await client.query("COMMIT");

      const row = result.rows[0];
      return {
        strategyId: row.strategy_id,
        version: row.version,
        tenantId: row.tenant_id,
        userId: row.user_id,
        scriptLanguage: row.script_language,
        scriptEntrypoint: row.script_entrypoint,
        scriptSource: row.script_source,
        scriptChecksum: row.script_checksum_sha256,
        universe: row.universe ?? [],
        assumptions: row.assumptions ?? {},
        notes: row.notes ?? "",
        createdAt: row.created_at,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getLatestVersion(
    strategyId: string,
    userId: string,
    tenantId?: string,
  ): Promise<StrategyVersionRecord | null> {
    const tenant = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `SELECT strategy_id, version, tenant_id, user_id, script_language, script_entrypoint,
              script_source, script_checksum_sha256, universe, assumptions, notes, created_at
       FROM strategy_versions
       WHERE strategy_id = $1 AND user_id = $2 AND tenant_id = $3
       ORDER BY created_at DESC
       LIMIT 1`,
      [strategyId, userId, tenant],
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      strategyId: row.strategy_id,
      version: row.version,
      tenantId: row.tenant_id,
      userId: row.user_id,
      scriptLanguage: row.script_language,
      scriptEntrypoint: row.script_entrypoint,
      scriptSource: row.script_source,
      scriptChecksum: row.script_checksum_sha256,
      universe: row.universe ?? [],
      assumptions: row.assumptions ?? {},
      notes: row.notes ?? "",
      createdAt: row.created_at,
    };
  }

  async getVersion(
    strategyId: string,
    version: string,
    userId: string,
    tenantId?: string,
  ): Promise<StrategyVersionRecord | null> {
    const tenant = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `SELECT strategy_id, version, tenant_id, user_id, script_language, script_entrypoint,
              script_source, script_checksum_sha256, universe, assumptions, notes, created_at
       FROM strategy_versions
       WHERE strategy_id = $1 AND version = $2 AND user_id = $3 AND tenant_id = $4`,
      [strategyId, version, userId, tenant],
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      strategyId: row.strategy_id,
      version: row.version,
      tenantId: row.tenant_id,
      userId: row.user_id,
      scriptLanguage: row.script_language,
      scriptEntrypoint: row.script_entrypoint,
      scriptSource: row.script_source,
      scriptChecksum: row.script_checksum_sha256,
      universe: row.universe ?? [],
      assumptions: row.assumptions ?? {},
      notes: row.notes ?? "",
      createdAt: row.created_at,
    };
  }

  async listVersions(
    strategyId: string,
    userId: string,
    tenantId?: string,
    limit = 100,
  ): Promise<StrategyVersionRecord[]> {
    const tenant = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `SELECT strategy_id, version, tenant_id, user_id, script_language, script_entrypoint,
              script_source, script_checksum_sha256, universe, assumptions, notes, created_at
       FROM strategy_versions
       WHERE strategy_id = $1 AND user_id = $2 AND tenant_id = $3
       ORDER BY created_at DESC
       LIMIT $4`,
      [strategyId, userId, tenant, Math.max(1, Math.min(limit, 500))],
    );

    return result.rows.map((row) => ({
      strategyId: row.strategy_id,
      version: row.version,
      tenantId: row.tenant_id,
      userId: row.user_id,
      scriptLanguage: row.script_language,
      scriptEntrypoint: row.script_entrypoint,
      scriptSource: row.script_source,
      scriptChecksum: row.script_checksum_sha256,
      universe: row.universe ?? [],
      assumptions: row.assumptions ?? {},
      notes: row.notes ?? "",
      createdAt: row.created_at,
    }));
  }
}

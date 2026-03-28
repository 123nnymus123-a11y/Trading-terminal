import type { Pool } from "pg";

export type AiStewardFinding = {
  id: string;
  userId: string;
  createdAt: string;
  module: string;
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  recommendation?: string;
  metadata: Record<string, unknown>;
  dismissed: boolean;
  dismissedAt?: string;
};

export type AiStewardTask = {
  id: string;
  userId: string;
  findingId?: string;
  createdAt: string;
  taskType: string;
  title: string;
  description: string;
  actionData: Record<string, unknown>;
  status: "pending" | "applied" | "rejected" | "failed";
  appliedAt?: string;
  appliedResult?: Record<string, unknown>;
};

export type AiStewardConfig = {
  userId: string;
  enabled: boolean;
  autoApply: boolean;
  modulesEnabled: Record<string, boolean>;
  checkIntervalSec: number;
  notificationPreferences: Record<string, unknown>;
  updatedAt: string;
};

export type AiStewardModuleHealth = {
  module: string;
  lastRunAt?: string;
  lastStatus?: string;
  errorCount: number;
  successCount: number;
  updatedAt: string;
};

export class AiStewardRepo {
  constructor(private pool: Pool) {}

  private resolveTenant(tenantId?: string): string {
    return tenantId && tenantId.trim().length > 0 ? tenantId.trim() : "default";
  }

  async storeFinding(
    userId: string,
    module: string,
    severity: "info" | "warning" | "critical",
    title: string,
    description: string,
    recommendation?: string,
    metadata?: Record<string, unknown>,
    tenantId?: string,
  ): Promise<AiStewardFinding> {
    const tenant = this.resolveTenant(tenantId);
    const id = `${userId}-${module}-${Date.now()}`;
    const result = await this.pool.query(
      `INSERT INTO ai_steward_findings 
       (id, tenant_id, user_id, module, severity, title, description, recommendation, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, user_id, created_at, module, severity, title, description, recommendation, metadata, dismissed, dismissed_at`,
      [
        id,
        tenant,
        userId,
        module,
        severity,
        title,
        description,
        recommendation,
        JSON.stringify(metadata || {}),
      ],
    );

    const row = result.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      createdAt: row.created_at,
      module: row.module,
      severity: row.severity,
      title: row.title,
      description: row.description,
      recommendation: row.recommendation,
      metadata: row.metadata || {},
      dismissed: row.dismissed,
      dismissedAt: row.dismissed_at,
    };
  }

  async listFindings(
    userId: string,
    module?: string,
    limit = 50,
    tenantId?: string,
  ): Promise<AiStewardFinding[]> {
    const tenant = this.resolveTenant(tenantId);
    const query = `SELECT id, user_id, created_at, module, severity, title, description, recommendation, metadata, dismissed, dismissed_at
     FROM ai_steward_findings 
     WHERE user_id = $1 AND tenant_id = $2 AND dismissed = false
     ${module ? "AND module = $3" : ""}
     ORDER BY severity DESC, created_at DESC LIMIT ${module ? "$4" : "$3"}`;

    const params = module
      ? [userId, tenant, module, limit]
      : [userId, tenant, limit];
    const result = await this.pool.query(query, params);

    return result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      createdAt: row.created_at,
      module: row.module,
      severity: row.severity,
      title: row.title,
      description: row.description,
      recommendation: row.recommendation,
      metadata: row.metadata || {},
      dismissed: row.dismissed,
      dismissedAt: row.dismissed_at,
    }));
  }

  async dismissFinding(
    userId: string,
    findingId: string,
    tenantId?: string,
  ): Promise<boolean> {
    const tenant = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `UPDATE ai_steward_findings SET dismissed = true, dismissed_at = NOW() 
       WHERE id = $1 AND user_id = $2 AND tenant_id = $3`,
      [findingId, userId, tenant],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async createTask(
    userId: string,
    taskType: string,
    title: string,
    description: string,
    actionData: Record<string, unknown>,
    findingId?: string,
    tenantId?: string,
  ): Promise<AiStewardTask> {
    const tenant = this.resolveTenant(tenantId);
    const id = `${userId}-task-${Date.now()}`;
    const result = await this.pool.query(
      `INSERT INTO ai_steward_tasks 
       (id, tenant_id, user_id, task_type, title, description, action_data, finding_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, user_id, finding_id, created_at, task_type, title, description, action_data, status, applied_at, applied_result`,
      [
        id,
        tenant,
        userId,
        taskType,
        title,
        description,
        JSON.stringify(actionData),
        findingId,
      ],
    );

    const row = result.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      findingId: row.finding_id,
      createdAt: row.created_at,
      taskType: row.task_type,
      title: row.title,
      description: row.description,
      actionData: row.action_data || {},
      status: row.status,
      appliedAt: row.applied_at,
      appliedResult: row.applied_result,
    };
  }

  async listPendingTasks(
    userId: string,
    limit = 20,
    tenantId?: string,
  ): Promise<AiStewardTask[]> {
    const tenant = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `SELECT id, user_id, finding_id, created_at, task_type, title, description, action_data, status, applied_at, applied_result
       FROM ai_steward_tasks WHERE user_id = $1 AND tenant_id = $2 AND status = 'pending'
       ORDER BY created_at DESC LIMIT $3`,
      [userId, tenant, limit],
    );

    return result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      findingId: row.finding_id,
      createdAt: row.created_at,
      taskType: row.task_type,
      title: row.title,
      description: row.description,
      actionData: row.action_data || {},
      status: row.status,
      appliedAt: row.applied_at,
      appliedResult: row.applied_result,
    }));
  }

  async applyTask(
    userId: string,
    taskId: string,
    result: Record<string, unknown>,
    tenantId?: string,
  ): Promise<boolean> {
    const tenant = this.resolveTenant(tenantId);
    const updateResult = await this.pool.query(
      `UPDATE ai_steward_tasks SET status = 'applied', applied_at = NOW(), applied_result = $3
       WHERE id = $1 AND user_id = $2 AND tenant_id = $4`,
      [taskId, userId, JSON.stringify(result), tenant],
    );
    return (updateResult.rowCount ?? 0) > 0;
  }

  async getConfig(
    userId: string,
    tenantId?: string,
  ): Promise<AiStewardConfig | null> {
    const tenant = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `SELECT user_id, enabled, auto_apply, modules_enabled, check_interval_sec, notification_preferences, updated_at
       FROM ai_steward_config WHERE user_id = $1 AND tenant_id = $2`,
      [userId, tenant],
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      userId: row.user_id,
      enabled: row.enabled,
      autoApply: row.auto_apply,
      modulesEnabled: row.modules_enabled || {},
      checkIntervalSec: row.check_interval_sec,
      notificationPreferences: row.notification_preferences || {},
      updatedAt: row.updated_at,
    };
  }

  async setConfig(
    userId: string,
    config: Partial<AiStewardConfig>,
    tenantId?: string,
  ): Promise<void> {
    const tenant = this.resolveTenant(tenantId);
    await this.pool.query(
      `INSERT INTO ai_steward_config 
       (tenant_id, user_id, enabled, auto_apply, modules_enabled, check_interval_sec, notification_preferences)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (tenant_id, user_id) DO UPDATE SET
         enabled = COALESCE($3, ai_steward_config.enabled),
         auto_apply = COALESCE($4, ai_steward_config.auto_apply),
         modules_enabled = COALESCE($5, ai_steward_config.modules_enabled),
         check_interval_sec = COALESCE($6, ai_steward_config.check_interval_sec),
         notification_preferences = COALESCE($7, ai_steward_config.notification_preferences)`,
      [
        tenant,
        userId,
        config.enabled,
        config.autoApply,
        config.modulesEnabled ? JSON.stringify(config.modulesEnabled) : null,
        config.checkIntervalSec,
        config.notificationPreferences
          ? JSON.stringify(config.notificationPreferences)
          : null,
      ],
    );
  }

  async upsertModuleHealth(
    userId: string,
    module: string,
    status: string,
    tenantId?: string,
  ): Promise<void> {
    const tenant = this.resolveTenant(tenantId);
    const isHealthy = status === "ok";
    await this.pool.query(
      `INSERT INTO ai_steward_health
       (tenant_id, user_id, module, last_run_at, last_status, error_count, success_count, updated_at)
       VALUES ($1, $2, $3, NOW(), $4, $5, $6, NOW())
       ON CONFLICT (tenant_id, user_id, module) DO UPDATE SET
         last_run_at = NOW(),
         last_status = EXCLUDED.last_status,
         error_count = ai_steward_health.error_count + EXCLUDED.error_count,
         success_count = ai_steward_health.success_count + EXCLUDED.success_count,
         updated_at = NOW()`,
      [tenant, userId, module, status, isHealthy ? 0 : 1, isHealthy ? 1 : 0],
    );
  }

  async listModuleHealth(
    userId: string,
    tenantId?: string,
  ): Promise<AiStewardModuleHealth[]> {
    const tenant = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `SELECT module, last_run_at, last_status, error_count, success_count, updated_at
       FROM ai_steward_health
       WHERE user_id = $1 AND tenant_id = $2`,
      [userId, tenant],
    );

    return result.rows.map((row) => ({
      module: row.module,
      lastRunAt: row.last_run_at ?? undefined,
      lastStatus: row.last_status ?? undefined,
      errorCount: Number(row.error_count ?? 0),
      successCount: Number(row.success_count ?? 0),
      updatedAt: row.updated_at,
    }));
  }

  async listRecentTasks(
    userId: string,
    limit = 50,
    tenantId?: string,
  ): Promise<AiStewardTask[]> {
    const tenant = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `SELECT id, user_id, finding_id, created_at, task_type, title, description, action_data, status, applied_at, applied_result
       FROM ai_steward_tasks
       WHERE user_id = $1 AND tenant_id = $2
       ORDER BY created_at DESC LIMIT $3`,
      [userId, tenant, limit],
    );

    return result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      findingId: row.finding_id,
      createdAt: row.created_at,
      taskType: row.task_type,
      title: row.title,
      description: row.description,
      actionData: row.action_data || {},
      status: row.status,
      appliedAt: row.applied_at,
      appliedResult: row.applied_result,
    }));
  }
}

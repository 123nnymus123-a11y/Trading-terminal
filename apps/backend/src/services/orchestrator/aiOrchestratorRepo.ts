import type { Pool } from 'pg';

export type AiInteraction = {
  id: number;
  userId: string;
  timestamp: string;
  eventType: string;
  symbol?: string;
  metadata: Record<string, unknown>;
  sessionId?: string;
  source?: string;
};

export type AiPrediction = {
  id: number;
  userId: string;
  createdAt: string;
  predictionType: string;
  symbol?: string;
  confidence: number;
  data: Record<string, unknown>;
  expiresAt?: string;
  validated?: boolean;
};

export type AiLearningStats = {
  userId: string;
  interactionsCount: number;
  predictionsCount: number;
  accuracyScore: number;
  lastTrainedAt?: string;
  modelVersion?: string;
  updatedAt: string;
};

export class AiOrchestratorRepo {
  constructor(private pool: Pool) {}

  private resolveTenant(tenantId?: string): string {
    return tenantId && tenantId.trim().length > 0 ? tenantId.trim() : 'default';
  }

  async trackInteraction(
    userId: string,
    eventType: string,
    symbol?: string,
    metadata?: Record<string, unknown>,
    sessionId?: string,
    tenantId?: string,
  ): Promise<AiInteraction> {
    const tenant = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `INSERT INTO ai_interactions (tenant_id, user_id, event_type, symbol, metadata, session_id, source)
       VALUES ($1, $2, $3, $4, $5, $6, 'backend')
       RETURNING id, user_id, timestamp, event_type, symbol, metadata, session_id, source`,
      [tenant, userId, eventType, symbol, JSON.stringify(metadata || {}), sessionId],
    );

    const row = result.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      timestamp: row.timestamp,
      eventType: row.event_type,
      symbol: row.symbol,
      metadata: row.metadata || {},
      sessionId: row.session_id,
      source: row.source,
    };
  }

  async listRecentInteractions(userId: string, limit = 100, tenantId?: string): Promise<AiInteraction[]> {
    const tenant = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `SELECT id, user_id, timestamp, event_type, symbol, metadata, session_id, source
       FROM ai_interactions WHERE user_id = $1 AND tenant_id = $2
       ORDER BY timestamp DESC LIMIT $3`,
      [userId, tenant, limit],
    );

    return result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      timestamp: row.timestamp,
      eventType: row.event_type,
      symbol: row.symbol,
      metadata: row.metadata || {},
      sessionId: row.session_id,
      source: row.source,
    }));
  }

  async storePrediction(
    userId: string,
    predictionType: string,
    symbol: string | undefined,
    confidence: number,
    data: Record<string, unknown>,
    expiresAtSeconds?: number,
    tenantId?: string,
  ): Promise<AiPrediction> {
    const tenant = this.resolveTenant(tenantId);
    const expiresAt = expiresAtSeconds
      ? new Date(Date.now() + expiresAtSeconds * 1000).toISOString()
      : null;

    const result = await this.pool.query(
      `INSERT INTO ai_predictions (tenant_id, user_id, prediction_type, symbol, confidence, data, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, user_id, created_at, prediction_type, symbol, confidence, data, expires_at, validated`,
      [tenant, userId, predictionType, symbol, confidence, JSON.stringify(data), expiresAt],
    );

    const row = result.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      createdAt: row.created_at,
      predictionType: row.prediction_type,
      symbol: row.symbol,
      confidence: row.confidence,
      data: row.data || {},
      expiresAt: row.expires_at,
      validated: row.validated,
    };
  }

  async listActivePredictions(
    userId: string,
    predictionType?: string,
    tenantId?: string,
  ): Promise<AiPrediction[]> {
    const tenant = this.resolveTenant(tenantId);
    const query = `SELECT id, user_id, created_at, prediction_type, symbol, confidence, data, expires_at, validated
     FROM ai_predictions 
     WHERE user_id = $1 AND tenant_id = $2 AND (expires_at IS NULL OR expires_at > NOW())
     ${predictionType ? 'AND prediction_type = $3' : ''}
     ORDER BY confidence DESC`;

    const params = predictionType ? [userId, tenant, predictionType] : [userId, tenant];
    const result = await this.pool.query(query, params);

    return result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      createdAt: row.created_at,
      predictionType: row.prediction_type,
      symbol: row.symbol,
      confidence: row.confidence,
      data: row.data || {},
      expiresAt: row.expires_at,
      validated: row.validated,
    }));
  }

  async getOrCreateLearningStats(userId: string, tenantId?: string): Promise<AiLearningStats> {
    const tenant = this.resolveTenant(tenantId);
    const existing = await this.pool.query(
      `SELECT user_id, interactions_count, predictions_count, accuracy_score, last_trained_at, model_version, updated_at
       FROM ai_learning_stats WHERE user_id = $1 AND tenant_id = $2`,
      [userId, tenant],
    );

    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      return {
        userId: row.user_id,
        interactionsCount: row.interactions_count,
        predictionsCount: row.predictions_count,
        accuracyScore: row.accuracy_score,
        lastTrainedAt: row.last_trained_at,
        modelVersion: row.model_version,
        updatedAt: row.updated_at,
      };
    }

    await this.pool.query(`INSERT INTO ai_learning_stats (tenant_id, user_id) VALUES ($1, $2)`, [tenant, userId]);

    return {
      userId,
      interactionsCount: 0,
      predictionsCount: 0,
      accuracyScore: 0,
      updatedAt: new Date().toISOString(),
    };
  }

  async updateLearningStats(
    userId: string,
    updates: Partial<{
      interactionsCount: number;
      predictionsCount: number;
      accuracyScore: number;
    }>,
    tenantId?: string,
  ): Promise<void> {
    const tenant = this.resolveTenant(tenantId);
    const setClauses = [];
    const params: unknown[] = [userId, tenant];
    let paramIndex = 3;

    if (updates.interactionsCount !== undefined) {
      setClauses.push(`interactions_count = $${paramIndex}`);
      params.push(updates.interactionsCount);
      paramIndex++;
    }
    if (updates.predictionsCount !== undefined) {
      setClauses.push(`predictions_count = $${paramIndex}`);
      params.push(updates.predictionsCount);
      paramIndex++;
    }
    if (updates.accuracyScore !== undefined) {
      setClauses.push(`accuracy_score = $${paramIndex}`);
      params.push(updates.accuracyScore);
      paramIndex++;
    }

    if (setClauses.length === 0) return;

    setClauses.push(`updated_at = NOW()`);

    await this.pool.query(
      `UPDATE ai_learning_stats SET ${setClauses.join(', ')} WHERE user_id = $1 AND tenant_id = $2`,
      params,
    );
  }
}

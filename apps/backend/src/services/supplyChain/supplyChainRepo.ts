import type { Pool } from 'pg';

export type SupplyChainCache = {
  cacheKey: string;
  ticker: string;
  createdAt: string;
  expiresAt?: string;
  data: Record<string, unknown>;
};

export type SupplyChainInsight = {
  id: number;
  userId: string;
  ticker: string;
  createdAt: string;
  insightType: string;
  content: string;
  confidence: number;
  aiModel: string;
};

export class SupplyChainRepo {
  constructor(private pool: Pool) {}

  private resolveTenant(tenantId?: string): string {
    return tenantId && tenantId.trim().length > 0 ? tenantId.trim() : 'default';
  }

  async cacheSupplyChainData(
    userId: string,
    cacheKey: string,
    ticker: string,
    data: Record<string, unknown>,
    aiModel: string,
    expiresAtSeconds: number = 86400,
    tenantId?: string,
  ): Promise<SupplyChainCache> {
    const tenant = this.resolveTenant(tenantId);
    const expiresAt = new Date(Date.now() + expiresAtSeconds * 1000).toISOString();

    await this.pool.query(
      `INSERT INTO supply_chain_cache (cache_key, tenant_id, user_id, ticker, data, ai_model, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (cache_key) DO UPDATE SET data = $5, expires_at = $7`,
      [cacheKey, tenant, userId, ticker, JSON.stringify(data), aiModel, expiresAt],
    );

    return {
      cacheKey,
      ticker,
      createdAt: new Date().toISOString(),
      expiresAt,
      data,
    };
  }

  async getSupplyChainCache(cacheKey: string, tenantId?: string): Promise<SupplyChainCache | null> {
    const tenant = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `SELECT cache_key, ticker, created_at, expires_at, data, ai_model
       FROM supply_chain_cache WHERE cache_key = $1 AND tenant_id = $2 AND (expires_at IS NULL OR expires_at > NOW())`,
      [cacheKey, tenant],
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      cacheKey: row.cache_key,
      ticker: row.ticker,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      data: row.data || {},
    };
  }

  async storeInsight(
    userId: string,
    ticker: string,
    insightType: string,
    content: string,
    confidence: number,
    aiModel: string,
    tenantId?: string,
  ): Promise<SupplyChainInsight> {
    const tenant = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `INSERT INTO supply_chain_insights (tenant_id, user_id, ticker, insight_type, content, confidence, ai_model)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, user_id, ticker, created_at, insight_type, content, confidence, ai_model`,
      [tenant, userId, ticker, insightType, content, confidence, aiModel],
    );

    const row = result.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      ticker: row.ticker,
      createdAt: row.created_at,
      insightType: row.insight_type,
      content: row.content,
      confidence: row.confidence,
      aiModel: row.ai_model,
    };
  }

  async listInsights(
    userId: string,
    ticker: string,
    limit = 20,
    tenantId?: string,
  ): Promise<SupplyChainInsight[]> {
    const tenant = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `SELECT id, user_id, ticker, created_at, insight_type, content, confidence, ai_model
       FROM supply_chain_insights WHERE user_id = $1 AND ticker = $2 AND tenant_id = $3
       ORDER BY created_at DESC LIMIT $4`,
      [userId, ticker, tenant, limit],
    );

    return result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      ticker: row.ticker,
      createdAt: row.created_at,
      insightType: row.insight_type,
      content: row.content,
      confidence: row.confidence,
      aiModel: row.ai_model,
    }));
  }

  async clearExpiredCache(tenantId?: string): Promise<number> {
    const tenant = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `DELETE FROM supply_chain_cache WHERE tenant_id = $1 AND expires_at IS NOT NULL AND expires_at < NOW()`,
      [tenant],
    );
    return result.rowCount ?? 0;
  }
}

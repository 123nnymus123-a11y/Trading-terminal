import type { Pool } from 'pg';

export type AiCongressAnalysis = {
  id: string;
  userId: string;
  tradeId: string;
  createdAt: string;
  category: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  sentimentScore: number;
  reasoning: string;
  confidence: number;
  aiModel: string;
};

export type AiCongressWatchlist = {
  id: number;
  userId: string;
  ticker: string;
  reason: string;
  priority: number;
  tradeCount: number;
  totalVolume?: string;
  latestTradeAt?: string;
  createdAt: string;
  dismissed: boolean;
};

export class AiCongressRepo {
  constructor(private pool: Pool) {}

  private resolveTenant(tenantId?: string): string {
    return tenantId && tenantId.trim().length > 0 ? tenantId.trim() : 'default';
  }

  async analyzeAndStore(
    userId: string,
    tradeId: string,
    analysis: {
      category: string;
      sentiment: 'bullish' | 'bearish' | 'neutral';
      sentimentScore: number;
      reasoning: string;
      confidence: number;
      aiModel: string;
    },
    tenantId?: string,
  ): Promise<AiCongressAnalysis> {
    const tenant = this.resolveTenant(tenantId);
    const id = `${userId}-${tradeId}-${Date.now()}`;
    const result = await this.pool.query(
      `INSERT INTO ai_congress_analysis 
       (id, tenant_id, user_id, trade_id, category, sentiment, sentiment_score, reasoning, confidence, ai_model)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, user_id, trade_id, created_at, category, sentiment, sentiment_score, reasoning, confidence, ai_model`,
      [
        id,
        tenant,
        userId,
        tradeId,
        analysis.category,
        analysis.sentiment,
        analysis.sentimentScore,
        analysis.reasoning,
        analysis.confidence,
        analysis.aiModel,
      ],
    );

    const row = result.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      tradeId: row.trade_id,
      createdAt: row.created_at,
      category: row.category,
      sentiment: row.sentiment,
      sentimentScore: row.sentiment_score,
      reasoning: row.reasoning,
      confidence: row.confidence,
      aiModel: row.ai_model,
    };
  }

  async getAnalysis(userId: string, tradeId: string, tenantId?: string): Promise<AiCongressAnalysis | null> {
    const tenant = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `SELECT id, user_id, trade_id, created_at, category, sentiment, sentiment_score, reasoning, confidence, ai_model
       FROM ai_congress_analysis WHERE user_id = $1 AND trade_id = $2 AND tenant_id = $3`,
      [userId, tradeId, tenant],
    );

    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      tradeId: row.trade_id,
      createdAt: row.created_at,
      category: row.category,
      sentiment: row.sentiment,
      sentimentScore: row.sentiment_score,
      reasoning: row.reasoning,
      confidence: row.confidence,
      aiModel: row.ai_model,
    };
  }

  async addToWatchlist(
    userId: string,
    ticker: string,
    reason: string,
    priority: number,
    tenantId?: string,
  ): Promise<AiCongressWatchlist> {
    const tenant = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `INSERT INTO ai_congress_watchlist (tenant_id, user_id, ticker, reason, priority)
       VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (tenant_id, user_id, ticker) DO UPDATE 
       SET reason = $4, priority = $5, dismissed = false
       RETURNING id, user_id, ticker, reason, priority, trade_count, total_volume, latest_trade_at, created_at, dismissed`,
      [tenant, userId, ticker, reason, priority],
    );

    const row = result.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      ticker: row.ticker,
      reason: row.reason,
      priority: row.priority,
      tradeCount: row.trade_count,
      totalVolume: row.total_volume,
      latestTradeAt: row.latest_trade_at,
      createdAt: row.created_at,
      dismissed: row.dismissed,
    };
  }

  async listWatchlist(userId: string, tenantId?: string): Promise<AiCongressWatchlist[]> {
    const tenant = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `SELECT id, user_id, ticker, reason, priority, trade_count, total_volume, latest_trade_at, created_at, dismissed
       FROM ai_congress_watchlist WHERE user_id = $1 AND tenant_id = $2 AND dismissed = false
       ORDER BY priority DESC, created_at DESC`,
      [userId, tenant],
    );

    return result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      ticker: row.ticker,
      reason: row.reason,
      priority: row.priority,
      tradeCount: row.trade_count,
      totalVolume: row.total_volume,
      latestTradeAt: row.latest_trade_at,
      createdAt: row.created_at,
      dismissed: row.dismissed,
    }));
  }

  async dismissFromWatchlist(userId: string, watchlistId: number, tenantId?: string): Promise<boolean> {
    const tenant = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `UPDATE ai_congress_watchlist SET dismissed = true WHERE id = $1 AND user_id = $2 AND tenant_id = $3`,
      [watchlistId, userId, tenant],
    );
    return (result.rowCount ?? 0) > 0;
  }
}

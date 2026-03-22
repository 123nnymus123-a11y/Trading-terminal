import type { Pool } from 'pg';
import { createLogger } from '../../logger.js';

const logger = createLogger('ai-research-repo');

export type AiBrief = {
  id: string;
  userId: string;
  createdAt: string;
  runId: string;
  headline: string;
  summaryBullets: string[];
  tickers: string[];
  whyItMatters: string[];
  whatToWatch: string[];
  impactScore: number;
  confidence: number;
  sources: Array<{ title: string; url: string; source: string; publishedAt: string }>;
  dismissed: boolean;
  dismissedAt?: string;
};

export type AiResearchRun = {
  id: string;
  userId: string;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  error?: string;
  stats?: Record<string, unknown>;
  triggerReason: string;
};

export type AiResearchConfig = {
  userId: string;
  enabled: boolean;
  model: string;
  pollIntervalSec: number;
  rssFeeds: string[];
  secForms: string[];
  watchlistTickers: string[];
  watchlistKeywords: string[];
  useX: boolean;
  xApiKey?: string;
  focusPrompt?: string;
  updatedAt: string;
};

export class AiResearchRepo {
  constructor(private pool: Pool) {}

  private resolveTenant(tenantId?: string): string {
    return tenantId && tenantId.trim().length > 0 ? tenantId.trim() : 'default';
  }

  async getConfig(userId: string, tenantId?: string): Promise<AiResearchConfig | null> {
    const tenant = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `SELECT user_id, enabled, model, poll_interval_sec, rss_feeds, sec_forms, 
              watchlist_tickers, watchlist_keywords, use_x, x_api_key, focus_prompt, updated_at
       FROM ai_research_config WHERE user_id = $1 AND tenant_id = $2`,
      [userId, tenant],
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      userId: row.user_id,
      enabled: row.enabled,
      model: row.model,
      pollIntervalSec: row.poll_interval_sec,
      rssFeeds: row.rss_feeds || [],
      secForms: row.sec_forms || [],
      watchlistTickers: row.watchlist_tickers || [],
      watchlistKeywords: row.watchlist_keywords || [],
      useX: row.use_x,
      xApiKey: row.x_api_key,
      focusPrompt: row.focus_prompt,
      updatedAt: row.updated_at,
    };
  }

  async setConfig(
    userId: string,
    config: Partial<AiResearchConfig>,
    tenantId?: string,
  ): Promise<void> {
    const tenant = this.resolveTenant(tenantId);
    await this.pool.query(
      `INSERT INTO ai_research_config 
       (tenant_id, user_id, enabled, model, poll_interval_sec, rss_feeds, sec_forms, 
        watchlist_tickers, watchlist_keywords, use_x, x_api_key, focus_prompt, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
      ON CONFLICT (tenant_id, user_id) DO UPDATE SET
         enabled = COALESCE($3, ai_research_config.enabled),
         model = COALESCE($4, ai_research_config.model),
         poll_interval_sec = COALESCE($5, ai_research_config.poll_interval_sec),
         rss_feeds = COALESCE($6, ai_research_config.rss_feeds),
         sec_forms = COALESCE($7, ai_research_config.sec_forms),
         watchlist_tickers = COALESCE($8, ai_research_config.watchlist_tickers),
         watchlist_keywords = COALESCE($9, ai_research_config.watchlist_keywords),
         use_x = COALESCE($10, ai_research_config.use_x),
         x_api_key = COALESCE($11, ai_research_config.x_api_key),
         focus_prompt = COALESCE($12, ai_research_config.focus_prompt),
         updated_at = NOW()`,
      [
        tenant,
        userId,
        config.enabled,
        config.model,
        config.pollIntervalSec,
        config.rssFeeds ? JSON.stringify(config.rssFeeds) : null,
        config.secForms ? JSON.stringify(config.secForms) : null,
        config.watchlistTickers ? JSON.stringify(config.watchlistTickers) : null,
        config.watchlistKeywords ? JSON.stringify(config.watchlistKeywords) : null,
        config.useX,
        config.xApiKey,
        config.focusPrompt,
      ],
    );
  }

  async createRun(userId: string, runId: string, triggerReason: string, tenantId?: string): Promise<void> {
    const tenant = this.resolveTenant(tenantId);
    await this.pool.query(
      `INSERT INTO ai_research_runs (id, tenant_id, user_id, started_at, status, trigger_reason)
       VALUES ($1, $2, $3, NOW(), 'running', $4)`,
      [runId, tenant, userId, triggerReason],
    );
  }

  async finishRun(
    userId: string,
    runId: string,
    status: 'completed' | 'failed' | 'cancelled',
    error?: string,
    stats?: Record<string, unknown>,
    tenantId?: string,
  ): Promise<void> {
    const tenant = this.resolveTenant(tenantId);
    await this.pool.query(
      `UPDATE ai_research_runs 
       SET finished_at = NOW(), status = $3, error = $4, stats = $5
       WHERE id = $1 AND user_id = $2 AND tenant_id = $6`,
      [runId, userId, status, error, stats ? JSON.stringify(stats) : null, tenant],
    );
  }

  async getLastRun(userId: string, tenantId?: string): Promise<AiResearchRun | null> {
    const tenant = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `SELECT id, user_id, started_at, finished_at, status, error, stats, trigger_reason
       FROM ai_research_runs WHERE user_id = $1 AND tenant_id = $2
       ORDER BY started_at DESC LIMIT 1`,
      [userId, tenant],
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      status: row.status,
      error: row.error,
      stats: row.stats,
      triggerReason: row.trigger_reason,
    };
  }

  async insertBriefs(
    userId: string,
    runId: string,
    briefs: Array<
      Omit<AiBrief, 'id' | 'userId' | 'createdAt' | 'runId' | 'dismissed' | 'dismissedAt'>
    >,
    tenantId?: string,
  ): Promise<void> {
    if (briefs.length === 0) return;
    const tenant = this.resolveTenant(tenantId);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      for (const brief of briefs) {
        const id = `${runId}-${Math.random().toString(36).slice(2)}`;
        await client.query(
          `INSERT INTO ai_briefs 
           (id, tenant_id, user_id, run_id, headline, summary_bullets, tickers, why_it_matters, 
            what_to_watch, impact_score, confidence, sources)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            id,
            tenant,
            userId,
            runId,
            brief.headline,
            JSON.stringify(brief.summaryBullets),
            JSON.stringify(brief.tickers),
            JSON.stringify(brief.whyItMatters),
            JSON.stringify(brief.whatToWatch),
            brief.impactScore,
            brief.confidence,
            JSON.stringify(brief.sources),
          ],
        );
      }

      await client.query('COMMIT');
      logger.info('briefs_inserted', { userId, runId, count: briefs.length });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listBriefs(userId: string, limit: number = 50, tenantId?: string): Promise<AiBrief[]> {
    const tenant = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `SELECT id, user_id, created_at, run_id, headline, summary_bullets, tickers,
              why_it_matters, what_to_watch, impact_score, confidence, sources, dismissed, dismissed_at
       FROM ai_briefs 
       WHERE user_id = $1 AND tenant_id = $2 AND dismissed = false
       ORDER BY created_at DESC LIMIT $3`,
      [userId, tenant, limit],
    );

    return result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      createdAt: row.created_at,
      runId: row.run_id,
      headline: row.headline,
      summaryBullets: row.summary_bullets || [],
      tickers: row.tickers || [],
      whyItMatters: row.why_it_matters || [],
      whatToWatch: row.what_to_watch || [],
      impactScore: row.impact_score,
      confidence: row.confidence,
      sources: row.sources || [],
      dismissed: row.dismissed,
      dismissedAt: row.dismissed_at,
    }));
  }

  async dismissBrief(userId: string, briefId: string, tenantId?: string): Promise<boolean> {
    const tenant = this.resolveTenant(tenantId);
    const result = await this.pool.query(
      `UPDATE ai_briefs SET dismissed = true, dismissed_at = NOW()
       WHERE id = $1 AND user_id = $2 AND tenant_id = $3`,
      [briefId, userId, tenant],
    );

    return (result.rowCount ?? 0) > 0;
  }
}

import type { Pool } from 'pg';
import { AiCongressRepo } from './aiCongressRepo.js';
import { OllamaCloudClient } from '../ollama/ollamaClient.js';
import type { AppEnv } from '../../config.js';
import { createLogger } from '../../logger.js';

const logger = createLogger('ai-congress-service');

export type AiCongressService = {
  analyzeTradeForSentiment: (
    userId: string,
    tradeId: string,
    tradeData: { member: string; ticker: string; side: string; amount: string; date: string },
    model?: string,
    tenantId?: string,
  ) => Promise<{ ok: boolean; analysis?: unknown; error?: string }>;
  getTradeAnalysis: (userId: string, tradeId: string, tenantId?: string) => Promise<unknown | null>;
  categorizeWithAi: (
    userId: string,
    tradeIds: string[],
    model?: string,
    tenantId?: string,
  ) => Promise<{ ok: boolean; count?: number; error?: string }>;
  getWatchlist: (userId: string, tenantId?: string) => Promise<unknown[]>;
  addToWatchlist: (
    userId: string,
    ticker: string,
    reason: string,
    priority?: number,
    tenantId?: string,
  ) => Promise<unknown>;
  dismissFromWatchlist: (userId: string, watchlistId: number, tenantId?: string) => Promise<boolean>;
};

export function createAiCongressService(
  pool: Pool,
  ollama: OllamaCloudClient,
  env: AppEnv,
): AiCongressService {
  const repo = new AiCongressRepo(pool);

  return {
    async analyzeTradeForSentiment(userId, tradeId, tradeData, model, tenantId) {
      const effectiveModel = model ?? env.OLLAMA_CONGRESS_MODEL ?? env.OLLAMA_DEFAULT_MODEL;

      try {
        logger.info('congress_trade_analyze_start', { userId, tradeId, ticker: tradeData.ticker });

        const analysis = await ollama.analyzeCongressTrade(effectiveModel, tradeData);

        const stored = await repo.analyzeAndStore(userId, tradeId, {
          category: analysis.category,
          sentiment: analysis.sentiment,
          sentimentScore: analysis.sentimentScore,
          reasoning: analysis.reasoning,
          confidence: analysis.confidence,
          aiModel: effectiveModel,
        }, tenantId);

        logger.info('congress_trade_analyzed', {
          userId,
          tradeId,
          sentiment: analysis.sentiment,
          confidence: analysis.confidence,
        });

        return {
          ok: true,
          analysis: {
            id: stored.id,
            category: stored.category,
            sentiment: stored.sentiment,
            sentimentScore: stored.sentimentScore,
            reasoning: stored.reasoning,
            confidence: stored.confidence,
          },
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error('congress_trade_analyze_failed', { userId, tradeId, error: errorMsg });
        return { ok: false, error: errorMsg };
      }
    },

    async getTradeAnalysis(userId, tradeId, tenantId) {
      const analysis = await repo.getAnalysis(userId, tradeId, tenantId);
      if (!analysis) return null;
      return {
        id: analysis.id,
        category: analysis.category,
        sentiment: analysis.sentiment,
        sentimentScore: analysis.sentimentScore,
        reasoning: analysis.reasoning,
        confidence: analysis.confidence,
        createdAt: analysis.createdAt,
      };
    },

    async categorizeWithAi(userId, tradeIds, model, tenantId) {
      const effectiveModel = model ?? env.OLLAMA_CONGRESS_MODEL ?? env.OLLAMA_DEFAULT_MODEL;
      let processed = 0;

      for (const tradeId of tradeIds) {
        try {
          // In production, fetch actual trade data from congress table
          const tradeData: {
            member: string;
            ticker: string;
            side: string;
            amount: string;
            date: string;
          } = {
            member: `Member-${tradeId}`,
            ticker: 'AAPL',
            side: 'BUY',
            amount: '50K',
            date: new Date().toISOString().split('T')[0] ?? '',
          };

          await this.analyzeTradeForSentiment(userId, tradeId, tradeData, effectiveModel, tenantId);
          processed++;
        } catch (error) {
          logger.warn('congress_categorize_trade_failed', {
            userId,
            tradeId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      logger.info('congress_categorize_complete', { userId, processedCount: processed });
      return { ok: true, count: processed };
    },

    async getWatchlist(userId, tenantId) {
      const items = await repo.listWatchlist(userId, tenantId);
      return items.map((item) => ({
        id: item.id,
        ticker: item.ticker,
        reason: item.reason,
        priority: item.priority,
        tradeCount: item.tradeCount,
        createdAt: item.createdAt,
      }));
    },

    async addToWatchlist(userId, ticker, reason, priority = 50, tenantId) {
      const item = await repo.addToWatchlist(userId, ticker, reason, priority, tenantId);
      return {
        id: item.id,
        ticker: item.ticker,
        reason: item.reason,
        priority: item.priority,
        createdAt: item.createdAt,
      };
    },

    async dismissFromWatchlist(userId, watchlistId, tenantId) {
      return repo.dismissFromWatchlist(userId, watchlistId, tenantId);
    },
  };
}

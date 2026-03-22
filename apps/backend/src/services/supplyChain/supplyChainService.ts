import type { Pool } from 'pg';
import { SupplyChainRepo } from './supplyChainRepo.js';
import { OllamaCloudClient } from '../ollama/ollamaClient.js';
import type { AppEnv } from '../../config.js';
import { createLogger } from '../../logger.js';

const logger = createLogger('supply-chain-service');

export type SupplyChainService = {
  generateMap: (
    userId: string,
    ticker: string,
    options?: { globalTickers?: string[]; includeHypothesis?: boolean; hops?: number },
    model?: string,
    tenantId?: string,
  ) => Promise<{ ok: boolean; data?: unknown; cacheKey?: string; error?: string }>;
  getCachedMap: (cacheKey: string, tenantId?: string) => Promise<unknown | null>;
  getInsights: (userId: string, ticker: string, tenantId?: string) => Promise<unknown[]>;
};

export function createSupplyChainService(
  pool: Pool,
  ollama: OllamaCloudClient,
  env: AppEnv,
): SupplyChainService {
  const repo = new SupplyChainRepo(pool);

  return {
    async generateMap(userId, ticker, options, model, tenantId) {
      const effectiveModel = model ?? env.OLLAMA_SUPPLY_CHAIN_MODEL ?? env.OLLAMA_DEFAULT_MODEL;
      const cacheKey = `supply-chain:${ticker}:${Date.now()}`;

      try {
        logger.info('supply_chain_generate_start', {
          userId,
          ticker,
          model: effectiveModel,
        });

        const insightOptions: { globalTickers?: string[]; includeHypothesis?: boolean } = {};
        if (options?.globalTickers) insightOptions.globalTickers = options.globalTickers;
        if (options?.includeHypothesis !== undefined)
          insightOptions.includeHypothesis = options.includeHypothesis;

        const insights = await ollama.generateSupplyChainInsights(
          effectiveModel,
          ticker,
          insightOptions,
        );

        const mapData = {
          ticker,
          nodes: insights.relationships.map((rel) => ({
            id: rel.source,
            label: rel.source,
            type: 'company',
          })),
          edges: insights.relationships.map((rel) => ({
            source: rel.source,
            target: rel.target,
            type: rel.type,
            weight: rel.confidence,
          })),
          insights: insights.insights,
          generatedAt: new Date().toISOString(),
        };

        await repo.cacheSupplyChainData(userId, cacheKey, ticker, mapData, effectiveModel, 86400, tenantId);

        logger.info('supply_chain_generated', {
          userId,
          ticker,
          nodeCount: mapData.nodes.length,
          edgeCount: mapData.edges.length,
        });

        return {
          ok: true,
          data: mapData,
          cacheKey,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error('supply_chain_generate_failed', { userId, ticker, error: errorMsg });
        return { ok: false, error: errorMsg };
      }
    },

    async getCachedMap(cacheKey, tenantId) {
      const cached = await repo.getSupplyChainCache(cacheKey, tenantId);
      if (!cached) return null;
      return cached.data;
    },

    async getInsights(userId, ticker, tenantId) {
      const insights = await repo.listInsights(userId, ticker, 20, tenantId);
      return insights.map((insight) => ({
        id: insight.id,
        type: insight.insightType,
        content: insight.content,
        confidence: insight.confidence,
        createdAt: insight.createdAt,
      }));
    },
  };
}

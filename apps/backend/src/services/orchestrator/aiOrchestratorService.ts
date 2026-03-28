import type { Pool } from 'pg';
import { AiOrchestratorRepo } from './aiOrchestratorRepo.js';
import type { AppEnv } from '../../config.js';
import { createLogger } from '../../logger.js';

const logger = createLogger('ai-orchestrator-service');

export type AiOrchestratorService = {
  trackInteraction: (
    userId: string,
    eventType: string,
    symbol?: string,
    metadata?: Record<string, unknown>,
    tenantId?: string,
  ) => Promise<void>;
  getPredictions: (userId: string, predictionType?: string, tenantId?: string) => Promise<unknown[]>;
  getStats: (userId: string, tenantId?: string) => Promise<unknown>;
  preloadPredictions: (userId: string, tenantId?: string) => Promise<{ ok: boolean; count?: number }>;
};

export function createAiOrchestratorService(pool: Pool, _env: AppEnv): AiOrchestratorService {
  const repo = new AiOrchestratorRepo(pool);

  return {
    async trackInteraction(userId, eventType, symbol, metadata, tenantId) {
      try {
        const sessionId = `session-${Date.now()}`;
        await repo.trackInteraction(userId, eventType, symbol, metadata, sessionId, tenantId);

        logger.info('interaction_tracked', { userId, eventType, symbol });
      } catch (error) {
        logger.error('interaction_track_failed', {
          userId,
          eventType,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },

    async getPredictions(userId, predictionType, tenantId) {
      const predictions = await repo.listActivePredictions(userId, predictionType, tenantId);
      return predictions.map((pred) => ({
        id: pred.id,
        type: pred.predictionType,
        symbol: pred.symbol,
        confidence: pred.confidence,
        data: pred.data,
        createdAt: pred.createdAt,
      }));
    },

    async getStats(userId, tenantId) {
      const stats = await repo.getOrCreateLearningStats(userId, tenantId);
      return {
        interactionsCount: stats.interactionsCount,
        predictionsCount: stats.predictionsCount,
        accuracyScore: stats.accuracyScore,
        lastTrainedAt: stats.lastTrainedAt,
        updatedAt: stats.updatedAt,
      };
    },

    async preloadPredictions(userId, tenantId) {
      try {
        const interactions = await repo.listRecentInteractions(userId, 50, tenantId);

        // Generate predictions based on recent interactions
        const eventCounts: Record<string, number> = {};
        const symbolCounts: Record<string, number> = {};

        for (const interaction of interactions) {
          eventCounts[interaction.eventType] = (eventCounts[interaction.eventType] ?? 0) + 1;
          if (interaction.symbol) {
            symbolCounts[interaction.symbol] = (symbolCounts[interaction.symbol] ?? 0) + 1;
          }
        }

        // Store top predictions
        let count = 0;
        for (const [symbol, freq] of Object.entries(symbolCounts).slice(0, 5)) {
          const confidence = Math.min(0.95, (freq / interactions.length) * 0.8);
          await repo.storePrediction(userId, 'next_symbol', symbol, confidence, {
            frequency: freq,
            interactionBased: true,
          }, undefined, tenantId);
          count++;
        }

        logger.info('predictions_preloaded', { userId, count });
        return { ok: true, count };
      } catch (error) {
        logger.error('predictions_preload_failed', {
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
        return { ok: false };
      }
    },
  };
}

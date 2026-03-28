import type { Pool } from 'pg';
import { AiResearchRepo } from './aiResearchRepo.js';
import { OllamaCloudClient } from '../ollama/ollamaClient.js';
import type { AppEnv } from '../../config.js';
import { createLogger } from '../../logger.js';
import { sha256, canonicalizeText } from './utils.js';

const logger = createLogger('ai-research-service');

export type AiResearchService = {
  getConfig: (userId: string, tenantId?: string) => Promise<unknown>;
  setConfig: (
    userId: string,
    config: unknown,
    tenantId?: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  getStatus: (userId: string, tenantId?: string) => Promise<unknown>;
  listBriefs: (userId: string, limit?: number, tenantId?: string) => Promise<unknown[]>;
  dismissBrief: (userId: string, briefId: string, tenantId?: string) => Promise<boolean>;
  runNow: (
    userId: string,
    manualItems: Array<{ title: string; text: string }>,
    model?: string,
    tenantId?: string,
  ) => Promise<{ ok: boolean; runId?: string; error?: string }>;
};

export function createAiResearchService(
  pool: Pool,
  ollama: OllamaCloudClient,
  env: AppEnv,
): AiResearchService {
  const repo = new AiResearchRepo(pool);

  return {
    async getConfig(userId: string, tenantId?: string) {
      const config = await repo.getConfig(userId, tenantId);
      if (!config) {
        return {
          enabled: false,
          model: env.OLLAMA_RESEARCH_MODEL ?? env.OLLAMA_DEFAULT_MODEL,
          pollIntervalSec: 300,
          rssFeeds: [],
          secForms: ['8-K', '10-Q', '10-K'],
          watchlistTickers: [],
          watchlistKeywords: [],
          useX: false,
          focusPrompt: '',
        };
      }
      return config;
    },

    async setConfig(userId: string, input: unknown, tenantId?: string) {
      if (!input || typeof input !== 'object') {
        return { ok: false, error: 'Invalid config' };
      }

      const config = input as Record<string, unknown>;
      const updates: Partial<{
        enabled: boolean;
        model: string;
        pollIntervalSec: number;
        rssFeeds: string[];
        secForms: string[];
        watchlistTickers: string[];
        watchlistKeywords: string[];
        useX: boolean;
        xApiKey: string;
        focusPrompt: string;
      }> = {};

      if (typeof config.enabled === 'boolean') updates.enabled = config.enabled;
      if (typeof config.model === 'string') updates.model = config.model;
      if (typeof config.pollIntervalSec === 'number')
        updates.pollIntervalSec = config.pollIntervalSec;
      if (Array.isArray(config.rssFeeds)) updates.rssFeeds = config.rssFeeds;
      if (Array.isArray(config.secForms)) updates.secForms = config.secForms;
      if (Array.isArray(config.watchlistTickers))
        updates.watchlistTickers = config.watchlistTickers;
      if (Array.isArray(config.watchlistKeywords))
        updates.watchlistKeywords = config.watchlistKeywords;
      if (typeof config.useX === 'boolean') updates.useX = config.useX;
      if (typeof config.xApiKey === 'string') updates.xApiKey = config.xApiKey;
      if (typeof config.focusPrompt === 'string') updates.focusPrompt = config.focusPrompt;

      await repo.setConfig(userId, updates, tenantId);
      return { ok: true };
    },

    async getStatus(userId: string, tenantId?: string) {
      const lastRun = await repo.getLastRun(userId, tenantId);
      return {
        running: lastRun?.status === 'running',
        lastRun: lastRun
          ? {
              id: lastRun.id,
              startedAt: lastRun.startedAt,
              finishedAt: lastRun.finishedAt,
              status: lastRun.status,
              error: lastRun.error,
            }
          : null,
        queueDepth: 0,
      };
    },

    async listBriefs(userId: string, limit = 50, tenantId?: string) {
      const briefs = await repo.listBriefs(userId, limit, tenantId);
      return briefs.map((brief) => ({
        id: brief.id,
        createdAt: brief.createdAt,
        headline: brief.headline,
        summaryBullets: brief.summaryBullets,
        tickers: brief.tickers,
        whyItMatters: brief.whyItMatters,
        whatToWatch: brief.whatToWatch,
        impactScore: brief.impactScore,
        confidence: brief.confidence,
        sources: brief.sources,
      }));
    },

    async dismissBrief(userId: string, briefId: string, tenantId?: string) {
      return repo.dismissBrief(userId, briefId, tenantId);
    },

    async runNow(
      userId: string,
      manualItems: Array<{ title: string; text: string }>,
      model?: string,
      tenantId?: string,
    ) {
      const config = await repo.getConfig(userId, tenantId);
      const effectiveConfig = config ?? {
        enabled: false,
        model: env.OLLAMA_RESEARCH_MODEL ?? env.OLLAMA_DEFAULT_MODEL,
        watchlistTickers: [] as string[],
        watchlistKeywords: [] as string[],
      };

      // If no manual items provided, auto-generate from watchlist tickers
      let items = manualItems ?? [];
      if (items.length === 0) {
        const tickers: string[] = (effectiveConfig as Record<string, unknown>).watchlistTickers as string[] ?? [];
        const keywords: string[] = (effectiveConfig as Record<string, unknown>).watchlistKeywords as string[] ?? [];

        if (tickers.length > 0) {
          const tickerList = tickers.join(', ');
          const keywordContext = keywords.length > 0
            ? ` Focus on these themes: ${keywords.join(', ')}.`
            : '';
          items = [{
            title: `Watchlist Analysis: ${tickerList}`,
            text: `Analyze the latest market developments, recent earnings, SEC filings, and significant news for the following tickers: ${tickerList}.${keywordContext} Provide actionable trading intelligence briefs covering price-moving catalysts, sector trends, and risk factors. Use today's date context: ${new Date().toISOString().slice(0, 10)}.`,
          }];
          logger.info('ai_research_auto_watchlist', { userId, tickers, keywords });
        }
      }

      if (items.length === 0) {
        return { ok: false, error: 'No items provided and no watchlist tickers configured. Add tickers in Settings or paste news items.' };
      }

      const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await repo.createRun(userId, runId, 'manual', tenantId);

      try {
        const effectiveModel =
          model ?? config?.model ?? env.OLLAMA_RESEARCH_MODEL ?? env.OLLAMA_DEFAULT_MODEL;

        logger.info('ai_research_run_start', {
          userId,
          runId,
          model: effectiveModel,
          itemCount: items.length,
        });

        // Deduplicate items by canonical hash
        const uniqueItems: Array<{ title: string; text: string }> = [];
        const seenHashes = new Set<string>();
        for (const item of items) {
          const canonical = canonicalizeText(`${item.title} ${item.text}`);
          const hash = sha256(canonical);
          if (!seenHashes.has(hash)) {
            seenHashes.add(hash);
            uniqueItems.push(item);
          }
        }

        logger.info('ai_research_dedupe', {
          userId,
          runId,
          original: items.length,
          unique: uniqueItems.length,
        });

        const briefs = await ollama.generateResearchBriefs(effectiveModel, uniqueItems);

        logger.info('ai_research_briefs_generated', {
          userId,
          runId,
          briefCount: briefs.length,
        });

        // Convert brief schema format
        const briefsForDb = briefs.map((brief) => ({
          headline: brief.headline,
          summaryBullets: brief.summaryBullets,
          tickers: brief.tickers,
          whyItMatters: Array.isArray(brief.whyItMatters)
            ? brief.whyItMatters
            : [String(brief.whyItMatters)],
          whatToWatch: brief.whatToWatch,
          impactScore: Math.round((brief.confidence ?? 0.5) * 100),
          confidence: Math.round((brief.confidence ?? 0.5) * 100),
          sources: uniqueItems.map((item) => ({
            title: item.title,
            url: '',
            source: 'manual',
            publishedAt: new Date().toISOString(),
          })),
        }));

        await repo.insertBriefs(userId, runId, briefsForDb, tenantId);

        await repo.finishRun(userId, runId, 'completed', undefined, {
          itemsProcessed: uniqueItems.length,
          briefsGenerated: briefs.length,
        }, tenantId);

        logger.info('ai_research_run_complete', { userId, runId });

        return { ok: true, runId };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error('ai_research_run_failed', { userId, runId, error: errorMsg });
        await repo.finishRun(userId, runId, 'failed', errorMsg, undefined, tenantId);
        return { ok: false, error: errorMsg, runId };
      }
    },
  };
}

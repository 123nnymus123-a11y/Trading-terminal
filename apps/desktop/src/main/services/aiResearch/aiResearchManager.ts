import path from 'node:path';
import { z } from 'zod';
import { createWorkerHarness } from '../../workers/workerHarness';
import { AiResearchRepo } from '../../persistence/aiResearchRepo';
import { AiConfigSchema, AiBriefSchema } from './schemas';

const RunResultSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      source: z.string(),
      url: z.string(),
      title: z.string(),
      publishedAt: z.string(),
      rawText: z.string(),
      tickers: z.array(z.string()),
      ingestedAt: z.string(),
      canonicalText: z.string(),
      canonicalHash: z.string(),
    }),
  ),
  clusterUpdates: z.array(
    z.object({
      clusterId: z.string(),
      representativeItemId: z.string(),
      createdAt: z.string(),
      updatedAt: z.string(),
    }),
  ),
  clusterItems: z.array(z.object({ clusterId: z.string(), itemId: z.string() })),
  briefs: z.array(AiBriefSchema),
  errors: z.array(z.string()),
});

export type AiRunStatus = {
  running: boolean;
  lastRun?: {
    id: string;
    startedAt: string;
    finishedAt?: string;
    status: string;
    error?: string;
  } | null;
  queueDepth: number;
};

export class AiResearchManager {
  private worker = createWorkerHarness(path.join(__dirname, 'workers', 'aiResearchWorker.cjs'));
  private running = false;
  private queued = false;
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(
    private sendEvent: (
      channel: 'ai:briefs' | 'ai:status' | 'ai:runProgress',
      payload: unknown,
    ) => void,
  ) {}

  getStatus(): AiRunStatus {
    return {
      running: this.running,
      lastRun: AiResearchRepo.getLastRun(),
      queueDepth: this.queued ? 1 : 0,
    };
  }

  setConfig(input: unknown): { ok: boolean; error?: string } {
    const parsed = AiConfigSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: 'Invalid AI config' };
    }

    AiResearchRepo.setConfig(parsed.data);
    this.resetPolling(parsed.data);
    return { ok: true };
  }

  getConfig() {
    return AiResearchRepo.getConfig();
  }

  async checkRuntime() {
    console.log('[AiResearchManager] Checking cloud LLM availability...');
    const { checkCloudLlmAvailable } = await import('../../llm/cloudLlmClient');
    const result = await checkCloudLlmAvailable();
    if (result.ok) {
      console.log(`[AiResearchManager] ✓ Cloud LLM ready: ${result.model}`);
      return { available: true, version: result.model };
    }
    console.warn(`[AiResearchManager] Cloud LLM check failed: ${result.error}`);
    return { available: false, message: result.error ?? 'Cloud LLM unavailable' };
  }

  async listLocalModels() {
    const { listAvailableModels } = await import('../../llm/cloudLlmClient');
    const models = listAvailableModels().map((m) => `${m.provider}/${m.model}`);
    return { ok: true, models };
  }

  async runNow(
    reason: 'manual' | 'poll',
    manualItems: Array<{ title: string; text: string }> = [],
  ) {
    const config = AiResearchRepo.getConfig();
    if (!config.enabled) {
      return { ok: false, error: 'AI disabled' };
    }

    if (this.running) {
      this.queued = true;
      return { ok: false, error: 'AI run already in progress' };
    }

    this.running = true;
    this.sendEvent('ai:status', this.getStatus());

    const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const startedAt = new Date().toISOString();
    AiResearchRepo.createRun(runId, startedAt);

    const sinceISO = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const existingItems = AiResearchRepo.getRecentItems(sinceISO, 1000);
    const existingClusters = AiResearchRepo.getRecentClusterRepresentatives(sinceISO, 300);

    this.sendEvent('ai:runProgress', { stage: 'ingest', runId, reason });

    try {
      const response = await this.worker.send(
        'ai:run',
        {
          runId,
          config,
          existingItems,
          existingClusters,
          manualItems,
        },
        { timeoutMs: 180_000 },
      );

      if (!response.ok) {
        throw new Error(response.error ?? 'AI worker error');
      }

      const parsed = RunResultSchema.safeParse(response.payload);
      if (!parsed.success) {
        throw new Error('AI worker returned invalid payload');
      }

      const result = parsed.data;

      this.sendEvent('ai:runProgress', {
        stage: 'store',
        runId,
        counts: {
          items: result.items.length,
          clusters: result.clusterUpdates.length,
          briefs: result.briefs.length,
        },
      });

      const inserted = AiResearchRepo.insertSourceItems(result.items);
      AiResearchRepo.upsertClusters(result.clusterUpdates);
      AiResearchRepo.linkClusterItems(result.clusterItems);
      AiResearchRepo.insertBriefs(result.briefs, runId);

      const finishedAt = new Date().toISOString();
      AiResearchRepo.finishRun(runId, 'completed', finishedAt, undefined, {
        inserted,
        items: result.items.length,
        clusters: result.clusterUpdates.length,
        briefs: result.briefs.length,
        errors: result.errors,
      });

      if (result.briefs.length > 0) {
        this.sendEvent('ai:briefs', result.briefs);
      }
      return { ok: true, runId, errors: result.errors };
    } catch (err) {
      const finishedAt = new Date().toISOString();
      AiResearchRepo.finishRun(runId, 'failed', finishedAt, String(err));
      return { ok: false, error: String(err), runId };
    } finally {
      this.running = false;
      this.sendEvent('ai:status', this.getStatus());
      if (this.queued) {
        this.queued = false;
        void this.runNow('poll');
      }
    }
  }

  resetPolling(config: z.infer<typeof AiConfigSchema>) {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (!config.enabled) return;

    this.pollTimer = setInterval(() => {
      void this.runNow('poll');
    }, config.pollIntervalSec * 1000);
  }

  shutdown() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    return this.worker.terminate();
  }
}

import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import type { Redis as RedisClient } from 'ioredis';

export type QueueJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type QueueJobRecord<TResult = unknown, TPayload = unknown> = {
  id: string;
  queue: string;
  status: QueueJobStatus;
  attempts: number;
  maxAttempts: number;
  idempotencyKey?: string;
  payload?: TPayload;
  result?: TResult;
  error?: string;
  cancelRequested?: boolean;
  createdAtIso: string;
  updatedAtIso: string;
  completedAtIso?: string;
};

type QueueProcessor<TPayload = unknown, TResult = unknown> = (
  payload: TPayload,
  job: QueueJobRecord<TResult, TPayload>,
) => Promise<TResult>;

type QueueJobBase = Omit<QueueJobRecord, 'result' | 'payload'> & {
  payloadJson?: string;
  resultJson?: string;
};

type QueueOptions = {
  concurrency?: number;
  maxQueue?: number;
  retryLimit?: number;
  jobTtlSeconds?: number;
  redisUrl?: string;
  namespace?: string;
};

type EnqueueOptions = {
  idempotencyKey?: string;
  maxAttempts?: number;
};

const POLL_INTERVAL_MS = 200;

export class DurableJobQueue {
  private readonly concurrency: number;
  private readonly maxQueue: number;
  private readonly retryLimit: number;
  private readonly jobTtlSeconds: number;
  private readonly namespace: string;
  private running = 0;
  private closing = false;
  private readonly processors = new Map<string, QueueProcessor>();
  private readonly memoryPending: string[] = [];
  private readonly memoryJobs = new Map<string, QueueJobBase>();
  private readonly redis?: RedisClient;
  private readonly pumpTimer: NodeJS.Timeout;

  constructor(options: QueueOptions = {}) {
    this.concurrency = options.concurrency ?? 2;
    this.maxQueue = options.maxQueue ?? 50;
    this.retryLimit = options.retryLimit ?? 2;
    this.jobTtlSeconds = options.jobTtlSeconds ?? 3600;
    this.namespace = options.namespace ?? 'tcq';
    if (options.redisUrl) {
      const RedisCtor = Redis as unknown as { new (url: string): RedisClient };
      this.redis = new RedisCtor(options.redisUrl);
    }
    this.pumpTimer = setInterval(() => {
      void this.tick();
    }, POLL_INTERVAL_MS);
    this.pumpTimer.unref();
  }

  registerProcessor<TPayload = unknown, TResult = unknown>(
    queue: string,
    processor: QueueProcessor<TPayload, TResult>,
  ): void {
    this.processors.set(queue, processor as QueueProcessor);
    void this.tick();
  }

  async enqueue<TPayload = unknown>(
    queue: string,
    payload: TPayload,
    options: EnqueueOptions = {},
  ): Promise<QueueJobRecord<unknown, TPayload>> {
    const idempotencyKey = options.idempotencyKey?.trim() || undefined;
    if (idempotencyKey) {
      const existing = await this.findByIdempotencyKey(queue, idempotencyKey);
      if (existing) {
        return existing as QueueJobRecord<unknown, TPayload>;
      }
    }

    if ((await this.getQueueDepth()) >= this.maxQueue) {
      throw new Error('queue_full');
    }

    const nowIso = new Date().toISOString();
    const job: QueueJobBase = {
      id: randomUUID(),
      queue,
      status: 'queued',
      attempts: 0,
      maxAttempts: options.maxAttempts ?? this.retryLimit,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      payloadJson: JSON.stringify(payload),
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
    };

    await this.saveJob(job);
    await this.pushPending(job.queue, job.id);
    if (idempotencyKey) {
      await this.saveIdempotencyKey(queue, idempotencyKey, job.id);
    }

    void this.tick();
    return this.deserialize<TPayload>(job);
  }

  async getJob<TPayload = unknown, TResult = unknown>(
    jobId: string,
  ): Promise<QueueJobRecord<TResult, TPayload> | null> {
    const raw = await this.loadJob(jobId);
    if (!raw) {
      return null;
    }
    return this.deserialize<TPayload, TResult>(raw);
  }

  async waitFor<TPayload = unknown, TResult = unknown>(
    jobId: string,
    timeoutMs: number,
  ): Promise<QueueJobRecord<TResult, TPayload> | null> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const current = await this.getJob<TPayload, TResult>(jobId);
      if (!current) {
        return null;
      }
      if (['completed', 'failed', 'cancelled'].includes(current.status)) {
        return current;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    return null;
  }

  async cancel(jobId: string): Promise<boolean> {
    const job = await this.loadJob(jobId);
    if (!job) {
      return false;
    }
    if (job.status === 'completed' || job.status === 'failed') {
      return false;
    }
    const next: QueueJobBase = {
      ...job,
      status: 'cancelled',
      cancelRequested: true,
      updatedAtIso: new Date().toISOString(),
      completedAtIso: new Date().toISOString(),
    };
    await this.saveJob(next);
    return true;
  }

  async getQueueDepth(): Promise<number> {
    if (this.redis) {
      const key = this.pendingKey();
      return this.redis.llen(key);
    }
    return this.memoryPending.length;
  }

  getRunningCount(): number {
    return this.running;
  }

  async close(): Promise<void> {
    this.closing = true;
    clearInterval(this.pumpTimer);
    if (this.redis) {
      await this.redis.quit();
    }
  }

  private async tick(): Promise<void> {
    if (this.closing) {
      return;
    }
    while (this.running < this.concurrency) {
      const next = await this.popPending();
      if (!next) {
        break;
      }
      this.running += 1;
      void this.processJob(next)
        .catch(() => {
          // Errors are persisted on the job state.
        })
        .finally(() => {
          this.running -= 1;
          void this.tick();
        });
    }
  }

  private async processJob(jobId: string): Promise<void> {
    const current = await this.loadJob(jobId);
    if (!current) {
      await this.ackProcessing(jobId);
      return;
    }

    if (current.cancelRequested || current.status === 'cancelled') {
      await this.ackProcessing(jobId);
      return;
    }

    const processor = this.processors.get(current.queue);
    if (!processor) {
      await this.failWithoutRetry(current, 'processor_not_registered');
      await this.ackProcessing(jobId);
      return;
    }

    const running: QueueJobBase = {
      ...current,
      status: 'running',
      attempts: current.attempts + 1,
      updatedAtIso: new Date().toISOString(),
    };
    await this.saveJob(running);

    try {
      const payload = this.deserializePayload(running.payloadJson);
      const result = await processor(payload, this.deserialize(running));
      const completed: QueueJobBase = {
        ...running,
        status: 'completed',
        resultJson: JSON.stringify(result),
        completedAtIso: new Date().toISOString(),
        updatedAtIso: new Date().toISOString(),
      };
      await this.saveJob(completed);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'job_failed';
      const exhausted = running.attempts >= running.maxAttempts;
      if (exhausted) {
        const failed: QueueJobBase = {
          ...running,
          status: 'failed',
          error: message,
          completedAtIso: new Date().toISOString(),
          updatedAtIso: new Date().toISOString(),
        };
        await this.saveJob(failed);
      } else {
        const retryQueued: QueueJobBase = {
          ...running,
          status: 'queued',
          error: message,
          updatedAtIso: new Date().toISOString(),
        };
        await this.saveJob(retryQueued);
        await this.pushPending(retryQueued.queue, retryQueued.id);
      }
    } finally {
      await this.ackProcessing(jobId);
    }
  }

  private async failWithoutRetry(job: QueueJobBase, error: string): Promise<void> {
    const failed: QueueJobBase = {
      ...job,
      status: 'failed',
      attempts: job.maxAttempts,
      error,
      completedAtIso: new Date().toISOString(),
      updatedAtIso: new Date().toISOString(),
    };
    await this.saveJob(failed);
  }

  private deserialize<TPayload = unknown, TResult = unknown>(
    job: QueueJobBase,
  ): QueueJobRecord<TResult, TPayload> {
    return {
      id: job.id,
      queue: job.queue,
      status: job.status,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      ...(job.idempotencyKey ? { idempotencyKey: job.idempotencyKey } : {}),
      ...(job.error ? { error: job.error } : {}),
      ...(job.completedAtIso ? { completedAtIso: job.completedAtIso } : {}),
      ...(job.resultJson ? { result: this.deserializeJson<TResult>(job.resultJson) } : {}),
      ...(job.payloadJson ? { payload: this.deserializeJson<TPayload>(job.payloadJson) } : {}),
      createdAtIso: job.createdAtIso,
      updatedAtIso: job.updatedAtIso,
    };
  }

  private deserializePayload(payloadJson?: string): unknown {
    if (!payloadJson) {
      return {};
    }
    return this.deserializeJson(payloadJson);
  }

  private deserializeJson<T = unknown>(json: string): T {
    try {
      return JSON.parse(json) as T;
    } catch {
      return {} as T;
    }
  }

  private jobKey(jobId: string): string {
    return `${this.namespace}:job:${jobId}`;
  }

  private pendingKey(): string {
    return `${this.namespace}:pending`;
  }

  private processingKey(): string {
    return `${this.namespace}:processing`;
  }

  private idempotencyKey(queue: string, idempotencyKey: string): string {
    return `${this.namespace}:idem:${queue}:${idempotencyKey}`;
  }

  private async saveJob(job: QueueJobBase): Promise<void> {
    if (this.redis) {
      const key = this.jobKey(job.id);
      await this.redis.hset(key, {
        id: job.id,
        queue: job.queue,
        status: job.status,
        attempts: String(job.attempts),
        maxAttempts: String(job.maxAttempts),
        idempotencyKey: job.idempotencyKey ?? '',
        payloadJson: job.payloadJson ?? '',
        resultJson: job.resultJson ?? '',
        error: job.error ?? '',
        cancelRequested: job.cancelRequested ? '1' : '0',
        createdAtIso: job.createdAtIso,
        updatedAtIso: job.updatedAtIso,
        completedAtIso: job.completedAtIso ?? '',
      });
      await this.redis.expire(key, this.jobTtlSeconds);
      return;
    }
    this.memoryJobs.set(job.id, job);
  }

  private async loadJob(jobId: string): Promise<QueueJobBase | null> {
    if (this.redis) {
      const key = this.jobKey(jobId);
      const hash = await this.redis.hgetall(key);
      if (!hash.id) {
        return null;
      }
      return {
        id: hash.id,
        queue: hash.queue ?? 'default',
        status: (hash.status as QueueJobStatus) ?? 'queued',
        attempts: Number(hash.attempts ?? 0),
        maxAttempts: Number(hash.maxAttempts ?? this.retryLimit),
        ...(hash.idempotencyKey ? { idempotencyKey: hash.idempotencyKey } : {}),
        ...(hash.payloadJson ? { payloadJson: hash.payloadJson } : {}),
        ...(hash.resultJson ? { resultJson: hash.resultJson } : {}),
        ...(hash.error ? { error: hash.error } : {}),
        ...(hash.completedAtIso ? { completedAtIso: hash.completedAtIso } : {}),
        cancelRequested: hash.cancelRequested === '1',
        createdAtIso: hash.createdAtIso ?? new Date().toISOString(),
        updatedAtIso: hash.updatedAtIso ?? new Date().toISOString(),
      };
    }
    return this.memoryJobs.get(jobId) ?? null;
  }

  private async pushPending(_queue: string, jobId: string): Promise<void> {
    if (this.redis) {
      await this.redis.lpush(this.pendingKey(), jobId);
      return;
    }
    this.memoryPending.push(jobId);
  }

  private async popPending(): Promise<string | null> {
    if (this.redis) {
      const jobId = await this.redis.rpoplpush(this.pendingKey(), this.processingKey());
      return jobId;
    }
    return this.memoryPending.shift() ?? null;
  }

  private async ackProcessing(jobId: string): Promise<void> {
    if (!this.redis) {
      return;
    }
    await this.redis.lrem(this.processingKey(), 1, jobId);
  }

  private async saveIdempotencyKey(queue: string, idempotencyKey: string, jobId: string) {
    if (this.redis) {
      await this.redis.set(this.idempotencyKey(queue, idempotencyKey), jobId, 'EX', this.jobTtlSeconds);
      return;
    }
  }

  private async findByIdempotencyKey<TPayload = unknown>(
    queue: string,
    idempotencyKey: string,
  ): Promise<QueueJobRecord<unknown, TPayload> | null> {
    if (!this.redis) {
      return null;
    }
    const jobId = await this.redis.get(this.idempotencyKey(queue, idempotencyKey));
    if (!jobId) {
      return null;
    }
    return this.getJob<TPayload>(jobId);
  }
}

export default DurableJobQueue;

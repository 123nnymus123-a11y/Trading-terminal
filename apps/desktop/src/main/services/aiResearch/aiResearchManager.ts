import path from "node:path";
import { z } from "zod";
import { createWorkerHarness } from "../../workers/workerHarness";
import { AiResearchRepo } from "../../persistence/aiResearchRepo";
import { AppSettingsRepo } from "../../persistence/repos";
import { AiConfigSchema, AiBriefSchema } from "./schemas";

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
  clusterItems: z.array(
    z.object({ clusterId: z.string(), itemId: z.string() }),
  ),
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
  private worker = createWorkerHarness(
    path.join(__dirname, "workers", "aiResearchWorker.cjs"),
  );
  private running = false;
  private queued = false;
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(
    private sendEvent: (
      channel: "ai:briefs" | "ai:status" | "ai:runProgress",
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
      return { ok: false, error: "Invalid AI config" };
    }

    AiResearchRepo.setConfig(parsed.data);
    this.resetPolling(parsed.data);
    return { ok: true };
  }

  getConfig() {
    return AiResearchRepo.getConfig();
  }

  private getOllamaHost(): string {
    const settings = AppSettingsRepo.get() as {
      ollamaHostUrl?: string;
      ollama_host_url?: string;
    };
    const configured =
      settings?.ollamaHostUrl?.trim() ||
      settings?.ollama_host_url?.trim() ||
      process.env.OLLAMA_BASE_URL?.trim() ||
      process.env.OLLAMA_HOST?.trim() ||
      "http://127.0.0.1:11434";
    return configured.replace(/\/+$/, "");
  }

  async checkRuntime() {
    const host = this.getOllamaHost();
    try {
      const response = await fetch(`${host}/api/tags`, {
        method: "GET",
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        const looksLikeForeignApi =
          /incorrect api key|openai|anthropic|gemini/i.test(body);
        return {
          available: false,
          message: looksLikeForeignApi
            ? `HTTP ${response.status}: ${body || response.statusText}. The configured Ollama host does not appear to be an Ollama server.`
            : `HTTP ${response.status}: ${body || response.statusText}`,
          host,
        };
      }
      const payload = (await response.json()) as {
        models?: Array<{ name?: string }>;
      };
      const count = Array.isArray(payload?.models) ? payload.models.length : 0;
      return {
        available: true,
        version: `ollama (${count} models)`,
        host,
      };
    } catch (err) {
      return {
        available: false,
        message: err instanceof Error ? err.message : String(err),
        host,
      };
    }
  }

  async listLocalModels() {
    const host = this.getOllamaHost();
    try {
      const response = await fetch(`${host}/api/tags`, {
        method: "GET",
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        return {
          ok: false,
          models: [],
          error: `HTTP ${response.status}: ${body || response.statusText}`,
        };
      }
      const payload = (await response.json()) as {
        models?: Array<{ name?: string }>;
      };
      const models = Array.isArray(payload?.models)
        ? payload.models
            .map((item) => item?.name)
            .filter(
              (name): name is string =>
                typeof name === "string" && name.trim().length > 0,
            )
        : [];
      return { ok: true, models };
    } catch (err) {
      return {
        ok: false,
        models: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async testModelConnection(input: {
    provider?: string;
    model: string;
    apiKey?: string;
  }): Promise<{ ok: boolean; message: string }> {
    const provider = (input.provider || "ollama").trim().toLowerCase();
    const model = input.model.trim();
    if (!model) {
      return { ok: false, message: "Model is required" };
    }

    if (provider === "ollama") {
      const host = this.getOllamaHost();
      try {
        const response = await fetch(`${host}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            prompt: "Reply with exactly: ok",
            stream: false,
            options: { temperature: 0 },
          }),
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) {
          const body = await response.text().catch(() => "");
          const looksLikeForeignApi =
            /incorrect api key|openai|anthropic|gemini/i.test(body);
          return {
            ok: false,
            message: looksLikeForeignApi
              ? `Ollama ${model} -> HTTP ${response.status}: ${body || response.statusText}. The configured host ${host} is responding like a different API, not Ollama.`
              : `Ollama ${model} -> HTTP ${response.status}: ${body || response.statusText}`,
          };
        }
        return {
          ok: true,
          message: `Ollama model reachable: ${model} on ${host}`,
        };
      } catch (err) {
        return {
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    }

    try {
      const { callCloudLlm } = await import("../llm/cloudLlmClient");
      await callCloudLlm("Return one short word: ok", "health check", {
        providerOverride: provider as
          | "openai"
          | "anthropic"
          | "gemini"
          | "mistral"
          | "groq"
          | "xai"
          | "ollama",
        modelOverride: model,
        ...(input.apiKey?.trim()
          ? { apiKeyOverride: input.apiKey.trim() }
          : {}),
        temperature: 0,
        maxTokens: 16,
        signal: AbortSignal.timeout(15000),
      });
      return { ok: true, message: `${provider}/${model} reachable` };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async runNow(
    reason: "manual" | "poll",
    manualItems: Array<{ title: string; text: string }> = [],
  ) {
    const config = AiResearchRepo.getConfig();
    if (!config.enabled) {
      return { ok: false, error: "AI disabled" };
    }

    if (this.running) {
      this.queued = true;
      return { ok: false, error: "AI run already in progress" };
    }

    this.running = true;
    this.sendEvent("ai:status", this.getStatus());

    const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const startedAt = new Date().toISOString();
    AiResearchRepo.createRun(runId, startedAt);

    const sinceISO = new Date(
      Date.now() - 7 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const existingItems = AiResearchRepo.getRecentItems(sinceISO, 1000);
    const existingClusters = AiResearchRepo.getRecentClusterRepresentatives(
      sinceISO,
      300,
    );

    this.sendEvent("ai:runProgress", { stage: "ingest", runId, reason });

    try {
      const response = await this.worker.send(
        "ai:run",
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
        throw new Error(response.error ?? "AI worker error");
      }

      const parsed = RunResultSchema.safeParse(response.payload);
      if (!parsed.success) {
        throw new Error("AI worker returned invalid payload");
      }

      const result = parsed.data;

      this.sendEvent("ai:runProgress", {
        stage: "store",
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
      AiResearchRepo.finishRun(runId, "completed", finishedAt, undefined, {
        inserted,
        items: result.items.length,
        clusters: result.clusterUpdates.length,
        briefs: result.briefs.length,
        errors: result.errors,
      });

      if (result.briefs.length > 0) {
        this.sendEvent("ai:briefs", result.briefs);
      }
      return { ok: true, runId, errors: result.errors };
    } catch (err) {
      const finishedAt = new Date().toISOString();
      AiResearchRepo.finishRun(runId, "failed", finishedAt, String(err));
      return { ok: false, error: String(err), runId };
    } finally {
      this.running = false;
      this.sendEvent("ai:status", this.getStatus());
      if (this.queued) {
        this.queued = false;
        void this.runNow("poll");
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
      void this.runNow("poll");
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

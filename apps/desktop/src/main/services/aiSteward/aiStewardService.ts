import { EventEmitter } from "events";
import path from "node:path";
import fs from "node:fs/promises";
import type { CongressDataIngestionLog } from "@tc/shared";
import { CongressRepo } from "../../persistence/congressRepo";
import { getCongressDataService } from "../congress/congressDataService";
import type { ExternalFeedsService } from "../externalFeeds";
import type { ExternalFeedsConfig } from "../externalFeeds/types";
import {
  type AiStewardApplyResult,
  type AiStewardConfig,
  type AiStewardFinding,
  type AiStewardModule,
  type AiStewardModuleState,
  type AiStewardTask,
} from "../../../shared/aiSteward";
import {
  describeDelta,
  getLocalCftcSnapshot,
  getRemoteCftcSnapshot,
  type LocalCftcSnapshot,
  type RemoteCftcSnapshot,
} from "./cftcMonitor";

const DEFAULT_CONFIG: AiStewardConfig = {
  model: "deepseek-r1:14b", // Note: This will be overridden by global AI model setting
  checkIntervalMinutes: 30,
  autoFixData: false,
  modules: {
    cftc: { mode: "suggest" },
    congress: { mode: "suggest" },
  },
};

const CONGRESS_DOMAINS = [
  { domain: "congressional_trades", label: "Trades", staleMinutes: 24 * 60 },
  { domain: "lobbying", label: "Lobbying", staleMinutes: 7 * 24 * 60 },
  { domain: "contracts", label: "Contracts", staleMinutes: 3 * 24 * 60 },
] as const;

type CongressDomainConfig = typeof CONGRESS_DOMAINS[number];

type CongressDomainHealth = {
  config: CongressDomainConfig;
  log?: CongressDataIngestionLog;
  ageMinutes?: number;
  state: "ok" | "stale" | "failed" | "missing";
  issue?: string;
};

type SettingsRepo = {
  get(): Record<string, unknown>;
  set(next: Record<string, unknown>): void;
};

type InternalTask = {
  data: AiStewardTask;
  apply: () => Promise<AiStewardApplyResult>;
  module: AiStewardModule;
  kind: string;
};

export class AiStewardService extends EventEmitter {
  private config: AiStewardConfig;
  private moduleStates: Record<AiStewardModule, AiStewardModuleState> = {
    cftc: {
      module: "cftc",
      status: "degraded",
      summary: "Waiting for first check",
    },
    congress: {
      module: "congress",
      status: "degraded",
      summary: "Waiting for first check",
    },
  };
  private findings: AiStewardFinding[] = [];
  private tasks = new Map<string, InternalTask>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly settingsRepo: SettingsRepo,
    private readonly externalFeeds: ExternalFeedsService,
    private readonly storageDir: string,
  ) {
    super();
    this.config = this.loadConfig();
    void fs.mkdir(this.storageDir, { recursive: true }).catch(() => void 0);
    this.scheduleChecks();
  }

  getConfig(): AiStewardConfig {
    return this.config;
  }

  setConfig(patch: Partial<AiStewardConfig>): AiStewardConfig {
    const merged: AiStewardConfig = {
      ...DEFAULT_CONFIG,
      ...this.config,
      ...patch,
      modules: {
        ...DEFAULT_CONFIG.modules,
        ...this.config.modules,
        ...(patch.modules ?? {}),
      },
    };
    this.config = merged;
    this.persist();
    this.scheduleChecks();
    this.emitUpdate();
    return this.config;
  }

  getOverview() {
    return {
      config: this.config,
      modules: Object.values(this.moduleStates),
      findings: this.findings,
      tasks: Array.from(this.tasks.values()).map((t) => t.data),
      lastCheckAt: Math.max(
        0,
        ...Object.values(this.moduleStates)
          .map((m) => m.lastRunAt ?? 0)
      ) || undefined,
    };
  }

  async runModule(module: AiStewardModule) {
    if (module === "cftc") {
      await this.checkCftc();
    } else if (module === "congress") {
      await this.checkCongress();
    }
  }

  async applyTask(taskId: string): Promise<AiStewardApplyResult> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { ok: false, message: "Task not found" };
    }
    if (task.data.status === "running") {
      return { ok: false, message: "Task already running" };
    }

    task.data.status = "running";
    task.data.updatedAt = Date.now();
    this.emitUpdate();

    try {
      const result = await task.apply();
      task.data.status = result.ok ? "completed" : "failed";
      task.data.updatedAt = Date.now();
      task.data.result = result.message;
      this.emitUpdate();
      return { ...result, task: task.data };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      task.data.status = "failed";
      task.data.updatedAt = Date.now();
      task.data.result = message;
      this.emitUpdate();
      return { ok: false, message, task: task.data };
    }
  }

  async testResponse(prompt = "Respond with 'AI steward online' if you can read this.") {
    const system = "You are the Trading Terminal AI Steward connectivity tester.";
    return await this.runModel(system, prompt);
  }

  private loadConfig(): AiStewardConfig {
    const settings = this.settingsRepo.get();
    const stored = (settings.aiSteward as Partial<AiStewardConfig> | undefined) ?? undefined;
    const merged: AiStewardConfig = {
      ...DEFAULT_CONFIG,
      ...(stored ?? {}),
      modules: {
        ...DEFAULT_CONFIG.modules,
        ...(stored?.modules ?? {}),
      },
    };
    if (!stored) {
      this.settingsRepo.set({ ...settings, aiSteward: merged });
    }
    return merged;
  }

  private persist() {
    const settings = this.settingsRepo.get();
    this.settingsRepo.set({ ...settings, aiSteward: this.config });
  }

  private scheduleChecks() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const interval = Math.max(5, this.config.checkIntervalMinutes) * 60 * 1000;
    this.timer = setInterval(() => {
      void this.runAllChecks();
    }, interval);
    void this.runAllChecks();
  }

  private async runAllChecks() {
    try {
      await this.checkCftc();
      await this.checkCongress();
    } catch (err) {
      console.error("[AiSteward] check failed", err);
    }
  }

  private async checkCftc() {
    const moduleState = this.moduleStates.cftc;
    moduleState.lastRunAt = Date.now();
    this.emitUpdate();

    let config: ExternalFeedsConfig;
    try {
      config = this.externalFeeds.getConfig();
    } catch (err) {
      moduleState.status = "failing";
      moduleState.summary = "Failed to read feeds config";
      this.pushFinding("cftc", "error", "CFTC config unavailable", err instanceof Error ? err.message : String(err));
      this.emitUpdate();
      return;
    }

    if (!config.enabled.cftc) {
      moduleState.status = "ok";
      moduleState.summary = "CFTC feed disabled";
      this.emitUpdate();
      return;
    }

    const samplePath = config.cftc?.sampleZipPath;
    const localSnapshot = await getLocalCftcSnapshot(samplePath).catch((err) => {
      this.pushFinding("cftc", "warn", "CFTC file unreadable", err instanceof Error ? err.message : String(err));
      return null;
    });

    let remoteSnapshot: RemoteCftcSnapshot | null = null;
    try {
      remoteSnapshot = await getRemoteCftcSnapshot();
    } catch (err) {
      moduleState.status = localSnapshot ? "degraded" : "failing";
      moduleState.summary = "Remote CFTC fetch failed";
      this.pushFinding("cftc", "warn", "Unable to reach CFTC", err instanceof Error ? err.message : String(err));
      this.emitUpdate();
      return;
    }

    const summary = describeDelta(localSnapshot ?? undefined, remoteSnapshot ?? undefined);
    moduleState.summary = summary;

    const needsUpdate = this.needsCftcUpdate(localSnapshot, remoteSnapshot);
    moduleState.status = needsUpdate ? "degraded" : "ok";
    if (!needsUpdate) {
      moduleState.lastSuccessAt = Date.now();
      this.clearPendingTasks("cftc");
      this.emitUpdate();
      return;
    }

    if (!remoteSnapshot) {
      moduleState.status = "failing";
      moduleState.summary = "Remote snapshot missing";
      this.emitUpdate();
      return;
    }

    if (!this.hasPendingTask("cftc", "cftc:update")) {
      const narrative = await this.buildCftcNarrative(localSnapshot, remoteSnapshot, summary);
      this.pushFinding("cftc", "warn", "CFTC dataset stale", narrative);
    }

    const targetPath = samplePath && samplePath.trim().length > 0 ? samplePath : path.join(this.storageDir, "cftc", "f_disagg_latest.txt");
    const task = this.buildCftcUpdateTask(targetPath, remoteSnapshot, config);
    this.replaceTask(task);

    if (this.shouldAutoApply("cftc") && task.data.autoApplicable) {
      task.data.autoApplied = true;
      void this.applyTask(task.data.id);
    } else {
      this.emitUpdate();
    }
  }

  private needsCftcUpdate(local: Awaited<ReturnType<typeof getLocalCftcSnapshot>> | null, remote: Awaited<ReturnType<typeof getRemoteCftcSnapshot>> | null) {
    if (!remote) return false;
    if (!local) return true;
    if (!local.lastDate) return true;
    if (!remote.lastDate) return false;
    return remote.lastDate > local.lastDate;
  }

  private buildCftcUpdateTask(targetPath: string, remote: Awaited<ReturnType<typeof getRemoteCftcSnapshot>>, config: ExternalFeedsConfig): InternalTask {
    const id = `cftc-update-${Date.now()}`;
    const createdAt = Date.now();
    const detail = `Will download latest CFTC file (${remote.rowCount} rows, ${remote.marketCount} markets) and store at ${targetPath}.`;
    const data: AiStewardTask = {
      id,
      module: "cftc",
      kind: "cftc:update",
      title: "Refresh CFTC Commitments of Traders dataset",
      summary: `Update dataset to ${remote.lastDate ?? "latest"}`,
      detail,
      severity: "warn",
      autoApplicable: true,
      status: "pending",
      createdAt,
      updatedAt: createdAt,
    };

    const apply = async (): Promise<AiStewardApplyResult> => {
      try {
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, remote.rawText, "utf8");
        const nextConfig: ExternalFeedsConfig = {
          ...config,
          cftc: {
            ...(config.cftc ?? {}),
            sampleZipPath: targetPath,
          },
        };
        this.externalFeeds.setConfig(nextConfig);
        this.pushFinding("cftc", "info", "CFTC dataset refreshed", `Stored ${remote.lastDate ?? "latest"} at ${targetPath}`);
        return { ok: true, message: `Saved latest dataset (${remote.lastDate ?? "unknown date"})` };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.pushFinding("cftc", "error", "CFTC update failed", message);
        return { ok: false, message };
      }
    };

    return {
      data,
      apply,
      module: "cftc",
      kind: data.kind,
    };
  }

  private async checkCongress() {
    const moduleState = this.moduleStates.congress;
    moduleState.lastRunAt = Date.now();
    this.emitUpdate();

    const health = this.getCongressDomainHealth();
    const summaryParts = health.map((h) => `${h.config.label} ${this.describeCongressDomain(h)}`);
    moduleState.summary = summaryParts.join(" • ") || "No congress ingestion activity logged";

    const problems = health.filter((h) => h.state !== "ok");
    if (problems.length === 0) {
      moduleState.status = "ok";
      moduleState.lastSuccessAt = Date.now();
      this.clearPendingTasks("congress");
      this.emitUpdate();
      return;
    }

    moduleState.status = problems.some((h) => h.state === "failed" || h.state === "missing") ? "failing" : "degraded";
    const severity = moduleState.status === "failing" ? "error" : "warn";
    const detail = problems.map((h) => `${h.config.label}: ${this.describeCongressDomain(h, true)}`).join("; ");

    if (!this.hasPendingTask("congress", "congress:refresh")) {
      this.pushFinding("congress", severity, "Congress data ingest requires attention", detail);
    }

    if (!this.hasPendingTask("congress", "congress:refresh")) {
      const task = this.buildCongressRefreshTask(detail, severity);
      this.replaceTask(task);
      if (this.shouldAutoApply("congress") && task.data.autoApplicable) {
        task.data.autoApplied = true;
        void this.applyTask(task.data.id);
      } else {
        this.emitUpdate();
      }
    } else {
      this.emitUpdate();
    }
  }

  private getCongressDomainHealth(): CongressDomainHealth[] {
    const now = Date.now();
    return CONGRESS_DOMAINS.map((config) => {
      try {
        const [log] = CongressRepo.queryIngestionLogs(config.domain, 1);
        if (!log) {
          return {
            config,
            state: "missing",
            issue: "No ingestion runs recorded",
          } satisfies CongressDomainHealth;
        }

        const endTs = log.timestamp_end ? Date.parse(log.timestamp_end) : undefined;
        const ageMinutes = typeof endTs === "number" && Number.isFinite(endTs)
          ? Math.max(0, Math.floor((now - endTs) / 60000))
          : undefined;

        if (log.status === "failed") {
          return {
            config,
            log,
            ageMinutes,
            state: "failed",
            issue: log.error_messages ?? "Last run failed",
          } satisfies CongressDomainHealth;
        }

        if (!log.timestamp_end || ageMinutes === undefined) {
          return {
            config,
            log,
            state: "failed",
            issue: "Missing completion timestamp",
          } satisfies CongressDomainHealth;
        }

        if (log.status === "partial" || ageMinutes > config.staleMinutes) {
          return {
            config,
            log,
            ageMinutes,
            state: "stale",
            issue: log.status === "partial" ? "Partial ingest" : `Stale for ${this.formatAge(ageMinutes)}`,
          } satisfies CongressDomainHealth;
        }

        return {
          config,
          log,
          ageMinutes,
          state: "ok",
        } satisfies CongressDomainHealth;
      } catch (err) {
        const issue = err instanceof Error ? err.message : String(err);
        return {
          config,
          state: "failed",
          issue: `Log lookup failed: ${issue}`,
        } satisfies CongressDomainHealth;
      }
    });
  }

  private describeCongressDomain(health: CongressDomainHealth, verbose = false) {
    const age = health.ageMinutes !== undefined ? this.formatAge(health.ageMinutes) : "unknown";
    switch (health.state) {
      case "ok":
        return verbose ? `fresh (${age})` : `fresh (${age})`;
      case "stale":
        return verbose ? `${health.issue ?? `stale (${age})`}` : `stale (${age})`;
      case "missing":
        return verbose ? (health.issue ?? "no runs logged") : "no runs";
      case "failed":
      default:
        return verbose ? (health.issue ?? "failed") : "failed";
    }
  }

  private buildCongressRefreshTask(reason: string, severity: AiStewardFinding["severity"]): InternalTask {
    const id = `congress-refresh-${Date.now()}`;
    const createdAt = Date.now();
    const data: AiStewardTask = {
      id,
      module: "congress",
      kind: "congress:refresh",
      title: "Refresh Congress disclosures",
      summary: reason.slice(0, 360) || "Fetch latest disclosures",
      severity,
      autoApplicable: true,
      status: "pending",
      createdAt,
      updatedAt: createdAt,
    };

    const apply = async (): Promise<AiStewardApplyResult> => {
      try {
        const service = getCongressDataService();
        const result = await service.fetchAll(150, true);
        const message = `Inserted ${result.total.inserted} records; skipped ${result.total.skipped}.`;
        this.pushFinding("congress", "info", "Congress data refreshed", message);
        return { ok: true, message };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.pushFinding("congress", "error", "Congress refresh failed", message);
        return { ok: false, message };
      }
    };

    return {
      data,
      apply,
      module: "congress",
      kind: data.kind,
    };
  }

  private formatAge(minutes?: number) {
    if (minutes === undefined || !Number.isFinite(minutes)) return "unknown";
    if (minutes < 60) return `${minutes}m`;
    if (minutes < 24 * 60) return `${Math.round(minutes / 60)}h`;
    const days = minutes / (24 * 60);
    return `${days >= 10 ? Math.round(days) : days.toFixed(1)}d`;
  }

  private shouldAutoApply(module: AiStewardModule): boolean {
    const mode = this.config.modules[module]?.mode ?? "observe";
    if (mode === "off") return false;
    if (mode === "auto") return true;
    return this.config.autoFixData;
  }

  private replaceTask(task: InternalTask) {
    for (const [id, existing] of this.tasks.entries()) {
      if (existing.module === task.module && existing.kind === task.kind && existing.data.status === "pending") {
        this.tasks.delete(id);
      }
    }
    this.tasks.set(task.data.id, task);
  }

  private clearPendingTasks(module: AiStewardModule) {
    for (const [id, task] of this.tasks.entries()) {
      if (task.module === module && task.data.status === "pending") {
        this.tasks.delete(id);
      }
    }
  }

  private hasPendingTask(module: AiStewardModule, kind: string) {
    for (const task of this.tasks.values()) {
      if (task.module === module && task.kind === kind && task.data.status === "pending") {
        return true;
      }
    }
    return false;
  }

  private pushFinding(module: AiStewardModule, severity: AiStewardFinding["severity"], title: string, detail: string) {
    const finding: AiStewardFinding = {
      id: `${module}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      module,
      severity,
      title,
      detail,
      detectedAt: Date.now(),
    };
    this.findings = [finding, ...this.findings].slice(0, 25);
  }

  private async buildCftcNarrative(local: LocalCftcSnapshot | null, remote: RemoteCftcSnapshot | null, summary: string) {
    if (!remote) return summary;
    const system = "You are the AI Steward for a trading terminal. Explain data freshness issues succinctly.";
    const prompt = `Local dataset last date: ${local?.lastDate ?? "none"}. Local rows: ${local?.rowCount ?? 0}. ` +
      `Remote dataset last date: ${remote.lastDate ?? "unknown"}. Remote rows: ${remote.rowCount}. ` +
      `Explain in 2 sentences why refreshing is important and reference auto-fix capability.`;
    try {
      const response = await this.runModel(system, prompt);
      return response.trim().length ? response.trim() : summary;
    } catch (err) {
      console.warn("[AiSteward] narrative generation failed", err);
      return summary;
    }
  }

  private async runModel(system: string, prompt: string) {
    const { callCloudLlm } = await import('../llm/cloudLlmClient');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      return await callCloudLlm(system, prompt, { temperature: 0.2, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  private emitUpdate() {
    this.emit("update", this.getOverview());
  }
}

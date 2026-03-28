import type { Pool } from "pg";
import { AiStewardRepo } from "./aiStewardRepo.js";
import type { AppEnv } from "../../config.js";
import { createLogger } from "../../logger.js";

const logger = createLogger("ai-steward-service");

export type AiStewardService = {
  getOverview: (userId: string, tenantId?: string) => Promise<unknown>;
  getConfig: (userId: string, tenantId?: string) => Promise<unknown>;
  setConfig: (
    userId: string,
    config: unknown,
    tenantId?: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  runModule: (
    userId: string,
    moduleName: string,
    tenantId?: string,
  ) => Promise<{ ok: boolean; findingCount?: number; error?: string }>;
  listFindings: (
    userId: string,
    module?: string,
    tenantId?: string,
  ) => Promise<unknown[]>;
  dismissFinding: (
    userId: string,
    findingId: string,
    tenantId?: string,
  ) => Promise<boolean>;
  listTasks: (userId: string, tenantId?: string) => Promise<unknown[]>;
  applyTask: (
    userId: string,
    taskId: string,
    tenantId?: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  runHealthCheck: (
    userId: string,
    tenantId?: string,
  ) => Promise<{ ok: boolean; health?: StewardHealthStatus; error?: string }>;
  getIncidentDigest: (
    userId: string,
    tenantId?: string,
  ) => Promise<StewardIncidentDigest>;
  getHealthStatus: (
    userId: string,
    tenantId?: string,
  ) => Promise<StewardHealthStatus>;
};

export type StewardIncidentDigest = {
  generatedAt: string;
  summary: {
    totalOpenIncidents: number;
    criticalOpenIncidents: number;
    incidentsLast24h: number;
  };
  topIncidents: Array<{
    id: string;
    title: string;
    severity: "low" | "medium" | "high" | "critical";
    category: "category_1" | "category_2" | "category_3" | "category_4";
    module: string;
    detectedAt: string;
    status: "open" | "in_progress" | "resolved" | "dismissed";
  }>;
  recommendations: string[];
};

type StewardHealthState =
  | "ok"
  | "degraded"
  | "unavailable"
  | "stale"
  | "misconfigured";
type StewardHealthSeverity = "info" | "warning" | "high" | "critical";
type StewardHealthOwner = "system" | "user" | "admin" | "unresolved";

export type StewardRuntimeSnapshot = {
  queueDepth: number;
  queueRunning: number;
  migrationFlags: {
    backendOnlyProcessing: boolean;
    desktopLocalFallback: boolean;
    webPrimaryRouting: boolean;
  };
};

type StewardModuleHealth = {
  module: string;
  state: StewardHealthState;
  severity: StewardHealthSeverity;
  firstSeenAt?: string;
  lastSeenAt?: string;
  probableCause?: string;
  attemptedRepairs: string[];
  owner: StewardHealthOwner;
};

export type StewardHealthStatus = {
  generatedAt: string;
  overall: {
    state: StewardHealthState;
    severity: StewardHealthSeverity;
    score: number;
  };
  incidents: {
    totalOpen: number;
    bySeverity: {
      info: number;
      warning: number;
      high: number;
      critical: number;
    };
    pendingTasks: number;
  };
  runtime: StewardRuntimeSnapshot;
  modules: StewardModuleHealth[];
};

type RuntimeProvider = () => Promise<StewardRuntimeSnapshot>;

export function createAiStewardService(
  pool: Pool,
  _env: AppEnv,
  runtimeProvider?: RuntimeProvider,
): AiStewardService {
  const repo = new AiStewardRepo(pool);

  const fallbackRuntimeSnapshot: StewardRuntimeSnapshot = {
    queueDepth: 0,
    queueRunning: 0,
    migrationFlags: {
      backendOnlyProcessing: false,
      desktopLocalFallback: false,
      webPrimaryRouting: false,
    },
  };

  const severityRank: Record<StewardHealthSeverity, number> = {
    info: 0,
    warning: 1,
    high: 2,
    critical: 3,
  };

  const stateRank: Record<StewardHealthState, number> = {
    ok: 0,
    stale: 1,
    degraded: 2,
    misconfigured: 3,
    unavailable: 4,
  };

  const toIsoOrUndefined = (value?: string): string | undefined => {
    if (!value) return undefined;
    const timestamp = Date.parse(value);
    if (Number.isNaN(timestamp)) return undefined;
    return new Date(timestamp).toISOString();
  };

  const toHealthSeverity = (
    severity: "info" | "warning" | "critical",
  ): StewardHealthSeverity => {
    if (severity === "critical") return "critical";
    if (severity === "warning") return "warning";
    return "info";
  };

  const collectModuleNames = (
    findings: Array<{ module: string }>,
    moduleHealthRows: Array<{ module: string }>,
  ): string[] => {
    const fixedModules = ["cftc", "congress", "contracts"];
    const discovered = new Set<string>(fixedModules);
    for (const finding of findings) discovered.add(finding.module);
    for (const healthRow of moduleHealthRows) discovered.add(healthRow.module);
    return [...discovered].sort();
  };

  return {
    async getOverview(userId, tenantId) {
      const findings = await repo.listFindings(userId, undefined, 10, tenantId);
      const tasks = await repo.listPendingTasks(userId, 5, tenantId);
      const config = await repo.getConfig(userId, tenantId);

      const findingsBySeverity = {
        critical: findings.filter((f) => f.severity === "critical").length,
        warning: findings.filter((f) => f.severity === "warning").length,
        info: findings.filter((f) => f.severity === "info").length,
      };

      return {
        enabled: config?.enabled ?? false,
        findingsBySeverity,
        totalFindings: findings.length,
        pendingTasks: tasks.length,
        lastCheck: new Date().toISOString(),
      };
    },

    async getConfig(userId, tenantId) {
      const config = await repo.getConfig(userId, tenantId);
      if (!config) {
        return {
          enabled: false,
          autoApply: false,
          modulesEnabled: {
            cftc: false,
            congress: false,
            contracts: false,
          },
          checkIntervalSec: 3600,
          notificationPreferences: { email: false, ui: true },
        };
      }

      return {
        enabled: config.enabled,
        autoApply: config.autoApply,
        modulesEnabled: config.modulesEnabled,
        checkIntervalSec: config.checkIntervalSec,
        notificationPreferences: config.notificationPreferences,
      };
    },

    async setConfig(userId, input, tenantId) {
      if (!input || typeof input !== "object") {
        return { ok: false, error: "Invalid config" };
      }

      const cfg = input as Record<string, unknown>;
      const updates: Partial<{
        enabled: boolean;
        autoApply: boolean;
        modulesEnabled: Record<string, boolean>;
        checkIntervalSec: number;
        notificationPreferences: Record<string, unknown>;
      }> = {};

      if (typeof cfg.enabled === "boolean") updates.enabled = cfg.enabled;
      if (typeof cfg.autoApply === "boolean") updates.autoApply = cfg.autoApply;
      if (typeof cfg.modulesEnabled === "object")
        updates.modulesEnabled = cfg.modulesEnabled as Record<string, boolean>;
      if (typeof cfg.checkIntervalSec === "number")
        updates.checkIntervalSec = cfg.checkIntervalSec;
      if (typeof cfg.notificationPreferences === "object")
        updates.notificationPreferences = cfg.notificationPreferences as Record<
          string,
          unknown
        >;

      await repo.setConfig(userId, updates, tenantId);
      return { ok: true };
    },

    async runModule(userId, moduleName, tenantId) {
      try {
        logger.info("steward_module_run", { userId, module: moduleName });
        const config = await repo.getConfig(userId, tenantId);
        const autoApplyEnabled = Boolean(config?.autoApply);

        // Simulate module execution
        const findings: Array<{
          severity: "critical" | "warning" | "info";
          title: string;
          description: string;
        }> = [];

        if (moduleName === "cftc" || moduleName === "all") {
          findings.push({
            severity: "warning",
            title: "CFTC Report Latency",
            description: "Most recent CFTC COT report is 2 days old",
          });
        }

        if (moduleName === "congress" || moduleName === "all") {
          findings.push({
            severity: "info",
            title: "Congress Trading Activity",
            description: "Unusual trading spike in tech sector detected",
          });
        }

        for (const finding of findings) {
          const storedFinding = await repo.storeFinding(
            userId,
            moduleName,
            finding.severity,
            finding.title,
            finding.description,
            `Review ${finding.title.toLowerCase()}`,
            { module: moduleName, autoGenerated: true },
            tenantId,
          );

          // Category 1 safe actions: deterministic re-check, bounded retry, and refresh job nudges.
          if (finding.severity !== "critical") {
            const taskType = `${moduleName}:safe-recheck`;
            const task = await repo.createTask(
              userId,
              taskType,
              `Safe auto-fix: re-check ${moduleName.toUpperCase()} data path`,
              "Run bounded re-check and refresh stale module status without destructive actions.",
              {
                action: "safe_recheck",
                module: moduleName,
                category: "category_1",
              },
              storedFinding.id,
              tenantId,
            );

            if (autoApplyEnabled) {
              await repo.applyTask(
                userId,
                task.id,
                {
                  autoApplied: true,
                  category: "category_1",
                  executedAt: new Date().toISOString(),
                },
                tenantId,
              );
            }
          }
        }

        const runStatus = findings.some(
          (finding) => finding.severity === "critical",
        )
          ? "unavailable"
          : findings.some((finding) => finding.severity === "warning")
            ? "degraded"
            : "ok";
        await repo.upsertModuleHealth(userId, moduleName, runStatus, tenantId);

        logger.info("steward_module_complete", {
          userId,
          module: moduleName,
          findingCount: findings.length,
        });

        return { ok: true, findingCount: findings.length };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        await repo.upsertModuleHealth(
          userId,
          moduleName,
          "unavailable",
          tenantId,
        );
        logger.error("steward_module_failed", {
          userId,
          module: moduleName,
          error: errorMsg,
        });
        return { ok: false, error: errorMsg };
      }
    },

    async listFindings(userId, module, tenantId) {
      const findings = await repo.listFindings(userId, module, 50, tenantId);
      return findings.map((finding) => ({
        id: finding.id,
        module: finding.module,
        severity: finding.severity,
        title: finding.title,
        description: finding.description,
        recommendation: finding.recommendation,
        createdAt: finding.createdAt,
      }));
    },

    async dismissFinding(userId, findingId, tenantId) {
      return repo.dismissFinding(userId, findingId, tenantId);
    },

    async listTasks(userId, tenantId) {
      const tasks = await repo.listPendingTasks(userId, 50, tenantId);
      return tasks.map((task) => ({
        id: task.id,
        type: task.taskType,
        title: task.title,
        description: task.description,
        status: task.status,
        createdAt: task.createdAt,
      }));
    },

    async applyTask(userId, taskId, tenantId) {
      try {
        await repo.applyTask(
          userId,
          taskId,
          { appliedAt: new Date().toISOString() },
          tenantId,
        );
        logger.info("steward_task_applied", { userId, taskId });
        return { ok: true };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error("steward_task_apply_failed", {
          userId,
          taskId,
          error: errorMsg,
        });
        return { ok: false, error: errorMsg };
      }
    },

    async runHealthCheck(userId, tenantId) {
      try {
        const config = await repo.getConfig(userId, tenantId);
        const modulesEnabled = config?.modulesEnabled ?? {
          cftc: true,
          congress: true,
        };

        const modulesToRun = (["cftc", "congress"] as const).filter(
          (moduleName) => modulesEnabled[moduleName] !== false,
        );

        if (modulesToRun.length === 0) {
          const health = await this.getHealthStatus(userId, tenantId);
          return { ok: true, health };
        }

        for (const moduleName of modulesToRun) {
          await this.runModule(userId, moduleName, tenantId);
        }
        const health = await this.getHealthStatus(userId, tenantId);
        return { ok: true, health };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error("steward_health_check_failed", {
          userId,
          tenantId,
          error: errorMsg,
        });
        return { ok: false, error: errorMsg };
      }
    },

    async getIncidentDigest(userId, tenantId) {
      const findings = await repo.listFindings(
        userId,
        undefined,
        100,
        tenantId,
      );
      const criticalOpen = findings.filter(
        (finding) => finding.severity === "critical",
      ).length;
      const warningOpen = findings.filter(
        (finding) => finding.severity === "warning",
      ).length;
      const incidentsLast24h = findings.filter((finding) => {
        const ts = Date.parse(finding.createdAt);
        if (Number.isNaN(ts)) return false;
        return Date.now() - ts <= 24 * 60 * 60 * 1000;
      }).length;

      const recommendations: string[] = [];
      if (criticalOpen > 0) {
        recommendations.push(
          "Escalate critical incidents to operator/admin channels immediately.",
        );
      }
      if (warningOpen > 0) {
        recommendations.push(
          "Run deterministic health check and review pending safe auto-fix tasks.",
        );
      }
      if (findings.length === 0) {
        recommendations.push(
          "No open incidents detected; continue scheduled health checks.",
        );
      }

      return {
        generatedAt: new Date().toISOString(),
        summary: {
          totalOpenIncidents: findings.length,
          criticalOpenIncidents: criticalOpen,
          incidentsLast24h,
        },
        topIncidents: findings.slice(0, 8).map((finding) => ({
          id: finding.id,
          title: finding.title,
          severity:
            finding.severity === "critical"
              ? "critical"
              : finding.severity === "warning"
                ? "medium"
                : "low",
          category:
            finding.severity === "critical" ? "category_2" : "category_1",
          module: finding.module,
          detectedAt: finding.createdAt,
          status: "open",
        })),
        recommendations,
      };
    },

    async getHealthStatus(userId, tenantId) {
      const [findings, tasks, moduleHealthRows] = await Promise.all([
        repo.listFindings(userId, undefined, 200, tenantId),
        repo.listRecentTasks(userId, 100, tenantId),
        repo.listModuleHealth(userId, tenantId),
      ]);

      const runtime = runtimeProvider
        ? await runtimeProvider().catch(() => fallbackRuntimeSnapshot)
        : fallbackRuntimeSnapshot;

      const openBySeverity = {
        info: findings.filter((finding) => finding.severity === "info").length,
        warning: findings.filter((finding) => finding.severity === "warning")
          .length,
        high: 0,
        critical: findings.filter((finding) => finding.severity === "critical")
          .length,
      };

      const latestFindingByModule = new Map<
        string,
        (typeof findings)[number]
      >();
      const earliestFindingByModule = new Map<
        string,
        (typeof findings)[number]
      >();
      for (const finding of findings) {
        const currentLatest = latestFindingByModule.get(finding.module);
        if (
          !currentLatest ||
          Date.parse(finding.createdAt) > Date.parse(currentLatest.createdAt)
        ) {
          latestFindingByModule.set(finding.module, finding);
        }
        const currentEarliest = earliestFindingByModule.get(finding.module);
        if (
          !currentEarliest ||
          Date.parse(finding.createdAt) < Date.parse(currentEarliest.createdAt)
        ) {
          earliestFindingByModule.set(finding.module, finding);
        }
      }

      const taskHistoryByModule = new Map<string, string[]>();
      for (const task of tasks) {
        const moduleName = task.taskType.includes(":")
          ? (task.taskType.split(":")[0] ?? "unresolved")
          : "unresolved";
        const history = taskHistoryByModule.get(moduleName) ?? [];
        history.push(`${task.taskType}:${task.status}`);
        taskHistoryByModule.set(moduleName, history.slice(0, 5));
      }

      const modules = collectModuleNames(findings, moduleHealthRows).map(
        (moduleName) => {
          const moduleHealth = moduleHealthRows.find(
            (row) => row.module === moduleName,
          );
          const latestFinding = latestFindingByModule.get(moduleName);
          const earliestFinding = earliestFindingByModule.get(moduleName);

          let state: StewardHealthState = "ok";
          let severity: StewardHealthSeverity = "info";
          let probableCause = latestFinding?.title;

          if (latestFinding?.severity === "critical") {
            state = "unavailable";
            severity = "critical";
          } else if (latestFinding?.severity === "warning") {
            state = "degraded";
            severity = "warning";
          } else if (latestFinding?.severity === "info") {
            state = "degraded";
            severity = "info";
          } else if (!moduleHealth?.lastRunAt) {
            state = "stale";
            severity = "warning";
            probableCause = "No module health checks recorded yet";
          }

          if (moduleHealth?.lastStatus === "unavailable") {
            state = "unavailable";
            severity = "high";
            probableCause =
              probableCause ?? "Most recent module run reported unavailable";
          } else if (
            moduleHealth?.lastStatus === "degraded" &&
            state === "ok"
          ) {
            state = "degraded";
            severity = "warning";
            probableCause =
              probableCause ?? "Most recent module run reported degraded";
          } else if (moduleHealth?.lastStatus === "misconfigured") {
            state = "misconfigured";
            severity = "high";
            probableCause =
              probableCause ?? "Module configuration is invalid or incomplete";
          }

          if (
            moduleHealth &&
            moduleHealth.errorCount > moduleHealth.successCount * 2
          ) {
            state = state === "ok" ? "degraded" : state;
            severity =
              severityRank[severity] < severityRank.high ? "high" : severity;
            probableCause =
              probableCause ?? "Recent runs show elevated error frequency";
          }

          const owner: StewardHealthOwner =
            state === "misconfigured" ? "admin" : "system";

          const firstSeenAt = toIsoOrUndefined(earliestFinding?.createdAt);
          const lastSeenAt = toIsoOrUndefined(
            latestFinding?.createdAt ?? moduleHealth?.lastRunAt,
          );
          const attemptedRepairs = taskHistoryByModule.get(moduleName) ?? [];

          const moduleHealthStatus: StewardModuleHealth = {
            module: moduleName,
            state,
            severity,
            attemptedRepairs,
            owner,
            ...(firstSeenAt ? { firstSeenAt } : {}),
            ...(lastSeenAt ? { lastSeenAt } : {}),
            ...(probableCause ? { probableCause } : {}),
          };

          return moduleHealthStatus;
        },
      );

      const worstModuleSeverity = modules.reduce<StewardHealthSeverity>(
        (acc, module) =>
          severityRank[module.severity] > severityRank[acc]
            ? module.severity
            : acc,
        "info",
      );
      const worstModuleState = modules.reduce<StewardHealthState>(
        (acc, module) =>
          stateRank[module.state] > stateRank[acc] ? module.state : acc,
        "ok",
      );

      const pendingTasks = tasks.filter(
        (task) => task.status === "pending",
      ).length;
      const baseScore = 100;
      const scorePenalty =
        openBySeverity.critical * 20 +
        openBySeverity.warning * 8 +
        modules.filter((module) => module.state === "stale").length * 5 +
        pendingTasks * 3 +
        Math.max(0, runtime.queueDepth - 5) * 2;
      const score = Math.max(0, Math.min(100, baseScore - scorePenalty));

      return {
        generatedAt: new Date().toISOString(),
        overall: {
          state: worstModuleState,
          severity: worstModuleSeverity,
          score,
        },
        incidents: {
          totalOpen:
            openBySeverity.info +
            openBySeverity.warning +
            openBySeverity.high +
            openBySeverity.critical,
          bySeverity: openBySeverity,
          pendingTasks,
        },
        runtime,
        modules,
      };
    },
  };
}

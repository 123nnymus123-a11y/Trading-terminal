export type AiStewardModule = "cftc" | "congress";

export type AiStewardMode = "off" | "observe" | "suggest" | "auto";

export type AiStewardSeverity = "info" | "warn" | "error";

export type AiStewardModuleStatus = "ok" | "degraded" | "failing";

export interface AiStewardModuleConfig {
  mode: AiStewardMode;
}

export interface AiStewardConfig {
  model: string;
  checkIntervalMinutes: number;
  autoFixData: boolean;
  modules: Record<AiStewardModule, AiStewardModuleConfig>;
}

export interface AiStewardModuleState {
  module: AiStewardModule;
  status: AiStewardModuleStatus;
  summary: string;
  lastRunAt?: number;
  lastSuccessAt?: number;
}

export interface AiStewardFinding {
  id: string;
  module: AiStewardModule;
  severity: AiStewardSeverity;
  title: string;
  detail: string;
  detectedAt: number;
  meta?: Record<string, unknown>;
}

export type AiStewardTaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed";

export interface AiStewardTask {
  id: string;
  module: AiStewardModule;
  kind: string;
  title: string;
  summary: string;
  detail?: string;
  severity: AiStewardSeverity;
  autoApplicable: boolean;
  status: AiStewardTaskStatus;
  createdAt: number;
  updatedAt: number;
  result?: string;
  autoApplied?: boolean;
}

export interface AiStewardOverview {
  config: AiStewardConfig;
  modules: AiStewardModuleState[];
  findings: AiStewardFinding[];
  tasks: AiStewardTask[];
  lastCheckAt?: number;
}

export interface AiStewardApplyResult {
  ok: boolean;
  message: string;
  task?: AiStewardTask;
}

export type AiStewardHealthState =
  | "ok"
  | "degraded"
  | "unavailable"
  | "stale"
  | "misconfigured";

export type AiStewardHealthSeverity = "info" | "warning" | "high" | "critical";

export interface AiStewardHealthModule {
  module: string;
  state: AiStewardHealthState;
  severity: AiStewardHealthSeverity;
  firstSeenAt?: string;
  lastSeenAt?: string;
  probableCause?: string;
  attemptedRepairs: string[];
  owner: "system" | "user" | "admin" | "unresolved";
}

export interface AiStewardHealthStatus {
  generatedAt: string;
  overall: {
    state: AiStewardHealthState;
    severity: AiStewardHealthSeverity;
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
  runtime: {
    queueDepth: number;
    queueRunning: number;
    migrationFlags: {
      backendOnlyProcessing: boolean;
      desktopLocalFallback: boolean;
      webPrimaryRouting: boolean;
    };
  };
  modules: AiStewardHealthModule[];
}

export type AiStewardIncidentDigest = {
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

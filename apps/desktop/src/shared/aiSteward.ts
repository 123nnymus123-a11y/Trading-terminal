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

export type AiStewardTaskStatus = "pending" | "running" | "completed" | "failed";

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

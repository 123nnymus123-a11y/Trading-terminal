import { create } from "zustand";
import { authRequest } from "../lib/apiClient";

export type StrategyStage =
  | "draft"
  | "candidate"
  | "validation"
  | "production"
  | "retired";

export type StrategyDefinition = {
  id: string;
  name: string;
  stage: StrategyStage;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  description?: string;
};

export type StrategyVersion = {
  id: string;
  strategyId: string;
  version: string;
  scriptLanguage: "javascript" | "typescript";
  scriptSource: string;
  scriptChecksum: string;
  universe: string[];
  assumptions: Record<string, unknown>;
  createdAt: string;
};

export type StrategyBacktestRun = {
  runId: string;
  strategyId: string;
  strategyVersion: string;
  datasetSnapshotId?: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  executionMode?: "desktop-local" | "backend";
  requestedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  metrics?: {
    totalReturn?: number;
    sharpeRatio?: number;
    maxDrawdown?: number;
    winRate?: number;
    numTrades?: number;
    endingCapital?: number;
    startingCapital?: number;
    annualizedReturn?: number;
    annualizedVolatility?: number;
    cagr?: number;
    sortinoRatio?: number;
    calmarRatio?: number;
    turnoverPct?: number;
    exposureUtilizationPct?: number;
    expectancy?: number;
    averageHoldingPeriodBars?: number;
    engineVersion?: string;
    benchmarkSymbol?: string;
    longShort?: unknown;
    tailRisk?: unknown;
    alphaBeta?: unknown;
    sectorAttribution?: unknown;
    factorAttribution?: unknown;
    monthlyReturns?: unknown;
    [key: string]: unknown;
  };
  equityCurve?: Array<{ timestamp: string; value: number }>;
  trades?: Array<{
    timestamp: string;
    symbol: string;
    side: "buy" | "sell";
    quantity: number;
    price: number;
    fees: number;
    slippage: number;
  }>;
  historicalData?: {
    symbols: string[];
    source: string;
    cacheDir: string;
  };
  runMetadata?: {
    engineVersion?: string;
    datasetSnapshotId?: string;
    datasetChecksumSha256?: string;
    strategyChecksumSha256?: string;
    assumptionsChecksumSha256?: string;
    assumptionsFrozen?: Record<string, unknown>;
  };
  runLogs?: string[];
};

export type BacktestRunRequest = {
  strategyId: string;
  strategyVersion: string;
  datasetSnapshotId?: string;
  executionMode?: "desktop-local" | "backend";
  assumptions?: Record<string, unknown>;
};

type LocalWorkspace = {
  strategies: StrategyDefinition[];
  versions: Record<string, StrategyVersion>;
  runs: StrategyBacktestRun[];
  comparisonNotes: Array<{
    id: string;
    strategyId: string;
    primaryRunId: string;
    baselineRunId: string;
    note: string;
    createdAt: string;
    updatedAt: string;
  }>;
};

type StrategyResearchState = {
  strategies: StrategyDefinition[];
  selectedStrategyId: string | null;
  currentStrategy: StrategyDefinition | null;
  currentVersion: StrategyVersion | null;
  scriptDraft: string;
  universeFilter: string[];
  assumptionsDraft: Record<string, unknown>;
  backtestRuns: StrategyBacktestRun[];
  selectedRunId: string | null;
  selectedRun: StrategyBacktestRun | null;
  activeTab: "list" | "editor" | "runs" | "details";
  loading: boolean;
  error: string | null;
  notice: string | null;
  syncMode: "cloud" | "local";
  comparisonNotes: Record<string, string>;
  loadStrategies: () => Promise<void>;
  selectStrategy: (strategyId: string) => Promise<void>;
  createStrategy: (name: string, description?: string) => Promise<void>;
  updateScriptDraft: (script: string) => void;
  updateAssumptions: (assumptions: Record<string, unknown>) => void;
  updateUniverse: (universe: string[]) => void;
  saveStrategy: () => Promise<void>;
  enqueueBacktest: (request: BacktestRunRequest) => Promise<string>;
  loadBacktestRuns: (strategyId?: string) => Promise<void>;
  selectRun: (runId: string) => void;
  cancelRun: (runId: string) => Promise<void>;
  clearError: () => void;
  clearNotice: () => void;
  setActiveTab: (tab: "list" | "editor" | "runs" | "details") => void;
  saveComparisonNote: (
    primaryRunId: string,
    baselineRunId: string,
    note: string,
  ) => Promise<void>;
  importBacktestArtifact: (artifact: unknown) => Promise<void>;
  downloadHistoricalData: (symbols?: string[]) => Promise<{
    downloaded: number;
    fromCache: number;
    failed: string[];
    cacheDir: string;
  }>;
};

function createDefaultScript(): string {
  return `function onBar(ctx) {
  const bar = currentBar();
  const prev = previousBar();
  if (!bar || !prev || bar.symbol !== prev.symbol) {
    return [hold()];
  }

  const momentumUp = bar.close > prev.close;
  const position = ctx.positions.get(bar.symbol) ?? 0;

  if (momentumUp && position === 0) {
    return [buy(bar.symbol)];
  }

  if (!momentumUp && position > 0) {
    return [sell(bar.symbol, position)];
  }

  return [hold()];
}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function normalizeSymbols(symbols: string[]): string[] {
  return Array.from(
    new Set(
      symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean),
    ),
  );
}

function isAuthError(error: unknown): boolean {
  return /authentication_required|api_error:401|unauthorized/i.test(
    String(error),
  );
}

function formatError(error: unknown): string {
  const raw = String(error ?? "unknown_error");
  if (isAuthError(error)) {
    return "Cloud sign-in is required for synced strategies. Local workspace mode is available.";
  }

  const apiMatch = raw.match(/^api_error:(\d+):(.*)$/i);
  if (apiMatch && apiMatch[2]) {
    try {
      const payload = JSON.parse(apiMatch[2]) as {
        error?: string;
        diagnostics?: {
          errors?: Array<{ message?: string }>;
          warnings?: Array<{ message?: string }>;
        };
      };
      if (payload?.error === "backtest_pre_run_validation_failed") {
        const errors = Array.isArray(payload?.diagnostics?.errors)
          ? payload
              .diagnostics!.errors!.map((item) => item?.message)
              .filter(
                (message): message is string =>
                  typeof message === "string" && message.trim().length > 0,
              )
          : [];
        if (errors.length > 0) {
          return `Pre-run validation failed: ${errors.join(" | ")}`;
        }
      }
    } catch {
      // Fall back to raw error.
    }
  }

  return raw.replace(/^Error:\s*/i, "");
}

function validateLocalPreflight(
  scriptSource: string,
  universe: string[],
  assumptions: Record<string, unknown>,
): string[] {
  const issues: string[] = [];

  if (!scriptSource.trim()) {
    issues.push("Strategy script cannot be empty.");
  }

  if (!/function\s+onBar\s*\(/.test(scriptSource)) {
    issues.push("Strategy script must define function onBar(ctx). ");
  }

  if (universe.length === 0) {
    issues.push("Add at least one symbol to the universe.");
  }

  const initialCapital = assumptions.initialCapital;
  if (typeof initialCapital === "number" && initialCapital <= 0) {
    issues.push("initialCapital must be greater than 0.");
  }

  const slippage = assumptions.slippage;
  if (typeof slippage === "number" && (slippage < 0 || slippage > 5000)) {
    issues.push("slippage must be between 0 and 5000 bps.");
  }

  const commissionPercent = assumptions.commissionPercent;
  if (
    typeof commissionPercent === "number" &&
    (commissionPercent < 0 || commissionPercent > 100)
  ) {
    issues.push("commissionPercent must be between 0 and 100.");
  }

  return issues;
}

function emptyWorkspace(): LocalWorkspace {
  return { strategies: [], versions: {}, runs: [], comparisonNotes: [] };
}

function comparisonNoteKey(
  strategyId: string,
  primaryRunId: string,
  baselineRunId: string,
): string {
  return `${strategyId}::${primaryRunId}::${baselineRunId}`;
}

function toComparisonNoteMap(
  notes: LocalWorkspace["comparisonNotes"],
  strategyId?: string,
): Record<string, string> {
  const filtered = strategyId
    ? notes.filter((item) => item.strategyId === strategyId)
    : notes;
  const map: Record<string, string> = {};
  for (const item of filtered) {
    map[
      comparisonNoteKey(item.strategyId, item.primaryRunId, item.baselineRunId)
    ] = item.note;
  }
  return map;
}

async function loadLocalWorkspace(): Promise<LocalWorkspace> {
  try {
    const payload =
      await window.cockpit?.strategyResearch?.loadLocalWorkspace?.();
    if (!payload || typeof payload !== "object") {
      return emptyWorkspace();
    }

    const strategies = Array.isArray((payload as any).strategies)
      ? (payload as any).strategies.map(normalizeStrategy)
      : [];

    const rawVersions =
      (payload as any).versions && typeof (payload as any).versions === "object"
        ? ((payload as any).versions as Record<string, unknown>)
        : {};
    const versions: Record<string, StrategyVersion> = {};
    for (const [strategyId, value] of Object.entries(rawVersions)) {
      versions[strategyId] = normalizeVersion(value);
    }

    const runs = Array.isArray((payload as any).runs)
      ? (payload as any).runs.map(normalizeRun)
      : [];

    const comparisonNotes = Array.isArray((payload as any).comparisonNotes)
      ? (payload as any).comparisonNotes
          .map((item) => ({
            id: String(item?.id ?? createId("cmp")),
            strategyId: String(item?.strategyId ?? ""),
            primaryRunId: String(item?.primaryRunId ?? ""),
            baselineRunId: String(item?.baselineRunId ?? ""),
            note: typeof item?.note === "string" ? item.note : "",
            createdAt: String(item?.createdAt ?? nowIso()),
            updatedAt: String(item?.updatedAt ?? nowIso()),
          }))
          .filter(
            (item) =>
              item.strategyId.trim().length > 0 &&
              item.primaryRunId.trim().length > 0 &&
              item.baselineRunId.trim().length > 0,
          )
      : [];

    return { strategies, versions, runs, comparisonNotes };
  } catch {
    return emptyWorkspace();
  }
}

async function persistLocalStrategy(
  strategy: StrategyDefinition,
): Promise<void> {
  await window.cockpit?.strategyResearch?.upsertLocalStrategy?.({
    id: strategy.id,
    name: strategy.name,
    description: strategy.description,
    stage: strategy.stage,
    tags: strategy.tags,
    createdAt: strategy.createdAt,
    updatedAt: strategy.updatedAt,
  });
}

async function persistLocalVersion(version: StrategyVersion): Promise<void> {
  await window.cockpit?.strategyResearch?.upsertLocalVersion?.({
    id: version.id,
    strategyId: version.strategyId,
    version: version.version,
    scriptLanguage: version.scriptLanguage,
    scriptSource: version.scriptSource,
    scriptChecksum: version.scriptChecksum,
    universe: version.universe,
    assumptions: version.assumptions,
    createdAt: version.createdAt,
  });
}

async function persistLocalRun(run: StrategyBacktestRun): Promise<void> {
  await window.cockpit?.strategyResearch?.upsertLocalRun?.({
    runId: run.runId,
    strategyId: run.strategyId,
    strategyVersion: run.strategyVersion,
    status: run.status,
    executionMode: run.executionMode ?? "desktop-local",
    requestedAt: run.requestedAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    error: run.error,
    metrics: run.metrics,
    equityCurve: run.equityCurve,
    trades: run.trades as Array<Record<string, unknown>> | undefined,
    historicalData: run.historicalData as Record<string, unknown> | undefined,
    runMetadata: run.runMetadata,
    runLogs: run.runLogs,
  });
}

async function persistLocalComparisonNote(payload: {
  strategyId: string;
  primaryRunId: string;
  baselineRunId: string;
  note: string;
}): Promise<void> {
  const now = nowIso();
  const id = comparisonNoteKey(
    payload.strategyId,
    payload.primaryRunId,
    payload.baselineRunId,
  );
  await window.cockpit?.strategyResearch?.upsertLocalComparisonNote?.({
    id,
    strategyId: payload.strategyId,
    primaryRunId: payload.primaryRunId,
    baselineRunId: payload.baselineRunId,
    note: payload.note,
    createdAt: now,
    updatedAt: now,
  });
}

function normalizeStrategy(input: any): StrategyDefinition {
  const stage =
    input?.stage === "retired" ||
    input?.stage === "candidate" ||
    input?.stage === "validation" ||
    input?.stage === "production" ||
    input?.stage === "draft"
      ? input.stage
      : "candidate";
  return {
    id: String(input?.id ?? input?.strategyId ?? createId("strat")),
    name: String(input?.name ?? "Untitled Strategy"),
    stage,
    tags: Array.isArray(input?.tags) ? input.tags.map(String) : [],
    createdAt: String(input?.createdAt ?? nowIso()),
    updatedAt: String(input?.updatedAt ?? nowIso()),
    description:
      typeof input?.description === "string" ? input.description : undefined,
  };
}

function normalizeVersion(input: any): StrategyVersion {
  return {
    id: String(input?.id ?? createId("ver")),
    strategyId: String(input?.strategyId ?? ""),
    version: String(input?.version ?? "v1"),
    scriptLanguage:
      input?.scriptLanguage === "typescript" ? "typescript" : "javascript",
    scriptSource:
      typeof input?.scriptSource === "string" && input.scriptSource.trim()
        ? input.scriptSource
        : createDefaultScript(),
    scriptChecksum: String(input?.scriptChecksum ?? "local"),
    universe: normalizeSymbols(
      Array.isArray(input?.universe) ? input.universe : [],
    ),
    assumptions:
      input?.assumptions && typeof input.assumptions === "object"
        ? { ...input.assumptions }
        : {},
    createdAt: String(input?.createdAt ?? nowIso()),
  };
}

function normalizeMetricPercent(value: unknown): number | undefined {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return undefined;
  }
  return Math.abs(value) > 1 ? value / 100 : value;
}

function normalizeRun(input: any): StrategyBacktestRun {
  const winningTrades =
    typeof input?.metrics?.winningTrades === "number"
      ? input.metrics.winningTrades
      : 0;
  const losingTrades =
    typeof input?.metrics?.losingTrades === "number"
      ? input.metrics.losingTrades
      : 0;
  const totalClosedTrades = winningTrades + losingTrades;
  const rawMetrics =
    input?.metrics && typeof input.metrics === "object" ? input.metrics : null;

  return {
    runId: String(input?.runId ?? createId("run")),
    strategyId: String(input?.strategyId ?? ""),
    strategyVersion: String(input?.strategyVersion ?? "v1"),
    datasetSnapshotId:
      typeof input?.datasetSnapshotId === "string"
        ? input.datasetSnapshotId
        : typeof input?.snapshotId === "string"
          ? input.snapshotId
          : undefined,
    status:
      input?.status === "running" ||
      input?.status === "completed" ||
      input?.status === "failed" ||
      input?.status === "cancelled"
        ? input.status
        : "queued",
    executionMode:
      input?.executionMode === "backend" ? "backend" : "desktop-local",
    requestedAt:
      typeof input?.requestedAt === "string" ? input.requestedAt : undefined,
    startedAt:
      typeof input?.startedAt === "string" ? input.startedAt : undefined,
    finishedAt:
      typeof input?.finishedAt === "string" ? input.finishedAt : undefined,
    error: typeof input?.error === "string" ? input.error : undefined,
    metrics: rawMetrics
      ? {
          ...rawMetrics,
          totalReturn: normalizeMetricPercent(rawMetrics.totalReturn),
          sharpeRatio:
            typeof rawMetrics.sharpeRatio === "number"
              ? rawMetrics.sharpeRatio
              : undefined,
          maxDrawdown: normalizeMetricPercent(rawMetrics.maxDrawdown),
          numTrades:
            typeof rawMetrics.numTrades === "number"
              ? rawMetrics.numTrades
              : undefined,
          endingCapital:
            typeof rawMetrics.endingCapital === "number"
              ? rawMetrics.endingCapital
              : undefined,
          startingCapital:
            typeof rawMetrics.startingCapital === "number"
              ? rawMetrics.startingCapital
              : undefined,
          annualizedReturn: normalizeMetricPercent(rawMetrics.annualizedReturn),
          annualizedVolatility: normalizeMetricPercent(
            rawMetrics.annualizedVolatility,
          ),
          cagr: normalizeMetricPercent(rawMetrics.cagr),
          sortinoRatio:
            typeof rawMetrics.sortinoRatio === "number"
              ? rawMetrics.sortinoRatio
              : undefined,
          calmarRatio:
            typeof rawMetrics.calmarRatio === "number"
              ? rawMetrics.calmarRatio
              : undefined,
          turnoverPct: normalizeMetricPercent(rawMetrics.turnoverPct),
          exposureUtilizationPct: normalizeMetricPercent(
            rawMetrics.exposureUtilizationPct,
          ),
          expectancy:
            typeof rawMetrics.expectancy === "number"
              ? rawMetrics.expectancy
              : undefined,
          averageHoldingPeriodBars:
            typeof rawMetrics.averageHoldingPeriodBars === "number"
              ? rawMetrics.averageHoldingPeriodBars
              : undefined,
          winRate:
            typeof rawMetrics.winRate === "number"
              ? rawMetrics.winRate
              : totalClosedTrades > 0
                ? winningTrades / totalClosedTrades
                : undefined,
        }
      : undefined,
    equityCurve: Array.isArray(input?.equityCurve)
      ? input.equityCurve
      : undefined,
    trades: Array.isArray(input?.trades) ? input.trades : undefined,
    historicalData:
      input?.historicalData && typeof input.historicalData === "object"
        ? {
            symbols: Array.isArray(input.historicalData.symbols)
              ? input.historicalData.symbols.map(String)
              : [],
            source: String(input.historicalData.source ?? "local"),
            cacheDir: String(input.historicalData.cacheDir ?? ""),
          }
        : undefined,
    runMetadata:
      input?.runMetadata && typeof input.runMetadata === "object"
        ? {
            engineVersion:
              typeof input.runMetadata.engineVersion === "string"
                ? input.runMetadata.engineVersion
                : undefined,
            datasetSnapshotId:
              typeof input.runMetadata.datasetSnapshotId === "string"
                ? input.runMetadata.datasetSnapshotId
                : undefined,
            datasetChecksumSha256:
              typeof input.runMetadata.datasetChecksumSha256 === "string"
                ? input.runMetadata.datasetChecksumSha256
                : undefined,
            strategyChecksumSha256:
              typeof input.runMetadata.strategyChecksumSha256 === "string"
                ? input.runMetadata.strategyChecksumSha256
                : undefined,
            assumptionsChecksumSha256:
              typeof input.runMetadata.assumptionsChecksumSha256 === "string"
                ? input.runMetadata.assumptionsChecksumSha256
                : undefined,
            assumptionsFrozen:
              input.runMetadata.assumptionsFrozen &&
              typeof input.runMetadata.assumptionsFrozen === "object"
                ? input.runMetadata.assumptionsFrozen
                : undefined,
          }
        : undefined,
    runLogs: Array.isArray(input?.runLogs)
      ? input.runLogs.map(String)
      : undefined,
  };
}

function getWorkspaceVersion(
  workspace: LocalWorkspace,
  strategyId: string,
): StrategyVersion | null {
  return workspace.versions[strategyId] ?? null;
}

export const useStrategyResearchStore = create<StrategyResearchState>(
  (set, get) => ({
    strategies: [],
    selectedStrategyId: null,
    currentStrategy: null,
    currentVersion: null,
    scriptDraft: createDefaultScript(),
    universeFilter: ["AAPL", "MSFT", "SPY"],
    assumptionsDraft: {
      positionSize: 10,
      commissionPercent: 0.05,
      slippage: 2,
      initialCapital: 100000,
    },
    backtestRuns: [],
    selectedRunId: null,
    selectedRun: null,
    activeTab: "list",
    loading: false,
    error: null,
    notice: null,
    syncMode: "cloud",
    comparisonNotes: {},

    loadStrategies: async () => {
      set({ loading: true, error: null });
      try {
        const data = await authRequest<{ strategies: any[] }>(
          "/api/strategies",
          {
            method: "GET",
          },
        );
        set({
          strategies: (data.strategies ?? []).map(normalizeStrategy),
          syncMode: "cloud",
          notice: null,
        });
      } catch (error) {
        const localWorkspace = await loadLocalWorkspace();
        set({
          strategies: localWorkspace.strategies,
          comparisonNotes: toComparisonNoteMap(localWorkspace.comparisonNotes),
          syncMode: "local",
          notice: isAuthError(error)
            ? "Cloud sync is unavailable right now. Strategy Research is running in local workspace mode."
            : formatError(error),
        });
      } finally {
        set({ loading: false });
      }
    },

    selectStrategy: async (strategyId: string) => {
      set({ loading: true, error: null });
      try {
        const data = await authRequest<{ strategy: any; version: any }>(
          `/api/strategies/${strategyId}`,
          { method: "GET" },
        );
        const strategy = normalizeStrategy(data.strategy);
        const version = normalizeVersion(data.version);
        set({
          selectedStrategyId: strategyId,
          currentStrategy: strategy,
          currentVersion: version,
          scriptDraft: version.scriptSource,
          universeFilter: version.universe,
          assumptionsDraft: version.assumptions,
          syncMode: "cloud",
          notice: null,
        });
      } catch (error) {
        const localWorkspace = await loadLocalWorkspace();
        const strategy =
          localWorkspace.strategies.find((item) => item.id === strategyId) ??
          null;
        const version = getWorkspaceVersion(localWorkspace, strategyId);
        if (!strategy) {
          set({
            loading: false,
            error: "Selected strategy could not be found.",
          });
          return;
        }
        set({
          selectedStrategyId: strategyId,
          currentStrategy: strategy,
          currentVersion: version,
          scriptDraft: version?.scriptSource ?? createDefaultScript(),
          universeFilter: version?.universe ?? ["AAPL", "MSFT", "SPY"],
          assumptionsDraft: version?.assumptions ?? {
            positionSize: 10,
            commissionPercent: 0.05,
            slippage: 2,
            initialCapital: 100000,
          },
          comparisonNotes: toComparisonNoteMap(
            localWorkspace.comparisonNotes,
            strategyId,
          ),
          syncMode: "local",
          notice: isAuthError(error)
            ? "Cloud sync is unavailable right now. Using the local copy of this strategy."
            : formatError(error),
        });
      } finally {
        set({ loading: false });
      }
    },

    createStrategy: async (name: string, description?: string) => {
      set({ loading: true, error: null });
      const trimmedName = name.trim();
      const trimmedDescription = description?.trim() || undefined;
      if (!trimmedName) {
        set({ loading: false, error: "Strategy name is required." });
        return;
      }

      try {
        const data = await authRequest<{ strategy: any }>("/api/strategies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: trimmedName,
            description: trimmedDescription,
          }),
        });
        const strategy = normalizeStrategy(data.strategy);
        set((state) => ({
          strategies: [...state.strategies, strategy],
          selectedStrategyId: strategy.id,
          currentStrategy: strategy,
          currentVersion: null,
          scriptDraft: createDefaultScript(),
          universeFilter: ["AAPL", "MSFT", "SPY"],
          assumptionsDraft: {
            positionSize: 10,
            commissionPercent: 0.05,
            slippage: 2,
            initialCapital: 100000,
          },
          syncMode: "cloud",
          notice: null,
        }));
        return;
      } catch (error) {
        const strategy: StrategyDefinition = {
          id: createId("strat"),
          name: trimmedName,
          description: trimmedDescription,
          stage: "draft",
          tags: [],
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        await persistLocalStrategy(strategy);
        const nextWorkspace = await loadLocalWorkspace();
        set((state) => ({
          strategies:
            nextWorkspace.strategies.length > 0
              ? nextWorkspace.strategies
              : [
                  ...state.strategies.filter((item) => item.id !== strategy.id),
                  strategy,
                ],
          selectedStrategyId: strategy.id,
          currentStrategy: strategy,
          currentVersion: null,
          scriptDraft: createDefaultScript(),
          universeFilter: ["AAPL", "MSFT", "SPY"],
          assumptionsDraft: {
            positionSize: 10,
            commissionPercent: 0.05,
            slippage: 2,
            initialCapital: 100000,
          },
          syncMode: "local",
          notice: isAuthError(error)
            ? "Created locally. Sign in later if you want cloud sync."
            : formatError(error),
        }));
      } finally {
        set({ loading: false });
      }
    },

    updateScriptDraft: (script: string) => {
      set({ scriptDraft: script });
    },

    updateAssumptions: (assumptions: Record<string, unknown>) => {
      set({ assumptionsDraft: assumptions });
    },

    updateUniverse: (universe: string[]) => {
      set({ universeFilter: normalizeSymbols(universe) });
    },

    saveStrategy: async () => {
      set({ loading: true, error: null });
      const state = get();
      if (!state.selectedStrategyId) {
        set({ loading: false, error: "Select or create a strategy first." });
        return;
      }

      const normalizedUniverse = normalizeSymbols(state.universeFilter);
      if (normalizedUniverse.length === 0) {
        set({
          loading: false,
          error: "Add at least one ticker to the universe before saving.",
        });
        return;
      }

      try {
        const data = await authRequest<{ version: any }>(
          "/api/strategy/versions",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              strategyId: state.selectedStrategyId,
              scriptLanguage: "javascript",
              scriptEntrypoint: "onBar",
              scriptSource: state.scriptDraft,
              universe: normalizedUniverse,
              assumptions: state.assumptionsDraft,
            }),
          },
        );
        const version = normalizeVersion(data.version);
        set({
          currentVersion: version,
          universeFilter: version.universe,
          assumptionsDraft: version.assumptions,
          syncMode: "cloud",
          notice: null,
        });
        return;
      } catch (error) {
        const persistedNow = nowIso();
        const currentStrategy = state.currentStrategy;
        const strategyForLocal: StrategyDefinition = {
          id: state.selectedStrategyId,
          name: currentStrategy?.name ?? "Untitled Strategy",
          description: currentStrategy?.description,
          stage:
            currentStrategy?.stage === "draft"
              ? "candidate"
              : (currentStrategy?.stage ?? "candidate"),
          tags: currentStrategy?.tags ?? [],
          createdAt: currentStrategy?.createdAt ?? persistedNow,
          updatedAt: persistedNow,
        };
        const version: StrategyVersion = {
          id: createId("ver"),
          strategyId: state.selectedStrategyId,
          version: `v${Date.now()}`,
          scriptLanguage: "javascript",
          scriptSource: state.scriptDraft,
          scriptChecksum: `local-${Date.now()}`,
          universe: normalizedUniverse,
          assumptions: state.assumptionsDraft,
          createdAt: nowIso(),
        };
        await persistLocalStrategy(strategyForLocal);
        await persistLocalVersion(version);
        const nextWorkspace = await loadLocalWorkspace();
        set({
          strategies:
            nextWorkspace.strategies.length > 0
              ? nextWorkspace.strategies
              : get().strategies,
          currentStrategy: strategyForLocal,
          currentVersion: version,
          comparisonNotes: toComparisonNoteMap(
            nextWorkspace.comparisonNotes,
            state.selectedStrategyId,
          ),
          syncMode: "local",
          notice: isAuthError(error)
            ? "Saved locally. Sign in later if you want cloud sync."
            : formatError(error),
        });
      } finally {
        set({ loading: false });
      }
    },

    enqueueBacktest: async (request: BacktestRunRequest) => {
      set({ loading: true, error: null });
      const normalizedExecutionMode = request.executionMode ?? "backend";
      try {
        if (normalizedExecutionMode === "backend") {
          const response = await authRequest<{ runId: string; status: string }>(
            "/api/strategy/backtest/runs",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                strategyId: request.strategyId,
                strategyVersion: request.strategyVersion,
                datasetSnapshotId:
                  request.datasetSnapshotId ?? "mock-snapshot-1",
                executionMode: "backend",
                assumptions: request.assumptions ?? {},
              }),
            },
          );
          await get().loadBacktestRuns(request.strategyId);
          set({ syncMode: "cloud", notice: null, loading: false });
          return response.runId;
        }
      } catch (error) {
        if (!isAuthError(error)) {
          set({ error: formatError(error), loading: false });
          throw error;
        }
        set({
          notice:
            "Cloud backtesting is unavailable right now. Falling back to desktop-local execution with downloadable daily stock data.",
          syncMode: "local",
        });
      }

      try {
        const state = get();
        const localUniverse = normalizeSymbols(state.universeFilter);
        const localAssumptions = {
          ...(request.assumptions ?? state.assumptionsDraft),
        };
        const preflightIssues = validateLocalPreflight(
          state.scriptDraft,
          localUniverse,
          localAssumptions,
        );
        if (preflightIssues.length > 0) {
          throw new Error(
            `Pre-run validation failed: ${preflightIssues.join(" | ")}`,
          );
        }

        const localRunId = createId("run");
        const result =
          await window.cockpit?.strategyResearch?.runLocalBacktest?.({
            runId: localRunId,
            strategyId: request.strategyId,
            strategyVersion: request.strategyVersion,
            scriptSource: state.scriptDraft,
            universe: localUniverse,
            assumptions: localAssumptions,
          });

        if (!result) {
          throw new Error("Local backtest service is unavailable.");
        }

        const run = normalizeRun(result);
        await persistLocalRun(run);
        const nextWorkspace = await loadLocalWorkspace();
        const localRuns =
          nextWorkspace.runs.length > 0
            ? nextWorkspace.runs
            : [
                run,
                ...get().backtestRuns.filter(
                  (item) => item.runId !== run.runId,
                ),
              ];
        set({
          backtestRuns: localRuns,
          selectedRunId: run.runId,
          selectedRun: run,
          comparisonNotes: toComparisonNoteMap(
            nextWorkspace.comparisonNotes,
            request.strategyId,
          ),
          syncMode: "local",
          notice: run.historicalData
            ? `Desktop-local backtest completed using downloadable daily data cached at ${run.historicalData.cacheDir}.`
            : "Desktop-local backtest completed.",
        });
        return run.runId;
      } catch (error) {
        set({ error: formatError(error) });
        throw error;
      } finally {
        set({ loading: false });
      }
    },

    loadBacktestRuns: async (strategyId?: string) => {
      set({ loading: true, error: null });
      try {
        const url = strategyId
          ? `/api/strategy/backtest/runs?strategyId=${encodeURIComponent(strategyId)}`
          : "/api/strategy/backtest/runs";
        const data = await authRequest<{ runs: any[] }>(url, { method: "GET" });
        set({
          backtestRuns: (data.runs ?? []).map(normalizeRun),
          syncMode: "cloud",
          notice: null,
        });
      } catch (error) {
        const localWorkspace = await loadLocalWorkspace();
        const runs = (
          strategyId
            ? localWorkspace.runs.filter(
                (item) => item.strategyId === strategyId,
              )
            : localWorkspace.runs
        ).map(normalizeRun);
        set({
          backtestRuns: runs,
          comparisonNotes: toComparisonNoteMap(
            localWorkspace.comparisonNotes,
            strategyId,
          ),
          syncMode: "local",
          notice: isAuthError(error)
            ? "Showing locally saved backtest runs. Sign in to see synced cloud runs."
            : formatError(error),
        });
      } finally {
        set({ loading: false });
      }
    },

    selectRun: (runId: string) => {
      const run =
        get().backtestRuns.find((item) => item.runId === runId) ?? null;
      set({ selectedRunId: runId, selectedRun: run, activeTab: "details" });
    },

    cancelRun: async (runId: string) => {
      set({ error: null });
      try {
        await authRequest(`/api/strategy/backtest/runs/${runId}/cancel`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        await get().loadBacktestRuns();
      } catch (error) {
        set({ error: formatError(error) });
      }
    },

    clearError: () => {
      set({ error: null });
    },

    clearNotice: () => {
      set({ notice: null });
    },

    setActiveTab: (tab: "list" | "editor" | "runs" | "details") => {
      set({ activeTab: tab });
    },

    saveComparisonNote: async (
      primaryRunId: string,
      baselineRunId: string,
      note: string,
    ) => {
      const state = get();
      if (!state.selectedStrategyId) {
        return;
      }
      await persistLocalComparisonNote({
        strategyId: state.selectedStrategyId,
        primaryRunId,
        baselineRunId,
        note,
      });
      const nextWorkspace = await loadLocalWorkspace();
      set((current) => ({
        comparisonNotes: {
          ...current.comparisonNotes,
          ...toComparisonNoteMap(
            nextWorkspace.comparisonNotes,
            state.selectedStrategyId,
          ),
        },
      }));
    },

    importBacktestArtifact: async (artifact: unknown) => {
      const payload = artifact as {
        run?: unknown;
      };
      if (!payload || typeof payload !== "object") {
        throw new Error("Artifact payload is invalid.");
      }

      const normalized = normalizeRun(payload.run ?? payload);
      if (!normalized.strategyId || !normalized.strategyVersion) {
        throw new Error(
          "Artifact is missing strategyId/strategyVersion in run payload.",
        );
      }

      const importedRun: StrategyBacktestRun = {
        ...normalized,
        runId:
          normalized.runId && normalized.runId.trim().length > 0
            ? `import-${normalized.runId}`
            : createId("import-run"),
        status:
          normalized.status === "failed" || normalized.status === "cancelled"
            ? normalized.status
            : "completed",
        executionMode: normalized.executionMode ?? "desktop-local",
        requestedAt: normalized.requestedAt ?? nowIso(),
      };

      await persistLocalRun(importedRun);
      const workspace = await loadLocalWorkspace();

      set((current) => ({
        syncMode: "local",
        backtestRuns:
          workspace.runs.length > 0
            ? workspace.runs
            : [
                importedRun,
                ...current.backtestRuns.filter(
                  (run) => run.runId !== importedRun.runId,
                ),
              ],
        selectedRunId: importedRun.runId,
        selectedRun: importedRun,
        notice:
          "Backtest artifact imported and replayed into local run history.",
      }));
    },

    downloadHistoricalData: async (symbols?: string[]) => {
      const state = get();
      const requestedSymbols = normalizeSymbols(
        symbols ?? state.universeFilter,
      );
      if (requestedSymbols.length === 0) {
        throw new Error(
          "Add at least one ticker before downloading historical data.",
        );
      }
      const result =
        await window.cockpit?.strategyResearch?.downloadHistoricalData?.(
          requestedSymbols,
        );
      if (!result) {
        throw new Error("Historical data download service is unavailable.");
      }
      set({
        notice: `Historical data ready: ${result.downloaded} downloaded, ${result.fromCache} loaded from cache. Cache folder: ${result.cacheDir}`,
      });
      return {
        downloaded: result.downloaded,
        fromCache: result.fromCache,
        failed: result.failed,
        cacheDir: result.cacheDir,
      };
    },
  }),
);

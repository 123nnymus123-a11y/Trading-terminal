import React, { useEffect, useMemo, useState } from "react";
import { authRequest } from "../lib/apiClient";
import { useStrategyResearchStore } from "../store/strategyResearchStore";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

async function sha256Hex(input: string): Promise<string> {
  if (typeof globalThis.crypto?.subtle === "undefined") {
    return "sha256_unavailable";
  }
  const encoded = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoded);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function formatPercent(value?: number) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "--";
  }
  return `${(value * 100).toFixed(2)}%`;
}

function formatMoney(value?: number) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "--";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDelta(value?: number, asPercent = false) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "--";
  }
  const sign = value > 0 ? "+" : "";
  if (asPercent) {
    return `${sign}${(value * 100).toFixed(2)}%`;
  }
  return `${sign}${value.toFixed(2)}`;
}

function formatNumber(value?: number, digits = 2) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "--";
  }
  return value.toFixed(digits);
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

type BacktestDatasetSnapshot = {
  id: string;
  name: string;
  version: string;
  snapshotAtIso: string;
  rowCount?: number | null;
  sourceManifest?: Record<string, unknown>;
  checksumSha256: string;
};

function formatSnapshotLabel(snapshot: BacktestDatasetSnapshot): string {
  const dateLabel = new Date(snapshot.snapshotAtIso).toLocaleDateString();
  return `${snapshot.name} @ ${snapshot.version} (${dateLabel})`;
}

function EquityCurveChart({
  points,
}: {
  points?: Array<{ timestamp: string; value: number }>;
}) {
  const normalized = useMemo(() => {
    if (!points || points.length < 2) {
      return null;
    }

    const width = 720;
    const height = 240;
    const padding = 24;
    const values = points.map((point) => point.value);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const span = Math.max(maxValue - minValue, 1);
    const path = points
      .map((point, index) => {
        const x =
          padding +
          (index / Math.max(points.length - 1, 1)) * (width - padding * 2);
        const y =
          height -
          padding -
          ((point.value - minValue) / span) * (height - padding * 2);
        return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");

    return { width, height, padding, minValue, maxValue, path };
  }, [points]);

  if (!normalized || !points) {
    return (
      <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>
        No equity curve available for this run yet.
      </div>
    );
  }

  const firstLabel = points[0]?.timestamp ?? "";
  const lastLabel = points[points.length - 1]?.timestamp ?? "";

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 8,
        padding: 16,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
        Equity Curve
      </div>
      <svg
        viewBox={`0 0 ${normalized.width} ${normalized.height}`}
        style={{ width: "100%", height: 240, display: "block" }}
      >
        <defs>
          <linearGradient id="strategy-equity-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(52,211,153,0.35)" />
            <stop offset="100%" stopColor="rgba(52,211,153,0.02)" />
          </linearGradient>
        </defs>
        <rect
          x="0"
          y="0"
          width={normalized.width}
          height={normalized.height}
          rx="12"
          fill="rgba(8,15,28,0.7)"
        />
        <line
          x1={normalized.padding}
          y1={normalized.height - normalized.padding}
          x2={normalized.width - normalized.padding}
          y2={normalized.height - normalized.padding}
          stroke="rgba(255,255,255,0.12)"
        />
        <line
          x1={normalized.padding}
          y1={normalized.padding}
          x2={normalized.padding}
          y2={normalized.height - normalized.padding}
          stroke="rgba(255,255,255,0.12)"
        />
        <path
          d={`${normalized.path} L${normalized.width - normalized.padding},${normalized.height - normalized.padding} L${normalized.padding},${normalized.height - normalized.padding} Z`}
          fill="url(#strategy-equity-fill)"
        />
        <path
          d={normalized.path}
          fill="none"
          stroke="#34d399"
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 11,
          color: "rgba(255,255,255,0.6)",
          marginTop: 8,
        }}
      >
        <span>{firstLabel}</span>
        <span>{formatMoney(normalized.minValue)}</span>
        <span>{formatMoney(normalized.maxValue)}</span>
        <span>{lastLabel}</span>
      </div>
    </div>
  );
}

function EquityCurveOverlayChart({
  primary,
  baseline,
}: {
  primary?: Array<{ timestamp: string; value: number }>;
  baseline?: Array<{ timestamp: string; value: number }>;
}) {
  const normalized = useMemo(() => {
    if (!primary || !baseline || primary.length < 2 || baseline.length < 2) {
      return null;
    }

    const width = 720;
    const height = 220;
    const padding = 24;
    const maxLength = Math.max(primary.length, baseline.length);
    const primaryBase = primary[0]?.value ?? 1;
    const baselineBase = baseline[0]?.value ?? 1;
    const primarySeries = primary.map((point) => ({
      timestamp: point.timestamp,
      value: primaryBase > 0 ? point.value / primaryBase : 1,
    }));
    const baselineSeries = baseline.map((point) => ({
      timestamp: point.timestamp,
      value: baselineBase > 0 ? point.value / baselineBase : 1,
    }));
    const values = [...primarySeries, ...baselineSeries].map((point) => point.value);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const span = Math.max(maxValue - minValue, 0.0001);

    const buildPath = (series: Array<{ value: number }>) =>
      series
        .map((point, index) => {
          const x =
            padding + (index / Math.max(maxLength - 1, 1)) * (width - padding * 2);
          const y =
            height - padding - ((point.value - minValue) / span) * (height - padding * 2);
          return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
        })
        .join(" ");

    return {
      width,
      height,
      padding,
      primaryPath: buildPath(primarySeries),
      baselinePath: buildPath(baselineSeries),
      primaryEnd: primarySeries[primarySeries.length - 1]?.value,
      baselineEnd: baselineSeries[baselineSeries.length - 1]?.value,
    };
  }, [baseline, primary]);

  if (!normalized) {
    return null;
  }

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 8,
        padding: 16,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
        Equity Curve Overlay
      </div>
      <svg
        viewBox={`0 0 ${normalized.width} ${normalized.height}`}
        style={{ width: "100%", height: 220, display: "block" }}
      >
        <rect
          x="0"
          y="0"
          width={normalized.width}
          height={normalized.height}
          rx="12"
          fill="rgba(8,15,28,0.7)"
        />
        <path
          d={normalized.baselinePath}
          fill="none"
          stroke="rgba(248,113,113,0.9)"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path
          d={normalized.primaryPath}
          fill="none"
          stroke="rgba(52,211,153,0.95)"
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginTop: 8,
          fontSize: 12,
          color: "rgba(255,255,255,0.7)",
        }}
      >
        <span>Primary normalized end: {formatNumber(normalized.primaryEnd, 3)}x</span>
        <span>Baseline normalized end: {formatNumber(normalized.baselineEnd, 3)}x</span>
      </div>
    </div>
  );
}

export function StrategyResearch() {
  const {
    strategies,
    selectedStrategyId,
    currentStrategy,
    currentVersion,
    scriptDraft,
    universeFilter,
    assumptionsDraft,
    backtestRuns,
    selectedRunId,
    selectedRun,
    activeTab,
    loading,
    error,
    notice,
    syncMode,
    comparisonNotes,
    loadStrategies,
    selectStrategy,
    createStrategy,
    updateScriptDraft,
    updateAssumptions,
    updateUniverse,
    saveStrategy,
    enqueueBacktest,
    loadBacktestRuns,
    selectRun,
    clearError,
    clearNotice,
    setActiveTab,
    saveComparisonNote,
    importBacktestArtifact,
    downloadHistoricalData,
  } = useStrategyResearchStore();

  const [newStrategyName, setNewStrategyName] = useState("");
  const [newStrategyDesc, setNewStrategyDesc] = useState("");
  const [showCreatePanel, setShowCreatePanel] = useState(false);
  const [executionMode, setExecutionMode] = useState<"desktop-local" | "backend">("desktop-local");
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null);
  const [comparisonRunId, setComparisonRunId] = useState<string>("");
  const [comparisonNoteDraft, setComparisonNoteDraft] = useState<string>("");
  const [runArtifacts, setRunArtifacts] = useState<any[]>([]);
  const [runExperiment, setRunExperiment] = useState<any | null>(null);
  const [robustnessReport, setRobustnessReport] = useState<Record<string, unknown> | null>(null);
  const [remoteComparison, setRemoteComparison] = useState<any | null>(null);
  const [experimentNameDraft, setExperimentNameDraft] = useState("");
  const [experimentTagsDraft, setExperimentTagsDraft] = useState("");
  const [experimentNotesDraft, setExperimentNotesDraft] = useState("");
  const [advancedBusy, setAdvancedBusy] = useState<null | "robustness" | "experiment">(null);
  const [backendDatasetSnapshotId, setBackendDatasetSnapshotId] = useState("mock-snapshot-1");
  const [datasetSnapshots, setDatasetSnapshots] = useState<BacktestDatasetSnapshot[]>([]);
  const [datasetSnapshotsLoading, setDatasetSnapshotsLoading] = useState(false);
  const [datasetSnapshotsError, setDatasetSnapshotsError] = useState<string | null>(null);
  const [datasetRefreshToken, setDatasetRefreshToken] = useState(0);

  useEffect(() => {
    void loadStrategies();
  }, [loadStrategies]);

  useEffect(() => {
    if (activeTab === "runs") {
      void loadBacktestRuns(selectedStrategyId ?? undefined);
    }
  }, [activeTab, loadBacktestRuns, selectedStrategyId]);

  useEffect(() => {
    if (executionMode !== "backend") {
      return;
    }

    let cancelled = false;
    setDatasetSnapshotsLoading(true);
    setDatasetSnapshotsError(null);

    void authRequest<{ snapshots: BacktestDatasetSnapshot[] }>(
      "/api/strategy/backtest/datasets?limit=200",
      { method: "GET" },
    )
      .then((response) => {
        if (cancelled) {
          return;
        }
        const snapshots = Array.isArray(response.snapshots)
          ? response.snapshots
          : [];
        setDatasetSnapshots(snapshots);
        if (snapshots.length > 0) {
          setBackendDatasetSnapshotId((currentId) => {
            if (snapshots.some((item) => item.id === currentId)) {
              return currentId;
            }
            return snapshots[0]!.id;
          });
        }
      })
      .catch((fetchError) => {
        if (cancelled) {
          return;
        }
        setDatasetSnapshots([]);
        setDatasetSnapshotsError(
          String(fetchError).replace(/^Error:\s*/i, ""),
        );
      })
      .finally(() => {
        if (!cancelled) {
          setDatasetSnapshotsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [executionMode, datasetRefreshToken]);

  const selectedDatasetSnapshot = useMemo(
    () =>
      datasetSnapshots.find((item) => item.id === backendDatasetSnapshotId) ??
      null,
    [backendDatasetSnapshotId, datasetSnapshots],
  );

  const handleCreateStrategy = async () => {
    if (!newStrategyName.trim()) {
      return;
    }
    await createStrategy(newStrategyName, newStrategyDesc);
    setNewStrategyName("");
    setNewStrategyDesc("");
    setShowCreatePanel(false);
    setActiveTab("editor");
  };

  const handleSaveStrategy = async () => {
    await saveStrategy();
  };

  const handleDownloadHistory = async () => {
    try {
      const result = await downloadHistoricalData(universeFilter);
      setDownloadStatus(
        `Historical data ready. ${result.downloaded} downloaded, ${result.fromCache} reused from cache.` +
          (result.failed.length > 0 ? ` Failed: ${result.failed.join(", ")}` : ""),
      );
    } catch (downloadError) {
      setDownloadStatus(String(downloadError).replace(/^Error:\s*/i, ""));
    }
  };

  const handleEnqueueBacktest = async () => {
    if (!selectedStrategyId) {
      return;
    }

    let version = currentVersion;
    if (!version || version.scriptSource !== scriptDraft) {
      await saveStrategy();
      version = useStrategyResearchStore.getState().currentVersion;
    }

    if (!version) {
      return;
    }

    await enqueueBacktest({
      strategyId: selectedStrategyId,
      strategyVersion: version.version,
      executionMode,
      datasetSnapshotId:
        executionMode === "backend"
          ? backendDatasetSnapshotId.trim() || "mock-snapshot-1"
          : undefined,
      assumptions: assumptionsDraft,
    });
    await loadBacktestRuns(selectedStrategyId);
    setActiveTab("runs");
  };

  const comparisonRun = useMemo(
    () => backtestRuns.find((item) => item.runId === comparisonRunId) ?? null,
    [backtestRuns, comparisonRunId],
  );

  const comparisonNoteKey = useMemo(() => {
    if (!selectedStrategyId || !selectedRun || !comparisonRun) {
      return "";
    }
    return `${selectedStrategyId}::${selectedRun.runId}::${comparisonRun.runId}`;
  }, [comparisonRun, selectedRun, selectedStrategyId]);

  useEffect(() => {
    if (!comparisonNoteKey) {
      setComparisonNoteDraft("");
      return;
    }
    setComparisonNoteDraft(comparisonNotes[comparisonNoteKey] ?? "");
  }, [comparisonNoteKey, comparisonNotes]);

  useEffect(() => {
    setRunArtifacts([]);
    setRunExperiment(null);
    setRobustnessReport(null);
    if (!selectedRun || selectedRun.executionMode !== "backend") {
      return;
    }
    let cancelled = false;
    void Promise.all([
      authRequest<{ artifacts: any[] }>(
        `/api/strategy/backtest/runs/${selectedRun.runId}/artifacts`,
        { method: "GET" },
      ).catch(() => ({ artifacts: [] })),
      authRequest<{ experiment: any | null }>(
        `/api/strategy/backtest/runs/${selectedRun.runId}/experiment`,
        { method: "GET" },
      ).catch(() => ({ experiment: null })),
    ]).then(([artifactsResponse, experimentResponse]) => {
      if (cancelled) {
        return;
      }
      setRunArtifacts(Array.isArray(artifactsResponse.artifacts) ? artifactsResponse.artifacts : []);
      setRunExperiment(experimentResponse.experiment ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedRun]);

  useEffect(() => {
    setRemoteComparison(null);
    if (
      !selectedRun ||
      !comparisonRun ||
      selectedRun.executionMode !== "backend" ||
      comparisonRun.executionMode !== "backend"
    ) {
      return;
    }
    let cancelled = false;
    void authRequest<any>(
      `/api/strategy/backtest/runs/${selectedRun.runId}/compare?baselineRunId=${encodeURIComponent(comparisonRun.runId)}&includeLineage=true`,
      { method: "GET" },
    )
      .then((payload) => {
        if (!cancelled) {
          setRemoteComparison(payload);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRemoteComparison(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [comparisonRun, selectedRun]);

  useEffect(() => {
    setExperimentNameDraft(runExperiment?.experimentName ?? "");
    setExperimentTagsDraft(
      Array.isArray(runExperiment?.tags) ? runExperiment.tags.join(", ") : "",
    );
    setExperimentNotesDraft(runExperiment?.notes ?? "");
  }, [runExperiment]);

  const runDiff = useMemo(() => {
    if (!selectedRun || !comparisonRun) {
      return null;
    }
    if (remoteComparison?.comparison?.deltas) {
      return {
        totalReturn: remoteComparison.comparison.deltas.totalReturn,
        sharpeRatio: remoteComparison.comparison.deltas.sharpeRatio,
        maxDrawdown: remoteComparison.comparison.deltas.maxDrawdown,
        endingCapital: remoteComparison.comparison.deltas.endingCapital,
        numTrades: remoteComparison.comparison.deltas.numTrades,
        cagr: remoteComparison.comparison.deltas.cagr,
        sortinoRatio: remoteComparison.comparison.deltas.sortinoRatio,
        calmarRatio: remoteComparison.comparison.deltas.calmarRatio,
        turnoverPct: remoteComparison.comparison.deltas.turnoverPct,
      };
    }
    const selected = selectedRun.metrics ?? {};
    const baseline = comparisonRun.metrics ?? {};
    return {
      totalReturn:
        typeof selected.totalReturn === "number" &&
        typeof baseline.totalReturn === "number"
          ? selected.totalReturn - baseline.totalReturn
          : undefined,
      sharpeRatio:
        typeof selected.sharpeRatio === "number" &&
        typeof baseline.sharpeRatio === "number"
          ? selected.sharpeRatio - baseline.sharpeRatio
          : undefined,
      maxDrawdown:
        typeof selected.maxDrawdown === "number" &&
        typeof baseline.maxDrawdown === "number"
          ? selected.maxDrawdown - baseline.maxDrawdown
          : undefined,
      endingCapital:
        typeof selected.endingCapital === "number" &&
        typeof baseline.endingCapital === "number"
          ? selected.endingCapital - baseline.endingCapital
          : undefined,
      numTrades:
        typeof selected.numTrades === "number" &&
        typeof baseline.numTrades === "number"
          ? selected.numTrades - baseline.numTrades
          : undefined,
      cagr:
        typeof selected.cagr === "number" && typeof baseline.cagr === "number"
          ? selected.cagr - baseline.cagr
          : undefined,
      sortinoRatio:
        typeof selected.sortinoRatio === "number" &&
        typeof baseline.sortinoRatio === "number"
          ? selected.sortinoRatio - baseline.sortinoRatio
          : undefined,
      calmarRatio:
        typeof selected.calmarRatio === "number" &&
        typeof baseline.calmarRatio === "number"
          ? selected.calmarRatio - baseline.calmarRatio
          : undefined,
      turnoverPct:
        typeof selected.turnoverPct === "number" &&
        typeof baseline.turnoverPct === "number"
          ? selected.turnoverPct - baseline.turnoverPct
          : undefined,
    };
  }, [comparisonRun, remoteComparison, selectedRun]);

  const handleRunRobustness = async () => {
    if (!selectedRun || selectedRun.executionMode !== "backend") {
      return;
    }
    setAdvancedBusy("robustness");
    try {
      const payload = await authRequest<{ report: Record<string, unknown> }>(
        `/api/strategy/backtest/runs/${selectedRun.runId}/robustness`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      setRobustnessReport(payload.report ?? null);
    } finally {
      setAdvancedBusy(null);
    }
  };

  const handleSaveExperiment = async () => {
    if (!selectedRun || selectedRun.executionMode !== "backend") {
      return;
    }
    setAdvancedBusy("experiment");
    try {
      const payload = await authRequest<{ experiment: any | null }>(
        `/api/strategy/backtest/runs/${selectedRun.runId}/experiment`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            experimentName: experimentNameDraft || `Run ${selectedRun.runId.slice(-8)}`,
            tags: experimentTagsDraft
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean),
            notes: experimentNotesDraft,
            parameters: {
              comparisonRunId: comparisonRun?.runId ?? null,
              comparisonDeltas: runDiff ?? null,
            },
          }),
        },
      );
      setRunExperiment(payload.experiment ?? null);
    } finally {
      setAdvancedBusy(null);
    }
  };

  const handleExportRunArtifact = async () => {
    if (!selectedRun) {
      return;
    }

    const exportPayload = {
      exportedAt: new Date().toISOString(),
      strategy: currentStrategy
        ? {
            id: currentStrategy.id,
            name: currentStrategy.name,
            stage: currentStrategy.stage,
            description: currentStrategy.description,
          }
        : null,
      version: currentVersion
        ? {
            id: currentVersion.id,
            version: currentVersion.version,
            scriptLanguage: currentVersion.scriptLanguage,
            scriptChecksum: currentVersion.scriptChecksum,
            universe: currentVersion.universe,
            assumptions: currentVersion.assumptions,
          }
        : null,
      run: selectedRun,
      comparison:
        comparisonRun && runDiff
          ? {
              baselineRunId: comparisonRun.runId,
              diff: runDiff,
            }
          : null,
    };

    const signatureSha256 = await sha256Hex(stableStringify(exportPayload));
    const artifact = {
      manifest: {
        version: "backtest-artifact.v1",
        algorithm: "SHA-256",
        signatureSha256,
      },
      ...exportPayload,
    };

    const blob = new Blob([JSON.stringify(artifact, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `backtest-artifact-${selectedRun.runId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="page"
      style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}
    >
      <div className="pageTitleRow">
        <h1 className="pageTitle">STRATEGY RESEARCH</h1>
        <div className="pageSubtitle">Backtest and optimize trading strategies</div>
      </div>

      {notice ? (
        <div
          style={{
            padding: "12px 16px",
            margin: "12px 16px 0",
            background: "rgba(217, 119, 6, 0.15)",
            border: "1px solid rgba(245, 158, 11, 0.35)",
            borderRadius: 6,
            color: "#fcd34d",
            fontSize: 13,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span>{notice}</span>
          <button
            onClick={clearNotice}
            style={{
              background: "transparent",
              border: "none",
              color: "#fcd34d",
              cursor: "pointer",
              fontSize: 16,
            }}
          >
            ✕
          </button>
        </div>
      ) : null}

      {error ? (
        <div
          style={{
            padding: "12px 16px",
            margin: "12px 16px 0",
            background: "rgba(220, 38, 38, 0.15)",
            border: "1px solid rgba(220, 38, 38, 0.4)",
            borderRadius: 6,
            color: "#fca5a5",
            fontSize: 13,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span>{error}</span>
          <button
            onClick={clearError}
            style={{
              background: "transparent",
              border: "none",
              color: "#fca5a5",
              cursor: "pointer",
              fontSize: 16,
            }}
          >
            ✕
          </button>
        </div>
      ) : null}

      <div
        style={{
          display: "flex",
          gap: 8,
          padding: "12px 16px",
          borderBottom: "1px solid rgba(255,255,255,0.1)",
          overflowX: "auto",
        }}
      >
        {(["list", "editor", "runs", "details"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "8px 16px",
              background:
                activeTab === tab ? "rgba(110, 168, 254, 0.2)" : "transparent",
              border:
                activeTab === tab
                  ? "1px solid rgba(110, 168, 254, 0.4)"
                  : "1px solid rgba(255,255,255,0.1)",
              borderRadius: 6,
              color: "white",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            {tab === "list" ? "Strategies" : null}
            {tab === "editor" ? "Editor" : null}
            {tab === "runs" ? "Run History" : null}
            {tab === "details" ? "Details" : null}
          </button>
        ))}
      </div>

      <div
        style={{
          flex: 1,
          display: "flex",
          overflow: "hidden",
          gap: 16,
          padding: 16,
        }}
      >
        <div
          style={{
            width: 300,
            display: "flex",
            flexDirection: "column",
            background: "rgba(0,0,0,0.2)",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.1)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "12px 16px",
              borderBottom: "1px solid rgba(255,255,255,0.1)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <button
              onClick={() => setShowCreatePanel((current) => !current)}
              style={{
                width: "100%",
                padding: "8px 12px",
                background: "rgba(34, 197, 94, 0.2)",
                border: "1px solid rgba(34, 197, 94, 0.4)",
                borderRadius: 4,
                color: "#86efac",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              {showCreatePanel ? "Close" : "+ New"}
            </button>

            <div
              style={{
                fontSize: 11,
                color: syncMode === "cloud" ? "#93c5fd" : "#fcd34d",
                lineHeight: 1.5,
              }}
            >
              {syncMode === "cloud"
                ? "Cloud sync active. Strategies and runs use the backend session."
                : "Local workspace active. Strategies, downloaded history, and local runs stay on this PC."}
            </div>

            {showCreatePanel ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  paddingTop: 4,
                }}
              >
                <input
                  type="text"
                  placeholder="Strategy name"
                  value={newStrategyName}
                  onChange={(event) => setNewStrategyName(event.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    background: "rgba(0,0,0,0.3)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    borderRadius: 4,
                    color: "white",
                    fontSize: 13,
                  }}
                />
                <textarea
                  placeholder="What should this strategy do?"
                  value={newStrategyDesc}
                  onChange={(event) => setNewStrategyDesc(event.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    background: "rgba(0,0,0,0.3)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    borderRadius: 4,
                    color: "white",
                    fontSize: 13,
                    minHeight: 84,
                    resize: "vertical",
                  }}
                />
                <button
                  onClick={() => void handleCreateStrategy()}
                  disabled={!newStrategyName.trim() || loading}
                  style={{
                    width: "100%",
                    padding: "10px 16px",
                    background: "rgba(59, 130, 246, 0.2)",
                    border: "1px solid rgba(59, 130, 246, 0.4)",
                    borderRadius: 4,
                    color: "#93c5fd",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor:
                      !newStrategyName.trim() || loading ? "not-allowed" : "pointer",
                    opacity: !newStrategyName.trim() || loading ? 0.5 : 1,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Create Strategy
                </button>
              </div>
            ) : null}
          </div>

          <div style={{ flex: 1, overflow: "auto" }}>
            {strategies.length === 0 ? (
              <div
                style={{
                  padding: 16,
                  color: "rgba(255,255,255,0.45)",
                  fontSize: 12,
                  lineHeight: 1.6,
                }}
              >
                No strategies yet.
                <br />
                Create one on the left to start writing and running scripts.
              </div>
            ) : (
              strategies.map((strategy) => (
                <button
                  key={strategy.id}
                  onClick={() => {
                    void selectStrategy(strategy.id);
                    setActiveTab("editor");
                  }}
                  style={{
                    width: "100%",
                    padding: "12px 16px",
                    border: "none",
                    borderBottom: "1px solid rgba(255,255,255,0.05)",
                    background:
                      selectedStrategyId === strategy.id
                        ? "rgba(110, 168, 254, 0.15)"
                        : "transparent",
                    color: "white",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{strategy.name}</div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "rgba(255,255,255,0.5)",
                      marginTop: 4,
                      textTransform: "capitalize",
                    }}
                  >
                    {strategy.stage}
                  </div>
                  {strategy.description ? (
                    <div
                      style={{
                        fontSize: 11,
                        color: "rgba(255,255,255,0.45)",
                        marginTop: 6,
                        lineHeight: 1.5,
                      }}
                    >
                      {strategy.description}
                    </div>
                  ) : null}
                </button>
              ))
            )}
          </div>
        </div>

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "auto",
            background: "rgba(0,0,0,0.2)",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.1)",
            padding: 16,
            gap: 16,
          }}
        >
          {activeTab === "list" ? (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 16,
                }}
              >
                <div
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    padding: 16,
                    borderRadius: 8,
                    borderLeft: "3px solid rgba(110, 168, 254, 0.5)",
                  }}
                >
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
                    Workspace Mode
                  </div>
                  <div style={{ marginTop: 8, fontSize: 16, fontWeight: 600 }}>
                    {syncMode === "cloud" ? "Cloud Sync" : "Local Only"}
                  </div>
                </div>
                <div
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    padding: 16,
                    borderRadius: 8,
                    borderLeft: "3px solid rgba(52, 211, 153, 0.5)",
                  }}
                >
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
                    Strategies
                  </div>
                  <div style={{ marginTop: 8, fontSize: 16, fontWeight: 600 }}>
                    {strategies.length}
                  </div>
                </div>
                <div
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    padding: 16,
                    borderRadius: 8,
                    borderLeft: "3px solid rgba(245, 158, 11, 0.5)",
                  }}
                >
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
                    Last Selected Strategy
                  </div>
                  <div style={{ marginTop: 8, fontSize: 16, fontWeight: 600 }}>
                    {currentStrategy?.name ?? "None"}
                  </div>
                </div>
              </div>

              {currentStrategy ? (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                    gap: 16,
                  }}
                >
                  <div
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      padding: 16,
                      borderRadius: 8,
                    }}
                  >
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>Description</div>
                    <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.6 }}>
                      {currentStrategy.description || "No description yet."}
                    </div>
                  </div>
                  <div
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      padding: 16,
                      borderRadius: 8,
                    }}
                  >
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>Latest Version</div>
                    <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.6 }}>
                      {currentVersion?.version ?? "Not saved yet"}
                    </div>
                  </div>
                  <div
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      padding: 16,
                      borderRadius: 8,
                    }}
                  >
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>Universe</div>
                    <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.6 }}>
                      {universeFilter.length > 0 ? universeFilter.join(", ") : "No tickers selected"}
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ color: "rgba(255,255,255,0.5)", lineHeight: 1.7 }}>
                  Create a strategy, write an onBar script, then run it in desktop-local mode.
                  Desktop-local mode downloads daily stock history to your PC and caches it for reuse.
                </div>
              )}
            </>
          ) : null}

          {activeTab === "editor" ? (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                  gap: 16,
                }}
              >
                <div>
                  <label
                    style={{
                      fontSize: 12,
                      color: "rgba(255,255,255,0.6)",
                      display: "block",
                      marginBottom: 8,
                    }}
                  >
                    Universe (comma-separated tickers)
                  </label>
                  <textarea
                    value={universeFilter.join(", ")}
                    onChange={(event) =>
                      updateUniverse(event.target.value.split(",").map((item) => item.trim()))
                    }
                    style={{
                      width: "100%",
                      padding: 12,
                      background: "rgba(0,0,0,0.3)",
                      border: "1px solid rgba(255,255,255,0.15)",
                      borderRadius: 4,
                      color: "white",
                      fontFamily: "monospace",
                      fontSize: 12,
                      minHeight: 96,
                      resize: "vertical",
                    }}
                    placeholder="AAPL, MSFT, SPY"
                  />
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 8 }}>
                    Desktop-local mode auto-downloads public daily history from internet providers (Stooq with Yahoo fallback) and stores it in the app cache on this PC. No coding needed.
                  </div>
                </div>

                <div>
                  <label
                    style={{
                      fontSize: 12,
                      color: "rgba(255,255,255,0.6)",
                      display: "block",
                      marginBottom: 8,
                    }}
                  >
                    Assumptions
                  </label>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <input
                      type="number"
                      placeholder="Initial Capital"
                      value={String(assumptionsDraft.initialCapital ?? "")}
                      onChange={(event) =>
                        updateAssumptions({
                          ...assumptionsDraft,
                          initialCapital: event.target.value
                            ? Number(event.target.value)
                            : undefined,
                        })
                      }
                      style={{
                        padding: "8px 12px",
                        background: "rgba(0,0,0,0.3)",
                        border: "1px solid rgba(255,255,255,0.15)",
                        borderRadius: 4,
                        color: "white",
                        fontSize: 12,
                      }}
                    />
                    <input
                      type="number"
                      placeholder="Position Size (%)"
                      value={String(assumptionsDraft.positionSize ?? "")}
                      onChange={(event) =>
                        updateAssumptions({
                          ...assumptionsDraft,
                          positionSize: event.target.value
                            ? Number(event.target.value)
                            : undefined,
                        })
                      }
                      style={{
                        padding: "8px 12px",
                        background: "rgba(0,0,0,0.3)",
                        border: "1px solid rgba(255,255,255,0.15)",
                        borderRadius: 4,
                        color: "white",
                        fontSize: 12,
                      }}
                    />
                    <input
                      type="number"
                      placeholder="Commission (%)"
                      value={String(assumptionsDraft.commissionPercent ?? "")}
                      onChange={(event) =>
                        updateAssumptions({
                          ...assumptionsDraft,
                          commissionPercent: event.target.value
                            ? Number(event.target.value)
                            : undefined,
                        })
                      }
                      style={{
                        padding: "8px 12px",
                        background: "rgba(0,0,0,0.3)",
                        border: "1px solid rgba(255,255,255,0.15)",
                        borderRadius: 4,
                        color: "white",
                        fontSize: 12,
                      }}
                    />
                    <input
                      type="number"
                      placeholder="Slippage (bps)"
                      value={String(assumptionsDraft.slippage ?? "")}
                      onChange={(event) =>
                        updateAssumptions({
                          ...assumptionsDraft,
                          slippage: event.target.value
                            ? Number(event.target.value)
                            : undefined,
                        })
                      }
                      style={{
                        padding: "8px 12px",
                        background: "rgba(0,0,0,0.3)",
                        border: "1px solid rgba(255,255,255,0.15)",
                        borderRadius: 4,
                        color: "white",
                        fontSize: 12,
                      }}
                    />
                    <input
                      type="date"
                      placeholder="Start Date"
                      value={String(assumptionsDraft.startDate ?? "")}
                      onChange={(event) =>
                        updateAssumptions({
                          ...assumptionsDraft,
                          startDate: event.target.value || undefined,
                        })
                      }
                      style={{
                        padding: "8px 12px",
                        background: "rgba(0,0,0,0.3)",
                        border: "1px solid rgba(255,255,255,0.15)",
                        borderRadius: 4,
                        color: "white",
                        fontSize: 12,
                        colorScheme: "dark",
                      }}
                    />
                    <input
                      type="date"
                      placeholder="End Date"
                      value={String(assumptionsDraft.endDate ?? "")}
                      onChange={(event) =>
                        updateAssumptions({
                          ...assumptionsDraft,
                          endDate: event.target.value || undefined,
                        })
                      }
                      style={{
                        padding: "8px 12px",
                        background: "rgba(0,0,0,0.3)",
                        border: "1px solid rgba(255,255,255,0.15)",
                        borderRadius: 4,
                        color: "white",
                        fontSize: 12,
                        colorScheme: "dark",
                      }}
                    />
                    <input
                      type="text"
                      placeholder="Benchmark Symbol (e.g. SPY)"
                      value={String(assumptionsDraft.benchmarkSymbol ?? "")}
                      onChange={(event) =>
                        updateAssumptions({
                          ...assumptionsDraft,
                          benchmarkSymbol: event.target.value || undefined,
                        })
                      }
                      style={{
                        padding: "8px 12px",
                        background: "rgba(0,0,0,0.3)",
                        border: "1px solid rgba(255,255,255,0.15)",
                        borderRadius: 4,
                        color: "white",
                        fontSize: 12,
                      }}
                    />
                    <input
                      type="number"
                      placeholder="Max Position Weight (% of portfolio)"
                      value={String(assumptionsDraft.maxPositionWeightPct ?? "")}
                      onChange={(event) =>
                        updateAssumptions({
                          ...assumptionsDraft,
                          maxPositionWeightPct: event.target.value
                            ? Number(event.target.value)
                            : undefined,
                        })
                      }
                      style={{
                        padding: "8px 12px",
                        background: "rgba(0,0,0,0.3)",
                        border: "1px solid rgba(255,255,255,0.15)",
                        borderRadius: 4,
                        color: "white",
                        fontSize: 12,
                      }}
                    />
                    <input
                      type="number"
                      placeholder="Halt Trading Drawdown Threshold (%)"
                      value={String(assumptionsDraft.haltTradingOnDrawdownPct ?? "")}
                      onChange={(event) =>
                        updateAssumptions({
                          ...assumptionsDraft,
                          haltTradingOnDrawdownPct: event.target.value
                            ? Number(event.target.value)
                            : undefined,
                        })
                      }
                      style={{
                        padding: "8px 12px",
                        background: "rgba(0,0,0,0.3)",
                        border: "1px solid rgba(255,255,255,0.15)",
                        borderRadius: 4,
                        color: "white",
                        fontSize: 12,
                      }}
                    />
                    <select
                      value={backendDatasetSnapshotId}
                      onChange={(event) => setBackendDatasetSnapshotId(event.target.value)}
                      style={{
                        padding: "8px 12px",
                        background: "rgba(0,0,0,0.3)",
                        border: "1px solid rgba(255,255,255,0.15)",
                        borderRadius: 4,
                        color: "white",
                        fontSize: 12,
                      }}
                    >
                      {datasetSnapshotsLoading ? (
                        <option value={backendDatasetSnapshotId}>Loading datasets...</option>
                      ) : null}
                      {!datasetSnapshotsLoading && datasetSnapshots.length === 0 ? (
                        <option value={backendDatasetSnapshotId}>No datasets found (enter snapshot ID below)</option>
                      ) : null}
                      {datasetSnapshots.map((snapshot) => (
                        <option key={snapshot.id} value={snapshot.id}>
                          {formatSnapshotLabel(snapshot)}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => setDatasetRefreshToken((current) => current + 1)}
                      type="button"
                      disabled={datasetSnapshotsLoading}
                      style={{
                        padding: "8px 12px",
                        background: "rgba(59, 130, 246, 0.2)",
                        border: "1px solid rgba(59, 130, 246, 0.4)",
                        borderRadius: 4,
                        color: "#93c5fd",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: datasetSnapshotsLoading ? "not-allowed" : "pointer",
                        opacity: datasetSnapshotsLoading ? 0.7 : 1,
                      }}
                    >
                      {datasetSnapshotsLoading ? "Loading..." : "Refresh Datasets"}
                    </button>
                    <input
                      type="text"
                      placeholder="Or enter custom snapshot ID"
                      value={backendDatasetSnapshotId}
                      onChange={(event) => setBackendDatasetSnapshotId(event.target.value)}
                      style={{
                        padding: "8px 12px",
                        background: "rgba(0,0,0,0.3)",
                        border: "1px solid rgba(255,255,255,0.15)",
                        borderRadius: 4,
                        color: "white",
                        fontSize: 12,
                      }}
                    />
                    {datasetSnapshotsError ? (
                      <div style={{ fontSize: 11, color: "#fca5a5" }}>
                        Could not load dataset snapshots: {datasetSnapshotsError}
                      </div>
                    ) : null}
                    {selectedDatasetSnapshot ? (
                      <div
                        style={{
                          fontSize: 11,
                          color: "rgba(255,255,255,0.58)",
                          lineHeight: 1.4,
                        }}
                      >
                        <div>Selected: {selectedDatasetSnapshot.name} @ {selectedDatasetSnapshot.version}</div>
                        <div>Snapshot Time: {new Date(selectedDatasetSnapshot.snapshotAtIso).toLocaleString()}</div>
                        <div>Rows: {typeof selectedDatasetSnapshot.rowCount === "number" ? selectedDatasetSnapshot.rowCount.toLocaleString() : "n/a"}</div>
                        <div>Checksum: {selectedDatasetSnapshot.checksumSha256.slice(0, 16)}...</div>
                      </div>
                    ) : null}
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)" }}>
                      Backend mode runs exactly on the selected historical dataset snapshot (for example your NIFTY dataset for India strategies).
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                <label
                  style={{
                    fontSize: 12,
                    color: "rgba(255,255,255,0.6)",
                    display: "block",
                  }}
                >
                  Strategy Script
                </label>
                <textarea
                  value={scriptDraft}
                  onChange={(event) => updateScriptDraft(event.target.value)}
                  style={{
                    flex: 1,
                    minHeight: 320,
                    padding: 12,
                    background: "rgba(0,0,0,0.3)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    borderRadius: 4,
                    color: "#86efac",
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 12,
                    resize: "vertical",
                  }}
                />
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  onClick={() => void handleSaveStrategy()}
                  disabled={loading || !selectedStrategyId}
                  style={{
                    padding: "10px 16px",
                    background: "rgba(59, 130, 246, 0.2)",
                    border: "1px solid rgba(59, 130, 246, 0.4)",
                    borderRadius: 4,
                    color: "#93c5fd",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: loading || !selectedStrategyId ? "not-allowed" : "pointer",
                    opacity: loading || !selectedStrategyId ? 0.5 : 1,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Save Version
                </button>

                <button
                  onClick={() => void handleDownloadHistory()}
                  disabled={loading || universeFilter.length === 0}
                  style={{
                    padding: "10px 16px",
                    background: "rgba(245, 158, 11, 0.18)",
                    border: "1px solid rgba(245, 158, 11, 0.35)",
                    borderRadius: 4,
                    color: "#fcd34d",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor:
                      loading || universeFilter.length === 0 ? "not-allowed" : "pointer",
                    opacity: loading || universeFilter.length === 0 ? 0.5 : 1,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Download Historical Data
                </button>

                <button
                  onClick={() => void handleEnqueueBacktest()}
                  disabled={loading || !selectedStrategyId}
                  style={{
                    padding: "10px 16px",
                    background: "rgba(34, 197, 94, 0.2)",
                    border: "1px solid rgba(34, 197, 94, 0.4)",
                    borderRadius: 4,
                    color: "#86efac",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: loading || !selectedStrategyId ? "not-allowed" : "pointer",
                    opacity: loading || !selectedStrategyId ? 0.5 : 1,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Run Backtest
                </button>

                <select
                  value={executionMode}
                  onChange={(event) =>
                    setExecutionMode(event.target.value as "desktop-local" | "backend")
                  }
                  style={{
                    padding: "8px 12px",
                    background: "rgba(0,0,0,0.3)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    borderRadius: 4,
                    color: "white",
                    fontSize: 12,
                  }}
                >
                  <option value="desktop-local">Desktop Local</option>
                  <option value="backend">Cloud Backend</option>
                </select>
              </div>

              {downloadStatus ? (
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>
                  {downloadStatus}
                </div>
              ) : null}
            </>
          ) : null}

          {activeTab === "runs" ? (
            <>
              <div style={{ fontSize: 16, fontWeight: 600 }}>Backtest Runs</div>
              {backtestRuns.length === 0 ? (
                <div style={{ color: "rgba(255,255,255,0.5)", lineHeight: 1.6 }}>
                  No runs yet. Save a strategy version, download history if needed, and run a backtest.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {backtestRuns.map((run) => (
                    <button
                      key={run.runId}
                      onClick={() => selectRun(run.runId)}
                      style={{
                        padding: 12,
                        background:
                          selectedRunId === run.runId
                            ? "rgba(110, 168, 254, 0.15)"
                            : "rgba(255,255,255,0.05)",
                        border:
                          selectedRunId === run.runId
                            ? "1px solid rgba(110, 168, 254, 0.4)"
                            : "1px solid rgba(255,255,255,0.1)",
                        borderRadius: 6,
                        color: "white",
                        textAlign: "left",
                        cursor: "pointer",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 12,
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>
                            {run.executionMode === "backend" ? "Cloud" : "Local"} run {run.runId.slice(-8)}
                          </div>
                          <div
                            style={{
                              fontSize: 11,
                              color: "rgba(255,255,255,0.5)",
                              marginTop: 4,
                              textTransform: "capitalize",
                            }}
                          >
                            {run.status}
                            {run.finishedAt ? ` • ${new Date(run.finishedAt).toLocaleString()}` : ""}
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div
                            style={{
                              fontSize: 12,
                              fontWeight: 600,
                              color:
                                (run.metrics?.totalReturn ?? 0) >= 0
                                  ? "#86efac"
                                  : "#fca5a5",
                            }}
                          >
                            {formatPercent(run.metrics?.totalReturn)}
                          </div>
                          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
                            Return
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : null}

          {activeTab === "details" ? (
            selectedRun ? (
              <>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      padding: 12,
                      borderRadius: 6,
                    }}
                  >
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>Total Return</div>
                    <div style={{ fontSize: 18, fontWeight: 700, marginTop: 6 }}>
                      {formatPercent(selectedRun.metrics?.totalReturn)}
                    </div>
                  </div>
                  <div
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      padding: 12,
                      borderRadius: 6,
                    }}
                  >
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>Sharpe Ratio</div>
                    <div style={{ fontSize: 18, fontWeight: 700, marginTop: 6 }}>
                      {typeof selectedRun.metrics?.sharpeRatio === "number"
                        ? selectedRun.metrics.sharpeRatio.toFixed(2)
                        : "--"}
                    </div>
                  </div>
                  <div
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      padding: 12,
                      borderRadius: 6,
                    }}
                  >
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>Max Drawdown</div>
                    <div style={{ fontSize: 18, fontWeight: 700, marginTop: 6 }}>
                      {formatPercent(selectedRun.metrics?.maxDrawdown)}
                    </div>
                  </div>
                  <div
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      padding: 12,
                      borderRadius: 6,
                    }}
                  >
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>Ending Capital</div>
                    <div style={{ fontSize: 18, fontWeight: 700, marginTop: 6 }}>
                      {formatMoney(selectedRun.metrics?.endingCapital)}
                    </div>
                  </div>
                  <div
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      padding: 12,
                      borderRadius: 6,
                    }}
                  >
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>CAGR</div>
                    <div style={{ fontSize: 18, fontWeight: 700, marginTop: 6 }}>
                      {formatPercent(selectedRun.metrics?.cagr as number | undefined)}
                    </div>
                  </div>
                  <div
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      padding: 12,
                      borderRadius: 6,
                    }}
                  >
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>Sortino Ratio</div>
                    <div style={{ fontSize: 18, fontWeight: 700, marginTop: 6 }}>
                      {formatNumber(selectedRun.metrics?.sortinoRatio as number | undefined)}
                    </div>
                  </div>
                  <div
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      padding: 12,
                      borderRadius: 6,
                    }}
                  >
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>Annualized Volatility</div>
                    <div style={{ fontSize: 18, fontWeight: 700, marginTop: 6 }}>
                      {formatPercent(selectedRun.metrics?.annualizedVolatility as number | undefined)}
                    </div>
                  </div>
                  <div
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      padding: 12,
                      borderRadius: 6,
                    }}
                  >
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>Turnover</div>
                    <div style={{ fontSize: 18, fontWeight: 700, marginTop: 6 }}>
                      {formatPercent(selectedRun.metrics?.turnoverPct as number | undefined)}
                    </div>
                  </div>
                </div>

                <EquityCurveChart points={selectedRun.equityCurve} />

                {comparisonRun ? (
                  <EquityCurveOverlayChart
                    primary={selectedRun.equityCurve}
                    baseline={comparisonRun.equityCurve}
                  />
                ) : null}

                <div
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    borderRadius: 8,
                    padding: 16,
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      Run Comparison and Export
                    </div>
                    <button
                      onClick={() => {
                        void handleExportRunArtifact();
                      }}
                      style={{
                        padding: "8px 12px",
                        background: "rgba(59,130,246,0.2)",
                        border: "1px solid rgba(59,130,246,0.4)",
                        borderRadius: 4,
                        color: "#93c5fd",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                      }}
                    >
                      Export Artifact
                    </button>
                    <button
                      onClick={() => {
                        const picker = document.createElement("input");
                        picker.type = "file";
                        picker.accept = "application/json";
                        picker.onchange = () => {
                          const file = picker.files?.[0];
                          if (!file) {
                            return;
                          }
                          const reader = new FileReader();
                          reader.onload = () => {
                            try {
                              const parsed = JSON.parse(String(reader.result ?? "{}"));
                              void importBacktestArtifact(parsed);
                            } catch {
                              // Ignore malformed import payload.
                            }
                          };
                          reader.readAsText(file);
                        };
                        picker.click();
                      }}
                      style={{
                        padding: "8px 12px",
                        background: "rgba(245,158,11,0.2)",
                        border: "1px solid rgba(245,158,11,0.4)",
                        borderRadius: 4,
                        color: "#fcd34d",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                      }}
                    >
                      Import Artifact
                    </button>
                  </div>

                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <label style={{ fontSize: 12, color: "rgba(255,255,255,0.65)" }}>
                      Compare against:
                    </label>
                    <select
                      value={comparisonRunId}
                      onChange={(event) => setComparisonRunId(event.target.value)}
                      style={{
                        padding: "8px 12px",
                        background: "rgba(0,0,0,0.3)",
                        border: "1px solid rgba(255,255,255,0.15)",
                        borderRadius: 4,
                        color: "white",
                        fontSize: 12,
                        minWidth: 280,
                      }}
                    >
                      <option value="">No comparison selected</option>
                      {backtestRuns
                        .filter((run) => run.runId !== selectedRun.runId)
                        .map((run) => (
                          <option key={run.runId} value={run.runId}>
                            {run.runId.slice(-8)} • {run.executionMode === "backend" ? "Cloud" : "Local"} • {formatPercent(run.metrics?.totalReturn)}
                          </option>
                        ))}
                    </select>
                  </div>

                  {comparisonRun && runDiff ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                          gap: 10,
                        }}
                      >
                        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.75)" }}>
                          Return Delta: {formatDelta(runDiff.totalReturn, true)}
                        </div>
                        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.75)" }}>
                          Sharpe Delta: {formatDelta(runDiff.sharpeRatio, false)}
                        </div>
                        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.75)" }}>
                          Drawdown Delta: {formatDelta(runDiff.maxDrawdown, true)}
                        </div>
                        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.75)" }}>
                          Ending Capital Delta: {formatMoney(runDiff.endingCapital)}
                        </div>
                        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.75)" }}>
                          Trade Count Delta: {formatDelta(runDiff.numTrades, false)}
                        </div>
                        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.75)" }}>
                          CAGR Delta: {formatDelta(runDiff.cagr, true)}
                        </div>
                        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.75)" }}>
                          Sortino Delta: {formatDelta(runDiff.sortinoRatio, false)}
                        </div>
                        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.75)" }}>
                          Turnover Delta: {formatDelta(runDiff.turnoverPct, true)}
                        </div>
                      </div>
                      {remoteComparison?.comparison ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: "rgba(255,255,255,0.72)" }}>
                          <div>Improved: {Array.isArray(remoteComparison.comparison.improved) && remoteComparison.comparison.improved.length > 0 ? remoteComparison.comparison.improved.join(", ") : "none"}</div>
                          <div>Degraded: {Array.isArray(remoteComparison.comparison.degraded) && remoteComparison.comparison.degraded.length > 0 ? remoteComparison.comparison.degraded.join(", ") : "none"}</div>
                          {remoteComparison.lineage ? (
                            <details>
                              <summary style={{ cursor: "pointer" }}>Lineage diff payload</summary>
                              <pre style={{ whiteSpace: "pre-wrap", fontSize: 11, color: "rgba(255,255,255,0.68)" }}>
                                {prettyJson(remoteComparison.lineage)}
                              </pre>
                            </details>
                          ) : null}
                        </div>
                      ) : null}
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <label style={{ fontSize: 12, color: "rgba(255,255,255,0.65)" }}>
                          Comparison Notes (persisted locally)
                        </label>
                        <textarea
                          value={comparisonNoteDraft}
                          onChange={(event) => setComparisonNoteDraft(event.target.value)}
                          placeholder="Document why this variant is better/worse, caveats, and follow-up experiments..."
                          style={{
                            width: "100%",
                            minHeight: 84,
                            padding: "10px 12px",
                            background: "rgba(0,0,0,0.3)",
                            border: "1px solid rgba(255,255,255,0.15)",
                            borderRadius: 4,
                            color: "white",
                            fontSize: 12,
                            resize: "vertical",
                          }}
                        />
                        <div style={{ display: "flex", justifyContent: "flex-end" }}>
                          <button
                            onClick={() => {
                              if (!selectedRun || !comparisonRun) {
                                return;
                              }
                              void saveComparisonNote(
                                selectedRun.runId,
                                comparisonRun.runId,
                                comparisonNoteDraft,
                              );
                            }}
                            style={{
                              padding: "8px 12px",
                              background: "rgba(34,197,94,0.2)",
                              border: "1px solid rgba(34,197,94,0.4)",
                              borderRadius: 4,
                              color: "#86efac",
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: "pointer",
                              textTransform: "uppercase",
                              letterSpacing: "0.05em",
                            }}
                          >
                            Save Comparison Note
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
                      Select another run to view metric deltas and include them in exported artifacts.
                    </div>
                  )}
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                    gap: 16,
                  }}
                >
                  <div
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      borderRadius: 8,
                      padding: 16,
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Run Info</div>
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.72)", lineHeight: 1.7 }}>
                      <div>Status: {selectedRun.status}</div>
                      <div>Execution: {selectedRun.executionMode ?? "desktop-local"}</div>
                      <div>Version: {selectedRun.strategyVersion}</div>
                      <div>
                        Dataset Snapshot: {selectedRun.datasetSnapshotId ?? selectedRun.runMetadata?.datasetSnapshotId ?? "n/a"}
                      </div>
                      <div>Trades: {selectedRun.metrics?.numTrades ?? 0}</div>
                      {selectedRun.historicalData ? (
                        <>
                          <div>History Source: {selectedRun.historicalData.source}</div>
                          <div>Symbols: {selectedRun.historicalData.symbols.join(", ")}</div>
                          <div>Cache Folder: {selectedRun.historicalData.cacheDir}</div>
                        </>
                      ) : null}
                      {selectedRun.runMetadata ? (
                        <>
                          <div>Engine: {selectedRun.runMetadata.engineVersion ?? "local-backtest-engine"}</div>
                          <div>Dataset Snapshot: {selectedRun.runMetadata.datasetSnapshotId ?? "n/a"}</div>
                          <div>Dataset SHA256: {selectedRun.runMetadata.datasetChecksumSha256 ?? "n/a"}</div>
                          <div>Strategy SHA256: {selectedRun.runMetadata.strategyChecksumSha256 ?? "n/a"}</div>
                        </>
                      ) : null}
                      {selectedRun.metrics?.benchmarkSymbol ? (
                        <div>Benchmark: {String(selectedRun.metrics.benchmarkSymbol)}</div>
                      ) : null}
                    </div>
                  </div>

                  <div
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      borderRadius: 8,
                      padding: 16,
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Trade Preview</div>
                    {selectedRun.trades && selectedRun.trades.length > 0 ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 240, overflow: "auto" }}>
                        {selectedRun.trades.slice(-12).reverse().map((trade, index) => (
                          <div
                            key={`${trade.timestamp}-${trade.symbol}-${index}`}
                            style={{
                              display: "grid",
                              gridTemplateColumns: "1fr auto auto",
                              gap: 12,
                              fontSize: 12,
                              paddingBottom: 8,
                              borderBottom: "1px solid rgba(255,255,255,0.06)",
                            }}
                          >
                            <span>
                              {trade.symbol} {trade.side.toUpperCase()} {trade.quantity}
                            </span>
                            <span>{formatMoney(trade.price)}</span>
                            <span style={{ color: "rgba(255,255,255,0.55)" }}>
                              {trade.timestamp}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
                        No trade log available for this run.
                      </div>
                    )}
                  </div>

                  <div
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      borderRadius: 8,
                      padding: 16,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 10 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>Artifacts and Robustness</div>
                      {selectedRun.executionMode === "backend" ? (
                        <button
                          onClick={() => {
                            void handleRunRobustness();
                          }}
                          disabled={advancedBusy === "robustness"}
                          style={{
                            padding: "8px 12px",
                            background: "rgba(168,85,247,0.18)",
                            border: "1px solid rgba(168,85,247,0.35)",
                            borderRadius: 4,
                            color: "#d8b4fe",
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          {advancedBusy === "robustness" ? "Running..." : "Run Robustness Suite"}
                        </button>
                      ) : null}
                    </div>
                    {runArtifacts.length > 0 ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
                        {runArtifacts.map((artifact) => (
                          <div
                            key={String(artifact.artifactId ?? artifact.artifactUri)}
                            style={{
                              fontSize: 12,
                              paddingBottom: 8,
                              borderBottom: "1px solid rgba(255,255,255,0.06)",
                              color: "rgba(255,255,255,0.75)",
                            }}
                          >
                            <div>{String(artifact.artifactKind ?? "artifact")}</div>
                            <div style={{ color: "rgba(255,255,255,0.55)" }}>{String(artifact.artifactUri ?? "")}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 12 }}>
                        No persisted backend artifacts loaded for this run.
                      </div>
                    )}
                    {robustnessReport ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 4 }}>
                        {Array.isArray(robustnessReport.walkForward) && (robustnessReport.walkForward as unknown[]).length > 0 ? (
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.82)", marginBottom: 6 }}>Walk-Forward Windows</div>
                            <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                              <thead>
                                <tr style={{ color: "rgba(255,255,255,0.5)" }}>
                                  <th style={{ textAlign: "left", paddingBottom: 4, paddingRight: 8 }}>Train</th>
                                  <th style={{ textAlign: "left", paddingBottom: 4, paddingRight: 8 }}>Test</th>
                                  <th style={{ textAlign: "right", paddingBottom: 4, paddingRight: 8 }}>Return</th>
                                  <th style={{ textAlign: "right", paddingBottom: 4, paddingRight: 8 }}>Sharpe</th>
                                  <th style={{ textAlign: "right", paddingBottom: 4 }}>Max DD</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(robustnessReport.walkForward as Array<Record<string, unknown>>).map((row, i) => (
                                  <tr key={i} style={{ borderTop: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.75)" }}>
                                    <td style={{ padding: "3px 8px 3px 0" }}>{String(row.trainStart ?? "").slice(0, 10)}–{String(row.trainEnd ?? "").slice(0, 10)}</td>
                                    <td style={{ padding: "3px 8px 3px 0" }}>{String(row.testStart ?? "").slice(0, 10)}–{String(row.testEnd ?? "").slice(0, 10)}</td>
                                    <td style={{ padding: "3px 8px 3px 0", textAlign: "right" }}>{formatPercent(typeof row.totalReturn === "number" ? row.totalReturn : undefined)}</td>
                                    <td style={{ padding: "3px 8px 3px 0", textAlign: "right" }}>{formatNumber(typeof row.sharpeRatio === "number" ? row.sharpeRatio : undefined)}</td>
                                    <td style={{ padding: "3px 0", textAlign: "right" }}>{formatPercent(typeof row.maxDrawdown === "number" ? row.maxDrawdown : undefined)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : null}
                        {Array.isArray(robustnessReport.regimeSlices) && (robustnessReport.regimeSlices as unknown[]).length > 0 ? (
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.82)", marginBottom: 6 }}>Regime Slices</div>
                            <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                              <thead>
                                <tr style={{ color: "rgba(255,255,255,0.5)" }}>
                                  <th style={{ textAlign: "left", paddingBottom: 4, paddingRight: 8 }}>Regime</th>
                                  <th style={{ textAlign: "right", paddingBottom: 4, paddingRight: 8 }}>Bars</th>
                                  <th style={{ textAlign: "right", paddingBottom: 4, paddingRight: 8 }}>Return</th>
                                  <th style={{ textAlign: "right", paddingBottom: 4 }}>Sharpe</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(robustnessReport.regimeSlices as Array<Record<string, unknown>>).map((row, i) => (
                                  <tr key={i} style={{ borderTop: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.75)" }}>
                                    <td style={{ padding: "3px 8px 3px 0" }}>{String(row.regime ?? "")}</td>
                                    <td style={{ padding: "3px 8px 3px 0", textAlign: "right" }}>{typeof row.barCount === "number" ? row.barCount : "--"}</td>
                                    <td style={{ padding: "3px 8px 3px 0", textAlign: "right" }}>{formatPercent(typeof row.totalReturn === "number" ? row.totalReturn : undefined)}</td>
                                    <td style={{ padding: "3px 0", textAlign: "right" }}>{formatNumber(typeof row.sharpeRatio === "number" ? row.sharpeRatio : undefined)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : null}
                        {robustnessReport.bootstrap != null && typeof robustnessReport.bootstrap === "object" ? (
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.82)", marginBottom: 6 }}>Bootstrap Distribution</div>
                            <div style={{ display: "flex", gap: 16, fontSize: 11, color: "rgba(255,255,255,0.75)" }}>
                              {(() => {
                                const b = robustnessReport.bootstrap as Record<string, unknown>;
                                return (
                                  <>
                                    <span>Iterations: {typeof b.iterations === "number" ? b.iterations : "--"}</span>
                                    <span>Mean Return: {formatPercent(typeof b.meanReturn === "number" ? b.meanReturn : undefined)}</span>
                                    <span>P5: {formatPercent(typeof b.p05Return === "number" ? b.p05Return : undefined)}</span>
                                    <span>P95: {formatPercent(typeof b.p95Return === "number" ? b.p95Return : undefined)}</span>
                                  </>
                                );
                              })()}
                            </div>
                          </div>
                        ) : null}
                        {Array.isArray(robustnessReport.stressTests) && (robustnessReport.stressTests as unknown[]).length > 0 ? (
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.82)", marginBottom: 6 }}>Stress Tests</div>
                            <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                              <thead>
                                <tr style={{ color: "rgba(255,255,255,0.5)" }}>
                                  <th style={{ textAlign: "left", paddingBottom: 4, paddingRight: 8 }}>Scenario</th>
                                  <th style={{ textAlign: "right", paddingBottom: 4, paddingRight: 8 }}>Return</th>
                                  <th style={{ textAlign: "right", paddingBottom: 4, paddingRight: 8 }}>Sharpe</th>
                                  <th style={{ textAlign: "right", paddingBottom: 4 }}>Max DD</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(robustnessReport.stressTests as Array<Record<string, unknown>>).map((row, i) => (
                                  <tr key={i} style={{ borderTop: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.75)" }}>
                                    <td style={{ padding: "3px 8px 3px 0" }}>{String(row.scenario ?? "")}</td>
                                    <td style={{ padding: "3px 8px 3px 0", textAlign: "right" }}>{formatPercent(typeof row.totalReturn === "number" ? row.totalReturn : undefined)}</td>
                                    <td style={{ padding: "3px 8px 3px 0", textAlign: "right" }}>{formatNumber(typeof row.sharpeRatio === "number" ? row.sharpeRatio : undefined)}</td>
                                    <td style={{ padding: "3px 0", textAlign: "right" }}>{formatPercent(typeof row.maxDrawdown === "number" ? row.maxDrawdown : undefined)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : null}
                        <details>
                          <summary style={{ cursor: "pointer", fontSize: 11, color: "rgba(255,255,255,0.45)" }}>
                            Raw robustness payload
                          </summary>
                          <pre style={{ whiteSpace: "pre-wrap", fontSize: 11, color: "rgba(255,255,255,0.55)", marginTop: 6 }}>
                            {prettyJson(robustnessReport)}
                          </pre>
                        </details>
                      </div>
                    ) : null}
                  </div>

                  <div
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      borderRadius: 8,
                      padding: 16,
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Experiment Metadata</div>
                    {selectedRun.executionMode === "backend" ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        <input
                          value={experimentNameDraft}
                          onChange={(event) => setExperimentNameDraft(event.target.value)}
                          placeholder="Experiment name"
                          style={{
                            padding: "8px 10px",
                            background: "rgba(0,0,0,0.3)",
                            border: "1px solid rgba(255,255,255,0.15)",
                            borderRadius: 4,
                            color: "white",
                            fontSize: 12,
                          }}
                        />
                        <input
                          value={experimentTagsDraft}
                          onChange={(event) => setExperimentTagsDraft(event.target.value)}
                          placeholder="Tags, comma separated"
                          style={{
                            padding: "8px 10px",
                            background: "rgba(0,0,0,0.3)",
                            border: "1px solid rgba(255,255,255,0.15)",
                            borderRadius: 4,
                            color: "white",
                            fontSize: 12,
                          }}
                        />
                        <textarea
                          value={experimentNotesDraft}
                          onChange={(event) => setExperimentNotesDraft(event.target.value)}
                          placeholder="Hypothesis, caveats, validation notes, next changes"
                          style={{
                            width: "100%",
                            minHeight: 110,
                            padding: "10px 12px",
                            background: "rgba(0,0,0,0.3)",
                            border: "1px solid rgba(255,255,255,0.15)",
                            borderRadius: 4,
                            color: "white",
                            fontSize: 12,
                            resize: "vertical",
                          }}
                        />
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}>
                            {runExperiment?.updatedAt ? `Last updated ${runExperiment.updatedAt}` : "No experiment metadata saved yet."}
                          </div>
                          <button
                            onClick={() => {
                              void handleSaveExperiment();
                            }}
                            disabled={advancedBusy === "experiment"}
                            style={{
                              padding: "8px 12px",
                              background: "rgba(34,197,94,0.2)",
                              border: "1px solid rgba(34,197,94,0.4)",
                              borderRadius: 4,
                              color: "#86efac",
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: "pointer",
                            }}
                          >
                            {advancedBusy === "experiment" ? "Saving..." : "Save Experiment"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
                        Experiment metadata persistence is available for backend runs.
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div style={{ color: "rgba(255,255,255,0.5)" }}>
                Select a run from Run History to inspect metrics, charts, and trade activity.
              </div>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default StrategyResearch;
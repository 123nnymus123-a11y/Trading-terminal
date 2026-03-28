export type ParityComparableRun = {
  runId: string;
  metrics: {
    totalReturn?: number;
    sharpeRatio?: number;
    maxDrawdown?: number;
    numTrades?: number;
    endingCapital?: number;
  };
};

export type ParityThresholds = {
  totalReturnAbs: number;
  sharpeAbs: number;
  maxDrawdownAbs: number;
  endingCapitalAbs: number;
  numTradesAbs: number;
};

export type ParityMetricDiagnostic = {
  metric:
    | "totalReturn"
    | "sharpeRatio"
    | "maxDrawdown"
    | "endingCapital"
    | "numTrades";
  baseline: number;
  candidate: number;
  absoluteDelta: number;
  threshold: number;
  pass: boolean;
  message: string;
};

export type ParityDiagnostics = {
  pass: boolean;
  baselineRunId: string;
  candidateRunId: string;
  metrics: ParityMetricDiagnostic[];
};

export const DEFAULT_PARITY_THRESHOLDS: ParityThresholds = {
  totalReturnAbs: 0.001,
  sharpeAbs: 0.05,
  maxDrawdownAbs: 0.002,
  endingCapitalAbs: 1,
  numTradesAbs: 0,
};

function metricDiagnostic(input: {
  metric: ParityMetricDiagnostic["metric"];
  baseline: number;
  candidate: number;
  threshold: number;
}): ParityMetricDiagnostic {
  const absoluteDelta = Math.abs(input.candidate - input.baseline);
  const pass = absoluteDelta <= input.threshold;
  return {
    metric: input.metric,
    baseline: input.baseline,
    candidate: input.candidate,
    absoluteDelta,
    threshold: input.threshold,
    pass,
    message: pass
      ? `${input.metric} drift ${absoluteDelta.toFixed(6)} within threshold ${input.threshold.toFixed(6)}`
      : `${input.metric} drift ${absoluteDelta.toFixed(6)} exceeded threshold ${input.threshold.toFixed(6)}`,
  };
}

export function compareRunsForParity(
  baseline: ParityComparableRun,
  candidate: ParityComparableRun,
  thresholds: Partial<ParityThresholds> = {},
): ParityDiagnostics {
  const effectiveThresholds: ParityThresholds = {
    ...DEFAULT_PARITY_THRESHOLDS,
    ...thresholds,
  };

  const baselineTotalReturn = baseline.metrics.totalReturn ?? 0;
  const candidateTotalReturn = candidate.metrics.totalReturn ?? 0;
  const baselineSharpe = baseline.metrics.sharpeRatio ?? 0;
  const candidateSharpe = candidate.metrics.sharpeRatio ?? 0;
  const baselineMaxDrawdown = baseline.metrics.maxDrawdown ?? 0;
  const candidateMaxDrawdown = candidate.metrics.maxDrawdown ?? 0;
  const baselineEndingCapital = baseline.metrics.endingCapital ?? 0;
  const candidateEndingCapital = candidate.metrics.endingCapital ?? 0;
  const baselineNumTrades = baseline.metrics.numTrades ?? 0;
  const candidateNumTrades = candidate.metrics.numTrades ?? 0;

  const metrics: ParityMetricDiagnostic[] = [
    metricDiagnostic({
      metric: "totalReturn",
      baseline: baselineTotalReturn,
      candidate: candidateTotalReturn,
      threshold: effectiveThresholds.totalReturnAbs,
    }),
    metricDiagnostic({
      metric: "sharpeRatio",
      baseline: baselineSharpe,
      candidate: candidateSharpe,
      threshold: effectiveThresholds.sharpeAbs,
    }),
    metricDiagnostic({
      metric: "maxDrawdown",
      baseline: baselineMaxDrawdown,
      candidate: candidateMaxDrawdown,
      threshold: effectiveThresholds.maxDrawdownAbs,
    }),
    metricDiagnostic({
      metric: "endingCapital",
      baseline: baselineEndingCapital,
      candidate: candidateEndingCapital,
      threshold: effectiveThresholds.endingCapitalAbs,
    }),
    metricDiagnostic({
      metric: "numTrades",
      baseline: baselineNumTrades,
      candidate: candidateNumTrades,
      threshold: effectiveThresholds.numTradesAbs,
    }),
  ];

  return {
    pass: metrics.every((metric) => metric.pass),
    baselineRunId: baseline.runId,
    candidateRunId: candidate.runId,
    metrics,
  };
}

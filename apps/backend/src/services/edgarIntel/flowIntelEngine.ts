import type {
  EdgarFilingRecord,
  EdgarFlowAdvice,
  EdgarFlowAnomalyFinding,
  EdgarFlowHeatmapCell,
  EdgarFlowIntelPayload,
  EdgarFlowSectorCluster,
} from "@tc/shared";

function toRounded(value: number, digits = 1): number {
  if (!Number.isFinite(value)) return 0;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function normalizeScore(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function severityFromScore(score: number): "info" | "warning" | "critical" {
  if (score >= 85) return "critical";
  if (score >= 65) return "warning";
  return "info";
}

export function buildFlowAnomalyFingerprint(
  anomaly: Pick<
    EdgarFlowAnomalyFinding,
    "ticker" | "company_name" | "severity" | "triggers" | "filed_at"
  >,
): string {
  const ticker = (anomaly.ticker ?? "").toUpperCase().trim();
  const company = anomaly.company_name.trim().toLowerCase();
  const day = anomaly.filed_at.slice(0, 10);
  const triggerKey = [...anomaly.triggers].sort().join("|");
  return `${ticker}|${company}|${anomaly.severity}|${triggerKey}|${day}`;
}

export function buildFlowAnomalyFindings(
  filings: EdgarFilingRecord[],
): EdgarFlowAnomalyFinding[] {
  const tickerFrequency = new Map<string, number>();
  for (const filing of filings) {
    const ticker = (filing.ticker ?? "").toUpperCase().trim();
    if (!ticker) continue;
    tickerFrequency.set(ticker, (tickerFrequency.get(ticker) ?? 0) + 1);
  }

  const findings: EdgarFlowAnomalyFinding[] = [];

  for (const filing of filings) {
    const materiality = normalizeScore(filing.materiality?.overall_score);
    const unusualLanguage = normalizeScore(
      filing.materiality?.unusual_language_score,
    );
    const routePriority = normalizeScore(filing.routing?.route_priority);
    const ticker = (filing.ticker ?? "").toUpperCase().trim();
    const frequency = ticker ? (tickerFrequency.get(ticker) ?? 0) : 0;
    const hasSupplierSignal = (filing.parse?.derived_records ?? []).some(
      (record) => record.record_type === "supplier_dependency",
    );

    const triggers: string[] = [];
    if (unusualLanguage >= 60) {
      triggers.push("language_tone_delta_spike");
    }
    if (materiality >= 72) {
      triggers.push("materiality_threshold_breach");
    }
    if (frequency >= 3) {
      triggers.push("ticker_frequency_burst");
    }
    if (hasSupplierSignal) {
      triggers.push("new_supplier_dependency_signal");
    }
    if (routePriority >= 70) {
      triggers.push("cross_filing_cluster_pressure");
    }

    if (!triggers.length) {
      continue;
    }

    const anomalyScore = toRounded(
      materiality * 0.5 + unusualLanguage * 0.25 + routePriority * 0.25,
      1,
    );

    findings.push({
      id: `anomaly:${filing.filing_id}`,
      filing_id: filing.filing_id,
      ...(ticker ? { ticker } : {}),
      company_name: filing.company_name,
      severity: severityFromScore(anomalyScore),
      anomaly_score: anomalyScore,
      triggers,
      rationale:
        triggers.length > 1
          ? `${triggers.length} anomaly signals fired for this filing.`
          : "Single strong anomaly signal fired for this filing.",
      filed_at: filing.filing_date,
    });
  }

  return findings.sort((a, b) => b.anomaly_score - a.anomaly_score);
}

export function buildFlowAdvice(
  findings: EdgarFlowAnomalyFinding[],
  filings: EdgarFilingRecord[],
): EdgarFlowAdvice {
  const topFinding = findings[0];
  const criticalCount = findings.filter(
    (item) => item.severity === "critical",
  ).length;

  const recommendation: EdgarFlowAdvice["recommendation"] =
    criticalCount >= 2 || (topFinding?.anomaly_score ?? 0) >= 88
      ? "avoid"
      : topFinding
        ? "watch"
        : "do";

  const confidence = topFinding
    ? Math.max(0.3, Math.min(0.96, topFinding.anomaly_score / 100))
    : 0.42;

  const topTicker = topFinding?.ticker ?? filings[0]?.ticker ?? "market";
  const highMateriality = filings.filter(
    (filing) => normalizeScore(filing.materiality?.overall_score) >= 72,
  ).length;

  return {
    headline: topFinding
      ? `Unusual filing pressure detected around ${topTicker}`
      : "No major filing anomalies in current window",
    synopsis: topFinding
      ? "FLOW is seeing concentrated anomaly signals from language shifts, materiality, and routing priority."
      : "The current filing stream is stable with no high-confidence anomaly clusters.",
    recommendation,
    confidence: toRounded(confidence, 2),
    why_it_matters: [
      `${findings.length} anomaly findings detected across ${filings.length} filings.`,
      `${highMateriality} filings crossed materiality threshold 72+.`,
      topFinding
        ? `Top trigger set: ${topFinding.triggers.join(", ")}.`
        : "No trigger family exceeded the anomaly threshold.",
    ],
    what_to_watch: [
      "Track repeat anomalies from the same ticker over the next 48h.",
      "Confirm whether supplier/customer dependency mentions are increasing.",
      "Compare latest anomaly score with prior week cluster baseline.",
    ],
  };
}

export function buildFlowIntelPayload(
  filings: EdgarFilingRecord[],
  windowDays: number,
): EdgarFlowIntelPayload {
  const findings = buildFlowAnomalyFindings(filings);
  const findingByFilingId = new Map(
    findings.map((item) => [item.filing_id, item]),
  );

  const timeline = filings.map((filing) => {
    const materiality = normalizeScore(filing.materiality?.overall_score);
    const unusualLanguage = normalizeScore(
      filing.materiality?.unusual_language_score,
    );
    const routePriority = normalizeScore(filing.routing?.route_priority);
    const finding = findingByFilingId.get(filing.filing_id);
    const anomalyScore = finding
      ? finding.anomaly_score
      : toRounded(materiality * 0.6 + unusualLanguage * 0.4, 1);

    return {
      filing_id: filing.filing_id,
      ...(filing.ticker ? { ticker: filing.ticker } : {}),
      company_name: filing.company_name,
      form_type: filing.form_type,
      filing_date: filing.filing_date,
      materiality_score: toRounded(materiality, 1),
      unusual_language_score: toRounded(unusualLanguage, 1),
      route_priority: toRounded(routePriority, 1),
      anomaly_score: anomalyScore,
      is_anomaly: Boolean(finding),
      ...((filing.filing_detail_url ?? filing.primary_document_url)
        ? {
            filing_url: filing.filing_detail_url ?? filing.primary_document_url,
          }
        : {}),
    };
  });

  const companyNodes = new Map<
    string,
    {
      id: string;
      label: string;
      type: "company";
      filing_count: number;
      anomaly_count: number;
      score_total: number;
    }
  >();
  const signalNodes = new Map<
    string,
    {
      id: string;
      label: string;
      type: "signal";
      filing_count: number;
      anomaly_count: number;
      avg_materiality: number;
    }
  >();
  const edges = new Map<
    string,
    {
      source: string;
      target: string;
      weight: number;
      relation_type: "supplier_dependency" | "theme_cluster" | "co_filed";
    }
  >();

  const addEdge = (
    source: string,
    target: string,
    relationType: "supplier_dependency" | "theme_cluster" | "co_filed",
  ) => {
    const edgeId = `${relationType}:${source}->${target}`;
    const current = edges.get(edgeId);
    if (current) {
      current.weight += 1;
      return;
    }
    edges.set(edgeId, {
      source,
      target,
      relation_type: relationType,
      weight: 1,
    });
  };

  const byDay = new Map<string, string[]>();

  for (const filing of filings) {
    const ticker = (filing.ticker ?? filing.cik).toUpperCase();
    const companyId = `company:${ticker}`;
    const materiality = normalizeScore(filing.materiality?.overall_score);
    const anomaly = findingByFilingId.get(filing.filing_id);
    const company = companyNodes.get(companyId) ?? {
      id: companyId,
      label: ticker,
      type: "company" as const,
      filing_count: 0,
      anomaly_count: 0,
      score_total: 0,
    };
    company.filing_count += 1;
    company.score_total += materiality;
    if (anomaly) {
      company.anomaly_count += 1;
      for (const trigger of anomaly.triggers) {
        const signalId = `signal:${trigger}`;
        const signalNode = signalNodes.get(signalId) ?? {
          id: signalId,
          label: trigger.replace(/_/g, " "),
          type: "signal" as const,
          filing_count: 0,
          anomaly_count: 0,
          avg_materiality: 0,
        };
        signalNode.filing_count += 1;
        signalNode.anomaly_count += 1;
        signalNodes.set(signalId, signalNode);
        addEdge(companyId, signalId, "theme_cluster");
      }
    }
    if (
      (filing.parse?.derived_records ?? []).some(
        (record) => record.record_type === "supplier_dependency",
      )
    ) {
      const supplierSignalId = "signal:supplier_dependency";
      const supplierNode = signalNodes.get(supplierSignalId) ?? {
        id: supplierSignalId,
        label: "supplier dependency",
        type: "signal" as const,
        filing_count: 0,
        anomaly_count: 0,
        avg_materiality: 0,
      };
      supplierNode.filing_count += 1;
      supplierNode.avg_materiality = toRounded(
        (supplierNode.avg_materiality + materiality) / 2,
        1,
      );
      signalNodes.set(supplierSignalId, supplierNode);
      addEdge(companyId, supplierSignalId, "supplier_dependency");
    }
    companyNodes.set(companyId, company);

    const dayKey = filing.filing_date.slice(0, 10);
    const dayTickers = byDay.get(dayKey) ?? [];
    dayTickers.push(companyId);
    byDay.set(dayKey, dayTickers);
  }

  for (const tickers of byDay.values()) {
    if (tickers.length < 2) continue;
    const unique = Array.from(new Set(tickers));
    for (let i = 0; i < unique.length; i += 1) {
      for (let j = i + 1; j < unique.length; j += 1) {
        const source = unique[i];
        const target = unique[j];
        if (!source || !target) continue;
        addEdge(source, target, "co_filed");
      }
    }
  }

  const entityNodes = [
    ...Array.from(companyNodes.values()).map((node) => ({
      id: node.id,
      label: node.label,
      type: node.type,
      filing_count: node.filing_count,
      anomaly_count: node.anomaly_count,
      avg_materiality: node.filing_count
        ? toRounded(node.score_total / node.filing_count, 1)
        : 0,
    })),
    ...Array.from(signalNodes.values()),
  ];

  const entityEdges = Array.from(edges.entries())
    .map(([id, edge]) => ({ id, ...edge }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 80);

  const heatmapMap = new Map<string, EdgarFlowHeatmapCell>();
  for (const filing of filings) {
    const ticker = (filing.ticker ?? filing.cik).toUpperCase();
    const formType = filing.form_type;
    const finding = findingByFilingId.get(filing.filing_id);
    const key = `${ticker}|${formType}`;
    const current = heatmapMap.get(key) ?? {
      row_label: ticker,
      column_label: formType,
      value: 0,
      anomaly_count: 0,
    };
    current.value += 1;
    if (finding) {
      current.anomaly_count += 1;
    }
    heatmapMap.set(key, current);
  }
  const anomalyHeatmap = Array.from(heatmapMap.values())
    .map((cell) => ({
      ...cell,
      value: toRounded(cell.value, 0),
    }))
    .sort((a, b) => b.anomaly_count - a.anomaly_count || b.value - a.value)
    .slice(0, 120);

  const clusterMap = new Map<
    string,
    {
      id: string;
      label: string;
      tickers: Set<string>;
      event_count: number;
      anomaly_count: number;
      anomaly_total: number;
      top_signals: Map<string, number>;
    }
  >();

  for (const filing of filings) {
    const ticker = (filing.ticker ?? filing.cik).toUpperCase();
    const tag =
      filing.ai_annotation?.thematic_tags?.[0] ?? `form:${filing.form_type}`;
    const clusterId = `cluster:${tag}`;
    const cluster = clusterMap.get(clusterId) ?? {
      id: clusterId,
      label: tag,
      tickers: new Set<string>(),
      event_count: 0,
      anomaly_count: 0,
      anomaly_total: 0,
      top_signals: new Map<string, number>(),
    };
    cluster.tickers.add(ticker);
    cluster.event_count += 1;
    const finding = findingByFilingId.get(filing.filing_id);
    if (finding) {
      cluster.anomaly_count += 1;
      cluster.anomaly_total += finding.anomaly_score;
      for (const trigger of finding.triggers) {
        cluster.top_signals.set(
          trigger,
          (cluster.top_signals.get(trigger) ?? 0) + 1,
        );
      }
    }
    clusterMap.set(clusterId, cluster);
  }

  const sectorPatterns: EdgarFlowSectorCluster[] = Array.from(
    clusterMap.values(),
  )
    .map((cluster) => ({
      id: cluster.id,
      label: cluster.label,
      tickers: Array.from(cluster.tickers).slice(0, 8),
      event_count: cluster.event_count,
      anomaly_count: cluster.anomaly_count,
      avg_anomaly_score: cluster.anomaly_count
        ? toRounded(cluster.anomaly_total / cluster.anomaly_count, 1)
        : 0,
      top_signals: Array.from(cluster.top_signals.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([signal]) => signal),
    }))
    .sort(
      (a, b) =>
        b.anomaly_count - a.anomaly_count || b.event_count - a.event_count,
    )
    .slice(0, 24);

  const advice = buildFlowAdvice(findings, filings);
  const criticalCount = findings.filter(
    (item) => item.severity === "critical",
  ).length;

  return {
    generated_at: new Date().toISOString(),
    window_days: windowDays,
    summary: {
      total_filings: filings.length,
      anomaly_count: findings.length,
      critical_count: criticalCount,
      routed_to_flow: filings.filter((filing) =>
        Boolean(filing.routing?.route_flow),
      ).length,
    },
    timeline,
    entity_graph: {
      nodes: entityNodes,
      edges: entityEdges,
    },
    anomaly_heatmap: anomalyHeatmap,
    sector_patterns: sectorPatterns,
    anomalies: findings.slice(0, 50),
    advice,
    intelligence_digest: {
      title: advice.headline,
      bullets: [
        `${findings.length} anomaly findings in ${windowDays}d window.`,
        `${criticalCount} findings are critical severity.`,
        ...advice.what_to_watch.slice(0, 2),
      ],
    },
  };
}

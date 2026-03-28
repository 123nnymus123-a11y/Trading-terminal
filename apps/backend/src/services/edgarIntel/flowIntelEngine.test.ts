import { describe, expect, it } from "vitest";
import type { EdgarFilingRecord } from "@tc/shared";
import {
  buildFlowAnomalyFindings,
  buildFlowAnomalyFingerprint,
  buildFlowIntelPayload,
} from "./flowIntelEngine.js";

function makeFiling(
  filingId: string,
  overrides: Partial<EdgarFilingRecord> = {},
): EdgarFilingRecord {
  return {
    filing_id: filingId,
    company_name: "Acme Corp",
    cik: "0000123456",
    ticker: "ACME",
    accession_number: `0000123456-${filingId}`,
    filing_date: "2026-03-20T00:00:00.000Z",
    form_type: "8-K",
    ingested_at: "2026-03-20T00:00:00.000Z",
    updated_at: "2026-03-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("flowIntelEngine", () => {
  it("detects expected anomaly trigger families", () => {
    const filings: EdgarFilingRecord[] = [
      makeFiling("f1", {
        materiality: {
          scoring_version: "v1",
          overall_score: 90,
          form_weight_score: 40,
          company_importance_score: 40,
          detected_event_score: 40,
          unusual_language_score: 80,
          historical_deviation_score: 40,
          time_horizon: "immediate",
          score_breakdown: {},
        },
        routing: {
          routing_version: "v1",
          route_flow: true,
          route_intelligence: true,
          route_gwmd: false,
          route_reasoning: ["test"],
          source_layers: {},
          route_priority: 90,
        },
        parse: {
          form_type: "8-K",
          parser_version: "v1",
          sections: {},
          derived_records: [
            {
              record_type: "supplier_dependency",
              title: "Supplier concentration",
              value: {},
              provenance: {},
            },
          ],
        },
      }),
      makeFiling("f2", {
        filing_date: "2026-03-21T00:00:00.000Z",
      }),
      makeFiling("f3", {
        filing_date: "2026-03-22T00:00:00.000Z",
      }),
    ];

    const findings = buildFlowAnomalyFindings(filings);
    const first = findings.find((item) => item.filing_id === "f1");
    expect(first).toBeDefined();
    expect(first?.triggers).toEqual(
      expect.arrayContaining([
        "language_tone_delta_spike",
        "materiality_threshold_breach",
        "ticker_frequency_burst",
        "new_supplier_dependency_signal",
        "cross_filing_cluster_pressure",
      ]),
    );
    expect(first?.severity).toBe("critical");
  });

  it("builds deterministic findings and payload shape from same input", () => {
    const filings: EdgarFilingRecord[] = [
      makeFiling("d1", {
        materiality: {
          scoring_version: "v1",
          overall_score: 88,
          form_weight_score: 30,
          company_importance_score: 30,
          detected_event_score: 30,
          unusual_language_score: 70,
          historical_deviation_score: 30,
          time_horizon: "medium_term",
          score_breakdown: {},
        },
        routing: {
          routing_version: "v1",
          route_flow: true,
          route_intelligence: false,
          route_gwmd: false,
          route_reasoning: ["test"],
          source_layers: {},
          route_priority: 72,
        },
      }),
      makeFiling("d2", {
        ticker: "BETA",
        company_name: "Beta Inc",
        cik: "0000654321",
      }),
    ];

    const findingsA = buildFlowAnomalyFindings(filings);
    const findingsB = buildFlowAnomalyFindings(filings);
    expect(findingsA).toEqual(findingsB);

    const payloadA = buildFlowIntelPayload(filings, 14);
    const payloadB = buildFlowIntelPayload(filings, 14);

    expect(payloadA.summary).toEqual(payloadB.summary);
    expect(payloadA.timeline).toEqual(payloadB.timeline);
    expect(payloadA.entity_graph).toEqual(payloadB.entity_graph);
    expect(payloadA.anomaly_heatmap).toEqual(payloadB.anomaly_heatmap);
    expect(payloadA.sector_patterns).toEqual(payloadB.sector_patterns);
    expect(payloadA.anomalies).toEqual(payloadB.anomalies);
    expect(payloadA.advice).toEqual(payloadB.advice);
    expect(payloadA.intelligence_digest).toEqual(payloadB.intelligence_digest);
  });

  it("normalizes fingerprint ordering by sorted trigger set", () => {
    const first = buildFlowAnomalyFingerprint({
      ticker: "acme",
      company_name: "Acme Corp",
      severity: "warning",
      triggers: ["b", "a", "c"],
      filed_at: "2026-03-24T10:00:00.000Z",
    });

    const second = buildFlowAnomalyFingerprint({
      ticker: "ACME",
      company_name: "acme corp",
      severity: "warning",
      triggers: ["c", "b", "a"],
      filed_at: "2026-03-24T13:00:00.000Z",
    });

    expect(first).toBe(second);
  });
});

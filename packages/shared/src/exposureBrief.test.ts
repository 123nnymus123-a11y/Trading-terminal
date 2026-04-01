import { describe, expect, it } from "vitest";
import {
  composeBriefTrustSummary,
  evaluateExposureBriefTrust,
  serializeExposureBriefCsv,
  type ExposureBrief,
  type ExposureBriefItem,
} from "./exposureBrief.js";

const makeItem = (
  overrides: Partial<ExposureBriefItem>,
): ExposureBriefItem => ({
  nodeId: overrides.nodeId ?? "N1",
  ticker: overrides.ticker ?? null,
  name: overrides.name ?? "Node",
  tier: overrides.tier ?? "direct",
  impactScore: overrides.impactScore ?? 0.7,
  attentionGapScore: overrides.attentionGapScore ?? 0.4,
  concentrationBonus: overrides.concentrationBonus ?? 0.2,
  compositeScore: overrides.compositeScore ?? 0.65,
  confidence: overrides.confidence ?? 0.8,
  confidenceBand: overrides.confidenceBand ?? "high",
  zone: overrides.zone ?? "production",
  evidenceCount: overrides.evidenceCount ?? 2,
  ...(typeof overrides.freshnessDays === "number"
    ? { freshnessDays: overrides.freshnessDays }
    : {}),
});

describe("exposureBrief trust evaluation", () => {
  it("blocks candidate-heavy low-confidence briefs", () => {
    const items = [
      makeItem({ nodeId: "A", zone: "candidate", confidence: 0.2 }),
      makeItem({ nodeId: "B", zone: "candidate", confidence: 0.3 }),
      makeItem({ nodeId: "C", zone: "candidate", confidence: 0.4 }),
      makeItem({ nodeId: "D", zone: "unknown", confidence: 0.35 }),
    ];

    const trust = composeBriefTrustSummary(items);
    const result = evaluateExposureBriefTrust({ items, trust });

    expect(result.trustGate).toBe("block");
    expect(
      result.trustIssues.some((issue) => issue.code === "candidate_heavy"),
    ).toBe(true);
  });

  it("warns on stale-heavy but otherwise moderate briefs", () => {
    const items = [
      makeItem({
        nodeId: "A",
        zone: "production",
        confidence: 0.75,
        freshnessDays: 80,
      }),
      makeItem({
        nodeId: "B",
        zone: "validation",
        confidence: 0.74,
        freshnessDays: 90,
      }),
      makeItem({
        nodeId: "C",
        zone: "production",
        confidence: 0.78,
        freshnessDays: 4,
      }),
      makeItem({
        nodeId: "D",
        zone: "validation",
        confidence: 0.7,
        freshnessDays: 3,
      }),
    ];

    const trust = composeBriefTrustSummary(items);
    const result = evaluateExposureBriefTrust({ items, trust });

    expect(trust.staleRatio).toBeGreaterThanOrEqual(0.5);
    expect(result.trustGate).toBe("warn");
    expect(
      result.trustIssues.some((issue) => issue.code === "stale_data_heavy"),
    ).toBe(true);
  });

  it("passes trust gate for verified high-confidence brief", () => {
    const items = [
      makeItem({ nodeId: "A", zone: "production", confidence: 0.9 }),
      makeItem({ nodeId: "B", zone: "validation", confidence: 0.85 }),
      makeItem({ nodeId: "C", zone: "production", confidence: 0.82 }),
    ];

    const trust = composeBriefTrustSummary(items);
    const result = evaluateExposureBriefTrust({ items, trust });

    expect(result.trustGate).toBe("pass");
    expect(result.trustIssues).toHaveLength(0);
  });
});

describe("exposureBrief csv export", () => {
  it("serializes ranked items as csv rows", () => {
    const brief: ExposureBrief = {
      id: "brief-test",
      source: "gwmd",
      generatedAt: "2026-03-19T12:00:00.000Z",
      shockNodeIds: ["A"],
      params: { severity: 0.6, damping: 0.55 },
      totalNodes: 10,
      impactedNodeCount: 2,
      items: [
        makeItem({ nodeId: "A", name: "ACME, Inc.", freshnessDays: 10 }),
        makeItem({ nodeId: "B", name: 'Beta "Holdings"', ticker: "BETA" }),
      ],
      trust: composeBriefTrustSummary([
        makeItem({ nodeId: "A", name: "ACME, Inc.", freshnessDays: 10 }),
        makeItem({ nodeId: "B", name: 'Beta "Holdings"', ticker: "BETA" }),
      ]),
      trustGate: "warn",
      trustIssues: [],
      dependencyPaths: [],
      riskSignals: [],
    };

    const csv = serializeExposureBriefCsv(brief);
    const lines = csv.split("\n");

    expect(lines[0]?.includes("rank,nodeId,ticker,name")).toBe(true);
    expect(lines).toHaveLength(3);
    expect(lines[1]?.includes('"ACME, Inc."')).toBe(true);
    expect(lines[2]?.includes('"Beta ""Holdings"""')).toBe(true);
  });
});

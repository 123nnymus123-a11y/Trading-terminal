import { afterEach, describe, expect, it, vi } from "vitest";
import { GraphEnrichmentRepository } from "../graphEnrichment/repository";
import { persistGwmdCandidates } from "./gwmdCandidateWriter";
import type { GwmdResearchScope } from "./gwmdVaultBridge";

function emptyScope(): GwmdResearchScope {
  return {
    tickers: [],
    bestCompanyByTicker: new Map(),
    allCompaniesByTicker: new Map(),
    bestEdgeBySemanticKey: new Map(),
    allEdgesBySemanticKey: new Map(),
    existingRelationshipKeys: new Set(),
    missingFieldRefs: [],
    staleFieldRefs: [],
  };
}

describe("persistGwmdCandidates", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("persists enriched company and edge metadata with field statuses", () => {
    const upsertEntitySpy = vi
      .spyOn(GraphEnrichmentRepository, "upsertEntity")
      .mockImplementation(() => {});
    const upsertAliasSpy = vi
      .spyOn(GraphEnrichmentRepository, "upsertAlias")
      .mockImplementation(() => {});
    const upsertEdgeSpy = vi
      .spyOn(GraphEnrichmentRepository, "upsertEdge")
      .mockImplementation(() => {});
    const upsertEvidenceSpy = vi
      .spyOn(GraphEnrichmentRepository, "upsertEvidence")
      .mockImplementation(() => {});
    const linkEvidenceSpy = vi
      .spyOn(GraphEnrichmentRepository, "linkEvidence")
      .mockImplementation(() => {});

    const result = persistGwmdCandidates({
      rootTicker: "AAPL",
      companies: [
        {
          ticker: "AAPL",
          name: "Apple Inc.",
          hq_city: "Cupertino",
          hq_country: "United States",
          hq_lat: 37.3229,
          hq_lon: -122.0322,
        },
        {
          ticker: "TSM",
          name: "Taiwan Semiconductor Manufacturing Company",
          hq_city: "Hsinchu",
          hq_country: "Taiwan",
        },
      ],
      edges: [
        {
          id: "edge-1",
          from_ticker: "AAPL",
          to_ticker: "TSM",
          relation_type: "supplier",
          confidence: 0.84,
          evidence:
            "Source: TSMC annual report - advanced fabrication supports key customer demand.",
          source_type: "annual_report",
          source_citation: "TSMC Annual Report 2025",
          relationship_strength: 0.78,
          related_company_aliases: ["TSMC"],
          related_company_industry: "Semiconductors",
          operating_countries: ["Taiwan", "United States"],
          facility_locations: ["Hsinchu, Taiwan", "Phoenix, Arizona"],
          product_or_service: "Wafer fabrication",
          dependency_summary: "Leading-edge foundry dependency",
          directness: "direct",
          logistics_mode: "air",
          logistics_nodes: ["Taoyuan International Airport"],
          chokepoints: ["Taiwan Strait"],
          exposure_regions: ["Taiwan"],
          field_statuses: {
            facility_locations: "present",
            exposure_regions: "low_confidence_inference",
          },
        },
      ],
      scope: emptyScope(),
    });

    expect(result.entityCount).toBe(2);
    expect(result.edgeCount).toBe(1);
    expect(result.evidenceCount).toBe(1);

    expect(upsertEntitySpy).toHaveBeenCalled();
    expect(upsertAliasSpy).toHaveBeenCalled();
    expect(upsertEdgeSpy).toHaveBeenCalled();
    expect(upsertEvidenceSpy).toHaveBeenCalledTimes(1);
    expect(linkEvidenceSpy).toHaveBeenCalledTimes(1);

    const tsmEntityCall = upsertEntitySpy.mock.calls.find(
      ([payload]) => payload.id === "gwmd:company:TSM:candidate",
    );
    expect(tsmEntityCall).toBeTruthy();
    const entityPayload = tsmEntityCall?.[0];
    const entityMetadata = JSON.parse(entityPayload?.metadataJson ?? "{}");

    expect(entityMetadata.identity.aliases).toContain("TSMC");
    expect(entityMetadata.identity.industry).toBe("Semiconductors");
    expect(entityMetadata.geography.operating_countries).toContain("Taiwan");
    expect(entityMetadata.logistics.nodes).toContain(
      "Taoyuan International Airport",
    );
    expect(entityMetadata.exposure.regions).toContain("Taiwan");
    expect(entityMetadata.field_statuses.exposure_regions).toBe(
      "low_confidence_inference",
    );

    const edgePayload = upsertEdgeSpy.mock.calls[0]?.[0];
    const edgeMetadata = JSON.parse(edgePayload?.metadataJson ?? "{}");
    expect(edgeMetadata.schema).toBe("gwmd_edge_v1");
    expect(edgeMetadata.related_company.aliases).toContain("TSMC");
    expect(edgeMetadata.logistics.mode).toBe("air");
    expect(edgeMetadata.field_statuses.exposure_regions).toBe(
      "low_confidence_inference",
    );
  });
});

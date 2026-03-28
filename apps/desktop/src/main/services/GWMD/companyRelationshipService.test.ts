import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompanyRelationshipService } from "./companyRelationshipService";
import { gwmdMapRepo } from "../../persistence/gwmdMapRepo";
import type { GwmdCompanyRecord } from "../../persistence/gwmdMapRepo";
import type { GwmdRelationshipRecord } from "../../persistence/gwmdMapRepo";

vi.mock("../../persistence/aiResearchRepo", () => ({
  AiResearchRepo: {
    getConfig: () => ({ model: "deepseek-r1:14b" }),
  },
}));

vi.mock("../../persistence/repos", () => ({
  AppSettingsRepo: {
    get: () => ({}),
  },
}));

describe("CompanyRelationshipService", () => {
  let service: CompanyRelationshipService;

  beforeEach(() => {
    service = new CompanyRelationshipService();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("throws on malformed relationships JSON", () => {
    const internal = service as unknown as {
      parseRelationships: (payload: string) => unknown;
    };
    const parseRelationships = internal.parseRelationships.bind(service);
    expect(() => parseRelationships("not-json")).toThrow(
      "Failed to parse relationships",
    );
  });

  it("throws when all parsed relationships fail quality gate", () => {
    const internal = service as unknown as {
      applyRelationshipQualityGate: (
        rows: Array<Record<string, unknown>>,
        strict: boolean,
      ) => unknown[];
    };
    const applyGate = internal.applyRelationshipQualityGate.bind(service);
    const rows = [
      {
        ticker: "ABC",
        name: "ABC Inc",
        relation_type: "supplier",
        confidence: 0.2,
        evidence: "weak",
        latitude: null,
        longitude: null,
        headquarters_city: null,
        headquarters_country: null,
      },
    ];
    const filtered = applyGate(rows, false);
    expect(filtered).toHaveLength(0);
  });

  it("parses richer relationship metadata with field statuses", () => {
    const internal = service as unknown as {
      parseRelationships: (payload: string) => Array<Record<string, unknown>>;
    };
    const parseRelationships = internal.parseRelationships.bind(service);
    const parsed = parseRelationships(
      JSON.stringify([
        {
          ticker: "tsm",
          name: "Taiwan Semiconductor Manufacturing Company",
          relation_type: "supplier",
          confidence: 0.86,
          evidence:
            "Source: TSMC annual report - advanced packaging supplied to major customers.",
          aliases: ["TSMC"],
          industry: "Semiconductors",
          operating_countries: ["Taiwan", "United States"],
          facility_locations: ["Hsinchu, Taiwan", "Phoenix, Arizona"],
          product_or_service: "Wafer fabrication",
          dependency_summary: "Critical leading-edge fabrication partner",
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
      ]),
    );

    expect(parsed).toHaveLength(1);
    expect(parsed[0].aliases).toEqual(["TSMC"]);
    expect(parsed[0].facility_locations).toEqual([
      "Hsinchu, Taiwan",
      "Phoenix, Arizona",
    ]);
    expect(parsed[0].field_statuses).toMatchObject({
      facility_locations: "present",
      exposure_regions: "low_confidence_inference",
    });
  });

  it("returns ticker-scoped cached snapshot on upstream failure", async () => {
    const snapshot = {
      companies: [
        { ticker: "AAPL", name: "Apple", added_at: "", updated_at: "" },
      ] as GwmdCompanyRecord[],
      edges: [] as GwmdRelationshipRecord[],
    };

    vi.spyOn(gwmdMapRepo, "companyExists").mockReturnValue(true);
    vi.spyOn(gwmdMapRepo, "getScopedSnapshot").mockReturnValue(snapshot);

    const fetchMock = vi.fn().mockRejectedValue(new Error("upstream-failed"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await service.generateRelationships("AAPL", {
      refresh: false,
    });

    expect(gwmdMapRepo.getScopedSnapshot).toHaveBeenCalledWith("AAPL");
    expect(result.companies).toEqual(snapshot.companies);
    expect(result.edges).toEqual(snapshot.edges);
    expect(result.meta.status).toBe("degraded_cache");
    expect(result.meta.degraded).toBe(true);
  });
});

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { GwmdMapRepository } from "./gwmdMapRepo";
import type { GwmdCompanyRecord, GwmdRelationshipRecord } from "./gwmdMapRepo";

const runMock = vi.fn();

vi.mock("./db", () => ({
  getDb: () => ({
    prepare: () => ({
      run: runMock,
      all: vi.fn(() => []),
      get: vi.fn(() => null),
    }),
    transaction: (fn: (arg: unknown) => void) => (arg: unknown) => fn(arg),
  }),
}));

describe("GwmdMapRepository", () => {
  beforeEach(() => {
    runMock.mockReset();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("allows storing companies with missing coordinates", () => {
    const repo = new GwmdMapRepository();

    expect(() =>
      repo.addCompanies([
        {
          ticker: "NOLOC",
          name: "No Location Corp",
        },
      ])
    ).not.toThrow();

    expect(runMock).toHaveBeenCalled();
    const firstCall = runMock.mock.calls[0] as unknown[];
    expect(firstCall[2]).toBeNull();
    expect(firstCall[3]).toBeNull();
  });

  it("builds scoped snapshot for focal ticker connected component", () => {
    const repo = new GwmdMapRepository();

    const companies: GwmdCompanyRecord[] = [
      { ticker: "AAPL", name: "Apple", added_at: "", updated_at: "" },
      { ticker: "TSM", name: "TSMC", added_at: "", updated_at: "" },
      { ticker: "MSFT", name: "Microsoft", added_at: "", updated_at: "" },
      { ticker: "XOM", name: "Exxon", added_at: "", updated_at: "" },
    ];
    const relationships: GwmdRelationshipRecord[] = [
      {
        id: "AAPL-TSM-supplier",
        from_ticker: "AAPL",
        to_ticker: "TSM",
        relation_type: "supplier",
        added_at: "",
        updated_at: "",
      },
      {
        id: "TSM-MSFT-partner",
        from_ticker: "TSM",
        to_ticker: "MSFT",
        relation_type: "partner",
        added_at: "",
        updated_at: "",
      },
      {
        id: "XOM-MSFT-customer",
        from_ticker: "XOM",
        to_ticker: "MSFT",
        relation_type: "customer",
        added_at: "",
        updated_at: "",
      },
    ];

    vi.spyOn(repo, "getAllCompanies").mockReturnValue(companies);
    vi.spyOn(repo, "getAllRelationships").mockReturnValue(relationships);

    const snapshot = repo.getScopedSnapshot("AAPL");

    expect(snapshot.companies.map((c) => c.ticker).sort()).toEqual(["AAPL", "MSFT", "TSM", "XOM"]);
    expect(snapshot.edges).toHaveLength(3);
  });

  it("returns empty scoped snapshot when focal ticker is absent", () => {
    const repo = new GwmdMapRepository();
    vi.spyOn(repo, "getAllCompanies").mockReturnValue([{ ticker: "TSM", name: "TSMC", added_at: "", updated_at: "" }]);
    vi.spyOn(repo, "getAllRelationships").mockReturnValue([]);

    const snapshot = repo.getScopedSnapshot("AAPL");
    expect(snapshot).toEqual({ companies: [], edges: [] });
  });

  it("assigns graph tiers/depth based on component anchor distance", () => {
    const repo = new GwmdMapRepository();
    vi.spyOn(repo, "getAllCompanies").mockReturnValue([
      { ticker: "A", name: "A", added_at: "", updated_at: "" },
      { ticker: "B", name: "B", added_at: "", updated_at: "" },
      { ticker: "C", name: "C", added_at: "", updated_at: "" },
      { ticker: "D", name: "D", added_at: "", updated_at: "" },
    ]);
    vi.spyOn(repo, "getAllRelationships").mockReturnValue([
      { id: "A-B", from_ticker: "A", to_ticker: "B", relation_type: "supplier", added_at: "", updated_at: "" },
      { id: "B-C", from_ticker: "B", to_ticker: "C", relation_type: "supplier", added_at: "", updated_at: "" },
      { id: "C-D", from_ticker: "C", to_ticker: "D", relation_type: "supplier", added_at: "", updated_at: "" },
    ]);

    const graph = repo.buildGraph();
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));

    expect(byId.get("B")?.tier).toBe("direct");
    expect(byId.get("A")?.tier).toBe("indirect");
    expect(byId.get("C")?.tier).toBe("indirect");
    expect(byId.get("D")?.tier).toBe("systemic");
    expect((byId.get("D")?.metadata as { gwmdDepth?: number } | undefined)?.gwmdDepth).toBe(2);
    expect((byId.get("A")?.metadata as { geoSource?: string } | undefined)?.geoSource).toBe("unresolved");
  });

  it("filters unsupported relation kinds when building graph edges", () => {
    const repo = new GwmdMapRepository();
    vi.spyOn(repo, "getAllCompanies").mockReturnValue([
      { ticker: "A", name: "A", added_at: "", updated_at: "" },
      { ticker: "B", name: "B", added_at: "", updated_at: "" },
    ]);
    vi.spyOn(repo, "getAllRelationships").mockReturnValue([
      { id: "A-B-supplier", from_ticker: "A", to_ticker: "B", relation_type: "supplier", added_at: "", updated_at: "" },
      { id: "A-B-unknown", from_ticker: "A", to_ticker: "B", relation_type: "unknown_kind", added_at: "", updated_at: "" },
    ]);

    const graph = repo.buildGraph();

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]?.kind).toBe("supplier");
  });

  it("deduplicates case-variant companies and semantic duplicate edges", () => {
    const repo = new GwmdMapRepository();
    vi.spyOn(repo, "getAllCompanies").mockReturnValue([
      { ticker: "AAPL", name: "Apple Inc", added_at: "", updated_at: "" },
      { ticker: "aapl", name: "Apple", hq_lat: 37.3349, hq_lon: -122.009, added_at: "", updated_at: "" },
      { ticker: "TSM", name: "TSMC", added_at: "", updated_at: "" },
    ]);
    vi.spyOn(repo, "getAllRelationships").mockReturnValue([
      { id: "edge-1", from_ticker: "AAPL", to_ticker: "TSM", relation_type: "supplier", added_at: "", updated_at: "" },
      { id: "edge-2", from_ticker: "aapl", to_ticker: "TSM", relation_type: "supplier", added_at: "", updated_at: "" },
    ]);

    const graph = repo.buildGraph();
    const appleNodes = graph.nodes.filter((node) => node.id === "AAPL");
    const supplierEdges = graph.edges.filter((edge) => edge.from === "AAPL" && edge.to === "TSM" && edge.kind === "supplier");

    expect(appleNodes).toHaveLength(1);
    expect(supplierEdges).toHaveLength(1);
  });
});

import type {
  MindMapData,
  SupplyChainGenerationOptions,
} from "@tc/shared/supplyChain";
import { ensureCanonicalStructures } from "@tc/shared/supplyChainGraph";
import { SupplyChainGraphRepo } from "../../persistence/supplyChainGraphRepo";
import { ingestOfficialDocuments } from "./officialDocIngestion";
import {
  extractEdgesFromDocument,
  heuristicVerify,
  verifyEdgesForDocument,
} from "./officialExtraction";
import { generateSupplyChainWithOllama } from "./ollamaSupplyChain";
import { resolveCompanyGeo } from "./companyGeo";

function nowIso() {
  return new Date().toISOString();
}

export async function generateOfficialSupplyChain(
  model: string,
  options: SupplyChainGenerationOptions,
): Promise<{ data: MindMapData; fromCache: boolean; needsRefresh: boolean }> {
  const strictMode = options.strictMode ?? true;
  const includeHypothesis = options.includeHypothesis ?? false;
  const hops = options.hops ?? 2;
  const minEdgeWeight = options.minEdgeWeight ?? 0;
  const ticker = options.ticker.trim().toUpperCase();
  const globalTickers = Array.from(
    new Set(
      [ticker, ...(options.globalTickers ?? [])].map((t) =>
        t.trim().toUpperCase(),
      ),
    ),
  ).filter(Boolean);
  const isGlobal = globalTickers.length > 1;
  const cacheTicker = isGlobal ? `GLOBAL:${globalTickers.join("|")}` : ticker;

  SupplyChainGraphRepo.upsertCompany({
    canonicalName: ticker,
    tickers: [ticker],
  });

  const cacheOptions = { strictMode, includeHypothesis, hops, minEdgeWeight };
  const cached = SupplyChainGraphRepo.getEgoGraphCached(
    cacheTicker,
    cacheOptions,
  );
  if (cached && !options.refresh) {
    return {
      data: cached.data,
      fromCache: true,
      needsRefresh: cached.needsRefresh,
    };
  }

  // Check if graph is empty and auto-trigger refresh
  let shouldRefresh = !!options.refresh;
  if (!shouldRefresh && !strictMode) {
    const needsRefresh = globalTickers.some(
      (t) =>
        SupplyChainGraphRepo.getEgoGraph(t, cacheOptions).graph.edges.length ===
        0,
    );
    if (needsRefresh) shouldRefresh = true;
  }

  if (shouldRefresh) {
    for (const t of globalTickers) {
      await refreshGraphFromOfficialSources(
        model,
        t,
        strictMode,
        includeHypothesis,
      );
    }
  }

  const merged = isGlobal
    ? SupplyChainGraphRepo.getMergedEgoGraph(globalTickers, cacheOptions)
    : SupplyChainGraphRepo.getEgoGraph(ticker, cacheOptions);
  const withEvidence = SupplyChainGraphRepo.attachEvidence(merged.graph);

  const centerCompanyId = merged.centerCompanyId ?? null;
  const centerNode = centerCompanyId
    ? withEvidence.nodes.find((node) => node.id === centerCompanyId)
    : null;
  const freshnessList = globalTickers.map((t) =>
    SupplyChainGraphRepo.getDataFreshness(t),
  );
  const dataFreshness = {
    lastIngestedDocDate: freshnessList
      .map((f) => f.lastIngestedDocDate)
      .filter(Boolean)
      .sort()
      .slice(-1)[0],
    documentsUsed: freshnessList.reduce(
      (sum, f) => sum + (f.documentsUsed ?? 0),
      0,
    ),
    verifiedEdges: freshnessList.reduce(
      (sum, f) => sum + (f.verifiedEdges ?? 0),
      0,
    ),
    hypothesisEdges: freshnessList.reduce(
      (sum, f) => sum + (f.hypothesisEdges ?? 0),
      0,
    ),
  };
  const freshnessPayload: NonNullable<MindMapData["dataFreshness"]> = {
    lastExtractionAt: nowIso(),
  };
  if (dataFreshness.lastIngestedDocDate)
    freshnessPayload.lastIngestedDocDate = dataFreshness.lastIngestedDocDate;
  if (typeof dataFreshness.documentsUsed === "number")
    freshnessPayload.documentsUsed = dataFreshness.documentsUsed;
  if (typeof dataFreshness.verifiedEdges === "number")
    freshnessPayload.verifiedEdges = dataFreshness.verifiedEdges;
  if (typeof dataFreshness.hypothesisEdges === "number")
    freshnessPayload.hypothesisEdges = dataFreshness.hypothesisEdges;

  const mindMapData: MindMapData = {
    centerTicker: ticker,
    centerName: centerNode?.label ?? ticker,
    generatedAt: nowIso(),
    categories: [],
    graph: withEvidence,
    focalTickers: globalTickers,
    strictMode,
    includeHypothesis,
    hops,
    minEdgeWeight,
    hypothesisAvailable: (dataFreshness.hypothesisEdges ?? 0) > 0,
    dataFreshness: freshnessPayload,
  };
  if (centerCompanyId) mindMapData.centerNodeId = centerCompanyId;

  SupplyChainGraphRepo.setEgoGraphCached(
    cacheTicker,
    cacheOptions,
    mindMapData,
  );

  return {
    data: ensureCanonicalStructures(mindMapData),
    fromCache: false,
    needsRefresh: false,
  };
}

async function refreshGraphFromOfficialSources(
  model: string,
  ticker: string,
  strictMode: boolean,
  includeHypothesis: boolean,
) {
  const geoCache = new Map<string, boolean>();
  let geoBudget = 180;
  const geoDelayMs = 80;
  const geoStartMs = Date.now();
  const geoTimeBudgetMs = 12_000;
  const geocodeCompany = async (
    companyName: string,
    companyId?: string,
    hints?: { city?: string; state?: string; country?: string },
  ) => {
    if (geoBudget <= 0) return;
    if (Date.now() - geoStartMs > geoTimeBudgetMs) {
      geoBudget = 0;
      return;
    }
    const cacheKey = companyName.trim().toLowerCase();
    if (geoCache.has(cacheKey)) return;
    const geo = await resolveCompanyGeo(companyName, hints).catch(() => null);
    if (geo) {
      SupplyChainGraphRepo.upsertCompany({
        id: companyId,
        canonicalName: companyName,
        metadata: {
          hqLat: geo.lat,
          hqLon: geo.lon,
          hqCity: geo.city,
          hqState: geo.state,
          hqCountry: geo.country,
          hqSource: geo.source,
        },
      });
      geoBudget -= 1;
      await new Promise((resolve) => setTimeout(resolve, geoDelayMs));
    } else {
      geoBudget -= 1;
    }
    geoCache.set(cacheKey, true);
  };
  SupplyChainGraphRepo.upsertCompany({
    canonicalName: ticker,
    tickers: [ticker],
  });
  await geocodeCompany(ticker, undefined);
  const docs = await ingestOfficialDocuments(ticker);
  SupplyChainGraphRepo.recordAudit(
    "official-doc-ingest",
    `${ticker}: ${docs.length} documents`,
  );

  let verifiedEdges = 0;
  for (const doc of docs) {
    try {
      const extracted = await extractEdgesFromDocument(model, {
        docId: doc.doc.docId,
        docDate: doc.doc.docDate,
        sourceKind: doc.doc.sourceKind,
        sourceRef: doc.doc.rawContentLocation,
        text: doc.text,
      });

      if (extracted.length === 0) continue;

      const verification = await verifyEdgesForDocument(
        model,
        {
          docId: doc.doc.docId,
          docDate: doc.doc.docDate,
          sourceKind: doc.doc.sourceKind,
          sourceRef: doc.doc.rawContentLocation,
          text: doc.text,
        },
        extracted,
      );

      for (const edge of extracted) {
        const verdict = verification.find((v) => v.edgeId === edge.edgeId);
        if (verdict && verdict.verdict !== "ACCEPT") continue;
        if (!heuristicVerify(doc.text, edge)) continue;

        const fromCompanyInput = { canonicalName: edge.fromCompany } as {
          canonicalName: string;
          tickers?: string[];
        };
        if (edge.fromTicker) fromCompanyInput.tickers = [edge.fromTicker];
        const toCompanyInput = { canonicalName: edge.toCompany } as {
          canonicalName: string;
          tickers?: string[];
        };
        if (edge.toTicker) toCompanyInput.tickers = [edge.toTicker];
        const fromId = SupplyChainGraphRepo.upsertCompany(fromCompanyInput);
        const toId = SupplyChainGraphRepo.upsertCompany(toCompanyInput);

        await geocodeCompany(edge.fromCompany, fromId);
        await geocodeCompany(edge.toCompany, toId);

        const edgeInput = {
          fromCompanyId: fromId,
          toCompanyId: toId,
          relationType: edge.relationType,
          confidence: edge.confidence,
          status: "verified_official" as const,
          explanation: "Official source evidence",
          source: doc.doc.rawContentLocation,
        } as {
          fromCompanyId: string;
          toCompanyId: string;
          relationType: string;
          weight?: number;
          weightRange?: { min: number; max: number };
          confidence: number;
          status: "verified_official";
          explanation?: string;
          source?: string;
        };
        if (edge.weight !== undefined) edgeInput.weight = edge.weight;
        if (edge.weightRange) edgeInput.weightRange = edge.weightRange;
        const edgeId = SupplyChainGraphRepo.upsertEdge(edgeInput);

        edge.evidence.forEach((ev) => {
          SupplyChainGraphRepo.insertEvidence(edgeId, {
            sourceKind: ev.sourceKind,
            sourceUriOrRef: ev.sourceRef,
            docDate: ev.docDate,
            locationPointer: ev.locationPointer,
            snippet: ev.snippet,
            retrievalHash: ev.retrievalHash,
            docId: ev.docId,
          });
        });
        verifiedEdges += 1;
      }
    } catch (err) {
      SupplyChainGraphRepo.recordAudit(
        "official-extraction-error",
        `${ticker}: ${String(err)}`,
      );
    }
  }

  if (verifiedEdges > 0) {
    SupplyChainGraphRepo.recordAudit(
      "official-edges-verified",
      `${ticker}: ${verifiedEdges} edges`,
    );
  }

  if (!strictMode || includeHypothesis) {
    try {
      const hypothesis = await generateSupplyChainWithOllama(model, ticker);

      // Ensure center company exists
      const centerCompanyId = SupplyChainGraphRepo.upsertCompany({
        canonicalName: hypothesis.centerName || ticker,
        tickers: [ticker],
      });

      // Convert categories/companies format into edges
      const resolveDirection = (relationType: string): "into" | "out" => {
        const normalized = relationType.trim().toLowerCase();
        if (normalized.includes("supplier") || normalized.includes("manufact"))
          return "into";
        if (normalized.includes("service") || normalized.includes("support"))
          return "out";
        if (normalized.includes("tech") || normalized.includes("license"))
          return "out";
        if (
          normalized.includes("distribution") ||
          normalized.includes("channel")
        )
          return "out";
        return "out";
      };
      let hypothesisEdgesCreated = 0;
      if (hypothesis.categories && Array.isArray(hypothesis.categories)) {
        for (const category of hypothesis.categories) {
          const relationType = category.id || category.name || "related"; // supplier, manufacturer, services, etc.
          const direction = resolveDirection(relationType);

          if (category.companies && Array.isArray(category.companies)) {
            for (const company of category.companies) {
              try {
                const companyInput = {
                  canonicalName: company.name,
                } as {
                  canonicalName: string;
                  tickers?: string[];
                  metadata?: Record<string, unknown>;
                };
                if (company.id) companyInput.tickers = [company.id];
                if (
                  company.criticality ||
                  company.since ||
                  company.revenueImpact
                ) {
                  companyInput.metadata = {};
                  if (company.criticality !== undefined)
                    companyInput.metadata.criticality = company.criticality;
                  if (company.since !== undefined)
                    companyInput.metadata.since = company.since;
                  if (company.revenueImpact !== undefined)
                    companyInput.metadata.revenueImpact = company.revenueImpact;
                }
                const companyId =
                  SupplyChainGraphRepo.upsertCompany(companyInput);

                const hints = company.metadata as
                  | { hqCity?: string; hqState?: string; hqCountry?: string }
                  | undefined;
                await geocodeCompany(company.name, companyId, {
                  city: hints?.hqCity,
                  state: hints?.hqState,
                  country: hints?.hqCountry,
                });

                const fromCompanyId =
                  direction === "into" ? companyId : centerCompanyId;
                const toCompanyId =
                  direction === "into" ? centerCompanyId : companyId;
                const hypothesisEdgeInput = {
                  fromCompanyId,
                  toCompanyId,
                  relationType,
                  confidence: company.confidence ?? 0.5,
                  status: "hypothesis" as const,
                  explanation: company.role || "AI hypothesis relationship",
                  source: "AI hypothesis",
                } as {
                  fromCompanyId: string;
                  toCompanyId: string;
                  relationType: string;
                  weight?: number;
                  confidence: number;
                  status: "hypothesis";
                  explanation?: string;
                  source?: string;
                };

                SupplyChainGraphRepo.upsertEdge(hypothesisEdgeInput);
                hypothesisEdgesCreated += 1;
              } catch (companyErr) {
                console.warn(
                  `[officialSupplyChain] Failed to process company ${company.name}:`,
                  companyErr,
                );
              }
            }
          }
        }
      }

      if (hypothesisEdgesCreated > 0) {
        SupplyChainGraphRepo.recordAudit(
          "hypothesis-edges-created",
          `${ticker}: ${hypothesisEdgesCreated} edges`,
        );
      }
    } catch (err) {
      console.error(
        `[officialSupplyChain] Hypothesis generation error for ${ticker}:`,
        err,
      );
      SupplyChainGraphRepo.recordAudit(
        "hypothesis-generation-error",
        `${ticker}: ${String(err)}`,
      );
    }
  }
}

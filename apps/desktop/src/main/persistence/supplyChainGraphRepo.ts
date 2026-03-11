import crypto from "node:crypto";
import path from "node:path";
import type {
  MindMapData,
  OfficialSourceKind,
  SupplyChainEvidence,
  SupplyChainEvidenceStatus,
  SupplyChainGraph,
  SupplyChainGraphEdge,
  SupplyChainGraphNode,
  SupplyChainDocument,
} from "@tc/shared/supplyChain";
import { getDb } from "./db";

function nowIso() {
  return new Date().toISOString();
}

function hashText(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function makeCacheKey(input: Record<string, unknown>) {
  return hashText(JSON.stringify(input));
}

function normalizeTicker(ticker: string) {
  return ticker.trim().toUpperCase();
}

function formatTickers(tickers?: string[]) {
  if (!tickers || tickers.length === 0) return null;
  const uniq = Array.from(new Set(tickers.map((t) => normalizeTicker(t))));
  return `|${uniq.join("|")}|`;
}

function findCompanyIdByTicker(ticker: string): string | null {
  const db = getDb();
  const needle = `|${normalizeTicker(ticker)}|`;
  const row = db
    .prepare(
      `SELECT id FROM supply_chain_company WHERE tickers LIKE ? LIMIT 1`
    )
    .get(`%${needle}%`) as { id: string } | undefined;
  return row?.id ?? null;
}

function ensureCompanyId(label: string, ticker?: string) {
  if (ticker) {
    const existing = findCompanyIdByTicker(ticker);
    if (existing) return existing;
  }
  return `cmp_${hashText(label.toLowerCase()).slice(0, 12)}`;
}

export interface UpsertCompanyInput {
  id?: string;
  canonicalName: string;
  tickers?: string[];
  identifiers?: Record<string, string | undefined>;
  metadata?: Record<string, unknown>;
}

export interface UpsertEdgeInput {
  fromCompanyId: string;
  toCompanyId: string;
  relationType: SupplyChainGraphEdge["kind"] | string;
  weight?: number;
  weightRange?: { min: number; max: number };
  confidence: number;
  status: SupplyChainEvidenceStatus;
  explanation?: string;
  source?: string;
}

export const SupplyChainGraphRepo = {
  upsertCompany(input: UpsertCompanyInput) {
    const db = getDb();
    const id = input.id ?? ensureCompanyId(input.canonicalName, input.tickers?.[0]);
    const tickers = formatTickers(input.tickers);
    const identifiers = input.identifiers ? JSON.stringify(input.identifiers) : null;
    const metadata = input.metadata ? JSON.stringify(input.metadata) : null;
    const lastUpdated = nowIso();

    db.prepare(
      `INSERT INTO supply_chain_company (id, canonical_name, tickers, identifiers, metadata, last_updated)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         canonical_name = excluded.canonical_name,
         tickers = COALESCE(excluded.tickers, supply_chain_company.tickers),
         identifiers = COALESCE(excluded.identifiers, supply_chain_company.identifiers),
         metadata = COALESCE(excluded.metadata, supply_chain_company.metadata),
         last_updated = excluded.last_updated`
    ).run(id, input.canonicalName, tickers, identifiers, metadata, lastUpdated);

    return id;
  },

  upsertEdge(input: UpsertEdgeInput) {
    const db = getDb();
    const edgeId = `edge_${hashText(`${input.fromCompanyId}|${input.toCompanyId}|${input.relationType}`)}`;
    const now = nowIso();
    const weightMin = input.weightRange?.min ?? null;
    const weightMax = input.weightRange?.max ?? null;

    db.prepare(
      `INSERT INTO supply_chain_edge
        (id, from_company_id, to_company_id, relation_type, weight, weight_min, weight_max, confidence, status, created_at, updated_at, valid_from, valid_to, explanation, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         weight = COALESCE(excluded.weight, supply_chain_edge.weight),
         weight_min = COALESCE(excluded.weight_min, supply_chain_edge.weight_min),
         weight_max = COALESCE(excluded.weight_max, supply_chain_edge.weight_max),
         confidence = MAX(excluded.confidence, supply_chain_edge.confidence),
         status = CASE
           WHEN supply_chain_edge.status = 'verified_official' THEN supply_chain_edge.status
           ELSE excluded.status
         END,
         updated_at = excluded.updated_at,
         explanation = COALESCE(excluded.explanation, supply_chain_edge.explanation),
         source = COALESCE(excluded.source, supply_chain_edge.source)`
    ).run(
      edgeId,
      input.fromCompanyId,
      input.toCompanyId,
      input.relationType,
      input.weight ?? null,
      weightMin,
      weightMax,
      input.confidence,
      input.status,
      now,
      now,
      input.explanation ?? null,
      input.source ?? null
    );

    return edgeId;
  },

  insertEvidence(edgeId: string, evidence: Omit<SupplyChainEvidence, "edgeId" | "evidenceId">) {
    const db = getDb();
    const evidenceId = `ev_${hashText(`${edgeId}|${evidence.sourceUriOrRef}|${evidence.locationPointer}|${evidence.retrievalHash}`)}`;
    db.prepare(
      `INSERT OR IGNORE INTO supply_chain_evidence
        (evidence_id, edge_id, source_kind, source_ref, doc_date, location_pointer, snippet, retrieval_hash, doc_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      evidenceId,
      edgeId,
      evidence.sourceKind,
      evidence.sourceUriOrRef,
      evidence.docDate,
      evidence.locationPointer,
      evidence.snippet,
      evidence.retrievalHash,
      evidence.docId ?? null
    );
    return evidenceId;
  },

  insertDocument(doc: SupplyChainDocument) {
    const db = getDb();
    const tickers = formatTickers(doc.tickers);
    db.prepare(
      `INSERT OR IGNORE INTO supply_chain_document
        (doc_id, source_kind, official_origin, fetched_at, doc_date, content_hash, raw_content_location, parsed_text_location, tickers)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      doc.docId,
      doc.sourceKind,
      doc.officialOrigin,
      doc.fetchedAt,
      doc.docDate,
      doc.contentHash,
      doc.rawContentLocation,
      doc.parsedTextLocation,
      tickers
    );
    return doc.docId;
  },

  getEgoGraphCached(ticker: string, options: { strictMode: boolean; includeHypothesis: boolean; hops: number; minEdgeWeight: number }) {
    const db = getDb();
    const cacheKey = makeCacheKey({ ticker: normalizeTicker(ticker), ...options });
    const row = db
      .prepare(
        `SELECT graph_json, expires_at FROM supply_chain_ego_cache
         WHERE cache_key = ? AND expires_at > datetime('now')`
      )
      .get(cacheKey) as { graph_json: string; expires_at: string } | undefined;

    if (!row) return null;
    try {
      const data = JSON.parse(row.graph_json) as MindMapData;
      const expiresAt = new Date(row.expires_at).getTime();
      const needsRefresh = Date.now() > expiresAt - 6 * 60 * 60 * 1000; // 6h before expiry
      return { data, needsRefresh };
    } catch {
      return null;
    }
  },

  setEgoGraphCached(ticker: string, options: { strictMode: boolean; includeHypothesis: boolean; hops: number; minEdgeWeight: number }, data: MindMapData, ttlHours = 72) {
    const db = getDb();
    const cacheKey = makeCacheKey({ ticker: normalizeTicker(ticker), ...options });
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + ttlHours);

    db.prepare(
      `INSERT OR REPLACE INTO supply_chain_ego_cache
        (cache_key, company_ticker, strict_mode, include_hypothesis, hops, min_edge_weight, generated_at, expires_at, graph_json)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?, ?)`
    ).run(
      cacheKey,
      normalizeTicker(ticker),
      options.strictMode ? 1 : 0,
      options.includeHypothesis ? 1 : 0,
      options.hops,
      options.minEdgeWeight,
      expiresAt.toISOString(),
      JSON.stringify(data)
    );
  },

  clearEgoGraphCache(ticker: string) {
    const db = getDb();
    db.prepare(`DELETE FROM supply_chain_ego_cache WHERE company_ticker = ?`).run(normalizeTicker(ticker));
  },

  listCachedTickers() {
    const db = getDb();
    const rows = db
      .prepare(`SELECT DISTINCT company_ticker FROM supply_chain_ego_cache ORDER BY generated_at DESC`)
      .all() as { company_ticker: string }[];
    return rows.map((row) => row.company_ticker);
  },

  getEgoGraph(ticker: string, options: { strictMode: boolean; includeHypothesis: boolean; hops: number; minEdgeWeight: number }) {
    const centerTicker = normalizeTicker(ticker);
    const centerCompanyId = findCompanyIdByTicker(centerTicker);
    if (!centerCompanyId) {
      return { graph: { nodes: [], edges: [] }, centerCompanyId: null };
    }

    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, from_company_id, to_company_id, relation_type, weight, weight_min, weight_max, confidence, status, explanation, source
         FROM supply_chain_edge`
      )
      .all() as Array<{
      id: string;
      from_company_id: string;
      to_company_id: string;
      relation_type: string;
      weight: number | null;
      weight_min: number | null;
      weight_max: number | null;
      confidence: number;
      status: string;
      explanation: string | null;
      source: string | null;
    }>;

    const edges = rows
      .filter((row) => {
        if (options.strictMode && !options.includeHypothesis && row.status !== "verified_official") return false;
        if (!options.includeHypothesis && row.status === "hypothesis") return false;
        const effectiveWeight = typeof row.weight === "number" ? row.weight : row.weight_max ?? row.weight_min ?? null;
        if (typeof effectiveWeight === "number" && effectiveWeight < options.minEdgeWeight) return false;
        return true;
      })
      .map<SupplyChainGraphEdge>((row) => {
        const edge: SupplyChainGraphEdge = {
          id: row.id,
          from: row.from_company_id,
          to: row.to_company_id,
          kind: row.relation_type as SupplyChainGraphEdge["kind"],
          confidence: row.confidence,
          status: row.status === "verified_official" ? "normal" : "degraded",
          evidenceStatus: row.status as SupplyChainEvidenceStatus,
        };
        if (row.weight !== null) edge.weight = row.weight;
        if (row.weight_min !== null && row.weight_max !== null) {
          edge.weightRange = { min: row.weight_min, max: row.weight_max };
        }
        if (row.explanation) edge.explanation = row.explanation;
        if (row.source) edge.source = row.source;
        return edge;
      });

    const adjacency = new Map<string, string[]>();
    edges.forEach((edge) => {
      if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
      if (!adjacency.has(edge.to)) adjacency.set(edge.to, []);
      adjacency.get(edge.from)!.push(edge.to);
      adjacency.get(edge.to)!.push(edge.from);
    });

    const visited = new Set<string>([centerCompanyId]);
    const depthMap = new Map<string, number>([[centerCompanyId, 0]]);
    const queue: Array<{ id: string; depth: number }> = [{ id: centerCompanyId, depth: 0 }];

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (depth >= options.hops) continue;
      const neighbors = adjacency.get(id) ?? [];
      neighbors.forEach((neighbor) => {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          depthMap.set(neighbor, depth + 1);
          queue.push({ id: neighbor, depth: depth + 1 });
        }
      });
    }

    const nodeRows = db
      .prepare(
        `SELECT id, canonical_name, tickers, identifiers, metadata, last_updated
         FROM supply_chain_company`
      )
      .all() as Array<{
        id: string;
        canonical_name: string;
        tickers: string | null;
        identifiers: string | null;
        metadata: string | null;
        last_updated: string;
      }>;

    const nodes = nodeRows
      .filter((row) => visited.has(row.id))
      .map<SupplyChainGraphNode>((row) => {
        const node: SupplyChainGraphNode = {
          id: row.id,
          label: row.canonical_name,
          entityType: "company",
          tier: row.id === centerCompanyId ? "direct" : depthMap.get(row.id) === 1 ? "direct" : "indirect",
          confidence: 1,
          status: "normal",
          canonicalName: row.canonical_name,
          lastUpdated: row.last_updated,
        };
        if (row.id === centerCompanyId) node.role = "Focal company";
        if (row.tickers) node.tickers = row.tickers.split("|").filter(Boolean);
        if (row.identifiers) node.identifiers = JSON.parse(row.identifiers);
        if (row.metadata) node.metadata = JSON.parse(row.metadata);
        return node;
      });

    const filteredEdges = edges.filter((edge) => visited.has(edge.from) && visited.has(edge.to));

    return {
      graph: { nodes, edges: filteredEdges },
      centerCompanyId,
    };
  },

  getMergedEgoGraph(
    tickers: string[],
    options: { strictMode: boolean; includeHypothesis: boolean; hops: number; minEdgeWeight: number }
  ) {
    const uniqueTickers = Array.from(new Set(tickers.map((t) => normalizeTicker(t)))).filter(Boolean);
    if (uniqueTickers.length === 0) {
      return { graph: { nodes: [], edges: [] }, centerCompanyId: null, focalCompanyIds: [] as string[] };
    }

    const graphs = uniqueTickers.map((ticker) => this.getEgoGraph(ticker, options));
    const nodesMap = new Map<string, SupplyChainGraphNode>();
    const edgesMap = new Map<string, SupplyChainGraphEdge>();
    const focalCompanyIds = graphs.map((g) => g.centerCompanyId).filter((id): id is string => Boolean(id));

    const tierRank: Record<string, number> = { direct: 3, indirect: 2, systemic: 1 };

    graphs.forEach((result) => {
      result.graph.nodes.forEach((node) => {
        const existing = nodesMap.get(node.id);
        if (!existing) {
          nodesMap.set(node.id, node);
          return;
        }
        const existingRank = tierRank[existing.tier] ?? 0;
        const nextRank = tierRank[node.tier] ?? 0;
        if (nextRank > existingRank) existing.tier = node.tier;
        if (!existing.role && node.role) existing.role = node.role;
        if (!existing.criticality && node.criticality) existing.criticality = node.criticality;
        if (!existing.healthScore && node.healthScore) existing.healthScore = node.healthScore;
        if (!existing.verified && node.verified) existing.verified = node.verified;
        if (!existing.explanation && node.explanation) existing.explanation = node.explanation;
        if (!existing.tickers && node.tickers) existing.tickers = node.tickers;
        if (!existing.identifiers && node.identifiers) existing.identifiers = node.identifiers;
        if (!existing.metadata && node.metadata) existing.metadata = node.metadata;
      });

      result.graph.edges.forEach((edge) => {
        if (!edgesMap.has(edge.id)) edgesMap.set(edge.id, edge);
      });
    });

    const centerCompanyId = graphs[0].centerCompanyId ?? focalCompanyIds[0] ?? null;

    return {
      graph: { nodes: Array.from(nodesMap.values()), edges: Array.from(edgesMap.values()) },
      centerCompanyId,
      focalCompanyIds,
    };
  },

  attachEvidence(graph: SupplyChainGraph) {
    if (!graph.edges.length) return graph;
    const db = getDb();
    const edgeIds = graph.edges.map((edge) => edge.id);
    const placeholders = edgeIds.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT evidence_id, edge_id, source_kind, source_ref, doc_date, location_pointer, snippet, retrieval_hash, doc_id
         FROM supply_chain_evidence
         WHERE edge_id IN (${placeholders})`
      )
      .all(...edgeIds) as Array<{
        evidence_id: string;
        edge_id: string;
        source_kind: OfficialSourceKind;
        source_ref: string;
        doc_date: string;
        location_pointer: string;
        snippet: string;
        retrieval_hash: string;
        doc_id: string | null;
      }>;

    const evidenceByEdge = new Map<string, SupplyChainEvidence[]>();
    rows.forEach((row) => {
      const list = evidenceByEdge.get(row.edge_id) ?? [];
      const evidence: SupplyChainEvidence = {
        evidenceId: row.evidence_id,
        edgeId: row.edge_id,
        sourceKind: row.source_kind,
        sourceUriOrRef: row.source_ref,
        docDate: row.doc_date,
        locationPointer: row.location_pointer,
        snippet: row.snippet,
        retrievalHash: row.retrieval_hash,
      };
      if (row.doc_id) evidence.docId = row.doc_id;
      list.push(evidence);
      evidenceByEdge.set(row.edge_id, list);
    });

    const edges = graph.edges.map((edge) => ({
      ...edge,
      evidence: evidenceByEdge.get(edge.id) ?? [],
    }));

    return { ...graph, edges };
  },

  getDataFreshness(ticker: string) {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT MAX(doc_date) as last_doc_date, COUNT(*) as documents
         FROM supply_chain_document
         WHERE tickers LIKE ?`
      )
      .get(`%|${normalizeTicker(ticker)}|%`) as { last_doc_date: string | null; documents: number } | undefined;

    const edgeStats = db
      .prepare(
        `SELECT
          SUM(CASE WHEN status = 'verified_official' THEN 1 ELSE 0 END) as verified,
          SUM(CASE WHEN status = 'hypothesis' THEN 1 ELSE 0 END) as hypothesis
         FROM supply_chain_edge`
      )
      .get() as { verified: number | null; hypothesis: number | null } | undefined;

    return {
      lastIngestedDocDate: row?.last_doc_date ?? undefined,
      documentsUsed: row?.documents ?? 0,
      verifiedEdges: edgeStats?.verified ?? 0,
      hypothesisEdges: edgeStats?.hypothesis ?? 0,
    };
  },

  recordAudit(action: string, detail: string) {
    const db = getDb();
    db.prepare(`INSERT INTO supply_chain_audit (ts, action, detail) VALUES (?, ?, ?)`)
      .run(Date.now(), action, detail);
  },
};

export function resolveCompanyFromLabel(label: string, ticker?: string) {
  const id = ensureCompanyId(label, ticker);
  return id;
}

export function docPathForTicker(ticker: string) {
  return path.join(__dirname, "services", "supplyChain", "data", "officialDocs", normalizeTicker(ticker));
}

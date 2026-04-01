/**
 * GWMD Map Repository
 * Database access layer for GWMD company relationships
 */

import { getDb } from "./db";
import type { SupplyChainGraph } from "@tc/shared/supplyChain";

const GWMD_ALLOWED_RELATION_TYPES = [
  "supplier",
  "customer",
  "partner",
  "competitor",
  "financing",
  "license",
] as const;
type GwmdRelationType = (typeof GWMD_ALLOWED_RELATION_TYPES)[number];

const isGwmdRelationType = (value: string): value is GwmdRelationType =>
  GWMD_ALLOWED_RELATION_TYPES.includes(value.toLowerCase() as GwmdRelationType);

const toGraphDependencyKind = (
  value: string,
): SupplyChainGraph["edges"][number]["kind"] | null => {
  const relationType = value.toLowerCase();
  if (!isGwmdRelationType(relationType)) return null;
  return relationType;
};

const normalizeTicker = (value: string) => value.trim().toUpperCase();

export interface GwmdCompanyRecord {
  ticker: string;
  name: string;
  hq_lat?: number;
  hq_lon?: number;
  hq_city?: string;
  hq_country?: string;
  industry?: string;
  health_score?: number;
  added_at: string;
  updated_at: string;
}

export interface GwmdRelationshipRecord {
  id: string;
  from_ticker: string;
  to_ticker: string;
  relation_type: string;
  weight?: number;
  confidence?: number;
  evidence?: string;
  added_at: string;
  updated_at: string;
}

export class GwmdMapRepository {
  /**
   * Add or update companies
   */
  addCompanies(
    companies: Array<{
      ticker: string;
      name: string;
      hq_lat?: number;
      hq_lon?: number;
      hq_city?: string;
      hq_country?: string;
      industry?: string;
      health_score?: number;
    }>,
  ) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO gwmd_company (ticker, name, hq_lat, hq_lon, hq_city, hq_country, industry, health_score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(ticker) DO UPDATE SET
        name = excluded.name,
        hq_lat = COALESCE(excluded.hq_lat, hq_lat),
        hq_lon = COALESCE(excluded.hq_lon, hq_lon),
        hq_city = COALESCE(excluded.hq_city, hq_city),
        hq_country = COALESCE(excluded.hq_country, hq_country),
        industry = COALESCE(excluded.industry, industry),
        health_score = COALESCE(excluded.health_score, health_score),
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    `);

    const insert = db.transaction(
      (cmp: {
        ticker: string;
        name: string;
        hq_lat?: number;
        hq_lon?: number;
        hq_city?: string;
        hq_country?: string;
        industry?: string;
        health_score?: number;
      }) => {
        const ticker = normalizeTicker(cmp.ticker);
        const lat = cmp.hq_lat ?? null;
        const lon = cmp.hq_lon ?? null;
        stmt.run(
          ticker,
          cmp.name,
          lat,
          lon,
          cmp.hq_city ?? null,
          cmp.hq_country ?? null,
          cmp.industry ?? null,
          cmp.health_score ?? null,
        );
      },
    );

    companies.forEach(insert);
  }

  /**
   * Add or update relationships
   */
  addRelationships(
    relationships: Array<{
      id: string;
      from_ticker: string;
      to_ticker: string;
      relation_type: string;
      weight?: number;
      confidence?: number;
      evidence?: string;
    }>,
  ) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO gwmd_relationship (id, from_ticker, to_ticker, relation_type, weight, confidence, evidence)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(from_ticker, to_ticker, relation_type) DO UPDATE SET
        weight = excluded.weight,
        confidence = excluded.confidence,
        evidence = excluded.evidence,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    `);

    const insert = db.transaction(
      (rel: {
        id: string;
        from_ticker: string;
        to_ticker: string;
        relation_type: string;
        weight?: number;
        confidence?: number;
        evidence?: string;
      }) => {
        if (!isGwmdRelationType(rel.relation_type)) {
          return;
        }
        const fromTicker = normalizeTicker(rel.from_ticker);
        const toTicker = normalizeTicker(rel.to_ticker);
        const relationType = rel.relation_type.toLowerCase();
        const semanticId = `${fromTicker}-${toTicker}-${relationType}`;
        stmt.run(
          semanticId,
          fromTicker,
          toTicker,
          relationType,
          rel.weight ?? null,
          rel.confidence ?? null,
          rel.evidence ?? null,
        );
      },
    );

    relationships.forEach(insert);
  }

  /**
   * Get all loaded companies
   */
  getAllCompanies(): GwmdCompanyRecord[] {
    const db = getDb();
    return db
      .prepare("SELECT * FROM gwmd_company ORDER BY added_at DESC")
      .all() as GwmdCompanyRecord[];
  }

  /**
   * Get all relationships
   */
  getAllRelationships(): GwmdRelationshipRecord[] {
    const db = getDb();
    return db
      .prepare("SELECT * FROM gwmd_relationship")
      .all() as GwmdRelationshipRecord[];
  }

  /**
   * Get ticker-scoped snapshot (connected component including focal ticker)
   */
  getScopedSnapshot(ticker: string): {
    companies: GwmdCompanyRecord[];
    edges: GwmdRelationshipRecord[];
  } {
    const focal = ticker.toUpperCase();
    const companies = this.getAllCompanies();
    const edges = this.getAllRelationships();
    const companyByTicker = new Map(
      companies.map((company) => [company.ticker.toUpperCase(), company]),
    );

    if (!companyByTicker.has(focal)) {
      return { companies: [], edges: [] };
    }

    const included = new Set<string>([focal]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of edges) {
        const fromKey = edge.from_ticker.toUpperCase();
        const toKey = edge.to_ticker.toUpperCase();
        const touches = included.has(fromKey) || included.has(toKey);
        if (!touches) continue;
        if (!included.has(fromKey)) {
          included.add(fromKey);
          changed = true;
        }
        if (!included.has(toKey)) {
          included.add(toKey);
          changed = true;
        }
      }
    }

    const scopedCompanies = Array.from(included)
      .map((key) => companyByTicker.get(key))
      .filter((company): company is GwmdCompanyRecord => !!company);

    const scopedEdges = edges.filter(
      (edge) =>
        included.has(edge.from_ticker.toUpperCase()) &&
        included.has(edge.to_ticker.toUpperCase()),
    );

    return {
      companies: scopedCompanies,
      edges: scopedEdges,
    };
  }

  /**
   * Get companies missing coordinates
   */
  getCompaniesMissingCoords(
    limit: number = 200,
  ): Array<
    Pick<
      GwmdCompanyRecord,
      "ticker" | "name" | "hq_lat" | "hq_lon" | "hq_city" | "hq_country"
    >
  > {
    const db = getDb();
    return db
      .prepare(
        "SELECT ticker, name, hq_lat, hq_lon, hq_city, hq_country FROM gwmd_company WHERE hq_lat IS NULL OR hq_lon IS NULL LIMIT ?",
      )
      .all(limit) as Array<
      Pick<
        GwmdCompanyRecord,
        "ticker" | "name" | "hq_lat" | "hq_lon" | "hq_city" | "hq_country"
      >
    >;
  }

  /**
   * Get relationships for a specific company
   */
  getCompanyRelationships(ticker: string): GwmdRelationshipRecord[] {
    const db = getDb();
    return db
      .prepare(
        "SELECT * FROM gwmd_relationship WHERE from_ticker = ? OR to_ticker = ?",
      )
      .all(ticker, ticker) as GwmdRelationshipRecord[];
  }

  /**
   * Check if company exists
   */
  companyExists(ticker: string): boolean {
    const db = getDb();
    const result = db
      .prepare("SELECT 1 FROM gwmd_company WHERE ticker = ?")
      .get(normalizeTicker(ticker));
    return !!result;
  }

  /**
   * Get company by ticker
   */
  getCompany(ticker: string): GwmdCompanyRecord | null {
    const db = getDb();
    return (
      (db
        .prepare("SELECT * FROM gwmd_company WHERE ticker = ?")
        .get(normalizeTicker(ticker)) as GwmdCompanyRecord) || null
    );
  }

  /**
   * Build graph from all stored data
   */
  buildGraph(): {
    nodes: SupplyChainGraph["nodes"];
    edges: SupplyChainGraph["edges"];
  } {
    const rawCompanies = this.getAllCompanies();
    const rawRelationships = this.getAllRelationships();
    return this.buildGraphFromRecords(rawCompanies, rawRelationships);
  }

  /**
   * Build graph only for companies connected to focal ticker
   */
  buildScopedGraph(ticker: string): {
    nodes: SupplyChainGraph["nodes"];
    edges: SupplyChainGraph["edges"];
  } {
    const scoped = this.getScopedSnapshot(ticker);
    return this.buildGraphFromRecords(scoped.companies, scoped.edges);
  }

  private buildGraphFromRecords(
    rawCompanies: GwmdCompanyRecord[],
    rawRelationships: GwmdRelationshipRecord[],
  ): {
    nodes: SupplyChainGraph["nodes"];
    edges: SupplyChainGraph["edges"];
  } {
    const companyMap = new Map<string, GwmdCompanyRecord>();
    rawCompanies.forEach((company) => {
      const ticker = normalizeTicker(company.ticker);
      const existing = companyMap.get(ticker);
      const next = {
        ...company,
        ticker,
      };
      if (!existing) {
        companyMap.set(ticker, next);
        return;
      }
      const mergedHqLat = existing.hq_lat ?? next.hq_lat;
      const mergedHqLon = existing.hq_lon ?? next.hq_lon;
      const mergedHqCity = existing.hq_city ?? next.hq_city;
      const mergedHqCountry = existing.hq_country ?? next.hq_country;
      const mergedIndustry = existing.industry ?? next.industry;
      const mergedHealthScore = existing.health_score ?? next.health_score;
      companyMap.set(ticker, {
        ticker,
        name: existing.name || next.name,
        ...(mergedHqLat !== undefined ? { hq_lat: mergedHqLat } : {}),
        ...(mergedHqLon !== undefined ? { hq_lon: mergedHqLon } : {}),
        ...(mergedHqCity !== undefined ? { hq_city: mergedHqCity } : {}),
        ...(mergedHqCountry !== undefined
          ? { hq_country: mergedHqCountry }
          : {}),
        ...(mergedIndustry !== undefined ? { industry: mergedIndustry } : {}),
        ...(mergedHealthScore !== undefined
          ? { health_score: mergedHealthScore }
          : {}),
        added_at: existing.added_at,
        updated_at: next.updated_at || existing.updated_at,
      });
    });

    const edgeMap = new Map<string, GwmdRelationshipRecord>();
    rawRelationships.forEach((edge) => {
      const fromTicker = normalizeTicker(edge.from_ticker);
      const toTicker = normalizeTicker(edge.to_ticker);
      const relationType = edge.relation_type.toLowerCase();
      if (!isGwmdRelationType(relationType)) return;
      if (fromTicker === toTicker) return;

      const key = `${fromTicker}|${toTicker}|${relationType}`;
      const existing = edgeMap.get(key);
      const next: GwmdRelationshipRecord = {
        ...edge,
        id: key.replace(/\|/g, "-"),
        from_ticker: fromTicker,
        to_ticker: toTicker,
        relation_type: relationType,
      };
      if (!existing) {
        edgeMap.set(key, next);
        return;
      }
      const mergedWeight = existing.weight ?? next.weight;
      const mergedConfidence = existing.confidence ?? next.confidence;
      const mergedEvidence = existing.evidence || next.evidence;
      edgeMap.set(key, {
        id: key.replace(/\|/g, "-"),
        from_ticker: fromTicker,
        to_ticker: toTicker,
        relation_type: relationType,
        ...(mergedWeight !== undefined ? { weight: mergedWeight } : {}),
        ...(mergedConfidence !== undefined
          ? { confidence: mergedConfidence }
          : {}),
        ...(mergedEvidence !== undefined ? { evidence: mergedEvidence } : {}),
        added_at: existing.added_at,
        updated_at: next.updated_at || existing.updated_at,
      });
    });

    const companies = Array.from(companyMap.values());
    const relationships = Array.from(edgeMap.values());
    const tierByTicker = this.computeTierByTicker(companies, relationships);
    const depthByTicker = this.computeDepthByTicker(companies, relationships);

    const nodes: SupplyChainGraph["nodes"] = companies.map((c) => ({
      id: c.ticker,
      label: c.name,
      tickers: [c.ticker],
      entityType: "company" as const,
      tier: tierByTicker.get(c.ticker.toUpperCase()) ?? "direct",
      confidence: 1.0,
      metadata: {
        hqLat: c.hq_lat,
        hqLon: c.hq_lon,
        hqCity: c.hq_city,
        hqCountry: c.hq_country,
        industry: c.industry,
        geoSource:
          c.hq_lat != null && c.hq_lon != null
            ? "stored_snapshot"
            : "unresolved",
        geoConfidence: c.hq_lat != null && c.hq_lon != null ? 0.55 : 0,
        gwmdDepth: depthByTicker.get(c.ticker.toUpperCase()) ?? 0,
      },
    }));

    const edges: SupplyChainGraph["edges"] = relationships.flatMap((r) => {
      const kind = toGraphDependencyKind(r.relation_type);
      if (!kind) return [];

      return [
        {
          id: r.id,
          from: r.from_ticker,
          to: r.to_ticker,
          kind,
          magnitude: r.weight ?? 0.5,
          confidence: r.confidence ?? 0.5,
          explanation: r.evidence || "",
        },
      ];
    });

    return { nodes, edges };
  }

  private computeTierByTicker(
    companies: GwmdCompanyRecord[],
    relationships: GwmdRelationshipRecord[],
  ): Map<string, "direct" | "indirect" | "systemic"> {
    const depthByTicker = this.computeDepthByTicker(companies, relationships);
    const tierByTicker = new Map<string, "direct" | "indirect" | "systemic">();

    depthByTicker.forEach((depth, ticker) => {
      if (depth <= 0) {
        tierByTicker.set(ticker, "direct");
        return;
      }
      if (depth === 1) {
        tierByTicker.set(ticker, "indirect");
        return;
      }
      tierByTicker.set(ticker, "systemic");
    });

    return tierByTicker;
  }

  private computeDepthByTicker(
    companies: GwmdCompanyRecord[],
    relationships: GwmdRelationshipRecord[],
  ): Map<string, number> {
    const depthByTicker = new Map<string, number>();
    const adjacency = new Map<string, Set<string>>();
    const degree = new Map<string, number>();

    for (const company of companies) {
      const key = company.ticker.toUpperCase();
      adjacency.set(key, new Set<string>());
      degree.set(key, 0);
    }

    for (const rel of relationships) {
      const fromKey = rel.from_ticker.toUpperCase();
      const toKey = rel.to_ticker.toUpperCase();
      if (!adjacency.has(fromKey)) adjacency.set(fromKey, new Set<string>());
      if (!adjacency.has(toKey)) adjacency.set(toKey, new Set<string>());
      adjacency.get(fromKey)?.add(toKey);
      adjacency.get(toKey)?.add(fromKey);
      degree.set(fromKey, (degree.get(fromKey) ?? 0) + 1);
      degree.set(toKey, (degree.get(toKey) ?? 0) + 1);
    }

    const unvisited = new Set(adjacency.keys());

    while (unvisited.size > 0) {
      const start = unvisited.values().next().value as string;
      const component: string[] = [];
      const queue: string[] = [start];
      unvisited.delete(start);

      while (queue.length > 0) {
        const current = queue.shift();
        if (!current) continue;
        component.push(current);
        for (const next of adjacency.get(current) ?? []) {
          if (!unvisited.has(next)) continue;
          unvisited.delete(next);
          queue.push(next);
        }
      }

      const anchor = component.slice().sort((left, right) => {
        const degreeDiff = (degree.get(right) ?? 0) - (degree.get(left) ?? 0);
        if (degreeDiff !== 0) return degreeDiff;
        return left.localeCompare(right);
      })[0];
      if (!anchor) continue;

      const depthQueue: Array<{ ticker: string; depth: number }> = [
        { ticker: anchor, depth: 0 },
      ];
      const seen = new Set<string>();

      while (depthQueue.length > 0) {
        const entry = depthQueue.shift();
        if (!entry) continue;
        if (seen.has(entry.ticker)) continue;
        seen.add(entry.ticker);
        depthByTicker.set(entry.ticker, entry.depth);

        for (const neighbor of adjacency.get(entry.ticker) ?? []) {
          if (seen.has(neighbor)) continue;
          depthQueue.push({ ticker: neighbor, depth: entry.depth + 1 });
        }
      }
    }

    return depthByTicker;
  }

  /**
   * Log search history
   */
  logSearch(
    ticker: string,
    companiesFound: number,
    relationshipsFound: number,
  ) {
    const db = getDb();
    db.prepare(
      "INSERT INTO gwmd_search_history (ticker, companies_found, relationships_found) VALUES (?, ?, ?)",
    ).run(ticker, companiesFound, relationshipsFound);
  }

  /**
   * Clear all data
   */
  clear() {
    const db = getDb();
    db.exec(
      "DELETE FROM gwmd_relationship; DELETE FROM gwmd_company; DELETE FROM gwmd_search_history;",
    );
  }

  /**
   * Get search history
   */
  getSearchHistory(limit: number = 50): Array<{
    ticker: string;
    searched_at: string;
    companies_found: number;
    relationships_found: number;
  }> {
    const db = getDb();
    return db
      .prepare(
        "SELECT ticker, searched_at, companies_found, relationships_found FROM gwmd_search_history ORDER BY searched_at DESC LIMIT ?",
      )
      .all(limit) as Array<{
      ticker: string;
      searched_at: string;
      companies_found: number;
      relationships_found: number;
    }>;
  }
}

export const gwmdMapRepo = new GwmdMapRepository();

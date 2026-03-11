/**
 * Company Relationship Service for GWMD Map
 * Generates supply chain relationships for companies using AI
 * Integrates with official sources and enriches with live data
 */

import { z } from "zod";
import { resolveCompanyGeo } from "../supplyChain/companyGeo";
import { gwmdMapRepo } from "../../persistence/gwmdMapRepo";
import type { CloudModelConfig } from "../aiResearch/llm/cloudModels";
import { callCloudModel } from "../aiResearch/llm/cloudModels";

interface GwmdCompany {
  ticker: string;
  name: string;
  hq_lat?: number;
  hq_lon?: number;
  hq_city?: string;
  hq_country?: string;
  industry?: string;
  health_score?: number;
  geo_source?: "ai_model" | "curated" | "nominatim" | "unresolved";
  geo_confidence?: number;
}

interface GwmdRelationshipEdge {
  id: string;
  from_ticker: string;
  to_ticker: string;
  relation_type: string;
  weight?: number;
  confidence?: number;
  evidence?: string;
}

const CoercedNumber = z.preprocess((value) => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value;
  const num = Number(value);
  return Number.isFinite(num) ? num : value;
}, z.number().nullable());

const RelationshipSchema = z.object({
  ticker: z.string(),
  name: z.string(),
  headquarters_city: z.string().optional(),
  headquarters_country: z.string().optional(),
  latitude: CoercedNumber.optional(),
  longitude: CoercedNumber.optional(),
  relation_type: z.enum(["supplier", "customer", "partner", "competitor", "financing", "license"]),
  confidence: z.number().min(0).max(1).optional().default(0.5),
  evidence: z.string().optional(),
});

const MissingCoordinateSchema = z.object({
  ticker: z.string(),
  name: z.string().optional(),
  headquarters_city: z.string().optional(),
  headquarters_country: z.string().optional(),
  latitude: CoercedNumber.optional(),
  longitude: CoercedNumber.optional(),
});

type ParsedRelationship = z.infer<typeof RelationshipSchema>;
type NormalizedRelationship = Omit<ParsedRelationship, "latitude" | "longitude" | "headquarters_city" | "headquarters_country"> & {
  latitude: number | null;
  longitude: number | null;
  headquarters_city: string | null;
  headquarters_country: string | null;
};

type MissingCoordinate = Omit<z.infer<typeof MissingCoordinateSchema>, "latitude" | "longitude" | "headquarters_city" | "headquarters_country"> & {
  latitude: number | null;
  longitude: number | null;
  headquarters_city: string | null;
  headquarters_country: string | null;
};

type AiModelSelection =
  | string
  | {
      provider?: "ollama" | string;
      model?: string;
      temperature?: number;
      maxTokens?: number;
    }
  | null
  | undefined;

type ResolvedAiModel = {
  provider: "ollama";
  model: string;
  temperature?: number;
  maxTokens?: number;
};

export type GwmdRunStatus = "ok" | "degraded_cache";

export type GwmdRunMeta = {
  status: GwmdRunStatus;
  source: "fresh" | "cache_scoped";
  degraded: boolean;
  reason?: "upstream_failed";
  unlocatedCount: number;
  hypothesisRatio: number;
  primaryRelationshipCount: number;
  hop2SeedCount: number;
};

class GwmdParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GwmdParseError";
  }
}

export class CompanyRelationshipService {
  private readonly hop2Concurrency = 3;
  private readonly geocodeConcurrency = 3;

  private normalizeTicker(value: string): string {
    return value.trim().toUpperCase();
  }

  private edgeSemanticKey(fromTicker: string, toTicker: string, relationType: string): string {
    return `${this.normalizeTicker(fromTicker)}|${this.normalizeTicker(toTicker)}|${relationType.toLowerCase()}`;
  }

  /**
   * Generate supply chain relationships for a company
   */
  async generateRelationships(
    ticker: string,
    options: {
      model?: AiModelSelection;
      refresh?: boolean;
      strict?: boolean;
    } = {}
  ): Promise<{
    companies: GwmdCompany[];
    edges: GwmdRelationshipEdge[];
    meta: GwmdRunMeta;
  }> {
    const normalizedTicker = this.normalizeTicker(ticker);
    console.log(`[CompanyRelationshipService] Generating relationships for ${normalizedTicker}`);

    try {
      const cachedSnapshot = !options.refresh && gwmdMapRepo.companyExists(normalizedTicker)
        ? gwmdMapRepo.getScopedSnapshot(normalizedTicker)
        : null;
      if (cachedSnapshot) {
        console.log(`[CompanyRelationshipService] Found ${normalizedTicker} in cache, attempting to extend relationships`);
      }

      const { AiResearchRepo: Repo } = await import("../../persistence/aiResearchRepo");
      const { AppSettingsRepo } = await import("../../persistence/repos");
      const config = Repo.getConfig();
      const settings = AppSettingsRepo.get();
      const defaultModel = config?.model || "deepseek-r1:14b";
      const resolvedModel = this.resolveModelConfig(options.model, defaultModel);
      const secondaryModel = this.resolveSecondaryModelConfig(settings, defaultModel) ?? resolvedModel;
      console.log(`[CompanyRelationshipService] Using model: ${resolvedModel.provider}/${resolvedModel.model}`);
      if (secondaryModel !== resolvedModel) {
        console.log(`[CompanyRelationshipService] Using secondary model for coordinates: ${secondaryModel.provider}/${secondaryModel.model}`);
      }

      const relationshipsBySource = new Map<string, NormalizedRelationship[]>();
      let primaryRelationships: NormalizedRelationship[] = [];
      try {
        primaryRelationships = await this.getRelationshipsForTicker(normalizedTicker, resolvedModel, options.strict ?? false);
        relationshipsBySource.set(normalizedTicker, primaryRelationships);
      } catch (err) {
        if (cachedSnapshot && (cachedSnapshot.companies.length > 0 || cachedSnapshot.edges.length > 0)) {
          console.warn(`[CompanyRelationshipService] AI call failed, returning cached results for ${normalizedTicker}`);
          return {
            ...cachedSnapshot,
            meta: {
              status: "degraded_cache",
              source: "cache_scoped",
              degraded: true,
              reason: "upstream_failed",
              unlocatedCount: cachedSnapshot.companies.filter((company) => company.hq_lat == null || company.hq_lon == null).length,
              hypothesisRatio: this.computeHypothesisRatio(cachedSnapshot.edges),
              primaryRelationshipCount: 0,
              hop2SeedCount: 0,
            },
          };
        }
        throw err;
      }

      const hop2Seeds = this.pickHop2SeedTickers(primaryRelationships);
      await this.runWithConcurrency(hop2Seeds, this.hop2Concurrency, async (seed) => {
        try {
          const hop2 = await this.getRelationshipsForTicker(seed, resolvedModel, options.strict ?? false);
          relationshipsBySource.set(seed, hop2);
        } catch (err) {
          console.warn(`[CompanyRelationshipService] Hop-2 expansion failed for ${seed}:`, err);
        }
        await this.sleep(90);
      });

      const coordinateRequests = this.buildCoordinateRequests(ticker, relationshipsBySource);
      if (coordinateRequests.length > 0) {
        try {
          console.log(`[CompanyRelationshipService] Resolving coordinates for ${coordinateRequests.length} companies`);
          const coordResponse = await this.callAiForMissingCoordinates(normalizedTicker, coordinateRequests, secondaryModel);
          const coordUpdates = this.parseMissingCoordinates(coordResponse);
          if (coordUpdates.length > 0) {
            relationshipsBySource.forEach((rels, source) => {
              relationshipsBySource.set(source, this.mergeCoordinates(rels, coordUpdates));
            });
          }
        } catch (err) {
          console.warn(`[CompanyRelationshipService] Coordinate resolver failed:`, err);
        }
      }

      // Geocode companies
      const companyPayloads = this.buildCompanyPayloads(normalizedTicker, relationshipsBySource);
      const companies: GwmdCompany[] = await this._enrichCompanies(companyPayloads);
      const companyTickerSet = new Set(companies.map((company) => this.normalizeTicker(company.ticker)));

      // Build edges
      const edges: GwmdRelationshipEdge[] = [];
      const edgeKeys = new Set<string>();
      relationshipsBySource.forEach((rels, fromTicker) => {
        rels.forEach((rel) => {
          const fromTickerCanonical = this.normalizeTicker(fromTicker);
          const toTickerCanonical = this.normalizeTicker(rel.ticker);
          if (!companyTickerSet.has(fromTickerCanonical) || !companyTickerSet.has(toTickerCanonical)) return;
          if (fromTickerCanonical === toTickerCanonical) return;

          const key = this.edgeSemanticKey(fromTickerCanonical, toTickerCanonical, rel.relation_type);
          if (edgeKeys.has(key)) return;
          edgeKeys.add(key);

          edges.push({
            id: key.replace(/\|/g, "-"),
            from_ticker: fromTickerCanonical,
            to_ticker: toTickerCanonical,
            relation_type: rel.relation_type.toLowerCase(),
            weight: rel.confidence || 0.5,
            confidence: rel.confidence || 0.5,
            evidence: rel.evidence || "",
          });
        });
      });

      // Save to database
      gwmdMapRepo.addCompanies(companies);
      gwmdMapRepo.addRelationships(edges);
      gwmdMapRepo.logSearch(normalizedTicker, companies.length, edges.length);

      console.log(`[CompanyRelationshipService] ✓ Found ${companies.length} companies, ${edges.length} relationships`);

      return {
        companies,
        edges,
        meta: {
          status: "ok",
          source: "fresh",
          degraded: false,
          unlocatedCount: companies.filter((company) => company.hq_lat == null || company.hq_lon == null).length,
          hypothesisRatio: this.computeHypothesisRatio(edges),
          primaryRelationshipCount: primaryRelationships.length,
          hop2SeedCount: hop2Seeds.length,
        },
      };
    } catch (err) {
      console.error(`[CompanyRelationshipService] ✗ Error generating relationships:`, err);
      throw err;
    }
  }

  /**
   * Call AI to generate relationship hypotheses
   */
  private async callAiForRelationships(ticker: string, model: ResolvedAiModel): Promise<string> {
    const systemPrompt = `You are a supply chain analyst. Use verified public knowledge and identify company relationships. Do not guess locations.`;

    const userPrompt = `
You are a supply chain analyst and geolocation expert. For the company with ticker "${ticker}", generate a JSON list of likely suppliers, customers, partners, competitors, and financing sources.

Response format (JSON array):
\`\`\`json
[
  {
    "ticker": "COMPANY_TICKER",
    "name": "Full Company Name",
    "headquarters_city": "City Name",
    "headquarters_country": "Country Name",
    "relation_type": "supplier|customer|partner|competitor|financing|license",
    "confidence": 0.0-1.0,
    "evidence": "Brief reason why this relationship exists"
  }
]
\`\`\`

Requirements:
- Generate 15-25 relationships
- Ensure high confidence (0.7+) for well-known relationships
- Provide headquarters city and country when known; if unknown, omit rather than guess
- Do not include latitude/longitude in this response`;

    return this.callAiWithPrompt(model, systemPrompt, userPrompt);
  }

  private async callAiForMissingCoordinates(
    ticker: string,
    missing: Array<{ ticker: string; name: string; headquarters_city?: string | null; headquarters_country?: string | null }>,
    model: ResolvedAiModel
  ): Promise<string> {
    const systemPrompt = `You are a geolocation expert. Provide headquarters coordinates. If exact coordinates are unknown, return a reasonable city-center approximation.`;
    const items = missing
      .map((item) => {
        const extras = [item.headquarters_city, item.headquarters_country].filter(Boolean).join(", ");
        return `- ${item.ticker} | ${item.name}${extras ? ` | ${extras}` : ""}`;
      })
      .join("\n");

    const userPrompt = `
For the primary company "${ticker}", fill missing headquarters coordinates for these related companies:
${items}

Return a JSON array with:
\`\`\`json
[
  {
    "ticker": "COMPANY_TICKER",
    "name": "Full Company Name",
    "headquarters_city": "City Name",
    "headquarters_country": "Country Name",
    "latitude": 40.7128,
    "longitude": -74.0060
  }
]
\`\`\`

Requirements:
- Latitude must be between -90 and 90
- Longitude must be between -180 and 180
- If exact HQ coordinates are unknown, use an approximate city-center coordinate
- Do not omit coordinates`;

    return this.callAiWithPrompt(model, systemPrompt, userPrompt);
  }

  private async getRelationshipsForTicker(ticker: string, model: ResolvedAiModel, strict: boolean): Promise<NormalizedRelationship[]> {
    const relationships = await this.callAiForRelationships(ticker, model);
    const parsed = this.parseRelationships(relationships);
    const filtered = this.applyRelationshipQualityGate(parsed, strict);
    if (filtered.length === 0) {
      throw new GwmdParseError(`No valid relationships after quality checks for ${ticker}`);
    }
    return filtered;
  }

  private async callAiWithPrompt(model: ResolvedAiModel, systemPrompt: string, userPrompt: string): Promise<string> {
    try {
      const { callCloudLlm } = await import('../llm/cloudLlmClient');
      void model; // model param retained for API compatibility
      console.log(`[CompanyRelationshipService] Calling cloud LLM...`);
      const response = await callCloudLlm(systemPrompt, userPrompt, {
        temperature: model.temperature ?? 0.3,
      });
      if (typeof response !== "string") {
        throw new Error("Unexpected response format from AI");
      }
      console.log(`[CompanyRelationshipService] Received AI response (${response.length} chars)`);
      return response;
    } catch (err) {
      console.error(`[CompanyRelationshipService] AI call failed:`, err);
      throw new Error(`Failed to generate relationships: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Parse AI response into structured relationships
   */
  private parseRelationships(aiResponse: string): NormalizedRelationship[] {
    try {
      // Extract JSON from markdown code blocks if present
      let jsonStr = aiResponse;
      const match = aiResponse.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (match && match[1]) {
        jsonStr = match[1];
      }

      const parsed = JSON.parse(jsonStr);
      const relationships = Array.isArray(parsed) ? parsed : [parsed];

      // Validate each relationship
      const normalized = relationships
        .map((rel) => {
          try {
            const parsedRel = RelationshipSchema.parse(rel);
            return this.normalizeRelationship(parsedRel);
          } catch {
            console.warn(`[CompanyRelationshipService] Invalid relationship:`, rel);
            return null;
          }
        })
        .filter((r) => r !== null) as NormalizedRelationship[];

      if (normalized.length === 0) {
        throw new GwmdParseError("AI response did not contain any valid relationships");
      }

      return normalized;
    } catch (err) {
      console.error(`[CompanyRelationshipService] Failed to parse relationships:`, err);
      if (err instanceof GwmdParseError) throw err;
      throw new GwmdParseError(`Failed to parse relationships: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private parseMissingCoordinates(aiResponse: string): MissingCoordinate[] {
    try {
      let jsonStr = aiResponse;
      const match = aiResponse.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (match && match[1]) {
        jsonStr = match[1];
      }

      const parsed = JSON.parse(jsonStr);
      const items = Array.isArray(parsed) ? parsed : [parsed];

      const normalized = items
        .map((item) => {
          try {
            const parsedItem = MissingCoordinateSchema.parse(item);
            return this.normalizeMissingCoordinate(parsedItem);
          } catch {
            console.warn(`[CompanyRelationshipService] Invalid coordinate entry:`, item);
            return null;
          }
        })
        .filter((item) => item !== null) as MissingCoordinate[];

      if (normalized.length === 0) {
        throw new GwmdParseError("Coordinate resolver response did not contain any valid entries");
      }

      return normalized;
    } catch (err) {
      console.error(`[CompanyRelationshipService] Failed to parse missing coordinates:`, err);
      if (err instanceof GwmdParseError) throw err;
      throw new GwmdParseError(`Failed to parse missing coordinates: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private applyRelationshipQualityGate(
    relationships: NormalizedRelationship[],
    strict: boolean
  ): NormalizedRelationship[] {
    const minConfidence = strict ? 0.6 : 0.45;
    const minEvidenceLength = strict ? 20 : 10;

    return relationships.filter((rel) => {
      const confidence = rel.confidence ?? 0;
      const evidence = (rel.evidence ?? "").trim();
      if (confidence < minConfidence) return false;
      if (evidence.length < minEvidenceLength) return false;
      return true;
    });
  }

  /**
   * Enrich companies with geocoding and details
   */
  private async _enrichCompanies(
    companies: Array<{
      ticker: string;
      name: string;
      latitude?: number | null;
      longitude?: number | null;
      headquarters_city?: string | null;
      headquarters_country?: string | null;
    }>
  ): Promise<GwmdCompany[]> {
    return this.runWithConcurrency(companies, this.geocodeConcurrency, async (company) => {
      try {
        const hasAiCoords = typeof company.latitude === "number" && typeof company.longitude === "number";
        const geo = hasAiCoords ? null : await this.resolveGeoWithFallbacks(company);

        await this.sleep(80);

        return {
          ticker: company.ticker,
          name: company.name,
          hq_lat: hasAiCoords ? company.latitude ?? undefined : geo?.lat,
          hq_lon: hasAiCoords ? company.longitude ?? undefined : geo?.lon,
          hq_city: hasAiCoords ? company.headquarters_city : (geo?.city ?? company.headquarters_city),
          hq_country: hasAiCoords ? company.headquarters_country : (geo?.country ?? company.headquarters_country),
          geo_source: hasAiCoords ? "ai_model" : (geo?.source === "curated" ? "curated" : geo?.source === "nominatim" ? "nominatim" : "unresolved"),
          geo_confidence: hasAiCoords ? 0.7 : (geo?.source === "curated" ? 0.98 : geo?.source === "nominatim" ? 0.82 : 0),
        } as GwmdCompany;
      } catch (err) {
        console.warn(`[CompanyRelationshipService] Enrichment failed for ${company.ticker}:`, err);
        return {
          ticker: company.ticker,
          name: company.name,
          hq_lat: typeof company.latitude === "number" ? company.latitude : undefined,
          hq_lon: typeof company.longitude === "number" ? company.longitude : undefined,
          hq_city: company.headquarters_city,
          hq_country: company.headquarters_country,
          geo_source: typeof company.latitude === "number" && typeof company.longitude === "number" ? "ai_model" : "unresolved",
          geo_confidence: typeof company.latitude === "number" && typeof company.longitude === "number" ? 0.7 : 0,
        } as GwmdCompany;
      }
    });
  }

  private async resolveGeoWithFallbacks(company: {
    name: string;
    headquarters_city?: string | null;
    headquarters_country?: string | null;
  }) {
    const city = company.headquarters_city ?? undefined;
    const country = company.headquarters_country ?? undefined;
    const fullHints = {
      ...(city ? { city } : {}),
      ...(country ? { country } : {}),
    };

    let geo = await resolveCompanyGeo(company.name, fullHints);
    if (geo) return geo;

    const normalizedName = company.name
      .replace(/\([^)]*\)/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (normalizedName && normalizedName !== company.name) {
      geo = await resolveCompanyGeo(normalizedName, fullHints);
      if (geo) return geo;
    }

    if (country) {
      geo = await resolveCompanyGeo(company.name, { country });
      if (geo) return geo;
    }

    if (city) {
      const cityHints = country ? { country } : undefined;
      geo = await resolveCompanyGeo(city, cityHints);
      if (geo) return geo;
    }

    if (country) {
      geo = await resolveCompanyGeo(country);
      if (geo) return geo;
    }

    return null;
  }

  private buildCompanyPayloads(
    primaryTicker: string,
    relationshipsBySource: Map<string, NormalizedRelationship[]>
  ) {
    const companyMap = new Map<string, {
      ticker: string;
      name: string;
      latitude: number | null;
      longitude: number | null;
      headquarters_city: string | null;
      headquarters_country: string | null;
    }>();

    companyMap.set(primaryTicker, {
      ticker: this.normalizeTicker(primaryTicker),
      name: this.normalizeTicker(primaryTicker),
      latitude: null,
      longitude: null,
      headquarters_city: null,
      headquarters_country: null,
    });

    relationshipsBySource.forEach((rels) => {
      rels.forEach((rel) => {
        const key = rel.ticker.toUpperCase();
        const existing = companyMap.get(key);
        const next = {
          ticker: this.normalizeTicker(rel.ticker),
          name: rel.name,
          latitude: rel.latitude,
          longitude: rel.longitude,
          headquarters_city: rel.headquarters_city,
          headquarters_country: rel.headquarters_country,
        };
        companyMap.set(key, existing ? { ...next, ...existing } : next);
      });
    });

    return Array.from(companyMap.values());
  }

  private buildCoordinateRequests(
    primaryTicker: string,
    relationshipsBySource: Map<string, NormalizedRelationship[]>
  ) {
    const seen = new Map<string, {
      ticker: string;
      name: string;
      headquarters_city: string | null;
      headquarters_country: string | null;
    }>();

    relationshipsBySource.forEach((rels) => {
      rels.forEach((rel) => {
        const key = rel.ticker.toUpperCase();
        if (seen.has(key)) return;
        seen.set(key, {
          ticker: rel.ticker,
          name: rel.name,
          headquarters_city: rel.headquarters_city,
          headquarters_country: rel.headquarters_country,
        });
      });
    });

    const companyList = Array.from(seen.values());
    const primaryKey = this.normalizeTicker(primaryTicker);
    return companyList.filter((item) => this.normalizeTicker(item.ticker) !== primaryKey);
  }

  private pickHop2SeedTickers(relationships: NormalizedRelationship[]): string[] {
    const sorted = [...relationships].sort((a, b) => (b.confidence ?? 0.5) - (a.confidence ?? 0.5));
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const rel of sorted) {
      const key = rel.ticker.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(this.normalizeTicker(rel.ticker));
      if (unique.length >= 8) break;
    }
    return unique;
  }

  private getMissingCoordinateRequests(parsed: NormalizedRelationship[]) {
    return parsed
      .filter((rel) => !this.hasCoordinates(rel))
      .map((rel) => ({
        ticker: rel.ticker,
        name: rel.name,
        headquarters_city: rel.headquarters_city ?? undefined,
        headquarters_country: rel.headquarters_country ?? undefined,
      }));
  }

  private mergeCoordinates(parsed: NormalizedRelationship[], updates: MissingCoordinate[]): NormalizedRelationship[] {
    if (updates.length === 0) return parsed;
    const byTicker = new Map(updates.map((item) => [item.ticker.toUpperCase(), item]));
    return parsed.map((rel) => {
      if (this.hasCoordinates(rel)) return rel;
      const update = byTicker.get(rel.ticker.toUpperCase());
      if (!update) return rel;
      if (!this.hasCoordinates(update)) return rel;
      return {
        ...rel,
        latitude: update.latitude,
        longitude: update.longitude,
        headquarters_city: update.headquarters_city ?? rel.headquarters_city,
        headquarters_country: update.headquarters_country ?? rel.headquarters_country,
      };
    });
  }

  private resolveModelConfig(input: AiModelSelection, fallbackModel: string): ResolvedAiModel {
    if (typeof input === "string") {
      return { provider: "ollama", model: input.trim() || fallbackModel };
    }

    if (input && typeof input === "object") {
      const provider = this.normalizeProvider(input.provider);
      const result: ResolvedAiModel = {
        provider,
        model: (input.model || fallbackModel).trim(),
      };
      if (input.temperature !== undefined) result.temperature = input.temperature;
      if (input.maxTokens !== undefined) result.maxTokens = input.maxTokens;
      return result;
    }

    return { provider: "ollama", model: fallbackModel };
  }

  private resolveSecondaryModelConfig(settings: Record<string, unknown>, fallbackModel: string): ResolvedAiModel | null {
    const raw = settings?.secondaryAiModel as { provider?: string; model?: string } | undefined;
    if (!raw?.model) return null;
    const provider = this.normalizeProvider(raw.provider);
    return { provider, model: raw.model.trim() || fallbackModel };
  }

  private normalizeProvider(provider?: string): ResolvedAiModel["provider"] {
    const normalized = (provider || "ollama").toLowerCase();
    if (normalized === "ollama") return "ollama";
    return "ollama";
  }

  private resolveCloudConfig(model: ResolvedAiModel): CloudModelConfig {
    return {
      provider: model.provider,
      model: model.model,
      tier: "standard",
      temperature: model.temperature ?? 0.3,
      maxTokens: model.maxTokens ?? 2000,
    } as CloudModelConfig;
  }

  private hasCoordinates(value: { latitude: number | null; longitude: number | null }): boolean {
    return value.latitude !== null && value.longitude !== null && this.isValidCoordinate(value.latitude, value.longitude);
  }

  private normalizeMissingCoordinate(item: z.infer<typeof MissingCoordinateSchema>): MissingCoordinate {
    const normalizedTicker = this.normalizeTicker(item.ticker);
    const latitude = typeof item.latitude === "number" ? item.latitude : null;
    const longitude = typeof item.longitude === "number" ? item.longitude : null;
    if (latitude !== null && longitude !== null && this.isValidCoordinate(latitude, longitude)) {
      return {
        ...item,
        ticker: normalizedTicker,
        latitude,
        longitude,
        headquarters_city: item.headquarters_city ?? null,
        headquarters_country: item.headquarters_country ?? null,
      } as MissingCoordinate;
    }

    if (latitude !== null || longitude !== null) {
      console.warn(`[CompanyRelationshipService] Invalid coordinate retry entry for ${item.ticker}:`, {
        latitude,
        longitude,
      });
    }

    return {
      ...item,
      ticker: normalizedTicker,
      latitude: null,
      longitude: null,
      headquarters_city: item.headquarters_city ?? null,
      headquarters_country: item.headquarters_country ?? null,
    } as MissingCoordinate;
  }

  private normalizeRelationship(rel: ParsedRelationship): NormalizedRelationship {
    const normalizedTicker = this.normalizeTicker(rel.ticker);
    const latitude = typeof rel.latitude === "number" ? rel.latitude : null;
    const longitude = typeof rel.longitude === "number" ? rel.longitude : null;
    const hasCoords = latitude !== null && longitude !== null && this.isValidCoordinate(latitude, longitude);

    if (!hasCoords) {
      if (latitude !== null || longitude !== null) {
        console.warn(`[CompanyRelationshipService] Invalid coordinates for ${rel.ticker}:`, {
          latitude,
          longitude,
        });
      }
      return {
        ...rel,
        ticker: normalizedTicker,
        relation_type: rel.relation_type.toLowerCase() as NormalizedRelationship["relation_type"],
        latitude: null,
        longitude: null,
        headquarters_city: rel.headquarters_city ?? null,
        headquarters_country: rel.headquarters_country ?? null,
      } as NormalizedRelationship;
    }

    return {
      ...rel,
      ticker: normalizedTicker,
      relation_type: rel.relation_type.toLowerCase() as NormalizedRelationship["relation_type"],
      latitude,
      longitude,
      headquarters_city: rel.headquarters_city ?? null,
      headquarters_country: rel.headquarters_country ?? null,
    } as NormalizedRelationship;
  }

  private isValidCoordinate(latitude: number, longitude: number): boolean {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
    return latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
  }

  private computeHypothesisRatio(edges: Array<{ confidence?: number }>): number {
    if (edges.length === 0) return 0;
    const hypothesisCount = edges.filter((edge) => (edge.confidence ?? 0) < 0.7).length;
    return Number((hypothesisCount / edges.length).toFixed(4));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async runWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    task: (item: T, index: number) => Promise<R>
  ): Promise<R[]> {
    if (items.length === 0) return [];

    const result: R[] = new Array(items.length);
    const poolSize = Math.max(1, Math.min(concurrency, items.length));
    let cursor = 0;

    const workers = Array.from({ length: poolSize }, async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        const item = items[index];
        if (item === undefined) return;
        result[index] = await task(item, index);
      }
    });

    await Promise.all(workers);
    return result;
  }

  /**
   * Get accumulated relationships for a company (including transitive relationships)
   */
  async getAccumulatedRelationships(_ticker: string): Promise<{
    companies: GwmdCompany[];
    edges: GwmdRelationshipEdge[];
  }> {
    return {
      companies: gwmdMapRepo.getAllCompanies(),
      edges: gwmdMapRepo.getAllRelationships(),
    };
  }

  /**
   * Clear all stored relationships
   */
  clearAll() {
    gwmdMapRepo.clear();
  }

  /**
   * Repair companies with missing coordinates
   */
  async repairMissingCoordinates(limit: number = 200): Promise<{ attempted: number; updated: number }> {
    const missing = gwmdMapRepo.getCompaniesMissingCoords(limit);
    if (missing.length === 0) return { attempted: 0, updated: 0 };

    const updates: Array<{ ticker: string; name: string; hq_lat: number; hq_lon: number; hq_city?: string; hq_country?: string }> = [];

    for (const company of missing) {
      try {
        const geo = await this.resolveGeoWithFallbacks({
          name: company.name,
          headquarters_city: company.hq_city ?? null,
          headquarters_country: company.hq_country ?? null,
        });
        if (!geo?.lat || !geo?.lon) continue;
        const hqCity = geo.city ?? company.hq_city ?? undefined;
        const hqCountry = geo.country ?? company.hq_country ?? undefined;
        updates.push({
          ticker: company.ticker,
          name: company.name,
          hq_lat: geo.lat,
          hq_lon: geo.lon,
          ...(hqCity ? { hq_city: hqCity } : {}),
          ...(hqCountry ? { hq_country: hqCountry } : {}),
        });
      } catch (err) {
        console.warn(`[CompanyRelationshipService] Repair failed for ${company.ticker}:`, err);
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (updates.length > 0) {
      gwmdMapRepo.addCompanies(updates);
    }

    return { attempted: missing.length, updated: updates.length };
  }
}

export const companyRelationshipService = new CompanyRelationshipService();

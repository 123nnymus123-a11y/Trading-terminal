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
import {
  canUseGwmdVault,
  lookupGwmdResearchScope,
  mergeGwmdResultsWithVault,
  type GwmdDataStatus,
} from "./gwmdVaultBridge";
import { persistGwmdCandidates } from "./gwmdCandidateWriter";
import { validateGwmdCandidates } from "./gwmdValidationPipeline";

export interface GwmdCompany {
  ticker: string;
  name: string;
  hq_lat?: number;
  hq_lon?: number;
  hq_city?: string;
  hq_country?: string;
  industry?: string;
  health_score?: number;
  geo_source?:
    | "ai_model"
    | "curated"
    | "nominatim"
    | "stored_snapshot"
    | "vault"
    | "unresolved";
  geo_confidence?: number;
  data_status?: GwmdDataStatus;
}

export type GwmdFieldStatus =
  | "present"
  | "unknown"
  | "not_found"
  | "not_applicable"
  | "low_confidence_inference"
  | "contradicted";

export interface GwmdRelationshipEdge {
  id: string;
  from_ticker: string;
  to_ticker: string;
  relation_type: string;
  weight?: number;
  confidence?: number;
  evidence?: string;
  entity_type?:
    | "company"
    | "facility"
    | "subsidiary"
    | "regulator"
    | "supplier_network";
  source_type?:
    | "sec_filing"
    | "annual_report"
    | "press_release"
    | "regulator_dataset"
    | "industry_analysis"
    | "unknown";
  source_citation?: string;
  relationship_strength?: number;
  related_company_aliases?: string[];
  related_company_industry?: string;
  operating_countries?: string[];
  facility_locations?: string[];
  product_or_service?: string;
  dependency_summary?: string;
  directness?: "direct" | "indirect" | "inferred" | "unknown";
  logistics_mode?:
    | "maritime"
    | "air"
    | "rail"
    | "road"
    | "multi_modal"
    | "digital"
    | "unknown";
  logistics_nodes?: string[];
  chokepoints?: string[];
  exposure_regions?: string[];
  field_statuses?: Record<string, GwmdFieldStatus>;
  data_status?: GwmdDataStatus;
}

const CoercedNumber = z.preprocess((value) => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value;
  const num = Number(value);
  return Number.isFinite(num) ? num : value;
}, z.number().nullable());

const CoercedStringList = z.preprocess((value) => {
  if (value === null || value === undefined || value === "") return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return [value];
  return value;
}, z.array(z.string()));

const GwmdFieldStatusSchema = z.enum([
  "present",
  "unknown",
  "not_found",
  "not_applicable",
  "low_confidence_inference",
  "contradicted",
]);

const RelationshipSchema = z.object({
  ticker: z.string(),
  name: z.string(),
  headquarters_city: z.string().optional(),
  headquarters_country: z.string().optional(),
  aliases: CoercedStringList.optional().default([]),
  industry: z.string().optional(),
  latitude: CoercedNumber.optional(),
  longitude: CoercedNumber.optional(),
  relation_type: z.enum([
    "supplier",
    "customer",
    "partner",
    "competitor",
    "financing",
    "license",
  ]),
  confidence: z.number().min(0).max(1).optional().default(0.5),
  evidence: z.string().optional(),
  entity_type: z
    .enum([
      "company",
      "facility",
      "subsidiary",
      "regulator",
      "supplier_network",
    ])
    .optional(),
  source_type: z
    .enum([
      "sec_filing",
      "annual_report",
      "press_release",
      "regulator_dataset",
      "industry_analysis",
      "unknown",
    ])
    .optional(),
  source_citation: z.string().optional(),
  relationship_strength: z.number().min(0).max(1).optional(),
  operating_countries: CoercedStringList.optional().default([]),
  facility_locations: CoercedStringList.optional().default([]),
  product_or_service: z.string().optional(),
  dependency_summary: z.string().optional(),
  directness: z.enum(["direct", "indirect", "inferred", "unknown"]).optional(),
  logistics_mode: z
    .enum([
      "maritime",
      "air",
      "rail",
      "road",
      "multi_modal",
      "digital",
      "unknown",
    ])
    .optional(),
  logistics_nodes: CoercedStringList.optional().default([]),
  chokepoints: CoercedStringList.optional().default([]),
  exposure_regions: CoercedStringList.optional().default([]),
  field_statuses: z
    .record(z.string(), GwmdFieldStatusSchema)
    .optional()
    .default({}),
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
type NormalizedRelationship = Omit<
  ParsedRelationship,
  "latitude" | "longitude" | "headquarters_city" | "headquarters_country"
> & {
  latitude: number | null;
  longitude: number | null;
  headquarters_city: string | null;
  headquarters_country: string | null;
};

type MissingCoordinate = Omit<
  z.infer<typeof MissingCoordinateSchema>,
  "latitude" | "longitude" | "headquarters_city" | "headquarters_country"
> & {
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
  provider:
    | "ollama"
    | "openai"
    | "anthropic"
    | "gemini"
    | "mistral"
    | "groq"
    | "xai";
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
  requestedHops: number;
  expandedTickerCount: number;
};

class GwmdParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GwmdParseError";
  }
}

function tryParseJsonCandidate<T>(input: string): T | null {
  try {
    return JSON.parse(input) as T;
  } catch {
    return null;
  }
}

function normalizeJsonText(input: string): string {
  return input
    .replace(/\uFEFF/g, "")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\u00A0/g, " ");
}

function stripJsonPrefix(input: string): string {
  return input.replace(/^\s*json\s*/i, "").trim();
}

function stripJsonComments(input: string): string {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function removeTrailingCommas(input: string): string {
  return input.replace(/,\s*([}\]])/g, "$1");
}

function stripJsonCodeFence(input: string): string {
  const trimmed = input.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced && fenced[1]) {
    return fenced[1].trim();
  }
  return trimmed;
}

function extractFencedJsonBlocks(input: string): string[] {
  const blocks: string[] = [];
  const pattern = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
  let match: RegExpExecArray | null = null;
  while ((match = pattern.exec(input)) !== null) {
    if (match[1]) {
      blocks.push(match[1].trim());
    }
  }
  return blocks;
}

function findBalancedJsonSegment(
  input: string,
  startIndex: number,
): string | null {
  const opener = input[startIndex];
  if (!opener || (opener !== "[" && opener !== "{")) return null;
  const closer = opener === "[" ? "]" : "}";

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < input.length; i += 1) {
    const ch = input[i];
    if (!ch) continue;

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === opener) {
      depth += 1;
      continue;
    }
    if (ch === closer) {
      depth -= 1;
      if (depth === 0) {
        return input.slice(startIndex, i + 1);
      }
    }
  }

  return null;
}

function extractBalancedJsonCandidates(input: string): string[] {
  const candidates: string[] = [];
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch !== "[" && ch !== "{") continue;
    const segment = findBalancedJsonSegment(input, i);
    if (segment) {
      candidates.push(segment);
      i += segment.length - 1;
    }
  }
  return candidates;
}

function extractBracketedJson(input: string): string | null {
  const firstArray = input.indexOf("[");
  const lastArray = input.lastIndexOf("]");
  if (firstArray !== -1 && lastArray !== -1 && lastArray > firstArray) {
    return input.slice(firstArray, lastArray + 1);
  }

  const firstObject = input.indexOf("{");
  const lastObject = input.lastIndexOf("}");
  if (firstObject !== -1 && lastObject !== -1 && lastObject > firstObject) {
    return input.slice(firstObject, lastObject + 1);
  }

  return null;
}

function parseLikelyJson<T>(aiResponse: string): T {
  const normalizedInput = normalizeJsonText(aiResponse);
  const stripped = stripJsonPrefix(stripJsonCodeFence(normalizedInput));

  const candidateSet = new Set<string>();
  candidateSet.add(stripped);

  const extracted = extractBracketedJson(stripped);
  if (extracted) candidateSet.add(extracted);

  extractFencedJsonBlocks(normalizedInput).forEach((block) =>
    candidateSet.add(stripJsonPrefix(normalizeJsonText(block))),
  );
  extractBalancedJsonCandidates(stripped).forEach((segment) =>
    candidateSet.add(segment),
  );

  const candidates = Array.from(candidateSet).filter(
    (c) => c.trim().length > 0,
  );

  for (const candidate of candidates) {
    const parsed = tryParseJsonCandidate<T>(candidate);
    if (parsed !== null) {
      return parsed;
    }

    const commaFixed = removeTrailingCommas(candidate);
    if (commaFixed !== candidate) {
      const repaired = tryParseJsonCandidate<T>(commaFixed);
      if (repaired !== null) {
        return repaired;
      }
    }

    const commentStripped = stripJsonComments(candidate);
    if (commentStripped !== candidate) {
      const repaired = tryParseJsonCandidate<T>(
        removeTrailingCommas(commentStripped),
      );
      if (repaired !== null) {
        return repaired;
      }
    }
  }

  throw new Error("AI response was not valid JSON");
}

export class CompanyRelationshipService {
  private readonly expansionConcurrency = 3;
  private readonly geocodeConcurrency = 3;

  private clampHopDepth(value?: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) return 2;
    return Math.max(1, Math.min(3, Math.floor(value)));
  }

  private getSeedLimitForHop(hop: number): number {
    if (hop <= 2) return 12;
    if (hop === 3) return 6;
    return 4;
  }

  private isTransientGeoError(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err);
    const lower = message.toLowerCase();
    return (
      lower.includes("fetch failed") ||
      lower.includes("etimedout") ||
      lower.includes("timeout") ||
      lower.includes("abort")
    );
  }

  private normalizeTicker(value: string): string {
    return value.trim().toUpperCase();
  }

  private edgeSemanticKey(
    fromTicker: string,
    toTicker: string,
    relationType: string,
  ): string {
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
      hops?: number;
    } = {},
  ): Promise<{
    companies: GwmdCompany[];
    edges: GwmdRelationshipEdge[];
    meta: GwmdRunMeta;
  }> {
    const normalizedTicker = this.normalizeTicker(ticker);
    const requestedHops = this.clampHopDepth(options.hops);
    console.log(
      `[CompanyRelationshipService] Generating relationships for ${normalizedTicker} with hop depth ${requestedHops}`,
    );

    try {
      const cachedSnapshot =
        !options.refresh && gwmdMapRepo.companyExists(normalizedTicker)
          ? gwmdMapRepo.getScopedSnapshot(normalizedTicker)
          : null;
      if (cachedSnapshot) {
        console.log(
          `[CompanyRelationshipService] Found ${normalizedTicker} in cache, attempting to extend relationships`,
        );
      }

      const { AiResearchRepo: Repo } =
        await import("../../persistence/aiResearchRepo");
      const { AppSettingsRepo } = await import("../../persistence/repos");
      const config = Repo.getConfig();
      const settings = AppSettingsRepo.get();
      const defaultModel = config?.model || "deepseek-r1:14b";
      const resolvedModel = this.resolveModelConfig(
        options.model,
        defaultModel,
      );
      const secondaryModel =
        this.resolveSecondaryModelConfig(settings, defaultModel) ??
        resolvedModel;
      console.log(
        `[CompanyRelationshipService] Using model: ${resolvedModel.provider}/${resolvedModel.model}`,
      );
      if (secondaryModel !== resolvedModel) {
        console.log(
          `[CompanyRelationshipService] Using secondary model for coordinates: ${secondaryModel.provider}/${secondaryModel.model}`,
        );
      }

      const relationshipsBySource = new Map<string, NormalizedRelationship[]>();
      let primaryRelationships: NormalizedRelationship[] = [];
      try {
        primaryRelationships = await this.getRelationshipsForTicker(
          normalizedTicker,
          resolvedModel,
          options.strict ?? false,
          4,
        );
        relationshipsBySource.set(normalizedTicker, primaryRelationships);
      } catch (err) {
        const cachedCompanyCount = cachedSnapshot?.companies.length ?? 0;
        const cachedEdgeCount = cachedSnapshot?.edges.length ?? 0;
        const cacheHasUsableContext =
          !!cachedSnapshot &&
          (cachedSnapshot.companies.some(
            (company) => this.normalizeTicker(company.ticker) === normalizedTicker,
          ) ||
            cachedSnapshot.companies.length > 0 ||
            cachedSnapshot.edges.length > 0);
        if (cacheHasUsableContext && cachedSnapshot) {
          console.warn(
            `[CompanyRelationshipService] AI call failed, returning cached results for ${normalizedTicker} (${cachedCompanyCount} companies / ${cachedEdgeCount} edges)`,
          );
          return {
            ...cachedSnapshot,
            meta: {
              status: "degraded_cache",
              source: "cache_scoped",
              degraded: true,
              reason: "upstream_failed",
              unlocatedCount: cachedSnapshot.companies.filter(
                (company) => company.hq_lat == null || company.hq_lon == null,
              ).length,
              hypothesisRatio: this.computeHypothesisRatio(
                cachedSnapshot.edges,
              ),
              primaryRelationshipCount: 0,
              hop2SeedCount: 0,
              requestedHops,
              expandedTickerCount: Math.max(0, cachedSnapshot.companies.length - 1),
            },
          };
        }

        throw err;
      }

      const { hop2SeedCount, expandedTickerCount } =
        await this.expandRelationshipsByHop(
          normalizedTicker,
          primaryRelationships,
          relationshipsBySource,
          resolvedModel,
          options.strict ?? false,
          requestedHops,
        );

      const coordinateRequests = this.buildCoordinateRequests(
        ticker,
        relationshipsBySource,
      );
      if (coordinateRequests.length > 0) {
        try {
          console.log(
            `[CompanyRelationshipService] Resolving coordinates for ${coordinateRequests.length} companies`,
          );
          const coordResponse = await this.callAiForMissingCoordinates(
            normalizedTicker,
            coordinateRequests,
            secondaryModel,
          );
          const coordUpdates = this.parseMissingCoordinates(coordResponse);
          if (coordUpdates.length > 0) {
            relationshipsBySource.forEach((rels, source) => {
              relationshipsBySource.set(
                source,
                this.mergeCoordinates(rels, coordUpdates),
              );
            });
          }
        } catch (err) {
          console.warn(
            `[CompanyRelationshipService] Coordinate resolver failed:`,
            err,
          );
        }
      }

      // Geocode companies
      const companyPayloads = this.buildCompanyPayloads(
        normalizedTicker,
        relationshipsBySource,
      );
      const companies: GwmdCompany[] =
        await this._enrichCompanies(companyPayloads);
      const companyTickerSet = new Set(
        companies.map((company) => this.normalizeTicker(company.ticker)),
      );

      // Build edges
      const edges: GwmdRelationshipEdge[] = [];
      const edgeKeys = new Set<string>();
      relationshipsBySource.forEach((rels, fromTicker) => {
        rels.forEach((rel) => {
          const fromTickerCanonical = this.normalizeTicker(fromTicker);
          const toTickerCanonical = this.normalizeTicker(rel.ticker);
          if (
            !companyTickerSet.has(fromTickerCanonical) ||
            !companyTickerSet.has(toTickerCanonical)
          )
            return;
          if (fromTickerCanonical === toTickerCanonical) return;

          const key = this.edgeSemanticKey(
            fromTickerCanonical,
            toTickerCanonical,
            rel.relation_type,
          );
          if (edgeKeys.has(key)) return;
          edgeKeys.add(key);

          edges.push({
            id: key.replace(/\|/g, "-"),
            from_ticker: fromTickerCanonical,
            to_ticker: toTickerCanonical,
            relation_type: rel.relation_type.toLowerCase(),
            weight: rel.relationship_strength ?? rel.confidence ?? 0.5,
            confidence: rel.confidence || 0.5,
            evidence: rel.evidence || "",
            entity_type: rel.entity_type,
            source_type: rel.source_type,
            source_citation: rel.source_citation,
            relationship_strength: rel.relationship_strength,
          });
        });
      });

      // Phase 3: append facility/infrastructure nodes from edge location metadata
      try {
        const facilityResult = await this._geocodeFacilityNodes(
          relationshipsBySource,
          companyTickerSet,
        );
        for (const fc of facilityResult.facilityCompanies) {
          companies.push(fc);
          companyTickerSet.add(this.normalizeTicker(fc.ticker));
        }
        for (const fe of facilityResult.facilityEdges) {
          const fKey = this.edgeSemanticKey(
            fe.from_ticker,
            fe.to_ticker,
            fe.relation_type,
          );
          if (!edgeKeys.has(fKey)) {
            edgeKeys.add(fKey);
            edges.push(fe);
          }
        }
      } catch (facilityErr) {
        console.warn(
          `[CompanyRelationshipService] Facility geocoding failed:`,
          facilityErr,
        );
      }

      let displayCompanies = companies;
      let displayEdges = edges;

      if (canUseGwmdVault()) {
        try {
          const scope = lookupGwmdResearchScope(
            companies.map((company) => company.ticker),
          );
          const persisted = persistGwmdCandidates({
            rootTicker: normalizedTicker,
            companies,
            edges,
            scope,
          });

          try {
            await validateGwmdCandidates({
              rootTicker: normalizedTicker,
              model: resolvedModel,
              candidateEdgeIds: persisted.candidateEdgeIds,
              companyEntityIdsByTicker: persisted.companyEntityIdsByTicker,
            });
          } catch (validationError) {
            console.warn(
              `[CompanyRelationshipService] Candidate validation failed for ${normalizedTicker}:`,
              validationError,
            );
          }

          const merged = mergeGwmdResultsWithVault({
            companies,
            edges,
          });
          displayCompanies = merged.companies;
          displayEdges = merged.edges;
        } catch (vaultError) {
          console.warn(
            `[CompanyRelationshipService] Data Vault bridge failed for ${normalizedTicker}:`,
            vaultError,
          );
        }
      }

      // Save to database
      gwmdMapRepo.addCompanies(displayCompanies);
      gwmdMapRepo.addRelationships(displayEdges);
      gwmdMapRepo.logSearch(
        normalizedTicker,
        displayCompanies.length,
        displayEdges.length,
      );

      console.log(
        `[CompanyRelationshipService] ✓ Found ${displayCompanies.length} companies, ${displayEdges.length} relationships`,
      );

      return {
        companies: displayCompanies,
        edges: displayEdges,
        meta: {
          status: "ok",
          source: "fresh",
          degraded: false,
          unlocatedCount: displayCompanies.filter(
            (company) => company.hq_lat == null || company.hq_lon == null,
          ).length,
          hypothesisRatio: this.computeHypothesisRatio(displayEdges),
          primaryRelationshipCount: primaryRelationships.length,
          hop2SeedCount,
          requestedHops,
          expandedTickerCount,
        },
      };
    } catch (err) {
      console.error(
        `[CompanyRelationshipService] ✗ Error generating relationships:`,
        err,
      );
      throw err;
    }
  }

  /**
   * Call AI to generate relationship hypotheses
   */
  private async callAiForRelationships(
    ticker: string,
    model: ResolvedAiModel,
  ): Promise<string> {
    const systemPrompt = `You are a supply chain intelligence analyst feeding a structured graph memory system. Precision and evidence quality are critical. Prefer official disclosures and regulator data. If evidence is weak, lower confidence and state uncertainty explicitly.`;

    const userPrompt = `
For company ticker "${ticker}", produce a JSON array of relationship candidates for Data Vault ingestion.

Response format (JSON array):
\`\`\`json
[
  {
    "ticker": "COMPANY_TICKER",
    "name": "Full Company Name",
    "headquarters_city": "City Name",
    "headquarters_country": "Country Name",
    "latitude": 37.3349,
    "longitude": -122.0090,
    "aliases": ["Alt Name", "Trading Name"],
    "industry": "Semiconductors",
    "relation_type": "supplier|customer|partner|competitor|financing|license",
    "entity_type": "company|facility|subsidiary|regulator|supplier_network",
    "source_type": "sec_filing|annual_report|press_release|regulator_dataset|industry_analysis|unknown",
    "source_citation": "Exact source reference (for example: AAPL 10-K 2023, Supply Chain section)",
    "relationship_strength": 0.0-1.0,
    "confidence": 0.0-1.0,
    "evidence": "Source: [source] - [specific factual finding]",
    "operating_countries": ["Malaysia", "Vietnam"],
    "facility_locations": ["Penang, Malaysia", "Austin, Texas"],
    "product_or_service": "Advanced packaging services",
    "dependency_summary": "Provides backend packaging for premium devices",
    "directness": "direct|indirect|inferred|unknown",
    "logistics_mode": "maritime|air|rail|road|multi_modal|digital|unknown",
    "logistics_nodes": ["Port of Kaohsiung", "Singapore Changi"],
    "chokepoints": ["Taiwan Strait", "Suez Canal"],
    "exposure_regions": ["Taiwan", "South China Sea"],
    "field_statuses": {
      "headquarters_city": "present|unknown|not_found|not_applicable|low_confidence_inference|contradicted",
      "headquarters_country": "present|unknown|not_found|not_applicable|low_confidence_inference|contradicted",
      "operating_countries": "present|unknown|not_found|not_applicable|low_confidence_inference|contradicted",
      "facility_locations": "present|unknown|not_found|not_applicable|low_confidence_inference|contradicted",
      "product_or_service": "present|unknown|not_found|not_applicable|low_confidence_inference|contradicted",
      "dependency_summary": "present|unknown|not_found|not_applicable|low_confidence_inference|contradicted",
      "logistics_mode": "present|unknown|not_found|not_applicable|low_confidence_inference|contradicted",
      "logistics_nodes": "present|unknown|not_found|not_applicable|low_confidence_inference|contradicted",
      "chokepoints": "present|unknown|not_found|not_applicable|low_confidence_inference|contradicted",
      "exposure_regions": "present|unknown|not_found|not_applicable|low_confidence_inference|contradicted"
    }
  }
]
\`\`\`

Requirements:
- Generate 40-60 relationships, tiered by evidence quality:
    Tier 1 (≥10): confirmed by official disclosures — confidence ≥ 0.85
    Tier 2 (≥15): corroborated by multiple public sources — confidence 0.65-0.84
    Tier 3 (10-35): plausible inferences from industry knowledge — confidence 0.30-0.64, must state uncertainty in evidence
- Provide headquarters city and country when known; if uncertain, use null and mark the field in field_statuses
- Include latitude and longitude whenever known
- Use field_statuses for all non-trivial unknowns:
  - present: concrete value from evidence
  - unknown: likely exists but not recoverable from current sources
  - not_found: explicitly looked but did not find support
  - not_applicable: field does not make sense for this entity/relationship
  - low_confidence_inference: plausible inference, not directly supported
  - contradicted: sources conflict
- If exact HQ coordinates are unknown, use a reasonable city-center approximation
- Latitude must be between -90 and 90
- Longitude must be between -180 and 180
- Keep arrays empty when no values are available and field_statuses explains why

Confidence rubric:
- 0.90-1.00: directly confirmed by SEC filing / annual report / regulator record
- 0.75-0.89: multiple corroborating credible public sources
- 0.55-0.74: plausible industry relationship with partial support
- 0.30-0.54: weakly supported hypothesis (must be explicitly labeled in evidence)

Quality rules:
- Return JSON only (no markdown)
- Do not invent citations
- Use "unknown" source_type when no reliable source is available
- If uncertain, keep confidence lower instead of omitting the relationship
- Prefer official filings, annual reports, regulator data, and named public disclosures
- Capture logistics and geographic exposure only when the evidence supports it`;

    return this.callAiWithPrompt(model, systemPrompt, userPrompt);
  }

  private async callAiForMissingCoordinates(
    ticker: string,
    missing: Array<{
      ticker: string;
      name: string;
      headquarters_city?: string | null;
      headquarters_country?: string | null;
    }>,
    model: ResolvedAiModel,
  ): Promise<string> {
    const systemPrompt = `You are a geolocation expert. Provide headquarters coordinates. If exact coordinates are unknown, return a reasonable city-center approximation.`;
    const items = missing
      .map((item) => {
        const extras = [item.headquarters_city, item.headquarters_country]
          .filter(Boolean)
          .join(", ");
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

  private async getRelationshipsForTicker(
    ticker: string,
    model: ResolvedAiModel,
    strict: boolean,
    minRelationships = 1,
  ): Promise<NormalizedRelationship[]> {
    const parseAndFilter = (
      aiResponse: string,
    ): {
      relationships: NormalizedRelationship[];
      parsedCount: number;
      qualityRetainedCount: number;
      nonSelfCount: number;
    } => {
      const parsed = this.parseRelationships(aiResponse);
      const filtered = this.applyRelationshipQualityGate(parsed, strict);
      const normalizedSourceTicker = this.normalizeTicker(ticker);
      const nonSelf = filtered.filter(
        (rel) => this.normalizeTicker(rel.ticker) !== normalizedSourceTicker,
      );
      return {
        relationships: nonSelf,
        parsedCount: parsed.length,
        qualityRetainedCount: filtered.length,
        nonSelfCount: nonSelf.length,
      };
    };

    const firstResponse = await this.callAiForRelationships(ticker, model);
    const firstPass = parseAndFilter(firstResponse);
    console.log(
      `[CompanyRelationshipService] Relationship pipeline for ${ticker}: parsed=${firstPass.parsedCount}, quality_retained=${firstPass.qualityRetainedCount}, non_self=${firstPass.nonSelfCount}`,
    );

    if (firstPass.relationships.length >= minRelationships) {
      if (firstPass.relationships.length < 3) {
        console.warn(
          `[CompanyRelationshipService] Low relationship breadth for ${ticker}: ${firstPass.relationships.length}`,
        );
      }
      return firstPass.relationships;
    }

    console.warn(
      `[CompanyRelationshipService] Retry due to thin relationship set for ${ticker} (${firstPass.relationships.length}/${minRelationships})`,
    );
    const retryResponse = await this.callAiForRelationships(ticker, model);
    const retryPass = parseAndFilter(retryResponse);
    console.log(
      `[CompanyRelationshipService] Retry relationship pipeline for ${ticker}: parsed=${retryPass.parsedCount}, quality_retained=${retryPass.qualityRetainedCount}, non_self=${retryPass.nonSelfCount}`,
    );

    if (retryPass.relationships.length >= minRelationships) {
      return retryPass.relationships;
    }

    if (retryPass.relationships.length === 0) {
      throw new GwmdParseError(
        `No valid non-self relationships after quality checks for ${ticker}`,
      );
    }

    throw new GwmdParseError(
      `Insufficient relationship breadth for ${ticker}: ${retryPass.relationships.length} (minimum ${minRelationships})`,
    );
  }

  private async callAiWithPrompt(
    model: ResolvedAiModel,
    systemPrompt: string,
    userPrompt: string,
  ): Promise<string> {
    try {
      console.log(`[CompanyRelationshipService] Calling cloud LLM...`);
      const response = await callCloudModel(
        this.resolveCloudConfig(model),
        systemPrompt,
        userPrompt,
      );
      if (typeof response !== "string") {
        throw new Error("Unexpected response format from AI");
      }
      console.log(
        `[CompanyRelationshipService] Received AI response (${response.length} chars)`,
      );
      return response;
    } catch (err) {
      console.error(`[CompanyRelationshipService] AI call failed:`, err);
      throw new Error(
        `Failed to generate relationships: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Parse AI response into structured relationships
   */
  private parseRelationships(aiResponse: string): NormalizedRelationship[] {
    try {
      const parsed = parseLikelyJson<unknown>(aiResponse);
      const relationships = Array.isArray(parsed) ? parsed : [parsed];

      // Validate each relationship
      const normalized = relationships
        .map((rel) => {
          try {
            const parsedRel = RelationshipSchema.parse(rel);
            return this.normalizeRelationship(parsedRel);
          } catch {
            console.warn(
              `[CompanyRelationshipService] Invalid relationship:`,
              rel,
            );
            return null;
          }
        })
        .filter((r) => r !== null) as NormalizedRelationship[];

      if (normalized.length === 0) {
        throw new GwmdParseError(
          "AI response did not contain any valid relationships",
        );
      }

      return normalized;
    } catch (err) {
      console.error(
        `[CompanyRelationshipService] Failed to parse relationships:`,
        err,
      );
      if (err instanceof GwmdParseError) throw err;
      throw new GwmdParseError(
        `Failed to parse relationships: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private parseMissingCoordinates(aiResponse: string): MissingCoordinate[] {
    try {
      const parsed = parseLikelyJson<unknown>(aiResponse);
      let content: unknown = parsed;
      if (content && typeof content === "object" && !Array.isArray(content)) {
        const values = Object.values(content as Record<string, unknown>);
        const arr = values.find(Array.isArray);
        if (arr) content = arr;
      }
      const items = Array.isArray(content) ? content : [content];

      const normalized = items
        .map((item) => {
          try {
            const parsedItem = MissingCoordinateSchema.parse(item);
            return this.normalizeMissingCoordinate(parsedItem);
          } catch {
            console.warn(
              `[CompanyRelationshipService] Invalid coordinate entry:`,
              item,
            );
            return null;
          }
        })
        .filter((item) => item !== null) as MissingCoordinate[];

      if (normalized.length === 0) {
        throw new GwmdParseError(
          "Coordinate resolver response did not contain any valid entries",
        );
      }

      return normalized;
    } catch (err) {
      console.error(
        `[CompanyRelationshipService] Failed to parse missing coordinates:`,
        err,
      );
      if (err instanceof GwmdParseError) throw err;
      throw new GwmdParseError(
        `Failed to parse missing coordinates: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private applyRelationshipQualityGate(
    relationships: NormalizedRelationship[],
    strict: boolean,
  ): NormalizedRelationship[] {
    const minConfidence = strict ? 0.6 : 0.35;
    const minEvidenceLength = strict ? 20 : 6;

    let rejectedLowConfidence = 0;
    let rejectedShortEvidence = 0;

    const filtered = relationships.filter((rel) => {
      const confidence = rel.confidence ?? 0;
      const evidence = (rel.evidence ?? "").trim();
      if (confidence < minConfidence) {
        rejectedLowConfidence += 1;
        return false;
      }
      if (evidence.length < minEvidenceLength) {
        rejectedShortEvidence += 1;
        return false;
      }
      return true;
    });

    if (relationships.length > 0) {
      console.log(
        `[CompanyRelationshipService] Quality gate: input=${relationships.length}, kept=${filtered.length}, rejected_confidence=${rejectedLowConfidence}, rejected_evidence=${rejectedShortEvidence}, strict=${strict}`,
      );
    }

    return filtered;
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
    }>,
  ): Promise<GwmdCompany[]> {
    return this.runWithConcurrency(
      companies,
      this.geocodeConcurrency,
      async (company) => {
        try {
          const hasAiCoords =
            Number.isFinite(company.latitude) &&
            Number.isFinite(company.longitude);

          // Phase 5: check DB for existing geocoded coordinates to avoid redundant Nominatim calls
          let storedGeo: {
            lat: number;
            lon: number;
            city?: string;
            country?: string;
            source: "stored_snapshot";
          } | null = null;
          if (!hasAiCoords) {
            try {
              const stored = gwmdMapRepo.getCompany(company.ticker);
              if (
                stored &&
                Number.isFinite(stored.hq_lat) &&
                Number.isFinite(stored.hq_lon)
              ) {
                storedGeo = {
                  lat: stored.hq_lat as number,
                  lon: stored.hq_lon as number,
                  city: stored.hq_city ?? undefined,
                  country: stored.hq_country ?? undefined,
                  source: "stored_snapshot",
                };
              }
            } catch {
              // ignore DB lookup errors — fall through to geocoder
            }
          }

          const geo = hasAiCoords
            ? null
            : storedGeo
              ? null
              : await this.resolveGeoWithFallbacks(company);

          await this.sleep(80);

          return {
            ticker: company.ticker,
            name: company.name,
            hq_lat: hasAiCoords
              ? (company.latitude ?? undefined)
              : storedGeo
                ? storedGeo.lat
                : geo?.lat,
            hq_lon: hasAiCoords
              ? (company.longitude ?? undefined)
              : storedGeo
                ? storedGeo.lon
                : geo?.lon,
            hq_city: hasAiCoords
              ? company.headquarters_city
              : storedGeo
                ? (storedGeo.city ?? company.headquarters_city)
                : (geo?.city ?? company.headquarters_city),
            hq_country: hasAiCoords
              ? company.headquarters_country
              : storedGeo
                ? (storedGeo.country ?? company.headquarters_country)
                : (geo?.country ?? company.headquarters_country),
            geo_source: hasAiCoords
              ? "ai_model"
              : storedGeo
                ? "stored_snapshot"
                : geo?.source === "curated"
                  ? "curated"
                  : geo?.source === "nominatim"
                    ? "nominatim"
                    : "unresolved",
            geo_confidence: hasAiCoords
              ? 0.7
              : storedGeo
                ? 0.88
                : geo?.source === "curated"
                  ? 0.98
                  : geo?.source === "nominatim"
                    ? 0.82
                    : 0,
          } as GwmdCompany;
        } catch (err) {
          if (this.isTransientGeoError(err)) {
            console.warn(
              `[CompanyRelationshipService] Enrichment skipped for ${company.ticker} due to transient geocoder timeout`,
            );
          } else {
            console.warn(
              `[CompanyRelationshipService] Enrichment failed for ${company.ticker}:`,
              err,
            );
          }
          return {
            ticker: company.ticker,
            name: company.name,
            hq_lat: Number.isFinite(company.latitude)
              ? (company.latitude as number)
              : undefined,
            hq_lon: Number.isFinite(company.longitude)
              ? (company.longitude as number)
              : undefined,
            hq_city: company.headquarters_city,
            hq_country: company.headquarters_country,
            geo_source:
              Number.isFinite(company.latitude) &&
              Number.isFinite(company.longitude)
                ? "ai_model"
                : "unresolved",
            geo_confidence:
              Number.isFinite(company.latitude) &&
              Number.isFinite(company.longitude)
                ? 0.7
                : 0,
          } as GwmdCompany;
        }
      },
    );
  }

  /**
   * Phase 3: Geocode facility_locations and logistics_nodes from edge metadata.
   * Creates synthetic GwmdCompany entries (ticker prefix F_ / INFRA_) and
   * partner edges linking them back to the companies that referenced them.
   */
  private async _geocodeFacilityNodes(
    relationshipsBySource: Map<string, NormalizedRelationship[]>,
    existingTickerSet: Set<string>,
  ): Promise<{
    facilityCompanies: GwmdCompany[];
    facilityEdges: GwmdRelationshipEdge[];
  }> {
    type FacilityInfo = {
      location: string;
      facilityType: "facility" | "infrastructure";
      mentionedByTickers: string[];
    };

    const facilityMap = new Map<string, FacilityInfo>();

    relationshipsBySource.forEach((rels, fromTicker) => {
      const fromCanonical = this.normalizeTicker(fromTicker);
      for (const rel of rels) {
        const processLocations = (
          locations: string[] | undefined,
          facilityType: "facility" | "infrastructure",
        ) => {
          for (const loc of locations ?? []) {
            const trimmed = loc.trim();
            if (!trimmed) continue;
            const normKey = trimmed
              .toLowerCase()
              .replace(/[^a-z0-9]/g, "")
              .slice(0, 20);
            if (!normKey) continue;
            const typePrefix = facilityType === "facility" ? "f_" : "infra_";
            const mapKey = typePrefix + normKey;
            const existing = facilityMap.get(mapKey);
            if (existing) {
              if (!existing.mentionedByTickers.includes(fromCanonical)) {
                existing.mentionedByTickers.push(fromCanonical);
              }
            } else {
              facilityMap.set(mapKey, {
                location: trimmed,
                facilityType,
                mentionedByTickers: [fromCanonical],
              });
            }
          }
        };
        processLocations(rel.facility_locations, "facility");
        processLocations(rel.logistics_nodes, "infrastructure");
      }
    });

    const facilityCompanies: GwmdCompany[] = [];
    const facilityEdges: GwmdRelationshipEdge[] = [];
    const facilityEntries = Array.from(facilityMap.entries()).slice(0, 30);

    await this.runWithConcurrency(
      facilityEntries,
      2,
      async ([mapKey, info]) => {
        const tickerPrefix = info.facilityType === "facility" ? "F_" : "INFRA_";
        const normPart = mapKey
          .replace(/^(f_|infra_)/, "")
          .slice(0, 12)
          .toUpperCase();
        const facilityTicker = tickerPrefix + normPart;
        if (existingTickerSet.has(facilityTicker)) return;

        try {
          const geo = await resolveCompanyGeo(info.location);
          if (!geo || !Number.isFinite(geo.lat) || !Number.isFinite(geo.lon))
            return;

          facilityCompanies.push({
            ticker: facilityTicker,
            name: info.location,
            hq_lat: geo.lat,
            hq_lon: geo.lon,
            hq_city: geo.city,
            hq_country: geo.country,
            industry:
              info.facilityType === "facility" ? "Facility" : "Infrastructure",
            geo_source: geo.source === "curated" ? "curated" : "nominatim",
            geo_confidence: geo.source === "curated" ? 0.95 : 0.78,
          });

          for (const fromTicker of info.mentionedByTickers) {
            const edgeKey = this.edgeSemanticKey(
              fromTicker,
              facilityTicker,
              "partner",
            );
            facilityEdges.push({
              id: edgeKey.replace(/\|/g, "-"),
              from_ticker: fromTicker,
              to_ticker: facilityTicker,
              relation_type: "partner",
              weight: 0.35,
              confidence: 0.5,
              evidence: `Supply chain ${info.facilityType} location: ${info.location}`,
              entity_type: "facility",
            });
          }
        } catch {
          // Ignore geocode errors for individual facility entries
        }
        await this.sleep(60);
      },
    );

    return { facilityCompanies, facilityEdges };
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
    relationshipsBySource: Map<string, NormalizedRelationship[]>,
  ) {
    const companyMap = new Map<
      string,
      {
        ticker: string;
        name: string;
        latitude: number | null;
        longitude: number | null;
        headquarters_city: string | null;
        headquarters_country: string | null;
      }
    >();

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
        if (!existing) {
          companyMap.set(key, next);
          return;
        }

        companyMap.set(key, {
          ...existing,
          ticker: next.ticker,
          name: existing.name || next.name,
          latitude: existing.latitude ?? next.latitude,
          longitude: existing.longitude ?? next.longitude,
          headquarters_city:
            existing.headquarters_city ?? next.headquarters_city,
          headquarters_country:
            existing.headquarters_country ?? next.headquarters_country,
        });
      });
    });

    return Array.from(companyMap.values());
  }

  private buildCoordinateRequests(
    primaryTicker: string,
    relationshipsBySource: Map<string, NormalizedRelationship[]>,
  ) {
    const seen = new Map<
      string,
      {
        ticker: string;
        name: string;
        headquarters_city: string | null;
        headquarters_country: string | null;
      }
    >();

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
    return companyList.filter(
      (item) => this.normalizeTicker(item.ticker) !== primaryKey,
    );
  }

  private pickExpansionSeedTickers(
    relationships: NormalizedRelationship[],
    visitedTickers: Set<string>,
    limit: number,
  ): string[] {
    const sorted = [...relationships].sort(
      (a, b) => (b.confidence ?? 0.5) - (a.confidence ?? 0.5),
    );
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const rel of sorted) {
      const key = rel.ticker.toUpperCase();
      if (seen.has(key)) continue;
      if (visitedTickers.has(key)) continue;
      seen.add(key);
      unique.push(this.normalizeTicker(rel.ticker));
      if (unique.length >= limit) break;
    }
    return unique;
  }

  private async expandRelationshipsByHop(
    primaryTicker: string,
    primaryRelationships: NormalizedRelationship[],
    relationshipsBySource: Map<string, NormalizedRelationship[]>,
    model: ResolvedAiModel,
    strict: boolean,
    maxHops: number,
  ): Promise<{ hop2SeedCount: number; expandedTickerCount: number }> {
    if (maxHops <= 1) {
      return { hop2SeedCount: 0, expandedTickerCount: 0 };
    }

    const visitedTickers = new Set<string>([
      this.normalizeTicker(primaryTicker),
    ]);
    let priorHopRelationships = primaryRelationships;
    let hop2SeedCount = 0;
    let expandedTickerCount = 0;

    for (let hop = 2; hop <= maxHops; hop += 1) {
      const seeds = this.pickExpansionSeedTickers(
        priorHopRelationships,
        visitedTickers,
        this.getSeedLimitForHop(hop),
      );

      if (hop === 2) {
        hop2SeedCount = seeds.length;
      }
      if (seeds.length === 0) {
        break;
      }

      await this.runWithConcurrency(
        seeds,
        this.expansionConcurrency,
        async (seed) => {
          visitedTickers.add(seed);
          try {
            const nextHopRelationships = await this.getRelationshipsForTicker(
              seed,
              model,
              strict,
              1,
            );
            relationshipsBySource.set(seed, nextHopRelationships);
            expandedTickerCount += 1;
          } catch (err) {
            console.warn(
              `[CompanyRelationshipService] Hop-${hop} expansion failed for ${seed}:`,
              err,
            );
          }
          await this.sleep(90);
        },
      );

      priorHopRelationships = seeds.flatMap(
        (seed) => relationshipsBySource.get(seed) ?? [],
      );
    }

    return { hop2SeedCount, expandedTickerCount };
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

  private mergeCoordinates(
    parsed: NormalizedRelationship[],
    updates: MissingCoordinate[],
  ): NormalizedRelationship[] {
    if (updates.length === 0) return parsed;
    const byTicker = new Map(
      updates.map((item) => [item.ticker.toUpperCase(), item]),
    );
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
        headquarters_country:
          update.headquarters_country ?? rel.headquarters_country,
      };
    });
  }

  private resolveModelConfig(
    input: AiModelSelection,
    fallbackModel: string,
  ): ResolvedAiModel {
    if (typeof input === "string") {
      return { provider: "ollama", model: input.trim() || fallbackModel };
    }

    if (input && typeof input === "object") {
      const provider = this.normalizeProvider(input.provider);
      const result: ResolvedAiModel = {
        provider,
        model: (input.model || fallbackModel).trim(),
      };
      if (input.temperature !== undefined)
        result.temperature = input.temperature;
      if (input.maxTokens !== undefined) result.maxTokens = input.maxTokens;
      return result;
    }

    return { provider: "ollama", model: fallbackModel };
  }

  private resolveSecondaryModelConfig(
    settings: Record<string, unknown>,
    fallbackModel: string,
  ): ResolvedAiModel | null {
    const raw = settings?.secondaryAiModel as
      | { provider?: string; model?: string }
      | undefined;
    if (!raw?.model) return null;
    const provider = this.normalizeProvider(raw.provider);
    return { provider, model: raw.model.trim() || fallbackModel };
  }

  private normalizeProvider(provider?: string): ResolvedAiModel["provider"] {
    const normalized = (provider || "ollama").toLowerCase();
    if (normalized === "openai") return "openai";
    if (normalized === "anthropic") return "anthropic";
    if (normalized === "gemini") return "gemini";
    if (normalized === "mistral") return "mistral";
    if (normalized === "groq") return "groq";
    if (normalized === "xai") return "xai";
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

  private hasCoordinates(value: {
    latitude: number | null;
    longitude: number | null;
  }): boolean {
    return (
      value.latitude !== null &&
      value.longitude !== null &&
      this.isValidCoordinate(value.latitude, value.longitude)
    );
  }

  private normalizeMissingCoordinate(
    item: z.infer<typeof MissingCoordinateSchema>,
  ): MissingCoordinate {
    const normalizedTicker = this.normalizeTicker(item.ticker);
    const latitude = typeof item.latitude === "number" ? item.latitude : null;
    const longitude =
      typeof item.longitude === "number" ? item.longitude : null;
    if (
      latitude !== null &&
      longitude !== null &&
      this.isValidCoordinate(latitude, longitude)
    ) {
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
      console.warn(
        `[CompanyRelationshipService] Invalid coordinate retry entry for ${item.ticker}:`,
        {
          latitude,
          longitude,
        },
      );
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

  private normalizeRelationship(
    rel: ParsedRelationship,
  ): NormalizedRelationship {
    const normalizedTicker = this.normalizeTicker(rel.ticker);
    const latitude = typeof rel.latitude === "number" ? rel.latitude : null;
    const longitude = typeof rel.longitude === "number" ? rel.longitude : null;
    const hasCoords =
      latitude !== null &&
      longitude !== null &&
      this.isValidCoordinate(latitude, longitude);

    if (!hasCoords) {
      if (latitude !== null || longitude !== null) {
        console.warn(
          `[CompanyRelationshipService] Invalid coordinates for ${rel.ticker}:`,
          {
            latitude,
            longitude,
          },
        );
      }
      return {
        ...rel,
        ticker: normalizedTicker,
        relation_type:
          rel.relation_type.toLowerCase() as NormalizedRelationship["relation_type"],
        source_type: rel.source_type?.toLowerCase() as
          | NormalizedRelationship["source_type"]
          | undefined,
        latitude: null,
        longitude: null,
        aliases: rel.aliases ?? [],
        operating_countries: rel.operating_countries ?? [],
        facility_locations: rel.facility_locations ?? [],
        logistics_nodes: rel.logistics_nodes ?? [],
        chokepoints: rel.chokepoints ?? [],
        exposure_regions: rel.exposure_regions ?? [],
        field_statuses: rel.field_statuses ?? {},
        headquarters_city: rel.headquarters_city ?? null,
        headquarters_country: rel.headquarters_country ?? null,
      } as NormalizedRelationship;
    }

    return {
      ...rel,
      ticker: normalizedTicker,
      relation_type:
        rel.relation_type.toLowerCase() as NormalizedRelationship["relation_type"],
      source_type: rel.source_type?.toLowerCase() as
        | NormalizedRelationship["source_type"]
        | undefined,
      latitude,
      longitude,
      aliases: rel.aliases ?? [],
      operating_countries: rel.operating_countries ?? [],
      facility_locations: rel.facility_locations ?? [],
      logistics_nodes: rel.logistics_nodes ?? [],
      chokepoints: rel.chokepoints ?? [],
      exposure_regions: rel.exposure_regions ?? [],
      field_statuses: rel.field_statuses ?? {},
      headquarters_city: rel.headquarters_city ?? null,
      headquarters_country: rel.headquarters_country ?? null,
    } as NormalizedRelationship;
  }

  private isValidCoordinate(latitude: number, longitude: number): boolean {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
    return (
      latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180
    );
  }

  private computeHypothesisRatio(
    edges: Array<{ confidence?: number }>,
  ): number {
    if (edges.length === 0) return 0;
    const hypothesisCount = edges.filter(
      (edge) => (edge.confidence ?? 0) < 0.7,
    ).length;
    return Number((hypothesisCount / edges.length).toFixed(4));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async runWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    task: (item: T, index: number) => Promise<R>,
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
  async repairMissingCoordinates(
    limit: number = 200,
  ): Promise<{ attempted: number; updated: number }> {
    const missing = gwmdMapRepo.getCompaniesMissingCoords(limit);
    if (missing.length === 0) return { attempted: 0, updated: 0 };

    const updates: Array<{
      ticker: string;
      name: string;
      hq_lat: number;
      hq_lon: number;
      hq_city?: string;
      hq_country?: string;
    }> = [];

    for (const company of missing) {
      try {
        const geo = await this.resolveGeoWithFallbacks({
          name: company.name,
          headquarters_city: company.hq_city ?? null,
          headquarters_country: company.hq_country ?? null,
        });
        if (!geo || !Number.isFinite(geo.lat) || !Number.isFinite(geo.lon)) {
          continue;
        }
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
        if (this.isTransientGeoError(err)) {
          console.warn(
            `[CompanyRelationshipService] Repair skipped for ${company.ticker} due to transient geocoder timeout`,
          );
        } else {
          console.warn(
            `[CompanyRelationshipService] Repair failed for ${company.ticker}:`,
            err,
          );
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (updates.length > 0) {
      gwmdMapRepo.addCompanies(updates);
    }

    return { attempted: missing.length, updated: updates.length };
  }
}

export const companyRelationshipService = new CompanyRelationshipService();

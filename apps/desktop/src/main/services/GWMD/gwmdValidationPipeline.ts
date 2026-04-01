import { z } from "zod";
import { getDb } from "../../persistence/db";
import { GraphEnrichmentRepository } from "../graphEnrichment/repository";
import { callCloudModel } from "../aiResearch/llm/cloudModels";
import type { CloudModelConfig } from "../aiResearch/llm/cloudModels";
import { canonicalEdgeId } from "./gwmdCandidateWriter";

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

type CandidateRow = {
  id: string;
  zone: "candidate" | "validation" | "production";
  validation_status:
    | "unvalidated"
    | "pending_validation"
    | "validated"
    | "contradicted"
    | "rejected";
  source_type: string;
  source_ref: string;
  source_title: string | null;
  source_url: string | null;
  ai_inferred: number;
  confidence_score: number;
  freshness_score: number;
  first_seen_at: string;
  last_seen_at: string;
  contradiction_flag: number;
  stale_flag: number;
  promotion_eligible: number;
  metadata_json: string | null;
};

const VerdictSchema = z.object({
  candidate_id: z.string(),
  verdict: z.enum([
    "validate",
    "reject",
    "contradict",
    "insufficient_evidence",
  ]),
  reason: z.string().min(3),
  confidence_adjustment: z
    .preprocess((value) => {
      if (value === null || value === undefined || value === "") return 0;
      const num = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(num)) return 0;
      return Math.max(-0.3, Math.min(0.2, num));
    }, z.number())
    .default(0),
  field_verdicts: z
    .record(
      z.string(),
      z.enum([
        "present",
        "unknown",
        "not_found",
        "not_applicable",
        "low_confidence_inference",
        "contradicted",
      ]),
    )
    .optional()
    .default({}),
});

const VerdictListSchema = z.array(VerdictSchema);

function safeJsonParse(input: string | null): Record<string, unknown> {
  if (!input) return {};
  try {
    const parsed = JSON.parse(input) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function stripCodeFence(input: string): string {
  const trimmed = input.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() ?? trimmed;
}

function parseVerdicts(input: string) {
  const parsed = JSON.parse(stripCodeFence(input)) as unknown;
  return VerdictListSchema.parse(parsed);
}

function normalizeTicker(value: string): string {
  return value.trim().toUpperCase();
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function resolveCloudConfig(model: ResolvedAiModel): CloudModelConfig {
  return {
    provider: model.provider,
    model: model.model,
    tier: "standard",
    temperature: model.temperature ?? 0.1,
    maxTokens: model.maxTokens ?? 1800,
  } as CloudModelConfig;
}

function mergeFieldVerdicts(
  metadata: Record<string, unknown>,
  fieldVerdicts: Record<string, string> | undefined,
  fallbackStatus?: "contradicted",
): Record<string, unknown> {
  const existingStatuses =
    (metadata.field_statuses as Record<string, unknown> | undefined) ?? {};
  const merged: Record<string, string> = {};

  Object.entries(existingStatuses).forEach(([field, status]) => {
    if (typeof status === "string" && status.trim().length > 0) {
      merged[field] = status;
    }
  });

  Object.entries(fieldVerdicts ?? {}).forEach(([field, status]) => {
    if (typeof status !== "string" || status.trim().length === 0) return;
    merged[field] = status;
  });

  if (fallbackStatus === "contradicted" && Object.keys(merged).length === 0) {
    merged.relation_type = "contradicted";
    merged.source_citation = "contradicted";
    merged.raw_evidence = "contradicted";
  }

  return {
    ...metadata,
    field_statuses: merged,
    validation: {
      ...((metadata.validation as Record<string, unknown> | undefined) ?? {}),
      field_verdicts: merged,
    },
  };
}

function loadEdgeRows(edgeIds: string[]): CandidateRow[] {
  if (edgeIds.length === 0) return [];
  const db = getDb();
  const placeholders = edgeIds.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT
         id, zone, validation_status, source_type, source_ref, source_title,
         source_url, ai_inferred, confidence_score, freshness_score,
         first_seen_at, last_seen_at, contradiction_flag, stale_flag,
         promotion_eligible, metadata_json
       FROM graph_enrichment_edge
       WHERE id IN (${placeholders})`,
    )
    .all(...edgeIds) as CandidateRow[];
}

function loadEntityRow(entityId: string): CandidateRow | null {
  const db = getDb();
  return (
    (db
      .prepare(
        `SELECT
           id, zone, validation_status, source_type, source_ref, source_title,
           source_url, ai_inferred, confidence_score, freshness_score,
           first_seen_at, last_seen_at, contradiction_flag, stale_flag,
           promotion_eligible, metadata_json
         FROM graph_enrichment_entity
         WHERE id = ?`,
      )
      .get(entityId) as CandidateRow | undefined) ?? null
  );
}

function buildValidationPrompt(candidateRows: CandidateRow[]): string {
  const payload = candidateRows.map((row) => {
    const metadata = safeJsonParse(row.metadata_json);
    return {
      candidate_id: row.id,
      relation_type:
        stringValue(metadata.gwmd_relation_type) ??
        stringValue(metadata.relation_type) ??
        "linked_to",
      source_ticker: stringValue(metadata.source_ticker) ?? "UNKNOWN",
      target_ticker: stringValue(metadata.target_ticker) ?? "UNKNOWN",
      source_type: stringValue(metadata.source_type) ?? row.source_type,
      source_citation:
        stringValue(metadata.source_citation) ?? row.source_title,
      evidence: stringValue(metadata.raw_evidence) ?? null,
      directness: stringValue(metadata.directness) ?? null,
      product_or_service:
        stringValue(
          (metadata.commercial_profile as Record<string, unknown> | undefined)
            ?.product_or_service,
        ) ?? null,
      dependency_summary:
        stringValue(
          (metadata.exposure as Record<string, unknown> | undefined)
            ?.dependency_summary,
        ) ?? null,
      logistics_mode:
        stringValue(
          (metadata.logistics as Record<string, unknown> | undefined)?.mode,
        ) ?? null,
      exposure_regions:
        ((metadata.exposure as Record<string, unknown> | undefined)?.regions as
          | unknown[]
          | undefined) ?? [],
      field_statuses:
        (metadata.field_statuses as Record<string, unknown> | undefined) ?? {},
      confidence: row.confidence_score,
    };
  });

  return `
You are the second-step validation model for GWMD relationship ingestion.

Review each candidate relationship. Challenge directionality, source quality, operational plausibility, and whether the evidence actually supports the stated relationship.

Return JSON only as an array:
[
  {
    "candidate_id": "...",
    "verdict": "validate|reject|contradict|insufficient_evidence",
    "reason": "short concrete reason",
    "confidence_adjustment": -0.2,
    "field_verdicts": {
      "operating_countries": "present|unknown|not_found|not_applicable|low_confidence_inference|contradicted",
      "facility_locations": "present|unknown|not_found|not_applicable|low_confidence_inference|contradicted",
      "logistics_mode": "present|unknown|not_found|not_applicable|low_confidence_inference|contradicted",
      "exposure_regions": "present|unknown|not_found|not_applicable|low_confidence_inference|contradicted"
    }
  }
]

Rules:
- validate: evidence plausibly supports the relationship
- reject: unsupported or too vague
- contradict: evidence suggests the relationship is wrong or reversed
- insufficient_evidence: maybe plausible, but not enough to promote
- prefer rejection over guessing
- use field_statuses to down-rank candidates that are mostly inferred or contradicted
- provide field_verdicts for fields that need correction or explicit contradiction

Candidates:
${JSON.stringify(payload, null, 2)}`;
}

function buildCanonicalEntityId(ticker: string): string {
  return `gwmd:company:${normalizeTicker(ticker)}`;
}

function promoteEntityIfNeeded(
  candidateEntityId: string,
  ticker: string,
  zone: "validation" | "production",
  validationStatus: "pending_validation" | "validated",
  reason: string,
) {
  const row = loadEntityRow(candidateEntityId);
  if (!row) return;
  const metadata = safeJsonParse(row.metadata_json);
  const canonicalName =
    stringValue(metadata.canonical_name) ?? normalizeTicker(ticker);
  const canonicalId = buildCanonicalEntityId(ticker);

  GraphEnrichmentRepository.upsertEntity({
    id: canonicalId,
    canonicalName,
    entityType: "company",
    zone,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    sourceTitle: row.source_title ?? undefined,
    sourceUrl: row.source_url ?? undefined,
    aiInferred: row.ai_inferred === 1,
    confidenceScore: row.confidence_score,
    freshnessScore: row.freshness_score,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    ttlDays: zone === "production" ? 90 : 30,
    validationStatus,
    validationMethod: "gwmd_validation_model",
    validatorType: "model",
    contradictionFlag: false,
    staleFlag: row.stale_flag === 1,
    promotionEligible: true,
    metadataJson: JSON.stringify({
      ...metadata,
      canonical_id: canonicalId,
      promoted_from_candidate_id: candidateEntityId,
      validation_reason: reason,
    }),
  });
  GraphEnrichmentRepository.upsertAlias(
    canonicalId,
    normalizeTicker(ticker),
    "ticker",
    "gwmd_validation",
  );
}

export async function validateGwmdCandidates(input: {
  rootTicker: string;
  model: ResolvedAiModel;
  candidateEdgeIds: string[];
  companyEntityIdsByTicker: Map<string, string>;
}): Promise<{
  promotedEdges: number;
  rejectedEdges: number;
  contradictedEdges: number;
}> {
  if (input.candidateEdgeIds.length === 0) {
    return { promotedEdges: 0, rejectedEdges: 0, contradictedEdges: 0 };
  }

  const edgeRows = loadEdgeRows(input.candidateEdgeIds);
  if (edgeRows.length === 0) {
    return { promotedEdges: 0, rejectedEdges: 0, contradictedEdges: 0 };
  }

  const response = await callCloudModel(
    resolveCloudConfig(input.model),
    "You validate GWMD candidates for a graph memory system. Return JSON only.",
    buildValidationPrompt(edgeRows),
  );
  const verdicts = parseVerdicts(response);
  const verdictById = new Map(
    verdicts.map((verdict) => [verdict.candidate_id, verdict]),
  );

  let promotedEdges = 0;
  let rejectedEdges = 0;
  let contradictedEdges = 0;

  edgeRows.forEach((row) => {
    const metadata = safeJsonParse(row.metadata_json);
    const verdict = verdictById.get(row.id);
    if (!verdict) return;

    const sourceTicker = normalizeTicker(
      stringValue(metadata.source_ticker) ?? "",
    );
    const targetTicker = normalizeTicker(
      stringValue(metadata.target_ticker) ?? "",
    );
    const relationType =
      stringValue(metadata.gwmd_relation_type) ?? "linked_to";
    const adjustedConfidence = Math.max(
      0,
      Math.min(1, row.confidence_score + verdict.confidence_adjustment),
    );

    if (verdict.verdict === "reject") {
      const metadataWithFieldVerdicts = mergeFieldVerdicts(
        metadata,
        verdict.field_verdicts,
      );
      GraphEnrichmentRepository.upsertEdge({
        id: row.id,
        fromEntityId: `gwmd:company:${sourceTicker}:candidate`,
        toEntityId: `gwmd:company:${targetTicker}:candidate`,
        relationType: "linked_to",
        zone: row.zone,
        sourceType: row.source_type,
        sourceRef: row.source_ref,
        sourceTitle: row.source_title ?? undefined,
        sourceUrl: row.source_url ?? undefined,
        aiInferred: row.ai_inferred === 1,
        confidenceScore: adjustedConfidence,
        freshnessScore: row.freshness_score,
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at,
        ttlDays: 14,
        validationStatus: "rejected",
        validationMethod: "gwmd_validation_model",
        validatorType: "model",
        contradictionFlag: false,
        staleFlag: row.stale_flag === 1,
        promotionEligible: false,
        metadataJson: JSON.stringify({
          ...metadataWithFieldVerdicts,
          validation_reason: verdict.reason,
          validation_confidence: adjustedConfidence,
        }),
      });
      GraphEnrichmentRepository.recordValidationEvent({
        targetType: "edge",
        targetId: row.id,
        eventType: "rejected",
        fromZone: row.zone,
        toZone: row.zone,
        validatorType: "model",
        validationMethod: "gwmd_validation_model",
        reason: verdict.reason,
      });
      rejectedEdges += 1;
      return;
    }

    if (verdict.verdict === "contradict") {
      const metadataWithFieldVerdicts = mergeFieldVerdicts(
        metadata,
        verdict.field_verdicts,
        "contradicted",
      );
      GraphEnrichmentRepository.upsertEdge({
        id: row.id,
        fromEntityId: `gwmd:company:${sourceTicker}:candidate`,
        toEntityId: `gwmd:company:${targetTicker}:candidate`,
        relationType: "linked_to",
        zone: row.zone,
        sourceType: row.source_type,
        sourceRef: row.source_ref,
        sourceTitle: row.source_title ?? undefined,
        sourceUrl: row.source_url ?? undefined,
        aiInferred: row.ai_inferred === 1,
        confidenceScore: adjustedConfidence,
        freshnessScore: row.freshness_score,
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at,
        ttlDays: 14,
        validationStatus: "contradicted",
        validationMethod: "gwmd_validation_model",
        validatorType: "model",
        contradictionFlag: true,
        staleFlag: row.stale_flag === 1,
        promotionEligible: false,
        metadataJson: JSON.stringify({
          ...metadataWithFieldVerdicts,
          validation_reason: verdict.reason,
          validation_confidence: adjustedConfidence,
        }),
      });
      GraphEnrichmentRepository.recordValidationEvent({
        targetType: "edge",
        targetId: row.id,
        eventType: "contradicted",
        fromZone: row.zone,
        toZone: row.zone,
        validatorType: "model",
        validationMethod: "gwmd_validation_model",
        reason: verdict.reason,
        contradictionFlag: true,
      });
      contradictedEdges += 1;
      return;
    }

    if (verdict.verdict === "insufficient_evidence") {
      const metadataWithFieldVerdicts = mergeFieldVerdicts(
        metadata,
        verdict.field_verdicts,
      );
      GraphEnrichmentRepository.upsertEdge({
        id: row.id,
        fromEntityId: `gwmd:company:${sourceTicker}:candidate`,
        toEntityId: `gwmd:company:${targetTicker}:candidate`,
        relationType: "linked_to",
        zone: row.zone,
        sourceType: row.source_type,
        sourceRef: row.source_ref,
        sourceTitle: row.source_title ?? undefined,
        sourceUrl: row.source_url ?? undefined,
        aiInferred: row.ai_inferred === 1,
        confidenceScore: adjustedConfidence,
        freshnessScore: row.freshness_score,
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at,
        ttlDays: 7,
        validationStatus: "unvalidated",
        validationMethod: "gwmd_validation_model",
        validatorType: "model",
        contradictionFlag: false,
        staleFlag: row.stale_flag === 1,
        promotionEligible: false,
        metadataJson: JSON.stringify({
          ...metadataWithFieldVerdicts,
          validation_reason: verdict.reason,
          validation_confidence: adjustedConfidence,
        }),
      });
      GraphEnrichmentRepository.recordValidationEvent({
        targetType: "edge",
        targetId: row.id,
        eventType: "validation_deferred",
        fromZone: row.zone,
        toZone: row.zone,
        validatorType: "model",
        validationMethod: "gwmd_validation_model",
        reason: verdict.reason,
      });
      return;
    }

    const targetZone = adjustedConfidence >= 0.75 ? "production" : "validation";
    const targetStatus =
      targetZone === "production" ? "validated" : "pending_validation";
    const canonicalId = canonicalEdgeId(
      sourceTicker,
      targetTicker,
      relationType,
    );
    const metadataWithFieldVerdicts = mergeFieldVerdicts(
      metadata,
      verdict.field_verdicts,
    );
    const sourceEntityId =
      input.companyEntityIdsByTicker.get(sourceTicker) ??
      buildCanonicalEntityId(sourceTicker);
    const targetEntityId =
      input.companyEntityIdsByTicker.get(targetTicker) ??
      buildCanonicalEntityId(targetTicker);

    GraphEnrichmentRepository.upsertEdge({
      id: canonicalId,
      fromEntityId: buildCanonicalEntityId(sourceTicker),
      toEntityId: buildCanonicalEntityId(targetTicker),
      relationType: "linked_to",
      zone: targetZone,
      sourceType: row.source_type,
      sourceRef: row.source_ref,
      sourceTitle: row.source_title ?? undefined,
      sourceUrl: row.source_url ?? undefined,
      aiInferred: row.ai_inferred === 1,
      confidenceScore: adjustedConfidence,
      freshnessScore: row.freshness_score,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      ttlDays: targetZone === "production" ? 90 : 30,
      validationStatus: targetStatus,
      validationMethod: "gwmd_validation_model",
      validatorType: "model",
      contradictionFlag: false,
      staleFlag: row.stale_flag === 1,
      promotionEligible: true,
      metadataJson: JSON.stringify({
        ...metadataWithFieldVerdicts,
        canonical_id: canonicalId,
        promoted_from_candidate_id: row.id,
        validation_reason: verdict.reason,
        validation_confidence: adjustedConfidence,
      }),
    });
    GraphEnrichmentRepository.upsertEdge({
      id: row.id,
      fromEntityId: sourceEntityId,
      toEntityId: targetEntityId,
      relationType: "linked_to",
      zone: row.zone,
      sourceType: row.source_type,
      sourceRef: row.source_ref,
      sourceTitle: row.source_title ?? undefined,
      sourceUrl: row.source_url ?? undefined,
      aiInferred: row.ai_inferred === 1,
      confidenceScore: adjustedConfidence,
      freshnessScore: row.freshness_score,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      ttlDays: 14,
      validationStatus: targetStatus,
      validationMethod: "gwmd_validation_model",
      validatorType: "model",
      contradictionFlag: false,
      staleFlag: row.stale_flag === 1,
      promotionEligible: true,
      metadataJson: JSON.stringify({
        ...metadataWithFieldVerdicts,
        canonical_id: canonicalId,
        validation_reason: verdict.reason,
        validation_confidence: adjustedConfidence,
      }),
    });
    GraphEnrichmentRepository.recordValidationEvent({
      targetType: "edge",
      targetId: canonicalId,
      eventType: "promoted",
      fromZone: row.zone,
      toZone: targetZone,
      validatorType: "model",
      validationMethod: "gwmd_validation_model",
      reason: verdict.reason,
    });

    promoteEntityIfNeeded(
      sourceEntityId,
      sourceTicker,
      targetZone,
      targetStatus,
      verdict.reason,
    );
    promoteEntityIfNeeded(
      targetEntityId,
      targetTicker,
      targetZone,
      targetStatus,
      verdict.reason,
    );

    promotedEdges += 1;
  });

  return { promotedEdges, rejectedEdges, contradictedEdges };
}

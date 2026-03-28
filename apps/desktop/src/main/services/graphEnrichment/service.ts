import crypto from "node:crypto";
import type { MindMapData } from "@tc/shared/supplyChain";
import {
  NotConnectedCloudGraphRepository,
  buildNotConnectedStatus,
} from "./cloud";
import { resolveGraphEnrichmentConfig } from "./config";
import { exportGraphEnrichmentSnapshot } from "./exporter";
import { GraphEnrichmentRepository } from "./repository";
import { clampScore } from "./validator";
import type {
  ExportResult,
  GraphEntityType,
  GraphRelationType,
  GraphZone,
  InspectorData,
  QueryUsageInput,
  SyncStatus,
  ValidationStatus,
} from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

function hashEdge(from: string, to: string, relation: string): string {
  return crypto
    .createHash("sha256")
    .update(`${from}|${to}|${relation}`)
    .digest("hex")
    .slice(0, 24);
}

function toEntityType(value: string | undefined): GraphEntityType {
  const normalized = (value ?? "").trim().toLowerCase();
  const known = new Set([
    "company",
    "supplier",
    "facility",
    "warehouse",
    "port",
    "airport",
    "regulator",
    "vessel",
    "route",
    "product_group",
    "region",
    "country",
    "chokepoint",
  ]);
  if (known.has(normalized)) {
    return normalized as GraphEntityType;
  }
  return "company";
}

function toRelationType(value: string | undefined): GraphRelationType {
  const normalized = (value ?? "").trim().toLowerCase();
  const known = new Set([
    "owns",
    "operates",
    "supplies",
    "ships_to",
    "depends_on",
    "located_at",
    "exposed_to",
    "near",
    "subsidiary_of",
    "linked_to",
    "candidate_link",
  ]);
  if (known.has(normalized)) {
    return normalized as GraphRelationType;
  }
  if (
    normalized === "supplier" ||
    normalized === "customer" ||
    normalized === "partner"
  ) {
    return "linked_to";
  }
  return "other";
}

function zoneFromEdgeStatus(
  edge: NonNullable<MindMapData["graph"]>["edges"][number],
): GraphZone {
  if (edge.evidenceStatus === "verified_official") return "production";
  if (edge.evidenceStatus === "hypothesis") return "candidate";
  return "validation";
}

function validationFromZone(zone: GraphZone): ValidationStatus {
  if (zone === "production") return "validated";
  if (zone === "validation") return "pending_validation";
  return "unvalidated";
}

export type IngestGraphInput = {
  mindMapData: MindMapData;
  queryUsage?: QueryUsageInput;
};

export type GraphEnrichmentService = {
  ingestMindMapResult: (
    input: IngestGraphInput,
  ) => Promise<{ entities: number; edges: number; evidence: number }>;
  recordUsage: (input: QueryUsageInput) => Promise<void>;
  runMaintenance: () => Promise<{
    staleEntities: number;
    staleEdges: number;
    queuedRevalidations: number;
  }>;
  getInspector: () => Promise<InspectorData>;
  exportSnapshot: () => Promise<ExportResult>;
  getSyncStatus: () => Promise<SyncStatus>;
  getCachedSubgraph: (
    query: string,
    hops?: number,
  ) => Promise<{
    entities: unknown[];
    edges: unknown[];
    staleDetected: number;
  }>;
};

export function createGraphEnrichmentService(): GraphEnrichmentService {
  const config = resolveGraphEnrichmentConfig();
  const cloudRepo = new NotConnectedCloudGraphRepository(config.cloudProvider);

  return {
    async ingestMindMapResult(input) {
      const graph = input.mindMapData.graph;
      if (!graph) {
        return { entities: 0, edges: 0, evidence: 0 };
      }

      const ingestAt = nowIso();
      let entities = 0;
      let edges = 0;
      let evidenceCount = 0;

      graph.nodes.forEach((node) => {
        const inferred = node.verified === false;
        const zone: GraphZone = inferred ? "candidate" : "production";
        const validationStatus = validationFromZone(zone);

        GraphEnrichmentRepository.upsertEntity({
          id: node.id,
          canonicalName: node.canonicalName || node.label || node.id,
          entityType: toEntityType(node.entityType),
          zone,
          sourceType: inferred ? "ai_extraction" : "official_graph",
          sourceRef: input.mindMapData.centerTicker,
          sourceTitle: input.mindMapData.centerName,
          sourceUrl: undefined,
          aiInferred: inferred,
          confidenceScore: clampScore(node.confidence ?? 0.5),
          freshnessScore: clampScore(node.lastUpdated ? 0.9 : 0.55),
          firstSeenAt: node.lastUpdated || ingestAt,
          lastSeenAt: ingestAt,
          ttlDays: inferred ? 14 : 45,
          validationStatus,
          validationMethod: inferred ? "model_inference" : "source_grounded",
          validatorType: inferred ? "model" : "rule",
          contradictionFlag: false,
          staleFlag: false,
          promotionEligible: !inferred,
          metadataJson: node.metadata
            ? JSON.stringify(node.metadata)
            : undefined,
        });

        if (node.tickers?.length) {
          node.tickers.forEach((ticker) => {
            GraphEnrichmentRepository.upsertAlias(
              node.id,
              ticker,
              "ticker",
              "mind_map",
            );
          });
        }

        GraphEnrichmentRepository.bumpUsage(
          "entity",
          node.id,
          input.queryUsage?.queryCluster,
          input.queryUsage?.cacheHit ? 100 : 0,
        );
        entities += 1;
      });

      graph.edges.forEach((edge) => {
        const zone = zoneFromEdgeStatus(edge);
        const validationStatus = validationFromZone(zone);
        const edgeId =
          edge.id || `gem_edge_${hashEdge(edge.from, edge.to, edge.kind)}`;

        GraphEnrichmentRepository.upsertEdge({
          id: edgeId,
          fromEntityId: edge.from,
          toEntityId: edge.to,
          relationType: toRelationType(edge.kind),
          zone,
          sourceType:
            edge.evidenceStatus === "verified_official"
              ? "official_graph"
              : "ai_extraction",
          sourceRef: edge.source || input.mindMapData.centerTicker,
          sourceTitle: edge.explanation,
          sourceUrl: undefined,
          aiInferred: edge.evidenceStatus !== "verified_official",
          confidenceScore: clampScore(edge.confidence ?? 0.5),
          freshnessScore: clampScore(
            edge.evidenceStatus === "verified_official" ? 0.9 : 0.5,
          ),
          firstSeenAt: ingestAt,
          lastSeenAt: ingestAt,
          ttlDays: edge.evidenceStatus === "verified_official" ? 30 : 10,
          validationStatus,
          validationMethod:
            edge.evidenceStatus === "verified_official"
              ? "evidence_attached"
              : "model_inference",
          validatorType:
            edge.evidenceStatus === "verified_official" ? "rule" : "model",
          contradictionFlag: false,
          staleFlag: false,
          promotionEligible: edge.evidenceStatus === "verified_official",
          metadataJson: JSON.stringify({
            weight: edge.weight,
            weightRange: edge.weightRange,
            explanation: edge.explanation,
            rawKind: edge.kind,
          }),
        });

        GraphEnrichmentRepository.bumpUsage(
          "edge",
          edgeId,
          input.queryUsage?.queryCluster,
          input.queryUsage?.cacheHit ? 100 : 0,
        );
        edges += 1;

        (edge.evidence ?? []).forEach((evidence) => {
          GraphEnrichmentRepository.upsertEvidence({
            evidenceId: evidence.evidenceId,
            sourceType: evidence.sourceKind,
            sourceReference: evidence.sourceUriOrRef,
            sourceTitle: `${input.mindMapData.centerTicker} evidence`,
            sourceUrl: evidence.sourceUriOrRef,
            sourceKey: evidence.docId,
            snippet: evidence.snippet,
            extractedSummary: evidence.snippet.slice(0, 300),
            extractionMethod: "document_extraction",
            extractedAt: ingestAt,
            fingerprintHash: evidence.retrievalHash,
            qualityScore:
              edge.evidenceStatus === "verified_official" ? 0.9 : 0.55,
          });
          GraphEnrichmentRepository.linkEvidence({
            targetType: "edge",
            targetId: edgeId,
            evidenceId: evidence.evidenceId,
          });
          evidenceCount += 1;
        });

        if (zone === "production") {
          GraphEnrichmentRepository.recordValidationEvent({
            targetType: "edge",
            targetId: edgeId,
            eventType: "promoted",
            fromZone: "validation",
            toZone: "production",
            validatorType: "rule",
            validationMethod: "official_evidence",
            reason: "Edge has official evidence status",
          });
        }
      });

      if (input.queryUsage) {
        GraphEnrichmentRepository.recordQueryUsage(input.queryUsage);
      }

      GraphEnrichmentRepository.queueSync("upsert_mindmap", {
        centerTicker: input.mindMapData.centerTicker,
        focalTickers: input.mindMapData.focalTickers,
        generatedAt: input.mindMapData.generatedAt,
        entities,
        edges,
      });

      return { entities, edges, evidence: evidenceCount };
    },

    async recordUsage(input) {
      GraphEnrichmentRepository.recordQueryUsage(input);
    },

    async runMaintenance() {
      const stale = GraphEnrichmentRepository.markExpiredAsStale();
      const inspector = GraphEnrichmentRepository.getInspectorData(100);
      let queued = 0;

      inspector.staleEntities.forEach((entity) => {
        GraphEnrichmentRepository.queueRevalidation({
          targetType: "entity",
          targetId: entity.id,
          reason: "Entity stale by TTL",
        });
        queued += 1;
      });

      inspector.lowConfidenceEdges.forEach((edge) => {
        GraphEnrichmentRepository.queueRevalidation({
          targetType: "edge",
          targetId: edge.id,
          reason: "Low confidence edge",
        });
        queued += 1;
      });

      return {
        staleEntities: stale.entities,
        staleEdges: stale.edges,
        queuedRevalidations: queued,
      };
    },

    async getInspector() {
      return GraphEnrichmentRepository.getInspectorData(30);
    },

    async exportSnapshot() {
      return exportGraphEnrichmentSnapshot();
    },

    async getSyncStatus() {
      const queueSize = GraphEnrichmentRepository.getPendingSyncQueueSize();
      return buildNotConnectedStatus({
        provider: cloudRepo.provider,
        mode: config.cloudSyncMode,
        queueSize,
        lastSyncAt: null,
      });
    },

    async getCachedSubgraph(query, hops = 1) {
      const matchedIds = GraphEnrichmentRepository.findEntityIdsByQuery(
        query,
        20,
      );
      const uniqueEntityIds = new Set<string>();
      const uniqueEdgeIds = new Set<string>();
      let staleDetected = 0;

      matchedIds.forEach((id) => {
        const subgraph = GraphEnrichmentRepository.getProductionNeighborhood(
          id,
          hops,
        );
        subgraph.entities.forEach((entity) => {
          uniqueEntityIds.add(entity.id);
          if (entity.stale_flag) staleDetected += 1;
        });
        subgraph.edges.forEach((edge) => {
          uniqueEdgeIds.add(edge.id);
          if (edge.stale_flag) staleDetected += 1;
        });
      });

      const final = GraphEnrichmentRepository.getProductionSubgraphByEntityIds(
        Array.from(uniqueEntityIds),
      );
      const entities = final.entities.filter((entity) =>
        uniqueEntityIds.has(entity.id),
      );
      const edges = final.edges.filter((edge) => uniqueEdgeIds.has(edge.id));

      GraphEnrichmentRepository.recordQueryUsage({
        queryText: query,
        queryCluster: "subgraph_lookup",
        cacheHit: entities.length > 0,
        staleItemsDetected: staleDetected,
        enrichmentDeltaCount: 0,
      });

      return {
        entities,
        edges,
        staleDetected,
      };
    },
  };
}

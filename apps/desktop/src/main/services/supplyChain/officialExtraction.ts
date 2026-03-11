import crypto from "node:crypto";
import { z } from "zod";
import type { OfficialSourceKind } from "@tc/shared/supplyChain";

const OllamaResponseSchema = z.object({
  response: z.string(),
});

const EvidenceSchema = z.object({
  source_kind: z.enum(["sec_filing", "annual_report", "ir_presentation", "press_release", "regulator_dataset", "other_official"]),
  source_ref: z.string(),
  doc_date: z.string(),
  location_pointer: z.string(),
  snippet: z.string(),
});

const ExtractedEdgeSchema = z.object({
  from_company: z.string(),
  from_ticker: z.string().optional(),
  to_company: z.string(),
  to_ticker: z.string().optional(),
  relation_type: z.string(),
  weight: z.number().optional(),
  weight_range: z.object({ min: z.number(), max: z.number() }).optional(),
  confidence: z.number(),
  evidence: z.array(EvidenceSchema).min(1),
});

const ExtractedPayloadSchema = z.object({
  edges: z.array(ExtractedEdgeSchema),
});

const VerificationSchema = z.object({
  edge_id: z.string(),
  verdict: z.enum(["ACCEPT", "REJECT"]),
  reason: z.string().optional(),
});

const VerificationPayloadSchema = z.object({
  results: z.array(VerificationSchema),
});

export interface ExtractionInput {
  docId: string;
  docDate: string;
  sourceKind: OfficialSourceKind;
  sourceRef: string;
  text: string;
}

export interface ExtractedEdge {
  edgeId: string;
  fromCompany: string;
  fromTicker?: string;
  toCompany: string;
  toTicker?: string;
  relationType: string;
  weight?: number;
  weightRange?: { min: number; max: number };
  confidence: number;
  evidence: Array<{
    sourceKind: OfficialSourceKind;
    sourceRef: string;
    docDate: string;
    locationPointer: string;
    snippet: string;
    retrievalHash: string;
    docId: string;
  }>;
}

function hashText(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function callOllama(model: string, system: string, prompt: string) {
  const { callCloudLlm } = await import('../llm/cloudLlmClient');
  void model; // model param retained for API compatibility
  const text = await callCloudLlm(system, prompt, { temperature: 0.1 });
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function buildParagraphIndex(text: string) {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return paragraphs.map((p, idx) => `p${idx + 1}: ${p}`).join("\n\n");
}

export async function extractEdgesFromDocument(model: string, input: ExtractionInput): Promise<ExtractedEdge[]> {
  const indexed = buildParagraphIndex(input.text.slice(0, 15000));
  const system = `You are an extractor that ONLY uses the provided document text.\n\nSTRICT RULES:\n- Output JSON ONLY.\n- Only include relationships explicitly stated in the text.\n- Provide evidence snippets that are exact substrings of the text.\n- Ensure from->to means to depends on from.\n- Use confidence 0..1.\n- If unsure, output an empty array.`;

  const prompt = `Document metadata:\n- doc_id: ${input.docId}\n- doc_date: ${input.docDate}\n- source_kind: ${input.sourceKind}\n- source_ref: ${input.sourceRef}\n\nDocument text (paragraph indexed):\n${indexed}\n\nReturn JSON:\n{\n  "edges": [\n    {\n      "from_company": "...",\n      "from_ticker": "...optional",\n      "to_company": "...",\n      "to_ticker": "...optional",\n      "relation_type": "supplier|customer|partner|license|litigation|financing|competitor|regulatory|other",\n      "weight": 0.0,\n      "weight_range": { "min": 0.0, "max": 1.0 },\n      "confidence": 0.0,\n      "evidence": [\n        {\n          "source_kind": "${input.sourceKind}",\n          "source_ref": "${input.sourceRef}",\n          "doc_date": "${input.docDate}",\n          "location_pointer": "p#",\n          "snippet": "exact quote"\n        }\n      ]\n    }\n  ]\n}`;

  const raw = await callOllama(model, system, prompt);
  const parsed = ExtractedPayloadSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) return [];

  return parsed.data.edges.map((edge, idx) => {
    const extracted: ExtractedEdge = {
      edgeId: `ext_${hashText(`${input.docId}|${idx}|${edge.from_company}|${edge.to_company}|${edge.relation_type}`).slice(0, 12)}`,
      fromCompany: edge.from_company,
      toCompany: edge.to_company,
      relationType: edge.relation_type,
      confidence: edge.confidence,
      evidence: edge.evidence.map((ev) => ({
        sourceKind: ev.source_kind,
        sourceRef: ev.source_ref,
        docDate: ev.doc_date,
        locationPointer: ev.location_pointer,
        snippet: ev.snippet,
        retrievalHash: hashText(ev.snippet),
        docId: input.docId,
      })),
    };
    if (edge.from_ticker) extracted.fromTicker = edge.from_ticker;
    if (edge.to_ticker) extracted.toTicker = edge.to_ticker;
    if (edge.weight !== undefined) extracted.weight = edge.weight;
    if (edge.weight_range) extracted.weightRange = edge.weight_range;
    return extracted;
  });
}

export async function verifyEdgesForDocument(model: string, input: ExtractionInput, edges: ExtractedEdge[]) {
  if (edges.length === 0) return [] as Array<{ edgeId: string; verdict: "ACCEPT" | "REJECT"; reason?: string }>;
  const indexed = buildParagraphIndex(input.text.slice(0, 15000));
  const system = `You are a verifier. Only accept edges supported by the provided text. Output JSON only.`;
  const prompt = `Document metadata:\n- doc_id: ${input.docId}\n- doc_date: ${input.docDate}\n\nDocument text (paragraph indexed):\n${indexed}\n\nEdges to verify (JSON):\n${JSON.stringify(edges, null, 2)}\n\nReturn JSON:\n{\n  "results": [\n    { "edge_id": "...", "verdict": "ACCEPT|REJECT", "reason": "...optional" }\n  ]\n}`;

  const raw = await callOllama(model, system, prompt);
  const parsed = VerificationPayloadSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) return edges.map((edge) => ({ edgeId: edge.edgeId, verdict: "REJECT", reason: "invalid verifier output" }));

  return parsed.data.results.map((result) => ({
    edgeId: result.edge_id,
    verdict: result.verdict,
    reason: result.reason,
  }));
}

export function heuristicVerify(text: string, edge: ExtractedEdge) {
  const snippetOk = edge.evidence.every((ev) => text.includes(ev.snippet));
  const fromOk = text.toLowerCase().includes(edge.fromCompany.toLowerCase());
  const toOk = text.toLowerCase().includes(edge.toCompany.toLowerCase());
  return snippetOk && fromOk && toOk;
}

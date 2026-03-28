import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type {
  EdgarAiAnnotation,
  EdgarDerivedRecord,
  EdgarDeltaRecord,
  EdgarEntityMention,
  EdgarFilingRecord,
  EdgarFormType,
  EdgarIngestFiling,
  EdgarMaterialityScore,
  EdgarParsedPayload,
  EdgarRelevanceScore,
  EdgarRoutingDecision,
  EdgarSignalRecord,
  EdgarTimeHorizon,
  EdgarVaultInspectionRecord,
} from "@tc/shared";
import type { AppEnv } from "../../config.js";
import { createLogger } from "../../logger.js";

const logger = createLogger("edgarIntel");

const PARSER_VERSION = "edgar-parser-v2";
const SCORE_VERSION = "edgar-score-v2";
const MATERIALITY_VERSION = "edgar-materiality-v1";
const DELTA_VERSION = "edgar-delta-v1";
const ROUTING_VERSION = "edgar-routing-v1";
const AI_MODEL = "heuristic-edgar-v1";
const AI_PROMPT_VERSION = "edgar-ai-pass-v2";
const AI_PUBLISH_CONFIDENCE_THRESHOLD = 0.7;
const GLOBAL_SCOPE = "global";

const SUPPORTED_FORMS = new Set<EdgarFormType>(["8-K", "10-K", "10-Q", "4"]);

type EdgarWatcherConfig = {
  ciks: string[];
  forms: EdgarFormType[];
  intervalSec: number;
  perCikLimit: number;
};

type EdgarWatcherStatus = {
  running: boolean;
  scopeId: string;
  config: EdgarWatcherConfig | null;
  lastRunAt?: string;
  lastRunStatus?: "ok" | "error";
  lastRunMessage?: string;
};

type ListFilters = {
  cik?: string;
  ticker?: string;
  formType?: string;
  fromDate?: string;
  toDate?: string;
  minScore?: number;
  limit?: number;
};

type RunWatcherOnceInput = {
  ciks: string[];
  forms?: EdgarFormType[];
  perCikLimit?: number;
};

type ReprocessInput = {
  filingIds?: string[];
  cik?: string;
  formType?: EdgarFormType;
  limit?: number;
};

type PreviousFilingContext = {
  filing_id: string;
  raw_content: string;
  parsed_payload: EdgarParsedPayload | null;
  entity_names: string[];
};

function normalizeFormType(value: string): EdgarFormType | null {
  const normalized = value.trim().toUpperCase().replace("FORM ", "");
  if (normalized === "8-K" || normalized === "10-K" || normalized === "10-Q") {
    return normalized;
  }
  if (normalized === "4") {
    return "4";
  }
  return null;
}

function normalizeCik(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.padStart(10, "0");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function scoreClamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function confidenceClamp(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}

function firstMatch(raw: string, pattern: RegExp): string {
  const found = raw.match(pattern);
  return found ? found[0].trim() : "";
}

function excerpt(raw: string, maxChars = 420): string {
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars)}...`;
}

function extractSectionByAnchors(
  raw: string,
  startAnchors: string[],
  endAnchors: string[],
): string {
  const lower = raw.toLowerCase();
  let start = -1;
  for (const anchor of startAnchors) {
    const index = lower.indexOf(anchor.toLowerCase());
    if (index >= 0 && (start < 0 || index < start)) {
      start = index;
    }
  }
  if (start < 0) {
    return "";
  }

  let end = raw.length;
  const tail = lower.slice(start + 1);
  for (const anchor of endAnchors) {
    const tailIndex = tail.indexOf(anchor.toLowerCase());
    if (tailIndex >= 0) {
      const abs = start + 1 + tailIndex;
      if (abs > start && abs < end) {
        end = abs;
      }
    }
  }

  return raw.slice(start, end).trim();
}

function tokenize(raw: string): Set<string> {
  const tokens = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);
  return new Set(tokens);
}

function jaccardDistance(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) {
    return 0;
  }
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) {
      intersection += 1;
    }
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? 1 - intersection / union : 0;
}

function keywordHits(raw: string, keywords: string[]): string[] {
  const lower = raw.toLowerCase();
  return keywords.filter((keyword) => lower.includes(keyword.toLowerCase()));
}

function detectImplicitSignals(rawContent: string): EdgarDerivedRecord[] {
  const signals: Array<{
    record_type: EdgarDerivedRecord["record_type"];
    title: string;
    keywords: string[];
    category: string;
  }> = [
    {
      record_type: "management_change",
      title: "Management change signal",
      keywords: ["appointed", "resigned", "chief executive", "cfo", "board"],
      category: "management",
    },
    {
      record_type: "financing_event",
      title: "Financing event signal",
      keywords: [
        "credit facility",
        "debt",
        "notes",
        "refinancing",
        "liquidity",
      ],
      category: "finance",
    },
    {
      record_type: "legal_risk",
      title: "Legal risk signal",
      keywords: [
        "litigation",
        "investigation",
        "settlement",
        "lawsuit",
        "subpoena",
      ],
      category: "legal",
    },
    {
      record_type: "credit_deterioration",
      title: "Credit deterioration signal",
      keywords: [
        "impairment",
        "default",
        "covenant",
        "going concern",
        "downgrade",
      ],
      category: "credit",
    },
    {
      record_type: "supplier_dependency",
      title: "Supplier dependency signal",
      keywords: [
        "single source",
        "sole supplier",
        "supply chain",
        "vendor",
        "dependency",
      ],
      category: "supply-chain",
    },
    {
      record_type: "macro_signal",
      title: "Macro stress signal",
      keywords: [
        "consumer demand",
        "consumer spending",
        "inflation",
        "unemployment",
        "delinquency",
      ],
      category: "macro",
    },
  ];

  const detected: EdgarDerivedRecord[] = [];
  for (const signal of signals) {
    const hits = keywordHits(rawContent, signal.keywords);
    if (!hits.length) {
      continue;
    }
    detected.push({
      record_type: signal.record_type,
      title: signal.title,
      value: {
        category: signal.category,
        keyword_hits: hits,
      },
      confidence: confidenceClamp(Math.min(0.95, 0.35 + hits.length * 0.12)),
      provenance: {
        section: signal.category,
        snippet: excerpt(rawContent),
      },
    });
  }
  return detected;
}

function extractEntityMentions(rawContent: string): EdgarEntityMention[] {
  const entityPattern =
    /\b([A-Z][A-Za-z0-9&.-]+(?:\s+[A-Z][A-Za-z0-9&.-]+){0,4})\b/g;
  const relationshipHints = [
    "supplier",
    "customer",
    "dependency",
    "subsidiary",
    "partner",
    "joint venture",
    "facility",
    "region",
    "country",
  ];

  const mentions = new Map<string, EdgarEntityMention>();
  for (const match of rawContent.matchAll(entityPattern)) {
    const name = (match[1] ?? "").trim();
    if (!name || name.length < 4 || name.length > 70) {
      continue;
    }
    if (/^item\s+\d/i.test(name)) {
      continue;
    }

    const context = excerpt(match[0] ?? "", 140);
    const lowerContext = context.toLowerCase();
    const relationHint = relationshipHints.find((hint) =>
      lowerContext.includes(hint),
    );

    const entityType = /\b(inc|corp|llc|ltd|plc|co)\.?$/i.test(name)
      ? "organization"
      : "named_entity";
    const key = `${name.toLowerCase()}|${entityType}|${relationHint ?? ""}`;
    if (!mentions.has(key)) {
      mentions.set(key, {
        entity_name: name,
        entity_type: entityType,
        ...(relationHint
          ? { relationship_type: relationHint.replace(" ", "_") }
          : {}),
        mention_context: context,
        confidence: relationHint ? 0.72 : 0.58,
        provenance: {
          extraction: "regex_v1",
        },
      });
    }
  }

  return [...mentions.values()].slice(0, 80);
}

function parseEightK(rawContent: string): EdgarParsedPayload {
  const itemRegex = /item\s+([1-9]\.[0-9]{2})/gi;
  const items = new Set<string>();
  for (const match of rawContent.matchAll(itemRegex)) {
    const value = match[1];
    if (value) {
      items.add(value);
    }
  }

  const derived: EdgarDerivedRecord[] = [...items].map((item) => ({
    record_type: "event_disclosure",
    title: `8-K Item ${item} disclosure`,
    value: {
      item,
      materiality_hint:
        item === "2.02" || item === "2.06" || item.startsWith("5.")
          ? "high"
          : "medium",
    },
    provenance: {
      section: `item-${item}`,
      snippet: excerpt(rawContent),
    },
  }));

  return {
    form_type: "8-K",
    parser_version: PARSER_VERSION,
    sections: {
      filing_excerpt: excerpt(rawContent, 1500),
    },
    derived_records: derived,
  };
}

function parseFormFour(rawContent: string): EdgarParsedPayload {
  const transactionRegex =
    /\b([A-Z][a-z]{2}\.?\s+\d{1,2},\s+\d{4})\b.{0,120}?\b([PS])\b.{0,120}?\b(\d[\d,]*)\b/g;
  const transactions: EdgarDerivedRecord[] = [];
  for (const match of rawContent.matchAll(transactionRegex)) {
    const date = match[1] ?? "";
    const code = match[2] ?? "";
    const shares = Number((match[3] ?? "0").replace(/,/g, ""));
    transactions.push({
      record_type: "insider_transaction",
      title: `Form 4 ${code === "P" ? "purchase" : "sale"} transaction`,
      value: {
        date,
        transaction_code: code,
        shares: Number.isFinite(shares) ? shares : undefined,
      },
      provenance: {
        section: "table-i",
        snippet: excerpt(match[0] ?? "", 240),
      },
    });
  }

  return {
    form_type: "4",
    parser_version: PARSER_VERSION,
    sections: {
      filing_excerpt: excerpt(rawContent, 1500),
    },
    derived_records: transactions,
  };
}

function parseTenKOrTenQ(
  formType: EdgarFormType,
  rawContent: string,
): EdgarParsedPayload {
  const business = extractSectionByAnchors(
    rawContent,
    ["item 1", "item i", "business"],
    ["item 1a", "item ii", "risk factors"],
  );

  const risks = extractSectionByAnchors(
    rawContent,
    ["item 1a", "risk factors"],
    ["item 1b", "item 2", "item 7", "item 2."],
  );

  const financial =
    formType === "10-K"
      ? extractSectionByAnchors(
          rawContent,
          ["item 7", "management's discussion", "management discussion"],
          ["item 7a", "item 8"],
        )
      : extractSectionByAnchors(
          rawContent,
          ["item 2", "management's discussion", "management discussion"],
          ["item 3", "item 4"],
        );

  const derived: EdgarDerivedRecord[] = [];
  if (business) {
    derived.push({
      record_type: "business_intelligence",
      title: `${formType} business highlights`,
      value: {
        key_sentence: excerpt(firstMatch(business, /[^.]+\./), 200),
      },
      provenance: {
        section: "business",
        snippet: excerpt(business),
      },
    });
  }
  if (risks) {
    derived.push({
      record_type: "risk_intelligence",
      title: `${formType} risk factor signal`,
      value: {
        key_sentence: excerpt(firstMatch(risks, /[^.]+\./), 200),
      },
      provenance: {
        section: "risk-factors",
        snippet: excerpt(risks),
      },
    });
  }
  if (financial) {
    derived.push({
      record_type: "financial_intelligence",
      title: `${formType} management discussion signal`,
      value: {
        key_sentence: excerpt(firstMatch(financial, /[^.]+\./), 200),
      },
      provenance: {
        section: "mda",
        snippet: excerpt(financial),
      },
    });
  }

  return {
    form_type: formType,
    parser_version: PARSER_VERSION,
    sections: {
      business: excerpt(business, 2400),
      risk_factors: excerpt(risks, 2400),
      management_discussion: excerpt(financial, 2400),
    },
    derived_records: derived,
  };
}

function parseFiling(input: EdgarIngestFiling): EdgarParsedPayload {
  const base =
    input.form_type === "8-K"
      ? parseEightK(input.raw_content)
      : input.form_type === "4"
        ? parseFormFour(input.raw_content)
        : parseTenKOrTenQ(input.form_type, input.raw_content);

  const implicitSignals = detectImplicitSignals(input.raw_content);
  return {
    ...base,
    derived_records: [...base.derived_records, ...implicitSignals],
  };
}

function buildSignalRecords(parsed: EdgarParsedPayload): EdgarSignalRecord[] {
  return parsed.derived_records.map((record) => {
    const implicitTypes = new Set([
      "management_change",
      "financing_event",
      "legal_risk",
      "credit_deterioration",
      "supplier_dependency",
      "macro_signal",
    ]);
    const signalCategory = implicitTypes.has(record.record_type)
      ? "implicit"
      : "explicit";
    return {
      parser_version: parsed.parser_version,
      signal_type: record.record_type,
      signal_category: signalCategory,
      title: record.title,
      confidence: confidenceClamp(record.confidence ?? 0.7),
      signal_payload: record.value,
      provenance: {
        ...(record.provenance.section
          ? { section: record.provenance.section }
          : {}),
        ...(record.provenance.snippet
          ? { snippet: record.provenance.snippet }
          : {}),
      },
    };
  });
}

function buildDelta(
  current: EdgarIngestFiling,
  parsed: EdgarParsedPayload,
  currentMentions: EdgarEntityMention[],
  previous: PreviousFilingContext | null,
): EdgarDeltaRecord {
  const currentWords = tokenize(current.raw_content);
  const previousWords = tokenize(previous?.raw_content ?? "");
  const added = [...currentWords].filter((word) => !previousWords.has(word));
  const removed = [...previousWords].filter((word) => !currentWords.has(word));

  const currentRisk = tokenize(parsed.sections.risk_factors ?? "");
  const previousRisk = tokenize(
    previous?.parsed_payload?.sections?.risk_factors ?? "",
  );
  const introducedRisk = [...currentRisk].filter(
    (word) => !previousRisk.has(word),
  );
  const removedRisk = [...previousRisk].filter(
    (word) => !currentRisk.has(word),
  );

  const toneNegativeTerms = [
    "uncertain",
    "adverse",
    "pressure",
    "decline",
    "loss",
    "weakness",
  ];
  const tonePositiveTerms = [
    "improved",
    "growth",
    "strength",
    "resilient",
    "opportunity",
    "expansion",
  ];

  const currentText = current.raw_content.toLowerCase();
  const previousText = (previous?.raw_content ?? "").toLowerCase();
  const currentNeg = toneNegativeTerms.reduce(
    (sum, term) =>
      sum + (currentText.match(new RegExp(term, "g"))?.length ?? 0),
    0,
  );
  const previousNeg = toneNegativeTerms.reduce(
    (sum, term) =>
      sum + (previousText.match(new RegExp(term, "g"))?.length ?? 0),
    0,
  );
  const currentPos = tonePositiveTerms.reduce(
    (sum, term) =>
      sum + (currentText.match(new RegExp(term, "g"))?.length ?? 0),
    0,
  );
  const previousPos = tonePositiveTerms.reduce(
    (sum, term) =>
      sum + (previousText.match(new RegExp(term, "g"))?.length ?? 0),
    0,
  );

  const previousMentions = new Set(previous?.entity_names ?? []);
  const currentMentionNames = new Set(
    currentMentions.map((mention) => mention.entity_name),
  );
  const newEntities = [...currentMentionNames].filter(
    (name) => !previousMentions.has(name),
  );
  const removedEntities = [...previousMentions].filter(
    (name) => !currentMentionNames.has(name),
  );

  return {
    delta_version: DELTA_VERSION,
    ...(previous ? { previous_filing_id: previous.filing_id } : {}),
    language_diff: {
      jaccard_distance: Number(
        jaccardDistance(currentWords, previousWords).toFixed(4),
      ),
      added_terms: added.slice(0, 80),
      removed_terms: removed.slice(0, 80),
    },
    risk_factor_diff: {
      introduced_terms: introducedRisk.slice(0, 60),
      removed_terms: removedRisk.slice(0, 60),
      change_intensity: Number(
        jaccardDistance(currentRisk, previousRisk).toFixed(4),
      ),
    },
    tone_diff: {
      negative_delta: currentNeg - previousNeg,
      positive_delta: currentPos - previousPos,
      tone_direction:
        currentNeg - previousNeg > 2
          ? "more_negative"
          : currentPos - previousPos > 2
            ? "more_positive"
            : "stable",
    },
    financial_direction_diff: {
      mda_change: Number(
        jaccardDistance(
          tokenize(parsed.sections.management_discussion ?? ""),
          tokenize(
            previous?.parsed_payload?.sections?.management_discussion ?? "",
          ),
        ).toFixed(4),
      ),
      inferred_direction:
        currentPos - currentNeg >= 3
          ? "improving"
          : currentNeg - currentPos >= 3
            ? "deteriorating"
            : "mixed",
    },
    entity_relationship_diff: {
      newly_mentioned_entities: newEntities.slice(0, 80),
      removed_entities: removedEntities.slice(0, 80),
      net_new_entities: newEntities.length - removedEntities.length,
    },
  };
}

function deriveTimeHorizon(
  formType: EdgarFormType,
  overall: number,
): EdgarTimeHorizon {
  if (formType === "8-K" || formType === "4") {
    return "immediate";
  }
  if (overall >= 72) {
    return "medium_term";
  }
  return "long_term";
}

function buildMateriality(
  filing: EdgarIngestFiling,
  parsed: EdgarParsedPayload,
  delta: EdgarDeltaRecord,
): EdgarMaterialityScore {
  const formWeight =
    filing.form_type === "8-K"
      ? 90
      : filing.form_type === "10-K"
        ? 80
        : filing.form_type === "10-Q"
          ? 72
          : 64;
  const companyImportance = filing.ticker ? 75 : 55;
  const detectedEvents = scoreClamp(
    Math.min(100, parsed.derived_records.length * 13 + 20),
  );
  const unusualLanguage = scoreClamp(
    35 +
      Number(
        ((delta.language_diff as { jaccard_distance?: number })
          .jaccard_distance ?? 0) * 55,
      ),
  );
  const historicalDeviation = scoreClamp(
    40 +
      Number(
        ((delta.risk_factor_diff as { change_intensity?: number })
          .change_intensity ?? 0) * 50,
      ),
  );

  const overall = scoreClamp(
    formWeight * 0.26 +
      companyImportance * 0.2 +
      detectedEvents * 0.24 +
      unusualLanguage * 0.16 +
      historicalDeviation * 0.14,
  );

  return {
    scoring_version: MATERIALITY_VERSION,
    overall_score: overall,
    form_weight_score: formWeight,
    company_importance_score: companyImportance,
    detected_event_score: detectedEvents,
    unusual_language_score: unusualLanguage,
    historical_deviation_score: historicalDeviation,
    time_horizon: deriveTimeHorizon(filing.form_type, overall),
    score_breakdown: {
      weighted_components: {
        form_weight: 0.26,
        company_importance: 0.2,
        detected_events: 0.24,
        unusual_language: 0.16,
        historical_deviation: 0.14,
      },
      form_type: filing.form_type,
      derived_record_count: parsed.derived_records.length,
    },
  };
}

function buildRoutingDecision(
  materiality: EdgarMaterialityScore,
  delta: EdgarDeltaRecord,
  mentions: EdgarEntityMention[],
): EdgarRoutingDecision {
  const relationshipIntroductions = Number(
    (delta.entity_relationship_diff as { net_new_entities?: number })
      .net_new_entities ?? 0,
  );
  const routeFlow =
    materiality.overall_score >= 72 || materiality.time_horizon === "immediate";
  const routeIntelligence =
    materiality.overall_score >= 55 ||
    materiality.historical_deviation_score >= 60;
  const routeGwmd =
    relationshipIntroductions > 0 ||
    mentions.some((mention) =>
      ["supplier", "customer", "dependency"].includes(
        mention.relationship_type ?? "",
      ),
    );

  return {
    routing_version: ROUTING_VERSION,
    route_flow: routeFlow,
    route_intelligence: routeIntelligence,
    route_gwmd: routeGwmd,
    route_priority: scoreClamp(
      materiality.overall_score * 0.7 +
        (routeFlow ? 12 : 0) +
        (routeGwmd ? 10 : 0),
    ),
    source_layers: {
      raw_source: "active",
      structured_intelligence: PARSER_VERSION,
      interpretation: AI_PROMPT_VERSION,
    },
    route_reasoning: [
      `materiality=${materiality.overall_score}`,
      `horizon=${materiality.time_horizon}`,
      `net_new_entities=${relationshipIntroductions}`,
      `flow=${routeFlow}`,
      `intelligence=${routeIntelligence}`,
      `gwmd=${routeGwmd}`,
    ],
  };
}

function buildRelevance(
  filing: EdgarIngestFiling,
  parsed: EdgarParsedPayload,
): EdgarRelevanceScore {
  const baseImpact =
    filing.form_type === "8-K"
      ? 82
      : filing.form_type === "4"
        ? 58
        : filing.form_type === "10-Q"
          ? 68
          : 74;

  const eventDensity = parsed.derived_records.length;
  const urgency =
    filing.form_type === "8-K" ? 92 : filing.form_type === "4" ? 72 : 64;
  const novelty = scoreClamp(40 + eventDensity * 12);
  const linkage = scoreClamp(
    (filing.ticker ? 65 : 40) +
      (filing.company_name ? 20 : 0) +
      eventDensity * 4,
  );
  const marketImpact = scoreClamp(baseImpact + Math.min(12, eventDensity * 4));
  const overall = scoreClamp(
    marketImpact * 0.38 + urgency * 0.25 + novelty * 0.2 + linkage * 0.17,
  );

  const rationale = [
    `form_type=${filing.form_type}`,
    `derived_records=${eventDensity}`,
    filing.ticker ? `ticker_present=${filing.ticker}` : "ticker_present=false",
  ];

  return {
    score_version: SCORE_VERSION,
    overall,
    market_impact: marketImpact,
    urgency,
    novelty,
    entity_linkage_strength: linkage,
    rationale,
  };
}

function buildAiSecondPass(
  filing: EdgarIngestFiling,
  parsed: EdgarParsedPayload,
  score: EdgarRelevanceScore,
): EdgarAiAnnotation {
  const tags = new Set<string>();
  tags.add(filing.form_type.toLowerCase());
  for (const record of parsed.derived_records) {
    tags.add(record.record_type);
  }
  if (score.market_impact >= 75) {
    tags.add("high-impact");
  }
  if (score.urgency >= 80) {
    tags.add("time-sensitive");
  }

  const bullets = parsed.derived_records
    .slice(0, 4)
    .map(
      (record) =>
        `${record.title}: ${record.provenance.snippet ?? "no snippet"}`,
    );

  const confidence = confidenceClamp(
    0.45 +
      score.overall / 200 +
      Math.min(0.2, parsed.derived_records.length / 20),
  );

  return {
    model: AI_MODEL,
    prompt_version: AI_PROMPT_VERSION,
    summary: `${filing.form_type} filing for ${filing.company_name} scored ${score.overall}/100 relevance with ${parsed.derived_records.length} structured intelligence record(s).`,
    importance_assessment:
      score.overall >= 75
        ? "High priority filing likely to influence near-term terminal positioning."
        : score.overall >= 55
          ? "Medium priority filing with monitor-worthy changes."
          : "Lower priority filing retained for evidence and cross-linking.",
    thematic_tags: [...tags],
    terminal_intelligence: {
      headline: `${filing.company_name} ${filing.form_type} filing (${score.overall}/100)`,
      bullets,
      watch_items: [
        "Track subsequent filing amendments and related disclosures.",
        "Cross-link with company supply-chain and exposure context.",
      ],
    },
    confidence,
  };
}

function normalizeScope(scopeId?: string): string {
  const raw = (scopeId ?? "").trim();
  return raw || GLOBAL_SCOPE;
}

async function fetchSecJson<T>(url: string, userAgent: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": userAgent,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`sec_http_${response.status}`);
  }
  return (await response.json()) as T;
}

async function fetchSecText(url: string, userAgent: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": userAgent,
      Accept: "text/html, text/plain, */*",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`sec_text_http_${response.status}`);
  }
  return response.text();
}

export function createEdgarIntelService(pool: Pool | null, env: AppEnv) {
  let watcherTimer: NodeJS.Timeout | null = null;
  let watcherStatus: EdgarWatcherStatus = {
    running: false,
    scopeId: GLOBAL_SCOPE,
    config: null,
  };

  const ensurePool = () => {
    if (!pool) {
      throw new Error("database_unavailable");
    }
    return pool;
  };

  const fetchPreviousFilingContext = async (
    scope: string,
    filing: EdgarIngestFiling,
    currentFilingId: string,
  ): Promise<PreviousFilingContext | null> => {
    const db = ensurePool();
    const result = await db.query<{
      filing_id: string;
      raw_content: string;
      parsed_payload: EdgarParsedPayload | null;
      entity_names: string[];
    }>(
      `SELECT
         fr.filing_id,
         fr.raw_content,
         fp.parsed_payload,
         COALESCE(mentions.entity_names, ARRAY[]::text[]) AS entity_names
       FROM edgar_filing_raw fr
       LEFT JOIN LATERAL (
         SELECT parsed_payload
         FROM edgar_filing_parsed p
         WHERE p.scope_id = fr.scope_id AND p.filing_id = fr.filing_id
         ORDER BY p.updated_at DESC
         LIMIT 1
       ) fp ON true
       LEFT JOIN LATERAL (
         SELECT ARRAY_AGG(entity_name) AS entity_names
         FROM edgar_filing_entity_mentions m
         WHERE m.scope_id = fr.scope_id AND m.filing_id = fr.filing_id
       ) mentions ON true
       WHERE fr.scope_id = $1
         AND fr.cik = $2
         AND fr.form_type = $3
         AND fr.filing_id <> $4
         AND fr.filing_date < $5::date
       ORDER BY fr.filing_date DESC, fr.accepted_at DESC NULLS LAST
       LIMIT 1`,
      [
        scope,
        normalizeCik(filing.cik),
        filing.form_type,
        currentFilingId,
        filing.filing_date,
      ],
    );

    return result.rows[0] ?? null;
  };

  const upsertActiveLayer = async (
    scope: string,
    filingId: string,
    layerType: "raw_source" | "structured_intelligence" | "interpretation",
    layerVersion: string,
    producedBy: string,
    payload: Record<string, unknown>,
    confidence?: number,
    lineage?: Record<string, unknown>,
  ) => {
    const db = ensurePool();
    await db.query(
      `UPDATE edgar_filing_layer
       SET is_active = false, updated_at = NOW()
       WHERE scope_id = $1 AND filing_id = $2 AND layer_type = $3 AND is_active = true`,
      [scope, filingId, layerType],
    );

    await db.query(
      `INSERT INTO edgar_filing_layer (
         scope_id, filing_id, layer_type, layer_version, produced_by,
         payload, payload_sha256, confidence, lineage, is_active
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6::jsonb, $7, $8, $9::jsonb, true
       )
       ON CONFLICT (scope_id, filing_id, layer_type, layer_version)
       DO UPDATE SET
         produced_by = EXCLUDED.produced_by,
         payload = EXCLUDED.payload,
         payload_sha256 = EXCLUDED.payload_sha256,
         confidence = EXCLUDED.confidence,
         lineage = EXCLUDED.lineage,
         is_active = true,
         updated_at = NOW()`,
      [
        scope,
        filingId,
        layerType,
        layerVersion,
        producedBy,
        JSON.stringify(payload),
        sha256(JSON.stringify(payload)),
        typeof confidence === "number" ? confidence : null,
        JSON.stringify(lineage ?? {}),
      ],
    );
  };

  const processFiling = async (
    scope: string,
    filingId: string,
    filing: EdgarIngestFiling,
  ) => {
    const db = ensurePool();
    const parsed = parseFiling(filing);
    const signals = buildSignalRecords(parsed);
    const mentions = extractEntityMentions(filing.raw_content);
    const previous = await fetchPreviousFilingContext(scope, filing, filingId);
    const delta = buildDelta(filing, parsed, mentions, previous);
    const score = buildRelevance(filing, parsed);
    const materiality = buildMateriality(filing, parsed, delta);
    const ai = buildAiSecondPass(filing, parsed, score);
    const routing = buildRoutingDecision(materiality, delta, mentions);

    const parseQuality = Math.max(
      0.15,
      Math.min(
        1,
        parsed.derived_records.length / (filing.form_type === "4" ? 7 : 5),
      ),
    );
    await db.query(
      `INSERT INTO edgar_filing_parsed (scope_id, filing_id, parser_version, parsed_payload, derived_records, parse_quality)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
       ON CONFLICT (scope_id, filing_id, parser_version)
       DO UPDATE SET
         parsed_payload = EXCLUDED.parsed_payload,
         derived_records = EXCLUDED.derived_records,
         parse_quality = EXCLUDED.parse_quality,
         updated_at = NOW()`,
      [
        scope,
        filingId,
        PARSER_VERSION,
        JSON.stringify(parsed),
        JSON.stringify(parsed.derived_records),
        parseQuality,
      ],
    );

    await db.query(
      `DELETE FROM edgar_filing_signal
       WHERE scope_id = $1 AND filing_id = $2 AND parser_version = $3`,
      [scope, filingId, PARSER_VERSION],
    );
    for (const signal of signals) {
      await db.query(
        `INSERT INTO edgar_filing_signal (
           scope_id, filing_id, parser_version, signal_type, signal_category, title,
           confidence, signal_payload, provenance
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
         ON CONFLICT (scope_id, filing_id, parser_version, signal_type, title)
         DO UPDATE SET
           signal_category = EXCLUDED.signal_category,
           confidence = EXCLUDED.confidence,
           signal_payload = EXCLUDED.signal_payload,
           provenance = EXCLUDED.provenance,
           updated_at = NOW()`,
        [
          scope,
          filingId,
          signal.parser_version,
          signal.signal_type,
          signal.signal_category,
          signal.title,
          signal.confidence,
          JSON.stringify(signal.signal_payload),
          JSON.stringify(signal.provenance),
        ],
      );
    }

    await db.query(
      `DELETE FROM edgar_filing_entity_mentions
       WHERE scope_id = $1 AND filing_id = $2 AND parser_version = $3`,
      [scope, filingId, PARSER_VERSION],
    );
    for (const mention of mentions) {
      await db.query(
        `INSERT INTO edgar_filing_entity_mentions (
           scope_id, filing_id, parser_version, entity_name, entity_type,
           relationship_type, mention_context, confidence, provenance
         ) VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''), NULLIF($7, ''), $8, $9::jsonb)
         ON CONFLICT (scope_id, filing_id, parser_version, entity_name, entity_type, relationship_type)
         DO UPDATE SET
           mention_context = EXCLUDED.mention_context,
           confidence = EXCLUDED.confidence,
           provenance = EXCLUDED.provenance`,
        [
          scope,
          filingId,
          PARSER_VERSION,
          mention.entity_name,
          mention.entity_type,
          mention.relationship_type ?? "",
          mention.mention_context ?? "",
          mention.confidence,
          JSON.stringify(mention.provenance ?? {}),
        ],
      );
    }

    await db.query(
      `INSERT INTO edgar_filing_delta (
         scope_id, filing_id, previous_filing_id, delta_version,
         language_diff, risk_factor_diff, tone_diff, financial_direction_diff, entity_relationship_diff
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb)
       ON CONFLICT (scope_id, filing_id, delta_version)
       DO UPDATE SET
         previous_filing_id = EXCLUDED.previous_filing_id,
         language_diff = EXCLUDED.language_diff,
         risk_factor_diff = EXCLUDED.risk_factor_diff,
         tone_diff = EXCLUDED.tone_diff,
         financial_direction_diff = EXCLUDED.financial_direction_diff,
         entity_relationship_diff = EXCLUDED.entity_relationship_diff,
         created_at = NOW()`,
      [
        scope,
        filingId,
        delta.previous_filing_id ?? null,
        delta.delta_version,
        JSON.stringify(delta.language_diff),
        JSON.stringify(delta.risk_factor_diff),
        JSON.stringify(delta.tone_diff),
        JSON.stringify(delta.financial_direction_diff),
        JSON.stringify(delta.entity_relationship_diff),
      ],
    );

    await db.query(
      `INSERT INTO edgar_filing_score (
         scope_id, filing_id, score_version, overall_score, market_impact_score,
         urgency_score, novelty_score, entity_linkage_score, rationale
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       ON CONFLICT (scope_id, filing_id, score_version)
       DO UPDATE SET
         overall_score = EXCLUDED.overall_score,
         market_impact_score = EXCLUDED.market_impact_score,
         urgency_score = EXCLUDED.urgency_score,
         novelty_score = EXCLUDED.novelty_score,
         entity_linkage_score = EXCLUDED.entity_linkage_score,
         rationale = EXCLUDED.rationale,
         updated_at = NOW()`,
      [
        scope,
        filingId,
        SCORE_VERSION,
        score.overall,
        score.market_impact,
        score.urgency,
        score.novelty,
        score.entity_linkage_strength,
        JSON.stringify(score.rationale),
      ],
    );

    await db.query(
      `INSERT INTO edgar_filing_materiality (
         scope_id, filing_id, scoring_version, overall_score,
         form_weight_score, company_importance_score, detected_event_score,
         unusual_language_score, historical_deviation_score, time_horizon, score_breakdown
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
       ON CONFLICT (scope_id, filing_id, scoring_version)
       DO UPDATE SET
         overall_score = EXCLUDED.overall_score,
         form_weight_score = EXCLUDED.form_weight_score,
         company_importance_score = EXCLUDED.company_importance_score,
         detected_event_score = EXCLUDED.detected_event_score,
         unusual_language_score = EXCLUDED.unusual_language_score,
         historical_deviation_score = EXCLUDED.historical_deviation_score,
         time_horizon = EXCLUDED.time_horizon,
         score_breakdown = EXCLUDED.score_breakdown,
         updated_at = NOW()`,
      [
        scope,
        filingId,
        materiality.scoring_version,
        materiality.overall_score,
        materiality.form_weight_score,
        materiality.company_importance_score,
        materiality.detected_event_score,
        materiality.unusual_language_score,
        materiality.historical_deviation_score,
        materiality.time_horizon,
        JSON.stringify(materiality.score_breakdown),
      ],
    );

    const gateStatus =
      ai.confidence >= AI_PUBLISH_CONFIDENCE_THRESHOLD && score.overall >= 60
        ? "published"
        : "suppressed";
    await db.query(
      `INSERT INTO edgar_filing_ai (
         scope_id, filing_id, model, prompt_version, summary, importance_assessment,
         thematic_tags, terminal_intelligence, confidence, gate_status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10)
       ON CONFLICT (scope_id, filing_id, model, prompt_version)
       DO UPDATE SET
         summary = EXCLUDED.summary,
         importance_assessment = EXCLUDED.importance_assessment,
         thematic_tags = EXCLUDED.thematic_tags,
         terminal_intelligence = EXCLUDED.terminal_intelligence,
         confidence = EXCLUDED.confidence,
         gate_status = EXCLUDED.gate_status,
         updated_at = NOW()`,
      [
        scope,
        filingId,
        ai.model,
        ai.prompt_version,
        ai.summary,
        ai.importance_assessment,
        JSON.stringify(ai.thematic_tags),
        JSON.stringify(ai.terminal_intelligence),
        ai.confidence,
        gateStatus,
      ],
    );

    await db.query(
      `INSERT INTO edgar_filing_routing (
         scope_id, filing_id, routing_version, route_flow, route_intelligence,
         route_gwmd, route_reasoning, source_layers, route_priority
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)
       ON CONFLICT (scope_id, filing_id, routing_version)
       DO UPDATE SET
         route_flow = EXCLUDED.route_flow,
         route_intelligence = EXCLUDED.route_intelligence,
         route_gwmd = EXCLUDED.route_gwmd,
         route_reasoning = EXCLUDED.route_reasoning,
         source_layers = EXCLUDED.source_layers,
         route_priority = EXCLUDED.route_priority,
         updated_at = NOW()`,
      [
        scope,
        filingId,
        routing.routing_version,
        routing.route_flow,
        routing.route_intelligence,
        routing.route_gwmd,
        JSON.stringify(routing.route_reasoning),
        JSON.stringify(routing.source_layers),
        routing.route_priority,
      ],
    );

    const rawLayerVersion = `raw-${sha256(filing.raw_content).slice(0, 12)}`;
    const structuredPayload = {
      parsed,
      signals,
      entity_mentions: mentions,
      delta,
      materiality,
    };
    const structuredLayerVersion = `${PARSER_VERSION}-${sha256(
      JSON.stringify(structuredPayload),
    ).slice(0, 12)}`;
    const interpretationPayload = {
      ai,
      routing,
      gate_status: gateStatus,
    };
    const interpretationLayerVersion = `${AI_PROMPT_VERSION}-${sha256(
      JSON.stringify(interpretationPayload),
    ).slice(0, 12)}`;

    await upsertActiveLayer(
      scope,
      filingId,
      "raw_source",
      rawLayerVersion,
      "sec-edgar-ingest",
      {
        metadata: filing,
        raw_content: filing.raw_content,
      },
      1,
      {
        source_type: "sec_filing",
      },
    );
    await upsertActiveLayer(
      scope,
      filingId,
      "structured_intelligence",
      structuredLayerVersion,
      PARSER_VERSION,
      structuredPayload,
      parseQuality,
      {
        parser_version: PARSER_VERSION,
        previous_filing_id: previous?.filing_id ?? null,
      },
    );
    await upsertActiveLayer(
      scope,
      filingId,
      "interpretation",
      interpretationLayerVersion,
      AI_MODEL,
      interpretationPayload,
      ai.confidence,
      {
        prompt_version: AI_PROMPT_VERSION,
      },
    );

    return {
      parsed,
      score,
      materiality,
      routing,
      ai,
      delta,
      signals,
      mentions,
    };
  };

  const ingest = async (scopeId: string, filings: EdgarIngestFiling[]) => {
    const db = ensurePool();
    const scope = normalizeScope(scopeId);
    let inserted = 0;
    let updated = 0;

    for (const filing of filings) {
      if (!SUPPORTED_FORMS.has(filing.form_type)) {
        continue;
      }
      const cik = normalizeCik(filing.cik);
      const sourceHash = sha256(
        `${cik}|${filing.accession_number}|${filing.form_type}|${filing.filing_date}|${filing.raw_content}`,
      );

      const existing = await db.query<{ filing_id: string }>(
        `SELECT filing_id
         FROM edgar_filing_raw
         WHERE scope_id = $1 AND cik = $2 AND accession_number = $3 AND form_type = $4`,
        [scope, cik, filing.accession_number, filing.form_type],
      );

      let filingId = existing.rows[0]?.filing_id;
      if (!filingId) {
        const insertedRow = await db.query<{ filing_id: string }>(
          `INSERT INTO edgar_filing_raw (
             scope_id, company_name, cik, ticker, accession_number, filing_date, accepted_at, period_of_report,
             form_type, primary_document_url, filing_detail_url, source_links, metadata,
             raw_content, raw_content_sha256, source_type, vault_record_version, source_tracking
           ) VALUES (
             $1, $2, $3, NULLIF($4, ''), $5, $6::date, $7::timestamptz, $8::date,
             $9, NULLIF($10, ''), NULLIF($11, ''), $12::jsonb, $13::jsonb, $14, $15, 'sec_filing', 'v2', $16::jsonb
           )
           ON CONFLICT (scope_id, cik, accession_number, form_type)
           DO UPDATE SET
             company_name = EXCLUDED.company_name,
             ticker = EXCLUDED.ticker,
             filing_date = EXCLUDED.filing_date,
             accepted_at = EXCLUDED.accepted_at,
             period_of_report = EXCLUDED.period_of_report,
             primary_document_url = EXCLUDED.primary_document_url,
             filing_detail_url = EXCLUDED.filing_detail_url,
             source_links = EXCLUDED.source_links,
             metadata = EXCLUDED.metadata,
             raw_content = EXCLUDED.raw_content,
             raw_content_sha256 = EXCLUDED.raw_content_sha256,
             source_type = EXCLUDED.source_type,
             vault_record_version = EXCLUDED.vault_record_version,
             source_tracking = EXCLUDED.source_tracking,
             updated_at = NOW()
           RETURNING filing_id`,
          [
            scope,
            filing.company_name,
            cik,
            filing.ticker ?? "",
            filing.accession_number,
            filing.filing_date,
            filing.accepted_at ?? null,
            filing.period_of_report ?? null,
            filing.form_type,
            filing.primary_document_url ?? "",
            filing.filing_detail_url ?? "",
            JSON.stringify(filing.source_links ?? []),
            JSON.stringify(filing.metadata ?? {}),
            filing.raw_content,
            sourceHash,
            JSON.stringify({
              ingestion_mode: "direct_ingest",
              source_links: filing.source_links ?? [],
              parser_version: PARSER_VERSION,
            }),
          ],
        );
        filingId = insertedRow.rows[0]?.filing_id;
        inserted += 1;
      } else {
        await db.query(
          `UPDATE edgar_filing_raw
           SET company_name = $5,
               ticker = NULLIF($6, ''),
               filing_date = $7::date,
               accepted_at = $8::timestamptz,
               period_of_report = $9::date,
               primary_document_url = NULLIF($10, ''),
               filing_detail_url = NULLIF($11, ''),
               source_links = $12::jsonb,
               metadata = $13::jsonb,
               raw_content = $14,
               raw_content_sha256 = $15,
                 source_type = 'sec_filing',
                 vault_record_version = 'v2',
                 source_tracking = $16::jsonb,
               updated_at = NOW()
           WHERE scope_id = $1 AND cik = $2 AND accession_number = $3 AND form_type = $4`,
          [
            scope,
            cik,
            filing.accession_number,
            filing.form_type,
            filing.company_name,
            filing.ticker ?? "",
            filing.filing_date,
            filing.accepted_at ?? null,
            filing.period_of_report ?? null,
            filing.primary_document_url ?? "",
            filing.filing_detail_url ?? "",
            JSON.stringify(filing.source_links ?? []),
            JSON.stringify(filing.metadata ?? {}),
            filing.raw_content,
            sourceHash,
            JSON.stringify({
              ingestion_mode: "direct_ingest",
              source_links: filing.source_links ?? [],
              parser_version: PARSER_VERSION,
            }),
          ],
        );
        updated += 1;
      }

      if (!filingId) {
        continue;
      }

      await processFiling(scope, filingId, {
        ...filing,
        cik,
      });
    }

    return {
      scope,
      total: filings.length,
      inserted,
      updated,
      skipped: Math.max(0, filings.length - inserted - updated),
      parserVersion: PARSER_VERSION,
      scoreVersion: SCORE_VERSION,
      materialityVersion: MATERIALITY_VERSION,
      deltaVersion: DELTA_VERSION,
      routingVersion: ROUTING_VERSION,
      aiModel: AI_MODEL,
    };
  };

  const listFilings = async (
    scopeId: string,
    filters: ListFilters,
  ): Promise<EdgarFilingRecord[]> => {
    const db = ensurePool();
    const scope = normalizeScope(scopeId);
    const values: unknown[] = [scope];
    let where = "WHERE fr.scope_id = $1";

    if (filters.cik) {
      values.push(normalizeCik(filters.cik));
      where += ` AND fr.cik = $${values.length}`;
    }
    if (filters.ticker) {
      values.push(filters.ticker.toUpperCase());
      where += ` AND UPPER(COALESCE(fr.ticker, '')) = $${values.length}`;
    }
    if (filters.formType) {
      const normalizedForm = normalizeFormType(filters.formType);
      if (normalizedForm) {
        values.push(normalizedForm);
        where += ` AND fr.form_type = $${values.length}`;
      }
    }
    if (filters.fromDate) {
      values.push(filters.fromDate);
      where += ` AND fr.filing_date >= $${values.length}::date`;
    }
    if (filters.toDate) {
      values.push(filters.toDate);
      where += ` AND fr.filing_date <= $${values.length}::date`;
    }
    if (
      typeof filters.minScore === "number" &&
      Number.isFinite(filters.minScore)
    ) {
      values.push(filters.minScore);
      where += ` AND COALESCE(fs.overall_score, 0) >= $${values.length}`;
    }

    const limit =
      typeof filters.limit === "number" && Number.isFinite(filters.limit)
        ? Math.max(1, Math.min(500, Math.floor(filters.limit)))
        : 100;
    values.push(limit);

    const query = `
      SELECT
        fr.filing_id,
        fr.company_name,
        fr.cik,
        fr.ticker,
        fr.accession_number,
        fr.filing_date,
        fr.accepted_at,
        fr.period_of_report,
        fr.form_type,
        fr.primary_document_url,
        fr.filing_detail_url,
        fr.source_links,
        fr.metadata,
        fr.source_type,
        fr.vault_record_version,
        fr.source_tracking,
        fr.ingested_at,
        fr.updated_at,
        fp.parsed_payload,
        fs.overall_score,
        fs.market_impact_score,
        fs.urgency_score,
        fs.novelty_score,
        fs.entity_linkage_score,
        fs.rationale,
        fai.model,
        fai.prompt_version,
        fai.summary,
        fai.importance_assessment,
        fai.thematic_tags,
        fai.terminal_intelligence,
        fai.confidence,
        fai.gate_status,
        fm.scoring_version,
        fm.overall_score AS materiality_overall_score,
        fm.form_weight_score,
        fm.company_importance_score,
        fm.detected_event_score,
        fm.unusual_language_score,
        fm.historical_deviation_score,
        fm.time_horizon,
        fm.score_breakdown,
        frt.routing_version,
        frt.route_flow,
        frt.route_intelligence,
        frt.route_gwmd,
        frt.route_reasoning,
        frt.source_layers,
        frt.route_priority,
        fd.delta_version,
        fd.previous_filing_id,
        fd.language_diff,
        fd.risk_factor_diff,
        fd.tone_diff,
        fd.financial_direction_diff,
        fd.entity_relationship_diff
      FROM edgar_filing_raw fr
      LEFT JOIN LATERAL (
        SELECT parsed_payload
        FROM edgar_filing_parsed fp2
        WHERE fp2.scope_id = fr.scope_id AND fp2.filing_id = fr.filing_id
        ORDER BY fp2.updated_at DESC
        LIMIT 1
      ) fp ON true
      LEFT JOIN LATERAL (
        SELECT overall_score, market_impact_score, urgency_score, novelty_score, entity_linkage_score, rationale
        FROM edgar_filing_score fs2
        WHERE fs2.scope_id = fr.scope_id AND fs2.filing_id = fr.filing_id
        ORDER BY fs2.updated_at DESC
        LIMIT 1
      ) fs ON true
      LEFT JOIN LATERAL (
        SELECT model, prompt_version, summary, importance_assessment, thematic_tags, terminal_intelligence, confidence, gate_status
        FROM edgar_filing_ai fai2
        WHERE fai2.scope_id = fr.scope_id AND fai2.filing_id = fr.filing_id
        ORDER BY fai2.updated_at DESC
        LIMIT 1
      ) fai ON true
      LEFT JOIN LATERAL (
        SELECT scoring_version, overall_score, form_weight_score, company_importance_score,
               detected_event_score, unusual_language_score, historical_deviation_score,
               time_horizon, score_breakdown
        FROM edgar_filing_materiality fm2
        WHERE fm2.scope_id = fr.scope_id AND fm2.filing_id = fr.filing_id
        ORDER BY fm2.updated_at DESC
        LIMIT 1
      ) fm ON true
      LEFT JOIN LATERAL (
        SELECT routing_version, route_flow, route_intelligence, route_gwmd,
               route_reasoning, source_layers, route_priority
        FROM edgar_filing_routing frt2
        WHERE frt2.scope_id = fr.scope_id AND frt2.filing_id = fr.filing_id
        ORDER BY frt2.updated_at DESC
        LIMIT 1
      ) frt ON true
      LEFT JOIN LATERAL (
        SELECT delta_version, previous_filing_id, language_diff, risk_factor_diff,
               tone_diff, financial_direction_diff, entity_relationship_diff
        FROM edgar_filing_delta fd2
        WHERE fd2.scope_id = fr.scope_id AND fd2.filing_id = fr.filing_id
        ORDER BY fd2.created_at DESC
        LIMIT 1
      ) fd ON true
      ${where}
      ORDER BY fr.filing_date DESC, fr.accepted_at DESC NULLS LAST
      LIMIT $${values.length}
    `;

    const rows = await db.query<Record<string, unknown>>(query, values);
    return rows.rows.map((row) => {
      const parsed = row.parsed_payload as EdgarParsedPayload | null;
      const scoreExists = typeof row.overall_score === "number";
      const aiExists = typeof row.summary === "string";
      return {
        filing_id: String(row.filing_id),
        company_name: String(row.company_name),
        cik: String(row.cik),
        ...(row.ticker ? { ticker: String(row.ticker) } : {}),
        accession_number: String(row.accession_number),
        filing_date: new Date(String(row.filing_date)).toISOString(),
        ...(row.accepted_at
          ? { accepted_at: new Date(String(row.accepted_at)).toISOString() }
          : {}),
        ...(row.period_of_report
          ? {
              period_of_report: new Date(
                String(row.period_of_report),
              ).toISOString(),
            }
          : {}),
        form_type: String(row.form_type) as EdgarFormType,
        ...(row.primary_document_url
          ? { primary_document_url: String(row.primary_document_url) }
          : {}),
        ...(row.filing_detail_url
          ? { filing_detail_url: String(row.filing_detail_url) }
          : {}),
        source_links: Array.isArray(row.source_links)
          ? (row.source_links as string[])
          : [],
        metadata:
          row.metadata && typeof row.metadata === "object"
            ? (row.metadata as Record<string, unknown>)
            : {},
        ...(row.source_type === "sec_filing"
          ? { source_type: "sec_filing" as const }
          : {}),
        ...(typeof row.vault_record_version === "string"
          ? { vault_record_version: row.vault_record_version }
          : {}),
        ...(row.source_tracking && typeof row.source_tracking === "object"
          ? { source_tracking: row.source_tracking as Record<string, unknown> }
          : {}),
        ingested_at: new Date(String(row.ingested_at)).toISOString(),
        updated_at: new Date(String(row.updated_at)).toISOString(),
        ...(parsed ? { parse: parsed } : {}),
        ...(scoreExists
          ? {
              relevance: {
                score_version: SCORE_VERSION,
                overall: Number(row.overall_score),
                market_impact: Number(row.market_impact_score),
                urgency: Number(row.urgency_score),
                novelty: Number(row.novelty_score),
                entity_linkage_strength: Number(row.entity_linkage_score),
                rationale: Array.isArray(row.rationale)
                  ? (row.rationale as string[])
                  : [],
              },
            }
          : {}),
        ...(typeof row.materiality_overall_score === "number"
          ? {
              materiality: {
                scoring_version: String(
                  row.scoring_version ?? MATERIALITY_VERSION,
                ),
                overall_score: Number(row.materiality_overall_score),
                form_weight_score: Number(row.form_weight_score),
                company_importance_score: Number(row.company_importance_score),
                detected_event_score: Number(row.detected_event_score),
                unusual_language_score: Number(row.unusual_language_score),
                historical_deviation_score: Number(
                  row.historical_deviation_score,
                ),
                time_horizon:
                  String(row.time_horizon) === "immediate"
                    ? "immediate"
                    : String(row.time_horizon) === "medium_term"
                      ? "medium_term"
                      : "long_term",
                score_breakdown:
                  row.score_breakdown && typeof row.score_breakdown === "object"
                    ? (row.score_breakdown as Record<string, unknown>)
                    : {},
              },
            }
          : {}),
        ...(typeof row.routing_version === "string"
          ? {
              routing: {
                routing_version: String(row.routing_version),
                route_flow: Boolean(row.route_flow),
                route_intelligence: Boolean(row.route_intelligence),
                route_gwmd: Boolean(row.route_gwmd),
                route_reasoning: Array.isArray(row.route_reasoning)
                  ? (row.route_reasoning as string[])
                  : [],
                source_layers:
                  row.source_layers && typeof row.source_layers === "object"
                    ? (row.source_layers as Record<string, string>)
                    : {},
                route_priority: Number(row.route_priority ?? 0),
              },
            }
          : {}),
        ...(typeof row.delta_version === "string"
          ? {
              delta: {
                delta_version: String(row.delta_version),
                ...(row.previous_filing_id
                  ? { previous_filing_id: String(row.previous_filing_id) }
                  : {}),
                language_diff:
                  row.language_diff && typeof row.language_diff === "object"
                    ? (row.language_diff as Record<string, unknown>)
                    : {},
                risk_factor_diff:
                  row.risk_factor_diff &&
                  typeof row.risk_factor_diff === "object"
                    ? (row.risk_factor_diff as Record<string, unknown>)
                    : {},
                tone_diff:
                  row.tone_diff && typeof row.tone_diff === "object"
                    ? (row.tone_diff as Record<string, unknown>)
                    : {},
                financial_direction_diff:
                  row.financial_direction_diff &&
                  typeof row.financial_direction_diff === "object"
                    ? (row.financial_direction_diff as Record<string, unknown>)
                    : {},
                entity_relationship_diff:
                  row.entity_relationship_diff &&
                  typeof row.entity_relationship_diff === "object"
                    ? (row.entity_relationship_diff as Record<string, unknown>)
                    : {},
              },
            }
          : {}),
        ...(aiExists
          ? {
              ai_annotation: {
                model: String(row.model),
                prompt_version: String(row.prompt_version),
                summary: String(row.summary),
                importance_assessment: String(row.importance_assessment ?? ""),
                thematic_tags: Array.isArray(row.thematic_tags)
                  ? (row.thematic_tags as string[])
                  : [],
                terminal_intelligence:
                  row.terminal_intelligence &&
                  typeof row.terminal_intelligence === "object"
                    ? (row.terminal_intelligence as {
                        headline: string;
                        bullets: string[];
                        watch_items: string[];
                      })
                    : { headline: "", bullets: [], watch_items: [] },
                confidence: Number(row.confidence ?? 0),
                gate_status:
                  String(row.gate_status) === "published"
                    ? "published"
                    : String(row.gate_status) === "pending"
                      ? "pending"
                      : "suppressed",
              },
            }
          : {}),
      } satisfies EdgarFilingRecord;
    });
  };

  const getFilingIntelligenceView = async (
    scopeId: string,
    filingId: string,
  ): Promise<EdgarVaultInspectionRecord | null> => {
    const scope = normalizeScope(scopeId);
    const exact = await ensurePool().query<{
      cik: string;
      ticker: string | null;
      form_type: string;
      filing_date: string;
    }>(
      `SELECT cik, ticker, form_type, filing_date
       FROM edgar_filing_raw
       WHERE scope_id = $1 AND filing_id = $2::uuid
       LIMIT 1`,
      [scope, filingId],
    );
    const filterRow = exact.rows[0];
    if (!filterRow) {
      return null;
    }
    const filingsByCik = filterRow
      ? await listFilings(scope, {
          cik: filterRow.cik,
          formType: filterRow.form_type,
          limit: 200,
        })
      : [];
    const filing =
      filingsByCik.find((item) => item.filing_id === filingId) ?? null;
    if (!filing) {
      return null;
    }

    const db = ensurePool();
    const layers = await db.query<{
      layer_type: "raw_source" | "structured_intelligence" | "interpretation";
      layer_version: string;
      produced_by: string;
      payload: Record<string, unknown>;
      payload_sha256: string;
      confidence: number | null;
      lineage: Record<string, unknown>;
      is_active: boolean;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT layer_type, layer_version, produced_by, payload, payload_sha256,
              confidence, lineage, is_active, created_at, updated_at
       FROM edgar_filing_layer
       WHERE scope_id = $1 AND filing_id = $2
       ORDER BY created_at DESC`,
      [scope, filingId],
    );

    const signals = await db.query<{
      signal_id: string;
      parser_version: string;
      signal_type: string;
      signal_category: "explicit" | "implicit";
      title: string;
      confidence: number;
      signal_payload: Record<string, unknown>;
      provenance: Record<string, unknown>;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT signal_id, parser_version, signal_type, signal_category, title,
              confidence, signal_payload, provenance, created_at, updated_at
       FROM edgar_filing_signal
       WHERE scope_id = $1 AND filing_id = $2
       ORDER BY confidence DESC, created_at DESC`,
      [scope, filingId],
    );

    const mentions = await db.query<{
      entity_name: string;
      entity_type: string;
      relationship_type: string | null;
      mention_context: string | null;
      confidence: number;
      provenance: Record<string, unknown>;
    }>(
      `SELECT entity_name, entity_type, relationship_type, mention_context,
              confidence, provenance
       FROM edgar_filing_entity_mentions
       WHERE scope_id = $1 AND filing_id = $2
       ORDER BY confidence DESC, entity_name ASC`,
      [scope, filingId],
    );

    const mappedLayers = layers.rows.map((layer) => ({
      layer_type: layer.layer_type,
      layer_version: layer.layer_version,
      produced_by: layer.produced_by,
      payload: layer.payload,
      payload_sha256: layer.payload_sha256,
      ...(typeof layer.confidence === "number"
        ? { confidence: layer.confidence }
        : {}),
      lineage: layer.lineage,
      is_active: layer.is_active,
      created_at: new Date(layer.created_at).toISOString(),
      updated_at: new Date(layer.updated_at).toISOString(),
    }));

    const rawLayer = mappedLayers.find(
      (layer) => layer.layer_type === "raw_source",
    );
    const structuredLayer = mappedLayers.find(
      (layer) => layer.layer_type === "structured_intelligence",
    );
    const interpretationLayer = mappedLayers.find(
      (layer) => layer.layer_type === "interpretation",
    );

    return {
      filing: {
        ...filing,
        layers: mappedLayers,
        signals: signals.rows.map((signal) => ({
          signal_id: signal.signal_id,
          parser_version: signal.parser_version,
          signal_type: signal.signal_type,
          signal_category: signal.signal_category,
          title: signal.title,
          confidence: signal.confidence,
          signal_payload: signal.signal_payload,
          provenance: signal.provenance,
          created_at: new Date(signal.created_at).toISOString(),
          updated_at: new Date(signal.updated_at).toISOString(),
        })),
        entity_mentions: mentions.rows.map((mention) => ({
          entity_name: mention.entity_name,
          entity_type: mention.entity_type,
          ...(mention.relationship_type
            ? { relationship_type: mention.relationship_type }
            : {}),
          ...(mention.mention_context
            ? { mention_context: mention.mention_context }
            : {}),
          confidence: mention.confidence,
          provenance: mention.provenance,
        })),
      },
      ...(rawLayer ? { raw_layer: rawLayer } : {}),
      ...(structuredLayer ? { structured_layer: structuredLayer } : {}),
      ...(interpretationLayer
        ? { interpretation_layer: interpretationLayer }
        : {}),
      signals: signals.rows.map((signal) => ({
        signal_id: signal.signal_id,
        parser_version: signal.parser_version,
        signal_type: signal.signal_type,
        signal_category: signal.signal_category,
        title: signal.title,
        confidence: signal.confidence,
        signal_payload: signal.signal_payload,
        provenance: signal.provenance,
        created_at: new Date(signal.created_at).toISOString(),
        updated_at: new Date(signal.updated_at).toISOString(),
      })),
      ...(filing.delta ? { delta: filing.delta } : {}),
      ...(filing.materiality ? { materiality: filing.materiality } : {}),
      ...(filing.routing ? { routing: filing.routing } : {}),
      linked_entities: mentions.rows.map((mention) => ({
        entity_name: mention.entity_name,
        entity_type: mention.entity_type,
        ...(mention.relationship_type
          ? { relationship_type: mention.relationship_type }
          : {}),
        ...(mention.mention_context
          ? { mention_context: mention.mention_context }
          : {}),
        confidence: mention.confidence,
        provenance: mention.provenance,
      })),
    };
  };

  const reprocess = async (scopeId: string, input: ReprocessInput) => {
    const scope = normalizeScope(scopeId);
    const db = ensurePool();
    const values: unknown[] = [scope];
    let where = "WHERE scope_id = $1";

    if (input.filingIds?.length) {
      values.push(input.filingIds);
      where += ` AND filing_id = ANY($${values.length}::uuid[])`;
    }
    if (input.cik) {
      values.push(normalizeCik(input.cik));
      where += ` AND cik = $${values.length}`;
    }
    if (input.formType) {
      values.push(input.formType);
      where += ` AND form_type = $${values.length}`;
    }

    const limit = Math.max(1, Math.min(500, input.limit ?? 100));
    values.push(limit);

    const rows = await db.query<{
      filing_id: string;
      company_name: string;
      cik: string;
      ticker: string | null;
      accession_number: string;
      filing_date: string;
      accepted_at: string | null;
      period_of_report: string | null;
      form_type: EdgarFormType;
      primary_document_url: string | null;
      filing_detail_url: string | null;
      source_links: string[];
      metadata: Record<string, unknown>;
      raw_content: string;
    }>(
      `SELECT filing_id, company_name, cik, ticker, accession_number, filing_date,
              accepted_at, period_of_report, form_type, primary_document_url,
              filing_detail_url, source_links, metadata, raw_content
       FROM edgar_filing_raw
       ${where}
       ORDER BY filing_date DESC, accepted_at DESC NULLS LAST
       LIMIT $${values.length}`,
      values,
    );

    for (const row of rows.rows) {
      await processFiling(scope, row.filing_id, {
        company_name: row.company_name,
        cik: row.cik,
        ...(row.ticker ? { ticker: row.ticker } : {}),
        accession_number: row.accession_number,
        filing_date: new Date(row.filing_date).toISOString(),
        ...(row.accepted_at
          ? { accepted_at: new Date(row.accepted_at).toISOString() }
          : {}),
        ...(row.period_of_report
          ? { period_of_report: new Date(row.period_of_report).toISOString() }
          : {}),
        form_type: row.form_type,
        ...(row.primary_document_url
          ? { primary_document_url: row.primary_document_url }
          : {}),
        ...(row.filing_detail_url
          ? { filing_detail_url: row.filing_detail_url }
          : {}),
        source_links: Array.isArray(row.source_links) ? row.source_links : [],
        metadata: row.metadata ?? {},
        raw_content: row.raw_content,
      });
    }

    return {
      scope,
      reprocessed: rows.rows.length,
      parserVersion: PARSER_VERSION,
      scoreVersion: SCORE_VERSION,
      materialityVersion: MATERIALITY_VERSION,
      deltaVersion: DELTA_VERSION,
      routingVersion: ROUTING_VERSION,
    };
  };

  const listRouting = async (
    scopeId: string,
    surface: "flow" | "intelligence" | "gwmd" | "all" = "all",
    limit = 100,
  ) => {
    const scope = normalizeScope(scopeId);
    const db = ensurePool();
    const safeLimit = Math.max(1, Math.min(500, limit));
    const values: unknown[] = [scope, safeLimit];

    let routeFilter = "";
    if (surface === "flow") {
      routeFilter = "AND route_flow = true";
    } else if (surface === "intelligence") {
      routeFilter = "AND route_intelligence = true";
    } else if (surface === "gwmd") {
      routeFilter = "AND route_gwmd = true";
    }

    const rows = await db.query<{
      filing_id: string;
      routing_version: string;
      route_flow: boolean;
      route_intelligence: boolean;
      route_gwmd: boolean;
      route_reasoning: string[];
      route_priority: number;
      source_layers: Record<string, string>;
      company_name: string;
      form_type: string;
      filing_date: string;
    }>(
      `SELECT r.filing_id, r.routing_version, r.route_flow, r.route_intelligence,
              r.route_gwmd, r.route_reasoning, r.route_priority, r.source_layers,
              fr.company_name, fr.form_type, fr.filing_date
       FROM edgar_filing_routing r
       JOIN edgar_filing_raw fr
         ON fr.scope_id = r.scope_id AND fr.filing_id = r.filing_id
       WHERE r.scope_id = $1 ${routeFilter}
       ORDER BY r.route_priority DESC, fr.filing_date DESC
       LIMIT $2`,
      values,
    );

    return rows.rows.map((row) => ({
      filing_id: row.filing_id,
      company_name: row.company_name,
      form_type: row.form_type,
      filing_date: new Date(row.filing_date).toISOString(),
      routing: {
        routing_version: row.routing_version,
        route_flow: row.route_flow,
        route_intelligence: row.route_intelligence,
        route_gwmd: row.route_gwmd,
        route_reasoning: Array.isArray(row.route_reasoning)
          ? row.route_reasoning
          : [],
        source_layers:
          row.source_layers && typeof row.source_layers === "object"
            ? row.source_layers
            : {},
        route_priority: Number(row.route_priority),
      },
    }));
  };

  const getSnapshot = async (scopeId: string, windowDays: number) => {
    const db = ensurePool();
    const scope = normalizeScope(scopeId);
    const days = Math.max(1, Math.min(365, Math.floor(windowDays)));

    const counts = await db.query<{
      form_type: string;
      count: string;
      avg_score: string | null;
    }>(
      `SELECT fr.form_type, COUNT(*)::text AS count, AVG(fs.overall_score)::text AS avg_score
       FROM edgar_filing_raw fr
       LEFT JOIN LATERAL (
         SELECT overall_score
         FROM edgar_filing_score score
         WHERE score.scope_id = fr.scope_id AND score.filing_id = fr.filing_id
         ORDER BY score.updated_at DESC
         LIMIT 1
       ) fs ON true
       WHERE fr.scope_id = $1
         AND fr.filing_date >= (NOW() - ($2::text || ' days')::interval)::date
       GROUP BY fr.form_type
       ORDER BY COUNT(*) DESC`,
      [scope, String(days)],
    );

    const top = await listFilings(scope, {
      limit: 20,
      fromDate: new Date(Date.now() - days * 86_400_000).toISOString(),
    });

    return {
      scope,
      window_days: days,
      totals_by_form: counts.rows.map((row) => ({
        form_type: row.form_type,
        count: Number(row.count),
        avg_score: row.avg_score ? Number(row.avg_score) : 0,
      })),
      high_priority: top.filter((item) => (item.relevance?.overall ?? 0) >= 70),
      recent: top,
    };
  };

  const runWatcherOnce = async (
    scopeId: string,
    input: RunWatcherOnceInput,
  ) => {
    const scope = normalizeScope(scopeId);
    const ciks = input.ciks.map(normalizeCik).filter(Boolean);
    if (!ciks.length) {
      return {
        scope,
        fetched: 0,
        ingested: { total: 0, inserted: 0, updated: 0, skipped: 0 },
      };
    }

    const forms = (input.forms ?? ["8-K", "10-K", "10-Q", "4"]).filter((form) =>
      SUPPORTED_FORMS.has(form),
    );
    const perCikLimit = Math.max(1, Math.min(50, input.perCikLimit ?? 20));

    const userAgent = env.EDGAR_USER_AGENT;
    const filings: EdgarIngestFiling[] = [];

    for (const cik of ciks) {
      const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
      try {
        const payload = await fetchSecJson<Record<string, unknown>>(
          url,
          userAgent,
        );
        const recent = (
          payload.filings as { recent?: Record<string, unknown> } | undefined
        )?.recent;
        const formArray = Array.isArray(recent?.form)
          ? (recent?.form as unknown[])
          : [];
        const accessionArray = Array.isArray(recent?.accessionNumber)
          ? (recent?.accessionNumber as unknown[])
          : [];
        const filingDateArray = Array.isArray(recent?.filingDate)
          ? (recent?.filingDate as unknown[])
          : [];
        const acceptedArray = Array.isArray(recent?.acceptanceDateTime)
          ? (recent?.acceptanceDateTime as unknown[])
          : [];
        const periodArray = Array.isArray(recent?.reportDate)
          ? (recent?.reportDate as unknown[])
          : [];
        const primaryDocArray = Array.isArray(recent?.primaryDocument)
          ? (recent?.primaryDocument as unknown[])
          : [];

        const companyName =
          typeof payload.name === "string" ? payload.name : `CIK ${cik}`;
        const ticker = Array.isArray(payload.tickers)
          ? String((payload.tickers as unknown[])[0] ?? "")
          : "";

        let seenForCik = 0;
        for (let i = 0; i < formArray.length; i += 1) {
          if (seenForCik >= perCikLimit) {
            break;
          }
          const form = normalizeFormType(String(formArray[i] ?? ""));
          if (!form || !forms.includes(form)) {
            continue;
          }

          const accession = String(accessionArray[i] ?? "").trim();
          const filingDate = String(filingDateArray[i] ?? "").trim();
          if (!accession || !filingDate) {
            continue;
          }

          const accessionNoDashes = accession.replace(/-/g, "");
          const archiveCik = String(Number(cik));
          const primaryDoc = String(primaryDocArray[i] ?? "").trim();
          const primaryUrl = primaryDoc
            ? `https://www.sec.gov/Archives/edgar/data/${archiveCik}/${accessionNoDashes}/${primaryDoc}`
            : "";
          const filingDetailUrl = `https://www.sec.gov/Archives/edgar/data/${archiveCik}/${accessionNoDashes}/`;

          let rawContent = "";
          if (primaryUrl) {
            try {
              rawContent = await fetchSecText(primaryUrl, userAgent);
            } catch (error) {
              logger.warn("edgar_primary_document_fetch_failed", {
                cik,
                accession,
                form,
                error: error instanceof Error ? error.message : "unknown_error",
              });
            }
          }

          filings.push({
            company_name: companyName,
            cik,
            ...(ticker ? { ticker } : {}),
            accession_number: accession,
            filing_date: filingDate,
            ...(acceptedArray[i]
              ? { accepted_at: String(acceptedArray[i]) }
              : {}),
            ...(periodArray[i]
              ? { period_of_report: String(periodArray[i]) }
              : {}),
            form_type: form,
            ...(primaryUrl ? { primary_document_url: primaryUrl } : {}),
            filing_detail_url: filingDetailUrl,
            source_links: [
              url,
              filingDetailUrl,
              ...(primaryUrl ? [primaryUrl] : []),
            ],
            metadata: {
              source: "sec-submissions-json",
              run_id: randomUUID(),
            },
            raw_content:
              rawContent || `${companyName} ${form} filing ${accession}`,
          });
          seenForCik += 1;
        }
      } catch (error) {
        logger.error("edgar_watcher_cik_fetch_failed", {
          cik,
          error: error instanceof Error ? error.message : "unknown_error",
        });
      }
    }

    const result = await ingest(scope, filings);
    await ensurePool().query(
      `INSERT INTO edgar_watcher_checkpoint (scope_id, checkpoint_key, checkpoint_value)
       VALUES ($1, 'last_run_at', NOW()::text)
       ON CONFLICT (scope_id, checkpoint_key)
       DO UPDATE SET checkpoint_value = EXCLUDED.checkpoint_value, updated_at = NOW()`,
      [scope],
    );

    return {
      scope,
      fetched: filings.length,
      ingested: result,
      forms,
      per_cik_limit: perCikLimit,
    };
  };

  const startWatcher = async (scopeId: string, config: EdgarWatcherConfig) => {
    const scope = normalizeScope(scopeId);
    if (watcherTimer) {
      clearInterval(watcherTimer);
      watcherTimer = null;
    }

    watcherStatus = {
      running: true,
      scopeId: scope,
      config,
    };

    const run = async () => {
      try {
        await runWatcherOnce(scope, {
          ciks: config.ciks,
          forms: config.forms,
          perCikLimit: config.perCikLimit,
        });
        watcherStatus = {
          ...watcherStatus,
          running: true,
          lastRunAt: new Date().toISOString(),
          lastRunStatus: "ok",
          lastRunMessage: "watcher_run_completed",
        };
      } catch (error) {
        watcherStatus = {
          ...watcherStatus,
          running: true,
          lastRunAt: new Date().toISOString(),
          lastRunStatus: "error",
          lastRunMessage:
            error instanceof Error ? error.message : "unknown_error",
        };
      }
    };

    await run();
    watcherTimer = setInterval(() => {
      void run();
    }, config.intervalSec * 1000);

    return watcherStatus;
  };

  const stopWatcher = () => {
    if (watcherTimer) {
      clearInterval(watcherTimer);
      watcherTimer = null;
    }
    watcherStatus = {
      ...watcherStatus,
      running: false,
      lastRunMessage: watcherStatus.lastRunMessage ?? "watcher_stopped",
    };
    return watcherStatus;
  };

  return {
    ingest,
    listFilings,
    getFilingIntelligenceView,
    reprocess,
    listRouting,
    getSnapshot,
    runWatcherOnce,
    startWatcher,
    stopWatcher,
    getWatcherStatus: () => watcherStatus,
  };
}

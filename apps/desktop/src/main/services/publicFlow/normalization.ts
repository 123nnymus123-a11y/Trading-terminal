import type { InsertDisclosureEvent } from "@tc/shared";

type NormalizableEventInput = Partial<InsertDisclosureEvent> & Record<string, unknown> & {
  source: string;
  entity_name: string;
  action: string;
  tx_date: string;
  report_date: string;
};

export function normalizeAction(action: string): "BUY" | "SELL" {
  const value = (action || "").toString().trim().toUpperCase();
  if (["SELL", "S", "SALE", "SOLD", "DISPOSE"].includes(value)) return "SELL";
  return "BUY";
}

export function parseDate(value: unknown): string {
  if (typeof value === "string") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  if (typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

export function parseAmountRange(value: unknown): { min: number | null; max: number | null; confidencePenalty: number } {
  if (typeof value === "number") return { min: value, max: value, confidencePenalty: 0 };
  if (value === null || value === undefined) return { min: null, max: null, confidencePenalty: 0.1 };

  const raw = value.toString().trim();
  if (!raw) return { min: null, max: null, confidencePenalty: 0.1 };

  const cleaned = raw.replace(/[$,]/g, "");
  const rangeMatch = cleaned.match(/([\d.]+)\s*[-–]\s*([\d.]+)/);
  if (rangeMatch) {
    const min = Number(rangeMatch[1]);
    const max = Number(rangeMatch[2]);
    return {
      min: Number.isFinite(min) ? min : null,
      max: Number.isFinite(max) ? max : null,
      confidencePenalty: 0,
    };
  }

  const single = Number(cleaned);
  if (Number.isFinite(single)) return { min: single, max: single, confidencePenalty: 0 };

  return { min: null, max: null, confidencePenalty: 0.1 };
}

export function normalizeEvent(input: NormalizableEventInput): InsertDisclosureEvent {
  const ticker = typeof input.ticker === "string" && input.ticker.trim().length > 0 ? input.ticker.trim().toUpperCase() : null;
  const action = normalizeAction(input.action as string);
  const tx_date = parseDate(input.tx_date);
  const report_date = parseDate(input.report_date);
  const amountRange = parseAmountRange((input as any).amount ?? input.amount_min ?? input.amount_max);

  const baseConfidence = typeof input.confidence === "number" ? input.confidence : 0.65;
  const confidencePenalty = (ticker ? 0 : 0.2) + amountRange.confidencePenalty;
  const confidence = Math.max(0, Math.min(1, baseConfidence - confidencePenalty));

  const asset_name =
    typeof input.asset_name === "string" && input.asset_name.trim().length > 0
      ? input.asset_name.trim()
      : input.entity_name.trim();

  const sector = typeof input.sector === "string" && input.sector.trim().length > 0 ? input.sector.trim() : null;
  const industry =
    typeof input.industry === "string" && input.industry.trim().length > 0 ? input.industry.trim() : null;

  const raw_json = typeof input.raw_json === "string" ? input.raw_json : JSON.stringify(input.raw_json ?? input);

  return {
    source: input.source,
    source_url: typeof input.source_url === "string" ? input.source_url : null,
    entity_name: input.entity_name,
    entity_type: (input.entity_type as InsertDisclosureEvent["entity_type"]) ?? "institution",
    owner_type: (input.owner_type as InsertDisclosureEvent["owner_type"]) ?? "institutional",
    ticker,
    asset_name,
    action,
    tx_date,
    report_date,
    amount_min: typeof amountRange.min === "number" ? amountRange.min : null,
    amount_max: typeof amountRange.max === "number" ? amountRange.max : null,
    sector,
    industry,
    confidence,
    raw_json,
    created_at: typeof input.created_at === "string" ? parseDate(input.created_at) : new Date().toISOString(),
  };
}

import type { InsertDisclosureEvent } from "@tc/shared";
import { createLogger } from "@tc/shared";
import { normalizeAction, normalizeEvent } from "../normalization";
import type { ConnectorFetchResult, ConnectorSummary, DisclosureConnector } from "./types";

const logger = createLogger({ scope: "publicFlow.liveDisclosure" });

function toISODateOnly(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function interpolate(template: string, ticker: string | null, sinceISO: string): string {
  const sinceDate = toISODateOnly(sinceISO);
  return template
    .replaceAll("{ticker}", ticker ?? "")
    .replaceAll("{since}", sinceDate)
    .replaceAll("{sinceDate}", sinceDate)
    .replaceAll("{sinceISO}", sinceISO)
    .replaceAll("{sinceMs}", String(new Date(sinceISO).getTime()));
}

function splitPath(path: string): string[] {
  const parts: string[] = [];
  const raw = path.split(".");
  for (const chunk of raw) {
    const match = chunk.match(/^([^[\]]+)(\[(\d+)\])?$/);
    if (!match) {
      parts.push(chunk);
      continue;
    }
    parts.push(match[1]!);
    if (match[3] !== undefined) parts.push(match[3]);
  }
  return parts.filter((p) => p.length > 0);
}

function getByPath(value: unknown, path?: string): unknown {
  if (!path) return value;
  const parts = splitPath(path);
  let current: unknown = value;
  for (const key of parts) {
    if (current == null) return undefined;
    const index = Number(key);
    if (Number.isFinite(index) && Array.isArray(current)) {
      current = current[index];
      continue;
    }
    if (typeof current === "object" && current !== null && key in current) {
      current = (current as Record<string, unknown>)[key];
      continue;
    }
    return undefined;
  }
  return current;
}

async function fetchJson(url: string, headers: Record<string, string>, timeoutMs = 12_000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json", ...headers },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText} - ${body.slice(0, 500)}`);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function toISODate(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

function mapLiveEvent(item: Record<string, unknown>, sourceFallback: string): InsertDisclosureEvent {
  const amountRaw = item.amount ?? item.value ?? item.amount_min ?? item.amount_max ?? null;
  const actionRaw = asString(item.action) ?? asString(item.transaction_type) ?? asString(item.type) ?? "BUY";
  return normalizeEvent({
    source: asString(item.source) ?? sourceFallback,
    source_url: asString(item.source_url) ?? asString(item.url),
    entity_name: asString(item.entity_name) ?? asString(item.entity) ?? asString(item.owner) ?? "Unknown Entity",
    entity_type: (asString(item.entity_type) as InsertDisclosureEvent["entity_type"]) ?? "institution",
    owner_type: (asString(item.owner_type) as InsertDisclosureEvent["owner_type"]) ?? "institutional",
    ticker: asString(item.ticker) ?? asString(item.symbol),
    asset_name: asString(item.asset_name) ?? asString(item.asset) ?? asString(item.ticker) ?? "Unknown Asset",
    action: normalizeAction(actionRaw),
    tx_date: toISODate(item.tx_date ?? item.transaction_date ?? item.tradeDate ?? item.date),
    report_date: toISODate(item.report_date ?? item.disclosure_date ?? item.reportDate ?? item.filedDate ?? item.tx_date),
    amount: amountRaw,
    sector: asString(item.sector),
    industry: asString(item.industry),
    confidence: typeof item.confidence === "number" ? item.confidence : 0.65,
    raw_json: JSON.stringify(item),
  });
}

export class LiveDisclosureConnector implements DisclosureConnector {
  id = "live-disclosure";
  kind = "live" as const;

  async fetchNew(sinceISO: string): Promise<ConnectorFetchResult> {
    const errors: string[] = [];
    const provider = (process.env.PUBLIC_FLOW_DISCLOSURE_PROVIDER ?? "").toLowerCase();
    let endpoint = process.env.PUBLIC_FLOW_DISCLOSURE_ENDPOINT ?? "";
    const path = process.env.PUBLIC_FLOW_DISCLOSURE_JSON_PATH;
    const source = process.env.PUBLIC_FLOW_DISCLOSURE_SOURCE ?? "Live";
    const headers: Record<string, string> = {};

    if (provider === "quiver") {
      const token = process.env.QUIVER_API_KEY ?? "";
      if (!endpoint) endpoint = "https://api.quiverquant.com/beta/congresstrading";
      if (token) headers["Authorization"] = `Bearer ${token}`;
    }

    const authHeader = process.env.PUBLIC_FLOW_DISCLOSURE_AUTH_HEADER;
    const authToken = process.env.PUBLIC_FLOW_DISCLOSURE_AUTH_TOKEN;
    if (authHeader && authToken) headers[authHeader] = authToken;

    if (!endpoint) {
      errors.push("PUBLIC_FLOW_DISCLOSURE_ENDPOINT not set");
      return {
        events: [],
        summary: {
          id: this.id,
          kind: this.kind,
          fetchedCount: 0,
          parsedCount: 0,
          insertedCount: 0,
          skippedCount: 0,
          errors,
        },
      };
    }

    try {
      const url = interpolate(endpoint, null, sinceISO);
      const json = await fetchJson(url, headers);
      const payload = (getByPath(json, path) ?? json) as unknown;
      const rows = Array.isArray(payload) ? payload : (payload ? [payload] : []);
      const events = rows.map((row) => mapLiveEvent(row as Record<string, unknown>, source));

      const summary: ConnectorSummary = {
        id: this.id,
        kind: this.kind,
        fetchedCount: rows.length,
        parsedCount: events.length,
        insertedCount: 0,
        skippedCount: 0,
        errors,
      };

      return { events, summary };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`[live-disclosure] ${message}`);
      logger.warn(`[publicFlow] live connector failed: ${message}`);
      return {
        events: [],
        summary: {
          id: this.id,
          kind: this.kind,
          fetchedCount: 0,
          parsedCount: 0,
          insertedCount: 0,
          skippedCount: 0,
          errors,
        },
      };
    }
  }
}

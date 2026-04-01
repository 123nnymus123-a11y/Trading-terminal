import {
  buildTedIntelSnapshot,
  type TedIntelNotice,
  type TedIntelSnapshot,
  type TedIntelTimeWindow,
} from "./tedIntel.js";

export type TedLiveErrorCode =
  | "ted_live_disabled"
  | "ted_base_url_missing"
  | "ted_api_key_missing"
  | "ted_api_key_invalid"
  | "ted_upstream_http_error"
  | "ted_upstream_invalid_payload"
  | "ted_upstream_unreachable";

export class TedLiveError extends Error {
  readonly code: TedLiveErrorCode;
  readonly status: number;
  readonly upstreamStatus?: number;

  constructor(
    code: TedLiveErrorCode,
    message: string,
    status: number,
    upstreamStatus?: number,
  ) {
    super(message);
    this.name = "TedLiveError";
    this.code = code;
    this.status = status;
    if (typeof upstreamStatus === "number") {
      this.upstreamStatus = upstreamStatus;
    }
  }
}

export type TedLiveConfig = {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  authHeader: string;
  timeoutMs: number;
  windowQueryParam: string;
};

export type TedLiveConfigPatch = Partial<TedLiveConfig>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTedSnapshot(value: unknown): value is TedIntelSnapshot {
  if (!isObject(value)) {
    return false;
  }
  return (
    typeof value.generatedAt === "string" &&
    typeof value.timeWindow === "string" &&
    Array.isArray(value.summaryCards) &&
    Array.isArray(value.radar) &&
    Array.isArray(value.sectors) &&
    Array.isArray(value.regions) &&
    Array.isArray(value.buyers) &&
    Array.isArray(value.suppliers) &&
    Array.isArray(value.watchlist) &&
    Array.isArray(value.mapFlows) &&
    Array.isArray(value.anomalies) &&
    isObject(value.dataVault) &&
    Array.isArray(value.supplyChainOverlay) &&
    isObject(value.panorama)
  );
}

function normalizeSnapshotMetadata(
  snapshot: TedIntelSnapshot,
  baseUrl: string,
): TedIntelSnapshot {
  const normalizedBase = (() => {
    try {
      return new URL(baseUrl).host;
    } catch {
      return baseUrl;
    }
  })();

  return {
    ...snapshot,
    generatedAt:
      typeof snapshot.generatedAt === "string" && snapshot.generatedAt
        ? snapshot.generatedAt
        : new Date().toISOString(),
    sourceUpdatedAt:
      typeof snapshot.sourceUpdatedAt === "string" && snapshot.sourceUpdatedAt
        ? snapshot.sourceUpdatedAt
        : snapshot.generatedAt,
    sourceMode: snapshot.sourceMode === "mock" ? "mock" : "live",
    sourceLabel:
      typeof snapshot.sourceLabel === "string" && snapshot.sourceLabel
        ? snapshot.sourceLabel
        : `Live TED feed (${normalizedBase || "remote source"})`,
  };
}

function normalizeWindow(value: unknown): TedIntelTimeWindow {
  if (value === "7d" || value === "30d" || value === "90d" || value === "1y") {
    return value;
  }
  return "90d";
}

function resolveApiKeyHeaderValue(authHeader: string, apiKey: string): string {
  if (authHeader.toLowerCase() !== "authorization") {
    return apiKey;
  }

  const trimmed = apiKey.trim();
  if (!trimmed) {
    return trimmed;
  }

  if (/^(bearer|basic)\s+/i.test(trimmed)) {
    return trimmed;
  }

  return `Bearer ${trimmed}`;
}

function isTedV3SearchUrl(baseUrl: string): boolean {
  try {
    const parsed = new URL(baseUrl);
    return /\/v3\/notices\/search\/?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function pickString(
  value: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

function extractTedV3Rows(payload: unknown): Record<string, unknown>[] {
  if (!isObject(payload)) {
    return [];
  }

  const candidates: unknown[] = [
    payload.results,
    payload.items,
    payload.notices,
    payload.content,
    payload.data,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter(isObject);
    }
  }

  return [];
}

function noticeTypeFromTitle(title: string): TedIntelNotice["noticeType"] {
  const normalized = title.toLowerCase();
  if (normalized.includes("award")) {
    return "award_notice";
  }
  if (normalized.includes("modification")) {
    return "contract_modification";
  }
  if (normalized.includes("competition")) {
    return "competition_notice";
  }
  if (normalized.includes("prior information") || normalized.includes("pin")) {
    return "pin";
  }
  return "contract_notice";
}

function stageFromNoticeType(
  noticeType: TedIntelNotice["noticeType"],
): TedIntelNotice["stage"] {
  if (noticeType === "award_notice" || noticeType === "contract_modification") {
    return "award";
  }
  if (noticeType === "competition_notice") {
    return "competition";
  }
  if (noticeType === "pin") {
    return "planning";
  }
  return "tendering";
}

function toIsoDateOrNow(value: string | null): string {
  if (!value) {
    return new Date().toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? new Date().toISOString()
    : parsed.toISOString();
}

function mapTedV3RowsToRadar(
  rows: Record<string, unknown>[],
): TedIntelNotice[] {
  return rows.slice(0, 60).map((row, index) => {
    const sourceId =
      pickString(row, [
        "publication-number",
        "publicationNumber",
        "notice-number",
        "noticeNumber",
        "id",
      ]) ?? `ted-v3-${index + 1}`;
    const title =
      pickString(row, [
        "BT-21-Notice",
        "title",
        "notice-title",
        "description",
      ]) ?? "TED procurement notice";
    const publishedAt = toIsoDateOrNow(
      pickString(row, ["publication-date", "publicationDate", "publishedAt"]),
    );
    const noticeType = noticeTypeFromTitle(title);

    return {
      id: `ted-v3-${sourceId}`,
      sourceId,
      title,
      buyerName:
        pickString(row, ["buyer-name", "buyerName", "organisation-name"]) ??
        "Public Buyer (TED)",
      buyerType: "public authority",
      buyerCountry:
        pickString(row, ["country", "buyer-country", "buyerCountry"]) ?? "EU",
      buyerRegion: "Europe",
      buyerCoordinates: { lat: 50.1109, lon: 8.6821 },
      stage: stageFromNoticeType(noticeType),
      noticeType,
      theme: "public procurement",
      secondaryThemes: [],
      valueEur: 0,
      currency: "EUR",
      publishedAt,
      placeOfPerformance: {
        country:
          pickString(row, ["country", "place-of-performance-country"]) ?? "EU",
        region: "Europe",
        coordinates: { lat: 50.1109, lon: 8.6821 },
      },
      strategicWeight: 60,
      confidence: 0.7,
      recurrence: 0.5,
      novelty: 0.5,
      urgency: 0.5,
      sourceUrl: `https://ted.europa.eu/en/notice/-/detail/${encodeURIComponent(sourceId)}`,
      cpvCodes: [],
      evidence: {
        directlyStatedFacts: [
          `Fetched from TED v3 search API as notice ${sourceId}.`,
        ],
        aiInference: [
          "Live TED ingestion is active; enrichments can layer on top of this raw notice feed.",
        ],
        confidence: 0.7,
        whyItMatters: [
          "Live procurement flow can now drive downstream TED intelligence panels.",
        ],
        linkedSystems: ["PANORAMA", "INTELLIGENCE", "DATA VAULT"],
      },
    };
  });
}

function buildLiveSnapshotFromTedV3(
  payload: unknown,
  windowDays: TedIntelTimeWindow,
  baseUrl: string,
): TedIntelSnapshot {
  const rows = extractTedV3Rows(payload);
  if (!rows.length) {
    throw new TedLiveError(
      "ted_upstream_invalid_payload",
      "TED v3 payload did not contain result rows",
      502,
    );
  }

  const radar = mapTedV3RowsToRadar(rows);
  const base = buildTedIntelSnapshot(windowDays);
  const sourceUpdatedAt = radar.reduce(
    (latest, notice) =>
      notice.publishedAt > latest ? notice.publishedAt : latest,
    base.sourceUpdatedAt,
  );

  return normalizeSnapshotMetadata(
    {
      ...base,
      generatedAt: new Date().toISOString(),
      sourceUpdatedAt,
      timeWindow: windowDays,
      radar,
      summaryCards: [
        {
          label: "Live notices",
          value: String(radar.length),
          delta: "Live API",
          tone: "positive",
          detail: "Rows from TED v3 /notices/search",
        },
        ...base.summaryCards.slice(1),
      ],
      sourceLabel: "TED v3 Search API",
      sourceMode: "live",
    },
    baseUrl,
  );
}

export async function fetchLiveTedSnapshotStrict(
  config: TedLiveConfig,
  windowDays: TedIntelTimeWindow,
): Promise<TedIntelSnapshot> {
  if (!config.enabled) {
    throw new TedLiveError(
      "ted_live_disabled",
      "TED live feed is disabled",
      503,
    );
  }

  if (!config.baseUrl) {
    throw new TedLiveError(
      "ted_base_url_missing",
      "TED base URL is not configured",
      503,
    );
  }

  if (!config.apiKey.trim()) {
    throw new TedLiveError(
      "ted_api_key_missing",
      "TED API key is missing",
      503,
    );
  }

  const url = new URL(config.baseUrl);
  if (!isTedV3SearchUrl(config.baseUrl)) {
    url.searchParams.set(config.windowQueryParam, windowDays);
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    [config.authHeader]: resolveApiKeyHeaderValue(
      config.authHeader,
      config.apiKey,
    ),
  };

  try {
    const response = await fetch(url.toString(), {
      method: isTedV3SearchUrl(config.baseUrl) ? "POST" : "GET",
      headers: {
        ...headers,
        ...(isTedV3SearchUrl(config.baseUrl)
          ? { "Content-Type": "application/json" }
          : {}),
      },
      ...(isTedV3SearchUrl(config.baseUrl)
        ? {
            body: JSON.stringify({
              query: "*",
              limit: 60,
              page: 1,
              fields: [
                "publication-number",
                "BT-21-Notice",
                "publication-date",
              ],
            }),
          }
        : {}),
      signal: AbortSignal.timeout(config.timeoutMs),
    });

    if (!response.ok) {
      const code =
        response.status === 401 || response.status === 403
          ? "ted_api_key_invalid"
          : "ted_upstream_http_error";
      throw new TedLiveError(
        code,
        `TED upstream request failed with HTTP ${response.status}`,
        502,
        response.status,
      );
    }

    const payload = (await response.json()) as unknown;

    if (isTedV3SearchUrl(config.baseUrl)) {
      return buildLiveSnapshotFromTedV3(payload, windowDays, config.baseUrl);
    }

    // Accept either a direct snapshot or an envelope with snapshot key.
    if (isTedSnapshot(payload)) {
      return normalizeSnapshotMetadata(
        {
          ...payload,
          timeWindow: normalizeWindow(payload.timeWindow),
        },
        config.baseUrl,
      );
    }

    if (isObject(payload) && isTedSnapshot(payload.snapshot)) {
      return normalizeSnapshotMetadata(
        {
          ...payload.snapshot,
          timeWindow: normalizeWindow(payload.snapshot.timeWindow),
        },
        config.baseUrl,
      );
    }

    throw new TedLiveError(
      "ted_upstream_invalid_payload",
      "TED upstream payload does not match expected schema",
      502,
    );
  } catch (error) {
    if (error instanceof TedLiveError) {
      throw error;
    }

    throw new TedLiveError(
      "ted_upstream_unreachable",
      error instanceof Error
        ? `TED upstream unreachable: ${error.message}`
        : "TED upstream unreachable",
      502,
    );
  }
}

export async function fetchLiveTedSnapshot(
  config: TedLiveConfig,
  windowDays: TedIntelTimeWindow,
): Promise<TedIntelSnapshot | null> {
  try {
    return await fetchLiveTedSnapshotStrict(config, windowDays);
  } catch {
    return null;
  }
}

export function getTedLiveConfigStatus(config: TedLiveConfig) {
  return {
    enabled: config.enabled,
    baseUrl: config.baseUrl,
    hasApiKey: Boolean(config.apiKey),
    authHeader: config.authHeader,
    timeoutMs: config.timeoutMs,
    windowQueryParam: config.windowQueryParam,
  };
}

export function applyTedLiveConfigPatch(
  current: TedLiveConfig,
  patch: TedLiveConfigPatch,
): TedLiveConfig {
  const next: TedLiveConfig = {
    ...current,
    ...(typeof patch.enabled === "boolean" ? { enabled: patch.enabled } : {}),
    ...(typeof patch.baseUrl === "string"
      ? { baseUrl: patch.baseUrl.trim() }
      : {}),
    ...(typeof patch.apiKey === "string"
      ? { apiKey: patch.apiKey.trim() }
      : {}),
    ...(typeof patch.authHeader === "string"
      ? { authHeader: patch.authHeader.trim() || current.authHeader }
      : {}),
    ...(typeof patch.timeoutMs === "number" && Number.isFinite(patch.timeoutMs)
      ? { timeoutMs: Math.max(1000, Math.round(patch.timeoutMs)) }
      : {}),
    ...(typeof patch.windowQueryParam === "string"
      ? {
          windowQueryParam:
            patch.windowQueryParam.trim() || current.windowQueryParam,
        }
      : {}),
  };

  if (next.baseUrl) {
    try {
      const parsed = new URL(next.baseUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        next.baseUrl = "";
      }
    } catch {
      next.baseUrl = "";
    }
  }

  return next;
}

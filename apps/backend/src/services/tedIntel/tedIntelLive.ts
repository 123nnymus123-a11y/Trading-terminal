import type { TedIntelSnapshot, TedIntelTimeWindow } from "./tedIntel.js";

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
  url.searchParams.set(config.windowQueryParam, windowDays);

  const headers: Record<string, string> = {
    Accept: "application/json",
    [config.authHeader]: resolveApiKeyHeaderValue(
      config.authHeader,
      config.apiKey,
    ),
  };

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers,
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

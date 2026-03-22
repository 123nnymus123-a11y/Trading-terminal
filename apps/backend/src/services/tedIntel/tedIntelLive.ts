import type { TedIntelSnapshot, TedIntelTimeWindow } from "./tedIntel.js";

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

export async function fetchLiveTedSnapshot(
  config: TedLiveConfig,
  windowDays: TedIntelTimeWindow,
): Promise<TedIntelSnapshot | null> {
  if (!config.enabled || !config.baseUrl) {
    return null;
  }

  const url = new URL(config.baseUrl);
  url.searchParams.set(config.windowQueryParam, windowDays);

  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (config.apiKey) {
    headers[config.authHeader] = config.apiKey;
  }

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(config.timeoutMs),
    });

    if (!response.ok) {
      return null;
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

    return null;
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

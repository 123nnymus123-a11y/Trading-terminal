declare const __TC_BUILD_BACKEND_URL__: string | undefined;

export const LOCAL_BACKEND_URL = "http://localhost:8787";

const ALLOWED_INSECURE_HTTP_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
]);

function isAllowedInsecureHttpHost(hostname: string): boolean {
  return ALLOWED_INSECURE_HTTP_HOSTS.has(hostname.trim().toLowerCase());
}

export function normalizeBackendUrl(value: string): string | null {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    if (parsed.protocol === "http:" && !isAllowedInsecureHttpHost(parsed.hostname)) {
      return null;
    }

    return trimmed;
  } catch {
    return null;
  }
}

export function resolveBackendUrl(
  candidates: Array<string | null | undefined>,
  fallback = LOCAL_BACKEND_URL,
): string {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }

    const normalized = normalizeBackendUrl(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return fallback;
}

function getRuntimeEnvBackendCandidates(): Array<string | null | undefined> {
  if (typeof process === "undefined" || !process.env) {
    return [];
  }

  return [
    process.env.BACKEND_URL,
    process.env.TC_BACKEND_URL,
    process.env.VITE_BACKEND_URL,
    process.env.VITE_TC_BACKEND_URL,
  ];
}

export function getDefaultBackendUrl(
  candidates: Array<string | null | undefined> = [],
): string {
  const buildTimeCandidate =
    typeof __TC_BUILD_BACKEND_URL__ === "string"
      ? __TC_BUILD_BACKEND_URL__
      : undefined;

  return resolveBackendUrl(
    [...candidates, buildTimeCandidate, ...getRuntimeEnvBackendCandidates()],
    LOCAL_BACKEND_URL,
  );
}

export const DEFAULT_BACKEND_URL = getDefaultBackendUrl();
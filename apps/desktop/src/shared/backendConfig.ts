export const DEFAULT_BACKEND_URL = "http://79.76.40.72:8787";

const ALLOWED_INSECURE_HTTP_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "79.76.40.72",
]);

function isLocalHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

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
  fallback = DEFAULT_BACKEND_URL,
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
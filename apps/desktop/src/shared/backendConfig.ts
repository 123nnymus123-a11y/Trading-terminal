export const DEFAULT_BACKEND_URL = "http://localhost:8787";

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
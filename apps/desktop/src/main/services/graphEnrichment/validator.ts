import type { ConfidenceBand } from "./types";

export function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function computeConfidenceBand(score: number): ConfidenceBand {
  const v = clampScore(score);
  if (v >= 0.9) return "very_high";
  if (v >= 0.75) return "high";
  if (v >= 0.5) return "medium";
  if (v >= 0.25) return "low";
  return "very_low";
}

export function computeExpiryIso(fromIso: string, ttlDays = 30): string {
  const base = new Date(fromIso);
  const next = new Date(base.getTime());
  next.setUTCDate(next.getUTCDate() + Math.max(1, ttlDays));
  return next.toISOString();
}

export function inferTemperature(
  requestCount: number,
  lastRequestedAt: string,
): "hot" | "warm" | "cold" {
  const now = Date.now();
  const ageMs = now - new Date(lastRequestedAt).getTime();
  const days = ageMs / (1000 * 60 * 60 * 24);

  if (requestCount >= 15 && days <= 3) return "hot";
  if (requestCount >= 5 && days <= 14) return "warm";
  return "cold";
}

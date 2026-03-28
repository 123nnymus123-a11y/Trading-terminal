import crypto from 'node:crypto';

export function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, ' ');
}

export function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

export function canonicalizeText(input: string): string {
  return normalizeWhitespace(input.toLowerCase().replace(/[\p{P}\p{S}]+/gu, ' '));
}

export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function toIso(value: string | number | Date | undefined): string {
  if (!value) return new Date().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return new Date(value).toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

export function roundToDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

export function extractTickers(text: string, watchlist: string[] = []): string[] {
  const results = new Set<string>();
  const upperText = text.toUpperCase();

  const regex = /\$([A-Z]{1,5})\b/g;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(upperText))) {
    if (match[1]) {
      results.add(match[1]);
    }
  }

  for (const ticker of watchlist) {
    const t = ticker.toUpperCase().trim();
    if (!t) continue;
    if (upperText.includes(t)) results.add(t);
  }

  return Array.from(results);
}

export function jaccardSimilarity(aTokens: Set<string>, bTokens: Set<string>): number {
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) intersection += 1;
  }
  const union = aTokens.size + bTokens.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function tokenize(text: string): Set<string> {
  const tokens = text.split(/\s+/).filter(Boolean);
  return new Set(tokens);
}

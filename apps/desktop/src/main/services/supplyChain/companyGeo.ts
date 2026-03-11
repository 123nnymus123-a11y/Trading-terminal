import crypto from "node:crypto";

export interface CompanyGeo {
  lat: number;
  lon: number;
  city?: string;
  state?: string;
  country?: string;
  source: string;
  retrievalHash: string;
}

export interface CompanyGeoHints {
  city?: string;
  state?: string;
  country?: string;
}

const LEGAL_SUFFIX_PATTERN = /\b(incorporated|inc|corp|corporation|ltd|limited|llc|plc|ag|sa|nv|co|company|holdings?|group)\b/gi;
const COUNTRY_ALIASES: Record<string, string> = {
  usa: "united states",
  us: "united states",
  "u.s.": "united states",
  "u.s.a.": "united states",
  "united states of america": "united states",
  uk: "united kingdom",
  "u.k.": "united kingdom",
  uae: "united arab emirates",
};

function hash(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeCompanyKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}

function normalizeHintText(value?: string) {
  if (!value) return "";
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCountry(value?: string) {
  const normalized = normalizeHintText(value);
  if (!normalized) return "";
  return COUNTRY_ALIASES[normalized] ?? normalized;
}

function stripLegalSuffixes(value: string) {
  return value
    .replace(LEGAL_SUFFIX_PATTERN, " ")
    .replace(/[^a-zA-Z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildCompanyTokens(value: string) {
  return stripLegalSuffixes(value)
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

const curatedGeo: Record<string, Omit<CompanyGeo, "retrievalHash">> = {
  siemens: {
    lat: 48.1351,
    lon: 11.582,
    city: "Munich",
    country: "Germany",
    source: "curated",
  },
  siemensag: {
    lat: 48.1351,
    lon: 11.582,
    city: "Munich",
    country: "Germany",
    source: "curated",
  },
  apple: {
    lat: 37.3349,
    lon: -122.009,
    city: "Cupertino",
    state: "California",
    country: "United States",
    source: "curated",
  },
  aapl: {
    lat: 37.3349,
    lon: -122.009,
    city: "Cupertino",
    state: "California",
    country: "United States",
    source: "curated",
  },
  appleinc: {
    lat: 37.3349,
    lon: -122.009,
    city: "Cupertino",
    state: "California",
    country: "United States",
    source: "curated",
  },
};

function getCuratedGeo(companyName: string): CompanyGeo | null {
  const key = normalizeCompanyKey(companyName);
  const strippedKey = normalizeCompanyKey(stripLegalSuffixes(companyName));
  const hit = curatedGeo[key] ?? (strippedKey ? curatedGeo[strippedKey] : undefined);
  if (!hit) return null;
  return {
    ...hit,
    retrievalHash: hash(`curated|${key}|${hit.lat}|${hit.lon}`),
  };
}

async function fetchCandidates(query: string) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=6&addressdetails=1`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "TradingCockpit/1.0 (supply-chain-geocoder)",
    },
  });

  if (!res.ok) return [] as Array<{
    lat: string;
    lon: string;
    display_name?: string;
    importance?: number;
    class?: string;
    type?: string;
    address?: { city?: string; town?: string; village?: string; state?: string; country?: string };
  }>;

  return (await res.json()) as Array<{
    lat: string;
    lon: string;
    display_name?: string;
    importance?: number;
    class?: string;
    type?: string;
    address?: { city?: string; town?: string; village?: string; state?: string; country?: string };
  }>;
}

function scoreCandidates(
  companyName: string,
  hints: CompanyGeoHints | undefined,
  candidates: Array<{
    lat: string;
    lon: string;
    display_name?: string;
    importance?: number;
    class?: string;
    type?: string;
    address?: { city?: string; town?: string; village?: string; state?: string; country?: string };
  }>
) {
  const normalizedName = normalizeHintText(companyName);
  const nameTokens = buildCompanyTokens(companyName);
  const hintCity = normalizeHintText(hints?.city);
  const hintState = normalizeHintText(hints?.state);
  const hintCountry = normalizeCountry(hints?.country);

  return candidates.map((hit) => {
    let score = hit.importance ?? 0;
    const display = normalizeHintText(hit.display_name ?? "");
    const address = hit.address ?? {};
    const addressCity = normalizeHintText(address.city ?? address.town ?? address.village ?? "");
    const addressState = normalizeHintText(address.state ?? "");
    const addressCountry = normalizeCountry(address.country ?? "");

    if (display.includes(normalizedName)) score += 0.6;
    if (nameTokens.length > 0) {
      const matched = nameTokens.filter((token) => display.includes(token)).length;
      score += Math.min(0.5, matched * 0.18);
    }
    if (hintCity && (display.includes(hintCity) || addressCity.includes(hintCity))) score += 0.45;
    if (hintState && (display.includes(hintState) || addressState.includes(hintState))) score += 0.35;
    if (hintCountry && (display.includes(hintCountry) || addressCountry.includes(hintCountry))) score += 0.3;
    if (hit.class === "office" || hit.type === "office") score += 0.5;
    if (hit.type === "company") score += 0.4;
    if (display.includes("headquarters") || display.includes("hq")) score += 0.2;
    return { hit, score };
  });
}

export async function resolveCompanyGeo(companyName: string, hints?: CompanyGeoHints): Promise<CompanyGeo | null> {
  const curated = getCuratedGeo(companyName);
  if (curated) return curated;

  const cleanedName = stripLegalSuffixes(companyName) || companyName;
  const isTickerLike = /^[A-Z0-9]{1,5}$/.test(cleanedName.trim());
  const baseName = isTickerLike ? `${cleanedName} company` : cleanedName;
  const hintParts = [hints?.city, hints?.state, hints?.country].filter(Boolean).join(", ");
  const firstQuery = hintParts ? `${baseName} headquarters, ${hintParts}` : `${baseName} headquarters`;
  const secondQuery = hintParts ? `${baseName} HQ ${hintParts}` : `${baseName} headquarters address`;

  const firstCandidates = await fetchCandidates(firstQuery);
  const firstScored = scoreCandidates(companyName, hints, firstCandidates)
    .sort((a, b) => b.score - a.score);
  const firstBest = firstScored[0];

  const needSecondPass = !firstBest || (firstBest.score < 0.35 && hintParts);
  const secondCandidates = needSecondPass ? await fetchCandidates(secondQuery) : [];
  const secondScored = scoreCandidates(companyName, hints, secondCandidates)
    .sort((a, b) => b.score - a.score);

  const best = (secondScored[0] && (!firstBest || secondScored[0].score > firstBest.score + 0.05))
    ? secondScored[0]
    : firstBest;

  const hit = best?.hit;
  if (!hit) return null;

  const lat = Number(hit.lat);
  const lon = Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const address = hit.address ?? {};
  const city = address.city ?? address.town ?? address.village;
  const state = address.state;
  const country = address.country;
  return {
    lat,
    lon,
    ...(city ? { city } : {}),
    ...(state ? { state } : {}),
    ...(country ? { country } : {}),
    source: "nominatim",
    retrievalHash: hash(`${companyName}|${hit.lat}|${hit.lon}`),
  };
}

export function parseCoordinate(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function isValidLatLon(lat: number | null, lon: number | null) {
  if (lat === null || lon === null) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

export function encodeGeoPlaceCode(
  lat: number,
  lon: number,
): string | undefined {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return undefined;
  return `geo:${lat.toFixed(6)},${lon.toFixed(6)}`;
}

function normalizeLocationToken(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function makeAddressPlaceCode(
  parts: Array<string | undefined>,
): string | undefined {
  const tokens = parts
    .filter(
      (part): part is string =>
        typeof part === "string" && part.trim().length > 0,
    )
    .map((part) => normalizeLocationToken(part))
    .filter((part) => part.length > 0)
    .slice(0, 3);

  if (tokens.length === 0) return undefined;
  return `addr:${tokens.join("|")}`;
}

export function decodePlaceCode(
  value: unknown,
): { lat: number; lon: number } | null {
  if (typeof value !== "string") return null;
  const code = value.trim();
  if (!code) return null;

  if (!code.startsWith("geo:")) {
    return null;
  }

  const payload = code.slice(4);
  const [latRaw, lonRaw] = payload.split(",");
  const lat = parseCoordinate(latRaw);
  const lon = parseCoordinate(lonRaw);
  if (!isValidLatLon(lat, lon)) return null;
  return { lat: lat as number, lon: lon as number };
}

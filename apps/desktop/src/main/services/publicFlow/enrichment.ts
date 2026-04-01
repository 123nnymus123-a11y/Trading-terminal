import fs from "node:fs";
import path from "node:path";

type TickerMetadata = Record<string, { sector: string; industry: string }>;

type Enrichable = {
  ticker: string | null;
  sector: string | null;
  industry: string | null;
};

let metadataCache: TickerMetadata | null = null;
let metadataLoadAttempted = false;

function resolveMetadataPath(): string | null {
  const buildPath = path.join(__dirname, "data", "ticker_metadata.json");
  const sourcePath = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "src",
    "main",
    "services",
    "publicFlow",
    "data",
    "ticker_metadata.json"
  );

  if (fs.existsSync(buildPath)) return buildPath;
  if (fs.existsSync(sourcePath)) return sourcePath;
  return null;
}

function loadMetadata(): TickerMetadata {
  if (metadataCache) return metadataCache;
  const metadataPath = resolveMetadataPath();
  if (!metadataPath) {
    if (!metadataLoadAttempted) {
      console.warn("[PublicFlow][enrichment] ticker_metadata.json not found; skipping enrichment");
      metadataLoadAttempted = true;
    }
    metadataCache = {};
    return metadataCache;
  }

  try {
    const raw = fs.readFileSync(metadataPath, "utf-8");
    metadataCache = JSON.parse(raw) as TickerMetadata;
  } catch (error) {
    console.error("[PublicFlow][enrichment] Failed to load ticker metadata:", error);
    metadataCache = {};
  }

  metadataLoadAttempted = true;
  return metadataCache;
}

export function lookupTickerMetadata(ticker: string | null): { sector: string; industry: string } | null {
  if (!ticker) return null;
  const metadata = loadMetadata();
  return metadata[ticker.toUpperCase()] ?? null;
}

export function enrichEvents<T extends Enrichable>(events: T[]): T[] {
  if (events.length === 0) return events;
  const metadata = loadMetadata();

  return events.map((event) => {
    if (!event.ticker) return event;
    const meta = metadata[event.ticker.toUpperCase()];
    if (!meta) return event;

    if ((event.sector && event.industry) || (!event.sector && !event.industry)) {
      return event;
    }

    return {
      ...event,
      sector: event.sector ?? meta.sector,
      industry: event.industry ?? meta.industry,
    } as T;
  });
}

import fs from "node:fs";
import path from "node:path";
import type { InsertWatchlistCandidate } from "@tc/shared";
import { PublicFlowRepo } from "../../persistence/publicFlowRepo";
import type { ThemeDetail, HotTicker } from "./themeEngine";

interface RelationshipData {
  peers: Record<string, string[]>;
  supplyChain: Record<string, string[]>;
  etfConstituents: Record<string, string[]>;
}

interface EtfCandidate {
  ticker: string;
  viaEtf: string;
}

const RELATION_PRIORITY: Record<InsertWatchlistCandidate["relation_type"], number> = {
  peer: 3,
  supplier: 2,
  customer: 1, // not used yet but kept for compatibility
  "etf-constituent": 1,
};

const MAX_CANDIDATES_PER_THEME = 15;
const MAX_HOT_TICKERS_PER_THEME = 3;

let relationshipsCache: RelationshipData | null = null;

function resolveRelationshipsPath(): string | null {
  const buildPath = path.join(__dirname, "data", "relationships.json");
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
    "relationships.json"
  );
  if (fs.existsSync(buildPath)) return buildPath;
  if (fs.existsSync(sourcePath)) return sourcePath;
  return null;
}

function loadRelationships(): RelationshipData {
  if (relationshipsCache) return relationshipsCache;
  const filePath = resolveRelationshipsPath();
  if (!filePath) {
    console.warn("[SecondOrder] relationships.json not found; skipping second-order generation");
    relationshipsCache = { peers: {}, supplyChain: {}, etfConstituents: {} };
    return relationshipsCache;
  }

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    relationshipsCache = JSON.parse(raw) as RelationshipData;
  } catch (error) {
    console.error("[SecondOrder] Failed to load relationships:", error);
    relationshipsCache = { peers: {}, supplyChain: {}, etfConstituents: {} };
  }

  return relationshipsCache;
}

function normalizeKey(value: string): string {
  return value.toUpperCase();
}

function gatherPeerCandidates(ticker: string, data: RelationshipData): string[] {
  return data.peers[normalizeKey(ticker)] ?? [];
}

function gatherSupplyChainCandidates(ticker: string, data: RelationshipData): string[] {
  return data.supplyChain[normalizeKey(ticker)] ?? [];
}

function gatherEtfCandidates(ticker: string, data: RelationshipData): EtfCandidate[] {
  const results: EtfCandidate[] = [];
  const target = normalizeKey(ticker);
  for (const [etf, constituents] of Object.entries(data.etfConstituents)) {
    const normalizedConstituents = constituents.map(normalizeKey);
    if (!normalizedConstituents.includes(target)) continue;
    // include the ETF itself
    results.push({ ticker: etf, viaEtf: etf });
    for (const constituent of constituents) {
      if (normalizeKey(constituent) === target) continue;
      results.push({ ticker: constituent, viaEtf: etf });
    }
  }
  return results;
}

function buildRationale(
  relation: InsertWatchlistCandidate["relation_type"],
  candidate: string,
  hotTicker: HotTicker,
  theme: ThemeDetail,
  via?: string
): string {
  const intensity = hotTicker.score >= 70 ? "surging" : hotTicker.score >= 40 ? "warming" : "stabilizing";
  const relStr = relation === "etf-constituent" ? "etf-constituent" : relation;
  switch (relStr) {
    case "peer":
      return `${candidate} is a direct peer of ${hotTicker.ticker}, which is ${intensity} within ${theme.sector}.`;
    case "supplier":
      return `${candidate} supplies ${hotTicker.ticker} and should feel follow-on demand if ${theme.sector} stays hot.`;
    case "customer":
      return `${candidate} purchases from ${hotTicker.ticker}; watch for downstream pull-through.`;
    case "etf-constituent":
      if (via && via === candidate) {
        return `${candidate} ETF provides packaged exposure to ${hotTicker.ticker} and its ${theme.sector} trend.`;
      }
      return `${candidate} shares ${via ?? "ETF"} exposure with ${hotTicker.ticker}, offering indirect access to the theme.`;
    default:
      return `${candidate} is related to ${hotTicker.ticker} as ${relation}.`;
  }
}

export interface SecondOrderSummary {
  inserted: number;
  themeCount: number;
  hotTickerCount: number;
}

export const SecondOrder = {
  generateCandidates(themeDetails: ThemeDetail[]): SecondOrderSummary {
    if (themeDetails.length === 0) {
      return { inserted: 0, themeCount: 0, hotTickerCount: 0 };
    }

    const relationships = loadRelationships();
    const now = new Date().toISOString();
    let inserted = 0;
    let hotTickerCount = 0;

    for (const theme of themeDetails) {
      if (!theme.id) continue;
      const hotTickers = theme.hotTickers.slice(0, MAX_HOT_TICKERS_PER_THEME);
      if (hotTickers.length === 0) continue;
      hotTickerCount += hotTickers.length;

      const candidateMap = new Map<
        string,
        { relation_type: InsertWatchlistCandidate["relation_type"]; rationale: string }
      >();

      const pushCandidate = (
        ticker: string,
        relation_type: InsertWatchlistCandidate["relation_type"],
        rationale: string
      ) => {
        if (!ticker || ticker === "") return;
        if (hotTickers.some((hot) => hot.ticker === ticker)) return;
        const existing = candidateMap.get(ticker);
        if (!existing || RELATION_PRIORITY[relation_type] > RELATION_PRIORITY[existing.relation_type]) {
          candidateMap.set(ticker, { relation_type, rationale });
        }
      };

      for (const hotTicker of hotTickers) {
        const peers = gatherPeerCandidates(hotTicker.ticker, relationships);
        peers.forEach((ticker) =>
          pushCandidate(
            ticker,
            "peer",
            buildRationale("peer", ticker, hotTicker, theme)
          )
        );

        const suppliers = gatherSupplyChainCandidates(hotTicker.ticker, relationships);
        suppliers.forEach((ticker) =>
          pushCandidate(
            ticker,
            "supplier",
            buildRationale("supplier", ticker, hotTicker, theme)
          )
        );

        const etfRelated = gatherEtfCandidates(hotTicker.ticker, relationships);
        etfRelated.forEach(({ ticker, viaEtf }) =>
          pushCandidate(
            ticker,
            "etf-constituent",
            buildRationale("etf-constituent", ticker, hotTicker, theme, viaEtf)
          )
        );
      }

      const candidateEntries = Array.from(candidateMap.entries())
        .slice(0, MAX_CANDIDATES_PER_THEME)
        .map(([ticker, info]) => ({
          theme_id: theme.id,
          ticker,
          rationale: info.rationale,
          relation_type: info.relation_type,
          created_at: now,
        }));

      if (candidateEntries.length === 0) continue;
      const ids = PublicFlowRepo.upsertWatchlistCandidates(candidateEntries);
      inserted += ids.length;
    }

    return { inserted, themeCount: themeDetails.length, hotTickerCount };
  },
};

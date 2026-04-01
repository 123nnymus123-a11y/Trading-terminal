import type { CongressTrade, PublicFlowEvent } from "./contracts.js";

export type WatchlistItem = { id: number; symbol: string; note: string };

export type Order = {
  orderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  qty: number;
  type: string;
  limitPrice?: number;
  stopPrice?: number;
  status: "PENDING" | "FILLED" | "CANCELLED" | "REJECTED";
  filledQty: number;
  avgFillPrice: number;
  createdAt: number;
  updatedAt: number;
};

type Position = {
  symbol: string;
  qty: number;
  avgPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
};

type Account = {
  balance: number;
  equity: number;
  buyingPower: number;
  dailyPnl: number;
  dailyPnlPercent: number;
};

type CongressionalTradeRow = {
  id: number;
  person_name: string;
  chamber: "House" | "Senate";
  transaction_date: string;
  disclosure_date: string;
  transaction_type: string;
  asset_name_raw: string;
  ticker_normalized: string | null;
  asset_type: "stock" | "option" | "crypto" | "fund" | "bond" | "other";
  amount_range_low: number | null;
  amount_range_high: number | null;
  amount_currency: string;
  comments_raw: string | null;
  source_url: string | null;
  quality_flag_ticker_match: "confident" | "ambiguous" | "unmatched";
  quality_flag_amount: "complete" | "partial" | "missing";
  ingestion_timestamp: string;
  last_updated_timestamp: string;
};

type CongressionalMemberRow = {
  id: number;
  member_id: string;
  full_name: string;
  chamber: "House" | "Senate";
  party: string | null;
  state: string | null;
  district: string | null;
  committee_memberships: string | null;
  leadership_roles: string | null;
  seniority_indicator: string | null;
  office_term_start: string | null;
  office_term_end: string | null;
  bioguide_id: string | null;
  last_updated_timestamp: string;
};

type LobbyingRow = {
  id: number;
  record_id: string | null;
  reporting_entity_name: string;
  client_name: string;
  lobbying_amount: number | null;
  period_start: string | null;
  period_end: string | null;
  issues_topics_raw: string | null;
  naics_code: string | null;
  ticker_normalized: string | null;
  filing_reference_id: string | null;
  filing_url: string | null;
  ingestion_timestamp: string;
  last_updated_timestamp: string;
};

type ContractRow = {
  id: number;
  record_id: string | null;
  recipient_name: string;
  contractor_name: string;
  award_amount: number | null;
  award_currency: string;
  agency_name: string;
  award_date: string | null;
  period_start: string | null;
  period_end: string | null;
  naics_code: string | null;
  category_description: string | null;
  ticker_normalized: string | null;
  contract_reference_id: string | null;
  source_url: string | null;
  ingestion_timestamp: string;
  last_updated_timestamp: string;
};

type DisclosureRow = {
  id: number;
  source: string;
  source_url: string | null;
  entity_name: string;
  entity_type: "institution" | "insider" | "hedge-fund" | "etf" | "other";
  owner_type: "institutional" | "insider" | "beneficial-owner" | "other";
  ticker: string | null;
  asset_name: string;
  action: "BUY" | "SELL";
  tx_date: string;
  report_date: string;
  amount_min: number | null;
  amount_max: number | null;
  sector: string | null;
  industry: string | null;
  confidence: number;
  raw_json: string | null;
  created_at: string;
};

type SectorThemeRow = {
  id: number;
  window_days: 7 | 30;
  window_start: string;
  window_end: string;
  sector: string;
  score: number;
  summary: string;
  created_at: string;
};

type WatchlistCandidateRow = {
  id: number;
  theme_id: number;
  ticker: string;
  rationale: string;
  relation_type: "peer" | "supplier" | "customer" | "etf-constituent";
  created_at: string;
  importance_score?: number;
  confidence_score?: number;
  priority?: "critical" | "high" | "medium" | "low";
  theme_count?: number;
  freshness_days?: number;
  score_components?: {
    theme_momentum: number;
    relation_strength: number;
    diversity_bonus: number;
    freshness_boost: number;
  };
};

type ValuationTagRow = {
  ticker: string;
  tag: "overvalued" | "fair" | "undervalued";
  confidence: number;
  updated_at: string;
  basis: string[];
};

const nowIso = () => new Date().toISOString();

const congressSeed: CongressTrade[] = [
  {
    id: "ct-1",
    symbol: "AAPL",
    member: "Jane Doe",
    chamber: "house",
    side: "buy",
    amountBand: "$15,001 - $50,000",
    disclosedAt: new Date("2026-01-08T15:22:00.000Z").toISOString(),
    tradedAt: new Date("2025-12-29T14:30:00.000Z").toISOString(),
  },
  {
    id: "ct-2",
    symbol: "TSLA",
    member: "John Roe",
    chamber: "senate",
    side: "sell",
    amountBand: "$50,001 - $100,000",
    disclosedAt: new Date("2026-01-11T19:02:00.000Z").toISOString(),
    tradedAt: new Date("2026-01-04T13:00:00.000Z").toISOString(),
  },
];

const congressionalTrades: CongressionalTradeRow[] = [
  {
    id: 1,
    person_name: "Jane Doe",
    chamber: "House",
    transaction_date: new Date("2026-01-03T14:30:00.000Z").toISOString(),
    disclosure_date: new Date("2026-01-10T18:30:00.000Z").toISOString(),
    transaction_type: "buy",
    asset_name_raw: "Apple Inc.",
    ticker_normalized: "AAPL",
    asset_type: "stock",
    amount_range_low: 15001,
    amount_range_high: 50000,
    amount_currency: "USD",
    comments_raw: null,
    source_url: null,
    quality_flag_ticker_match: "confident",
    quality_flag_amount: "complete",
    ingestion_timestamp: nowIso(),
    last_updated_timestamp: nowIso(),
  },
  {
    id: 2,
    person_name: "John Roe",
    chamber: "Senate",
    transaction_date: new Date("2026-01-06T14:30:00.000Z").toISOString(),
    disclosure_date: new Date("2026-01-13T18:30:00.000Z").toISOString(),
    transaction_type: "sell",
    asset_name_raw: "Tesla Inc.",
    ticker_normalized: "TSLA",
    asset_type: "stock",
    amount_range_low: 50001,
    amount_range_high: 100000,
    amount_currency: "USD",
    comments_raw: null,
    source_url: null,
    quality_flag_ticker_match: "confident",
    quality_flag_amount: "complete",
    ingestion_timestamp: nowIso(),
    last_updated_timestamp: nowIso(),
  },
];

const congressionalMembers: CongressionalMemberRow[] = [
  {
    id: 1,
    member_id: "m1",
    full_name: "Jane Doe",
    chamber: "House",
    party: "D",
    state: "CA",
    district: "12",
    committee_memberships: null,
    leadership_roles: null,
    seniority_indicator: "mid",
    office_term_start: null,
    office_term_end: null,
    bioguide_id: null,
    last_updated_timestamp: nowIso(),
  },
  {
    id: 2,
    member_id: "m2",
    full_name: "John Roe",
    chamber: "Senate",
    party: "R",
    state: "TX",
    district: null,
    committee_memberships: null,
    leadership_roles: null,
    seniority_indicator: "senior",
    office_term_start: null,
    office_term_end: null,
    bioguide_id: null,
    last_updated_timestamp: nowIso(),
  },
];

const lobbyingActivities: LobbyingRow[] = [
  {
    id: 1,
    record_id: "l1",
    reporting_entity_name: "Policy Group LLC",
    client_name: "NVIDIA Corporation",
    lobbying_amount: 180000,
    period_start: "2026-01-01",
    period_end: "2026-03-31",
    issues_topics_raw: "Semiconductors; export controls",
    naics_code: null,
    ticker_normalized: "NVDA",
    filing_reference_id: null,
    filing_url: null,
    ingestion_timestamp: nowIso(),
    last_updated_timestamp: nowIso(),
  },
];

const federalContracts: ContractRow[] = [
  {
    id: 1,
    record_id: "c1",
    recipient_name: "Microsoft Corporation",
    contractor_name: "Microsoft Corporation",
    award_amount: 2_500_000,
    award_currency: "USD",
    agency_name: "Department of Defense",
    award_date: "2026-01-15",
    period_start: null,
    period_end: null,
    naics_code: null,
    category_description: "Cloud services",
    ticker_normalized: "MSFT",
    contract_reference_id: null,
    source_url: null,
    ingestion_timestamp: nowIso(),
    last_updated_timestamp: nowIso(),
  },
];

const publicFlowSeed: PublicFlowEvent[] = [
  {
    id: "pf-1",
    ticker: "NVDA",
    filingType: "8-K",
    theme: "AI Infrastructure",
    impactScore: 0.81,
    happenedAt: new Date("2026-02-01T12:00:00.000Z").toISOString(),
  },
  {
    id: "pf-2",
    ticker: "MSFT",
    filingType: "10-Q",
    theme: "Cloud Expansion",
    impactScore: 0.69,
    happenedAt: new Date("2026-02-05T16:42:00.000Z").toISOString(),
  },
];

const disclosureEvents: DisclosureRow[] = [
  {
    id: 1,
    source: "13F",
    source_url: null,
    entity_name: "Alpha Capital",
    entity_type: "hedge-fund",
    owner_type: "institutional",
    ticker: "NVDA",
    asset_name: "NVIDIA Corporation",
    action: "BUY",
    tx_date: new Date("2026-01-20T00:00:00.000Z").toISOString(),
    report_date: new Date("2026-02-10T00:00:00.000Z").toISOString(),
    amount_min: 100000,
    amount_max: 200000,
    sector: "Technology",
    industry: "Semiconductors",
    confidence: 0.84,
    raw_json: null,
    created_at: nowIso(),
  },
  {
    id: 2,
    source: "Form4",
    source_url: null,
    entity_name: "Insider Holdings",
    entity_type: "insider",
    owner_type: "insider",
    ticker: "MSFT",
    asset_name: "Microsoft Corporation",
    action: "BUY",
    tx_date: new Date("2026-01-28T00:00:00.000Z").toISOString(),
    report_date: new Date("2026-02-04T00:00:00.000Z").toISOString(),
    amount_min: 50000,
    amount_max: 75000,
    sector: "Technology",
    industry: "Software",
    confidence: 0.72,
    raw_json: null,
    created_at: nowIso(),
  },
];

const sectorThemes: SectorThemeRow[] = [
  {
    id: 1,
    window_days: 7,
    window_start: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(),
    window_end: nowIso(),
    sector: "Technology",
    score: 84,
    summary:
      "Technology disclosures remain buy-skewed with AI-heavy concentration.",
    created_at: nowIso(),
  },
  {
    id: 2,
    window_days: 30,
    window_start: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
    window_end: nowIso(),
    sector: "Industrials",
    score: 61,
    summary: "Industrials flows show selective accumulation.",
    created_at: nowIso(),
  },
];

const watchlistCandidates: WatchlistCandidateRow[] = [
  {
    id: 1,
    theme_id: 1,
    ticker: "NVDA",
    rationale: "Core AI beneficiary with recurring institutional accumulation.",
    relation_type: "peer",
    created_at: nowIso(),
  },
  {
    id: 2,
    theme_id: 1,
    ticker: "MSFT",
    rationale: "Cloud/AI infrastructure overlap.",
    relation_type: "peer",
    created_at: nowIso(),
  },
];

const valuationTags: Record<string, ValuationTagRow> = {
  NVDA: {
    ticker: "NVDA",
    tag: "fair",
    confidence: 0.64,
    updated_at: nowIso(),
    basis: ["Growth premium partially offset by strong FCF trend"],
  },
  MSFT: {
    ticker: "MSFT",
    tag: "undervalued",
    confidence: 0.58,
    updated_at: nowIso(),
    basis: ["Relative multiple below software mega-cap peer median"],
  },
  AAPL: {
    ticker: "AAPL",
    tag: "fair",
    confidence: 0.62,
    updated_at: nowIso(),
    basis: ["Balanced earnings quality and valuation multiple"],
  },
};

const userSettings = new Map<string, Record<string, unknown>>();
const userWatchlists = new Map<string, WatchlistItem[]>();
const userOrders = new Map<string, Order[]>();
const userPositions = new Map<string, Position[]>();
const userAccounts = new Map<string, Account>();
const supplyChainCache = new Map<string, unknown>();

function ensureUserCollections(userId: string) {
  if (!userWatchlists.has(userId)) {
    userWatchlists.set(userId, [
      { id: 1, symbol: "AAPL", note: "Core tech" },
      { id: 2, symbol: "MSFT", note: "Cloud" },
    ]);
  }
  if (!userOrders.has(userId)) {
    userOrders.set(userId, []);
  }
  if (!userPositions.has(userId)) {
    userPositions.set(userId, []);
  }
  if (!userAccounts.has(userId)) {
    userAccounts.set(userId, {
      balance: 100000,
      equity: 100000,
      buyingPower: 200000,
      dailyPnl: 0,
      dailyPnlPercent: 0,
    });
  }
}

export function listCongressTrades(
  symbol?: string,
  limit?: number,
): CongressTrade[] {
  const normalized = symbol?.trim().toUpperCase();
  const filtered = normalized
    ? congressSeed.filter((item) => item.symbol === normalized)
    : congressSeed;
  const capped = Math.max(1, Math.min(limit ?? 50, 200));
  return filtered.slice(0, capped);
}

export function queryCongressionalTrades(filters: {
  person_name?: string;
  chamber?: string;
  ticker?: string;
  transaction_date_start?: string;
  transaction_date_end?: string;
  limit?: number;
}) {
  const filtered = congressionalTrades.filter((row) => {
    if (
      filters.person_name &&
      !row.person_name.toLowerCase().includes(filters.person_name.toLowerCase())
    )
      return false;
    if (filters.chamber && row.chamber !== filters.chamber) return false;
    if (
      filters.ticker &&
      row.ticker_normalized !== filters.ticker.toUpperCase()
    )
      return false;
    if (
      filters.transaction_date_start &&
      row.transaction_date < filters.transaction_date_start
    )
      return false;
    if (
      filters.transaction_date_end &&
      row.transaction_date > filters.transaction_date_end
    )
      return false;
    return true;
  });
  const capped = Math.max(1, Math.min(filters.limit ?? 100, 500));
  return filtered.slice(0, capped);
}

export function queryCongressionalMembers(limit = 100) {
  return congressionalMembers.slice(0, Math.max(1, Math.min(limit, 500)));
}

export function queryLobbyingActivities(limit = 100) {
  return lobbyingActivities.slice(0, Math.max(1, Math.min(limit, 500)));
}

export function queryFederalContracts(limit = 100) {
  return federalContracts.slice(0, Math.max(1, Math.min(limit, 500)));
}

export function getMostTradedTickers(limit = 10) {
  const map = new Map<
    string,
    {
      ticker: string;
      trade_count: number;
      buy_count: number;
      sell_count: number;
    }
  >();
  for (const row of congressionalTrades) {
    const ticker = row.ticker_normalized ?? "UNKNOWN";
    if (!map.has(ticker)) {
      map.set(ticker, { ticker, trade_count: 0, buy_count: 0, sell_count: 0 });
    }
    const current = map.get(ticker)!;
    current.trade_count += 1;
    if (row.transaction_type.toLowerCase().includes("buy"))
      current.buy_count += 1;
    if (row.transaction_type.toLowerCase().includes("sell"))
      current.sell_count += 1;
  }
  return [...map.values()]
    .sort((a, b) => b.trade_count - a.trade_count)
    .slice(0, limit);
}

export function getDisclosureLagStats() {
  if (!congressionalTrades.length) return null;
  const lags = congressionalTrades.map((row) => {
    const tx = Date.parse(row.transaction_date);
    const disclosure = Date.parse(row.disclosure_date);
    return Math.max(0, (disclosure - tx) / (24 * 3600 * 1000));
  });
  const sorted = [...lags].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[mid - 1]! + sorted[mid]!) / 2
      : sorted[mid]!;
  const avg = lags.reduce((a, b) => a + b, 0) / lags.length;
  const max = Math.max(...lags);
  return {
    avg_lag_days: Number(avg.toFixed(2)),
    median_lag_days: Number(median.toFixed(2)),
    max_lag_days: Number(max.toFixed(2)),
  };
}

export function listPublicFlowEvents(
  ticker?: string,
  limit?: number,
): PublicFlowEvent[] {
  const normalized = ticker?.trim().toUpperCase();
  const filtered = normalized
    ? publicFlowSeed.filter((item) => item.ticker === normalized)
    : publicFlowSeed;
  const capped = Math.max(1, Math.min(limit ?? 50, 200));
  return filtered.slice(0, capped);
}

export function getDisclosureEvents(limit = 50) {
  return disclosureEvents.slice(0, Math.max(1, Math.min(limit, 500)));
}

export function getSectorThemes(windowDays: 7 | 30, limit = 10) {
  return sectorThemes
    .filter((item) => item.window_days === windowDays)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(limit, 100)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toCandidatePriority(
  score: number,
): "critical" | "high" | "medium" | "low" {
  if (score >= 80) return "critical";
  if (score >= 65) return "high";
  if (score >= 45) return "medium";
  return "low";
}

function rankCandidate(
  candidate: WatchlistCandidateRow,
  themeScore: number,
  themeCount: number,
): WatchlistCandidateRow {
  const relationStrengthMap: Record<
    WatchlistCandidateRow["relation_type"],
    number
  > = {
    peer: 1,
    supplier: 0.8,
    customer: 0.65,
    "etf-constituent": 0.5,
  };
  const relationStrength = relationStrengthMap[candidate.relation_type] ?? 0.5;
  const themeMomentum = clamp(themeScore / 100, 0, 1);
  const diversityBonus = clamp(themeCount / 4, 0, 1);

  const ageMs = Math.max(0, Date.now() - Date.parse(candidate.created_at));
  const freshnessDays = ageMs / (24 * 60 * 60 * 1000);
  const freshnessBoost = clamp(Math.exp(-freshnessDays / 30), 0, 1);

  const score0to1 = clamp(
    themeMomentum * 0.45 +
      relationStrength * 0.3 +
      diversityBonus * 0.15 +
      freshnessBoost * 0.1,
    0,
    1,
  );
  const importanceScore = Number((score0to1 * 100).toFixed(1));
  const confidenceScore = Number(
    clamp(
      themeMomentum * 0.45 + relationStrength * 0.4 + freshnessBoost * 0.15,
      0,
      1,
    ).toFixed(3),
  );

  return {
    ...candidate,
    importance_score: importanceScore,
    confidence_score: confidenceScore,
    priority: toCandidatePriority(importanceScore),
    theme_count: themeCount,
    freshness_days: Number(freshnessDays.toFixed(1)),
    score_components: {
      theme_momentum: Number(themeMomentum.toFixed(3)),
      relation_strength: Number(relationStrength.toFixed(3)),
      diversity_bonus: Number(diversityBonus.toFixed(3)),
      freshness_boost: Number(freshnessBoost.toFixed(3)),
    },
  };
}

export function getWatchlistCandidates(
  themeId: number,
  options?: {
    minPriority?: "critical" | "high" | "medium" | "low";
    minConfidence?: number;
  },
) {
  const priorityRank = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  } as const;

  const themeScore =
    sectorThemes.find((theme) => theme.id === themeId)?.score ?? 50;
  const themeCountByTicker = watchlistCandidates.reduce<Record<string, number>>(
    (acc, item) => {
      const key = item.ticker.toUpperCase();
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    },
    {},
  );

  const minPriorityRank = options?.minPriority
    ? priorityRank[options.minPriority]
    : 0;
  const minConfidence =
    typeof options?.minConfidence === "number"
      ? clamp(options.minConfidence, 0, 1)
      : undefined;

  return watchlistCandidates
    .filter((item) => item.theme_id === themeId)
    .map((item) =>
      rankCandidate(
        item,
        themeScore,
        themeCountByTicker[item.ticker.toUpperCase()] ?? 1,
      ),
    )
    .filter((item) => {
      const rankedPriority = item.priority ? priorityRank[item.priority] : 0;
      if (rankedPriority < minPriorityRank) return false;
      if (
        typeof minConfidence === "number" &&
        typeof item.confidence_score === "number" &&
        item.confidence_score < minConfidence
      ) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      const scoreDelta = (b.importance_score ?? 0) - (a.importance_score ?? 0);
      if (scoreDelta !== 0) return scoreDelta;
      const confidenceDelta =
        (b.confidence_score ?? 0) - (a.confidence_score ?? 0);
      if (confidenceDelta !== 0) return confidenceDelta;
      return Date.parse(b.created_at) - Date.parse(a.created_at);
    });
}

export function getValuationTags(tickers: string[]) {
  const out: Record<string, ValuationTagRow> = {};
  for (const ticker of tickers) {
    const normalized = ticker.toUpperCase();
    if (valuationTags[normalized]) {
      out[normalized] = valuationTags[normalized];
    }
  }
  return out;
}

export function getUserSettings(userId: string) {
  return userSettings.get(userId) ?? {};
}

export function updateUserSettings(
  userId: string,
  next: Record<string, unknown>,
) {
  const previous = getUserSettings(userId);
  const merged = { ...previous, ...next };
  userSettings.set(userId, merged);
  return merged;
}

export function listUserWatchlists(userId: string) {
  ensureUserCollections(userId);
  return userWatchlists.get(userId)!;
}

export function addUserWatchlist(userId: string, symbol: string, note = "") {
  ensureUserCollections(userId);
  const current = userWatchlists.get(userId)!;
  const nextId = current.length
    ? Math.max(...current.map((item) => item.id)) + 1
    : 1;
  const item: WatchlistItem = {
    id: nextId,
    symbol: symbol.toUpperCase(),
    note,
  };
  current.push(item);
  return item;
}

export function updateUserWatchlist(
  userId: string,
  id: number,
  fields: { symbol?: string; note?: string },
) {
  ensureUserCollections(userId);
  const current = userWatchlists.get(userId)!;
  const index = current.findIndex((item) => item.id === id);
  if (index < 0) return null;
  const previous = current[index]!;
  const next: WatchlistItem = {
    ...previous,
    ...(fields.symbol ? { symbol: fields.symbol.toUpperCase() } : {}),
    ...(fields.note !== undefined ? { note: fields.note } : {}),
  };
  current[index] = next;
  return next;
}

export function removeUserWatchlist(userId: string, id: number) {
  ensureUserCollections(userId);
  const current = userWatchlists.get(userId)!;
  const before = current.length;
  userWatchlists.set(
    userId,
    current.filter((item) => item.id !== id),
  );
  return userWatchlists.get(userId)!.length !== before;
}

export function getOrders(userId: string) {
  ensureUserCollections(userId);
  return userOrders.get(userId)!;
}

export function getPositions(userId: string) {
  ensureUserCollections(userId);
  return userPositions.get(userId)!;
}

export function getAccount(userId: string) {
  ensureUserCollections(userId);
  return userAccounts.get(userId)!;
}

export function placeOrder(
  userId: string,
  req: {
    symbol: string;
    side: "BUY" | "SELL";
    qty: number;
    type: string;
    limitPrice?: number;
    stopPrice?: number;
  },
) {
  ensureUserCollections(userId);
  const now = Date.now();
  const order: Order = {
    orderId: `ord-${userId}-${now}`,
    symbol: req.symbol.toUpperCase(),
    side: req.side,
    qty: req.qty,
    type: req.type,
    ...(req.limitPrice !== undefined ? { limitPrice: req.limitPrice } : {}),
    ...(req.stopPrice !== undefined ? { stopPrice: req.stopPrice } : {}),
    status: "FILLED",
    filledQty: req.qty,
    avgFillPrice:
      req.limitPrice ?? Number((100 + Math.random() * 100).toFixed(2)),
    createdAt: now,
    updatedAt: now,
  };

  const orders = userOrders.get(userId)!;
  orders.unshift(order);

  const positions = userPositions.get(userId)!;
  const positionIndex = positions.findIndex(
    (position) => position.symbol === order.symbol,
  );
  const signedQty = order.side === "BUY" ? order.qty : -order.qty;
  if (positionIndex < 0) {
    positions.push({
      symbol: order.symbol,
      qty: signedQty,
      avgPrice: order.avgFillPrice,
      unrealizedPnl: 0,
      realizedPnl: 0,
    });
  } else {
    const existing = positions[positionIndex]!;
    const nextQty = existing.qty + signedQty;
    positions[positionIndex] = {
      ...existing,
      qty: nextQty,
      avgPrice: order.avgFillPrice,
      unrealizedPnl: Number(((Math.random() - 0.5) * 500).toFixed(2)),
    };
  }

  const account = userAccounts.get(userId)!;
  const orderNotional = order.avgFillPrice * order.qty;
  const cashDelta = order.side === "BUY" ? -orderNotional : orderNotional;
  userAccounts.set(userId, {
    ...account,
    balance: Number((account.balance + cashDelta).toFixed(2)),
    equity: Number((account.equity + Math.random() * 100 - 50).toFixed(2)),
    dailyPnl: Number((account.dailyPnl + Math.random() * 50 - 25).toFixed(2)),
    dailyPnlPercent: Number(
      (account.dailyPnlPercent + (Math.random() - 0.5) * 0.5).toFixed(2),
    ),
  });

  return order;
}

export function cancelOrder(userId: string, orderId: string) {
  ensureUserCollections(userId);
  const orders = userOrders.get(userId)!;
  const index = orders.findIndex((order) => order.orderId === orderId);
  if (index < 0) return false;
  const existing = orders[index]!;
  orders[index] = { ...existing, status: "CANCELLED", updatedAt: Date.now() };
  return true;
}

export function getSupplyChainCachedKeys() {
  return [...supplyChainCache.keys()];
}

export function clearSupplyChainCache(key: string) {
  return supplyChainCache.delete(key);
}

export function createSupplyChainMap(options: {
  ticker: string;
  globalTickers?: string[];
  strictMode?: boolean;
  includeHypothesis?: boolean;
  hops?: number;
  minEdgeWeight?: number;
}) {
  const center = options.ticker.toUpperCase();
  const generatedAt = nowIso();
  const data = {
    centerTicker: center,
    centerName: `${center} Corporation`,
    generatedAt,
    categories: [
      {
        id: "suppliers",
        name: "Suppliers",
        icon: "🏭",
        color: "#3b82f6",
        companies: [
          {
            id: `${center}-SUP1`,
            name: `${center} Supplier 1`,
            role: "Component supplier",
            criticality: 4,
            confidence: 0.71,
            verified: true,
          },
          {
            id: `${center}-SUP2`,
            name: `${center} Supplier 2`,
            role: "Logistics",
            criticality: 3,
            confidence: 0.68,
            verified: false,
          },
        ],
      },
      {
        id: "customers",
        name: "Customers",
        icon: "🛒",
        color: "#10b981",
        companies: [
          {
            id: `${center}-CUS1`,
            name: `${center} Customer 1`,
            role: "Enterprise client",
            criticality: 5,
            confidence: 0.8,
            verified: true,
          },
        ],
      },
    ],
    graph: {
      nodes: [
        {
          id: center,
          label: center,
          entityType: "company",
          tier: "direct",
          role: "Anchor",
          confidence: 1,
          criticality: 5,
        },
        {
          id: `${center}-SUP1`,
          label: `${center} Supplier 1`,
          entityType: "company",
          tier: "direct",
          confidence: 0.71,
          criticality: 4,
        },
        {
          id: `${center}-SUP2`,
          label: `${center} Supplier 2`,
          entityType: "company",
          tier: "direct",
          confidence: 0.68,
          criticality: 3,
        },
        {
          id: `${center}-CUS1`,
          label: `${center} Customer 1`,
          entityType: "company",
          tier: "direct",
          confidence: 0.8,
          criticality: 5,
        },
      ],
      edges: [
        {
          id: `e-${center}-1`,
          from: `${center}-SUP1`,
          to: center,
          kind: "supplies",
          confidence: 0.71,
          criticality: 4,
        },
        {
          id: `e-${center}-2`,
          from: `${center}-SUP2`,
          to: center,
          kind: "transports",
          confidence: 0.68,
          criticality: 3,
        },
        {
          id: `e-${center}-3`,
          from: center,
          to: `${center}-CUS1`,
          kind: "customer",
          confidence: 0.8,
          criticality: 5,
        },
      ],
    },
    insights: [`${center} has concentrated supplier risk in top-tier nodes.`],
    strictMode: options.strictMode ?? true,
    includeHypothesis: options.includeHypothesis ?? false,
    hops: options.hops ?? 2,
    minEdgeWeight: options.minEdgeWeight ?? 0,
    focalTickers: options.globalTickers ?? [center],
  };
  const cacheKey = `${center}|${(options.globalTickers ?? []).join(",")}|${options.strictMode ?? true}|${options.includeHypothesis ?? false}|${options.hops ?? 2}|${options.minEdgeWeight ?? 0}`;
  supplyChainCache.set(cacheKey, data);
  return { cacheKey, data };
}

export function computeIndicators(symbol: string, prices: number[]) {
  const safe = prices.length ? prices : [100, 101, 102, 101, 103];
  const latest = safe[safe.length - 1]!;
  const sma = safe.reduce((a, b) => a + b, 0) / safe.length;
  return {
    symbol: symbol.toUpperCase(),
    sma: Number(sma.toFixed(4)),
    latest,
    signal: latest >= sma ? "bullish" : "bearish",
  };
}

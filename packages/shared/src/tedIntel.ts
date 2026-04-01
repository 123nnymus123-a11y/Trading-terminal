// ─── Core Primitives ─────────────────────────────────────────────────────────

export type TedIntelTimeWindow = "7d" | "30d" | "90d" | "1y";

export type TedIntelLifecycleStage =
  | "planning"
  | "tendering"
  | "competition"
  | "award"
  | "execution";

export type TedIntelNoticeType =
  | "pin"
  | "contract_notice"
  | "competition_notice"
  | "award_notice"
  | "contract_modification";

export type TedIntelSeverity = "medium" | "high";

export type TedIntelCoordinates = {
  lat: number;
  lon: number;
};

export type TedIntelEvidenceSummary = {
  directlyStatedFacts: string[];
  aiInference: string[];
  confidence: number;
  whyItMatters: string[];
  linkedSystems: Array<
    "PANORAMA" | "INTELLIGENCE" | "SUPPLY CHAIN" | "DATA VAULT" | "GWMD MAP"
  >;
};

// ─── Notice (core procurement event) ─────────────────────────────────────────

export type TedIntelNotice = {
  id: string;
  sourceId: string;
  title: string;
  buyerName: string;
  buyerType: string;
  buyerCountry: string;
  buyerRegion: string;
  buyerCoordinates: TedIntelCoordinates;
  stage: TedIntelLifecycleStage;
  noticeType: TedIntelNoticeType;
  theme: string;
  secondaryThemes: string[];
  valueEur: number;
  currency: "EUR";
  publishedAt: string;
  deadlineAt?: string;
  placeOfPerformance: {
    country: string;
    region: string;
    coordinates: TedIntelCoordinates;
  };
  winner?: {
    name: string;
    country: string;
    parentCompany?: string | undefined;
    listedTickers?: string[];
  };
  strategicWeight: number;
  confidence: number;
  recurrence: number;
  novelty: number;
  urgency: number;
  sourceUrl: string;
  cpvCodes: string[];
  evidence: TedIntelEvidenceSummary;
};

// ─── Summary Cards ────────────────────────────────────────────────────────────

export type TedIntelSummaryCard = {
  label: string;
  value: string;
  delta: string;
  tone: "positive" | "neutral" | "elevated";
  detail: string;
};

// ─── Sector Momentum ─────────────────────────────────────────────────────────

export type TedIntelSectorMomentum = {
  theme: string;
  noticeCount: number;
  awardedCount: number;
  totalValueEur: number;
  momentumScore: number;
  stageMix: Partial<Record<TedIntelLifecycleStage, number>>;
};

// ─── Regional Heat ────────────────────────────────────────────────────────────

export type TedIntelRegionalHeat = {
  key: string;
  label: string;
  country: string;
  region: string;
  noticeCount: number;
  awardCount: number;
  totalValueEur: number;
  intensity: number;
  coordinates: TedIntelCoordinates;
};

// ─── Buyer / Supplier Pulse ───────────────────────────────────────────────────

export type TedIntelBuyerPulse = {
  buyerName: string;
  buyerType: string;
  country: string;
  activityScore: number;
  noticeCount: number;
  awardValueEur: number;
  topThemes: string[];
  stageBias: TedIntelLifecycleStage;
};

export type TedIntelSupplierPulse = {
  supplierName: string;
  country: string;
  parentCompany?: string | undefined;
  listedTickers: string[];
  awardCount: number;
  totalAwardValueEur: number;
  dependenceScore: number;
  strategicThemes: string[];
};

// ─── Watchlist & Map ──────────────────────────────────────────────────────────

export type TedIntelWatchlistHit = {
  ticker: string;
  company: string;
  relevanceScore: number;
  confidence: number;
  linkedNoticeIds: string[];
  buyerCount: number;
  themes: string[];
  rationale: string;
};

export type TedIntelMapFlow = {
  id: string;
  buyerName: string;
  winnerName: string;
  buyerCountry: string;
  winnerCountry: string;
  buyerCoordinates: TedIntelCoordinates;
  winnerCoordinates: TedIntelCoordinates;
  performanceCoordinates: TedIntelCoordinates;
  stage: TedIntelLifecycleStage;
  theme: string;
  valueEur: number;
  thickness: number;
  listedTickers: string[];
};

// ─── Anomaly ──────────────────────────────────────────────────────────────────

export type TedIntelAnomaly = {
  id: string;
  severity: TedIntelSeverity;
  title: string;
  detail: string;
  whyItMatters: string;
  linkedNoticeIds: string[];
};

// ─── Data Vault (legacy summary + new zone lifecycle) ─────────────────────────

export type TedIntelVaultSummary = {
  rawCount: number;
  normalizedCount: number;
  enrichedCount: number;
  lastIngestedAt: string;
  auditTrail: string[];
};

export type TedIntelVaultZone =
  | "raw"
  | "candidate"
  | "validated"
  | "production";

export type TedIntelVaultRecord = {
  noticeId: string;
  zone: TedIntelVaultZone;
  ingestedAt: string;
  normalizedAt?: string | undefined;
  enrichedAt?: string | undefined;
  validatedAt?: string | undefined;
  revalidatable: boolean;
  evidenceRefs: string[];
  exportEligible: boolean;
};

// ─── Supply Chain Overlay ─────────────────────────────────────────────────────

export type TedIntelSupplyChainOverlay = {
  ticker: string;
  company: string;
  exposureLabel: string;
  linkedAwardValueEur: number;
  confidence: number;
  buyerRelationships: Array<{
    buyerName: string;
    country: string;
    awardValueEur: number;
    theme: string;
  }>;
  secondOrderIdeas: string[];
};

// ─── Panorama Pulse ───────────────────────────────────────────────────────────

export type TedIntelPanoramaPulse = {
  headline: string;
  bullets: string[];
};

// ─── Entity Resolution Layer ──────────────────────────────────────────────────

export type TedIntelBuyerClassification =
  | "ministry"
  | "municipality"
  | "agency"
  | "central_purchasing_body"
  | "state_owned_entity"
  | "eu_agency"
  | "military"
  | "transmission_system_operator"
  | "distribution_system_operator"
  | "rail_operator"
  | "other";

export type TedIntelTickerMapping = {
  ticker: string;
  exchange: string;
  confidence: number;
  evidence: string;
};

export type TedIntelBuyerResolution = {
  raw: string;
  normalized: string;
  classification: TedIntelBuyerClassification;
  country: string;
  region: string;
  coordinates: TedIntelCoordinates;
  confidence: number;
  evidenceRef: string[];
};

export type TedIntelSupplierResolution = {
  raw: string;
  normalized: string;
  parentCompany?: string | undefined;
  parentConfidence: number;
  tickerMappings: TedIntelTickerMapping[];
  country: string;
  isCrossBorder: boolean;
  isPubliclyListed: boolean;
  evidenceRef: string[];
};

// ─── Procurement Signal Engine ────────────────────────────────────────────────

export type TedIntelSignalType =
  | "award_surge"
  | "new_entrant"
  | "concentration_shift"
  | "repeat_winner"
  | "cross_border_flow"
  | "value_spike"
  | "sector_cluster"
  | "momentum_acceleration"
  | "planning_to_award_conversion";

export type TedIntelSignalDimensions = {
  marketRelevance: number;
  supplyChainImpact: number;
  geoStrategic: number;
  novelty: number;
  urgency: number;
  momentum: number;
  confidence: number;
};

export type TedIntelSignal = {
  id: string;
  type: TedIntelSignalType;
  title: string;
  summary: string;
  priority: number;
  dimensions: TedIntelSignalDimensions;
  linkedNoticeIds: string[];
  affectedEntities: Array<{
    kind: "buyer" | "supplier" | "sector" | "region";
    name: string;
  }>;
  evidence: string[];
  aiExplanation: string;
  createdAt: string;
};

// ─── Procurement Momentum / Clustering ───────────────────────────────────────

export type TedIntelMomentumPoint = {
  label: string;
  noticeCount: number;
  awardCount: number;
  totalValueEur: number;
  momentumIndex: number;
};

export type TedIntelMomentumTimeline = {
  theme: string;
  points: TedIntelMomentumPoint[];
  trend: "accelerating" | "stable" | "decelerating";
  changePercent: number;
};

// ─── Concentration Risk ───────────────────────────────────────────────────────

export type TedIntelConcentrationRisk = {
  id: string;
  type: "supplier" | "buyer" | "sector" | "geography";
  subject: string;
  herfindahlIndex: number;
  topShare: number;
  description: string;
  riskLevel: "low" | "medium" | "high";
  linkedNoticeIds: string[];
};

// ─── Second-Order Intelligence ────────────────────────────────────────────────

export type TedIntelSecondOrderThesis =
  | "sector_demand_support"
  | "supply_chain_beneficiary"
  | "competitive_displacement"
  | "macro_confirmation"
  | "geopolitical_realignment";

export type TedIntelSecondOrder = {
  id: string;
  thesisType: TedIntelSecondOrderThesis;
  headline: string;
  explanation: string;
  affectedTickers: string[];
  affectedSectors: string[];
  confidence: number;
  supportingNoticeIds: string[];
  linkedSystems: Array<
    "PANORAMA" | "INTELLIGENCE" | "SUPPLY CHAIN" | "AI RESEARCH"
  >;
};

// ─── AI Insights (Evidence-First) ────────────────────────────────────────────

export type TedIntelAIInsight = {
  id: string;
  topic: string;
  factBasis: string[];
  inference: string;
  confidence: number;
  anomalyFlag: boolean;
  linkedNoticeIds: string[];
  linkedSystems: Array<
    "PANORAMA" | "INTELLIGENCE" | "SUPPLY CHAIN" | "DATA VAULT" | "GWMD MAP"
  >;
};

export type TedIntelSnapshotSourceMode = "live" | "mock";

// ─── Snapshot (complete intelligence payload) ─────────────────────────────────

export type TedIntelSnapshot = {
  generatedAt: string;
  sourceUpdatedAt: string;
  sourceMode: TedIntelSnapshotSourceMode;
  sourceLabel: string;
  timeWindow: TedIntelTimeWindow;
  // summary
  summaryCards: TedIntelSummaryCard[];
  // core aggregates
  sectors: TedIntelSectorMomentum[];
  regions: TedIntelRegionalHeat[];
  buyers: TedIntelBuyerPulse[];
  suppliers: TedIntelSupplierPulse[];
  watchlist: TedIntelWatchlistHit[];
  mapFlows: TedIntelMapFlow[];
  anomalies: TedIntelAnomaly[];
  radar: TedIntelNotice[];
  // entity resolution
  buyerResolutions: TedIntelBuyerResolution[];
  supplierResolutions: TedIntelSupplierResolution[];
  // signal engine
  signals: TedIntelSignal[];
  // momentum / clustering
  momentumTimelines: TedIntelMomentumTimeline[];
  // concentration risk
  concentrationRisks: TedIntelConcentrationRisk[];
  // second-order intelligence
  secondOrder: TedIntelSecondOrder[];
  // AI evidence-first layer
  aiInsights: TedIntelAIInsight[];
  // data vault
  dataVault: TedIntelVaultSummary;
  vaultRecords: TedIntelVaultRecord[];
  // cross-module feeds
  supplyChainOverlay: TedIntelSupplyChainOverlay[];
  panorama: TedIntelPanoramaPulse;
  // filter helpers
  availableThemes: string[];
  availableCountries: string[];
  availableBuyers: string[];
  availableSuppliers: string[];
  availableLifecycleStages: TedIntelLifecycleStage[];
};

// ─── Base Notice Definition ───────────────────────────────────────────────────

type BaseTedNotice = Omit<TedIntelNotice, "publishedAt"> & {
  publishedOffsetDays: number;
};

const BASE_NOW_ISO = "2026-03-17T12:00:00.000Z";

const baseNotices: BaseTedNotice[] = [
  // ── Window: 7d ──────────────────────────────────────────────────────────────
  {
    id: "ted-def-grid-1",
    sourceId: "2026/S-052-154230",
    title:
      "Baltic integrated air-defense sensor and command grid modernization",
    buyerName: "Lithuanian Defence Materiel Agency",
    buyerType: "defence procurement authority",
    buyerCountry: "Lithuania",
    buyerRegion: "Baltics",
    buyerCoordinates: { lat: 54.6872, lon: 25.2797 },
    stage: "award",
    noticeType: "award_notice",
    theme: "defense",
    secondaryThemes: ["communications infrastructure", "cybersecurity"],
    valueEur: 420_000_000,
    currency: "EUR",
    publishedOffsetDays: 4,
    placeOfPerformance: {
      country: "Lithuania",
      region: "Baltics",
      coordinates: { lat: 55.1694, lon: 23.8813 },
    },
    winner: {
      name: "Indra Sistemas Europa",
      country: "Spain",
      parentCompany: "Indra Sistemas",
      listedTickers: ["IDR.MC"],
    },
    strategicWeight: 96,
    confidence: 0.93,
    recurrence: 0.74,
    novelty: 0.72,
    urgency: 0.88,
    sourceUrl: "https://ted.europa.eu/en/notice/-/detail/154230-2026",
    cpvCodes: ["35700000", "72222300"],
    evidence: {
      directlyStatedFacts: [
        "Award notice names the Lithuanian Defence Materiel Agency as buyer.",
        "Contract value is EUR 420m for integrated sensor and command systems.",
        "Indra Sistemas Europa is disclosed as the winning supplier.",
      ],
      aiInference: [
        "The award reinforces Baltic air-defense digitization demand and benefits European command-and-control vendors.",
        "The cyber and communications scope suggests spillover demand for secure networking and data-link integrators.",
      ],
      confidence: 0.92,
      whyItMatters: [
        "Large defense awards confirm structural public-sector demand, not short-lived news flow.",
        "The contract is relevant to supply-chain beneficiaries in sensors, encryption, and secure cloud services.",
      ],
      linkedSystems: [
        "PANORAMA",
        "INTELLIGENCE",
        "SUPPLY CHAIN",
        "GWMD MAP",
        "DATA VAULT",
      ],
    },
  },
  // ── Window: 30d ─────────────────────────────────────────────────────────────
  {
    id: "ted-nuclear-1",
    sourceId: "2026/S-050-149810",
    title:
      "Small modular reactor support infrastructure and lifecycle services framework",
    buyerName: "French Alternative Energies and Atomic Energy Commission",
    buyerType: "state research and energy agency",
    buyerCountry: "France",
    buyerRegion: "Western Europe",
    buyerCoordinates: { lat: 48.8566, lon: 2.3522 },
    stage: "tendering",
    noticeType: "contract_notice",
    theme: "nuclear and energy transition",
    secondaryThemes: [
      "industrial automation",
      "energy and grid infrastructure",
    ],
    valueEur: 260_000_000,
    currency: "EUR",
    publishedOffsetDays: 15,
    deadlineAt: "2026-05-15T00:00:00.000Z",
    placeOfPerformance: {
      country: "France",
      region: "Western Europe",
      coordinates: { lat: 47.0, lon: 2.5 },
    },
    strategicWeight: 86,
    confidence: 0.84,
    recurrence: 0.59,
    novelty: 0.88,
    urgency: 0.72,
    sourceUrl: "https://ted.europa.eu/en/notice/-/detail/149810-2026",
    cpvCodes: ["71311100", "73100000"],
    evidence: {
      directlyStatedFacts: [
        "CEA issued a framework tender for SMR support infrastructure and lifecycle services.",
        "The notice value totals EUR 260m across engineering, automation, and lifecycle management.",
      ],
      aiInference: [
        "SMR framework procurement signals early-stage government demand ahead of commercialization.",
        "The lifecycle services scope benefits industrial automation and nuclear-grade engineering vendors.",
      ],
      confidence: 0.83,
      whyItMatters: [
        "SMR procurement is a leading indicator of energy transition capex entering procurement cycles.",
        "The framework structure means multi-year demand conversion is likely.",
      ],
      linkedSystems: ["PANORAMA", "INTELLIGENCE", "SUPPLY CHAIN"],
    },
  },
  {
    id: "ted-cloud-1",
    sourceId: "2026/S-049-145882",
    title:
      "Multi-country sovereign cloud framework for public administration workloads",
    buyerName: "Central Purchasing Body of Belgium",
    buyerType: "central purchasing body",
    buyerCountry: "Belgium",
    buyerRegion: "Benelux",
    buyerCoordinates: { lat: 50.8503, lon: 4.3517 },
    stage: "tendering",
    noticeType: "contract_notice",
    theme: "cloud and public IT",
    secondaryThemes: [
      "state modernization and digital transformation",
      "cybersecurity",
    ],
    valueEur: 610_000_000,
    currency: "EUR",
    publishedOffsetDays: 9,
    deadlineAt: "2026-04-25T00:00:00.000Z",
    placeOfPerformance: {
      country: "Belgium",
      region: "Benelux",
      coordinates: { lat: 50.5039, lon: 4.4699 },
    },
    strategicWeight: 90,
    confidence: 0.89,
    recurrence: 0.68,
    novelty: 0.82,
    urgency: 0.79,
    sourceUrl: "https://ted.europa.eu/en/notice/-/detail/145882-2026",
    cpvCodes: ["72400000", "72510000"],
    evidence: {
      directlyStatedFacts: [
        "Belgium's central purchasing body launched a framework tender for sovereign cloud services.",
        "The notice value totals EUR 610m across public administration workloads.",
        "The procurement explicitly covers secure hosting, migration, and operations.",
      ],
      aiInference: [
        "The framework increases relevance for European cloud operators, cybersecurity vendors, and migration specialists.",
        "The scope supports a wider state-modernization theme already monitored in the terminal.",
      ],
      confidence: 0.88,
      whyItMatters: [
        "Cloud framework tenders create multi-year recurring demand rather than one-off equipment spend.",
        "The procurement can propagate into semis, networking, and sovereign hosting infrastructure demand.",
      ],
      linkedSystems: ["PANORAMA", "INTELLIGENCE", "SUPPLY CHAIN", "DATA VAULT"],
    },
  },
  // ── Window: 90d ─────────────────────────────────────────────────────────────
  {
    id: "ted-border-1",
    sourceId: "2026/S-047-141600",
    title:
      "Integrated border surveillance and biometric screening technology programme",
    buyerName: "European Border and Coast Guard Agency",
    buyerType: "eu agency",
    buyerCountry: "Poland",
    buyerRegion: "Central Europe",
    buyerCoordinates: { lat: 52.2297, lon: 21.0122 },
    stage: "competition",
    noticeType: "competition_notice",
    theme: "border security and surveillance",
    secondaryThemes: ["cybersecurity", "communications infrastructure"],
    valueEur: 320_000_000,
    currency: "EUR",
    publishedOffsetDays: 40,
    deadlineAt: "2026-05-30T00:00:00.000Z",
    placeOfPerformance: {
      country: "Poland",
      region: "Central Europe",
      coordinates: { lat: 52.5, lon: 23.6 },
    },
    strategicWeight: 85,
    confidence: 0.87,
    recurrence: 0.61,
    novelty: 0.76,
    urgency: 0.81,
    sourceUrl: "https://ted.europa.eu/en/notice/-/detail/141600-2026",
    cpvCodes: ["35125300", "48813000"],
    evidence: {
      directlyStatedFacts: [
        "Frontex opened competition for integrated surveillance and biometric border technology.",
        "The notice covers sensor arrays, AI-assisted screening, and secure comms at land and maritime borders.",
        "Total indicative value is EUR 320m across a multi-year framework.",
      ],
      aiInference: [
        "Border technology procurement lifts relevance for biometric, AI-vision, and edge-computing vendors.",
        "The competition stage signals active vendor selection rather than early planning.",
      ],
      confidence: 0.86,
      whyItMatters: [
        "EU-level border security procurement is geopolitically driven and resistant to cyclical budget cuts.",
        "The scope links surveillance hardware, cybersecurity, and communications into a single demand cluster.",
      ],
      linkedSystems: ["PANORAMA", "INTELLIGENCE", "GWMD MAP"],
    },
  },
  {
    id: "ted-grid-1",
    sourceId: "2026/S-041-121604",
    title: "High-voltage substation automation and grid stability programme",
    buyerName: "Polskie Sieci Elektroenergetyczne",
    buyerType: "transmission system operator",
    buyerCountry: "Poland",
    buyerRegion: "Central Europe",
    buyerCoordinates: { lat: 52.2297, lon: 21.0122 },
    stage: "award",
    noticeType: "award_notice",
    theme: "energy and grid infrastructure",
    secondaryThemes: ["industrial automation", "communications infrastructure"],
    valueEur: 355_000_000,
    currency: "EUR",
    publishedOffsetDays: 22,
    placeOfPerformance: {
      country: "Poland",
      region: "Central Europe",
      coordinates: { lat: 52.0692, lon: 19.4803 },
    },
    winner: {
      name: "Hitachi Energy Sweden AB",
      country: "Sweden",
      parentCompany: "Hitachi",
      listedTickers: ["6501.T"],
    },
    strategicWeight: 91,
    confidence: 0.91,
    recurrence: 0.79,
    novelty: 0.61,
    urgency: 0.72,
    sourceUrl: "https://ted.europa.eu/en/notice/-/detail/121604-2026",
    cpvCodes: ["31682210", "31220000"],
    evidence: {
      directlyStatedFacts: [
        "Poland's grid operator awarded EUR 355m for substation automation and stability upgrades.",
        "Hitachi Energy Sweden AB is disclosed as winner.",
        "The programme covers protection systems, SCADA integration, and high-voltage substations.",
      ],
      aiInference: [
        "Grid automation demand supports industrial controls and power semis exposure.",
        "The award fits a broader European grid-hardening cycle rather than isolated maintenance.",
      ],
      confidence: 0.9,
      whyItMatters: [
        "Large TSO awards are durable demand signals for electrification suppliers.",
        "The award strengthens the grid capex narrative across Central Europe.",
      ],
      linkedSystems: ["PANORAMA", "INTELLIGENCE", "SUPPLY CHAIN", "GWMD MAP"],
    },
  },
  {
    id: "ted-space-1",
    sourceId: "2026/S-046-138950",
    title:
      "Earth observation satellite data services and ground station upgrade",
    buyerName: "European Space Agency ESAC Delegation",
    buyerType: "eu agency",
    buyerCountry: "Spain",
    buyerRegion: "Iberia",
    buyerCoordinates: { lat: 40.4312, lon: -3.952 },
    stage: "award",
    noticeType: "award_notice",
    theme: "space and satellite systems",
    secondaryThemes: ["communications infrastructure", "cloud and public IT"],
    valueEur: 180_000_000,
    currency: "EUR",
    publishedOffsetDays: 55,
    placeOfPerformance: {
      country: "Spain",
      region: "Iberia",
      coordinates: { lat: 40.43, lon: -3.95 },
    },
    winner: {
      name: "Airbus Defence and Space SAS",
      country: "France",
      parentCompany: "Airbus",
      listedTickers: ["AIR.PA"],
    },
    strategicWeight: 83,
    confidence: 0.88,
    recurrence: 0.62,
    novelty: 0.67,
    urgency: 0.63,
    sourceUrl: "https://ted.europa.eu/en/notice/-/detail/138950-2026",
    cpvCodes: ["34711300", "72400000"],
    evidence: {
      directlyStatedFacts: [
        "ESA ESAC delegation awarded EUR 180m for earth observation data services and ground station upgrades.",
        "Airbus Defence and Space SAS is named as winning contractor.",
        "The scope covers sensor fusion, data processing pipelines, and ground segment modernization.",
      ],
      aiInference: [
        "Space data services awards benefit satellite primes, ground system integrators, and sovereign cloud operators.",
        "ESA procurement at this scale signals sustained public investment in European space capability.",
      ],
      confidence: 0.87,
      whyItMatters: [
        "Space procurement is structurally connected to defense, climate monitoring, and communications themes.",
        "Repeat ESA awards to European primes confirm long-term framework relationships.",
      ],
      linkedSystems: ["INTELLIGENCE", "SUPPLY CHAIN", "GWMD MAP", "DATA VAULT"],
    },
  },
  {
    id: "ted-rail-1",
    sourceId: "2026/S-034-099120",
    title: "ERTMS signalling and intercity rail corridor modernisation",
    buyerName: "Renfe Ingeniería y Mantenimiento",
    buyerType: "rail operator",
    buyerCountry: "Spain",
    buyerRegion: "Iberia",
    buyerCoordinates: { lat: 40.4168, lon: -3.7038 },
    stage: "competition",
    noticeType: "competition_notice",
    theme: "rail and transport",
    secondaryThemes: ["communications infrastructure", "industrial automation"],
    valueEur: 280_000_000,
    currency: "EUR",
    publishedOffsetDays: 35,
    deadlineAt: "2026-04-10T00:00:00.000Z",
    placeOfPerformance: {
      country: "Spain",
      region: "Iberia",
      coordinates: { lat: 40.2445, lon: -3.696 },
    },
    strategicWeight: 77,
    confidence: 0.84,
    recurrence: 0.52,
    novelty: 0.67,
    urgency: 0.66,
    sourceUrl: "https://ted.europa.eu/en/notice/-/detail/099120-2026",
    cpvCodes: ["34946000", "45234115"],
    evidence: {
      directlyStatedFacts: [
        "Renfe opened competition for ERTMS signalling and corridor upgrades.",
        "The notice value totals EUR 280m across signalling, communications, and integration work.",
      ],
      aiInference: [
        "The tender is relevant to rail signalling incumbents and fiber/networking suppliers.",
        "The programme indicates sustained transport digitization spend in Iberia.",
      ],
      confidence: 0.83,
      whyItMatters: [
        "Rail modernization creates second-order demand in automation, electronics, and telecom components.",
      ],
      linkedSystems: ["PANORAMA", "INTELLIGENCE", "GWMD MAP"],
    },
  },
  {
    id: "ted-health-1",
    sourceId: "2026/S-027-081401",
    title:
      "National hospital imaging and remote diagnostics capacity expansion",
    buyerName: "Romanian Ministry of Health",
    buyerType: "ministry",
    buyerCountry: "Romania",
    buyerRegion: "Southeast Europe",
    buyerCoordinates: { lat: 44.4268, lon: 26.1025 },
    stage: "award",
    noticeType: "award_notice",
    theme: "healthcare and medical procurement",
    secondaryThemes: [
      "communications infrastructure",
      "state modernization and digital transformation",
    ],
    valueEur: 198_000_000,
    currency: "EUR",
    publishedOffsetDays: 48,
    placeOfPerformance: {
      country: "Romania",
      region: "Southeast Europe",
      coordinates: { lat: 45.9432, lon: 24.9668 },
    },
    winner: {
      name: "Philips Romania SRL",
      country: "Romania",
      parentCompany: "Philips",
      listedTickers: ["PHIA.AS"],
    },
    strategicWeight: 74,
    confidence: 0.86,
    recurrence: 0.58,
    novelty: 0.56,
    urgency: 0.64,
    sourceUrl: "https://ted.europa.eu/en/notice/-/detail/081401-2026",
    cpvCodes: ["33115000", "72224000"],
    evidence: {
      directlyStatedFacts: [
        "Romania's Ministry of Health awarded EUR 198m for imaging equipment and remote diagnostics capacity.",
        "Philips Romania SRL is listed as the awarded supplier.",
      ],
      aiInference: [
        "The remote diagnostics scope lifts relevance for med-tech software and healthcare IT services.",
      ],
      confidence: 0.85,
      whyItMatters: [
        "Healthcare procurement is a stable public demand channel rather than cyclical commercial demand.",
      ],
      linkedSystems: ["INTELLIGENCE", "SUPPLY CHAIN", "DATA VAULT"],
    },
  },
  {
    id: "ted-cyber-1",
    sourceId: "2026/S-018-055011",
    title:
      "EU agency managed detection and zero-trust security operations framework",
    buyerName: "European Union Agency for Cybersecurity",
    buyerType: "eu agency",
    buyerCountry: "Greece",
    buyerRegion: "Southern Europe",
    buyerCoordinates: { lat: 37.9838, lon: 23.7275 },
    stage: "planning",
    noticeType: "pin",
    theme: "cybersecurity",
    secondaryThemes: [
      "cloud and public IT",
      "state modernization and digital transformation",
    ],
    valueEur: 145_000_000,
    currency: "EUR",
    publishedOffsetDays: 63,
    placeOfPerformance: {
      country: "Greece",
      region: "Southern Europe",
      coordinates: { lat: 38.0, lon: 23.9 },
    },
    strategicWeight: 82,
    confidence: 0.81,
    recurrence: 0.63,
    novelty: 0.78,
    urgency: 0.51,
    sourceUrl: "https://ted.europa.eu/en/notice/-/detail/055011-2026",
    cpvCodes: ["72212730", "48730000"],
    evidence: {
      directlyStatedFacts: [
        "ENISA published a prior information notice for managed detection and zero-trust framework services.",
        "The planning notice signals multi-year cyber operations demand.",
      ],
      aiInference: [
        "Planning-stage cyber programmes often pull forward identity, endpoint, and sovereign cloud spend.",
      ],
      confidence: 0.79,
      whyItMatters: [
        "This is an early demand signal that can matter before awards are visible.",
      ],
      linkedSystems: ["PANORAMA", "INTELLIGENCE", "DATA VAULT"],
    },
  },
  {
    id: "ted-semis-1",
    sourceId: "2026/S-011-031492",
    title:
      "National semiconductor packaging and metrology testbed infrastructure",
    buyerName: "Dutch Enterprise Agency",
    buyerType: "industrial policy agency",
    buyerCountry: "Netherlands",
    buyerRegion: "Benelux",
    buyerCoordinates: { lat: 52.3676, lon: 4.9041 },
    stage: "tendering",
    noticeType: "contract_notice",
    theme: "semis-related infrastructure or public industrial policy",
    secondaryThemes: [
      "industrial automation",
      "energy and grid infrastructure",
    ],
    valueEur: 230_000_000,
    currency: "EUR",
    publishedOffsetDays: 76,
    deadlineAt: "2026-05-02T00:00:00.000Z",
    placeOfPerformance: {
      country: "Netherlands",
      region: "Benelux",
      coordinates: { lat: 51.9244, lon: 4.4777 },
    },
    strategicWeight: 88,
    confidence: 0.85,
    recurrence: 0.67,
    novelty: 0.8,
    urgency: 0.62,
    sourceUrl: "https://ted.europa.eu/en/notice/-/detail/031492-2026",
    cpvCodes: ["31712331", "38540000"],
    evidence: {
      directlyStatedFacts: [
        "Dutch industrial-policy procurement covers semiconductor packaging and metrology infrastructure.",
        "The tender value is EUR 230m.",
      ],
      aiInference: [
        "The notice supports equipment, power management, automation, and precision test themes.",
      ],
      confidence: 0.83,
      whyItMatters: [
        "Industrial policy procurement can confirm public support behind semis capex narratives.",
      ],
      linkedSystems: ["PANORAMA", "INTELLIGENCE", "SUPPLY CHAIN"],
    },
  },
  // ── Window: 1y ──────────────────────────────────────────────────────────────
  {
    id: "ted-green-1",
    sourceId: "2025/S-268-844210",
    title:
      "National water treatment modernization and climate resilience infrastructure",
    buyerName: "German Federal Environment Agency",
    buyerType: "agency",
    buyerCountry: "Germany",
    buyerRegion: "Central Europe",
    buyerCoordinates: { lat: 51.8637, lon: 12.2435 },
    stage: "planning",
    noticeType: "pin",
    theme: "green and environmental infrastructure",
    secondaryThemes: [
      "industrial automation",
      "state modernization and digital transformation",
    ],
    valueEur: 280_000_000,
    currency: "EUR",
    publishedOffsetDays: 78,
    placeOfPerformance: {
      country: "Germany",
      region: "Central Europe",
      coordinates: { lat: 51.0, lon: 10.5 },
    },
    strategicWeight: 72,
    confidence: 0.8,
    recurrence: 0.48,
    novelty: 0.73,
    urgency: 0.44,
    sourceUrl: "https://ted.europa.eu/en/notice/-/detail/844210-2025",
    cpvCodes: ["45232430", "42912300"],
    evidence: {
      directlyStatedFacts: [
        "Germany's Federal Environment Agency published a prior information notice for water infrastructure modernization.",
        "The planning notice estimates EUR 280m across treatment facilities and climate-resilience upgrades.",
      ],
      aiInference: [
        "Water infrastructure procurement benefits process automation, filtration, and environmental sensor vendors.",
        "Climate-resilience framing suggests EU-funded co-financing is likely.",
      ],
      confidence: 0.78,
      whyItMatters: [
        "Environmental infrastructure spend is accelerating in response to EU Green Deal obligations.",
        "Planning-stage notice is an early signal ahead of future tender conversion.",
      ],
      linkedSystems: ["PANORAMA", "INTELLIGENCE"],
    },
  },
  {
    id: "ted-def-drone-1",
    sourceId: "2025/S-246-779112",
    title: "Swarm drone reconnaissance support and secure data-link package",
    buyerName: "Estonian Centre for Defence Investments",
    buyerType: "defence procurement authority",
    buyerCountry: "Estonia",
    buyerRegion: "Baltics",
    buyerCoordinates: { lat: 59.437, lon: 24.7536 },
    stage: "award",
    noticeType: "award_notice",
    theme: "defense",
    secondaryThemes: ["communications infrastructure", "cybersecurity"],
    valueEur: 96_000_000,
    currency: "EUR",
    publishedOffsetDays: 105,
    placeOfPerformance: {
      country: "Estonia",
      region: "Baltics",
      coordinates: { lat: 58.5953, lon: 25.0136 },
    },
    winner: {
      name: "Thales DMS France SAS",
      country: "France",
      parentCompany: "Thales",
      listedTickers: ["HO.PA"],
    },
    strategicWeight: 79,
    confidence: 0.88,
    recurrence: 0.71,
    novelty: 0.55,
    urgency: 0.69,
    sourceUrl: "https://ted.europa.eu/en/notice/-/detail/779112-2025",
    cpvCodes: ["35613000", "32530000"],
    evidence: {
      directlyStatedFacts: [
        "Estonia awarded EUR 96m for drone reconnaissance support and secure data-links.",
        "Thales DMS France SAS is the awarded supplier.",
      ],
      aiInference: [
        "Repeat Baltic drone-linked awards suggest sustained defense digitization and ISR demand.",
      ],
      confidence: 0.87,
      whyItMatters: [
        "The award reinforces repeat-winner concentration in European defense electronics.",
      ],
      linkedSystems: ["INTELLIGENCE", "SUPPLY CHAIN", "GWMD MAP"],
    },
  },
  {
    id: "ted-hpc-1",
    sourceId: "2025/S-240-758820",
    title:
      "HPC research fabric and data-intensive computing infrastructure expansion",
    buyerName: "GÉANT Association",
    buyerType: "eu agency",
    buyerCountry: "Netherlands",
    buyerRegion: "Benelux",
    buyerCoordinates: { lat: 52.3676, lon: 4.9041 },
    stage: "award",
    noticeType: "award_notice",
    theme: "research infrastructure and high-performance computing",
    secondaryThemes: ["cloud and public IT", "communications infrastructure"],
    valueEur: 145_000_000,
    currency: "EUR",
    publishedOffsetDays: 85,
    placeOfPerformance: {
      country: "Netherlands",
      region: "Benelux",
      coordinates: { lat: 52.0, lon: 5.3 },
    },
    winner: {
      name: "NEC Europe Ltd",
      country: "United Kingdom",
      parentCompany: "NEC Corporation",
      listedTickers: ["6701.T"],
    },
    strategicWeight: 71,
    confidence: 0.82,
    recurrence: 0.54,
    novelty: 0.64,
    urgency: 0.53,
    sourceUrl: "https://ted.europa.eu/en/notice/-/detail/758820-2025",
    cpvCodes: ["48820000", "72512000"],
    evidence: {
      directlyStatedFacts: [
        "GÉANT awarded EUR 145m for HPC fabric expansion and research computing infrastructure.",
        "NEC Europe Ltd is named as winning contractor.",
      ],
      aiInference: [
        "HPC procurement benefits server hardware, networking fabric, and storage vendors.",
        "Research infrastructure awards often precede wider academic and government cloud adoption.",
      ],
      confidence: 0.81,
      whyItMatters: [
        "Public HPC investment is a leading indicator of European digital sovereignty infrastructure build-out.",
      ],
      linkedSystems: ["INTELLIGENCE", "SUPPLY CHAIN", "DATA VAULT"],
    },
  },
  {
    id: "ted-telecom-1",
    sourceId: "2025/S-214-681204",
    title: "Rural backbone fibre and 5G public-service corridor rollout",
    buyerName: "Croatian Ministry of the Sea, Transport and Infrastructure",
    buyerType: "ministry",
    buyerCountry: "Croatia",
    buyerRegion: "Adriatic",
    buyerCoordinates: { lat: 45.815, lon: 15.9819 },
    stage: "award",
    noticeType: "award_notice",
    theme: "communications infrastructure",
    secondaryThemes: [
      "state modernization and digital transformation",
      "cloud and public IT",
    ],
    valueEur: 175_000_000,
    currency: "EUR",
    publishedOffsetDays: 150,
    placeOfPerformance: {
      country: "Croatia",
      region: "Adriatic",
      coordinates: { lat: 45.1, lon: 15.2 },
    },
    winner: {
      name: "Koncar Digital d.o.o.",
      country: "Croatia",
      parentCompany: "Koncar",
      listedTickers: ["KOEI-R-A.ZA"],
    },
    strategicWeight: 70,
    confidence: 0.8,
    recurrence: 0.47,
    novelty: 0.57,
    urgency: 0.54,
    sourceUrl: "https://ted.europa.eu/en/notice/-/detail/681204-2025",
    cpvCodes: ["32412110", "64200000"],
    evidence: {
      directlyStatedFacts: [
        "Croatia awarded EUR 175m for backbone fibre and public-service 5G corridors.",
        "Koncar Digital d.o.o. is named as winner.",
      ],
      aiInference: [
        "Telecom infrastructure awards can propagate into grid, smart-city, and secure networking demand.",
      ],
      confidence: 0.79,
      whyItMatters: [
        "The contract supports public digital infrastructure and communications build-out themes.",
      ],
      linkedSystems: ["PANORAMA", "INTELLIGENCE", "GWMD MAP"],
    },
  },
  {
    id: "ted-grid-2",
    sourceId: "2025/S-132-421885",
    title: "National smart-metering and demand-response enablement programme",
    buyerName: "Hellenic Electricity Distribution Network Operator",
    buyerType: "distribution system operator",
    buyerCountry: "Greece",
    buyerRegion: "Southern Europe",
    buyerCoordinates: { lat: 37.9838, lon: 23.7275 },
    stage: "execution",
    noticeType: "contract_modification",
    theme: "energy and grid infrastructure",
    secondaryThemes: ["industrial automation", "communications infrastructure"],
    valueEur: 118_000_000,
    currency: "EUR",
    publishedOffsetDays: 210,
    placeOfPerformance: {
      country: "Greece",
      region: "Southern Europe",
      coordinates: { lat: 38.2, lon: 23.7 },
    },
    winner: {
      name: "Siemens Smart Infrastructure AG",
      country: "Germany",
      parentCompany: "Siemens",
      listedTickers: ["SIE.DE"],
    },
    strategicWeight: 68,
    confidence: 0.82,
    recurrence: 0.66,
    novelty: 0.41,
    urgency: 0.43,
    sourceUrl: "https://ted.europa.eu/en/notice/-/detail/421885-2025",
    cpvCodes: ["38551000", "65300000"],
    evidence: {
      directlyStatedFacts: [
        "Greece published a contract modification for smart metering and demand-response rollout.",
        "Siemens Smart Infrastructure AG remains disclosed execution supplier.",
      ],
      aiInference: [
        "Execution-stage modifications confirm procurement conversion into real spend and deployment demand.",
      ],
      confidence: 0.8,
      whyItMatters: [
        "Execution relevance confirms procurement conversion into real spend and deployment demand.",
      ],
      linkedSystems: ["PANORAMA", "SUPPLY CHAIN", "DATA VAULT"],
    },
  },
];

// ─── Helper Functions ─────────────────────────────────────────────────────────

function stageWeight(stage: TedIntelLifecycleStage): number {
  switch (stage) {
    case "award":
      return 1;
    case "execution":
      return 0.9;
    case "competition":
      return 0.72;
    case "tendering":
      return 0.65;
    case "planning":
    default:
      return 0.45;
  }
}

function daysForWindow(window: TedIntelTimeWindow): number {
  switch (window) {
    case "7d":
      return 7;
    case "30d":
      return 30;
    case "90d":
      return 90;
    case "1y":
    default:
      return 365;
  }
}

function addDays(baseIso: string, deltaDays: number): string {
  const base = new Date(baseIso).getTime();
  return new Date(base + deltaDays * 24 * 60 * 60 * 1000).toISOString();
}

function windowedNotices(window: TedIntelTimeWindow): TedIntelNotice[] {
  const maxDays = daysForWindow(window);
  return baseNotices
    .filter((notice) => notice.publishedOffsetDays <= maxDays)
    .map(({ publishedOffsetDays, ...notice }) => ({
      ...notice,
      publishedAt: addDays(BASE_NOW_ISO, -publishedOffsetDays),
    }))
    .sort(
      (left, right) =>
        new Date(right.publishedAt).getTime() -
        new Date(left.publishedAt).getTime(),
    );
}

function formatBillions(value: number): string {
  if (value >= 1_000_000_000) {
    return `EUR ${(value / 1_000_000_000).toFixed(2)}bn`;
  }
  return `EUR ${(value / 1_000_000).toFixed(0)}m`;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function computeSignalPriority(dims: TedIntelSignalDimensions): number {
  return (
    (dims.marketRelevance * 0.25 +
      dims.supplyChainImpact * 0.2 +
      dims.geoStrategic * 0.15 +
      dims.novelty * 0.15 +
      dims.urgency * 0.15 +
      dims.momentum * 0.1 +
      dims.confidence * 0.05) *
    100
  );
}

function classifyBuyerType(buyerType: string): TedIntelBuyerClassification {
  const lower = buyerType.toLowerCase();
  if (lower.includes("ministry") || lower.includes("federal"))
    return "ministry";
  if (lower.includes("municipality") || lower.includes("municipal"))
    return "municipality";
  if (
    lower.includes("defence") ||
    lower.includes("defense") ||
    lower.includes("military")
  )
    return "military";
  if (lower.includes("central purchasing")) return "central_purchasing_body";
  if (lower.includes("eu agency") || lower.includes("european"))
    return "eu_agency";
  if (lower.includes("transmission") || lower.includes("system operator"))
    return "transmission_system_operator";
  if (lower.includes("distribution")) return "distribution_system_operator";
  if (lower.includes("rail")) return "rail_operator";
  if (lower.includes("agency")) return "agency";
  return "other";
}

function inferTickerExchange(ticker: string): string {
  if (ticker.endsWith(".PA")) return "Euronext Paris";
  if (ticker.endsWith(".AS")) return "Euronext Amsterdam";
  if (ticker.endsWith(".MC")) return "BME Spain";
  if (ticker.endsWith(".DE")) return "XETRA";
  if (ticker.endsWith(".T")) return "Tokyo Stock Exchange";
  if (ticker.endsWith(".ZA")) return "Zagreb Stock Exchange";
  return "OTC / Other";
}

// ─── Aggregation Builders ─────────────────────────────────────────────────────

function buildSectors(notices: TedIntelNotice[]): TedIntelSectorMomentum[] {
  const sectorMap = new Map<string, TedIntelSectorMomentum>();
  for (const notice of notices) {
    const existing = sectorMap.get(notice.theme) ?? {
      theme: notice.theme,
      noticeCount: 0,
      awardedCount: 0,
      totalValueEur: 0,
      momentumScore: 0,
      stageMix: {},
    };
    existing.noticeCount += 1;
    existing.totalValueEur += notice.valueEur;
    if (notice.stage === "award" || notice.stage === "execution") {
      existing.awardedCount += 1;
    }
    existing.stageMix[notice.stage] =
      (existing.stageMix[notice.stage] ?? 0) + 1;
    existing.momentumScore +=
      stageWeight(notice.stage) *
      (notice.strategicWeight / 100) *
      (1 + notice.recurrence * 0.5);
    sectorMap.set(notice.theme, existing);
  }
  return [...sectorMap.values()]
    .map((sector) => ({
      ...sector,
      momentumScore: round(sector.momentumScore, 2),
    }))
    .sort((left, right) => right.momentumScore - left.momentumScore);
}

function buildRegions(notices: TedIntelNotice[]): TedIntelRegionalHeat[] {
  const regionMap = new Map<string, TedIntelRegionalHeat>();
  for (const notice of notices) {
    const key = `${notice.placeOfPerformance.country}:${notice.placeOfPerformance.region}`;
    const existing = regionMap.get(key) ?? {
      key,
      label: `${notice.placeOfPerformance.country} • ${notice.placeOfPerformance.region}`,
      country: notice.placeOfPerformance.country,
      region: notice.placeOfPerformance.region,
      noticeCount: 0,
      awardCount: 0,
      totalValueEur: 0,
      intensity: 0,
      coordinates: notice.placeOfPerformance.coordinates,
    };
    existing.noticeCount += 1;
    existing.totalValueEur += notice.valueEur;
    if (notice.stage === "award" || notice.stage === "execution") {
      existing.awardCount += 1;
    }
    existing.intensity +=
      stageWeight(notice.stage) *
      (notice.strategicWeight / 100) *
      (notice.valueEur / 100_000_000);
    regionMap.set(key, existing);
  }
  return [...regionMap.values()]
    .map((region) => ({ ...region, intensity: round(region.intensity, 2) }))
    .sort((left, right) => right.intensity - left.intensity);
}

function buildBuyers(notices: TedIntelNotice[]): TedIntelBuyerPulse[] {
  const buyerMap = new Map<string, TedIntelBuyerPulse>();
  for (const notice of notices) {
    const existing = buyerMap.get(notice.buyerName) ?? {
      buyerName: notice.buyerName,
      buyerType: notice.buyerType,
      country: notice.buyerCountry,
      activityScore: 0,
      noticeCount: 0,
      awardValueEur: 0,
      topThemes: [],
      stageBias: notice.stage,
    };
    existing.noticeCount += 1;
    existing.activityScore +=
      stageWeight(notice.stage) *
      (notice.strategicWeight / 100) *
      (notice.valueEur / 50_000_000);
    if (notice.stage === "award" || notice.stage === "execution") {
      existing.awardValueEur += notice.valueEur;
    }
    existing.topThemes = unique([...existing.topThemes, notice.theme]).slice(
      0,
      3,
    );
    if (stageWeight(notice.stage) > stageWeight(existing.stageBias)) {
      existing.stageBias = notice.stage;
    }
    buyerMap.set(notice.buyerName, existing);
  }
  return [...buyerMap.values()]
    .map((buyer) => ({
      ...buyer,
      activityScore: round(buyer.activityScore, 2),
    }))
    .sort((left, right) => right.activityScore - left.activityScore);
}

function buildSuppliers(awarded: TedIntelNotice[]): TedIntelSupplierPulse[] {
  const supplierMap = new Map<string, TedIntelSupplierPulse>();
  for (const notice of awarded) {
    if (!notice.winner) continue;
    const key = notice.winner.name;
    const existing: TedIntelSupplierPulse = supplierMap.get(key) ?? {
      supplierName: key,
      country: notice.winner.country,
      parentCompany: notice.winner.parentCompany,
      listedTickers: notice.winner.listedTickers ?? [],
      awardCount: 0,
      totalAwardValueEur: 0,
      dependenceScore: 0,
      strategicThemes: [],
    };
    existing.awardCount += 1;
    existing.totalAwardValueEur += notice.valueEur;
    existing.dependenceScore +=
      notice.recurrence * (notice.strategicWeight / 100);
    existing.strategicThemes = unique([
      ...existing.strategicThemes,
      notice.theme,
    ]).slice(0, 3);
    supplierMap.set(key, existing);
  }
  return [...supplierMap.values()]
    .map((supplier) => ({
      ...supplier,
      dependenceScore: round(supplier.dependenceScore, 2),
    }))
    .sort((left, right) => right.totalAwardValueEur - left.totalAwardValueEur);
}

function buildWatchlist(awarded: TedIntelNotice[]): TedIntelWatchlistHit[] {
  const watchlistMap = new Map<string, TedIntelWatchlistHit>();
  for (const notice of awarded) {
    const tickers = notice.winner?.listedTickers ?? [];
    for (const ticker of tickers) {
      const existing = watchlistMap.get(ticker) ?? {
        ticker,
        company: notice.winner?.parentCompany ?? notice.winner?.name ?? ticker,
        relevanceScore: 0,
        confidence: 0,
        linkedNoticeIds: [],
        buyerCount: 0,
        themes: [],
        rationale: "",
      };
      existing.relevanceScore +=
        notice.strategicWeight / 100 + notice.valueEur / 250_000_000;
      existing.confidence = Math.max(existing.confidence, notice.confidence);
      existing.linkedNoticeIds = unique([
        ...existing.linkedNoticeIds,
        notice.id,
      ]);
      existing.buyerCount += 1;
      existing.themes = unique([...existing.themes, notice.theme]);
      existing.rationale = `${existing.company} is linked to ${existing.buyerCount} awarded public-spend event${existing.buyerCount > 1 ? "s" : ""} across ${existing.themes.join(", ")}.`;
      watchlistMap.set(ticker, existing);
    }
  }
  return [...watchlistMap.values()]
    .map((item) => ({
      ...item,
      relevanceScore: round(item.relevanceScore, 2),
      confidence: round(item.confidence, 2),
    }))
    .sort((left, right) => right.relevanceScore - left.relevanceScore);
}

function buildMapFlows(awarded: TedIntelNotice[]): TedIntelMapFlow[] {
  return awarded
    .filter((notice) => notice.winner)
    .map((notice) => ({
      id: notice.id,
      buyerName: notice.buyerName,
      winnerName: notice.winner?.name ?? "",
      buyerCountry: notice.buyerCountry,
      winnerCountry: notice.winner?.country ?? notice.buyerCountry,
      buyerCoordinates: notice.buyerCoordinates,
      winnerCoordinates: notice.placeOfPerformance.coordinates,
      performanceCoordinates: notice.placeOfPerformance.coordinates,
      stage: notice.stage,
      theme: notice.theme,
      valueEur: notice.valueEur,
      thickness: round(Math.max(0.4, notice.valueEur / 300_000_000), 2),
      listedTickers: notice.winner?.listedTickers ?? [],
    }))
    .sort((left, right) => right.valueEur - left.valueEur);
}

// ─── Anomaly Detection ────────────────────────────────────────────────────────

function buildAnomalies(
  notices: TedIntelNotice[],
  sectors: TedIntelSectorMomentum[],
  suppliers: TedIntelSupplierPulse[],
): TedIntelAnomaly[] {
  const anomalies: TedIntelAnomaly[] = [];
  const awarded = notices.filter(
    (n) => n.stage === "award" || n.stage === "execution",
  );

  // 1. Top sector demand cluster
  const topSector = sectors[0];
  if (topSector) {
    anomalies.push({
      id: `sector-surge-${topSector.theme.replace(/\s+/g, "-")}`,
      severity: "high",
      title: `${topSector.theme} demand cluster is leading the window`,
      detail: `${topSector.noticeCount} notices and ${formatBillions(topSector.totalValueEur)} of tracked value have clustered into ${topSector.theme} this window.`,
      whyItMatters:
        "This points to structural government demand rather than isolated procurement noise. Sector clustering is a leading intelligence signal.",
      linkedNoticeIds: notices
        .filter((n) => n.theme === topSector.theme)
        .map((n) => n.id),
    });
  }

  // 2. Repeat award winner
  const topSupplier = suppliers.find((s) => s.awardCount > 1);
  if (topSupplier) {
    anomalies.push({
      id: `repeat-winner-${topSupplier.supplierName.replace(/\s+/g, "-").slice(0, 30)}`,
      severity: "medium",
      title: `${topSupplier.supplierName} is a repeat award winner`,
      detail: `${topSupplier.supplierName} appears in ${topSupplier.awardCount} awards worth ${formatBillions(topSupplier.totalAwardValueEur)} this window.`,
      whyItMatters:
        "Repeat wins may signal buyer concentration, incumbent strength, or limited competition in this category.",
      linkedNoticeIds: awarded
        .filter((n) => n.winner?.name === topSupplier.supplierName)
        .map((n) => n.id),
    });
  }

  // 3. High-novelty notice (new entrant or new category)
  const highNovelty = notices
    .filter(
      (n) =>
        n.novelty >= 0.78 && (n.stage === "award" || n.stage === "tendering"),
    )
    .sort((a, b) => b.novelty - a.novelty)[0];
  if (highNovelty) {
    anomalies.push({
      id: `novel-entrant-${highNovelty.id}`,
      severity: "medium",
      title: `High-novelty procurement detected in ${highNovelty.theme}`,
      detail: `"${highNovelty.title}" shows unusually high novelty (${(highNovelty.novelty * 100).toFixed(0)}%) for this buyer and theme combination.`,
      whyItMatters:
        "High novelty indicates a new procurement category, a new buyer entering the market, or displacement of an incumbent supplier.",
      linkedNoticeIds: [highNovelty.id],
    });
  }

  // 4. Cross-border concentration (≥2 cross-border awards to same country pair)
  const crossBorderMap = new Map<string, string[]>();
  for (const n of awarded) {
    if (n.winner && n.winner.country !== n.buyerCountry) {
      const key = `${n.buyerCountry}→${n.winner.country}`;
      const ids = crossBorderMap.get(key) ?? [];
      ids.push(n.id);
      crossBorderMap.set(key, ids);
    }
  }
  const dominantCorridor = [...crossBorderMap.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  )[0];
  if (dominantCorridor && dominantCorridor[1].length >= 2) {
    anomalies.push({
      id: `corridor-concentration-${dominantCorridor[0].replace("→", "-")}`,
      severity: "medium",
      title: `Procurement corridor ${dominantCorridor[0]} dominates cross-border flows`,
      detail: `${dominantCorridor[1].length} cross-border awards flow along the ${dominantCorridor[0]} corridor in the current window.`,
      whyItMatters:
        "Repeated cross-border flows between the same countries reveal structural supplier relationships and potential geopolitical dependencies.",
      linkedNoticeIds: dominantCorridor[1],
    });
  }

  // 5. Large planning-stage notice (demand signal ahead of award)
  const bigPlanning = notices
    .filter((n) => n.stage === "planning" && n.valueEur >= 200_000_000)
    .sort((a, b) => b.valueEur - a.valueEur)[0];
  if (bigPlanning) {
    anomalies.push({
      id: `early-demand-${bigPlanning.id}`,
      severity: "medium",
      title: `Early demand signal: ${formatBillions(bigPlanning.valueEur)} in ${bigPlanning.theme} (planning stage)`,
      detail: `${bigPlanning.buyerName} signalled ${formatBillions(bigPlanning.valueEur)} in ${bigPlanning.theme} procurement, still in planning. Award conversion likely within 6–18 months.`,
      whyItMatters:
        "Planning-stage notices are leading indicators. Acting on them before awards are public provides a strategic intelligence advantage.",
      linkedNoticeIds: [bigPlanning.id],
    });
  }

  return anomalies;
}

// ─── Entity Resolution ────────────────────────────────────────────────────────

function buildBuyerResolutions(
  notices: TedIntelNotice[],
): TedIntelBuyerResolution[] {
  const seen = new Set<string>();
  return notices
    .filter((n) => {
      if (seen.has(n.buyerName)) return false;
      seen.add(n.buyerName);
      return true;
    })
    .map((n) => ({
      raw: n.buyerName,
      normalized: n.buyerName,
      classification: classifyBuyerType(n.buyerType),
      country: n.buyerCountry,
      region: n.buyerRegion,
      coordinates: n.buyerCoordinates,
      confidence: round(n.confidence, 2),
      evidenceRef: [
        `TED notice ${n.sourceId}`,
        `Buyer type declared as "${n.buyerType}"`,
      ],
    }));
}

function buildSupplierResolutions(
  notices: TedIntelNotice[],
): TedIntelSupplierResolution[] {
  const seen = new Set<string>();
  return notices
    .filter((n) => n.winner)
    .filter((n) => {
      const key = n.winner!.name;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((n) => ({
      raw: n.winner!.name,
      normalized: n.winner!.name,
      parentCompany: n.winner!.parentCompany,
      parentConfidence: n.winner!.parentCompany ? 0.9 : 0,
      tickerMappings: (n.winner!.listedTickers ?? []).map((ticker) => ({
        ticker,
        exchange: inferTickerExchange(ticker),
        confidence: 0.85,
        evidence: `Derived from TED award notice ${n.sourceId}.`,
      })),
      country: n.winner!.country,
      isCrossBorder: n.winner!.country !== n.buyerCountry,
      isPubliclyListed: (n.winner!.listedTickers ?? []).length > 0,
      evidenceRef: [
        `TED notice ${n.sourceId}`,
        `Winner declared in award notice`,
      ],
    }));
}

// ─── Signal Engine ────────────────────────────────────────────────────────────

function buildSignals(
  notices: TedIntelNotice[],
  sectors: TedIntelSectorMomentum[],
  suppliers: TedIntelSupplierPulse[],
): TedIntelSignal[] {
  const signals: TedIntelSignal[] = [];
  const awarded = notices.filter(
    (n) => n.stage === "award" || n.stage === "execution",
  );
  const now = BASE_NOW_ISO;

  // 1. Sector cluster signals for top sectors
  for (const sector of sectors.slice(0, 4)) {
    if (sector.momentumScore < 0.8) continue;
    const dims: TedIntelSignalDimensions = {
      marketRelevance: Math.min(1, sector.momentumScore / 3),
      supplyChainImpact: sector.awardedCount > 0 ? 0.8 : 0.5,
      geoStrategic: 0.7,
      novelty: 0.5,
      urgency: 0.6,
      momentum: Math.min(1, sector.momentumScore / 2),
      confidence: 0.85,
    };
    signals.push({
      id: `sig-cluster-${sector.theme.replace(/\s+/g, "-").slice(0, 40)}`,
      type: "sector_cluster",
      title: `${sector.theme}: ${sector.noticeCount} notices clustered in window`,
      summary: `Government demand in "${sector.theme}" has clustered this window with ${sector.noticeCount} notices worth ${formatBillions(sector.totalValueEur)}. ${sector.awardedCount} awards confirm active spend conversion.`,
      priority: round(computeSignalPriority(dims), 0),
      dimensions: dims,
      linkedNoticeIds: notices
        .filter((n) => n.theme === sector.theme)
        .map((n) => n.id),
      affectedEntities: [{ kind: "sector", name: sector.theme }],
      evidence: [
        `${sector.noticeCount} TED notices tracked in this sector.`,
        `${sector.awardedCount} have reached award or execution stage.`,
        `Total tracked value: ${formatBillions(sector.totalValueEur)}.`,
      ],
      aiExplanation: `Sector clustering is a leading indicator of structural government demand, not episodic spending. "${sector.theme}" shows a momentum score of ${sector.momentumScore.toFixed(2)} — aggregating stage weight, strategic relevance, and recurrence.`,
      createdAt: now,
    });
  }

  // 2. Repeat winner signals
  for (const supplier of suppliers.filter((s) => s.awardCount >= 2)) {
    const dims: TedIntelSignalDimensions = {
      marketRelevance: 0.75,
      supplyChainImpact: 0.85,
      geoStrategic: 0.5,
      novelty: 0.2,
      urgency: 0.5,
      momentum: 0.8,
      confidence: 0.9,
    };
    signals.push({
      id: `sig-repeat-${supplier.supplierName.replace(/\s+/g, "-").slice(0, 30)}`,
      type: "repeat_winner",
      title: `${supplier.supplierName} — repeat award pattern detected`,
      summary: `${supplier.supplierName} has secured ${supplier.awardCount} awards worth ${formatBillions(supplier.totalAwardValueEur)} this window. Recurrence indicates structural advantage or incumbent concentration.`,
      priority: round(computeSignalPriority(dims), 0),
      dimensions: dims,
      linkedNoticeIds: awarded
        .filter((n) => n.winner?.name === supplier.supplierName)
        .map((n) => n.id),
      affectedEntities: [{ kind: "supplier", name: supplier.supplierName }],
      evidence: [
        `${supplier.supplierName} appears in ${supplier.awardCount} separate award notices.`,
        `Combined awarded value: ${formatBillions(supplier.totalAwardValueEur)}.`,
        `Dependence score: ${supplier.dependenceScore.toFixed(2)} (recurrence × strategic weight).`,
      ],
      aiExplanation: `Repeat award wins suggest this supplier holds a structural advantage: incumbent relationships, technical lock-in, or limited competition in their procurement categories. Public-sector exposure is becoming a durable revenue stream.`,
      createdAt: now,
    });
  }

  // 3. Value spike signals — high-value individual contracts
  for (const notice of notices.filter(
    (n) =>
      n.valueEur >= 350_000_000 &&
      (n.stage === "award" || n.stage === "tendering"),
  )) {
    const isCross =
      notice.winner && notice.winner.country !== notice.buyerCountry;
    const dims: TedIntelSignalDimensions = {
      marketRelevance: 0.9,
      supplyChainImpact: notice.winner ? 0.85 : 0.6,
      geoStrategic: isCross ? 0.8 : 0.65,
      novelty: notice.novelty,
      urgency: notice.urgency,
      momentum: notice.recurrence * 0.8,
      confidence: notice.confidence,
    };
    signals.push({
      id: `sig-spike-${notice.id}`,
      type: "value_spike",
      title: `${formatBillions(notice.valueEur)} ${notice.stage} in ${notice.theme}`,
      summary: `${notice.buyerName} issued a ${notice.stage}-stage procurement notice worth ${formatBillions(notice.valueEur)} in "${notice.theme}".`,
      priority: round(computeSignalPriority(dims), 0),
      dimensions: dims,
      linkedNoticeIds: [notice.id],
      affectedEntities: [
        { kind: "buyer", name: notice.buyerName },
        ...(notice.winner
          ? [{ kind: "supplier" as const, name: notice.winner.name }]
          : []),
        { kind: "sector", name: notice.theme },
      ],
      evidence: notice.evidence.directlyStatedFacts,
      aiExplanation: `High-value procurement at this scale is unlikely to be a one-off. ${notice.evidence.aiInference[0] ?? "The structural demand interpretation is supported by the threshold size and stage."}`,
      createdAt: now,
    });
  }

  // 4. Cross-border flow signals
  for (const notice of awarded.filter(
    (n) => n.winner && n.winner.country !== n.buyerCountry,
  )) {
    const dims: TedIntelSignalDimensions = {
      marketRelevance: 0.7,
      supplyChainImpact: 0.75,
      geoStrategic: 0.85,
      novelty: notice.novelty,
      urgency: 0.5,
      momentum: notice.recurrence * 0.7,
      confidence: notice.confidence,
    };
    signals.push({
      id: `sig-xborder-${notice.id}`,
      type: "cross_border_flow",
      title: `Cross-border award: ${notice.buyerCountry} → ${notice.winner?.country}`,
      summary: `${notice.buyerName} awarded ${formatBillions(notice.valueEur)} to ${notice.winner?.name} (${notice.winner?.country}), creating a procurement flow from ${notice.buyerCountry} to ${notice.winner?.country}.`,
      priority: round(computeSignalPriority(dims), 0),
      dimensions: dims,
      linkedNoticeIds: [notice.id],
      affectedEntities: [
        { kind: "buyer", name: notice.buyerName },
        { kind: "supplier", name: notice.winner?.name ?? "" },
        { kind: "region", name: notice.buyerRegion },
      ],
      evidence: [
        `Buyer: ${notice.buyerName} (${notice.buyerCountry}).`,
        `Winner: ${notice.winner?.name} (${notice.winner?.country}).`,
        `Contract value: ${formatBillions(notice.valueEur)}.`,
      ],
      aiExplanation: `Cross-border procurement flows reveal pan-European market integration patterns. This corridor may indicate that ${notice.buyerCountry} lacks domestic capability in ${notice.theme}, creating ongoing import demand from ${notice.winner?.country}.`,
      createdAt: now,
    });
  }

  // De-duplicate, sort by priority descending
  const seen = new Set<string>();
  return signals
    .filter((s) => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    })
    .sort((a, b) => b.priority - a.priority);
}

// ─── Momentum Timelines ───────────────────────────────────────────────────────

function buildMomentumTimelines(
  notices: TedIntelNotice[],
  window: TedIntelTimeWindow,
): TedIntelMomentumTimeline[] {
  const totalDays = daysForWindow(window);
  const segmentDays = Math.floor(totalDays / 3);
  const nowMs = new Date(BASE_NOW_ISO).getTime();

  // Top themes by total notice count
  const themeCount = new Map<string, number>();
  for (const n of notices) {
    themeCount.set(n.theme, (themeCount.get(n.theme) ?? 0) + 1);
  }
  const topThemes = [...themeCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map((e) => e[0]);

  return topThemes.map((theme) => {
    const themeNotices = notices.filter((n) => n.theme === theme);

    const points: TedIntelMomentumPoint[] = [2, 1, 0].map((seg) => {
      const segEnd = nowMs - seg * segmentDays * 86_400_000;
      const segStart = segEnd - segmentDays * 86_400_000;
      const segNotices = themeNotices.filter((n) => {
        const t = new Date(n.publishedAt).getTime();
        return t >= segStart && t < segEnd;
      });
      const totalValue = segNotices.reduce((s, n) => s + n.valueEur, 0);
      const awardCount = segNotices.filter(
        (n) => n.stage === "award" || n.stage === "execution",
      ).length;
      const momentumIndex = Math.min(
        100,
        Math.round(
          segNotices.reduce(
            (sum, n) => sum + stageWeight(n.stage) * (n.strategicWeight / 100),
            0,
          ) * 25,
        ),
      );
      const labels = ["Earlier", "Mid", "Recent"] as const;
      return {
        label: labels[2 - seg] ?? "—",
        noticeCount: segNotices.length,
        awardCount,
        totalValueEur: totalValue,
        momentumIndex,
      };
    });

    const firstIdx = points[0]?.momentumIndex ?? 0;
    const lastIdx = points[points.length - 1]?.momentumIndex ?? 0;
    const changePercent =
      firstIdx === 0
        ? 0
        : round(((lastIdx - firstIdx) / Math.max(1, firstIdx)) * 100, 1);

    return {
      theme,
      points,
      trend:
        changePercent > 15
          ? "accelerating"
          : changePercent < -15
            ? "decelerating"
            : "stable",
      changePercent,
    };
  });
}

// ─── Concentration Risk ───────────────────────────────────────────────────────

function buildConcentrationRisks(
  notices: TedIntelNotice[],
  suppliers: TedIntelSupplierPulse[],
  sectors: TedIntelSectorMomentum[],
): TedIntelConcentrationRisk[] {
  const risks: TedIntelConcentrationRisk[] = [];
  const awarded = notices.filter(
    (n) => n.stage === "award" || n.stage === "execution",
  );
  const totalAwardValue = awarded.reduce((sum, n) => sum + n.valueEur, 0);

  if (totalAwardValue > 0 && suppliers.length >= 2) {
    const hhi = suppliers.reduce((sum, s) => {
      const share = s.totalAwardValueEur / totalAwardValue;
      return sum + share * share;
    }, 0);
    const topShare = suppliers[0]
      ? suppliers[0].totalAwardValueEur / totalAwardValue
      : 0;
    risks.push({
      id: "conc-supplier",
      type: "supplier",
      subject: "Awarded suppliers",
      herfindahlIndex: round(hhi, 3),
      topShare: round(topShare, 3),
      description: `${suppliers.length} award recipients. Top supplier (${suppliers[0]?.supplierName ?? "—"}) holds ${(topShare * 100).toFixed(1)}% of tracked award value.`,
      riskLevel: hhi > 0.4 ? "high" : hhi > 0.2 ? "medium" : "low",
      linkedNoticeIds: awarded.map((n) => n.id),
    });
  }

  const totalNoticeCount = notices.length;
  if (totalNoticeCount > 0 && sectors.length >= 2) {
    const sectorHHI = sectors.reduce((sum, s) => {
      const share = s.noticeCount / totalNoticeCount;
      return sum + share * share;
    }, 0);
    const topSectorShare = sectors[0]
      ? sectors[0].noticeCount / totalNoticeCount
      : 0;
    risks.push({
      id: "conc-sector",
      type: "sector",
      subject: "Procurement sectors",
      herfindahlIndex: round(sectorHHI, 3),
      topShare: round(topSectorShare, 3),
      description: `${sectors.length} distinct sectors. Top sector (${sectors[0]?.theme ?? "—"}) accounts for ${(topSectorShare * 100).toFixed(1)}% of tracked notices.`,
      riskLevel: sectorHHI > 0.4 ? "high" : sectorHHI > 0.2 ? "medium" : "low",
      linkedNoticeIds: notices
        .filter((n) => n.theme === sectors[0]?.theme)
        .map((n) => n.id),
    });
  }

  return risks;
}

// ─── Second-Order Intelligence ────────────────────────────────────────────────

function buildSecondOrder(
  notices: TedIntelNotice[],
  watchlist: TedIntelWatchlistHit[],
  sectors: TedIntelSectorMomentum[],
): TedIntelSecondOrder[] {
  const items: TedIntelSecondOrder[] = [];
  const awarded = notices.filter(
    (n) => n.stage === "award" || n.stage === "execution",
  );

  // 1. Per watchlist hit
  for (const hit of watchlist) {
    const linked = awarded.filter((n) => hit.linkedNoticeIds.includes(n.id));
    if (linked.length === 0) continue;
    const isRepeat = linked.length >= 2;
    const totalLinkedValue = linked.reduce((s, n) => s + n.valueEur, 0);
    items.push({
      id: `so-watchlist-${hit.ticker}`,
      thesisType: isRepeat ? "supply_chain_beneficiary" : "macro_confirmation",
      headline: isRepeat
        ? `${hit.company} (${hit.ticker}) is a repeat European public-sector beneficiary`
        : `${hit.company} (${hit.ticker}) gains macro procurement exposure in ${hit.themes[0] ?? "public markets"}`,
      explanation: isRepeat
        ? `${hit.company} has appeared in ${linked.length} separate award events worth ${formatBillions(totalLinkedValue)}. This level of recurrence suggests structural public-sector demand rather than coincidental procurement, indicating government revenue as a durable source.`
        : `A single high-value award links ${hit.company} to public procurement in ${hit.themes.join(", ")}. This may confirm a macro thesis already visible in commercial data or signal a new revenue channel opening.`,
      affectedTickers: [hit.ticker],
      affectedSectors: hit.themes,
      confidence: hit.confidence,
      supportingNoticeIds: hit.linkedNoticeIds,
      linkedSystems: [
        "INTELLIGENCE",
        ...(isRepeat ? (["SUPPLY CHAIN"] as const) : []),
        "AI RESEARCH",
      ],
    });
  }

  // 2. Top momentum sector → sector demand support thesis
  const topSector = sectors[0];
  if (topSector && topSector.momentumScore >= 1.2) {
    const sectorNotices = notices.filter((n) => n.theme === topSector.theme);
    const sectorTickers = unique(
      sectorNotices.flatMap((n) => n.winner?.listedTickers ?? []),
    );
    items.push({
      id: `so-sector-demand-${topSector.theme.replace(/\s+/g, "-").slice(0, 40)}`,
      thesisType: "sector_demand_support",
      headline: `"${topSector.theme}" is receiving structural government demand support`,
      explanation: `${topSector.noticeCount} TED notices worth ${formatBillions(topSector.totalValueEur)} have clustered into "${topSector.theme}" this window. Government procurement at this scale is a durable demand signal. Listed companies in adjacent supply chains may benefit as downstream demand converts from award stage into deployment and integration spend.`,
      affectedTickers: sectorTickers,
      affectedSectors: [topSector.theme],
      confidence: 0.82,
      supportingNoticeIds: sectorNotices.map((n) => n.id),
      linkedSystems: ["PANORAMA", "INTELLIGENCE"],
    });
  }

  // 3. Cross-border flow → geopolitical realignment thesis
  const crossBorderAwards = awarded.filter(
    (n) => n.winner && n.winner.country !== n.buyerCountry,
  );
  if (crossBorderAwards.length >= 2) {
    const buyerCountries = unique(crossBorderAwards.map((n) => n.buyerCountry));
    const winnerCountries = unique(
      crossBorderAwards.map((n) => n.winner?.country ?? ""),
    );
    items.push({
      id: "so-geo-realignment",
      thesisType: "geopolitical_realignment",
      headline: `Cross-border procurement flows reveal European defence-industrial dependencies`,
      explanation: `${crossBorderAwards.length} awards involve buyers from ${buyerCountries.join(", ")} awarding contracts to suppliers from ${winnerCountries.join(", ")}. This cross-border pattern maps the real industrial dependencies behind European public procurement, beyond domestic supplier narratives.`,
      affectedTickers: unique(
        crossBorderAwards.flatMap((n) => n.winner?.listedTickers ?? []),
      ),
      affectedSectors: unique(crossBorderAwards.map((n) => n.theme)),
      confidence: 0.76,
      supportingNoticeIds: crossBorderAwards.map((n) => n.id),
      linkedSystems: ["INTELLIGENCE", "PANORAMA"],
    });
  }

  return items;
}

// ─── AI Insights (Evidence-First) ────────────────────────────────────────────

function buildAIInsights(
  notices: TedIntelNotice[],
  anomalies: TedIntelAnomaly[],
  signals: TedIntelSignal[],
  secondOrder: TedIntelSecondOrder[],
): TedIntelAIInsight[] {
  const insights: TedIntelAIInsight[] = [];

  // 1. One insight per high-severity anomaly
  for (const anomaly of anomalies.filter((a) => a.severity === "high")) {
    insights.push({
      id: `ai-anomaly-${anomaly.id}`,
      topic: anomaly.title,
      factBasis: [anomaly.detail],
      inference: anomaly.whyItMatters,
      confidence: 0.88,
      anomalyFlag: true,
      linkedNoticeIds: anomaly.linkedNoticeIds,
      linkedSystems: ["INTELLIGENCE"],
    });
  }

  // 2. Top signal explanation
  const topSignal = signals[0];
  if (topSignal) {
    const relatedNotices = notices.filter((n) =>
      topSignal.linkedNoticeIds.includes(n.id),
    );
    const allFacts = relatedNotices.flatMap(
      (n) => n.evidence.directlyStatedFacts,
    );
    insights.push({
      id: "ai-top-signal",
      topic: `Top signal: ${topSignal.title}`,
      factBasis: allFacts.slice(0, 4),
      inference: topSignal.aiExplanation,
      confidence: round(topSignal.dimensions.confidence, 2),
      anomalyFlag: false,
      linkedNoticeIds: topSignal.linkedNoticeIds,
      linkedSystems: ["INTELLIGENCE", "PANORAMA"],
    });
  }

  // 3. Second-order insight from top thesis
  const topSO = secondOrder[0];
  if (topSO) {
    insights.push({
      id: `ai-second-order-${topSO.id}`,
      topic: `Second-order: ${topSO.headline}`,
      factBasis: [
        `Thesis type: ${topSO.thesisType.replace(/_/g, " ")}.`,
        `${topSO.supportingNoticeIds.length} notices support this thesis.`,
      ],
      inference: topSO.explanation,
      confidence: topSO.confidence,
      anomalyFlag: false,
      linkedNoticeIds: topSO.supportingNoticeIds,
      linkedSystems: [
        "INTELLIGENCE",
        ...(topSO.linkedSystems.includes("PANORAMA")
          ? (["PANORAMA"] as const)
          : []),
      ],
    });
  }

  // 4. Panorama-facing AI insight (supply chain angle)
  const supplyChainNotices = notices.filter(
    (n) =>
      n.evidence.linkedSystems.includes("SUPPLY CHAIN") &&
      (n.stage === "award" || n.stage === "execution"),
  );
  if (supplyChainNotices.length > 0) {
    insights.push({
      id: "ai-supply-chain-angle",
      topic: "Supply chain exposure from public procurement",
      factBasis: supplyChainNotices
        .slice(0, 3)
        .flatMap((n) => n.evidence.directlyStatedFacts.slice(0, 1)),
      inference: `Public procurement is creating measurable supply chain exposure for ${unique(supplyChainNotices.flatMap((n) => n.winner?.listedTickers ?? [])).join(", ") || "several listed companies"}. Award-stage events confirm demand is converting from forecast into contracted revenue.`,
      confidence: 0.82,
      anomalyFlag: false,
      linkedNoticeIds: supplyChainNotices.map((n) => n.id),
      linkedSystems: ["SUPPLY CHAIN", "INTELLIGENCE"],
    });
  }

  return insights;
}

// ─── Vault Records ────────────────────────────────────────────────────────────

function buildVaultRecords(notices: TedIntelNotice[]): TedIntelVaultRecord[] {
  return notices.map((n) => {
    const isHighConf = n.confidence >= 0.85;
    const hasWinner = !!n.winner;
    const zone: TedIntelVaultZone =
      isHighConf && hasWinner
        ? "production"
        : isHighConf || n.stage === "award" || n.stage === "execution"
          ? "validated"
          : n.stage === "tendering" || n.stage === "competition"
            ? "candidate"
            : "raw";
    return {
      noticeId: n.id,
      zone,
      ingestedAt: n.publishedAt,
      normalizedAt: n.publishedAt,
      enrichedAt: n.publishedAt,
      validatedAt:
        zone === "validated" || zone === "production"
          ? n.publishedAt
          : undefined,
      revalidatable: true,
      evidenceRefs: n.evidence.directlyStatedFacts.map(
        (_, i) => `${n.id}/fact-${i}`,
      ),
      exportEligible: zone === "production" || zone === "validated",
    };
  });
}

// ─── Supply Chain Overlay ─────────────────────────────────────────────────────

function buildSupplyChainOverlay(
  awarded: TedIntelNotice[],
  watchlist: TedIntelWatchlistHit[],
): TedIntelSupplyChainOverlay[] {
  return watchlist.map((item) => {
    const linked = awarded.filter((n) => item.linkedNoticeIds.includes(n.id));
    return {
      ticker: item.ticker,
      company: item.company,
      exposureLabel:
        linked.length >= 2
          ? "Repeat public-spend beneficiary"
          : "Single high-value public award linkage",
      linkedAwardValueEur: linked.reduce((sum, n) => sum + n.valueEur, 0),
      confidence: item.confidence,
      buyerRelationships: linked.map((n) => ({
        buyerName: n.buyerName,
        country: n.buyerCountry,
        awardValueEur: n.valueEur,
        theme: n.theme,
      })),
      secondOrderIdeas: [
        `${item.company} can be monitored as a government-demand proxy in ${item.themes.join(", ")}.`,
        `Watch for component, software, and integration suppliers tied to ${item.company} if awards keep compounding.`,
      ],
    };
  });
}

// ─── Main Builder ─────────────────────────────────────────────────────────────

export function buildTedIntelSnapshot(
  window: TedIntelTimeWindow = "90d",
): TedIntelSnapshot {
  const generatedAt = new Date().toISOString();
  const notices = windowedNotices(window);
  const awarded = notices.filter(
    (n) => n.stage === "award" || n.stage === "execution",
  );
  const sourceUpdatedAt = notices.reduce(
    (latest, notice) =>
      notice.publishedAt > latest ? notice.publishedAt : latest,
    notices[0]?.publishedAt ?? BASE_NOW_ISO,
  );

  const totalValue = notices.reduce((sum, n) => sum + n.valueEur, 0);
  const awardValue = awarded.reduce((sum, n) => sum + n.valueEur, 0);

  const repeatWinnerCount = unique(
    awarded.map((n) => n.winner?.name).filter((v): v is string => Boolean(v)),
  ).filter(
    (name) => awarded.filter((n) => n.winner?.name === name).length > 1,
  ).length;

  // Core aggregates
  const sectors = buildSectors(notices);
  const regions = buildRegions(notices);
  const buyers = buildBuyers(notices);
  const suppliers = buildSuppliers(awarded);
  const watchlist = buildWatchlist(awarded);
  const mapFlows = buildMapFlows(awarded);

  // Anomaly detection (expanded — 5 signals)
  const anomalies = buildAnomalies(notices, sectors, suppliers);

  // Entity resolution
  const buyerResolutions = buildBuyerResolutions(notices);
  const supplierResolutions = buildSupplierResolutions(notices);

  // Signal engine
  const signals = buildSignals(notices, sectors, suppliers);

  // Momentum timelines
  const momentumTimelines = buildMomentumTimelines(notices, window);

  // Concentration risks
  const concentrationRisks = buildConcentrationRisks(
    notices,
    suppliers,
    sectors,
  );

  // Second-order intelligence
  const secondOrder = buildSecondOrder(notices, watchlist, sectors);

  // AI evidence-first insights
  const aiInsights = buildAIInsights(notices, anomalies, signals, secondOrder);

  // Supply chain overlay
  const supplyChainOverlay = buildSupplyChainOverlay(awarded, watchlist);

  // Data vault
  const vaultRecords = buildVaultRecords(notices);
  const productionCount = vaultRecords.filter(
    (r) => r.zone === "production",
  ).length;
  const validatedCount = vaultRecords.filter(
    (r) => r.zone === "validated" || r.zone === "production",
  ).length;

  const dataVault: TedIntelVaultSummary = {
    rawCount: notices.length,
    normalizedCount: notices.length,
    enrichedCount: productionCount + validatedCount,
    lastIngestedAt: generatedAt,
    auditTrail: [
      "Raw TED notice payload retained for every notice in the window.",
      "Normalized layer resolves buyer, winner, stage, geography, value, and theme.",
      "Enriched layer attaches entity resolution, watchlist linkage, scoring, and explainable evidence.",
      `Production zone: ${productionCount} notices (high-confidence, winner-resolved).`,
      `Validated zone: ${validatedCount} notices (award-stage or confidence ≥ 0.85).`,
    ],
  };

  // Summary cards
  const summaryCards: TedIntelSummaryCard[] = [
    {
      label: "Government Demand Pulse",
      value: formatBillions(totalValue),
      delta: `${notices.length} notices`,
      tone: "positive",
      detail:
        "Total structured procurement value captured in the active TED window.",
    },
    {
      label: "Award Conversion",
      value: `${awarded.length}`,
      delta: formatBillions(awardValue),
      tone: awarded.length >= 3 ? "positive" : "neutral",
      detail:
        "Awards and execution-stage notices confirming spend beyond planning.",
    },
    {
      label: "Active Buyers",
      value: `${buyers.length}`,
      delta: buyers[0]?.buyerName ?? "-",
      tone: "neutral",
      detail: "Distinct public buyers visible in the filtered procurement set.",
    },
    {
      label: "Repeat Winners",
      value: `${repeatWinnerCount}`,
      delta: suppliers[0]?.supplierName ?? "-",
      tone: repeatWinnerCount > 0 ? "elevated" : "neutral",
      detail:
        "Suppliers winning repeatedly — useful for concentration analysis.",
    },
    {
      label: "Watchlist Linkages",
      value: `${watchlist.length}`,
      delta: watchlist[0]?.ticker ?? "-",
      tone: watchlist.length >= 3 ? "positive" : "neutral",
      detail:
        "Listed-company mappings grounded in awarded suppliers and parent links.",
    },
  ];

  // Panorama pulse
  const panorama: TedIntelPanoramaPulse = {
    headline: `${sectors[0]?.theme ?? "Procurement"} is leading government demand momentum in Europe`,
    bullets: [
      buyers[0]
        ? `${buyers[0].buyerName} is the highest-activity buyer in the selected window.`
        : "No buyer pulse available.",
      suppliers[0]
        ? `${suppliers[0].supplierName} is the top awarded supplier by captured value.`
        : "No supplier concentration visible.",
      regions[0]
        ? `${regions[0].label} is the hottest public-spend geography in the dataset.`
        : "No regional heat available.",
    ],
  };

  return {
    generatedAt,
    sourceUpdatedAt,
    sourceMode: "mock",
    sourceLabel: "MOCK DATA - Local fallback TED demo dataset",
    timeWindow: window,
    summaryCards,
    sectors,
    regions,
    buyers,
    suppliers,
    watchlist,
    mapFlows,
    anomalies,
    radar: notices,
    buyerResolutions,
    supplierResolutions,
    signals,
    momentumTimelines,
    concentrationRisks,
    secondOrder,
    aiInsights,
    dataVault,
    vaultRecords,
    supplyChainOverlay,
    panorama,
    availableThemes: unique(notices.map((n) => n.theme)).sort(),
    availableCountries: unique(notices.map((n) => n.buyerCountry)).sort(),
    availableBuyers: unique(notices.map((n) => n.buyerName)).sort(),
    availableSuppliers: unique(
      awarded.map((n) => n.winner?.name ?? "").filter(Boolean),
    ).sort(),
    availableLifecycleStages: unique(
      notices.map((n) => n.stage),
    ) as TedIntelLifecycleStage[],
  };
}

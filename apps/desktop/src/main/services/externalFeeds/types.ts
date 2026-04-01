export type ProviderAuthType = "none" | "apiKey";

export interface ProviderCredentialField {
  key: string;
  label: string;
  optional?: boolean;
}

export interface ProviderTestResult {
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export interface ExternalFeedsConfig {
  enabled: {
    cftc: boolean;
    bls: boolean;
    sec: boolean;
  };
  bls?: {
    apiKeyId?: string;
    apiKeyAccount?: string;
  };
  cftc?: {
    mappingPath?: string;
    sampleZipPath?: string;
  };
  sec?: {
    cikMappingPath?: string;
    userAgent?: string;
  };
}

export interface ProviderTestContext {
  config: ExternalFeedsConfig;
  credentials?: Record<string, string>;
}

export interface ExternalProvider {
  providerId: "CFTC_COT" | "BLS_JOLTS" | "SEC_EDGAR";
  displayName: string;
  baseUrl: string;
  authType: ProviderAuthType;
  credentialFields?: ProviderCredentialField[];
  testProbe: (ctx: ProviderTestContext) => Promise<ProviderTestResult>;
}

export interface PositioningSeries {
  symbol: string;
  marketCode: string;
  asOfDate: string; // YYYY-MM-DD
  net: number;
  delta4w: number;
  percentile?: number;
  categories: Record<string, {
    long: number;
    short: number;
    spread?: number;
    net: number;
  }>;
}

export interface MacroSeries {
  seriesId: string;
  name: string;
  frequency: "M" | "W" | "D";
  points: Array<{ date: string; value: number }>;
}

export interface EventStreamItem {
  source: "SEC";
  type: "FORM4" | "8K";
  cik: string;
  ticker?: string;
  filedAt: string;
  title: string;
  url: string;
  summaryFields?: Record<string, string | number | null>;
}

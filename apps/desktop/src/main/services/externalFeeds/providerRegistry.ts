import { ExternalProvider, ExternalFeedsConfig, ProviderTestContext, ProviderTestResult } from "./types";
import { testBlsConnection, testCftcConnection, testSecConnection } from "./probes";

const BLS_BASE = "https://api.bls.gov";
const SEC_BASE = "https://www.sec.gov";
const CFTC_BASE = "https://www.cftc.gov";

const PROVIDERS: ExternalProvider[] = [
  {
    providerId: "CFTC_COT",
    displayName: "CFTC Commitments of Traders",
    baseUrl: CFTC_BASE,
    authType: "none",
    testProbe: testCftcConnection,
  },
  {
    providerId: "BLS_JOLTS",
    displayName: "BLS JOLTS",
    baseUrl: BLS_BASE,
    authType: "apiKey",
    credentialFields: [{ key: "BLS_API_KEY", label: "BLS API Key" }],
    testProbe: testBlsConnection,
  },
  {
    providerId: "SEC_EDGAR",
    displayName: "SEC EDGAR",
    baseUrl: SEC_BASE,
    authType: "none",
    testProbe: testSecConnection,
  },
];

export function listProviders() {
  return [...PROVIDERS];
}

export function getProvider(providerId: ExternalProvider["providerId"]) {
  return PROVIDERS.find((p) => p.providerId === providerId) ?? null;
}

export function detectProviderByBaseUrl(baseUrl: string | undefined | null): ExternalProvider | null {
  if (!baseUrl) return null;
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    if (host.includes("api.bls.gov")) return getProvider("BLS_JOLTS");
    if (host.includes("sec.gov")) return getProvider("SEC_EDGAR");
    if (host.includes("cftc.gov")) return getProvider("CFTC_COT");
  } catch {
    return null;
  }
  return null;
}

export function detectProvider(params: { baseUrl?: string | null; apiKey?: string | null }): ExternalProvider | null {
  const byBaseUrl = detectProviderByBaseUrl(params.baseUrl ?? null);
  if (byBaseUrl) return byBaseUrl;
  if (params.apiKey) {
    return getProvider("BLS_JOLTS");
  }
  return null;
}

export async function runProviderTest(
  providerId: ExternalProvider["providerId"],
  ctx: ProviderTestContext
): Promise<ProviderTestResult> {
  const provider = getProvider(providerId);
  if (!provider) {
    return { ok: false, message: `Unknown provider: ${providerId}` };
  }
  return provider.testProbe(ctx);
}

export function defaultExternalFeedsConfig(): ExternalFeedsConfig {
  return {
    enabled: {
      cftc: false,
      bls: false,
      sec: false,
    },
    bls: {},
    cftc: {},
    sec: {},
  };
}

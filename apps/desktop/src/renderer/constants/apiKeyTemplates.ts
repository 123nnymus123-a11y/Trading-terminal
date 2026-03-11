import type { ApiKeyProvider } from "../../shared/apiHub";

export type ApiKeyTemplateField = {
  key: string;
  label: string;
  placeholder?: string;
};

export type ApiKeyTemplate = {
  label: string;
  secrets: ApiKeyTemplateField[];
  config?: ApiKeyTemplateField[];
};

export const API_KEY_TEMPLATES: Record<ApiKeyProvider, ApiKeyTemplate> = {
  alpaca: {
    label: "Alpaca (Market + Trading)",
    secrets: [
      { key: "APCA_API_KEY_ID", label: "API Key ID" },
      { key: "APCA_API_SECRET_KEY", label: "API Secret" },
    ],
    config: [
      { key: "ALPACA_DATA_BASE_URL", label: "Data Base URL", placeholder: "https://data.alpaca.markets" },
      { key: "ALPACA_DATA_FEED", label: "Data Feed", placeholder: "iex" },
    ],
  },
  polygon: {
    label: "Polygon",
    secrets: [{ key: "POLYGON_API_KEY", label: "API Key" }],
  },
  finnhub: {
    label: "Finnhub",
    secrets: [{ key: "FINNHUB_API_KEY", label: "API Key" }],
  },
  quiver: {
    label: "Quiver",
    secrets: [{ key: "QUIVER_API_KEY", label: "API Key" }],
  },
  "interactive-brokers": {
    label: "Interactive Brokers",
    secrets: [{ key: "IB_API_KEY", label: "API Key" }],
  },
  coinbase: {
    label: "Coinbase",
    secrets: [
      { key: "COINBASE_API_KEY", label: "API Key" },
      { key: "COINBASE_API_SECRET", label: "API Secret" },
    ],
  },
  bls: {
    label: "BLS (JOLTS)",
    secrets: [{ key: "BLS_API_KEY", label: "BLS API Key" }],
    config: [{ key: "BASE_URL", label: "Base URL", placeholder: "https://api.bls.gov" }],
  },
  fred: {
    label: "FRED (Economic Data)",
    secrets: [{ key: "FRED_API_KEY", label: "FRED API Key" }],
  },
  other: {
    label: "Other",
    secrets: [{ key: "API_KEY", label: "API Key" }],
    config: [{ key: "BASE_URL", label: "Base URL", placeholder: "https://api.example.com" }],
  },
  brave: {
    label: "Brave Search",
    secrets: [{ key: "API_KEY", label: "API Key" }],
    config: [
      { key: "MAX_RESULTS", label: "Max Results Per Query", placeholder: "5" },
    ],
  },
};

export type ApiKeyProviderOption = keyof typeof API_KEY_TEMPLATES;

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
      {
        key: "ALPACA_DATA_BASE_URL",
        label: "Data Base URL",
        placeholder: "https://data.alpaca.markets",
      },
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
    config: [
      {
        key: "BASE_URL",
        label: "Base URL",
        placeholder: "https://api.bls.gov",
      },
    ],
  },
  fred: {
    label: "FRED (Economic Data)",
    secrets: [{ key: "FRED_API_KEY", label: "FRED API Key" }],
  },
  openai: {
    label: "OpenAI",
    secrets: [{ key: "OPENAI_API_KEY", label: "API Key" }],
    config: [
      { key: "DEFAULT_MODEL", label: "Default Model", placeholder: "gpt-4o" },
    ],
  },
  anthropic: {
    label: "Anthropic",
    secrets: [{ key: "ANTHROPIC_API_KEY", label: "API Key" }],
    config: [
      {
        key: "DEFAULT_MODEL",
        label: "Default Model",
        placeholder: "claude-3-5-sonnet-latest",
      },
    ],
  },
  gemini: {
    label: "Google Gemini",
    secrets: [{ key: "GEMINI_API_KEY", label: "API Key" }],
    config: [
      {
        key: "DEFAULT_MODEL",
        label: "Default Model",
        placeholder: "gemini-2.5-pro",
      },
    ],
  },
  mistral: {
    label: "Mistral",
    secrets: [{ key: "MISTRAL_API_KEY", label: "API Key" }],
    config: [
      {
        key: "DEFAULT_MODEL",
        label: "Default Model",
        placeholder: "mistral-large-latest",
      },
    ],
  },
  groq: {
    label: "Groq",
    secrets: [{ key: "GROQ_API_KEY", label: "API Key" }],
    config: [
      {
        key: "DEFAULT_MODEL",
        label: "Default Model",
        placeholder: "llama-3.3-70b-versatile",
      },
    ],
  },
  xai: {
    label: "xAI / Grok",
    secrets: [{ key: "XAI_API_KEY", label: "API Key" }],
    config: [
      { key: "DEFAULT_MODEL", label: "Default Model", placeholder: "grok-3" },
    ],
  },
  ted: {
    label: "TED Live Feed",
    secrets: [{ key: "TED_API_KEY", label: "API Key" }],
    config: [
      {
        key: "BASE_URL",
        label: "Base URL",
        placeholder: "https://your-ted-provider.example/api/tedintel",
      },
      {
        key: "AUTH_HEADER",
        label: "Auth Header",
        placeholder: "x-api-key",
      },
      {
        key: "TIMEOUT_MS",
        label: "Timeout (ms)",
        placeholder: "12000",
      },
      {
        key: "WINDOW_QUERY_PARAM",
        label: "Window Query Param",
        placeholder: "window",
      },
      {
        key: "ENABLED",
        label: "Enabled",
        placeholder: "true",
      },
    ],
  },
  other: {
    label: "Other",
    secrets: [{ key: "API_KEY", label: "API Key" }],
    config: [
      {
        key: "BASE_URL",
        label: "Base URL",
        placeholder: "https://api.example.com",
      },
    ],
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

export type ApiKeyProvider =
  | "alpaca"
  | "polygon"
  | "finnhub"
  | "quiver"
  | "interactive-brokers"
  | "coinbase"
  | "bls"
  | "fred"
  | "openai"
  | "anthropic"
  | "gemini"
  | "mistral"
  | "groq"
  | "xai"
  | "brave"
  | "ted"
  | "other";

export interface ApiCredentialField {
  key: string;
  label: string;
  account: string;
}

export interface ApiCredentialRecord {
  id: string;
  name: string;
  provider: ApiKeyProvider | string;
  createdAt: number;
  fields: ApiCredentialField[];
  config?: Record<string, string>;
}

export interface ApiHubSnapshot {
  records: ApiCredentialRecord[];
  updatedAt: number;
}

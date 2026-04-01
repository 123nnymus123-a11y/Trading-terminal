/**
 * Cloud LLM Configuration
 *
 * Reads and validates environment variables for the configured cloud AI provider.
 * Call validateConfig() on startup to catch missing vars before any window opens.
 */

export type CloudLlmProvider = "openai" | "gemini";

export interface CloudLlmConfig {
  provider: CloudLlmProvider;
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
}

export function getProvider(): CloudLlmProvider {
  const raw = process.env.CLOUD_AI_PROVIDER?.trim().toLowerCase();
  if (!raw) {
    return "openai";
  }
  if (raw !== "openai" && raw !== "gemini") {
    throw new Error(
      `CLOUD_AI_PROVIDER="${raw}" is not supported. Use "openai" or "gemini".`,
    );
  }
  return raw;
}

export function getApiKey(provider: CloudLlmProvider = getProvider()): string {
  if (provider === "openai") {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) {
      throw new Error(
        "OPENAI_API_KEY is not set. Get your key at https://platform.openai.com/api-keys " +
          "and add OPENAI_API_KEY=sk-proj-... to your .env.local file.",
      );
    }
    return key;
  }
  if (provider === "gemini") {
    const key =
      process.env.GEMINI_API_KEY?.trim() ||
      process.env.GOOGLE_GEMINI_API_KEY?.trim();
    if (!key) {
      throw new Error(
        "GEMINI_API_KEY is not set. Add GEMINI_API_KEY=... (or GOOGLE_GEMINI_API_KEY) to your .env.local file.",
      );
    }
    return key;
  }
  throw new Error(`Unknown provider: ${provider}`);
}

export function getModel(provider: CloudLlmProvider = getProvider()): string {
  if (provider === "openai") {
    return process.env.OPENAI_MODEL?.trim() || "gpt-4o";
  }
  if (provider === "gemini") {
    return (
      process.env.GEMINI_MODEL?.trim() ||
      process.env.GOOGLE_GEMINI_MODEL?.trim() ||
      "gemini-2.5-pro"
    );
  }
  throw new Error(`Unknown provider: ${provider}`);
}

export function getConfig(): CloudLlmConfig {
  const provider = getProvider();
  return {
    provider,
    apiKey: getApiKey(provider),
    model: getModel(provider),
    timeoutMs: Number(process.env.AI_REQUEST_TIMEOUT_MS) || 30_000,
    maxRetries: Number(process.env.AI_MAX_RETRIES) || 2,
  };
}

/**
 * Call once at startup. Throws with a helpful message if any required var is missing.
 */
export function validateConfig(): void {
  getConfig(); // throws if invalid
}

/**
 * Returns a safe summary without exposing the API key.
 */
export function getConfigSummary(): {
  provider: string;
  model: string;
  keyPresent: boolean;
} {
  try {
    const cfg = getConfig();
    return { provider: cfg.provider, model: cfg.model, keyPresent: true };
  } catch {
    return {
      provider: process.env.CLOUD_AI_PROVIDER ?? "not-set",
      model: process.env.OPENAI_MODEL ?? "not-set",
      keyPresent: false,
    };
  }
}

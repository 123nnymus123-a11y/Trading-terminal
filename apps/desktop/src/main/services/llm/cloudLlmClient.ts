/**
 * Cloud LLM Client — unified interface for all AI calls in the main process.
 *
 * Import this instead of calling Ollama or any provider directly.
 * All services should use callCloudLlm() as the single entry point.
 */

import {
  callOpenAi,
  checkOpenAiAvailable,
  type OpenAiCallOptions,
} from "./openaiClient";
import { callGemini, checkGeminiAvailable } from "./geminiClient";
import { getProvider, getModel } from "./cloudLlmConfig";
import { AppSettingsRepo } from "../../persistence/repos";
import { getSecret } from "../../secrets";

type AnthropicResponse = {
  content?: Array<{ type?: string; text?: string }>;
  error?: { message?: string };
};

type SupportedCloudProvider =
  | "openai"
  | "anthropic"
  | "gemini"
  | "mistral"
  | "groq"
  | "xai"
  | "ollama";

export interface CloudLlmOptions extends OpenAiCallOptions {
  providerOverride?: SupportedCloudProvider;
  modelOverride?: string;
}

function normalizeProvider(input?: string): SupportedCloudProvider {
  const normalized = (input || "openai").trim().toLowerCase();
  if (normalized === "openai") return "openai";
  if (normalized === "anthropic") return "anthropic";
  if (normalized === "gemini") return "gemini";
  if (normalized === "mistral") return "mistral";
  if (normalized === "groq") return "groq";
  if (normalized === "xai") return "xai";
  if (normalized === "ollama") return "ollama";
  return "openai";
}

function resolveConfiguredPrimaryModel(): {
  provider?: SupportedCloudProvider;
  model?: string;
} {
  try {
    const settings = AppSettingsRepo.get() as {
      primaryAiModel?: { provider?: string; model?: string };
    };
    const configuredProvider = settings?.primaryAiModel?.provider?.trim();
    const configuredModel = settings?.primaryAiModel?.model?.trim();
    return {
      provider: configuredProvider
        ? normalizeProvider(configuredProvider)
        : undefined,
      model: configuredModel || undefined,
    };
  } catch {
    return {};
  }
}

async function resolveApiHubProviderAuth(
  provider: SupportedCloudProvider,
): Promise<{
  apiKey?: string;
  defaultModel?: string;
}> {
  try {
    const settings = AppSettingsRepo.get() as {
      apiHub?: {
        records?: Array<{
          provider?: string;
          createdAt?: number;
          fields?: Array<{ account?: string }>;
          config?: Record<string, string>;
        }>;
      };
    };

    const records = Array.isArray(settings?.apiHub?.records)
      ? settings.apiHub.records
      : [];

    const candidates = records
      .filter((record) => normalizeProvider(record.provider) === provider)
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

    for (const record of candidates) {
      const defaultModel =
        typeof record.config?.DEFAULT_MODEL === "string"
          ? record.config.DEFAULT_MODEL.trim()
          : undefined;

      const fields = Array.isArray(record.fields) ? record.fields : [];
      for (const field of fields) {
        const account = field.account?.trim();
        if (!account) continue;
        const secret = await getSecret(account).catch(() => null);
        if (secret && secret.trim().length > 0) {
          return { apiKey: secret.trim(), defaultModel };
        }
      }
    }

    return {};
  } catch {
    return {};
  }
}

function getEnvProviderDefaults(provider: SupportedCloudProvider): {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
} {
  if (provider === "gemini") {
    return {
      apiKey:
        process.env.GEMINI_API_KEY?.trim() ||
        process.env.GOOGLE_GEMINI_API_KEY?.trim(),
      model:
        process.env.GEMINI_MODEL?.trim() ||
        process.env.GOOGLE_GEMINI_MODEL?.trim() ||
        "gemini-2.5-pro",
    };
  }

  if (provider === "mistral") {
    return {
      apiKey: process.env.MISTRAL_API_KEY?.trim(),
      model: process.env.MISTRAL_MODEL?.trim() || "mistral-large-latest",
      baseUrl: "https://api.mistral.ai",
    };
  }

  if (provider === "groq") {
    return {
      apiKey: process.env.GROQ_API_KEY?.trim(),
      model: process.env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile",
      baseUrl: "https://api.groq.com/openai",
    };
  }

  if (provider === "xai") {
    return {
      apiKey: process.env.XAI_API_KEY?.trim(),
      model: process.env.XAI_MODEL?.trim() || "grok-3",
      baseUrl: "https://api.x.ai",
    };
  }

  if (provider === "anthropic") {
    return {
      apiKey: process.env.ANTHROPIC_API_KEY?.trim(),
      model: process.env.ANTHROPIC_MODEL?.trim() || "claude-3-5-sonnet-latest",
    };
  }

  return {
    apiKey: process.env.OPENAI_API_KEY?.trim(),
    model: process.env.OPENAI_MODEL?.trim() || "gpt-4o",
    baseUrl: process.env.OPENAI_BASE_URL?.trim(),
  };
}

function getOllamaHost(): string {
  const settings = AppSettingsRepo.get() as {
    ollamaHostUrl?: string;
    ollama_host_url?: string;
  };
  return (
    settings?.ollamaHostUrl?.trim() ||
    settings?.ollama_host_url?.trim() ||
    process.env.OLLAMA_BASE_URL?.trim() ||
    process.env.OLLAMA_HOST?.trim() ||
    "http://127.0.0.1:11434"
  ).replace(/\/+$/, "");
}

async function callAnthropic(
  systemPrompt: string,
  userPrompt: string,
  opts: {
    apiKey: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
  },
): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": opts.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 256,
      temperature: opts.temperature ?? 0.3,
      ...(systemPrompt.trim() ? { system: systemPrompt } : {}),
      messages: [{ role: "user", content: userPrompt }],
    }),
    signal: opts.signal,
  });

  const json = (await response.json().catch(() => ({}))) as AnthropicResponse;
  if (!response.ok) {
    const detail = json.error?.message ?? response.statusText;
    throw new Error(
      `Anthropic ${opts.model} -> HTTP ${response.status}: ${detail}`,
    );
  }

  const text =
    json.content
      ?.filter((item) => item.type === "text" && typeof item.text === "string")
      .map((item) => item.text ?? "")
      .join("")
      .trim() ?? "";

  if (!text) {
    throw new Error(`Anthropic ${opts.model} returned no content in response`);
  }

  return text;
}

async function callOllama(
  systemPrompt: string,
  userPrompt: string,
  opts: {
    model: string;
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
  },
): Promise<string> {
  const host = getOllamaHost();
  const response = await fetch(`${host}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model,
      system: systemPrompt,
      prompt: userPrompt,
      stream: false,
      options: {
        temperature: opts.temperature ?? 0.3,
        ...(typeof opts.maxTokens === "number"
          ? { num_predict: opts.maxTokens }
          : {}),
      },
    }),
    signal: opts.signal,
  });

  const json = (await response.json().catch(() => null)) as {
    response?: string;
    error?: string;
  } | null;
  if (!response.ok) {
    const detail = json?.error?.trim() || response.statusText;
    throw new Error(
      `Ollama ${opts.model} -> HTTP ${response.status}: ${detail}`,
    );
  }

  const text = json?.response?.trim() || "";
  if (!text) {
    throw new Error(`Ollama ${opts.model} returned no content in response`);
  }
  return text;
}

/**
 * Send a prompt to the configured cloud LLM and return the text response.
 *
 * @param systemPrompt - Instruction context for the model
 * @param userPrompt   - The actual user / data prompt
 * @param opts         - Optional temperature, maxTokens, AbortSignal
 */
export async function callCloudLlm(
  systemPrompt: string,
  userPrompt: string,
  opts: CloudLlmOptions = {},
): Promise<string> {
  const configuredPrimary = resolveConfiguredPrimaryModel();
  const provider = normalizeProvider(
    opts.providerOverride ?? configuredPrimary.provider ?? getProvider(),
  );
  const configuredModel =
    configuredPrimary.provider === provider
      ? configuredPrimary.model
      : undefined;
  const apiHubAuth = await resolveApiHubProviderAuth(provider);
  const envDefaults = getEnvProviderDefaults(provider);

  if (provider === "gemini") {
    const apiKey =
      opts.apiKeyOverride?.trim() || apiHubAuth.apiKey || envDefaults.apiKey;
    const model =
      opts.modelOverride?.trim() ||
      configuredModel ||
      apiHubAuth.defaultModel ||
      envDefaults.model;
    if (!apiKey) {
      throw new Error(
        "Gemini API key not found. Save it in API Key Hub (Google Gemini) or set GEMINI_API_KEY.",
      );
    }
    return callGemini(systemPrompt, userPrompt, {
      apiKey,
      model: model || "gemini-2.5-pro",
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      signal: opts.signal,
    });
  }

  if (
    provider === "openai" ||
    provider === "mistral" ||
    provider === "groq" ||
    provider === "xai"
  ) {
    const apiKey =
      opts.apiKeyOverride?.trim() || apiHubAuth.apiKey || envDefaults.apiKey;
    const model =
      opts.modelOverride?.trim() ||
      configuredModel ||
      apiHubAuth.defaultModel ||
      envDefaults.model;
    if (!apiKey) {
      throw new Error(
        `${provider} API key not found. Save it in API Key Hub or configure env vars.`,
      );
    }
    return callOpenAi(systemPrompt, userPrompt, {
      ...opts,
      modelOverride: model,
      apiKeyOverride: apiKey,
      ...(envDefaults.baseUrl ? { baseUrlOverride: envDefaults.baseUrl } : {}),
    });
  }

  if (provider === "anthropic") {
    const apiKey =
      opts.apiKeyOverride?.trim() || apiHubAuth.apiKey || envDefaults.apiKey;
    const model =
      opts.modelOverride?.trim() ||
      configuredModel ||
      apiHubAuth.defaultModel ||
      envDefaults.model ||
      "claude-3-5-sonnet-latest";
    if (!apiKey) {
      throw new Error(
        "Anthropic API key not found. Save it in API Key Hub or configure ANTHROPIC_API_KEY.",
      );
    }
    return callAnthropic(systemPrompt, userPrompt, {
      apiKey,
      model,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      signal: opts.signal,
    });
  }

  if (provider === "ollama") {
    const model =
      opts.modelOverride?.trim() ||
      configuredModel ||
      process.env.OLLAMA_MODEL?.trim() ||
      "llama3.1:8b";
    return callOllama(systemPrompt, userPrompt, {
      model,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      signal: opts.signal,
    });
  }

  // Exhaustive guard — TypeScript will catch unsupported provider additions at compile time
  throw new Error(`Cloud LLM provider "${provider}" is not implemented`);
}

/**
 * Health check — use this instead of pinging localhost:11434.
 */
export async function checkCloudLlmAvailable(): Promise<{
  ok: boolean;
  model: string;
  error?: string;
}> {
  const provider = getProvider();
  if (provider === "gemini") {
    const apiKey =
      process.env.GEMINI_API_KEY?.trim() ||
      process.env.GOOGLE_GEMINI_API_KEY?.trim() ||
      "";
    if (!apiKey) {
      return {
        ok: false,
        model: "gemini-2.5-pro",
        error: "Gemini API key not configured",
      };
    }
    return checkGeminiAvailable(apiKey);
  }
  if (provider === "openai") {
    return checkOpenAiAvailable();
  }
  return {
    ok: false,
    model: "unknown",
    error: `Provider "${provider}" not implemented`,
  };
}

/**
 * Returns a list of model names available under the configured provider.
 * Currently returns the single configured model for simplicity.
 */
export function listAvailableModels(): Array<{
  provider: string;
  model: string;
}> {
  try {
    const provider = getProvider();
    const model = getModel(provider);
    return [{ provider, model }];
  } catch {
    return [];
  }
}

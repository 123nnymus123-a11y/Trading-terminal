/**
 * OpenAI API Client
 *
 * Thin wrapper around the OpenAI Chat Completions endpoint using native fetch.
 * No additional npm dependencies required.
 */

import { getApiKey, getModel } from "./cloudLlmConfig";

export interface OpenAiCallOptions {
  temperature?: number;
  maxTokens?: number;
  /** Abort signal — if not provided, a 30 s internal timeout is used */
  signal?: AbortSignal;
}

interface OpenAiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenAiResponse {
  choices?: Array<{
    message?: { content?: string };
    finish_reason?: string;
  }>;
  error?: { message?: string; type?: string; code?: string };
}

export async function callOpenAi(
  systemPrompt: string,
  userPrompt: string,
  opts: OpenAiCallOptions = {},
): Promise<string> {
  const apiKey = getApiKey("openai");
  const model = getModel("openai");

  const messages: OpenAiMessage[] = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: userPrompt });

  const internalController = new AbortController();
  const internalTimeout = setTimeout(() => internalController.abort(), opts.signal ? 0 : 30_000);

  // If caller supplies their own signal, cancel ours when theirs fires
  if (opts.signal) {
    opts.signal.addEventListener("abort", () => internalController.abort(), { once: true });
    clearTimeout(internalTimeout);
  }

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens ?? 2000,
      }),
      signal: opts.signal ?? internalController.signal,
    });

    const json = (await res.json()) as OpenAiResponse;

    if (!res.ok) {
      const detail = json.error?.message ?? res.statusText;
      const hint =
        res.status === 401
          ? " — check OPENAI_API_KEY in .env.local"
          : res.status === 429
            ? " — rate limited, wait and retry"
            : res.status === 402 || res.status === 403
              ? " — check your OpenAI billing & quota"
              : "";
      throw new Error(`OpenAI ${model} → HTTP ${res.status}: ${detail}${hint}`);
    }

    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error(`OpenAI ${model} returned no content in response`);
    }
    return content;
  } finally {
    clearTimeout(internalTimeout);
  }
}

/**
 * Health-check: returns true when the API key can reach the models list.
 * Uses a short 10 s timeout.
 */
export async function checkOpenAiAvailable(): Promise<{ ok: boolean; model: string; error?: string }> {
  const model = getModel("openai");
  try {
    const apiKey = getApiKey("openai");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        return { ok: false, model, error: `HTTP ${res.status}: ${json.error?.message ?? res.statusText}` };
      }
      return { ok: true, model };
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    return { ok: false, model, error: err instanceof Error ? err.message : String(err) };
  }
}

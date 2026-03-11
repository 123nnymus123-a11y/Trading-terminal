/**
 * Cloud LLM Client — unified interface for all AI calls in the main process.
 *
 * Import this instead of calling Ollama or any provider directly.
 * All services should use callCloudLlm() as the single entry point.
 */

import { callOpenAi, checkOpenAiAvailable, type OpenAiCallOptions } from "./openaiClient";
import { getProvider, getModel } from "./cloudLlmConfig";

export interface CloudLlmOptions extends OpenAiCallOptions {
  // future: provider override, per-call routing logic, etc.
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
  const provider = getProvider();
  if (provider === "openai") {
    return callOpenAi(systemPrompt, userPrompt, opts);
  }
  // Exhaustive guard — TypeScript will catch unsupported provider additions at compile time
  throw new Error(`Cloud LLM provider "${provider}" is not implemented`);
}

/**
 * Health check — use this instead of pinging localhost:11434.
 */
export async function checkCloudLlmAvailable(): Promise<{ ok: boolean; model: string; error?: string }> {
  const provider = getProvider();
  if (provider === "openai") {
    return checkOpenAiAvailable();
  }
  return { ok: false, model: "unknown", error: `Provider "${provider}" not implemented` };
}

/**
 * Returns a list of model names available under the configured provider.
 * Currently returns the single configured model for simplicity.
 */
export function listAvailableModels(): Array<{ provider: string; model: string }> {
  try {
    const provider = getProvider();
    const model = getModel(provider);
    return [{ provider, model }];
  } catch {
    return [];
  }
}

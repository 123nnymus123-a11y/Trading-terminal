import { z } from "zod";
import { callCloudLlm } from "../../llm/cloudLlmClient";
import { getModel } from "../../llm/cloudLlmConfig";

export type CloudProvider =
  | "ollama"
  | "openai"
  | "anthropic"
  | "gemini"
  | "mistral"
  | "groq"
  | "xai";
export type ModelTier = "standard" | "advanced" | "expert";

export interface CloudModelConfig {
  provider: CloudProvider;
  model: string;
  tier: ModelTier;
  temperature?: number;
  maxTokens?: number;
}

export interface CloudModelCapability {
  provider: CloudProvider;
  model: string;
  tier: ModelTier;
  contextWindow: number;
  costPer1kTokens: {
    input: number;
    output: number;
  };
  supportsStreaming: boolean;
  supportsJson: boolean;
  recommendedFor: string[];
}

const AVAILABLE_MODELS: Record<string, CloudModelCapability[]> = {
  openai: [
    {
      provider: "openai",
      model: getModel("openai"),
      tier: "advanced",
      contextWindow: 128000,
      costPer1kTokens: { input: 0.005, output: 0.015 },
      supportsStreaming: true,
      supportsJson: true,
      recommendedFor: ["research_briefing", "analysis", "summarization"],
    },
  ],
};

export function getAvailableModels(
  provider?: CloudProvider,
): CloudModelCapability[] {
  if (provider) {
    return AVAILABLE_MODELS[provider] || [];
  }
  return Object.values(AVAILABLE_MODELS).flat();
}

export function getModelsByTier(tier: ModelTier): CloudModelCapability[] {
  return getAvailableModels().filter((m) => m.tier === tier);
}

export async function callCloudModel(
  config: CloudModelConfig,
  systemPrompt: string,
  userPrompt: string,
  _fallbackToOllama: boolean = true,
): Promise<string> {
  return callCloudLlm(systemPrompt, userPrompt, {
    providerOverride: config.provider,
    modelOverride: config.model,
    temperature: config.temperature ?? 0.3,
    maxTokens: config.maxTokens ?? 2000,
  });
}

/**
 * Parse AI response and validate JSON structure
 */
export async function parseCloudResponse(
  response: string,
  schema: z.ZodSchema,
): Promise<unknown> {
  try {
    const json = JSON.parse(response);
    const validated = await schema.parseAsync(json);
    return validated;
  } catch (error) {
    console.error("[CloudModels] Response parsing error:", error);
    // Try to extract JSON from markdown code blocks
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      try {
        const json = JSON.parse(jsonMatch[1]);
        const validated = await schema.parseAsync(json);
        return validated;
      } catch {
        throw error;
      }
    }
    throw error;
  }
}

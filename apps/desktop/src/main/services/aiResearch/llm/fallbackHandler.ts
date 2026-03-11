/**
 * Cloud Model Fallback Handler
 * 
 * Provides smart fallback logic between cloud and local models
 * with automatic retry and model switching
 */

import type { CloudAiModelConfig } from "../../../../renderer/store/settingsStore";
import { callCloudModel, parseCloudResponse } from "./cloudModels";
import { generateBriefsWithOllama } from "./ollama";
import { z } from "zod";

export type FallbackStrategy = "cloud-first" | "cloud-only" | "local-only" | "balanced";

export interface FallbackConfig {
  strategy: FallbackStrategy;
  cloudModels: CloudAiModelConfig[];
  localModelName: string;
  maxRetries: number;
  retryDelayMs: number;
  timeoutMs: number;
}

export interface CallResult {
  success: boolean;
  result?: string;
  provider?: string;
  model?: string;
  error?: string;
  attemptedProviders: Array<{ provider: string; model: string; error?: string }>;
  fallbackUsed: boolean;
}

/**
 * Attempt to call a cloud model with automatic fallback
 */
export async function callWithFallback(
  config: FallbackConfig,
  systemPrompt: string,
  userPrompt: string,
  resultSchema?: z.ZodSchema
): Promise<CallResult> {
  const attemptedProviders: Array<{ provider: string; model: string; error?: string }> = [];

  // Strategy: cloud-only
  if (config.strategy === "cloud-only") {
    for (const model of config.cloudModels.filter((m) => m.enabled)) {
      try {
        const result = await callCloudModel(
          { ...model, temperature: model.temperature ?? 0.7 },
          systemPrompt,
          userPrompt,
          false // no fallback for cloud-only
        );

        if (resultSchema) {
          const parsed = await parseCloudResponse(result, resultSchema);
          return {
            success: true,
            result: JSON.stringify(parsed),
            provider: model.provider,
            model: model.model,
            attemptedProviders,
            fallbackUsed: false,
          };
        }

        return {
          success: true,
          result,
          provider: model.provider,
          model: model.model,
          attemptedProviders,
          fallbackUsed: false,
        };
      } catch (error) {
        attemptedProviders.push({
          provider: model.provider,
          model: model.model,
          error: String(error),
        });
      }
    }

    return {
      success: false,
      error: "All cloud models failed",
      attemptedProviders,
      fallbackUsed: false,
    };
  }

  // Strategy: local-only
  if (config.strategy === "local-only") {
    try {
      const result = await generateBriefsWithOllama(
        config.localModelName,
        systemPrompt,
        userPrompt
      );
      return {
        success: true,
        result: JSON.stringify(result),
        provider: "ollama",
        model: config.localModelName,
        attemptedProviders,
        fallbackUsed: false,
      };
    } catch (error) {
      return {
        success: false,
        error: String(error),
        provider: "ollama",
        model: config.localModelName,
        attemptedProviders: [
          {
            provider: "ollama",
            model: config.localModelName,
            error: String(error),
          },
        ],
        fallbackUsed: false,
      };
    }
  }

  // Strategy: cloud-first or balanced
  // Try cloud models first
  for (const model of config.cloudModels.filter((m) => m.enabled)) {
    try {
      const result = await callCloudModel(
        { ...model, temperature: model.temperature ?? 0.7 },
        systemPrompt,
        userPrompt,
        true // allow fallback
      );

      if (resultSchema) {
        const parsed = await parseCloudResponse(result, resultSchema);
        return {
          success: true,
          result: JSON.stringify(parsed),
          provider: model.provider,
          model: model.model,
          attemptedProviders,
          fallbackUsed: false,
        };
      }

      return {
        success: true,
        result,
        provider: model.provider,
        model: model.model,
        attemptedProviders,
        fallbackUsed: false,
      };
    } catch (error) {
      attemptedProviders.push({
        provider: model.provider,
        model: model.model,
        error: String(error),
      });
      console.warn(`[Fallback] Cloud model ${model.provider}/${model.model} failed:`, error);
    }
  }

  // Fallback to local Ollama
  if (config.strategy === "cloud-first" || config.strategy === "balanced") {
    try {
      console.warn(
        `[Fallback] Cloud models exhausted, attempting local Ollama (${config.localModelName})`
      );
      const result = await generateBriefsWithOllama(
        config.localModelName,
        systemPrompt,
        userPrompt
      );
      return {
        success: true,
        result: JSON.stringify(result),
        provider: "ollama",
        model: config.localModelName,
        attemptedProviders,
        fallbackUsed: true,
      };
    } catch (error) {
      attemptedProviders.push({
        provider: "ollama",
        model: config.localModelName,
        error: String(error),
      });
      console.error(`[Fallback] All providers failed`, error);
    }
  }

  return {
    success: false,
    error: `All providers failed (${attemptedProviders.length} attempts)`,
    attemptedProviders,
    fallbackUsed: false,
  };
}

/**
 * Get the best available model from config
 */
export function getAvailableModel(config: FallbackConfig): CloudAiModelConfig | null {
  const enabled = config.cloudModels.filter((m) => m.enabled);
  if (enabled.length === 0) return null;

  // Prefer models with most recent usage
  return enabled.sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0))[0];
}

/**
 * Check if any cloud models are available and ready
 */
export function canUseCloudModels(config: FallbackConfig): boolean {
  return config.cloudModels.filter((m) => m.enabled).length > 0;
}

/**
 * Get fallback strategy based on available resources
 */
export function determineFallbackStrategy(
  cloudModelsAvailable: number,
  localRuntimeAvailable: boolean,
  preferredStrategy: FallbackStrategy
): FallbackStrategy {
  if (preferredStrategy === "local-only") return "local-only";
  if (preferredStrategy === "cloud-only") return cloudModelsAvailable > 0 ? "cloud-only" : "local-only";

  if (cloudModelsAvailable > 0 && localRuntimeAvailable) {
    return preferredStrategy === "cloud-first" ? "cloud-first" : "balanced";
  }

  if (cloudModelsAvailable > 0) return "cloud-only";
  if (localRuntimeAvailable) return "local-only";

  return "local-only"; // Default fallback
}

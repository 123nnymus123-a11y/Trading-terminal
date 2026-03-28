import { z } from 'zod';
import type { AppEnv } from '../../config.js';
import { aiBriefSchema } from '../../contracts.js';
import { createLogger } from '../../logger.js';

const logger = createLogger('ollama-client');

// --- OpenAI-compatible response schema ---
const openaiChatResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        role: z.string(),
        content: z.string(),
      }),
    }),
  ),
  model: z.string().optional(),
});

const ollamaChatResponseSchema = z.object({
  message: z.object({
    role: z.string(),
    content: z.string(),
  }),
  model: z.string().optional(),
});

const openaiModelsResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      owned_by: z.string().optional(),
    }),
  ),
});

const ollamaTagsResponseSchema = z.object({
  models: z
    .array(
      z.object({
        name: z.string(),
        modified_at: z.string().optional(),
        size: z.number().optional(),
      }),
    )
    .default([]),
});

const congressAnalysisSchema = z.object({
  category: z.string(),
  sentiment: z.enum(['bullish', 'bearish', 'neutral']),
  sentimentScore: z.number().min(-1).max(1),
  reasoning: z.string(),
  confidence: z.number().min(0).max(1),
});

const supplyChainInsightSchema = z.object({
  relationships: z.array(
    z.object({
      source: z.string(),
      target: z.string(),
      type: z.string(),
      confidence: z.number().min(0).max(1),
    }),
  ),
  insights: z.array(z.string()),
});

function toBaseUrl(endpoint: string): string {
  return endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
}

function buildHeaders(apiKey?: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

function extractJson(raw: string): string {
  const stripped = raw.trim();
  // Strip markdown code fences: ```json ... ``` or ``` ... ```
  const fenceMatch = stripped.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();
  return stripped;
}

// Detect whether the endpoint uses OpenAI-compatible API format
function isOpenAICompatible(baseUrl: string): boolean {
  const lower = baseUrl.toLowerCase();
  // Known OpenAI-compatible providers or /v1 path convention
  return (
    lower.includes('sambanova') ||
    lower.includes('openrouter') ||
    lower.includes('openai.com') ||
    lower.includes('together.xyz') ||
    lower.includes('groq.com') ||
    lower.includes('fireworks.ai') ||
    lower.includes('deepinfra') ||
    lower.includes('perplexity') ||
    lower.endsWith('/v1') ||
    lower.endsWith('/v1/')
  );
}

export class OllamaCloudClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly timeout: number;
  private readonly openaiCompat: boolean;
  private readonly fallbackModels: string[];

  constructor(env: AppEnv) {
    this.baseUrl = toBaseUrl(env.OLLAMA_CLOUD_ENDPOINT);
    this.apiKey = env.OLLAMA_CLOUD_API_KEY ?? env.OLLAMA_API_KEY;
    this.timeout = env.OLLAMA_REQUEST_TIMEOUT_MS;
    this.openaiCompat = isOpenAICompatible(this.baseUrl);
    this.fallbackModels = [env.OLLAMA_SECONDARY_MODEL, env.OLLAMA_TERTIARY_MODEL].filter(
      (model): model is string => !!model,
    );
    logger.info('ollama_client_init', {
      endpoint: this.baseUrl,
      openaiCompat: this.openaiCompat,
      hasKey: !!this.apiKey,
      fallbackModelCount: this.fallbackModels.length,
    });
    if (!env.OLLAMA_CLOUD_API_KEY && env.OLLAMA_API_KEY) {
      logger.warn('ollama_api_key_alias_used', {
        message: 'Using OLLAMA_API_KEY alias; prefer OLLAMA_CLOUD_API_KEY.',
      });
    }
  }

  private orderedModels(primary: string): string[] {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const model of [primary, ...this.fallbackModels]) {
      const normalized = model.trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      ordered.push(normalized);
    }
    return ordered;
  }

  private async withModelFallback<T>(
    primaryModel: string,
    operation: string,
    runForModel: (model: string) => Promise<T>,
  ): Promise<T> {
    const models = this.orderedModels(primaryModel);
    const errors: string[] = [];

    for (let index = 0; index < models.length; index += 1) {
      const model = models[index]!;
      try {
        if (index > 0) {
          logger.warn('ai_model_fallback_attempt', { operation, model, attempt: index + 1 });
        }
        return await runForModel(model);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${model}: ${message}`);
        logger.warn('ai_model_attempt_failed', { operation, model, attempt: index + 1, error: message });
      }
    }

    throw new Error(`All AI models failed for ${operation}. Attempts: ${errors.join(' | ')}`);
  }

  /** Build the chat request body for the detected API format */
  private buildChatBody(
    model: string,
    messages: Array<{ role: string; content: string }>,
    opts: { temperature?: number; json?: boolean },
  ): string {
    if (this.openaiCompat) {
      return JSON.stringify({
        model,
        messages,
        temperature: opts.temperature ?? 0.7,
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
      });
    }
    // Ollama native format
    return JSON.stringify({
      model,
      messages,
      stream: false,
      ...(opts.json ? { format: 'json' } : {}),
      options: { temperature: opts.temperature ?? 0.7 },
    });
  }

  /** Extract the assistant message content from either API format */
  private extractContent(json: unknown): string {
    if (this.openaiCompat) {
      const parsed = openaiChatResponseSchema.safeParse(json);
      if (!parsed.success || !parsed.data.choices.length) {
        throw new Error('Invalid OpenAI-compatible chat response');
      }
      return parsed.data.choices[0]!.message.content;
    }
    const parsed = ollamaChatResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error('Invalid Ollama chat response');
    }
    return parsed.data.message.content;
  }

  /** Send a chat completion request */
  private async chatRequest(
    model: string,
    messages: Array<{ role: string; content: string }>,
    opts: { temperature?: number; json?: boolean } = {},
  ): Promise<string> {
    const chatPath = this.openaiCompat ? '/chat/completions' : '/chat';
    const res = await fetch(`${this.baseUrl}${chatPath}`, {
      method: 'POST',
      headers: buildHeaders(this.apiKey),
      signal: AbortSignal.timeout(this.timeout),
      body: this.buildChatBody(model, messages, opts),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`AI generate failed: HTTP ${res.status} ${body.slice(0, 200)}`);
    }

    return this.extractContent(await res.json());
  }

  async listModels(): Promise<z.infer<typeof ollamaTagsResponseSchema>['models']> {
    const modelsPath = this.openaiCompat ? '/models' : '/tags';
    const res = await fetch(`${this.baseUrl}${modelsPath}`, {
      method: 'GET',
      headers: buildHeaders(this.apiKey),
    });

    if (!res.ok) {
      throw new Error(`List models failed: HTTP ${res.status}`);
    }

    const json = await res.json();

    if (this.openaiCompat) {
      const parsed = openaiModelsResponseSchema.safeParse(json);
      if (!parsed.success) {
        throw new Error('Invalid OpenAI-compatible models response');
      }
      return parsed.data.data.map((m) => ({ name: m.id }));
    }

    const parsed = ollamaTagsResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error('Invalid Ollama list models response');
    }
    return parsed.data.models;
  }

  async generateResearchBriefs(
    model: string,
    manualItems: Array<{ title: string; text: string }>,
  ): Promise<z.infer<typeof aiBriefSchema>[]> {
    return this.withModelFallback(model, 'research_briefs', async (activeModel) => {
      const system = 'You are a financial intelligence analyst. Return strict JSON array only.';

      const prompt = [
        'Create concise institutional-quality briefs from the following input.',
        'Return JSON array with items: headline, summaryBullets, whyItMatters, whatToWatch, tickers, confidence.',
        'confidence must be between 0 and 1.',
        JSON.stringify(manualItems),
      ].join('\n\n');

      const raw = await this.chatRequest(
        activeModel,
        [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.1, json: true },
      );

      let content: unknown;
      try {
        content = JSON.parse(extractJson(raw));
      } catch {
        throw new Error('AI response was not valid JSON');
      }

      // Some models wrap the array in an object like { briefs: [...] }
      if (content && typeof content === 'object' && !Array.isArray(content)) {
        const vals = Object.values(content as Record<string, unknown>);
        const arr = vals.find(Array.isArray);
        if (arr) content = arr;
      }

      const briefsParsed = z.array(aiBriefSchema).safeParse(content);
      if (!briefsParsed.success) {
        throw new Error('AI response did not match expected brief schema');
      }

      return briefsParsed.data;
    });
  }

  async analyzeCongressTrade(
    model: string,
    tradeData: {
      member: string;
      ticker: string;
      side: string;
      amount: string;
      date: string;
    },
  ): Promise<z.infer<typeof congressAnalysisSchema>> {
    return this.withModelFallback(model, 'congress_trade_analysis', async (activeModel) => {
      const system =
        'You are a financial analyst specializing in congressional trading analysis. Return strict JSON only.';

      const prompt = [
        'Analyze the following congressional trade and provide:',
        '- category: one of ["tech", "healthcare", "finance", "energy", "defense", "retail", "industrial", "other"]',
        '- sentiment: one of ["bullish", "bearish", "neutral"]',
        '- sentimentScore: number between -1 (very bearish) and 1 (very bullish)',
        '- reasoning: brief explanation (max 200 chars)',
        '- confidence: number between 0 and 1',
        JSON.stringify(tradeData),
      ].join('\n\n');

      const raw = await this.chatRequest(
        activeModel,
        [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.1, json: true },
      );

      let content: unknown;
      try {
        content = JSON.parse(extractJson(raw));
      } catch {
        throw new Error('AI response was not valid JSON');
      }

      const analysisParsed = congressAnalysisSchema.safeParse(content);
      if (!analysisParsed.success) {
        logger.warn('congress_analysis_schema_mismatch', {
          errors: analysisParsed.error.flatten(),
        });
        throw new Error('AI response did not match expected analysis schema');
      }

      return analysisParsed.data;
    });
  }

  async generateSupplyChainInsights(
    model: string,
    ticker: string,
    context: { globalTickers?: string[]; includeHypothesis?: boolean },
  ): Promise<z.infer<typeof supplyChainInsightSchema>> {
    return this.withModelFallback(model, 'supply_chain_insights', async (activeModel) => {
      const system =
        'You are a supply chain analyst. Analyze company relationships and return strict JSON only.';

      const prompt = [
        `Analyze the supply chain relationships for ${ticker}.`,
        context.globalTickers?.length
          ? `Consider these related companies: ${context.globalTickers.join(', ')}`
          : '',
        context.includeHypothesis
          ? 'Include hypothetical relationships where data is limited.'
          : 'Only include confirmed relationships.',
        'Return JSON with:',
        '- relationships: array of {source, target, type, confidence}',
        '- insights: array of key observations (max 5)',
      ]
        .filter(Boolean)
        .join('\n\n');

      const raw = await this.chatRequest(
        activeModel,
        [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.2, json: true },
      );

      let content: unknown;
      try {
        content = JSON.parse(extractJson(raw));
      } catch {
        throw new Error('AI response was not valid JSON');
      }

      const insightParsed = supplyChainInsightSchema.safeParse(content);
      if (!insightParsed.success) {
        logger.warn('supply_chain_schema_mismatch', { errors: insightParsed.error.flatten() });
        throw new Error('AI response did not match expected supply chain schema');
      }

      return insightParsed.data;
    });
  }

  async generateText(
    model: string,
    system: string,
    prompt: string,
    options?: { temperature?: number; format?: 'json' },
  ): Promise<string> {
    return this.withModelFallback(model, 'generate_text', async (activeModel) => {
      const raw = await this.chatRequest(
        activeModel,
        [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        {
          ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
          json: options?.format === 'json',
        },
      );
      return raw.trim();
    });
  }

  async checkHealth(): Promise<{ available: boolean; message?: string; version?: string }> {
    try {
      const healthPath = this.openaiCompat ? '/models' : '/tags';
      const res = await fetch(`${this.baseUrl}${healthPath}`, {
        method: 'GET',
        headers: buildHeaders(this.apiKey),
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) {
        return {
          available: false,
          message: `HTTP ${res.status} - AI endpoint may be unavailable`,
        };
      }

      return { available: true, version: this.openaiCompat ? 'openai-compat' : 'ollama' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { available: false, message: `Connection error: ${msg}` };
    }
  }
}

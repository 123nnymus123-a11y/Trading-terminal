import { randomUUID } from "node:crypto";
import { createLogger } from "@tc/shared";
import type {
  CalendarInsightRequest,
  CalendarInsightResponse,
} from "@tc/shared";
import { AppSettingsRepo } from "../../persistence/repos";

const logger = createLogger({ scope: "EconomicCalendarInsights" });

// Cloud LLM is now used; no local Ollama URL needed

export type EnginePreference = "cloud-first" | "cloud-only" | "local-only";

interface InsightOptions {
  preference?: EnginePreference;
  cloudEndpoint?: string;
  localModel?: string;
}

export async function generateEconomicCalendarInsights(
  request: CalendarInsightRequest,
  options: InsightOptions = {}
): Promise<CalendarInsightResponse> {
  const preference: EnginePreference = options.preference ?? "cloud-first";
  const cloudEndpoint = options.cloudEndpoint ?? process.env.CALENDAR_CLOUD_AI_URL ?? process.env.TC_CLOUD_AI_ENDPOINT;
  const derivedModel =
    getGlobalAiModel() ??
    options.localModel ??
    process.env.CALENDAR_LOCAL_MODEL ??
    "deepseek-r1:14b";

  const requestWithModel =
    request.model === derivedModel || !derivedModel ? request : { ...request, model: derivedModel };

  if (preference !== "local-only") {
    const cloud = await tryCloudEndpoint(cloudEndpoint, requestWithModel);
    if (cloud) {
      return cloud;
    }
  }

  if (preference !== "cloud-only") {
    const local = await tryLocalModel(requestWithModel);
    if (local) {
      return local;
    }
  }

  return buildHeuristicResponse(requestWithModel, "heuristic");
}

async function tryCloudEndpoint(
  endpoint: string | undefined,
  request: CalendarInsightRequest
): Promise<CalendarInsightResponse | null> {
  if (!endpoint) {
    return null;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!res.ok) {
        logger.warn(`[CalendarAI] Cloud endpoint returned ${res.status}`);
        return null;
      }

      const json = (await res.json()) as Partial<CalendarInsightResponse>;
      return normalizeResponse(json, "cloud");
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    logger.warn(`[CalendarAI] Cloud insight call failed: ${err}`);
    return null;
  }
}

async function tryLocalModel(
  request: CalendarInsightRequest
): Promise<CalendarInsightResponse | null> {
  try {
    const { callCloudLlm } = await import('../llm/cloudLlmClient');
    const prompt = buildLocalPrompt(request);
    const systemPrompt = "You are a financial analyst. Return a JSON object with insight fields.";
    const text = await callCloudLlm(systemPrompt, prompt, { temperature: 0 });
    const jsonText = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(jsonText) as Partial<CalendarInsightResponse>;
    return normalizeResponse(parsed, "local");
  } catch (err) {
    logger.warn(`[CalendarAI] Cloud AI request failed: ${err}`);
    return null;
  }
}

function normalizeResponse(
  partial: Partial<CalendarInsightResponse>,
  engine: CalendarInsightResponse["aiEngine"]
): CalendarInsightResponse {
  const focusEvents = Array.isArray(partial.focusEvents)
    ? partial.focusEvents.map((event) => ({
        id: event.id ?? randomUUID(),
        title: event.title ?? "Unnamed Event",
        eta: event.eta ?? new Date().toISOString(),
        status: event.status ?? "upcoming",
        importance: event.importance ?? 1,
        aiView: event.aiView ?? "Monitoring",
      }))
    : [];

  const riskSignals = Array.isArray(partial.riskSignals)
    ? partial.riskSignals.map((risk) => ({
        label: risk.label ?? "Risk",
        detail: risk.detail ?? "",
        severity: risk.severity ?? "medium",
      }))
    : [];

  return {
    aiEngine: engine,
    generatedAt: partial.generatedAt ?? new Date().toISOString(),
    headline: partial.headline ?? "Macro pulse ready",
    synopsis:
      partial.synopsis ??
      "Economic calendar intelligence generated without a verified AI engine. Using heuristic synthesis until cloud/local AI respond.",
    bullets: partial.bullets && partial.bullets.length > 0 ? partial.bullets : ["Awaiting richer AI context"],
    riskSignals,
    focusEvents,
  };
}

function buildHeuristicResponse(
  request: CalendarInsightRequest,
  engine: CalendarInsightResponse["aiEngine"]
): CalendarInsightResponse {
  const sorted = [...request.events].sort((a, b) => a.releaseDateTime.localeCompare(b.releaseDateTime));
  const headlineTarget = sorted.find((event) => event.importance === 3) ?? sorted[0];
  const headline = headlineTarget
    ? `${headlineTarget.title} anchors ${headlineTarget.country}'s macro focus`
    : "Economic calendar focus";

  const synopsis = `${request.focus === "upcoming" ? "Watching" : "Reviewing"} ${sorted.length} events over the next ${request.windowHours}h window.`;

  const bullets = sorted.slice(0, 4).map((event) => {
    const importance = event.importance === 3 ? "High" : event.importance === 2 ? "Medium" : "Low";
    const summary = event.summary ? ` — ${event.summary}` : "";
    return `${importance}-impact ${event.country} • ${event.title}${summary}`;
  });

  const riskSignals = sorted.slice(0, 3).map((event) => ({
    label: `${event.country} ${event.title}`,
    detail: event.summary ?? "Volatility watch",
    severity: (event.importance === 3 ? "high" : event.importance === 2 ? "medium" : "low") as
      | "high"
      | "medium"
      | "low",
  }));

  const focusEvents = sorted.slice(0, 5).map((event) => ({
    id: event.id,
    title: event.title,
    eta: event.releaseDateTime,
    status: event.status,
    importance: event.importance,
    aiView: event.summary ?? "Standing by",
  }));

  return {
    aiEngine: engine,
    generatedAt: new Date().toISOString(),
    headline,
    synopsis,
    bullets,
    riskSignals,
    focusEvents,
  };
}

function buildLocalPrompt(request: CalendarInsightRequest): string {
  const scope = request.focus === "upcoming" ? "upcoming releases" : "recent releases";
  const eventLines = request.events
    .map((event) => {
      const confidence = typeof event.confidenceScore === "number" ? `${Math.round(event.confidenceScore * 100)}% confidence` : "confidence unknown";
      return `- ${event.title} (${event.country}) • importance ${event.importance} • status ${event.status} • ${confidence} • summary: ${event.summary ?? "n/a"}`;
    })
    .join("\n");

  return `You are an AI macro analyst. Review the ${scope} covering the next ${request.windowHours} hours and return JSON with the shape:
{
  "headline": string,
  "synopsis": string,
  "bullets": string[3..5],
  "riskSignals": [{"label": string, "detail": string, "severity": "low"|"medium"|"high"}],
  "focusEvents": [{"id": string, "title": string, "eta": iso8601, "status": string, "importance": number, "aiView": string}]
}
Textual data:
${eventLines}`;
}

function getGlobalAiModel(): string | undefined {
  try {
    const settings = AppSettingsRepo.get() as { globalAiModel?: unknown };
    const model = settings?.globalAiModel;
    if (typeof model === "string" && model.trim().length > 0) {
      return model.trim();
    }
  } catch (err) {
    logger.warn(`[CalendarAI] Failed to read global AI model: ${err}`);
  }
  return undefined;
}

import type { AppEnv } from '../../config.js';
import { createLogger } from '../../logger.js';
import { randomUUID } from 'node:crypto';

const logger = createLogger('economic-insights-service');

type CalendarInsightRequestEvent = {
  id: string;
  title: string;
  releaseDateTime: string;
  status: 'upcoming' | 'released' | 'revised';
  importance: 1 | 2 | 3;
  eventCategory: 'inflation' | 'employment' | 'growth' | 'trade' | 'housing' | 'confidence' | 'other';
  country: string;
  confidenceScore?: number;
  summary?: string;
};

export type CalendarInsightRequest = {
  focus: 'upcoming' | 'released';
  windowHours: number;
  events: CalendarInsightRequestEvent[];
  model?: string;
};

export type CalendarInsightResponse = {
  aiEngine: 'cloud' | 'heuristic';
  generatedAt: string;
  headline: string;
  synopsis: string;
  bullets: string[];
  riskSignals: Array<{ label: string; detail: string; severity: 'low' | 'medium' | 'high' }>;
  focusEvents: Array<{
    id: string;
    title: string;
    eta: string;
    status: 'upcoming' | 'released' | 'revised';
    importance: 1 | 2 | 3;
    aiView: string;
  }>;
};

export type EconomicInsightsService = {
  generateInsights: (
    request: CalendarInsightRequest,
    tenantId?: string,
  ) => Promise<CalendarInsightResponse>;
};

export function createEconomicInsightsService(env: AppEnv): EconomicInsightsService {
  const cloudEndpoint = process.env.CALENDAR_CLOUD_AI_URL ?? process.env.TC_CLOUD_AI_ENDPOINT;

  return {
    async generateInsights(request, tenantId) {
      if (cloudEndpoint) {
        const cloud = await tryCloudEndpoint(cloudEndpoint, request);
        if (cloud) {
          return cloud;
        }
      }

      logger.warn('economic_insights_cloud_unavailable_fallback_heuristic', {
        tenantId: tenantId ?? 'default',
        eventCount: request.events.length,
        model: request.model ?? env.OLLAMA_DEFAULT_MODEL,
      });
      return buildHeuristicResponse(request);
    },
  };
}

async function tryCloudEndpoint(
  endpoint: string,
  request: CalendarInsightRequest,
): Promise<CalendarInsightResponse | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!res.ok) {
        return null;
      }

      const json = (await res.json()) as Partial<CalendarInsightResponse>;
      return normalizeResponse(json, 'cloud');
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
  }
}

function normalizeResponse(
  partial: Partial<CalendarInsightResponse>,
  engine: CalendarInsightResponse['aiEngine'],
): CalendarInsightResponse {
  const focusEvents = Array.isArray(partial.focusEvents)
    ? partial.focusEvents.map((event) => ({
        id: event.id ?? randomUUID(),
        title: event.title ?? 'Unnamed Event',
        eta: event.eta ?? new Date().toISOString(),
        status: event.status ?? 'upcoming',
        importance: event.importance ?? 1,
        aiView: event.aiView ?? 'Monitoring',
      }))
    : [];

  const riskSignals = Array.isArray(partial.riskSignals)
    ? partial.riskSignals.map((risk) => ({
        label: risk.label ?? 'Risk',
        detail: risk.detail ?? '',
        severity: risk.severity ?? 'medium',
      }))
    : [];

  return {
    aiEngine: engine,
    generatedAt: partial.generatedAt ?? new Date().toISOString(),
    headline: partial.headline ?? 'Macro pulse ready',
    synopsis:
      partial.synopsis ??
      'Economic calendar intelligence generated with fallback heuristics until cloud AI responds.',
    bullets:
      partial.bullets && partial.bullets.length > 0
        ? partial.bullets
        : ['Awaiting richer AI context'],
    riskSignals,
    focusEvents,
  };
}

function buildHeuristicResponse(request: CalendarInsightRequest): CalendarInsightResponse {
  const sorted = [...request.events].sort((a, b) => a.releaseDateTime.localeCompare(b.releaseDateTime));
  const headlineTarget = sorted.find((event) => event.importance === 3) ?? sorted[0];
  const headline = headlineTarget
    ? `${headlineTarget.title} anchors ${headlineTarget.country}'s macro focus`
    : 'Economic calendar focus';

  const synopsis = `${request.focus === 'upcoming' ? 'Watching' : 'Reviewing'} ${sorted.length} events over the next ${request.windowHours}h window.`;

  const bullets = sorted.slice(0, 4).map((event) => {
    const importance = event.importance === 3 ? 'High' : event.importance === 2 ? 'Medium' : 'Low';
    const summary = event.summary ? ` - ${event.summary}` : '';
    return `${importance}-impact ${event.country} - ${event.title}${summary}`;
  });

  const riskSignals = sorted.slice(0, 3).map((event) => {
    const severity: 'low' | 'medium' | 'high' =
      event.importance === 3 ? 'high' : event.importance === 2 ? 'medium' : 'low';
    return {
      label: `${event.country} ${event.title}`,
      detail: event.summary ?? 'Volatility watch',
      severity,
    };
  });

  const focusEvents = sorted.slice(0, 5).map((event) => ({
    id: event.id,
    title: event.title,
    eta: event.releaseDateTime,
    status: event.status,
    importance: event.importance,
    aiView: event.summary ?? 'Standing by',
  }));

  return {
    aiEngine: 'heuristic',
    generatedAt: new Date().toISOString(),
    headline,
    synopsis,
    bullets,
    riskSignals,
    focusEvents,
  };
}

/**
 * Supply Chain Mind-Map Generator using Ollama/Llama
 */

import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import type {
  MindMapData,
  SupplyChainAdvisorRequest,
  SupplyChainAdvisorResponse,
} from "@tc/shared/supplyChain";
import { ensureCanonicalStructures } from "@tc/shared/supplyChainGraph";
import { searchWeb, formatSearchResults } from "../webSearch";
import {
  validateClaimsBatch,
  formatValidationForAdvisor,
  getCachedValidation,
  setCachedValidation,
  fetchEarningsData,
  fetchSupplyChainNews,
  detectSupplyChainRisks,
  getValidationTrend,
  recordValidationHistory,
} from "./dataValidator";
import { enrichMindMap } from "./mindMapEnricher";
import { resolveCompanyGeo } from "./companyGeo";

const OllamaResponseSchema = z.object({
  response: z.string(),
});

const AdvisorReplySchema = z.object({
  answer: z.string(),
  sources: z.array(z.string()).optional(),
  followups: z.array(z.string()).optional(),
  confidence: z.number().optional(),
});

// Lazy-loaded ticker map
let tickerMap: Record<string, string> | null = null;

function getTickerMap(): Record<string, string> {
  if (tickerMap) return tickerMap;

  try {
    const candidatePaths = [
      path.join(__dirname, "data", "ticker_map.json"),
      path.join(
        process.cwd(),
        "apps",
        "desktop",
        "src",
        "main",
        "services",
        "supplyChain",
        "data",
        "ticker_map.json",
      ),
      path.join(
        process.cwd(),
        "src",
        "main",
        "services",
        "supplyChain",
        "data",
        "ticker_map.json",
      ),
    ];

    for (const mapPath of candidatePaths) {
      if (!fs.existsSync(mapPath)) continue;
      const raw = fs.readFileSync(mapPath, "utf-8");
      tickerMap = JSON.parse(raw) as Record<string, string>;
      return tickerMap;
    }

    console.warn("[SupplyChain] ticker_map.json not found in known paths", {
      tried: candidatePaths,
    });
    return {};
  } catch (err) {
    console.warn("[SupplyChain] Could not load ticker_map.json:", err);
    return {};
  }
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Generate a supply chain mind-map for a given company using Llama AI
 * @param model - Ollama model name (e.g., "llama3.1:8b")
 * @param ticker - Company ticker symbol
 * @param companyName - Full company name (optional, for better context)
 */
export async function generateSupplyChainWithOllama(
  model: string,
  ticker: string,
  companyName?: string,
): Promise<MindMapData> {
  // Lookup company name from ticker map if not provided
  const map = getTickerMap();
  const resolvedName = companyName || map[ticker.toUpperCase()] || ticker;
  const displayName = resolvedName;

  const systemPrompt = `You are a supply chain and business relationship expert. You analyze companies and their ecosystem of partners, suppliers, manufacturers, and service providers.

CRITICAL INSTRUCTIONS:
1. You MUST respond with valid JSON only, no additional text or explanations.
2. The company you are analyzing is EXACTLY "${displayName}" with ticker symbol "${ticker}". Do NOT confuse it with any other company.
3. Focus ONLY on this specific company's relationships, not similar companies or competitors.

Your response must follow this exact JSON structure:
{
  "centerTicker": "${ticker}",
  "centerName": "${displayName}",
  "generatedAt": "ISO timestamp",
  "categories": [
    {
      "id": "suppliers",
      "name": "Suppliers & Components",
      "icon": "🔵",
      "color": "#3b82f6",
      "companies": [
        {
          "id": "TICKER",
          "name": "Company Name",
          "role": "Brief description of what they provide",
          "criticality": 5,
          "since": 2020,
          "revenueImpact": 1000000000,
          "confidence": 0.85,
          "verified": false,
          "source": "AI estimate based on public knowledge",
          "metadata": {
            "hqCity": "City",
            "hqState": "State/Province",
            "hqCountry": "Country",
            "hqRegion": "Americas|Europe|APAC|MEA|Other",
            "industry": "Industry/sector",
            "foundedYear": 1970,
            "subsidiaries": ["Subsidiary A", "Subsidiary B"]
          }
        }
      ]
    }
  ],
  "insights": ["Key insight 1", "Key insight 2"]
}

CONFIDENCE SCORING GUIDELINES:
- confidence: 0.9-1.0 = Known fact from public sources (10-K, press releases)
- confidence: 0.7-0.9 = Strong indication from news/analyst reports
- confidence: 0.5-0.7 = Industry knowledge, likely true
- confidence: 0.3-0.5 = Educated guess based on patterns
- confidence: 0.0-0.3 = Speculative/uncertain

Set verified=false for AI estimates, only true if you know this from concrete filings.

Categories to include:
1. suppliers - Component and raw material suppliers (blue, #3b82f6)
2. manufacturers - Manufacturing and assembly partners (green, #22c55e)
3. services - Cloud, security, logistics partners (yellow, #eab308)
4. technology - Software, patents, R&D partners (purple, #a855f7)
5. distribution - Retailers, carriers, sales channels (red, #ef4444)

Criticality scale: 1 (minor) to 5 (critical/irreplaceable).`;

  const userPrompt = `Generate a comprehensive supply chain mind-map for ${displayName} (ticker: ${ticker}).

IMPORTANT: This is specifically about ${displayName}, not any other company. Ensure all relationships are accurate for THIS EXACT company.
When listing headquarters metadata, use the PRIMARY corporate headquarters only (not regional offices or manufacturing sites). If unsure, omit.

Include:
- Major suppliers (chips, components, materials)
- Manufacturing partners (assembly, production)
- Service providers (cloud, security, logistics)
- Technology partners (software, patents)
- Distribution channels (retailers, carriers)

Coverage target:
- Aim for 6-10 companies per category with major global partners and suppliers.

For each company relationship, provide:
- Ticker symbol (if publicly traded)
- Full company name
- Clear description of their role
- Criticality rating (1-5)
- Approximate start year if known
- Estimated annual revenue impact if significant
- Headquarters city/state/country when known (metadata.hqCity / metadata.hqState / metadata.hqCountry)
- Industry/sector if known (metadata.industry)
- Up to 3 major subsidiaries if known (metadata.subsidiaries)

Also provide 3-5 key insights about the supply chain health, dependencies, or strategic relationships.

Remember: Output ONLY valid JSON, no markdown, no explanations. If you are unsure of HQ details or subsidiaries, omit those fields rather than guessing.`;

  const { callCloudLlm } = await import("../llm/cloudLlmClient");
  void model; // model param retained for API compatibility
  const rawText = await callCloudLlm(systemPrompt, userPrompt, {
    temperature: 0.3,
  });
  const jsonText = rawText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  let mindMapData: MindMapData;
  try {
    mindMapData = JSON.parse(jsonText) as MindMapData;
  } catch (err) {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = rawText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch && jsonMatch[1]) {
      try {
        mindMapData = JSON.parse(jsonMatch[1].trim()) as MindMapData;
      } catch (innerErr) {
        // If markdown extraction fails, try to find JSON object directly
        const jsonStart = rawText.indexOf("{");
        const jsonEnd = rawText.lastIndexOf("}");
        if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
          try {
            mindMapData = JSON.parse(
              rawText.substring(jsonStart, jsonEnd + 1),
            ) as MindMapData;
          } catch (extractErr) {
            throw new Error(
              `Failed to parse Llama response as JSON (from markdown): ${innerErr}`,
            );
          }
        } else {
          throw new Error(
            `Failed to parse Llama response as JSON (from markdown): ${innerErr}`,
          );
        }
      }
    } else {
      // Try to find JSON object in the response
      const jsonStart = rawText.indexOf("{");
      const jsonEnd = rawText.lastIndexOf("}");
      if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
        try {
          mindMapData = JSON.parse(
            rawText.substring(jsonStart, jsonEnd + 1),
          ) as MindMapData;
        } catch (innerErr) {
          throw new Error(
            `Failed to parse Llama response as JSON (extracted): ${innerErr}`,
          );
        }
      } else {
        throw new Error(
          `Failed to parse Llama response as JSON (no JSON found): ${err}`,
        );
      }
    }
  }

  // Validate and sanitize the generated data
  mindMapData = validateAndSanitizeMindMap(mindMapData);

  // Enrich with real-time supply chain data
  console.log(
    `[supplyChain] Enriching mind-map with live supply chain data...`,
  );
  try {
    mindMapData = await enrichMindMap(mindMapData);
  } catch (err) {
    console.warn(
      `[supplyChain] Mind-map enrichment failed (non-blocking):`,
      err,
    );
  }

  // Add geographical coordinates to all companies
  console.log(`[supplyChain] Geocoding companies for world map...`);
  try {
    mindMapData = await geocodeMindMapCompanies(mindMapData);
  } catch (err) {
    console.warn(`[supplyChain] Geocoding failed (non-blocking):`, err);
  }

  mindMapData = ensureCanonicalStructures(mindMapData);

  return mindMapData;
}

/**
 * Geocode all companies in a mind-map to add geographical coordinates
 * Enables world map visualization with company locations
 */
async function geocodeMindMapCompanies(
  data: MindMapData,
): Promise<MindMapData> {
  const geoCache = new Map<
    string,
    { lat: number; lon: number; city?: string; country?: string }
  >();
  let geocodedCount = 0;
  let errorCount = 0;
  const startedAt = Date.now();
  const maxGeocodeDurationMs = 20000;
  const maxCompaniesToAttempt = 20;
  let attempted = 0;

  // Process each company and add coordinates
  geocodeLoop: for (const category of data.categories) {
    for (const company of category.companies) {
      if (
        Date.now() - startedAt > maxGeocodeDurationMs ||
        attempted >= maxCompaniesToAttempt
      ) {
        break geocodeLoop;
      }

      try {
        // Initialize metadata if missing
        if (!company.metadata) {
          company.metadata = {};
        }

        // Skip if already has coordinates
        if (company.metadata.hqLat && company.metadata.hqLon) {
          geocodedCount++;
          continue;
        }

        // Check cache first
        const cacheKey = (company.name || company.id).toLowerCase();
        let geo = geoCache.get(cacheKey);

        if (!geo) {
          attempted++;
          // Fetch from Nominatim
          const geoHints: Record<string, string> = {};
          if (company.metadata?.hqCity)
            geoHints.city = company.metadata.hqCity as string;
          if (company.metadata?.hqState)
            geoHints.state = company.metadata.hqState as string;
          if (company.metadata?.hqCountry)
            geoHints.country = company.metadata.hqCountry as string;

          const geoResult = await resolveCompanyGeo(
            company.name || company.id,
            geoHints as any,
          );
          geo = geoResult || undefined;
          if (geo) {
            geoCache.set(cacheKey, geo);
          }
        }

        if (geo) {
          company.metadata.hqLat = geo.lat;
          company.metadata.hqLon = geo.lon;
          const geoExtended = geo as {
            city?: string;
            state?: string;
            country?: string;
            source?: string;
          };
          if (geo.city) company.metadata.hqCity = geo.city;
          if (geoExtended.state) company.metadata.hqState = geoExtended.state;
          if (geo.country) company.metadata.hqCountry = geo.country;
          company.metadata.hqSource = geoExtended.source ?? "geocoder";
          geocodedCount++;

          // Throttle API calls to avoid rate limiting
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      } catch (err) {
        errorCount++;
        console.warn(`[supplyChain] Failed to geocode ${company.name}:`, err);
      }
    }
  }

  console.log(
    `[supplyChain] Geocoded ${geocodedCount} companies (${errorCount} errors, attempted ${attempted}, ${Date.now() - startedAt}ms)`,
  );
  return data;
}

/**
 * Validate and sanitize mind-map data from Llama
 * Ensures data quality and catches common errors
 */
function validateAndSanitizeMindMap(data: MindMapData): MindMapData {
  // Basic structure check
  if (
    !data.centerTicker ||
    !data.categories ||
    !Array.isArray(data.categories)
  ) {
    throw new Error("Invalid mind-map structure: missing required fields");
  }

  let totalCompanies = 0;
  let lowConfidenceCount = 0;
  const issuesDetected: string[] = [];

  // Validate and fix each category
  data.categories = data.categories.filter((cat) => {
    if (!cat.id || !cat.name || !Array.isArray(cat.companies)) {
      issuesDetected.push(`Skipped invalid category: ${cat.name || "unknown"}`);
      return false;
    }

    // Validate and fix companies in this category
    cat.companies = cat.companies.filter((company) => {
      totalCompanies++;

      // Required fields validation
      if (!company.name || !company.role) {
        issuesDetected.push(
          `Skipped company with missing name/role in ${cat.name}`,
        );
        return false;
      }

      // Criticality must be 1-5
      if (
        !company.criticality ||
        company.criticality < 1 ||
        company.criticality > 5
      ) {
        company.criticality = 3; // Default to medium
        issuesDetected.push(`Fixed invalid criticality for ${company.name}`);
      }

      // Confidence must be 0.0-1.0
      if (typeof company.confidence !== "number") {
        company.confidence = 0.5; // Default to medium confidence
        company.verified = false;
        issuesDetected.push(`Added missing confidence for ${company.name}`);
      } else {
        company.confidence = Math.max(0, Math.min(1, company.confidence));
      }

      // Track low confidence
      if (company.confidence < 0.6) {
        lowConfidenceCount++;
      }

      // Ensure verified flag exists
      if (typeof company.verified !== "boolean") {
        company.verified = false;
      }

      // Add default source if missing
      if (!company.source) {
        company.source = company.verified ? "Verified source" : "AI estimate";
      }

      // Validate ticker format if present
      if (company.id && !/^[A-Z.]{1,6}$/.test(company.id)) {
        issuesDetected.push(
          `Questionable ticker format: ${company.id} for ${company.name}`,
        );
      }

      return true;
    });

    // Keep category only if it has companies
    return cat.companies.length > 0;
  });

  // Ensure we have at least some data
  if (data.categories.length === 0) {
    throw new Error("No valid categories after validation");
  }

  if (totalCompanies < 3) {
    issuesDetected.push("Warning: Very few relationships found (< 3)");
  }

  // Add validation metadata as an insight
  if (issuesDetected.length > 0) {
    if (!data.insights) data.insights = [];
    data.insights.push(
      `⚠️ Data Quality: ${lowConfidenceCount}/${totalCompanies} relationships have low confidence (<0.6). ` +
        `${issuesDetected.length} issues auto-corrected.`,
    );
  }

  console.log(
    `[SupplyChain] Validated ${totalCompanies} companies across ${data.categories.length} categories`,
  );
  if (issuesDetected.length > 0) {
    console.warn(`[SupplyChain] Validation issues:`, issuesDetected);
  }

  return data;
}

/**
 * Check if Ollama is available
 */
export async function checkOllamaAvailable(): Promise<boolean> {
  try {
    const { checkCloudLlmAvailable } = await import("../llm/cloudLlmClient");
    const result = await checkCloudLlmAvailable();
    return result.ok;
  } catch {
    return false;
  }
}

/**
 * Lightweight advisor endpoint that searches the internet and answers questions about supply chain
 * with real sources and citations.
 */
export async function askSupplyChainAdvisor(
  model: string,
  payload: SupplyChainAdvisorRequest,
): Promise<SupplyChainAdvisorResponse> {
  if (!payload.question?.trim()) {
    return { success: false, error: "Question is empty" };
  }

  const question = payload.question.trim();

  // Build search query from the question + company context
  const company = payload.mindMapData?.centerName || "supply chain";
  const searchQuery = `${question} ${company}`.substring(0, 200);

  console.log(`[advisor] Searching web for: ${searchQuery}`);
  const searchResults = await searchWeb(searchQuery, 5);
  const searchContextBlock = formatSearchResults(searchResults);

  const mindMapContextBlock = payload.mindMapData
    ? `### Mind-Map Context ###\n${JSON.stringify(payload.mindMapData, null, 2)}`
    : "";

  const cockpitContextBlock = payload.cockpitContext
    ? `### Current Trading Terminal State ###\n${JSON.stringify(payload.cockpitContext, null, 2)}`
    : "";

  const systemPrompt = `You are a thorough supply chain and trading research advisor with internet access.
- Search results are provided below with real URLs and snippets.
- You may also have access to the user's current trading terminal state and supply chain mind-map data.
- ALWAYS cite sources by including the URL in square brackets: [Source](https://...)
- If you find the answer in search results, prioritize those over generic advice.
- When discussing trading or positions, incorporate the cockpit context if available.
- Keep answers under 200 words but be complete and actionable.
- Return compact JSON with:
  {
    "answer": "Your cited answer with [URL] references and cockpit insights",
    "sources": ["https://url1.com", "https://url2.com"],
    "followups": ["Follow-up question 1", "Follow-up question 2"]
  }`;

  const imageData = payload.imageBase64
    ? payload.imageBase64.split(",").pop()
    : undefined;

  const userPrompt = `User question: ${question}\n\n${searchContextBlock}\n${mindMapContextBlock}\n${cockpitContextBlock}\n\nScreenshot: ${payload.imageName ?? "none"}\nIf a screenshot was provided, extract and use any visible text.\n\nIMPORTANT: Provide real URLs from the search results in your answer. Cite sources properly. If cockpit context is available, incorporate it into trading/position-related advice.`;

  const body: Record<string, unknown> = {
    model,
    system: systemPrompt,
    prompt: userPrompt,
    stream: false,
    format: "json",
    options: {
      temperature: 0.15,
    },
  };

  if (imageData) {
    body.images = [imageData];
  }

  let text: string;
  try {
    const { callCloudLlm } = await import("../llm/cloudLlmClient");
    void model; // model param retained for API compatibility
    // Note: image payloads (multimodal) are dropped when using cloud text-only API
    const sysPrompt =
      typeof body.system === "string" ? body.system : systemPrompt;
    const usrPrompt =
      typeof body.prompt === "string" ? body.prompt : userPrompt;
    text = await callCloudLlm(sysPrompt, usrPrompt, { temperature: 0.15 });
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const jsonCandidate = extractJsonCandidate(text);
  let parsedAnswer: unknown = null;
  if (jsonCandidate) {
    try {
      parsedAnswer = JSON.parse(jsonCandidate);
    } catch {
      parsedAnswer = null;
    }
  }

  const normalized = normalizeAdvisorReply(parsedAnswer, text);
  const validated = AdvisorReplySchema.safeParse(normalized);
  if (!validated.success) {
    return { success: false, error: "Advisor reply missing required fields" };
  }

  // Extract claims from the answer and validate them against live data
  const claimsToValidate = extractClaimsFromText(validated.data.answer);
  let validationSuffix = "";
  let riskSuffix = "";
  let newsSuffix = "";
  let earningsSuffix = "";

  if (claimsToValidate.length > 0) {
    console.log(
      `[advisor] Validating ${claimsToValidate.length} claims against live data...`,
    );

    // Check cache first
    const cacheKey = `claims:${claimsToValidate.join("|")}`;
    const validationResults = getCachedValidation(cacheKey);

    if (!validationResults) {
      // Fetch and validate claims (limit to top 3 for performance)
      const validationBatch = await validateClaimsBatch(
        claimsToValidate.slice(0, 3).map((claim) => ({
          text: claim,
          confidence: 0.7, // Default confidence for extracted claims
        })),
      );

      // Cache the results and record history
      for (const result of validationBatch) {
        setCachedValidation(`claims:${result.claim}`, result);
        // Record for trend analysis
        const ticker = result.claim.match(/\b([A-Z]{1,5})\b/)?.[1] || "UNKNOWN";
        recordValidationHistory(
          result.claim,
          ticker,
          result.validationConfidence,
          "advisor",
        );
      }

      validationSuffix = formatValidationForAdvisor(validationBatch);
    } else {
      validationSuffix = formatValidationForAdvisor([validationResults]);
    }
  }

  // Fetch earnings data for context
  const companyTicker = extractPrimaryTicker(validated.data.answer);
  if (companyTicker) {
    try {
      const earnings = await fetchEarningsData(companyTicker);
      if (earnings && earnings.revenue > 0) {
        earningsSuffix = `\n\n💰 **Financial Context** (${earnings.source}):\nRevenue (TTM): $${(earnings.revenue / 1e9).toFixed(1)}B | EPS: ${earnings.eps.toFixed(2)}`;
      }
    } catch (err) {
      console.warn("[advisor] Earnings fetch error:", err);
    }

    // Fetch supply chain news
    try {
      const news = await fetchSupplyChainNews(companyTicker);
      if (news.length > 0) {
        const negativeNews = news.filter((n) => n.sentiment === "negative");
        if (negativeNews.length > 0) {
          newsSuffix =
            `\n\n📰 **Recent Supply Chain News** (Google News):\n` +
            negativeNews
              .slice(0, 2)
              .map((n) => `• ${n.title} (${n.sentiment})`)
              .join("\n");
        }
      }
    } catch (err) {
      console.warn("[advisor] News fetch error:", err);
    }

    // Detect supply chain risks
    try {
      const risks = await detectSupplyChainRisks(companyTicker);
      if (risks.length > 0) {
        riskSuffix =
          `\n\n⚠️ **Supply Chain Risks Detected**:\n` +
          risks
            .map((r) => `• [${r.severity.toUpperCase()}] ${r.risk}`)
            .join("\n");
      }
    } catch (err) {
      console.warn("[advisor] Risk detection error:", err);
    }

    // Check validation trends
    const trend = getValidationTrend(validated.data.answer, companyTicker);
    if (trend.trend !== "stable") {
      const trendIcon = trend.trend === "improving" ? "📈" : "📉";
      riskSuffix += `\n\n${trendIcon} **Confidence Trend**: ${trend.trend} (${(trend.confidenceChange * 100).toFixed(0)}%)`;
    }
  }

  const finalAnswer = (
    validated.data.answer +
    validationSuffix +
    earningsSuffix +
    newsSuffix +
    riskSuffix
  ).trim();

  const response: SupplyChainAdvisorResponse = {
    success: true,
    answer: finalAnswer,
    model,
  };

  if (validated.data.sources) {
    response.sources = validated.data.sources;
  }
  if (validated.data.followups) {
    response.followups = validated.data.followups;
  }

  return response;
}

function extractJsonCandidate(rawText: string): string | null {
  const trimmed = rawText.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) return fenced[1].trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return null;
}

function normalizeAdvisorReply(parsed: unknown, rawText: string) {
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    const answerCandidate =
      (typeof record.answer === "string" && record.answer.trim()) ||
      (typeof record.response === "string" && record.response.trim()) ||
      (typeof record.content === "string" && record.content.trim()) ||
      (typeof record.message === "string" && record.message.trim());

    if (answerCandidate) {
      return {
        answer: String(answerCandidate).trim(),
        sources: Array.isArray(record.sources)
          ? record.sources.filter((s) => typeof s === "string")
          : undefined,
        followups: Array.isArray(record.followups)
          ? record.followups.filter((f) => typeof f === "string")
          : undefined,
        confidence:
          typeof record.confidence === "number" ? record.confidence : undefined,
      };
    }
  }

  return {
    answer: rawText.trim(),
  };
}

/**
 * Extract the primary ticker from advisor answer
 */
function extractPrimaryTicker(text: string): string | null {
  const match = text.match(/\b([A-Z]{1,5})\b/);
  return match?.[1] ?? null;
}

/**
 * Extract key claims (ticker mentions) from advisor answer
 */
function extractClaimsFromText(text: string): string[] {
  const claims: string[] = [];

  // Find sentences with ticker symbols
  const sentences = text.split(/[.!?]\s+/);
  const tickerRegex = /\b([A-Z]{1,5})\b/;

  for (const sentence of sentences) {
    if (tickerRegex.test(sentence)) {
      const trimmed = sentence.trim();
      if (trimmed.length > 20 && trimmed.length < 200) {
        claims.push(trimmed);
      }
    }
  }

  return claims.slice(0, 5); // Limit to 5 claims to avoid rate limiting
}

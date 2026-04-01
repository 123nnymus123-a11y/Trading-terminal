/**
 * API Key Validation Service
 * Tests API credentials against provider endpoints
 */

import { getSecret } from "../secrets";

export type ApiProvider =
  | "alpaca"
  | "polygon"
  | "finnhub"
  | "quiver"
  | "interactive-brokers"
  | "coinbase"
  | "bls"
  | "fred"
  | "brave"
  | "other";

export interface ValidationResult {
  valid: boolean;
  message: string;
  details?: {
    accountId?: string;
    tier?: string;
    expiresAt?: string;
  };
}

/**
 * Test Alpaca API credentials
 */
async function testAlpacaConnection(keyId: string, secretKey: string, baseUrl: string): Promise<ValidationResult> {
  try {
    const response = await fetch(`${baseUrl}/v2/account`, {
      headers: {
        "APCA-API-KEY-ID": keyId,
        "APCA-API-SECRET-KEY": secretKey,
      },
    });

    if (response.ok) {
      const data = await response.json();
      return {
        valid: true,
        message: "✓ Alpaca connection successful",
        details: {
          accountId: data.account_number,
          tier: data.status,
        },
      };
    } else {
      const errorText = await response.text().catch(() => "Unknown error");
      return {
        valid: false,
        message: `✗ Alpaca authentication failed: ${response.status} ${response.statusText}`,
      };
    }
  } catch (error) {
    return {
      valid: false,
      message: `✗ Alpaca connection error: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Test Polygon API credentials
 */
async function testPolygonConnection(apiKey: string): Promise<ValidationResult> {
  try {
    const response = await fetch(`https://api.polygon.io/v2/aggs/ticker/AAPL/range/1/day/2024-01-01/2024-01-02?apiKey=${apiKey}`);

    if (response.ok) {
      return {
        valid: true,
        message: "✓ Polygon connection successful",
      };
    } else if (response.status === 403 || response.status === 401) {
      return {
        valid: false,
        message: "✗ Polygon API key invalid or unauthorized",
      };
    } else {
      return {
        valid: false,
        message: `✗ Polygon API error: ${response.status} ${response.statusText}`,
      };
    }
  } catch (error) {
    return {
      valid: false,
      message: `✗ Polygon connection error: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Test Finnhub API credentials
 */
async function testFinnhubConnection(apiKey: string): Promise<ValidationResult> {
  try {
    const response = await fetch(`https://finnhub.io/api/v1/quote?symbol=AAPL&token=${apiKey}`);

    if (response.ok) {
      const data = await response.json();
      if (data.c !== undefined) {
        return {
          valid: true,
          message: "✓ Finnhub connection successful",
        };
      }
    }

    if (response.status === 401 || response.status === 403) {
      return {
        valid: false,
        message: "✗ Finnhub API key invalid",
      };
    }

    return {
      valid: false,
      message: `✗ Finnhub API error: ${response.status}`,
    };
  } catch (error) {
    return {
      valid: false,
      message: `✗ Finnhub connection error: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Test Quiver API credentials
 */
async function testQuiverConnection(apiKey: string): Promise<ValidationResult> {
  try {
    const response = await fetch("https://api.quiverquant.com/beta/bulk/congresstrading", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (response.ok) {
      return {
        valid: true,
        message: "✓ Quiver connection successful",
      };
    } else if (response.status === 401 || response.status === 403) {
      return {
        valid: false,
        message: "✗ Quiver API key invalid",
      };
    }

    return {
      valid: false,
      message: `✗ Quiver API error: ${response.status}`,
    };
  } catch (error) {
    return {
      valid: false,
      message: `✗ Quiver connection error: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Test Coinbase API credentials
 */
async function testCoinbaseConnection(apiKey: string, apiSecret: string): Promise<ValidationResult> {
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const method = "GET";
    const path = "/api/v3/brokerage/accounts";
    
    // Create signature
    const message = `${timestamp}${method}${path}`;
    const crypto = await import("crypto");
    const signature = crypto.createHmac("sha256", apiSecret).update(message).digest("hex");

    const response = await fetch(`https://api.coinbase.com${path}`, {
      headers: {
        "CB-ACCESS-KEY": apiKey,
        "CB-ACCESS-SIGN": signature,
        "CB-ACCESS-TIMESTAMP": timestamp.toString(),
      },
    });

    if (response.ok) {
      return {
        valid: true,
        message: "✓ Coinbase connection successful",
      };
    } else {
      return {
        valid: false,
        message: `✗ Coinbase authentication failed: ${response.status}`,
      };
    }
  } catch (error) {
    return {
      valid: false,
      message: `✗ Coinbase connection error: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Test BLS API credentials
 */
async function testBlsConnection(apiKey: string): Promise<ValidationResult> {
  try {
    const response = await fetch("https://api.bls.gov/publicAPI/v2/timeseries/data/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        seriesid: ["JTS000000000000000JOL"],
        registrationkey: apiKey,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      const series = data?.Results?.series?.[0]?.data;
      if (data?.status === "REQUEST_SUCCEEDED" && Array.isArray(series) && series.length) {
        return {
          valid: true,
          message: "✓ BLS connection successful",
        };
      }
      return {
        valid: false,
        message: "✗ BLS response missing data",
      };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        valid: false,
        message: "✗ BLS API key invalid",
      };
    }

    return {
      valid: false,
      message: `✗ BLS API error: ${response.status}`,
    };
  } catch (error) {
    return {
      valid: false,
      message: `✗ BLS connection error: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Test FRED API credentials
 */
async function testFredConnection(apiKey: string): Promise<ValidationResult> {
  const endpoint =
    "https://api.stlouisfed.org/fred/series/observations?series_id=CPIAUCSL&file_type=json&api_key=" +
    encodeURIComponent(apiKey);

  try {
    const response = await fetch(endpoint);

    if (!response.ok) {
      return {
        valid: false,
        message: `✗ FRED API error: ${response.status} ${response.statusText}`,
      };
    }

    const data = await response.json();
    if (Array.isArray(data?.observations) && data.observations.length > 0) {
      return {
        valid: true,
        message: "✓ FRED connection successful",
      };
    }

    const errorMessage = data?.error_message ? ` (${String(data.error_message)})` : "";
    return {
      valid: false,
      message: `✗ FRED response missing observations${errorMessage}`,
    };
  } catch (error) {
    return {
      valid: false,
      message: `✗ FRED connection error: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Test Brave Search API credentials
 */
async function testBraveConnection(apiKey: string): Promise<ValidationResult> {
  try {
    const params = new URLSearchParams({
      q: "test",
      count: "1",
    });
    
    const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": apiKey,
      },
    });

    if (response.ok) {
      const data = await response.json();
      if (data?.web?.results && Array.isArray(data.web.results)) {
        return {
          valid: true,
          message: "✓ Brave Search connection successful",
        };
      }
      return {
        valid: false,
        message: "✗ Brave Search returned no results",
      };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        valid: false,
        message: "✗ Brave Search API key invalid or unauthorized",
      };
    }

    if (response.status === 402 || response.status === 429) {
      return {
        valid: false,
        message: `✗ Brave Search rate limited or quota exceeded (${response.status})`,
      };
    }

    return {
      valid: false,
      message: `✗ Brave Search API error: ${response.status} ${response.statusText}`,
    };
  } catch (error) {
    return {
      valid: false,
      message: `✗ Brave Search connection error: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

/**
 * Test OpenAI API credentials
 */
async function testOpenAiConnection(apiKey: string, baseUrl?: string): Promise<ValidationResult> {
  try {
    const resolvedBaseUrl = trimTrailingSlash((baseUrl || "https://api.openai.com").trim());
    const response = await fetch(`${resolvedBaseUrl}/v1/models`, {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (response.ok) {
      return {
        valid: true,
        message: "✓ OpenAI connection successful",
      };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        valid: false,
        message: "✗ OpenAI API key invalid or unauthorized",
      };
    }

    return {
      valid: false,
      message: `✗ OpenAI API error: ${response.status} ${response.statusText}`,
    };
  } catch (error) {
    return {
      valid: false,
      message: `✗ OpenAI connection error: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Test Anthropic API credentials
 */
async function testAnthropicConnection(apiKey: string): Promise<ValidationResult> {
  try {
    const response = await fetch("https://api.anthropic.com/v1/models", {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    });

    if (response.ok) {
      return {
        valid: true,
        message: "✓ Anthropic connection successful",
      };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        valid: false,
        message: "✗ Anthropic API key invalid or unauthorized",
      };
    }

    return {
      valid: false,
      message: `✗ Anthropic API error: ${response.status} ${response.statusText}`,
    };
  } catch (error) {
    return {
      valid: false,
      message: `✗ Anthropic connection error: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Test Google Gemini API credentials
 */
async function testGoogleGeminiConnection(apiKey: string): Promise<ValidationResult> {
  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (response.ok) {
      return {
        valid: true,
        message: "✓ Google Gemini connection successful",
      };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        valid: false,
        message: "✗ Google Gemini API key invalid or unauthorized",
      };
    }

    return {
      valid: false,
      message: `✗ Google Gemini API error: ${response.status} ${response.statusText}`,
    };
  } catch (error) {
    return {
      valid: false,
      message: `✗ Google Gemini connection error: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Test Microsoft Copilot (Azure OpenAI) credentials
 */
async function testMicrosoftCopilotConnection(
  apiKey: string,
  endpoint: string,
  apiVersion = "2024-02-01",
): Promise<ValidationResult> {
  const normalizedEndpoint = trimTrailingSlash(endpoint.trim());
  if (!normalizedEndpoint.startsWith("http")) {
    return {
      valid: false,
      message: "✗ Invalid Azure endpoint format (must start with http/https)",
    };
  }

  try {
    const response = await fetch(`${normalizedEndpoint}/openai/models?api-version=${encodeURIComponent(apiVersion)}`, {
      method: "GET",
      headers: {
        "api-key": apiKey,
      },
    });

    if (response.ok) {
      return {
        valid: true,
        message: "✓ Microsoft Copilot (Azure OpenAI) connection successful",
      };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        valid: false,
        message: "✗ Microsoft Copilot (Azure OpenAI) key invalid or unauthorized",
      };
    }

    return {
      valid: false,
      message: `✗ Microsoft Copilot (Azure OpenAI) API error: ${response.status} ${response.statusText}`,
    };
  } catch (error) {
    return {
      valid: false,
      message: `✗ Microsoft Copilot (Azure OpenAI) connection error: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Generic test for custom API providers ("other")
 * Validates basic HTTP connectivity and authentication
 */
async function testGenericConnection(apiKey: string, baseUrl: string): Promise<ValidationResult> {
  if (!baseUrl || !baseUrl.startsWith("http")) {
    return {
      valid: false,
      message: "✗ Invalid base URL format (must start with http/https)",
    };
  }

  try {
    // Create abort controller with 10-second timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(baseUrl, {
        method: "HEAD",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      // Accept 200-401 as valid (means server accepted the request and validated auth)
      // 403+ means auth failed or resource not found
      if (response.ok) {
        return {
          valid: true,
          message: `✓ Connection successful (HTTP ${response.status})`,
        };
      }

      if (response.status === 401 || response.status === 403) {
        return {
          valid: false,
          message: `✗ Authentication failed (HTTP ${response.status}). Check API key.`,
        };
      }

      // Other errors might be server-side, not necessarily credential issues
      return {
        valid: false,
        message: `✗ Server returned HTTP ${response.status}. Verify URL is correct.`,
      };
    } catch (fetchErr) {
      if (fetchErr instanceof Error && fetchErr.name === "AbortError") {
        return {
          valid: false,
          message: "✗ Connection timeout (10s). Check URL is accessible.",
        };
      }
      throw fetchErr;
    }
  } catch (error) {
    return {
      valid: false,
      message: `✗ Connection error: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Validate API key for a specific provider
 */
export async function validateApiKey(
  provider: ApiProvider,
  credentials: Record<string, string>
): Promise<ValidationResult> {
  try {
    switch (provider) {
      case "alpaca": {
        const keyId = credentials.APCA_API_KEY_ID || credentials.keyId;
        const secret = credentials.APCA_API_SECRET_KEY || credentials.secret;
        const baseUrl = credentials.ALPACA_DATA_BASE_URL || credentials.baseUrl || "https://paper-api.alpaca.markets";
        
        if (!keyId || !secret) {
          return {
            valid: false,
            message: "✗ Missing Alpaca credentials",
          };
        }
        
        return await testAlpacaConnection(keyId, secret, baseUrl);
      }

      case "polygon": {
        const apiKey = credentials.POLYGON_API_KEY || credentials.apiKey;
        if (!apiKey) {
          return {
            valid: false,
            message: "✗ Missing Polygon API key",
          };
        }
        return await testPolygonConnection(apiKey);
      }

      case "finnhub": {
        const apiKey = credentials.FINNHUB_API_KEY || credentials.apiKey;
        if (!apiKey) {
          return {
            valid: false,
            message: "✗ Missing Finnhub API key",
          };
        }
        return await testFinnhubConnection(apiKey);
      }

      case "quiver": {
        const apiKey = credentials.QUIVER_API_KEY || credentials.apiKey;
        if (!apiKey) {
          return {
            valid: false,
            message: "✗ Missing Quiver API key",
          };
        }
        return await testQuiverConnection(apiKey);
      }

      case "coinbase": {
        const apiKey = credentials.COINBASE_API_KEY || credentials.apiKey;
        const apiSecret = credentials.COINBASE_API_SECRET || credentials.apiSecret;
        if (!apiKey || !apiSecret) {
          return {
            valid: false,
            message: "✗ Missing Coinbase credentials",
          };
        }
        return await testCoinbaseConnection(apiKey, apiSecret);
      }

      case "bls": {
        const apiKey = credentials.BLS_API_KEY || credentials.apiKey;
        if (!apiKey) {
          return {
            valid: false,
            message: "✗ Missing BLS API key",
          };
        }
        return await testBlsConnection(apiKey);
      }

      case "fred": {
        const apiKey = credentials.FRED_API_KEY || credentials.apiKey;
        if (!apiKey) {
          return {
            valid: false,
            message: "✗ Missing FRED API key",
          };
        }
        return await testFredConnection(apiKey);
      }

      case "interactive-brokers": {
        // IB requires different validation approach
        return {
          valid: true,
          message: "⚠ Interactive Brokers validation not implemented",
        };
      }

      case "brave": {
        const apiKey = credentials.API_KEY || credentials.apiKey;
        if (!apiKey) {
          return {
            valid: false,
            message: "✗ Missing Brave Search API key",
          };
        }
        return await testBraveConnection(apiKey);
      }

      case "other": {
        const apiKey = credentials.API_KEY || credentials.apiKey;
        const baseUrl = credentials.BASE_URL || credentials.baseUrl;
        if (!apiKey) {
          return {
            valid: false,
            message: "✗ Missing API key",
          };
        }
        if (!baseUrl) {
          return {
            valid: false,
            message: "✗ Missing base URL",
          };
        }
        return await testGenericConnection(apiKey, baseUrl);
      }

      default:
        return {
          valid: false,
          message: `✗ Unknown provider: ${provider}`,
        };
    }
  } catch (error) {
    return {
      valid: false,
      message: `✗ Validation error: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Validate stored API key by ID
 */
export async function validateStoredApiKey(
  apiKeyId: string,
  provider: ApiProvider,
  fields: Array<{ key: string; account: string }>,
  config?: Record<string, string>
): Promise<ValidationResult> {
  try {
    console.log(`[validateStoredApiKey] Starting validation for provider: ${provider}, fields:`, fields.map(f => f.key));
    
    const credentials: Record<string, string> = {};

    for (const field of fields) {
      // Only try to retrieve from secure storage if account is set
      // (config fields might not have an account, meaning they're not stored securely)
      if (!field.account) {
        console.log(`[validateStoredApiKey] Skipping ${field.key} - no account specified (config field)`);
        continue;
      }

      console.log(`[validateStoredApiKey] Retrieving ${field.key} from account: ${field.account}`);
      const secret = await getSecret(field.account);
      if (!secret) {
        console.warn(`[validateStoredApiKey] Failed to retrieve ${field.key} from secure storage`);
        return {
          valid: false,
          message: `✗ Could not retrieve ${field.key} from secure storage (account: ${field.account})`,
        };
      }
      console.log(`[validateStoredApiKey] Successfully retrieved ${field.key}`);
      credentials[field.key] = secret;
    }

    if (config && typeof config === "object") {
      for (const [key, value] of Object.entries(config)) {
        if (typeof value === "string" && value.trim().length > 0) {
          credentials[key] = value.trim();
        }
      }
    }

    console.log(`[validateStoredApiKey] Built credentials object with keys:`, Object.keys(credentials));
    return await validateApiKey(provider, credentials);
  } catch (error) {
    console.error(`[validateStoredApiKey] Error:`, error);
    return {
      valid: false,
      message: `✗ Validation error: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

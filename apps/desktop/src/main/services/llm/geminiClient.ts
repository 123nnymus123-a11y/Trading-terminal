export interface GeminiCallOptions {
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: {
    message?: string;
  };
};

export async function callGemini(
  systemPrompt: string,
  userPrompt: string,
  opts: GeminiCallOptions,
): Promise<string> {
  const model = opts.model.trim();
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(opts.apiKey)}`;

  const payload = {
    ...(systemPrompt.trim()
      ? {
          system_instruction: {
            parts: [{ text: systemPrompt }],
          },
        }
      : {}),
    contents: [
      {
        role: "user",
        parts: [{ text: userPrompt }],
      },
    ],
    generationConfig: {
      temperature: opts.temperature ?? 0.3,
      ...(typeof opts.maxTokens === "number"
        ? { maxOutputTokens: opts.maxTokens }
        : {}),
    },
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: opts.signal,
  });

  const json = (await res.json().catch(() => ({}))) as GeminiResponse;

  if (!res.ok) {
    const detail = json.error?.message ?? res.statusText;
    const hint = res.status === 429 ? " — rate limited, wait and retry" : "";
    throw new Error(`Gemini ${model} -> HTTP ${res.status}: ${detail}${hint}`);
  }

  const text =
    json.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim() ?? "";

  if (!text) {
    throw new Error(`Gemini ${model} returned no content in response`);
  }

  return text;
}

export async function checkGeminiAvailable(
  apiKey: string,
  model = "gemini-2.5-pro",
): Promise<{ ok: boolean; model: string; error?: string }> {
  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "ping" }] }],
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const json = (await response.json().catch(() => ({}))) as GeminiResponse;
      return {
        ok: false,
        model,
        error: `HTTP ${response.status}: ${json.error?.message ?? response.statusText}`,
      };
    }

    return { ok: true, model };
  } catch (err) {
    return {
      ok: false,
      model,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

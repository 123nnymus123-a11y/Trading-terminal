import React, { useEffect, useMemo, useState } from "react";
import { API_KEY_TEMPLATES } from "../constants/apiKeyTemplates";
import { useSettingsStore } from "../store/settingsStore";
import type { CloudProvider } from "../store/settingsStore";

type CloudAiConfiguratorProps = {
  onConfigUpdated?: () => void;
};

type CloudProviderConfig = {
  key: Exclude<CloudProvider, "ollama">;
  label: string;
  icon: string;
  secretField: string;
  models: string[];
};

const CLOUD_PROVIDER_CONFIGS: CloudProviderConfig[] = [
  { key: "openai", label: "OpenAI", icon: "🧠", secretField: "OPENAI_API_KEY", models: ["gpt-4o", "gpt-4o-mini", "o1", "o3"] },
  { key: "anthropic", label: "Anthropic", icon: "🪶", secretField: "ANTHROPIC_API_KEY", models: ["claude-3-5-sonnet-latest", "claude-3-opus-20240229"] },
  { key: "gemini", label: "Google Gemini", icon: "✨", secretField: "GEMINI_API_KEY", models: ["gemini-2.5-pro", "gemini-2.5-flash"] },
  { key: "mistral", label: "Mistral", icon: "🌬️", secretField: "MISTRAL_API_KEY", models: ["mistral-large-latest", "codestral-latest"] },
  { key: "groq", label: "Groq", icon: "⚡", secretField: "GROQ_API_KEY", models: ["llama-3.3-70b-versatile", "deepseek-r1-distill-llama-70b"] },
  { key: "xai", label: "xAI / Grok", icon: "🚀", secretField: "XAI_API_KEY", models: ["grok-3", "grok-3-mini"] },
];

const OLLAMA_MODEL_PRESETS = [
  "deepseek-r1:14b",
  "deepseek-r1:7b",
  "llama3.1:8b",
  "llama3.1:70b",
  "mixtral:8x7b",
  "phi-3-medium",
  "qwen2.5-coder:7b",
  "gemma2:9b",
  "mistral:7b",
  "gpt-oss:120b-cloud",
  "gpt-oss:20b-cloud",
  "deepseek-v3.1:671b-cloud",
  "qwen3-coder:480b-cloud",
  "qwen3-vl:235b-cloud",
  "minimax-m2:cloud",
  "glm-4.6:cloud",
];

type RuntimeInfo = {
  available: boolean;
  version?: string;
  message?: string;
};

function toModelId(provider: CloudProvider, model: string): string {
  return `${provider}:${model}`;
}

function hasConnectedKey(provider: string, apiKeys: Array<{ provider: string }>): boolean {
  return apiKeys.some((entry) => entry.provider === provider);
}

export const CloudAiConfigurator: React.FC<CloudAiConfiguratorProps> = ({ onConfigUpdated }) => {
  const cloudAiModels = useSettingsStore((s) => s.cloudAiModels);
  const apiKeys = useSettingsStore((s) => s.apiKeys);
  const addCloudAiModel = useSettingsStore((s) => s.addCloudAiModel);
  const updateCloudAiModel = useSettingsStore((s) => s.updateCloudAiModel);
  const addApiKey = useSettingsStore((s) => s.addApiKey);

  const [runtime, setRuntime] = useState<RuntimeInfo>({ available: false });
  const [ollamaHost, setOllamaHost] = useState<string>("");
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [refreshingOllama, setRefreshingOllama] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [testingModel, setTestingModel] = useState<string | null>(null);

  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [providerModel, setProviderModel] = useState<Record<string, string>>({});
  const [providerApiKey, setProviderApiKey] = useState<Record<string, string>>({});

  const secretsApi = window.cockpit?.secrets;
  const apiHubApi = window.cockpit?.apiHub;
  const settingsApi = window.cockpit?.journal;

  const localModels = useMemo(() => {
    const fromStore = cloudAiModels
      .filter((entry) => entry.provider === "ollama")
      .map((entry) => entry.model);
    return Array.from(new Set([...ollamaModels, ...fromStore, ...OLLAMA_MODEL_PRESETS]));
  }, [cloudAiModels, ollamaModels]);

  const ollamaCloudModels = useMemo(
    () => localModels.filter((model) => model.toLowerCase().includes(":cloud") || model.toLowerCase().endsWith("-cloud")),
    [localModels],
  );

  useEffect(() => {
    let cancelled = false;
    const loadOllamaHost = async () => {
      try {
        const settings = await settingsApi?.settingsGet?.();
        const configured =
          typeof settings?.ollamaHostUrl === "string"
            ? settings.ollamaHostUrl
            : typeof settings?.ollama_host_url === "string"
              ? settings.ollama_host_url
              : localStorage.getItem("ollama_host_url");
        if (!cancelled) {
          setOllamaHost(configured ?? "http://localhost:11434");
        }
      } catch {
        if (!cancelled) {
          setOllamaHost(
            localStorage.getItem("ollama_host_url") ?? "http://localhost:11434",
          );
        }
      }
    };

    void loadOllamaHost();
    return () => {
      cancelled = true;
    };
  }, [settingsApi]);

  useEffect(() => {
    const next: Record<string, string> = {};
    CLOUD_PROVIDER_CONFIGS.forEach((provider) => {
      const existing = cloudAiModels.find((entry) => entry.provider === provider.key && entry.enabled);
      next[provider.key] = existing?.model ?? provider.models[0];
    });
    setProviderModel(next);
  }, [cloudAiModels]);

  const refreshOllama = async () => {
    setRefreshingOllama(true);
    setStatusMessage(null);
    try {
      const runtimeResult = await window.cockpit.aiResearch.checkRuntime();
      setRuntime({
        available: !!runtimeResult?.available,
        version: runtimeResult?.version,
        message: runtimeResult?.message,
      });
      const listed = await window.cockpit.aiResearch.listModels();
      setOllamaModels(Array.isArray(listed?.models) ? listed.models : []);
      setStatusMessage("Ollama model catalog refreshed.");
    } catch (err) {
      setRuntime({ available: false, message: err instanceof Error ? err.message : String(err) });
      setStatusMessage("Failed to refresh Ollama. Check runtime and host.");
    } finally {
      setRefreshingOllama(false);
    }
  };

  useEffect(() => {
    void refreshOllama();
  }, []);

  const setOllamaModelEnabled = (model: string, enabled: boolean) => {
    const existing = cloudAiModels.find((entry) => entry.provider === "ollama" && entry.model === model);
    if (existing) {
      updateCloudAiModel(`cloud-ai-${existing.createdAt}`, { enabled });
      onConfigUpdated?.();
      return;
    }

    if (enabled) {
      addCloudAiModel({
        provider: "ollama",
        model,
        tier: "standard",
        enabled: true,
        useForResearch: true,
        useForSupplyChain: true,
        useForCongress: true,
        useForCftc: true,
      });
      onConfigUpdated?.();
    }
  };

  const saveProviderKey = async (provider: CloudProviderConfig) => {
    const keyValue = (providerApiKey[provider.key] ?? "").trim();
    if (!keyValue) {
      setStatusMessage(`${provider.label}: API key is required.`);
      return;
    }

    const selectedModel = providerModel[provider.key] ?? provider.models[0];
    const recordId = crypto.randomUUID();
    const account = `apikey:${provider.key}:${recordId}:${provider.secretField}`;
    const apiLabel = API_KEY_TEMPLATES[provider.key]?.label ?? provider.label;

    try {
      await secretsApi?.set(account, keyValue);
      const newRecord = {
        id: recordId,
        name: `${apiLabel} Credentials`,
        provider: provider.key,
        fields: [{ key: provider.secretField, label: "API Key", account }],
        config: { DEFAULT_MODEL: selectedModel },
      };

      addApiKey(newRecord as any);
      await apiHubApi?.save?.(newRecord as any);

      const existing = cloudAiModels.find((entry) => entry.provider === provider.key);
      if (existing) {
        updateCloudAiModel(`cloud-ai-${existing.createdAt}`, {
          model: selectedModel,
          enabled: true,
          tier: "advanced",
          useForResearch: true,
          useForSupplyChain: true,
          useForCongress: true,
          useForCftc: true,
        });
      } else {
        addCloudAiModel({
          provider: provider.key,
          model: selectedModel,
          tier: "advanced",
          enabled: true,
          useForResearch: true,
          useForSupplyChain: true,
          useForCongress: true,
          useForCftc: true,
        });
      }

      setProviderApiKey((prev) => ({ ...prev, [provider.key]: "" }));
      setStatusMessage(`${provider.label} connected and saved to API Key Hub.`);
      onConfigUpdated?.();
    } catch (err) {
      setStatusMessage(`${provider.label} save failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))" }}>
        <section style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 16, background: "rgba(15,23,42,0.35)", display: "grid", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>🦙 Ollama Configuration</div>
              <div style={{ fontSize: 12, opacity: 0.75 }}>Local runtime, model scanning, and Ollama Cloud models</div>
            </div>
            <div
              style={{
                fontSize: 11,
                borderRadius: 999,
                padding: "5px 10px",
                border: runtime.available ? "1px solid rgba(34,197,94,0.45)" : "1px solid rgba(248,113,113,0.45)",
                background: runtime.available ? "rgba(34,197,94,0.13)" : "rgba(248,113,113,0.13)",
                color: runtime.available ? "#86efac" : "#fca5a5",
              }}
            >
              {runtime.available ? `Online ${runtime.version ?? ""}` : "Offline"}
            </div>
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label style={{ fontSize: 12, opacity: 0.7 }}>Ollama Host URL</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={ollamaHost}
                onChange={(e) => setOllamaHost(e.target.value)}
                placeholder="http://localhost:11434"
                style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "rgba(0,0,0,0.2)", color: "inherit" }}
              />
              <button
                type="button"
                onClick={async () => {
                  const nextHost = ollamaHost.trim();
                  if (!nextHost) {
                    setStatusMessage("Ollama host URL is required.");
                    return;
                  }
                  localStorage.setItem("ollama_host_url", nextHost);
                  try {
                    const current = await settingsApi?.settingsGet?.();
                    await settingsApi?.settingsSet?.({
                      ...(current ?? {}),
                      ollamaHostUrl: nextHost,
                    });
                    setStatusMessage("Ollama host URL saved.");
                    await refreshOllama();
                  } catch (err) {
                    setStatusMessage(
                      `Failed to save Ollama host: ${err instanceof Error ? err.message : String(err)}`,
                    );
                  }
                }}
                style={{ padding: "8px 12px" }}
              >
                Save
              </button>
              <button
                type="button"
                onClick={async () => {
                  const modelToTest = providerModel.ollama || localModels[0] || "";
                  if (!modelToTest) {
                    setStatusMessage("No Ollama model available to test.");
                    return;
                  }
                  setTestingModel(`ollama:${modelToTest}`);
                  try {
                    const result = await window.cockpit?.aiResearch?.testModelConnection?.({
                      provider: "ollama",
                      model: modelToTest,
                    });
                    setStatusMessage(
                      result?.message ?? "Ollama test completed.",
                    );
                    await refreshOllama();
                  } finally {
                    setTestingModel(null);
                  }
                }}
                style={{ padding: "8px 12px" }}
              >
                {testingModel?.startsWith("ollama:") ? "Testing..." : "Test Ollama Model"}
              </button>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button type="button" onClick={() => void refreshOllama()} disabled={refreshingOllama} style={{ padding: "8px 12px" }}>
              {refreshingOllama ? "Scanning..." : "Scan Models"}
            </button>
            <span style={{ fontSize: 12, opacity: 0.7 }}>{localModels.length} local models detected</span>
          </div>

          <div style={{ display: "grid", gap: 8, maxHeight: 220, overflowY: "auto", paddingRight: 4 }}>
            {localModels.map((model) => {
              const existing = cloudAiModels.find((entry) => entry.provider === "ollama" && entry.model === model);
              const enabled = !!existing?.enabled;
              return (
                <label key={toModelId("ollama", model)} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, padding: "6px 8px", borderRadius: 8, background: enabled ? "rgba(34,197,94,0.12)" : "rgba(255,255,255,0.03)" }}>
                  <input type="checkbox" checked={enabled} onChange={(e) => setOllamaModelEnabled(model, e.target.checked)} style={{ width: 15, height: 15 }} />
                  <span style={{ fontFamily: "var(--mono)" }}>{model}</span>
                </label>
              );
            })}
          </div>

          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, display: "grid", gap: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.85 }}>Ollama Cloud Models</div>
            <div style={{ fontSize: 12, opacity: 0.72 }}>
              {ollamaCloudModels.length > 0 ? ollamaCloudModels.join(", ") : "No Ollama cloud models detected yet."}
            </div>
          </div>
        </section>

        <section style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 16, background: "rgba(15,23,42,0.35)", display: "grid", gap: 10 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>☁️ Cloud AI Providers</div>
            <div style={{ fontSize: 12, opacity: 0.75 }}>Connect provider keys and choose default models. Keys are saved to API Key Hub.</div>
          </div>

          {CLOUD_PROVIDER_CONFIGS.map((provider) => {
            const connected = hasConnectedKey(provider.key, apiKeys as Array<{ provider: string }>);
            const expanded = expandedProvider === provider.key;
            return (
              <div key={provider.key} style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", background: "rgba(255,255,255,0.02)" }}>
                <button
                  type="button"
                  onClick={() => setExpandedProvider(expanded ? null : provider.key)}
                  style={{ width: "100%", textAlign: "left", border: "none", background: "transparent", color: "inherit", padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, fontWeight: 600 }}>
                    <span>{provider.icon}</span>
                    <span>{provider.label}</span>
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      borderRadius: 999,
                      padding: "4px 10px",
                      border: connected ? "1px solid rgba(34,197,94,0.45)" : "1px solid rgba(255,255,255,0.2)",
                      background: connected ? "rgba(34,197,94,0.14)" : "rgba(255,255,255,0.06)",
                      color: connected ? "#86efac" : "rgba(255,255,255,0.8)",
                    }}
                  >
                    {connected ? "Connected" : "No API Key"}
                  </span>
                </button>

                {expanded && (
                  <div style={{ padding: 12, borderTop: "1px solid var(--border)", display: "grid", gap: 8 }}>
                    <div style={{ display: "grid", gap: 6 }}>
                      <label style={{ fontSize: 12, opacity: 0.7 }}>Default Model</label>
                      <select
                        value={providerModel[provider.key] ?? provider.models[0]}
                        onChange={(e) => setProviderModel((prev) => ({ ...prev, [provider.key]: e.target.value }))}
                        style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "rgba(0,0,0,0.2)", color: "inherit" }}
                      >
                        {provider.models.map((model) => (
                          <option key={toModelId(provider.key, model)} value={model}>{model}</option>
                        ))}
                      </select>
                    </div>

                    <div style={{ display: "grid", gap: 6 }}>
                      <label style={{ fontSize: 12, opacity: 0.7 }}>{provider.secretField}</label>
                      <input
                        type="password"
                        value={providerApiKey[provider.key] ?? ""}
                        onChange={(e) => setProviderApiKey((prev) => ({ ...prev, [provider.key]: e.target.value }))}
                        placeholder="Enter API key"
                        style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "rgba(0,0,0,0.2)", color: "inherit", fontFamily: "var(--mono)" }}
                      />
                    </div>

                    <button type="button" onClick={() => void saveProviderKey(provider)} style={{ padding: "8px 12px", justifySelf: "start" }}>
                      Save to API Key Hub
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const model = providerModel[provider.key] ?? provider.models[0];
                        const rawKey = (providerApiKey[provider.key] ?? "").trim();
                        if (!rawKey && !connected) {
                          setStatusMessage(`${provider.label}: save or enter an API key before testing.`);
                          return;
                        }
                        setTestingModel(`${provider.key}:${model}`);
                        try {
                          const result = await window.cockpit?.aiResearch?.testModelConnection?.({
                            provider: provider.key,
                            model,
                            ...(rawKey ? { apiKey: rawKey } : {}),
                          });
                          setStatusMessage(
                            result?.message ?? "Model test completed.",
                          );
                        } finally {
                          setTestingModel(null);
                        }
                      }}
                      style={{ padding: "8px 12px", justifySelf: "start" }}
                    >
                      {testingModel === `${provider.key}:${providerModel[provider.key] ?? provider.models[0]}`
                        ? "Testing..."
                        : "Test Model Connection"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      </div>

      {statusMessage && (
        <div style={{ fontSize: 12, padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(59,130,246,0.35)", background: "rgba(59,130,246,0.12)", color: "#bfdbfe" }}>
          {statusMessage}
        </div>
      )}

      {!runtime.available && runtime.message && (
        <div style={{ fontSize: 12, padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(248,113,113,0.45)", background: "rgba(248,113,113,0.12)", color: "#fecaca" }}>
          Ollama runtime warning: {runtime.message}
        </div>
      )}
    </div>
  );
};

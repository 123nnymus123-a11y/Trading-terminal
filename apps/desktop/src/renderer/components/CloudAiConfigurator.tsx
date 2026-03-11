import React, { useState } from "react";
import { useSettingsStore } from "../store/settingsStore";
import type { CloudProvider } from "../store/settingsStore";

const CLOUD_PROVIDERS: Record<CloudProvider, { label: string; icon: string; color: string; type: "cloud" | "local" }> = {
  ollama: { label: "Local Ollama", icon: "🦙", color: "#4a5568", type: "local" },
};

const CLOUD_MODELS_BY_PROVIDER: Record<CloudProvider, string[]> = {
  ollama: [
    // DeepSeek models
    "deepseek-r1:1.5b",
    "deepseek-r1:7b",
    "deepseek-r1:8b",
    "deepseek-r1:14b",
    "deepseek-r1:32b",
    "deepseek-r1:70b",
    "deepseek-r1:671b",
    "deepseek-coder:6.7b",
    "deepseek-coder:33b",
    // Llama models
    "llama2",
    "llama2:7b",
    "llama2:13b",
    "llama2:70b",
    "llama3:8b",
    "llama3:70b",
    "llama3.1:8b",
    "llama3.1:70b",
    "llama3.1:405b",
    "llama3.2:1b",
    "llama3.2:3b",
    "codellama:7b",
    "codellama:13b",
    "codellama:34b",
    // Mistral models
    "mistral:7b",
    "mistral-large",
    "mixtral:8x7b",
    "mixtral:8x22b",
    // Phi models
    "phi:2.7b",
    "phi-3-mini",
    "phi-3-medium",
    "phi-3-small",
    // Gemma models
    "gemma:2b",
    "gemma:7b",
    "gemma2:2b",
    "gemma2:9b",
    "gemma2:27b",
    // Qwen models
    "qwen:0.5b",
    "qwen:1.8b",
    "qwen:4b",
    "qwen:7b",
    "qwen:14b",
    "qwen:32b",
    "qwen:72b",
    "qwen2:0.5b",
    "qwen2:1.5b",
    "qwen2:7b",
    "qwen2.5:7b",
    "qwen2.5:14b",
    "qwen2.5-coder:7b",
    // Other popular models
    "neural-chat:7b",
    "starling-lm:7b",
    "vicuna:7b",
    "vicuna:13b",
    "orca-mini:3b",
    "orca-mini:7b",
    "orca2:7b",
    "orca2:13b",
    "wizardcoder:7b",
    "wizardcoder:13b",
    "wizardcoder:34b",
    "solar:10.7b",
    "yi:6b",
    "yi:34b",
    "falcon:7b",
    "falcon:40b",
    "tinyllama:1.1b",
    "stablelm2:1.6b",
    "stablelm2:12b",
  ],
};

interface CloudAiConfiguratorProps {
  onConfigUpdated?: () => void;
}

export const CloudAiConfigurator: React.FC<CloudAiConfiguratorProps> = ({ onConfigUpdated }) => {
  const cloudAiModels = useSettingsStore((s) => s.cloudAiModels);
  const addCloudAiModel = useSettingsStore((s) => s.addCloudAiModel);
  const updateCloudAiModel = useSettingsStore((s) => s.updateCloudAiModel);
  const removeCloudAiModel = useSettingsStore((s) => s.removeCloudAiModel);
  const getActiveCloudModels = useSettingsStore((s) => s.getActiveCloudModels);

  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<CloudProvider>("ollama");
  const [selectedModel, setSelectedModel] = useState("deepseek-r1:14b");
  const [selectedTier, setSelectedTier] = useState<"standard" | "advanced" | "expert">("standard");
  const [formError, setFormError] = useState<string | null>(null);

  const handleAddModel = () => {
    if (!selectedModel) {
      setFormError("Please select a model");
      return;
    }

    try {
      addCloudAiModel({
        provider: selectedProvider,
        model: selectedModel,
        tier: selectedTier,
        enabled: true,
        temperature: 0.7,
        maxTokens: 2000,
        useForResearch: true,
        useForSupplyChain: true,
        useForCongress: true,
        useForCftc: true,
      });

      setShowAddForm(false);
      setFormError(null);
      onConfigUpdated?.();
    } catch (err) {
      setFormError(String(err));
    }
  };

  const handleToggleFeature = (modelIndex: number, feature: "useForResearch" | "useForSupplyChain" | "useForCongress" | "useForCftc") => {
    const model = cloudAiModels[modelIndex];
    if (model) {
      updateCloudAiModel(`cloud-ai-${model.createdAt}`, {
        [feature]: !model[feature],
      });
    }
  };

  const activeModels = getActiveCloudModels();

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {cloudAiModels.length === 0 && (
        <div style={{
          padding: "16px 20px",
          background: "rgba(59,130,246,0.08)",
          border: "1px solid rgba(59,130,246,0.3)",
          borderRadius: 8,
          fontSize: 13,
          color: "#bfdbfe",
          lineHeight: 1.6,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>💡 Getting Started with Cloud AI</div>
          <div>
            Click "+ Add Cloud Model" below to configure the local Ollama model used by desktop fallback.
            <br />
            <strong>Note:</strong> AI processing is backend-first; local Ollama is used for desktop fallback when enabled.
          </div>
        </div>
      )}
      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>
            ☁️ Cloud AI Models
          </div>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            style={{
              padding: "8px 16px",
              background: "#3b82f6",
              border: "none",
              borderRadius: 6,
              color: "#fff",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {showAddForm ? "Cancel" : "+ Add Cloud Model"}
          </button>
        </div>

        {showAddForm && (
          <div style={{
            padding: 16,
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: 8,
            background: "rgba(59, 130, 246, 0.05)",
            display: "grid",
            gap: 12,
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, opacity: 0.9 }}>Add New Cloud Model</div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, opacity: 0.7, display: "block", marginBottom: 4 }}>Provider</label>
                <select
                  value={selectedProvider}
                  onChange={(e) => {
                    const provider = e.target.value as CloudProvider;
                    setSelectedProvider(provider);
                    const models = CLOUD_MODELS_BY_PROVIDER[provider];
                    setSelectedModel(models?.[0] || "");
                  }}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    background: "rgba(0,0,0,0.3)",
                    border: "1px solid rgba(255,255,255,0.2)",
                    borderRadius: 4,
                    color: "#fff",
                    fontSize: 12,
                  }}
                >
                  <optgroup label="💻 Local Providers">
                    {Object.entries(CLOUD_PROVIDERS).filter(([_, val]) => val.type === "local").map(([key, val]) => (
                      <option key={key} value={key}>{val.label}</option>
                    ))}
                  </optgroup>
                </select>
              </div>

              <div>
                <label style={{ fontSize: 12, opacity: 0.7, display: "block", marginBottom: 4 }}>Model</label>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    background: "rgba(0,0,0,0.3)",
                    border: "1px solid rgba(255,255,255,0.2)",
                    borderRadius: 4,
                    color: "#fff",
                    fontSize: 12,
                  }}
                >
                  {CLOUD_MODELS_BY_PROVIDER[selectedProvider].map((model) => (
                    <option key={model} value={model}>{model}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: 12, opacity: 0.7, display: "block", marginBottom: 4 }}>Tier</label>
                <select
                  value={selectedTier}
                  onChange={(e) => setSelectedTier(e.target.value as "standard" | "advanced" | "expert")}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    background: "rgba(0,0,0,0.3)",
                    border: "1px solid rgba(255,255,255,0.2)",
                    borderRadius: 4,
                    color: "#fff",
                    fontSize: 12,
                  }}
                >
                  <option value="standard">Standard (Cost-effective)</option>
                  <option value="advanced">Advanced (Balanced)</option>
                  <option value="expert">Expert (Highest Quality)</option>
                </select>
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                <button
                  onClick={handleAddModel}
                  style={{
                    flex: 1,
                    padding: "8px 12px",
                    background: "#22c55e",
                    border: "none",
                    borderRadius: 4,
                    color: "#fff",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  Add Model
                </button>
              </div>
            </div>

            {formError && (
              <div style={{
                fontSize: 12,
                color: "#fca5a5",
                background: "rgba(248, 113, 113, 0.15)",
                padding: "8px 12px",
                borderRadius: 4,
              }}>
                {formError}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Active Models List */}
      {activeModels.length > 0 && (
        <div style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
        }}>
          {cloudAiModels.map((model, idx) => {
            const providerInfo = CLOUD_PROVIDERS[model.provider];
            return (
              <div
                key={`${model.createdAt}-${idx}`}
                style={{
                  padding: 16,
                  border: model.enabled
                    ? "1px solid rgba(34,197,94,0.4)"
                    : "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8,
                  background: model.enabled
                    ? "rgba(34,197,94,0.08)"
                    : "rgba(255,255,255,0.02)",
                  display: "grid",
                  gap: 12,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>
                      {providerInfo.icon} {model.model}
                    </div>
                    <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
                      {providerInfo.label} • {model.tier}
                    </div>
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={model.enabled}
                      onChange={(e) => {
                        updateCloudAiModel(`cloud-ai-${model.createdAt}`, {
                          enabled: e.target.checked,
                        });
                      }}
                      style={{ width: 16, height: 16 }}
                    />
                    <span style={{ fontSize: 11 }}>Active</span>
                  </label>
                </div>

                <div style={{ display: "grid", gap: 8, fontSize: 12 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={model.useForResearch || false}
                      onChange={() => handleToggleFeature(idx, "useForResearch")}
                      disabled={!model.enabled}
                      style={{ width: 14, height: 14 }}
                    />
                    <span>Use for Research</span>
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={model.useForSupplyChain || false}
                      onChange={() => handleToggleFeature(idx, "useForSupplyChain")}
                      disabled={!model.enabled}
                      style={{ width: 14, height: 14 }}
                    />
                    <span>Use for Supply Chain</span>
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={model.useForCongress || false}
                      onChange={() => handleToggleFeature(idx, "useForCongress")}
                      disabled={!model.enabled}
                      style={{ width: 14, height: 14 }}
                    />
                    <span>Use for Congress</span>
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={model.useForCftc || false}
                      onChange={() => handleToggleFeature(idx, "useForCftc")}
                      disabled={!model.enabled}
                      style={{ width: 14, height: 14 }}
                    />
                    <span>Use for CFTC</span>
                  </label>
                </div>

                <div style={{ fontSize: 11, opacity: 0.5, display: "flex", justifyContent: "space-between" }}>
                  <span>Added: {new Date(model.createdAt).toLocaleDateString()}</span>
                  {model.lastUsed && (
                    <span>Used: {new Date(model.lastUsed).toLocaleString()}</span>
                  )}
                </div>

                <button
                  onClick={() => removeCloudAiModel(`cloud-ai-${model.createdAt}`)}
                  style={{
                    padding: "6px 12px",
                    background: "rgba(248,113,113,0.2)",
                    border: "1px solid rgba(248,113,113,0.4)",
                    borderRadius: 4,
                    color: "#fca5a5",
                    cursor: "pointer",
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  Remove
                </button>
              </div>
            );
          })}
        </div>
      )}

      {cloudAiModels.length === 0 && (
        <div style={{
          padding: 24,
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 8,
          textAlign: "center",
          opacity: 0.6,
          fontSize: 13,
        }}>
          No cloud models configured. Add one to get started.
        </div>
      )}
    </div>
  );
};

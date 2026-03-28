import React, { useEffect, useMemo } from "react";
import { useAiResearchStore } from "../store/aiResearchStore";
import { useSettingsStore } from "../store/settingsStore";

export default function TerminalAI() {
  const aiInit = useAiResearchStore((s) => s.init);
  const aiLoadConfig = useAiResearchStore((s) => s.loadConfig);
  const aiSaveConfig = useAiResearchStore((s) => s.saveConfig);
  const aiRunNow = useAiResearchStore((s) => s.runNow);
  const aiRefreshBriefs = useAiResearchStore((s) => s.refreshBriefs);
  const aiCheckRuntime = useAiResearchStore((s) => s.checkRuntime);
  const aiConfig = useAiResearchStore((s) => s.config);
  const aiStatus = useAiResearchStore((s) => s.status);
  const aiRuntime = useAiResearchStore((s) => s.runtime);
  const aiBriefs = useAiResearchStore((s) => s.briefs);
  const aiLoading = useAiResearchStore((s) => s.loading);
  const aiError = useAiResearchStore((s) => s.error);
  const aiLastErrors = useAiResearchStore((s) => s.lastErrors);
  const getActiveCloudModels = useAiResearchStore((s) => s.getActiveCloudModels);

  const focusDraft = useAiResearchStore((s) => s.focusDraft);
  const setFocusDraft = useAiResearchStore((s) => s.setFocusDraft);
  
  // Cloud models support
  const cloudModels = useSettingsStore((s) => s.cloudAiModels);
  const aiEnginePreference = useSettingsStore((s) => s.aiEnginePreference);

  useEffect(() => {
    aiInit();
    aiLoadConfig();
    aiRefreshBriefs(5);
    aiCheckRuntime();
    // Update cloud models in AI store
    useAiResearchStore.setState({ cloudModels });
  }, [aiInit, aiLoadConfig, aiRefreshBriefs, aiCheckRuntime, cloudModels]);

  const canRun = !!aiConfig?.enabled && aiRuntime?.available && !aiLoading;
  const activeCloudModels = getActiveCloudModels();
  const hasCloudFallback = aiEnginePreference !== "local-only";
  const safeBriefs = Array.isArray(aiBriefs) ? aiBriefs : [];

  const summary = useMemo(() => {
    if (!aiConfig) return "";
    const parts = [];
    if (aiConfig.focusPrompt?.trim()) {
      parts.push("Focused mode enabled");
    }
    if (activeCloudModels.length > 0) {
      parts.push(`${activeCloudModels.length} cloud model(s)`);
    }
    return parts.length > 0 ? parts.join(" • ") : "No focus prompt set";
  }, [aiConfig, activeCloudModels]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>Terminal AI Research</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Customize today's focus and run terminal/cloud briefings</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            {aiRuntime?.available
              ? `🖥️ Ollama ${aiRuntime.version ?? "ready"}`
              : activeCloudModels.length > 0
              ? `☁️ Cloud-only mode`
              : "⚠️ No runtime available"
            }
          </div>
          {hasCloudFallback && (
            <div style={{ fontSize: 11, opacity: 0.6 }}>
              ☁️ Cloud fallback enabled
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: 12, borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)" }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Focus prompt</div>
        <textarea
          rows={4}
          placeholder="Example: Focus on semiconductors and AI hardware. Look for earnings, guidance, and supply chain updates affecting NVDA, AMD, ASML."
          value={focusDraft}
          onChange={(e) => setFocusDraft(e.target.value)}
          style={{ width: "100%", padding: 10, fontSize: 12 }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button
            onClick={() => {
              if (!aiConfig) return;
              aiSaveConfig({ ...aiConfig, focusPrompt: focusDraft });
            }}
            disabled={aiLoading}
          >
            Save prompt
          </button>
          <button
            onClick={() => aiRunNow()}
            disabled={!canRun}
          >
            Run now
          </button>
          <button onClick={() => aiRefreshBriefs(5)} disabled={aiLoading}>
            Refresh briefs
          </button>
          <button onClick={() => aiCheckRuntime()} disabled={aiLoading}>
            Check runtime
          </button>
        </div>
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>{summary}</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, fontSize: 12 }}>
        <div>Running: <b>{aiStatus?.running ? "yes" : "no"}</b></div>
        <div>Queue depth: <b>{aiStatus?.queueDepth ?? 0}</b></div>
        <div>Last run: <b>{aiStatus?.lastRun?.finishedAt ? new Date(aiStatus.lastRun.finishedAt).toLocaleString() : "—"}</b></div>
        <div>Status: <b>{aiStatus?.lastRun?.status ?? "—"}</b></div>
      </div>

      {aiStatus?.lastRun?.error && (
        <div style={{ fontSize: 12, color: "#fca5a5" }}>Last run error: {aiStatus.lastRun.error}</div>
      )}

      {aiError && (
        <div style={{ padding: 8, borderRadius: 8, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.4)", color: "#fecdd3" }}>
          {aiError}
        </div>
      )}

      {aiLastErrors.length > 0 && (
        <div style={{ padding: 8, borderRadius: 8, background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.3)", fontSize: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Warnings</div>
          <div style={{ display: "grid", gap: 4 }}>
            {aiLastErrors.map((err, idx) => (
              <div key={`ai-warn-${idx}`}>{err}</div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Latest briefs</div>
        {safeBriefs.length === 0 ? (
          <div style={{ fontSize: 12, opacity: 0.7 }}>No briefs yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {safeBriefs.map((brief) => (
              <div key={brief.id} style={{ padding: 10, borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)" }}>
                <div style={{ fontWeight: 700 }}>{brief.headline}</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  Impact: <b>{brief.impactScore}</b> • Confidence: <b>{brief.confidence}</b>
                </div>
                {brief.tickers?.length > 0 && (
                  <div style={{ fontSize: 11, opacity: 0.8, marginTop: 6 }}>Tickers: {brief.tickers.join(", ")}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

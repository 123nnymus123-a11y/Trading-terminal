import React, { useEffect, useState } from "react";
import { PublicFlowIntelPanel } from "../components/PublicFlowIntel/PublicFlowIntelPanel";
import { useAiResearchStore } from "../store/aiResearchStore";
import { useSettingsStore } from "../store/settingsStore";

function formatRelativeTime(timestamp: string): string {
  const now = Date.now();
  const time = new Date(timestamp).getTime();
  const diff = now - time;
  
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (seconds < 60) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function getEventTime(brief: any): string {
  // Get the earliest publishedAt time from sources as the event time
  if (brief.sources && brief.sources.length > 0) {
    const times = brief.sources.map((s: any) => new Date(s.publishedAt).getTime());
    const earliestTime = Math.min(...times);
    return new Date(earliestTime).toISOString();
  }
  // Fallback to createdAt if no sources
  return brief.createdAt;
}

export default function Intelligence() {
  const [selectedBriefId, setSelectedBriefId] = useState<string | null>(null);
  const [lastRefreshTime, setLastRefreshTime] = useState<number>(Date.now());

  const aiInit = useAiResearchStore((s) => s.init);
  const aiRefreshBriefs = useAiResearchStore((s) => s.refreshBriefs);
  const aiLoadConfig = useAiResearchStore((s) => s.loadConfig);
  const aiCheckRuntime = useAiResearchStore((s) => s.checkRuntime);
  const aiConfig = useAiResearchStore((s) => s.config);
  const aiRuntime = useAiResearchStore((s) => s.runtime);
  const aiBriefs = useAiResearchStore((s) => s.briefs);
  const getActiveCloudModels = useAiResearchStore((s) => s.getActiveCloudModels);
  const cloudModels = useSettingsStore((s) => s.cloudAiModels);

  useEffect(() => {
    aiInit();
    aiLoadConfig();
    aiRefreshBriefs(5);
    aiCheckRuntime();
    setLastRefreshTime(Date.now());
    // Update cloud models in AI store
    useAiResearchStore.setState({ cloudModels });
  }, [aiInit, aiLoadConfig, aiRefreshBriefs, aiCheckRuntime, cloudModels]);

  const selectedBrief = selectedBriefId ? aiBriefs.find((b) => b.id === selectedBriefId) : null;
  const activeCloudModels = getActiveCloudModels();

  return (
    <div style={{ opacity: 0.95, display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 14px",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 8,
          background: "rgba(0,0,0,0.2)",
        }}
      >
        <h2 style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
          <div style={{ fontSize: 24, fontWeight: 800 }}>Intelligence</div>
          <div style={{ fontSize: 11, opacity: 0.7 }}>AI Briefs + Flow Intel</div>
          <div style={{ fontSize: 10, opacity: 0.5 }}>
            Last updated: {formatRelativeTime(new Date(lastRefreshTime).toISOString())}
          </div>
        </h2>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          {aiRuntime?.available && (
            <div style={{ fontSize: 11, opacity: 0.7 }}>
              {activeCloudModels.length > 0
                ? `☁️ ${activeCloudModels[0]?.provider} • ${activeCloudModels[0]?.model}`
                : `🖥️ Ollama ${aiRuntime.version ?? "ready"}`
              }
            </div>
          )}
          {!aiRuntime?.available && (
            <div style={{ fontSize: 11, color: "#fca5a5" }}>
              ⚠️ No AI runtime available
            </div>
          )}
          <div style={{ fontSize: 10, opacity: 0.5 }}>
            Cloud models: {cloudModels.filter((m) => m.enabled).length} active
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(420px, 2fr) minmax(320px, 1fr)", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ fontSize: 12, opacity: 0.7, letterSpacing: 0.6 }}>TOP HEADLINES</div>
          <div
            style={{
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 12,
              padding: 14,
              background: "linear-gradient(180deg, rgba(17,24,39,0.9), rgba(15,23,42,0.85))",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 16, fontWeight: 800 }}>Top Headlines</div>
              <div style={{ fontSize: 11, opacity: 0.7 }}>AI Briefing</div>
            </div>

            {!aiConfig?.enabled && (
              <div style={{ fontSize: 12, opacity: 0.7 }}>AI not enabled.</div>
            )}

            {aiConfig?.enabled && aiRuntime && !aiRuntime.available && (
              <div style={{ fontSize: 12, color: "#fca5a5" }}>
                Local LLM runtime not installed. Install Ollama to enable.
              </div>
            )}

            {aiConfig?.enabled && aiRuntime?.available && aiBriefs.length === 0 && (
              <div style={{ fontSize: 12, opacity: 0.7 }}>No briefs yet. Run AI in Settings & Logs.</div>
            )}

            {aiBriefs.length > 0 && (
              <div style={{ display: "grid", gap: 8 }}>
                {aiBriefs.slice(0, 5).map((brief) => (
                  <div
                    key={brief.id}
                    onClick={() => setSelectedBriefId(brief.id)}
                    style={{
                      padding: 10,
                      borderRadius: 10,
                      border: "1px solid rgba(255,255,255,0.08)",
                      cursor: "pointer",
                      transition: "transform 120ms ease, border 120ms ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.border = "1px solid rgba(56,189,248,0.6)";
                      e.currentTarget.style.transform = "translateY(-1px)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.border = "1px solid rgba(255,255,255,0.08)";
                      e.currentTarget.style.transform = "translateY(0px)";
                    }}
                  ><div style={{ fontSize: 10, opacity: 0.5, marginTop: 4 }}>
                      {formatRelativeTime(getEventTime(brief))}
                    </div>
                    
                    <div style={{ fontWeight: 700 }}>{brief.headline}</div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                      Impact: <b>{brief.impactScore}</b> • Confidence: <b>{brief.confidence}</b>
                    </div>
                    {brief.tickers?.length > 0 && (
                      <div style={{ fontSize: 11, opacity: 0.8, marginTop: 6 }}>
                        Tickers: {brief.tickers.join(", ")}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ fontSize: 12, opacity: 0.7, letterSpacing: 0.6 }}>FLOW INTEL</div>
          <PublicFlowIntelPanel />
        </div>
      </div>

      {selectedBrief && (
        <>
          <div
            onClick={() => setSelectedBriefId(null)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.35)",
              zIndex: 40,
            }}
          />
          <div
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              width: 420,
              maxWidth: "90vw",
              height: "100vh",
              background: "linear-gradient(180deg, rgba(15,23,42,0.98), rgba(2,6,23,0.96))",
              borderLeft: "1px solid rgba(255,255,255,0.08)",
              padding: 20,
              zIndex: 41,
              overflowY: "auto",
              boxShadow: "-8px 0 24px rgba(0,0,0,0.3)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 16, fontWeight: 800 }}>Brief Detail</div>
              <button onClick={() => setSelectedBriefId(null)}>Close</button>
            </div>

            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 8 }}>{selectedBrief.headline}</div>
            <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 8 }}>
              Impact <b>{selectedBrief.impactScore}</b> • Confidence <b>{selectedBrief.confidence}</b>
            </div>
            <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 12, fontStyle: "italic" }}>
              Event {formatRelativeTime(getEventTime(selectedBrief))}
            </div>

            {selectedBrief.summaryBullets?.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Was ist passiert?</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.6 }}>
                  {selectedBrief.summaryBullets.map((b, idx) => (
                    <li key={`${selectedBrief.id}-sum-${idx}`}>{b}</li>
                  ))}
                </ul>
              </div>
            )}

            {selectedBrief.whyItMatters?.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Warum relevant fürs Trading?</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.6 }}>
                  {selectedBrief.whyItMatters.map((b, idx) => (
                    <li key={`${selectedBrief.id}-why-${idx}`}>{b}</li>
                  ))}
                </ul>
              </div>
            )}

            {selectedBrief.whatToWatch?.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Was jetzt beobachten?</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.6 }}>
                  {selectedBrief.whatToWatch.map((b, idx) => (
                    <li key={`${selectedBrief.id}-watch-${idx}`}>{b}</li>
                  ))}
                </ul>
              </div>
            )}

            {selectedBrief.tickers?.length > 0 && (
              <div style={{ marginBottom: 12, fontSize: 12 }}>
                <b>Tickers:</b> {selectedBrief.tickers.join(", ")}
              </div>
            )}

            {selectedBrief.sources?.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Quellenlinks</div>
                <div style={{ display: "grid", gap: 8, fontSize: 12 }}>
                  {selectedBrief.sources.map((s, idx) => (
                    <a
                      key={`${selectedBrief.id}-src-${idx}`}
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "#7dd3fc" }}
                    >
                      {s.title} • {s.source} • {new Date(s.publishedAt).toLocaleString()}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

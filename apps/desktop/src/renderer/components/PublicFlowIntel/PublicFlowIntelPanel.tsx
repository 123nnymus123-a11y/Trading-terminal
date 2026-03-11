import React, { useEffect, useMemo } from "react";
import { DisclosureList } from "./DisclosureList";
import { ThemeList } from "./ThemeList";
import { CandidateList } from "./CandidateList";
import { usePublicFlowIntelStore } from "../../store/publicFlowIntelStore";

function formatTimestamp(ts: number | null): string {
  if (!ts) return "not yet refreshed";
  return new Date(ts).toLocaleTimeString();
}

export function PublicFlowIntelPanel() {
  const {
    recent,
    themes,
    selectedWindow,
    setWindow,
    selectedThemeId,
    selectTheme,
    candidatesByTheme,
    candidatesLoading,
    valuations,
    filters,
    setFilters,
    loadInitial,
    refresh,
    loading,
    error,
    lastUpdatedTs,
  } = usePublicFlowIntelStore();

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    if (!selectedThemeId && themes[selectedWindow]?.length) {
      selectTheme(themes[selectedWindow][0].id);
    }
  }, [selectedThemeId, selectedWindow, themes, selectTheme]);

  const filteredRecent = useMemo(
    () => (filters.action === "buy-only" ? recent.filter((e) => e.action === "BUY") : recent),
    [recent, filters.action]
  );

  const candidates = selectedThemeId ? candidatesByTheme[selectedThemeId] ?? [] : [];

  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 12,
        padding: 16,
        background: "linear-gradient(180deg, rgba(17,24,39,0.9), rgba(15,23,42,0.85))",
        marginTop: 16,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>Public Flow Intel</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Delayed disclosures → sector themes → second-order ideas</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={refresh}
            disabled={loading}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.16)",
              background: loading ? "rgba(255,255,255,0.06)" : "linear-gradient(90deg, #10b981, #22d3ee)",
              color: loading ? "#a8a8a8" : "#0b1020",
              cursor: loading ? "default" : "pointer",
              fontWeight: 800,
            }}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Last updated: {formatTimestamp(lastUpdatedTs)}</div>
        </div>
      </div>

      <div
        style={{
          padding: 12,
          borderRadius: 10,
          background: "rgba(251,191,36,0.08)",
          border: "1px solid rgba(251,191,36,0.3)",
          marginBottom: 12,
          fontSize: 12,
          lineHeight: 1.5,
        }}
      >
        <b>Disclaimer:</b> Public disclosures are delayed and may be incomplete. Research/watchlist only.
      </div>

      {error && (
        <div style={{
          padding: 10,
          borderRadius: 8,
          background: "rgba(248,113,113,0.1)",
          border: "1px solid rgba(248,113,113,0.4)",
          color: "#fecdd3",
          marginBottom: 12,
        }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 12, opacity: 0.75 }}>Actions:</span>
          {["buy-only", "all"].map((v) => (
            <button
              key={v}
              onClick={() => setFilters({ action: v as typeof filters.action })}
              style={{
                padding: "6px 10px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.14)",
                background: filters.action === v ? "linear-gradient(90deg, #22d3ee, #10b981)" : "rgba(255,255,255,0.06)",
                color: filters.action === v ? "#0b1020" : "#e2e8f0",
                cursor: "pointer",
                fontWeight: 700,
              }}
            >
              {v === "buy-only" ? "BUY only" : "BUY + SELL"}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 12, opacity: 0.75 }}>Valuation:</span>
          <select
            value={filters.valuation}
            onChange={(e) => setFilters({ valuation: e.target.value as typeof filters.valuation })}
            style={{
              padding: "6px 10px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(255,255,255,0.04)",
              color: "#e2e8f0",
            }}
          >
            <option value="all">All</option>
            <option value="undervalued">Undervalued</option>
            <option value="fair">Fair</option>
            <option value="overvalued">Overvalued</option>
          </select>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 1fr) minmax(380px, 1fr)", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <ThemeList
            themes={themes[selectedWindow] ?? []}
            selectedWindow={selectedWindow}
            onWindowChange={setWindow}
            selectedThemeId={selectedThemeId}
            onSelect={(id) => selectTheme(id)}
            loading={loading}
          />

          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ fontWeight: 700 }}>Second-order candidates</div>
              <div style={{ fontSize: 11, opacity: 0.6 }}>Theme ID: {selectedThemeId ?? "none"}</div>
            </div>
            <CandidateList
              candidates={candidates}
              valuations={valuations}
              valuationFilter={filters.valuation}
              loading={candidatesLoading || loading}
            />
          </div>
        </div>

        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <div style={{ fontWeight: 700 }}>Recent disclosures</div>
            <div style={{ fontSize: 11, opacity: 0.7 }}>Showing {filteredRecent.length} of {recent.length}</div>
          </div>
          <DisclosureList
            events={filteredRecent}
            valuations={valuations}
            loading={loading}
            emptyHint="If empty, switch to BUY+SELL or click Refresh."
          />
        </div>
      </div>
    </div>
  );
}

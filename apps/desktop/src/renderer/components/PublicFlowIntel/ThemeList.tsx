import React from "react";
import type { SectorTheme } from "@tc/shared";

type Props = {
  themes: SectorTheme[];
  selectedWindow: 7 | 30;
  onWindowChange: (windowDays: 7 | 30) => void;
  selectedThemeId: number | null;
  onSelect: (themeId: number) => void;
  loading?: boolean;
};

const badgeStyle: React.CSSProperties = {
  fontSize: 11,
  padding: "4px 8px",
  borderRadius: 10,
  background: "rgba(255,255,255,0.08)",
  color: "#e2e8f0",
};

export function ThemeList({ themes, selectedWindow, onWindowChange, selectedThemeId, onSelect, loading }: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 8 }}>
          {[7, 30].map((w) => (
            <button
              key={w}
              onClick={() => onWindowChange(w as 7 | 30)}
              style={{
                padding: "6px 10px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.14)",
                background: selectedWindow === w ? "linear-gradient(90deg, #0ea5e9, #22d3ee)" : "rgba(255,255,255,0.04)",
                color: selectedWindow === w ? "#0b1020" : "#e2e8f0",
                cursor: "pointer",
                fontWeight: 700,
              }}
            >
              {w}d themes
            </button>
          ))}
        </div>
        <div style={{ ...badgeStyle, opacity: 0.8 }}>{themes.length} sectors</div>
      </div>

      {loading && <div style={{ opacity: 0.8 }}>Loading themes…</div>}

      {!loading && !themes.length && (
        <div style={{
          padding: 12,
          border: "1px dashed rgba(255,255,255,0.18)",
          borderRadius: 10,
          background: "rgba(255,255,255,0.04)",
          color: "#cbd5e1",
          fontSize: 13,
        }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>No sector themes found</div>
          <div style={{ opacity: 0.75 }}>Refresh or import more disclosure data to recompute themes.</div>
        </div>
      )}

      {!loading && themes.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {themes.map((theme) => {
            const active = selectedThemeId === theme.id;
            return (
              <div
                key={theme.id}
                onClick={() => onSelect(theme.id)}
                style={{
                  border: active ? "1px solid #22d3ee" : "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 10,
                  padding: 10,
                  background: active
                    ? "linear-gradient(135deg, rgba(14,165,233,0.12), rgba(34,211,238,0.08))"
                    : "rgba(255,255,255,0.03)",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{theme.sector}</div>
                  <div style={{ ...badgeStyle, background: "rgba(34,211,238,0.12)", color: "#22d3ee" }}>Score {theme.score}</div>
                </div>
                <div style={{ fontSize: 12, opacity: 0.82 }}>{theme.summary}</div>
                <div style={{ fontSize: 11, opacity: 0.65, marginTop: 6 }}>
                  Window: {new Date(theme.window_start).toLocaleDateString()} → {new Date(theme.window_end).toLocaleDateString()}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

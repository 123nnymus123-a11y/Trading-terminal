import React from "react";
import type { UiProfile, Colorway } from "../store/themeStore";
import { useThemeStore } from "../store/themeStore";

const UI_PROFILES: Array<{ id: UiProfile; label: string; hint: string }> = [
  { id: "terminal", label: "Terminal", hint: "Pure data" },
  { id: "friendly", label: "Friendly", hint: "Emoji guide" },
  { id: "sleek", label: "Sleek", hint: "Hybrid" },
  { id: "bloomberg", label: "Bloomberg", hint: "Classic terminal" },
];

const COLORWAYS: Array<{ id: Colorway; label: string; swatch: string }> = [
  { id: "signal", label: "Signal Blue", swatch: "linear-gradient(135deg,#4f79d3,#22a6f0)" },
  { id: "amber", label: "Amber Pulse", swatch: "linear-gradient(135deg,#f5c451,#f08e3c)" },
  { id: "aqua", label: "Aqua Circuit", swatch: "linear-gradient(135deg,#2ed1c3,#2eaadc)" },
  { id: "violet", label: "Violet Surge", swatch: "linear-gradient(135deg,#a855f7,#6366f1)" },
];

export function ThemeControls() {
  const { uiProfile, colorway, setUiProfile, setColorway } = useThemeStore((s) => ({
    uiProfile: s.uiProfile,
    colorway: s.colorway,
    setUiProfile: s.setUiProfile,
    setColorway: s.setColorway,
  }));

  return (
    <div className="themeControls">
      <div className="themeSection">
        <div className="themeLabel">Interface</div>
        <div className="themeChips">
          {UI_PROFILES.map((profile) => {
            const active = profile.id === uiProfile;
            return (
              <button
                key={profile.id}
                type="button"
                className={`themeChip ${active ? "active" : ""}`}
                onClick={() => setUiProfile(profile.id)}
              >
                <span className="themeChipTitle">{profile.label}</span>
                <span className="themeChipHint">{profile.hint}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="themeSection">
        <div className="themeLabel">Colorway</div>
        <div className="colorwaySwatches">
          {COLORWAYS.map((c) => {
            const active = c.id === colorway;
            return (
              <button
                key={c.id}
                type="button"
                className={`colorwaySwatch ${active ? "active" : ""}`}
                style={{ background: c.swatch }}
                onClick={() => setColorway(c.id)}
                aria-label={`Use ${c.label}`}
              >
                <span className="colorwayName">{c.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

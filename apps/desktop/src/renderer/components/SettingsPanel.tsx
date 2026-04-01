/**
 * Strategy Settings Panel Component
 * Configure global settings for strategy research workspace
 */

import React, { useState } from "react";

export type Settings = {
  theme: "dark" | "light";
  autoSave: boolean;
  autoSaveInterval: number;
  showMetrics: "compact" | "detailed" | "advanced";
  defaultUniverse: "all-us-stocks" | "sp500" | "custom";
  defaultDataSource: "stooq" | "twelve-data" | "local-cache";
  decimalPlaces: number;
  timeFormat: "24h" | "12h";
  notifyOnCompletion: boolean;
  soundNotifications: boolean;
  advancedMode: boolean;
};

export type SettingsPanelProps = {
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  onReset?: () => void;
  onExport?: () => void;
};

export function SettingsPanel({
  settings,
  onSettingsChange,
  onReset,
  onExport,
}: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<"general" | "display" | "notifications" | "advanced">("general");

  const updateSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    onSettingsChange({ ...settings, [key]: value });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: 14,
            fontWeight: 600,
            color: "#ccc",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Settings
        </h3>
        <div style={{ display: "flex", gap: 6 }}>
          {onExport && (
            <button
              onClick={onExport}
              style={{
                padding: "6px 10px",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 4,
                color: "white",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Export
            </button>
          )}
          {onReset && (
            <button
              onClick={onReset}
              style={{
                padding: "6px 10px",
                background: "rgba(239, 68, 68, 0.1)",
                border: "1px solid #ef4444",
                borderRadius: 4,
                color: "#ef4444",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
        {(["general", "display", "notifications", "advanced"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "8px 12px",
              background: activeTab === tab ? "rgba(110, 168, 254, 0.1)" : "transparent",
              border: "none",
              borderBottom: activeTab === tab ? "2px solid #6ea8fe" : "none",
              color: activeTab === tab ? "#6ea8fe" : "#888",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.2s ease",
              textTransform: "capitalize",
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* General Settings */}
      {activeTab === "general" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <SettingGroup title="Auto-Save">
            <CheckboxSetting
              label="Enable Auto-Save"
              checked={settings.autoSave}
              onChange={(value) => updateSetting("autoSave", value)}
            />
            {settings.autoSave && (
              <SelectSetting
                label="Auto-Save Interval (seconds)"
                value={settings.autoSaveInterval}
                options={[10, 30, 60, 120]}
                onChange={(value) => updateSetting("autoSaveInterval", value)}
              />
            )}
          </SettingGroup>

          <SettingGroup title="Defaults">
            <SelectSetting
              label="Default Universe"
              value={settings.defaultUniverse}
              options={["all-us-stocks", "sp500", "custom"]}
              formatLabel={(v) =>
                v === "all-us-stocks"
                  ? "All US Stocks"
                  : v === "sp500"
                    ? "S&P 500"
                    : "Custom"
              }
              onChange={(value) => updateSetting("defaultUniverse", value)}
            />
            <SelectSetting
              label="Default Data Source"
              value={settings.defaultDataSource}
              options={["stooq", "twelve-data", "local-cache"]}
              formatLabel={(v) =>
                v === "stooq"
                  ? "Stooq (Free)"
                  : v === "twelve-data"
                    ? "Twelve Data"
                    : "Local Cache"
              }
              onChange={(value) => updateSetting("defaultDataSource", value)}
            />
          </SettingGroup>
        </div>
      )}

      {/* Display Settings */}
      {activeTab === "display" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <SettingGroup title="Appearance">
            <SelectSetting
              label="Theme"
              value={settings.theme}
              options={["dark", "light"]}
              formatLabel={(v) => v.charAt(0).toUpperCase() + v.slice(1)}
              onChange={(value) => updateSetting("theme", value)}
            />
          </SettingGroup>

          <SettingGroup title="Metrics Display">
            <SelectSetting
              label="Metrics Detail Level"
              value={settings.showMetrics}
              options={["compact", "detailed", "advanced"]}
              formatLabel={(v) => v.charAt(0).toUpperCase() + v.slice(1)}
              onChange={(value) => updateSetting("showMetrics", value)}
            />
          </SettingGroup>

          <SettingGroup title="Format">
            <SelectSetting
              label="Decimal Places"
              value={settings.decimalPlaces}
              options={[2, 3, 4, 6]}
              onChange={(value) => updateSetting("decimalPlaces", value)}
            />
            <SelectSetting
              label="Time Format"
              value={settings.timeFormat}
              options={["24h", "12h"]}
              formatLabel={(v) => (v === "24h" ? "24-Hour" : "12-Hour")}
              onChange={(value) => updateSetting("timeFormat", value)}
            />
          </SettingGroup>
        </div>
      )}

      {/* Notifications Settings */}
      {activeTab === "notifications" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <SettingGroup title="Alerts">
            <CheckboxSetting
              label="Notify When Backtest Completes"
              checked={settings.notifyOnCompletion}
              onChange={(value) => updateSetting("notifyOnCompletion", value)}
            />
            <CheckboxSetting
              label="Sound Notifications"
              checked={settings.soundNotifications}
              onChange={(value) => updateSetting("soundNotifications", value)}
            />
          </SettingGroup>

          <div
            style={{
              padding: 12,
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 4,
              fontSize: 11,
              color: "#888",
              lineHeight: "1.5",
            }}
          >
            Notifications help you stay informed about backtest completion, errors, and important events.
          </div>
        </div>
      )}

      {/* Advanced Settings */}
      {activeTab === "advanced" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <SettingGroup title="Advanced Features">
            <CheckboxSetting
              label="Enable Advanced Mode"
              checked={settings.advancedMode}
              onChange={(value) => updateSetting("advancedMode", value)}
            />
            <div
              style={{
                padding: 8,
                background: settings.advancedMode ? "rgba(16, 185, 129, 0.1)" : "rgba(255,255,255,0.05)",
                border: settings.advancedMode ? "1px solid #10b981" : "1px solid rgba(255,255,255,0.1)",
                borderRadius: 3,
                fontSize: 10,
                color: settings.advancedMode ? "#10b981" : "#888",
              }}
            >
              {settings.advancedMode
                ? "✓ Advanced metrics, multi-universe analysis, and custom cost models enabled"
                : "Advanced mode provides access to additional analysis tools and metrics"}
            </div>
          </SettingGroup>

          <SettingGroup title="Developer Options">
            <div
              style={{
                padding: 10,
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 4,
              }}
            >
              <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>
                Debug Information:
              </div>
              <div style={{ fontSize: 10, fontFamily: "monospace", color: "#666", lineHeight: "1.4" }}>
                <div>Theme: {settings.theme}</div>
                <div>Version: 1.0.0-beta</div>
                <div>Platform: {typeof navigator !== "undefined" ? navigator.platform : "unknown"}</div>
              </div>
            </div>
          </SettingGroup>
        </div>
      )}
    </div>
  );
}

function SettingGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <h4
        style={{
          margin: 0,
          fontSize: 11,
          fontWeight: 600,
          color: "#888",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {title}
      </h4>
      {children}
    </div>
  );
}

function CheckboxSetting({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        cursor: "pointer",
        padding: "6px 0",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{
          width: 16,
          height: 16,
          cursor: "pointer",
          accentColor: "#6ea8fe",
        }}
      />
      <span style={{ fontSize: 12, color: "#ccc" }}>{label}</span>
    </label>
  );
}

function SelectSetting({
  label,
  value,
  options,
  formatLabel,
  onChange,
}: {
  label: string;
  value: any;
  options: any[];
  formatLabel?: (v: any) => string;
  onChange: (value: any) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "#888",
        }}
      >
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: "6px 8px",
          background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 4,
          color: "white",
          fontSize: 12,
        }}
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {formatLabel ? formatLabel(opt) : opt}
          </option>
        ))}
      </select>
    </div>
  );
}

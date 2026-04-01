/**
 * Strategy Studio Panel Component
 * Provides code editor, universe selection, and assumptions configuration
 */

import React, { useState } from "react";

export type UniverseSettings = {
  universe: "all-us-stocks" | "sp500" | "custom";
  customList?: string;
  dataSource: "stooq" | "twelve-data" | "local-cache";
};

export type AssumptionSet = {
  commissionPercentage: number;
  slippagePercentage: number;
  dateRangeStart: string;
  dateRangeEnd: string;
  initialCapital: number;
  riskPerTrade?: number;
};

export type StudioPanelProps = {
  strategyCode: string;
  onCodeChange: (code: string) => void;
  strategyName?: string;
  universe?: UniverseSettings;
  onUniverseChange?: (universe: UniverseSettings) => void;
  assumptions?: AssumptionSet;
  onAssumptionsChange?: (assumptions: AssumptionSet) => void;
  onSave?: () => void;
  isDirty?: boolean;
  isSaving?: boolean;
};

export function StudioPanel({
  strategyCode,
  onCodeChange,
  strategyName,
  universe,
  onUniverseChange,
  assumptions,
  onAssumptionsChange,
  onSave,
  isDirty,
  isSaving,
}: StudioPanelProps) {
  const [editorHeight, setEditorHeight] = useState(400);
  const [showAssumptions, setShowAssumptions] = useState(false);

  const handleCodeChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onCodeChange(e.target.value);
  };

  const handleUniverseChange = (type: UniverseSettings["universe"]) => {
    if (onUniverseChange && universe) {
      onUniverseChange({ ...universe, universe: type });
    }
  };

  const handleAssumptionChange = <K extends keyof AssumptionSet>(
    key: K,
    value: AssumptionSet[K]
  ) => {
    if (onAssumptionsChange && assumptions) {
      onAssumptionsChange({ ...assumptions, [key]: value });
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Header with Save Button */}
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
          Strategy Studio
        </h3>
        {onSave && (
          <button
            onClick={onSave}
            disabled={!isDirty || isSaving}
            style={{
              padding: "6px 12px",
              background: isDirty ? "#10b981" : "#4b5563",
              color: "white",
              border: "none",
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 600,
              cursor: isDirty ? "pointer" : "default",
              opacity: isDirty ? 1 : 0.6,
            }}
          >
            {isSaving ? "Saving..." : isDirty ? "Save Strategy" : "Saved"}
          </button>
        )}
      </div>

      {/* Universe & Assumptions Tabs */}
      <div style={{ display: "flex", gap: 8, borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
        <button
          onClick={() => setShowAssumptions(false)}
          style={{
            padding: "8px 12px",
            background: !showAssumptions ? "rgba(110, 168, 254, 0.1)" : "transparent",
            border: "none",
            borderBottom: !showAssumptions ? "2px solid #6ea8fe" : "none",
            color: "#ccc",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Universe
        </button>
        <button
          onClick={() => setShowAssumptions(true)}
          style={{
            padding: "8px 12px",
            background: showAssumptions ? "rgba(110, 168, 254, 0.1)" : "transparent",
            border: "none",
            borderBottom: showAssumptions ? "2px solid #6ea8fe" : "none",
            color: "#ccc",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Assumptions
        </button>
      </div>

      {/* Universe Settings Panel */}
      {!showAssumptions && universe && onUniverseChange && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <label
              style={{
                display: "block",
                fontSize: 11,
                fontWeight: 600,
                color: "#888",
                marginBottom: 6,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Universe Type
            </label>
            <div style={{ display: "flex", gap: 6 }}>
              {(["all-us-stocks", "sp500", "custom"] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => handleUniverseChange(type)}
                  style={{
                    flex: 1,
                    padding: "6px 8px",
                    background:
                      universe.universe === type
                        ? "#6ea8fe"
                        : "rgba(255,255,255,0.05)",
                    border:
                      universe.universe === type
                        ? "none"
                        : "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 4,
                    color: "white",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {type === "all-us-stocks"
                    ? "All US"
                    : type === "sp500"
                      ? "S&P 500"
                      : "Custom"}
                </button>
              ))}
            </div>
          </div>

          {universe.universe === "custom" && (
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#888",
                  marginBottom: 6,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Symbol List
              </label>
              <textarea
                value={universe.customList || ""}
                onChange={(e) =>
                  onUniverseChange({ ...universe, customList: e.target.value })
                }
                placeholder="AAPL, MSFT, GOOGL (comma separated)"
                style={{
                  width: "100%",
                  height: 60,
                  padding: 8,
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 4,
                  color: "white",
                  fontSize: 12,
                  fontFamily: "monospace",
                }}
              />
            </div>
          )}

          <div>
            <label
              style={{
                display: "block",
                fontSize: 11,
                fontWeight: 600,
                color: "#888",
                marginBottom: 6,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Data Source
            </label>
            <select
              value={universe.dataSource}
              onChange={(e) =>
                onUniverseChange({
                  ...universe,
                  dataSource: e.target.value as any,
                })
              }
              style={{
                width: "100%",
                padding: "6px",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 4,
                color: "white",
                fontSize: 12,
              }}
            >
              <option value="stooq">Stooq (Free, Daily)</option>
              <option value="twelve-data">Twelve Data (Intraday)</option>
              <option value="local-cache">Local Cache</option>
            </select>
          </div>
        </div>
      )}

      {/* Assumptions Settings Panel */}
      {showAssumptions && assumptions && onAssumptionsChange && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#888",
                  marginBottom: 4,
                  textTransform: "uppercase",
                }}
              >
                Commission %
              </label>
              <input
                type="number"
                step="0.01"
                value={assumptions.commissionPercentage}
                onChange={(e) =>
                  handleAssumptionChange(
                    "commissionPercentage",
                    parseFloat(e.target.value)
                  )
                }
                style={{
                  width: "100%",
                  padding: 6,
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 4,
                  color: "white",
                  fontSize: 12,
                }}
              />
            </div>

            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#888",
                  marginBottom: 4,
                  textTransform: "uppercase",
                }}
              >
                Slippage %
              </label>
              <input
                type="number"
                step="0.01"
                value={assumptions.slippagePercentage}
                onChange={(e) =>
                  handleAssumptionChange(
                    "slippagePercentage",
                    parseFloat(e.target.value)
                  )
                }
                style={{
                  width: "100%",
                  padding: 6,
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 4,
                  color: "white",
                  fontSize: 12,
                }}
              />
            </div>

            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#888",
                  marginBottom: 4,
                  textTransform: "uppercase",
                }}
              >
                Start Date
              </label>
              <input
                type="date"
                value={assumptions.dateRangeStart}
                onChange={(e) =>
                  handleAssumptionChange("dateRangeStart", e.target.value)
                }
                style={{
                  width: "100%",
                  padding: 6,
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 4,
                  color: "white",
                  fontSize: 12,
                }}
              />
            </div>

            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#888",
                  marginBottom: 4,
                  textTransform: "uppercase",
                }}
              >
                End Date
              </label>
              <input
                type="date"
                value={assumptions.dateRangeEnd}
                onChange={(e) =>
                  handleAssumptionChange("dateRangeEnd", e.target.value)
                }
                style={{
                  width: "100%",
                  padding: 6,
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 4,
                  color: "white",
                  fontSize: 12,
                }}
              />
            </div>

            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#888",
                  marginBottom: 4,
                  textTransform: "uppercase",
                }}
              >
                Initial Capital
              </label>
              <input
                type="number"
                step="1000"
                value={assumptions.initialCapital}
                onChange={(e) =>
                  handleAssumptionChange(
                    "initialCapital",
                    parseFloat(e.target.value)
                  )
                }
                style={{
                  width: "100%",
                  padding: 6,
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 4,
                  color: "white",
                  fontSize: 12,
                }}
              />
            </div>

            {assumptions.riskPerTrade !== undefined && (
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#888",
                    marginBottom: 4,
                    textTransform: "uppercase",
                  }}
                >
                  Risk Per Trade %
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={assumptions.riskPerTrade}
                  onChange={(e) =>
                    handleAssumptionChange(
                      "riskPerTrade",
                      parseFloat(e.target.value)
                    )
                  }
                  style={{
                    width: "100%",
                    padding: 6,
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 4,
                    color: "white",
                    fontSize: 12,
                  }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Code Editor */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "#888",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Strategy Code
        </label>
        <textarea
          value={strategyCode}
          onChange={handleCodeChange}
          placeholder="Enter your strategy code in Python or JavaScript..."
          spellCheck="false"
          style={{
            height: editorHeight,
            padding: 12,
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 4,
            color: "#ccc",
            fontFamily: 'Monaco, "Courier New", monospace',
            fontSize: 12,
            lineHeight: "1.4",
            resize: "vertical",
          }}
        />
        <div style={{ fontSize: 10, color: "#666" }}>
          {strategyCode.length} characters
        </div>
      </div>
    </div>
  );
}

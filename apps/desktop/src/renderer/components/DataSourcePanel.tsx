/**
 * Strategy Data Source Panel Component
 * Manage data sources, historical data cache, and data validation
 */

import React, { useState } from "react";

export type DataSource = {
  id: string;
  name: string;
  type: "csv-upload" | "api" | "database" | "cache";
  status: "connected" | "error" | "syncing" | "idle";
  lastSync?: string;
  recordCount?: number;
  dateRange?: { start: string; end: string };
};

export type DataSourcePanelProps = {
  dataSources: DataSource[];
  onAddDataSource?: () => void;
  onSyncDataSource?: (sourceId: string) => void;
  onRemoveDataSource?: (sourceId: string) => void;
  onValidateData?: () => void;
  syncProgress?: number;
  validationResult?: {
    status: "pass" | "warning" | "error";
    issues: string[];
  };
};

export function DataSourcePanel({
  dataSources,
  onAddDataSource,
  onSyncDataSource,
  onRemoveDataSource,
  onValidateData,
  syncProgress,
  validationResult,
}: DataSourcePanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const getStatusIcon = (status: string): string => {
    switch (status) {
      case "connected":
        return "✓";
      case "error":
        return "✗";
      case "syncing":
        return "↻";
      case "idle":
        return "○";
      default:
        return "?";
    }
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case "connected":
        return "#10b981";
      case "error":
        return "#ef4444";
      case "syncing":
        return "#f59e0b";
      case "idle":
        return "#888";
      default:
        return "#888";
    }
  };

  const getSourceTypeLabel = (type: string): string => {
    switch (type) {
      case "csv-upload":
        return "📄 CSV Upload";
      case "api":
        return "🔗 API";
      case "database":
        return "🗄️ Database";
      case "cache":
        return "💾 Cache";
      default:
        return type;
    }
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
          Data Sources
        </h3>
        {onAddDataSource && (
          <button
            onClick={onAddDataSource}
            style={{
              padding: "6px 12px",
              background: "#6ea8fe",
              color: "white",
              border: "none",
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            + Add Source
          </button>
        )}
      </div>

      {/* Data Sources List */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          maxHeight: 400,
          overflow: "auto",
        }}
      >
        {dataSources.length === 0 ? (
          <div
            style={{
              padding: 20,
              textAlign: "center",
              color: "#666",
              fontSize: 12,
            }}
          >
            No data sources configured
          </div>
        ) : (
          dataSources.map((source) => (
            <div key={source.id} style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4 }}>
              <button
                onClick={() =>
                  setExpandedId(expandedId === source.id ? null : source.id)
                }
                style={{
                  width: "100%",
                  padding: 12,
                  background:
                    expandedId === source.id
                      ? "rgba(255,255,255,0.08)"
                      : "rgba(255,255,255,0.05)",
                  border: "none",
                  borderRadius: 4,
                  color: "white",
                  textAlign: "left",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                }}
              >
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: getStatusColor(source.status),
                    }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>
                      {source.name}
                    </div>
                    <div style={{ fontSize: 11, color: "#888" }}>
                      {getSourceTypeLabel(source.type)}
                      {source.recordCount && (
                        <span> • {source.recordCount.toLocaleString()} records</span>
                      )}
                    </div>
                  </div>
                  <div
                    style={{
                      textAlign: "right",
                      fontSize: 11,
                      color: "#888",
                    }}
                  >
                    {source.lastSync && (
                      <div>Synced: {new Date(source.lastSync).toLocaleDateString()}</div>
                    )}
                  </div>
                </div>
              </button>

              {/* Expanded Details */}
              {expandedId === source.id && (
                <div style={{ padding: "0 12px 12px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
                  <div
                    style={{
                      paddingTop: 12,
                      borderTop: "1px solid rgba(255,255,255,0.1)",
                    }}
                  >
                    {/* Status */}
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#888", marginBottom: 4 }}>
                        Status
                      </div>
                      <div
                        style={{
                          padding: "6px 10px",
                          background: `${getStatusColor(source.status)}20`,
                          border: `1px solid ${getStatusColor(source.status)}40`,
                          borderRadius: 3,
                          fontSize: 11,
                          color: getStatusColor(source.status),
                          fontWeight: 600,
                        }}
                      >
                        {source.status.toUpperCase()}
                      </div>
                    </div>

                    {/* Date Range */}
                    {source.dateRange && (
                      <div style={{ marginBottom: 10, fontSize: 11 }}>
                        <div style={{ fontWeight: 600, color: "#888", marginBottom: 4 }}>
                          Date Range
                        </div>
                        <div style={{ color: "#ccc" }}>
                          {source.dateRange.start} to {source.dateRange.end}
                        </div>
                      </div>
                    )}

                    {/* Record Count */}
                    {source.recordCount && (
                      <div style={{ marginBottom: 10, fontSize: 11 }}>
                        <div style={{ fontWeight: 600, color: "#888", marginBottom: 4 }}>
                          Records
                        </div>
                        <div style={{ color: "#ccc" }}>
                          {source.recordCount.toLocaleString()} rows
                        </div>
                      </div>
                    )}

                    {/* Last Sync */}
                    {source.lastSync && (
                      <div style={{ marginBottom: 10, fontSize: 11 }}>
                        <div style={{ fontWeight: 600, color: "#888", marginBottom: 4 }}>
                          Last Synchronized
                        </div>
                        <div style={{ color: "#ccc" }}>
                          {new Date(source.lastSync).toLocaleString()}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Sync Progress */}
                  {source.status === "syncing" && syncProgress !== undefined && (
                    <div>
                      <div style={{ fontSize: 10, color: "#888", marginBottom: 4 }}>
                        Syncing: {syncProgress}%
                      </div>
                      <div
                        style={{
                          height: 4,
                          background: "rgba(255,255,255,0.1)",
                          borderRadius: 2,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${syncProgress}%`,
                            background: "#f59e0b",
                            transition: "width 0.3s ease",
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div style={{ display: "flex", gap: 6 }}>
                    {onSyncDataSource && (
                      <button
                        onClick={() => onSyncDataSource(source.id)}
                        disabled={source.status === "syncing"}
                        style={{
                          flex: 1,
                          padding: "6px 10px",
                          background: source.status === "syncing" ? "#4b5563" : "rgba(245, 158, 11, 0.1)",
                          border: `1px solid ${source.status === "syncing" ? "rgba(255,255,255,0.1)" : "#f59e0b"}`,
                          borderRadius: 3,
                          color: source.status === "syncing" ? "#888" : "#f59e0b",
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: source.status === "syncing" ? "default" : "pointer",
                        }}
                      >
                        {source.status === "syncing" ? "Syncing..." : "Sync Now"}
                      </button>
                    )}
                    {onRemoveDataSource && (
                      <button
                        onClick={() => onRemoveDataSource(source.id)}
                        style={{
                          flex: 1,
                          padding: "6px 10px",
                          background: "rgba(239, 68, 68, 0.1)",
                          border: "1px solid #ef4444",
                          borderRadius: 3,
                          color: "#ef4444",
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Validation Section */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <label
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#888",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Data Validation
          </label>
          {onValidateData && (
            <button
              onClick={onValidateData}
              style={{
                padding: "4px 10px",
                background: "rgba(255,255,255,0.1)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 3,
                color: "white",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Validate
            </button>
          )}
        </div>

        {validationResult && (
          <div
            style={{
              padding: 10,
              background:
                validationResult.status === "pass"
                  ? "rgba(16, 185, 129, 0.1)"
                  : validationResult.status === "warning"
                    ? "rgba(245, 158, 11, 0.1)"
                    : "rgba(239, 68, 68, 0.1)",
              border:
                validationResult.status === "pass"
                  ? "1px solid #10b981"
                  : validationResult.status === "warning"
                    ? "1px solid #f59e0b"
                    : "1px solid #ef4444",
              borderRadius: 4,
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                marginBottom: 6,
                color:
                  validationResult.status === "pass"
                    ? "#10b981"
                    : validationResult.status === "warning"
                      ? "#f59e0b"
                      : "#ef4444",
              }}
            >
              {validationResult.status === "pass"
                ? "✓ Data Valid"
                : validationResult.status === "warning"
                  ? "⚠ Warnings Found"
                  : "✗ Errors Found"}
            </div>
            {validationResult.issues.length > 0 && (
              <ul
                style={{
                  margin: 0,
                  paddingLeft: 18,
                  fontSize: 10,
                  color:
                    validationResult.status === "pass"
                      ? "#10b981"
                      : validationResult.status === "warning"
                        ? "#f5a623"
                        : "#ef4444",
                }}
              >
                {validationResult.issues.map((issue, idx) => (
                  <li key={idx}>{issue}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

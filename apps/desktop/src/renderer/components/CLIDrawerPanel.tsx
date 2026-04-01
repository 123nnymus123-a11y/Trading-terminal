/**
 * CLI Drawer Panel Component
 * Command-line interface for running queries and displaying execution logs
 */

import React, { useState, useRef, useEffect } from "react";

export type LogEntry = {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug" | "success";
  message: string;
  source?: string;
};

export type CLIDrawerPanelProps = {
  logs: LogEntry[];
  onCommand?: (command: string) => void;
  isExecuting?: boolean;
  onClearLogs?: () => void;
};

export function CLIDrawerPanel({
  logs,
  onCommand,
  isExecuting,
  onClearLogs,
}: CLIDrawerPanelProps) {
  const [commandInput, setCommandInput] = useState("");
  const [filterLevel, setFilterLevel] = useState<"all" | LogEntry["level"]>("all");
  const logsEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const handleCommandSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (commandInput.trim() && onCommand) {
      onCommand(commandInput.trim());
      setCommandInput("");
    }
  };

  const filtered = filterLevel === "all" 
    ? logs 
    : logs.filter((log) => log.level === filterLevel);

  const getLevelColor = (level: LogEntry["level"]): string => {
    switch (level) {
      case "info":
        return "#6ea8fe";
      case "warn":
        return "#f59e0b";
      case "error":
        return "#ef4444";
      case "debug":
        return "#888";
      case "success":
        return "#10b981";
      default:
        return "#ccc";
    }
  };

  const getLevelIcon = (level: LogEntry["level"]): string => {
    switch (level) {
      case "info":
        return "ℹ";
      case "warn":
        return "⚠";
      case "error":
        return "✗";
      case "debug":
        return "◆";
      case "success":
        return "✓";
      default:
        return "-";
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        gap: 8,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          paddingBottom: 8,
          borderBottom: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: 12,
            fontWeight: 600,
            color: "#ccc",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Command Line
        </h3>
        <div style={{ display: "flex", gap: 6 }}>
          <select
            value={filterLevel}
            onChange={(e) => setFilterLevel(e.target.value as any)}
            style={{
              padding: "4px 8px",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 3,
              color: "white",
              fontSize: 10,
            }}
          >
            <option value="all">All Levels</option>
            <option value="info">Info</option>
            <option value="warn">Warnings</option>
            <option value="error">Errors</option>
            <option value="success">Success</option>
            <option value="debug">Debug</option>
          </select>
          {onClearLogs && (
            <button
              onClick={onClearLogs}
              style={{
                padding: "4px 10px",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 3,
                color: "#888",
                fontSize: 10,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Logs Display */}
      <div
        style={{
          flex: 1,
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 3,
          overflow: "auto",
          fontFamily: "Monaco, 'Courier New', monospace",
          fontSize: 11,
          padding: 10,
          lineHeight: "1.4",
        }}
      >
        {filtered.length === 0 ? (
          <div style={{ color: "#666", textAlign: "center", paddingTop: 20 }}>
            {logs.length === 0 ? "No logs yet" : "No logs matching filter"}
          </div>
        ) : (
          filtered.map((log, idx) => (
            <div
              key={idx}
              style={{
                display: "flex",
                gap: 6,
                marginBottom: 4,
                color: getLevelColor(log.level),
              }}
            >
              <span
                style={{
                  flexShrink: 0,
                  width: 14,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {getLevelIcon(log.level)}
              </span>
              <span style={{ flexShrink: 0, color: "#666" }}>
                {log.timestamp}
              </span>
              {log.source && (
                <span style={{ flexShrink: 0, color: "#888", fontSize: 10 }}>
                  [{log.source}]
                </span>
              )}
              <span style={{ wordBreak: "break-all" }}>
                {log.message}
              </span>
            </div>
          ))
        )}
        <div ref={logsEndRef} />
      </div>

      {/* Command Input */}
      {onCommand && (
        <form onSubmit={handleCommandSubmit} style={{ display: "flex", gap: 6 }}>
          <span
            style={{
              color: "#6ea8fe",
              fontFamily: "monospace",
              fontSize: 11,
              display: "flex",
              alignItems: "center",
              paddingLeft: 2,
            }}
          >
            $
          </span>
          <input
            ref={inputRef}
            type="text"
            value={commandInput}
            onChange={(e) => setCommandInput(e.target.value)}
            disabled={isExecuting}
            placeholder="Enter command..."
            style={{
              flex: 1,
              padding: "6px 8px",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 3,
              color: "white",
              fontFamily: "monospace",
              fontSize: 11,
              outline: "none",
              opacity: isExecuting ? 0.6 : 1,
              cursor: isExecuting ? "not-allowed" : "text",
            }}
            onFocus={(e) => {
              e.target.style.borderColor = "rgba(110, 168, 254, 0.5)";
              e.target.style.background = "rgba(110, 168, 254, 0.05)";
            }}
            onBlur={(e) => {
              e.target.style.borderColor = "rgba(255,255,255,0.1)";
              e.target.style.background = "rgba(255,255,255,0.05)";
            }}
          />
          <button
            type="submit"
            disabled={isExecuting || !commandInput.trim()}
            style={{
              padding: "6px 12px",
              background: isExecuting || !commandInput.trim() ? "#4b5563" : "#6ea8fe",
              border: "none",
              borderRadius: 3,
              color: "white",
              fontSize: 11,
              fontWeight: 600,
              cursor: isExecuting || !commandInput.trim() ? "default" : "pointer",
              opacity: isExecuting || !commandInput.trim() ? 0.6 : 1,
            }}
          >
            {isExecuting ? "Running..." : "Execute"}
          </button>
        </form>
      )}

      {/* Help Text */}
      {logs.length === 0 && (
        <div
          style={{
            fontSize: 10,
            color: "#666",
            padding: 8,
            background: "rgba(255,255,255,0.02)",
            borderRadius: 3,
            lineHeight: "1.4",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Available Commands:</div>
          <div>• <code>validate</code> - Validate strategy code</div>
          <div>• <code>metrics</code> - Show run metrics</div>
          <div>• <code>export &lt;format&gt;</code> - Export data (csv/json/pdf)</div>
          <div>• <code>history</code> - Show recent commands</div>
          <div>• <code>help</code> - Show full help</div>
        </div>
      )}
    </div>
  );
}

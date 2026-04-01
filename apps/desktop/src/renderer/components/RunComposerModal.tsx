import React from "react";

export type RunComposerPayload = {
  strategyName: string;
  strategyVersion: string;
  executionMode: "desktop-local" | "backend";
  datasetSnapshotId?: string;
  assumptions: Record<string, unknown>;
  universe: string[];
};

export type RunComposerModalProps = {
  open: boolean;
  busy?: boolean;
  payload: RunComposerPayload | null;
  onClose: () => void;
  onConfirm: () => void;
};

function renderAssumption(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "--";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(4);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value);
}

export function RunComposerModal({
  open,
  busy,
  payload,
  onClose,
  onConfirm,
}: RunComposerModalProps) {
  if (!open || !payload) {
    return null;
  }

  const assumptionsToDisplay = [
    ["Initial Capital", payload.assumptions.initialCapital],
    ["Position Size", payload.assumptions.positionSize],
    ["Commission %", payload.assumptions.commissionPercent],
    ["Slippage (bps)", payload.assumptions.slippage],
    ["Start Date", payload.assumptions.startDate],
    ["End Date", payload.assumptions.endDate],
    ["Benchmark", payload.assumptions.benchmarkSymbol],
    ["Max Position Weight %", payload.assumptions.maxPositionWeightPct],
    ["Halt Drawdown %", payload.assumptions.haltTradingOnDrawdownPct],
  ] as const;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 999,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(860px, 100%)",
          maxHeight: "85vh",
          overflow: "auto",
          background: "#0f1524",
          border: "1px solid rgba(148,163,184,0.35)",
          borderRadius: 10,
          boxShadow: "0 24px 80px rgba(0,0,0,0.45)",
        }}
      >
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid rgba(148,163,184,0.25)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div
              style={{
                fontSize: 12,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "#93c5fd",
              }}
            >
              Run Composer
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0", marginTop: 4 }}>
              Confirm Backtest Configuration
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            style={{
              border: "none",
              background: "transparent",
              color: "#cbd5e1",
              fontSize: 20,
              cursor: busy ? "default" : "pointer",
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 10,
            }}
          >
            <InfoCard label="Strategy" value={payload.strategyName} />
            <InfoCard label="Version" value={payload.strategyVersion} />
            <InfoCard
              label="Execution"
              value={payload.executionMode === "backend" ? "Cloud Backend" : "Desktop Local"}
            />
            <InfoCard
              label="Dataset Snapshot"
              value={payload.executionMode === "backend" ? payload.datasetSnapshotId || "--" : "Local history cache"}
            />
          </div>

          <section
            style={{
              border: "1px solid rgba(148,163,184,0.2)",
              borderRadius: 8,
              padding: 12,
              background: "rgba(15,23,42,0.45)",
            }}
          >
            <div style={{ fontSize: 12, color: "#93c5fd", fontWeight: 600, marginBottom: 8 }}>
              Universe
            </div>
            <div style={{ fontSize: 12, color: "#e2e8f0", lineHeight: 1.5 }}>
              {payload.universe.length > 0 ? payload.universe.join(", ") : "No symbols selected"}
            </div>
          </section>

          <section
            style={{
              border: "1px solid rgba(148,163,184,0.2)",
              borderRadius: 8,
              padding: 12,
              background: "rgba(15,23,42,0.45)",
            }}
          >
            <div style={{ fontSize: 12, color: "#93c5fd", fontWeight: 600, marginBottom: 8 }}>
              Assumptions Snapshot
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: 8,
              }}
            >
              {assumptionsToDisplay.map(([label, value]) => (
                <div key={label} style={{ fontSize: 12 }}>
                  <div style={{ color: "#94a3b8" }}>{label}</div>
                  <div style={{ color: "#e2e8f0", marginTop: 2 }}>{renderAssumption(value)}</div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div
          style={{
            padding: "12px 16px 16px",
            borderTop: "1px solid rgba(148,163,184,0.2)",
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          <button
            onClick={onClose}
            disabled={busy}
            style={{
              padding: "9px 12px",
              background: "rgba(148,163,184,0.2)",
              border: "1px solid rgba(148,163,184,0.35)",
              borderRadius: 6,
              color: "#e2e8f0",
              fontSize: 12,
              fontWeight: 600,
              cursor: busy ? "default" : "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            style={{
              padding: "9px 12px",
              background: "rgba(34,197,94,0.2)",
              border: "1px solid rgba(34,197,94,0.5)",
              borderRadius: 6,
              color: "#86efac",
              fontSize: 12,
              fontWeight: 700,
              cursor: busy ? "default" : "pointer",
            }}
          >
            {busy ? "Queueing..." : "Confirm & Queue Backtest"}
          </button>
        </div>
      </div>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        border: "1px solid rgba(148,163,184,0.2)",
        borderRadius: 8,
        padding: 10,
        background: "rgba(15,23,42,0.45)",
      }}
    >
      <div style={{ fontSize: 11, color: "#94a3b8" }}>{label}</div>
      <div style={{ fontSize: 12, color: "#e2e8f0", marginTop: 2 }}>{value}</div>
    </div>
  );
}

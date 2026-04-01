import React from "react";
import { useStreamStore } from "../store/streamStore";

function fmtTime(ts: number | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString();
}

export default function AppHeader() {
  const preloadOk = useStreamStore((s) => s.preloadOk);
  const heartbeat = useStreamStore((s) => s.lastHeartbeat);
  const hbSeq = heartbeat?.seq ?? 0;
  const lastHbTs = heartbeat?.ts ?? null;
  const source = useStreamStore((s) => s.source);

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "10px 14px",
      borderBottom: "1px solid rgba(255,255,255,0.06)"
    }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <div style={{ fontWeight: 700 }}>Trading Terminal</div>
        <div style={{
          fontSize: 12,
          opacity: 0.9,
          padding: "4px 8px",
          borderRadius: 999,
          border: "1px solid rgba(255,255,255,0.10)"
        }}>
          Source: <b>{source}</b>
        </div>
      </div>

      <div style={{ fontSize: 12, opacity: 0.9, display: "flex", gap: 14 }}>
        <div>Preload: <b>{preloadOk ? "OK" : "MISSING"}</b></div>
        <div>HB Seq: <b>{hbSeq}</b></div>
        <div>Last HB: <b>{fmtTime(lastHbTs)}</b></div>
      </div>
    </div>
  );
}
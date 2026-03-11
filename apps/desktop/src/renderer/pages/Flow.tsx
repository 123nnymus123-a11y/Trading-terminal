import React, { useEffect, useMemo, useState } from "react";

type SecEvent = {
  source: "SEC";
  type: "FORM4" | "8K";
  cik: string;
  ticker?: string;
  filedAt: string;
  title: string;
  url: string;
};

export function Flow() {
  const [events, setEvents] = useState<SecEvent[]>([]);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    const loadEvents = async () => {
      if (!window.cockpit?.externalFeeds?.getSecEvents) return;
      const data = await window.cockpit.externalFeeds.getSecEvents({ limit: 100 });
      if (!cancelled) setEvents(data as SecEvent[]);
    };
    loadEvents();
    const timer = setInterval(loadEvents, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const filtered = useMemo(() => {
    if (!filter.trim()) return events;
    const needle = filter.trim().toUpperCase();
    return events.filter((e) => e.ticker?.toUpperCase().includes(needle));
  }, [events, filter]);

  const form4 = filtered.filter((e) => e.type === "FORM4");
  const eightK = filtered.filter((e) => e.type === "8K");

  return (
    <div className="page">
      <div className="pageTitleRow">
        <h1 className="pageTitle">FLOW</h1>
        <div className="pageSubtitle">SEC Form 4 + 8‑K event streams (Phase‑1)</div>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <input
          placeholder="Filter by ticker (e.g., AAPL)"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ padding: "8px 12px", borderRadius: 6, minWidth: 240 }}
        />
        <div style={{ fontSize: 12, opacity: 0.6 }}>Showing {filtered.length} events</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
        <div style={{ padding: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.02)" }}>
          <div style={{ fontWeight: 700, marginBottom: 12 }}>Form 4 Tape</div>
          <div style={{ display: "grid", gap: 8, maxHeight: 380, overflowY: "auto" }}>
            {form4.length === 0 && <div style={{ fontSize: 12, opacity: 0.6 }}>No Form 4 events yet.</div>}
            {form4.map((e) => (
              <a key={e.url} href={e.url} target="_blank" rel="noreferrer" style={{ textDecoration: "none", color: "inherit" }}>
                <div style={{ padding: 10, borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.2)" }}>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>{new Date(e.filedAt).toLocaleString()}</div>
                  <div style={{ fontWeight: 600, marginTop: 4 }}>{e.ticker ?? "—"}</div>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>{e.title}</div>
                </div>
              </a>
            ))}
          </div>
        </div>

        <div style={{ padding: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.02)" }}>
          <div style={{ fontWeight: 700, marginBottom: 12 }}>8‑K Cards</div>
          <div style={{ display: "grid", gap: 10, maxHeight: 380, overflowY: "auto" }}>
            {eightK.length === 0 && <div style={{ fontSize: 12, opacity: 0.6 }}>No 8‑K events yet.</div>}
            {eightK.map((e) => (
              <a key={e.url} href={e.url} target="_blank" rel="noreferrer" style={{ textDecoration: "none", color: "inherit" }}>
                <div style={{ padding: 12, borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.25)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ fontWeight: 600 }}>{e.ticker ?? "—"}</div>
                    <div style={{ fontSize: 12, opacity: 0.6 }}>{new Date(e.filedAt).toLocaleString()}</div>
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>{e.title}</div>
                </div>
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
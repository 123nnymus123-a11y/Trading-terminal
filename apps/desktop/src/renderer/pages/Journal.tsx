import React, { useEffect, useState } from "react";
import { useJournal } from "../hooks/useJournal";
import { TaggingUI } from "../components/TaggingUI";
import { TradeAnalytics } from "../components/TradeAnalytics";
import { SessionDebrief } from "../components/SessionDebrief";
import type { PaperTrade } from "../../main/persistence/repos";

export function Journal() {
  const { getTodayTrades, getClosedTrades, addTags, updateTradeMetadata, getSessionStats } = useJournal();
  const [todayTrades, setTodayTrades] = useState<PaperTrade[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<"today" | "all" | "debrief">("today");
  const [editingTradeId, setEditingTradeId] = useState<number | null>(null);
  const [editingNotes, setEditingNotes] = useState("");
  const [todayStats, setTodayStats] = useState<any>(null);
  const [historicalStats, setHistoricalStats] = useState<any>(null);

  useEffect(() => {
    loadTrades();
  }, [selectedTab]);

  const loadTrades = async () => {
    setLoading(true);
    setError(null);
    try {
      if (selectedTab === "today") {
        console.log("[Journal] Loading today's trades...");
        const trades = await getTodayTrades();
        console.log("[Journal] Loaded trades:", trades);
        setTodayTrades(trades);
      } else if (selectedTab === "all") {
        console.log("[Journal] Loading all closed trades...");
        const trades = await getClosedTrades(100);
        console.log("[Journal] Loaded trades:", trades);
        setTodayTrades(trades);
      } else if (selectedTab === "debrief") {
        console.log("[Journal] Loading session stats...");
        // Load today's stats
        const now = Date.now();
        const startOfDay = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime();
        const todayStats = await getSessionStats(startOfDay, now);
        console.log("[Journal] Today stats:", todayStats);
        setTodayStats(todayStats);

        // Load last 30 days stats for comparison
        const thirtyDaysAgo = startOfDay - 30 * 24 * 60 * 60 * 1000;
        const historicalStats = await getSessionStats(thirtyDaysAgo, now);
        console.log("[Journal] Historical stats:", historicalStats);
        setHistoricalStats(historicalStats);
      }
    } catch (err) {
      const errMsg = String(err);
      console.error("[Journal] Error loading trades:", err);
      setError(errMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleTagsSelected = async (
    tags: Array<{
      tag_type: "execution" | "setup" | "regime" | "catalyst" | "mistake";
      tag_value: string;
    }>,
  ) => {
    if (editingTradeId !== null) {
      await addTags(editingTradeId, tags);
      setEditingTradeId(null);
      await loadTrades();
    }
  };

  const handleSaveNotes = async () => {
    if (editingTradeId !== null) {
      await updateTradeMetadata(editingTradeId, { notes: editingNotes });
      setEditingTradeId(null);
      await loadTrades();
    }
  };

  return (
    <div className="page" style={{ display: "flex", flexDirection: "column", overflow: "auto" }}>
      <div className="pageTitleRow">
        <h1 className="pageTitle">JOURNAL</h1>
        <div className="pageSubtitle">Trade entries with screenshots and analysis</div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, borderBottom: "1px solid rgba(255,255,255,0.1)", paddingBottom: 12 }}>
        <button
          onClick={() => setSelectedTab("today")}
          style={{
            padding: "8px 16px",
            background: selectedTab === "today" ? "rgba(110, 168, 254, 0.2)" : "transparent",
            border: selectedTab === "today" ? "1px solid rgba(110, 168, 254, 0.4)" : "1px solid rgba(255,255,255,0.1)",
            borderRadius: 6,
            color: "white",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Today's Trades ({todayTrades.length})
        </button>
        <button
          onClick={() => setSelectedTab("all")}
          style={{
            padding: "8px 16px",
            background: selectedTab === "all" ? "rgba(110, 168, 254, 0.2)" : "transparent",
            border: selectedTab === "all" ? "1px solid rgba(110, 168, 254, 0.4)" : "1px solid rgba(255,255,255,0.1)",
            borderRadius: 6,
            color: "white",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          All Closed Trades
        </button>
        <button
          onClick={() => setSelectedTab("debrief")}
          style={{
            padding: "8px 16px",
            background: selectedTab === "debrief" ? "rgba(110, 168, 254, 0.2)" : "transparent",
            border: selectedTab === "debrief" ? "1px solid rgba(110, 168, 254, 0.4)" : "1px solid rgba(255,255,255,0.1)",
            borderRadius: 6,
            color: "white",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Session Debrief
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {error ? (
          <div style={{ padding: 20, color: "rgba(255, 100, 100, 1)", background: "rgba(255, 100, 100, 0.05)", borderRadius: 6, margin: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Error</div>
            <div style={{ fontSize: 12, fontFamily: "monospace" }}>{error}</div>
          </div>
        ) : loading ? (
          <div style={{ padding: 20, textAlign: "center", opacity: 0.6 }}>Loading...</div>
        ) : editingTradeId !== null ? (
          <div style={{ display: "flex", gap: 24 }}>
            {/* Tagging UI */}
            <div style={{ flex: "0 0 500px" }}>
              <TaggingUI
                tradeId={editingTradeId}
                onTagsSelected={handleTagsSelected}
                onClose={() => setEditingTradeId(null)}
              />
            </div>

            {/* Notes Editor */}
            <div style={{ flex: 1 }} className="card">
              <div className="cardTitle">Trade Notes</div>
              <div className="cardBody" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <textarea
                  value={editingNotes}
                  onChange={(e) => setEditingNotes(e.target.value)}
                  placeholder="Add notes about this trade..."
                  style={{
                    flex: 1,
                    padding: 12,
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 6,
                    color: "white",
                    fontFamily: "monospace",
                    fontSize: 12,
                    resize: "vertical",
                    minHeight: 200,
                  }}
                />
                <div style={{ display: "flex", gap: 12 }}>
                  <button
                    onClick={handleSaveNotes}
                    style={{
                      flex: 1,
                      padding: 10,
                      background: "rgba(100, 200, 100, 0.2)",
                      border: "1px solid rgba(100, 200, 100, 0.4)",
                      borderRadius: 6,
                      color: "white",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Save Notes
                  </button>
                  <button
                    onClick={() => setEditingTradeId(null)}
                    style={{
                      flex: 1,
                      padding: 10,
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 6,
                      color: "white",
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : selectedTab === "debrief" ? (
          <SessionDebrief todayStats={todayStats} historicalStats={historicalStats} loading={loading} />
        ) : todayTrades.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", opacity: 0.6 }}>
            <div style={{ fontSize: 16, marginBottom: 8 }}>No trades yet</div>
            <div style={{ fontSize: 12 }}>Place paper trades to see them here with screenshots and analysis.</div>
          </div>
        ) : (
          <div>
            {todayTrades.map((trade) => (
              <TradeAnalytics
                key={trade.id}
                trade={trade}
                onEdit={() => {
                  setEditingTradeId(trade.id);
                  setEditingNotes(trade.notes || "");
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
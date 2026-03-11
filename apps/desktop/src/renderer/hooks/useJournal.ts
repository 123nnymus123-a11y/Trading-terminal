import { useState } from "react";
import type { PaperTrade } from "../../main/persistence/repos";

declare global {
  interface Window {
    electron?: {
      ipcRenderer?: {
        invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
      };
    };
  }
}

export function useJournal() {
  const [trades, setTrades] = useState<PaperTrade[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getTodayTrades = async (): Promise<PaperTrade[]> => {
    setLoading(true);
    try {
      const result = (await window.electron?.ipcRenderer?.invoke("cockpit:journal:getTodayTrades")) as PaperTrade[] | undefined;
      const trades = result || [];
      setTrades(trades);
      setError(null);
      return trades;
    } catch (err) {
      setError(String(err));
      console.error("Error fetching today's trades:", err);
      return [];
    } finally {
      setLoading(false);
    }
  };

  const getClosedTrades = async (limit = 100): Promise<PaperTrade[]> => {
    setLoading(true);
    try {
      const result = (await window.electron?.ipcRenderer?.invoke("cockpit:journal:getClosedTrades", limit)) as PaperTrade[] | undefined;
      const trades = result || [];
      setTrades(trades);
      setError(null);
      return trades;
    } catch (err) {
      setError(String(err));
      console.error("Error fetching closed trades:", err);
      return [];
    } finally {
      setLoading(false);
    }
  };

  const getTradeById = async (tradeId: number): Promise<PaperTrade | null> => {
    try {
      const result = (await window.electron?.ipcRenderer?.invoke("cockpit:journal:getTradeById", tradeId)) as PaperTrade | null | undefined;
      return result || null;
    } catch (err) {
      console.error("Error fetching trade:", err);
      return null;
    }
  };

  const getSessionStats = async (startTs: number, endTs: number) => {
    try {
      const result = await window.electron?.ipcRenderer?.invoke("cockpit:journal:getSessionStats", startTs, endTs);
      return result as Record<string, number> | null;
    } catch (err) {
      console.error("Error fetching session stats:", err);
      return null;
    }
  };

  const updateTradeMetadata = async (
    tradeId: number,
    metadata: Partial<{
      setup?: string;
      regime?: string;
      catalyst?: string;
      execution_type?: string;
      mistakes?: string;
      notes?: string;
      adherence_score?: number;
      costs?: number;
    }>
  ): Promise<boolean> => {
    try {
      const result = (await window.electron?.ipcRenderer?.invoke("cockpit:journal:updateTradeMetadata", tradeId, metadata)) as boolean | undefined;
      return !!result;
    } catch (err) {
      console.error("Error updating trade metadata:", err);
      return false;
    }
  };

  const addTags = async (
    tradeId: number,
    tags: { tag_type: "setup" | "regime" | "catalyst" | "execution" | "mistake"; tag_value: string }[]
  ): Promise<boolean> => {
    try {
      const result = (await window.electron?.ipcRenderer?.invoke("cockpit:journal:addTags", tradeId, tags)) as boolean | undefined;
      return !!result;
    } catch (err) {
      console.error("Error adding tags:", err);
      return false;
    }
  };

  return {
    trades,
    loading,
    error,
    getTodayTrades,
    getClosedTrades,
    getTradeById,
    getSessionStats,
    updateTradeMetadata,
    addTags,
  };
}

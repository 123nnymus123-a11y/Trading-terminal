import React from "react";

function extractLast(payload: any): { symbol?: string; last?: number } {
  // payload can be { type: "md.quote", quote: {...} } OR just {...}
  const q = payload?.quote ?? payload?.data ?? payload;

  const symbol =
    (q?.symbol ?? payload?.symbol ?? payload?.quote?.symbol)?.toString?.();

  const last =
    (typeof q?.last === "number" && q.last) ||
    (typeof q?.lastPrice === "number" && q.lastPrice) ||
    (typeof q?.price === "number" && q.price) ||
    (typeof q?.mid === "number" && q.mid) ||
    (typeof q?.tradePrice === "number" && q.tradePrice) ||
    undefined;

  return { symbol, last };
}

export function LastPricePill({ symbol }: { symbol: string }) {
  const sym = (symbol || "").trim().toUpperCase();
  const [price, setPrice] = React.useState<number | undefined>(undefined);

  React.useEffect(() => {
    const ipc = (window as any)?.electron?.ipcRenderer;
    if (!ipc?.on) return;

    const handler = (_evt: any, payload: any) => {
      const { symbol: s, last } = extractLast(payload);
      if (!s || !sym) return;
      if (s.toUpperCase() !== sym) return;
      if (typeof last === "number" && Number.isFinite(last)) {
        setPrice(last);
      }
    };

    ipc.on("tc:md", handler);

    return () => {
      if (ipc.off) ipc.off("tc:md", handler);
      else if (ipc.removeListener) ipc.removeListener("tc:md", handler);
    };
  }, [sym]);

  return (
    <div className="pill lastPricePill" title="Live last price from demo feed">
      <div className="pillLabel">Last</div>
      <div className="pillValue price">
        {sym || "--"} {typeof price === "number" ? price.toFixed(2) : "--"}
      </div>
    </div>
  );
}

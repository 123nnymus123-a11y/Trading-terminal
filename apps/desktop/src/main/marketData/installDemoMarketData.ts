import { ipcMain, type BrowserWindow } from "electron";
import { DemoMarketDataAdapter } from "../adapters/demoMarketDataAdapter";

// Minimal snapshot handler for renderer (optional)
type Snapshot = { ts: number; watchlist: string[]; prices: Record<string, number> };

export function installDemoMarketData(win: BrowserWindow) {
  console.log("[demo-md] installDemoMarketData: starting");

  const watchlist = ["AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "META", "SPY", "QQQ"];
  const latest: Record<string, number> = {};

  const adapter = new DemoMarketDataAdapter({ watchlistDefault: watchlist });

  const unsub = adapter.onEvent((e) => {
    // track last price
    if (e?.type === "md.quote") latest[e.quote.symbol] = e.quote.last;

    // stream to renderer
    try {
      if (!win.isDestroyed()) win.webContents.send("tc:md", e);
    } catch (err) {
      console.error("[demo-md] send failed:", err);
    }
  });

  // Debug: prove it's emitting
  const logTimer = setInterval(() => {
    const p = latest["AAPL"];
    console.log("[demo-md] alive. AAPL=", typeof p === "number" ? p.toFixed(2) : "--");
  }, 1000);

  // Snapshot for renderer (optional)
  ipcMain.handle("tc:md:getSnapshot", async (): Promise<Snapshot> => {
    return { ts: Date.now(), watchlist, prices: { ...latest } };
  });

  // start
  void adapter.connect();

  // cleanup
  return async () => {
    console.log("[demo-md] cleanup");
    clearInterval(logTimer);
    ipcMain.removeHandler("tc:md:getSnapshot");
    unsub();
    await adapter.disconnect();
  };
}

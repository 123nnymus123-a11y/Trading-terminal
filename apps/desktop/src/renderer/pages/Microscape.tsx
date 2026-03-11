import React from "react";
import { DataUnavailableCard } from "../components/DataUnavailable";

export function Microscape() {
  return (
    <div className="page">
      <div className="pageTitleRow">
        <h1 className="pageTitle">MICROSCAPE</h1>
        <div className="pageSubtitle">Single-symbol deep dive (placeholder)</div>
      </div>

      <div className="grid">
        <DataUnavailableCard title="Chart + Overlays" hint="Will render TradingView Lightweight Charts." />
        <DataUnavailableCard title="Level 2 / Order Book" hint="Will show DOM / book imbalance." />
        <DataUnavailableCard title="Tape / Prints" hint="Will show real-time trade prints + filters." />
      </div>
    </div>
  );
}
import React from "react";

export function DataUnavailableCard(props: { title?: string; hint?: string }) {
  return (
    <div className="card muted">
      <div className="cardTitle">{props.title ?? "Data not available in current mode"}</div>
      <div className="cardBody">
        <div className="mutedText">Data not available in current mode</div>
        {props.hint ? <div className="hint">{props.hint}</div> : null}
      </div>
    </div>
  );
}
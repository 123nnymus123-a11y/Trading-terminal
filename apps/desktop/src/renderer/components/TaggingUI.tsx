import React, { useState } from "react";

const DEFAULT_TAGS = {
  setup: ["Breakout", "Pullback", "Reversal", "Trend Continuation", "Range Bound", "Gap Fill"],
  regime: ["Trending Up", "Trending Down", "Range Bound", "Volatile", "Low Volume"],
  catalyst: ["Earnings", "News", "Technical Level", "Volume Spike", "Support/Resistance"],
  execution: ["Perfect", "Good", "Okay", "Poor", "Missed Signal"],
  mistake: [
    "Missed Entry",
    "Early Entry",
    "Late Entry",
    "Wrong Direction",
    "Wrong Size",
    "Held Too Long",
    "Cut Winner",
    "Revenge Trade",
  ],
};

export interface TaggingUIProps {
  tradeId: number;
  onTagsSelected: (tags: { tag_type: string; tag_value: string }[]) => void;
  existingTags?: { tag_type: string; tag_value: string }[];
  onClose?: () => void;
}

export function TaggingUI({ tradeId, onTagsSelected, existingTags = [], onClose }: TaggingUIProps) {
  const [selectedTags, setSelectedTags] = useState<{ tag_type: string; tag_value: string }[]>(existingTags);
  const [customValues, setCustomValues] = useState<{ [key: string]: string }>({});

  const toggleTag = (tagType: string, tagValue: string) => {
    setSelectedTags((prev) => {
      const exists = prev.some((t) => t.tag_type === tagType && t.tag_value === tagValue);
      if (exists) {
        return prev.filter((t) => !(t.tag_type === tagType && t.tag_value === tagValue));
      } else {
        return [...prev, { tag_type: tagType, tag_value: tagValue }];
      }
    });
  };

  const addCustomTag = (tagType: string) => {
    const value = customValues[tagType]?.trim();
    if (value) {
      toggleTag(tagType, value);
      setCustomValues({ ...customValues, [tagType]: "" });
    }
  };

  const handleSubmit = () => {
    onTagsSelected(selectedTags);
  };

  return (
    <div className="card" style={{ maxWidth: 600 }}>
      <div className="cardTitle">Tag Trade #{tradeId}</div>
      <div className="cardBody" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Setup */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, opacity: 0.8 }}>SETUP</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {DEFAULT_TAGS.setup.map((tag) => (
              <button
                key={tag}
                onClick={() => toggleTag("setup", tag)}
                style={{
                  padding: "6px 12px",
                  background: selectedTags.some((t) => t.tag_type === "setup" && t.tag_value === tag)
                    ? "rgba(110, 168, 254, 0.4)"
                    : "rgba(255,255,255,0.05)",
                  border: selectedTags.some((t) => t.tag_type === "setup" && t.tag_value === tag)
                    ? "1px solid rgba(110, 168, 254, 0.6)"
                    : "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 4,
                  color: "white",
                  fontSize: 11,
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}
              >
                {tag}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="Or add custom setup..."
            value={customValues.setup || ""}
            onChange={(e) => setCustomValues({ ...customValues, setup: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && addCustomTag("setup")}
            style={{
              width: "100%",
              padding: 8,
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 4,
              color: "white",
              fontSize: 12,
            }}
          />
        </div>

        {/* Regime */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, opacity: 0.8 }}>REGIME</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {DEFAULT_TAGS.regime.map((tag) => (
              <button
                key={tag}
                onClick={() => toggleTag("regime", tag)}
                style={{
                  padding: "6px 12px",
                  background: selectedTags.some((t) => t.tag_type === "regime" && t.tag_value === tag)
                    ? "rgba(110, 168, 254, 0.4)"
                    : "rgba(255,255,255,0.05)",
                  border: selectedTags.some((t) => t.tag_type === "regime" && t.tag_value === tag)
                    ? "1px solid rgba(110, 168, 254, 0.6)"
                    : "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 4,
                  color: "white",
                  fontSize: 11,
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        {/* Catalyst */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, opacity: 0.8 }}>CATALYST</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {DEFAULT_TAGS.catalyst.map((tag) => (
              <button
                key={tag}
                onClick={() => toggleTag("catalyst", tag)}
                style={{
                  padding: "6px 12px",
                  background: selectedTags.some((t) => t.tag_type === "catalyst" && t.tag_value === tag)
                    ? "rgba(110, 168, 254, 0.4)"
                    : "rgba(255,255,255,0.05)",
                  border: selectedTags.some((t) => t.tag_type === "catalyst" && t.tag_value === tag)
                    ? "1px solid rgba(110, 168, 254, 0.6)"
                    : "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 4,
                  color: "white",
                  fontSize: 11,
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        {/* Execution Type */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, opacity: 0.8 }}>EXECUTION TYPE</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {DEFAULT_TAGS.execution.map((tag) => (
              <button
                key={tag}
                onClick={() => toggleTag("execution", tag)}
                style={{
                  padding: "6px 12px",
                  background: selectedTags.some((t) => t.tag_type === "execution" && t.tag_value === tag)
                    ? "rgba(110, 168, 254, 0.4)"
                    : "rgba(255,255,255,0.05)",
                  border: selectedTags.some((t) => t.tag_type === "execution" && t.tag_value === tag)
                    ? "1px solid rgba(110, 168, 254, 0.6)"
                    : "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 4,
                  color: "white",
                  fontSize: 11,
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        {/* Mistakes */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, opacity: 0.8 }}>MISTAKES (optional)</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {DEFAULT_TAGS.mistake.map((tag) => (
              <button
                key={tag}
                onClick={() => toggleTag("mistake", tag)}
                style={{
                  padding: "6px 12px",
                  background: selectedTags.some((t) => t.tag_type === "mistake" && t.tag_value === tag)
                    ? "rgba(255, 100, 100, 0.4)"
                    : "rgba(255,255,255,0.05)",
                  border: selectedTags.some((t) => t.tag_type === "mistake" && t.tag_value === tag)
                    ? "1px solid rgba(255, 100, 100, 0.6)"
                    : "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 4,
                  color: "white",
                  fontSize: 11,
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
          <button
            onClick={handleSubmit}
            style={{
              flex: 1,
              padding: 10,
              background: "rgba(110, 168, 254, 0.2)",
              border: "1px solid rgba(110, 168, 254, 0.4)",
              borderRadius: 6,
              color: "white",
              fontWeight: 600,
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            Save Tags
          </button>
          {onClose && (
            <button
              onClick={onClose}
              style={{
                padding: 10,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 6,
                color: "white",
                cursor: "pointer",
                fontSize: 12,
                minWidth: 80,
              }}
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

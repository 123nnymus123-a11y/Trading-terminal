import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { ApiCredentialRecord } from "../../shared/apiHub";
import { API_KEY_TEMPLATES } from "../constants/apiKeyTemplates";
import type { ApiKeyProvider } from "../../shared/apiHub";

function getTemplate(provider: string | undefined) {
  if (!provider) return null;
  if (provider in API_KEY_TEMPLATES) {
    return API_KEY_TEMPLATES[provider as ApiKeyProvider];
  }
  return null;
}

function formatTimestamp(ts: number) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "—";
  }
}

export default function ApiHub() {
  const [records, setRecords] = useState<ApiCredentialRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [configDrafts, setConfigDrafts] = useState<Record<string, string>>({});
  const [secretDrafts, setSecretDrafts] = useState<Record<string, string>>({});
  const [newConfigEntry, setNewConfigEntry] = useState({ key: "", value: "" });
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const apiHub = window.cockpit?.apiHub;
  const secretsApi = window.cockpit?.secrets;

  const fetchSnapshot = useCallback(async () => {
    try {
      setLoading(true);
      const snapshot = await apiHub?.list?.();
      setRecords(snapshot?.records ?? []);
    } catch (err) {
      console.error("[ApiHub] failed to load records", err);
      setStatus("Unable to load credentials. Check the main app console for details.");
    } finally {
      setLoading(false);
    }
  }, [apiHub]);

  useEffect(() => {
    document.title = "API Hub";
  }, []);

  useEffect(() => {
    let disposed = false;
    fetchSnapshot().finally(() => {
      if (!disposed) setLoading(false);
    });
    const unsubscribe = apiHub?.onChanged?.((snapshot) => {
      if (!disposed) {
        setRecords(snapshot?.records ?? []);
      }
    });
    return () => {
      disposed = true;
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, [apiHub, fetchSnapshot]);

  useEffect(() => {
    if (records.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !records.find((r) => r.id === selectedId)) {
      setSelectedId(records[0].id);
    }
  }, [records, selectedId]);

  const selected = useMemo(() => records.find((r) => r.id === selectedId) ?? null, [records, selectedId]);
  const template = selected ? getTemplate(selected.provider as string) : null;

  useEffect(() => {
    if (!selected) {
      setNameDraft("");
      setConfigDrafts({});
      setSecretDrafts({});
      return;
    }
    setNameDraft(selected.name);
    setConfigDrafts(selected.config ?? {});
    setSecretDrafts({});
    setNewConfigEntry({ key: "", value: "" });
  }, [selected?.id]);

  const handleAddConfigEntry = () => {
    const key = newConfigEntry.key.trim();
    if (!key) return;
    setConfigDrafts((prev) => ({ ...prev, [key]: newConfigEntry.value.trim() }));
    setNewConfigEntry({ key: "", value: "" });
  };

  const handleRemoveConfigKey = (key: string) => {
    setConfigDrafts((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleSave = async () => {
    if (!selected || !apiHub?.save) return;
    setSaving(true);
    setStatus(null);
    try {
      const sanitizedConfig = Object.fromEntries(
        Object.entries(configDrafts)
          .map(([k, v]) => [k, v.trim()])
          .filter(([, v]) => v.length > 0)
      );
      const payload: ApiCredentialRecord = {
        ...selected,
        name: nameDraft.trim() || selected.name,
        config: Object.keys(sanitizedConfig).length ? sanitizedConfig : undefined,
      };
      await apiHub.save(payload);
      if (Object.keys(secretDrafts).length && secretsApi?.set) {
        for (const [key, value] of Object.entries(secretDrafts)) {
          const field = selected.fields.find((f) => f.key === key);
          if (field && value.trim()) {
            await secretsApi.set(field.account, value.trim());
          }
        }
        setSecretDrafts({});
      }
      setStatus("✅ Saved to API Hub");
      setTimeout(() => setStatus(null), 3000);
    } catch (err) {
      console.error("[ApiHub] save failed", err);
      setStatus(err instanceof Error ? `❌ ${err.message}` : "❌ Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!selected || !apiHub?.remove) return;
    if (!confirm(`Remove ${selected.name}? This cannot be undone.`)) return;
    try {
      await apiHub.remove(selected.id);
      setSelectedId(null);
    } catch (err) {
      console.error("[ApiHub] remove failed", err);
      setStatus("❌ Failed to remove credential");
    }
  };

  const rightPanel = () => {
    if (loading) {
      return <div style={{ padding: 40, fontSize: 16 }}>Loading credentials…</div>;
    }
    if (!selected) {
      return (
        <div style={{ padding: 40, fontSize: 16, opacity: 0.8 }}>
          No credentials stored yet. Add an API key from the Settings tab to get started.
        </div>
      );
    }

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <div>
            <h2 style={{ margin: 0 }}>{selected.name}</h2>
            <div style={{ fontSize: 13, opacity: 0.7 }}>
              {selected.provider} • Created {formatTimestamp(selected.createdAt)}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleSave} disabled={saving} style={{ padding: "8px 14px", fontWeight: 600 }}>
              {saving ? "Saving…" : "💾 Save"}
            </button>
            <button onClick={handleRemove} style={{ padding: "8px 14px", border: "1px solid rgba(248,113,113,0.5)", background: "rgba(248,113,113,0.12)", color: "#fecaca" }}>
              🗑️ Remove
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          <label style={{ fontSize: 12, opacity: 0.7 }}>Display Name</label>
          <input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(10,16,32,0.6)", color: "inherit" }}
          />
        </div>

        <div style={{ padding: 16, borderRadius: 14, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(15,24,46,0.7)" }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Secrets</div>
          {selected.fields.length === 0 && <div style={{ fontSize: 13, opacity: 0.7 }}>No credential slots defined for this provider.</div>}
          {selected.fields.length > 0 && (
            <div style={{ display: "grid", gap: 12 }}>
              {selected.fields.map((field) => (
                <div key={field.key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>{field.label}</div>
                  <input
                    type="password"
                    placeholder="Enter new secret to replace"
                    value={secretDrafts[field.key] ?? ""}
                    onChange={(e) => setSecretDrafts((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(7,11,24,0.65)", color: "inherit" }}
                  />
                </div>
              ))}
            </div>
          )}
          {template && template.secrets.length === 0 && (
            <div style={{ fontSize: 12, opacity: 0.6 }}>This template does not require secrets.</div>
          )}
        </div>

        <div style={{ padding: 16, borderRadius: 14, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(8,12,26,0.8)", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 600 }}>Configuration</div>
              <div style={{ fontSize: 12, opacity: 0.65 }}>Optional values like base URLs or feed selections.</div>
            </div>
            <button
              onClick={handleAddConfigEntry}
              style={{ padding: "6px 10px", borderRadius: 999, border: "1px solid rgba(94,234,212,0.6)", background: "rgba(45,212,191,0.12)", color: "#5eead4" }}
            >
              ＋ Add
            </button>
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            {Object.keys(configDrafts).length === 0 && (
              <div style={{ fontSize: 12, opacity: 0.6 }}>No config overrides set.</div>
            )}
            {Object.entries(configDrafts).map(([key, value]) => (
              <div key={key} style={{ display: "grid", gridTemplateColumns: "150px 1fr auto", gap: 10, alignItems: "center" }}>
                <div style={{ fontSize: 12, opacity: 0.8 }}>{key}</div>
                <input
                  value={value}
                  onChange={(e) => setConfigDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
                  style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(4,7,18,0.8)", color: "inherit" }}
                />
                <button onClick={() => handleRemoveConfigKey(key)} style={{ padding: "4px 8px", fontSize: 12 }}>✕</button>
              </div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 10 }}>
            <input
              placeholder="KEY_NAME"
              value={newConfigEntry.key}
              onChange={(e) => setNewConfigEntry((prev) => ({ ...prev, key: e.target.value }))}
              style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(7,11,24,0.7)", color: "inherit", textTransform: "uppercase" }}
            />
            <input
              placeholder="Value"
              value={newConfigEntry.value}
              onChange={(e) => setNewConfigEntry((prev) => ({ ...prev, value: e.target.value }))}
              style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(7,11,24,0.7)", color: "inherit" }}
            />
          </div>
        </div>

        {status && (
          <div style={{ padding: 12, borderRadius: 8, border: "1px solid rgba(147,197,253,0.4)", background: "rgba(23,37,84,0.8)", fontSize: 13 }}>
            {status}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "radial-gradient(circle at top left, #1f2937, #090b1a)",
        color: "#f8fafc",
        fontFamily: "'Space Grotesk', 'Segoe UI', sans-serif",
        padding: 24,
        boxSizing: "border-box",
      }}
    >
      <div style={{ maxWidth: 1280, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, letterSpacing: 2, textTransform: "uppercase", opacity: 0.7 }}>Credential Control</div>
            <h1 style={{ margin: 0 }}>API Hub</h1>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={fetchSnapshot} style={{ padding: "8px 14px", borderRadius: 999, border: "1px solid rgba(94,234,212,0.5)", background: "rgba(45,212,191,0.15)", color: "#5eead4" }}>
              🔄 Refresh
            </button>
            <button onClick={() => window.close()} style={{ padding: "8px 14px", borderRadius: 999, border: "1px solid rgba(248,113,113,0.4)", background: "rgba(248,113,113,0.12)", color: "#fecaca" }}>
              ✖ Close
            </button>
          </div>
        </header>

        <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 20 }}>
          <aside style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: 16, background: "rgba(6,10,22,0.85)", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 12, opacity: 0.65 }}>Stored Credentials</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "70vh", overflowY: "auto", paddingRight: 4 }}>
              {records.length === 0 && <div style={{ fontSize: 13, opacity: 0.7 }}>No API keys saved yet.</div>}
              {records.map((record) => {
                const active = record.id === selectedId;
                return (
                  <button
                    key={record.id}
                    onClick={() => setSelectedId(record.id)}
                    style={{
                      textAlign: "left",
                      padding: "10px 12px",
                      borderRadius: 12,
                      border: active ? "1px solid rgba(59,130,246,0.6)" : "1px solid rgba(255,255,255,0.08)",
                      background: active ? "rgba(37,99,235,0.25)" : "rgba(255,255,255,0.02)",
                      color: "inherit",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{record.name}</div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>{record.provider}</div>
                  </button>
                );
              })}
            </div>
          </aside>

          <section style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 18, padding: 24, background: "rgba(3,7,18,0.85)" }}>
            {rightPanel()}
          </section>
        </div>
      </div>
    </div>
  );
}

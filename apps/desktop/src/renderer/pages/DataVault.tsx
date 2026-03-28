import React, { useEffect, useMemo, useState } from "react";
import type {
  GraphMemoryDashboard,
  GraphMemoryDetail,
  GraphMemoryFilters,
  GraphMemorySection,
  GraphMemorySectionQuery,
} from "@tc/shared/graphMemory";
import { TedDataVaultPanel } from "../components/tedIntel/TedIntelWidgets";

type SectionResponse = {
  section: string;
  items: Array<Record<string, unknown>>;
  total: number;
  page: number;
  pageSize: number;
};

type SortState = {
  sortBy: string;
  sortDirection: "asc" | "desc";
};

const sections: Array<{ id: GraphMemorySection; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "entities", label: "Entities" },
  { id: "relationships", label: "Relationships" },
  { id: "evidence", label: "Evidence" },
  { id: "validation", label: "Validation" },
  { id: "usage", label: "Usage Memory" },
  { id: "snapshots", label: "Snapshots & Exports" },
  { id: "cloud", label: "Cloud Readiness" },
  { id: "settings", label: "Settings" },
];

const statusOptions = ["all", "unvalidated", "pending_validation", "validated", "contradicted", "rejected", "hot", "warm", "cold"];
const zoneOptions = ["all", "candidate", "validation", "production"];
const confidenceBandOptions = ["all", "very_low", "low", "medium", "high", "very_high"];
const freshnessBandOptions = ["all", "fresh", "aging", "stale"];

function tone(value: number): string {
  if (value >= 0.75) return "#4ade80";
  if (value >= 0.5) return "#facc15";
  return "#f87171";
}

function formatDate(value: unknown): string {
  if (typeof value !== "string" || !value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("sv-SE", { hour12: false });
}

function formatNumber(value: unknown): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "0";
  return value.toLocaleString("en-US");
}

function sectionColumns(section: GraphMemorySection): Array<{ key: string; label: string }> {
  if (section === "entities") {
    return [
      { key: "canonicalName", label: "Name" },
      { key: "id", label: "Canonical ID" },
      { key: "entityType", label: "Type" },
      { key: "aliasesCount", label: "Aliases" },
      { key: "region", label: "Region" },
      { key: "confidence", label: "Confidence" },
      { key: "freshness", label: "Freshness" },
      { key: "validationStatus", label: "Validation" },
      { key: "zone", label: "Zone" },
      { key: "evidenceCount", label: "Evidence" },
      { key: "relatedEdgesCount", label: "Related Edges" },
      { key: "lastSeenAt", label: "Last Seen" },
      { key: "updatedAt", label: "Last Validated" },
    ];
  }
  if (section === "relationships") {
    return [
      { key: "id", label: "Edge ID" },
      { key: "fromEntityName", label: "Source" },
      { key: "relationType", label: "Relationship" },
      { key: "toEntityName", label: "Target" },
      { key: "confidence", label: "Confidence" },
      { key: "freshness", label: "Freshness" },
      { key: "validationStatus", label: "Validation" },
      { key: "zone", label: "Zone" },
      { key: "evidenceCount", label: "Evidence" },
      { key: "contradictionFlag", label: "Contradiction" },
      { key: "firstSeenAt", label: "First Seen" },
      { key: "lastSeenAt", label: "Last Seen" },
      { key: "updatedAt", label: "Last Validated" },
    ];
  }
  if (section === "evidence") {
    return [
      { key: "evidenceId", label: "Evidence ID" },
      { key: "sourceType", label: "Source Type" },
      { key: "sourceTitle", label: "Source Title" },
      { key: "extractionMethod", label: "Extraction Method" },
      { key: "linkedCount", label: "Linked Records" },
      { key: "qualityScore", label: "Quality" },
      { key: "extractedAt", label: "Extracted" },
      { key: "snippetPreview", label: "Snippet" },
      { key: "sourceReference", label: "Status" },
    ];
  }
  if (section === "validation") {
    return [
      { key: "recordId", label: "Record ID" },
      { key: "recordType", label: "Record Type" },
      { key: "validationStatus", label: "Validation Status" },
      { key: "validatorType", label: "Validator" },
      { key: "staleFlag", label: "Stale" },
      { key: "contradictionFlag", label: "Contradiction" },
      { key: "promotionEligible", label: "Promotion Eligible" },
      { key: "lastValidatedAt", label: "Last Validated" },
      { key: "validationMethod", label: "Validation Method" },
      { key: "expiresAt", label: "Next Review / TTL" },
      { key: "zone", label: "Zone" },
    ];
  }
  if (section === "usage") {
    return [
      { key: "recordId", label: "Record ID" },
      { key: "recordType", label: "Record Type" },
      { key: "requestCount", label: "Request Count" },
      { key: "lastRequestedAt", label: "Last Requested" },
      { key: "queryCluster", label: "Query Cluster" },
      { key: "temperature", label: "State" },
      { key: "speedupBenefitMs", label: "Speed Contribution" },
      { key: "popularityRank", label: "Popularity" },
    ];
  }
  if (section === "snapshots") {
    return [
      { key: "kind", label: "Kind" },
      { key: "fileName", label: "File" },
      { key: "bytes", label: "Bytes" },
      { key: "modifiedAt", label: "Modified" },
      { key: "fullPath", label: "Location" },
    ];
  }
  if (section === "cloud" || section === "settings") {
    return [
      { key: "provider", label: "Provider" },
      { key: "cloudEnabled", label: "Enabled" },
      { key: "connected", label: "Connected" },
      { key: "projectId", label: "Project" },
      { key: "dbUrl", label: "Database" },
      { key: "bucket", label: "Bucket" },
      { key: "syncMode", label: "Sync Mode" },
      { key: "queuedRecords", label: "Queued" },
      { key: "unsyncedChanges", label: "Unsynced" },
      { key: "conflictStrategy", label: "Conflict Strategy" },
      { key: "lastSyncAt", label: "Last Sync" },
      { key: "message", label: "Status" },
    ];
  }

  return [];
}

function valueCell(key: string, value: unknown): React.ReactNode {
  if (value === null || value === undefined || value === "") return "-";

  if (typeof value === "boolean") {
    return <span style={{ color: value ? "#4ade80" : "#f87171" }}>{value ? "Yes" : "No"}</span>;
  }
  if (typeof value === "number") {
    if (key.toLowerCase().includes("confidence") || key.toLowerCase().includes("freshness")) {
      return <span style={{ color: tone(value) }}>{(value * 100).toFixed(1)}%</span>;
    }
    if (key.toLowerCase().includes("bytes")) {
      return value.toLocaleString("en-US");
    }
    return value.toLocaleString("en-US");
  }
  if (typeof value === "string" && (key.toLowerCase().includes("at") || key.toLowerCase().includes("seen"))) {
    return formatDate(value);
  }
  return String(value);
}

function panelTitle(section: GraphMemorySection): string {
  const match = sections.find((item) => item.id === section);
  return match ? match.label : "Data";
}

export default function DataVault() {
  const [activeSection, setActiveSection] = useState<GraphMemorySection>("overview");
  const [dashboard, setDashboard] = useState<GraphMemoryDashboard | null>(null);
  const [sectionData, setSectionData] = useState<SectionResponse | null>(null);
  const [selectedRow, setSelectedRow] = useState<Record<string, unknown> | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Array<{ recordType: "entity" | "edge"; id: string }>>([]);
  const [detail, setDetail] = useState<GraphMemoryDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshAt, setLastRefreshAt] = useState<string>(new Date().toISOString());

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState<SortState>({ sortBy: "updated_at", sortDirection: "desc" });
  const [detailTab, setDetailTab] = useState<"summary" | "evidence" | "validation" | "related" | "raw" | "history">("summary");

  const [filters, setFilters] = useState<GraphMemoryFilters>({
    search: "",
    zone: "all",
    status: "all",
    type: "all",
    sourceType: "all",
    confidenceBand: "all",
    freshnessBand: "all",
  });

  const cloud = dashboard?.cloud;

  const fetchDashboard = async () => {
    const res = await window.cockpit?.graphMemory?.getDashboard?.();
    if (!res?.success || !res.data) {
      throw new Error(res?.error || "Failed to load DATA VAULT dashboard");
    }
    setDashboard(res.data);
    setLastRefreshAt(new Date().toISOString());
  };

  const fetchSection = async () => {
    if (activeSection === "overview") {
      setSectionData(null);
      return;
    }

    const payload: GraphMemorySectionQuery = {
      section: activeSection,
      page,
      pageSize,
      sortBy: sort.sortBy,
      sortDirection: sort.sortDirection,
      filters,
    };

    const res = await window.cockpit?.graphMemory?.getSection?.(payload);
    if (!res?.success || !res.data) {
      throw new Error(res?.error || "Failed to load DATA VAULT section");
    }

    setSectionData(res.data as SectionResponse);

    if (res.data.items.length === 0) {
      setSelectedRow(null);
      setDetail(null);
      setSelectedKeys([]);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        await fetchDashboard();
        if (!cancelled) {
          await fetchSection();
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [activeSection, page, pageSize, sort.sortBy, sort.sortDirection, filters.search, filters.zone, filters.status, filters.type, filters.sourceType, filters.confidenceBand, filters.freshnessBand]);

  const onRowSelect = async (row: Record<string, unknown>) => {
    setSelectedRow(row);
    setLoadingDetail(true);
    setError(null);

    try {
      const idCandidate =
        (typeof row.id === "string" ? row.id : null) ||
        (typeof row.recordId === "string" ? row.recordId : null) ||
        (typeof row.evidenceId === "string" ? row.evidenceId : null) ||
        (typeof row.fileName === "string" ? row.fileName : null) ||
        "";

      const recordType =
        row.recordType === "edge" || row.recordType === "entity"
          ? row.recordType
          : undefined;

      const res = await window.cockpit?.graphMemory?.getDetail?.({
        section: activeSection,
        id: idCandidate,
        ...(recordType ? { recordType } : {}),
      });

      if (!res?.success || !res.data) {
        throw new Error(res?.error || "Failed to load detail");
      }
      setDetail(res.data);

      if (activeSection === "entities" && typeof row.id === "string") {
        setSelectedKeys([{ recordType: "entity", id: row.id }]);
      } else if (activeSection === "relationships" && typeof row.id === "string") {
        setSelectedKeys([{ recordType: "edge", id: row.id }]);
      } else if (activeSection === "validation" && typeof row.recordId === "string") {
        const recordTypeValue = row.recordType === "edge" ? "edge" : "entity";
        setSelectedKeys([{ recordType: recordTypeValue, id: row.recordId }]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingDetail(false);
    }
  };

  const onRefresh = async () => {
    setLoading(true);
    setError(null);
    try {
      await window.cockpit?.graphMemory?.refresh?.();
      await fetchDashboard();
      await fetchSection();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const onExportNow = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await window.cockpit?.graphMemory?.exportNow?.();
      if (!res?.success) {
        throw new Error(res?.error || "Export failed");
      }
      await fetchDashboard();
      if (activeSection === "snapshots") {
        await fetchSection();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const onRevalidateSelected = async () => {
    if (selectedKeys.length === 0) return;

    setLoading(true);
    setError(null);
    try {
      const res = await window.cockpit?.graphMemory?.revalidateSelected?.({ records: selectedKeys });
      if (!res?.success) {
        throw new Error(res?.error || "Could not queue revalidation");
      }
      await fetchDashboard();
      if (activeSection === "validation") {
        await fetchSection();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const onOpenLatestSnapshot = async () => {
    setError(null);
    const res = await window.cockpit?.graphMemory?.openLatestSnapshot?.();
    if (!res?.success) {
      setError(res?.error || "No snapshot file found yet");
    }
  };

  const onSync = () => {
    setError("Cloud structure is prepared, but no live server is connected yet.");
  };

  const rows = sectionData?.items ?? [];

  const maxPage = useMemo(() => {
    if (!sectionData || sectionData.total === 0) return 1;
    return Math.max(1, Math.ceil(sectionData.total / sectionData.pageSize));
  }, [sectionData]);

  const cloudReady = cloud?.connected ? "Connected" : "Cloud Ready";

  const tableColumns = sectionColumns(activeSection);

  return (
    <div style={{ height: "100%", display: "grid", gridTemplateRows: "auto auto 1fr", gap: 10, color: "#dbe6f7" }}>
      <section style={{
        border: "1px solid rgba(120, 147, 183, 0.28)",
        background: "linear-gradient(180deg, rgba(12,18,28,0.95) 0%, rgba(9,13,20,0.95) 100%)",
        borderRadius: 10,
        padding: "12px 14px",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 19, letterSpacing: 0.7, fontWeight: 800 }}>DATA VAULT</div>
            <div style={{ fontSize: 12, opacity: 0.78 }}>Structured graph memory and evidence registry</div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="tab" onClick={onRefresh}>Refresh</button>
            <button className="tab" onClick={onExportNow}>Export</button>
            <button className="tab" onClick={onRevalidateSelected} disabled={selectedKeys.length === 0}>Revalidate Selected</button>
            <button className="tab" onClick={onOpenLatestSnapshot}>Open Latest Snapshot</button>
            <button className="tab" onClick={onSync} disabled={!cloud || !cloud.connected} style={{ opacity: !cloud || !cloud.connected ? 0.55 : 1 }}>Sync</button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 14, marginTop: 10, flexWrap: "wrap", fontSize: 11, color: "#9ab1d1" }}>
          <div>Local DB: <span style={{ color: dashboard?.localDbStatus === "ready" ? "#4ade80" : "#f87171" }}>{dashboard?.localDbStatus ?? "loading"}</span></div>
          <div>Cloud: <span style={{ color: "#93c5fd" }}>{cloudReady}</span></div>
          <div>Last Sync: <span>{formatDate(cloud?.lastSyncAt ?? "") || "-"}</span></div>
          <div>Last Local Refresh: <span>{formatDate(lastRefreshAt)}</span></div>
        </div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(8, minmax(140px, 1fr))", gap: 8 }}>
        <div style={{ gridColumn: "1 / -1" }}>
          <TedDataVaultPanel windowDays="90d" />
        </div>
        {[
          { label: "Total Entities", value: dashboard?.summaryCards.totalEntities ?? 0 },
          { label: "Total Relationships", value: dashboard?.summaryCards.totalRelationships ?? 0 },
          { label: "Total Evidence Records", value: dashboard?.summaryCards.totalEvidenceRecords ?? 0 },
          { label: "Validation Queue", value: dashboard?.summaryCards.validationQueuePending ?? 0 },
          { label: "Low Confidence Items", value: dashboard?.summaryCards.lowConfidenceItems ?? 0 },
          { label: "Stale Items", value: dashboard?.summaryCards.staleItems ?? 0 },
          { label: "Recently Added", value: dashboard?.summaryCards.recentlyAdded ?? 0 },
          { label: "Production vs Candidate", value: `${dashboard?.summaryCards.productionCount ?? 0} / ${dashboard?.summaryCards.candidateCount ?? 0}` },
        ].map((card) => (
          <div key={card.label} style={{
            border: "1px solid rgba(120, 147, 183, 0.22)",
            borderRadius: 8,
            background: "rgba(8,12,19,0.85)",
            padding: "9px 10px",
          }}>
            <div style={{ fontSize: 10, color: "#8ea8ca", textTransform: "uppercase", letterSpacing: 0.7 }}>{card.label}</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>{formatNumber(typeof card.value === "number" ? card.value : Number.NaN) || String(card.value)}</div>
          </div>
        ))}
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "280px 1fr 420px", gap: 10, minHeight: 0 }}>
        <aside style={{
          border: "1px solid rgba(120, 147, 183, 0.24)",
          borderRadius: 10,
          background: "rgba(10,15,23,0.92)",
          padding: 10,
          display: "grid",
          gridTemplateRows: "auto auto 1fr",
          minHeight: 0,
        }}>
          <div style={{ display: "grid", gap: 4 }}>
            {sections.map((entry) => {
              const active = entry.id === activeSection;
              return (
                <button
                  key={entry.id}
                  onClick={() => {
                    setActiveSection(entry.id);
                    setPage(1);
                    setSelectedRow(null);
                    setDetail(null);
                    setSelectedKeys([]);
                  }}
                  style={{
                    textAlign: "left",
                    border: "1px solid rgba(120, 147, 183, 0.25)",
                    background: active ? "rgba(47, 84, 143, 0.42)" : "rgba(11,17,27,0.78)",
                    color: active ? "#f5f9ff" : "#a6bfdc",
                    borderRadius: 6,
                    padding: "7px 8px",
                    fontSize: 12,
                    letterSpacing: 0.3,
                    cursor: "pointer",
                  }}
                >
                  {entry.label}
                </button>
              );
            })}
          </div>

          <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
            <input
              value={filters.search ?? ""}
              onChange={(event) => {
                setFilters((prev) => ({ ...prev, search: event.target.value }));
                setPage(1);
              }}
              placeholder="Search records"
              style={{
                border: "1px solid rgba(120, 147, 183, 0.3)",
                background: "rgba(6,9,15,0.9)",
                borderRadius: 6,
                padding: "7px 8px",
                color: "#e2ecfc",
                fontSize: 12,
              }}
            />
            <select value={filters.status ?? "all"} onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))} style={{ ...selectStyle }}>
              {statusOptions.map((value) => <option key={value} value={value}>{`Status: ${value}`}</option>)}
            </select>
            <input value={filters.type ?? "all"} onChange={(event) => setFilters((prev) => ({ ...prev, type: event.target.value || "all" }))} placeholder="Type filter" style={{ ...inputStyle }} />
            <input value={filters.sourceType ?? "all"} onChange={(event) => setFilters((prev) => ({ ...prev, sourceType: event.target.value || "all" }))} placeholder="Source type filter" style={{ ...inputStyle }} />
            <select value={filters.zone ?? "all"} onChange={(event) => setFilters((prev) => ({ ...prev, zone: event.target.value as GraphMemoryFilters["zone"] }))} style={{ ...selectStyle }}>
              {zoneOptions.map((value) => <option key={value} value={value}>{`Zone: ${value}`}</option>)}
            </select>
            <select value={filters.confidenceBand ?? "all"} onChange={(event) => setFilters((prev) => ({ ...prev, confidenceBand: event.target.value as GraphMemoryFilters["confidenceBand"] }))} style={{ ...selectStyle }}>
              {confidenceBandOptions.map((value) => <option key={value} value={value}>{`Confidence: ${value}`}</option>)}
            </select>
            <select value={filters.freshnessBand ?? "all"} onChange={(event) => setFilters((prev) => ({ ...prev, freshnessBand: event.target.value as GraphMemoryFilters["freshnessBand"] }))} style={{ ...selectStyle }}>
              {freshnessBandOptions.map((value) => <option key={value} value={value}>{`Freshness: ${value}`}</option>)}
            </select>
          </div>

          <div style={{ marginTop: 12, fontSize: 11, color: "#89a3c7", overflow: "auto", paddingRight: 4 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Operational Notes</div>
            <div>Local-first storage is active. Cloud sync remains disabled until a provider adapter and credentials are configured.</div>
            <div style={{ marginTop: 8 }}>The DATA VAULT surfaces canonical records, provenance, confidence, and validation state for institutional inspection.</div>
          </div>
        </aside>

        <main style={{
          border: "1px solid rgba(120, 147, 183, 0.24)",
          borderRadius: 10,
          background: "rgba(9,13,21,0.94)",
          display: "grid",
          gridTemplateRows: "auto 1fr auto",
          minHeight: 0,
          overflow: "hidden",
        }}>
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderBottom: "1px solid rgba(120, 147, 183, 0.17)",
            padding: "9px 10px",
          }}>
            <div style={{ fontSize: 12, letterSpacing: 0.5, textTransform: "uppercase", color: "#9bb4d6" }}>{panelTitle(activeSection)}</div>
            <div style={{ fontSize: 11, color: "#89a3c7" }}>
              {sectionData ? `${sectionData.total.toLocaleString("en-US")} records` : "-"}
            </div>
          </div>

          {activeSection === "overview" ? (
            <div style={{ padding: 12, overflow: "auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <OverviewBlock title="Entity Distribution" rows={dashboard?.overview.entityTypes ?? []} />
              <OverviewBlock title="Relationship Distribution" rows={dashboard?.overview.relationshipTypes ?? []} />
              <OverviewBlock title="Confidence Distribution" rows={dashboard?.overview.confidenceBands ?? []} />
              <OverviewBlock title="Freshness Distribution" rows={dashboard?.overview.freshnessBands ?? []} />
              <OverviewBlock title="Zone Split" rows={dashboard?.overview.zoneSplit ?? []} />
              <OverviewBlock title="Most Requested Nodes" rows={dashboard?.overview.mostRequested ?? []} />
              <OverviewBlock title="Latest Ingested" rows={dashboard?.overview.latestIngested ?? []} />
              <OverviewBlock title="Latest Validated" rows={dashboard?.overview.latestValidated ?? []} />
              <OverviewBlock title="Latest Rejected" rows={dashboard?.overview.latestRejected ?? []} />
              <OverviewBlock title="Hottest Subgraphs" rows={dashboard?.overview.hottestSubgraphs ?? []} />
              <OverviewBlock title="Stale / High Risk Watchlist" rows={dashboard?.overview.staleWatchlist ?? []} />
            </div>
          ) : loading ? (
            <div style={{ padding: 14, color: "#8ea8ca", fontSize: 12 }}>Loading DATA VAULT records...</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 14, color: "#8ea8ca", fontSize: 12 }}>
              {error ? `Error: ${error}` : "No records found for current filters. Adjust search, status, or zone criteria."}
            </div>
          ) : (
            <div style={{ overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={thStyle}></th>
                    {tableColumns.map((column) => (
                      <th
                        key={column.key}
                        style={{ ...thStyle, cursor: "pointer" }}
                        onClick={() => {
                          setSort((prev) => {
                            if (prev.sortBy === column.key) {
                              return {
                                sortBy: column.key,
                                sortDirection: prev.sortDirection === "asc" ? "desc" : "asc",
                              };
                            }
                            return { sortBy: column.key, sortDirection: "desc" };
                          });
                        }}
                      >
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => {
                    const rowId = (typeof row.id === "string" ? row.id : null) || (typeof row.recordId === "string" ? row.recordId : null) || (typeof row.evidenceId === "string" ? row.evidenceId : null) || (typeof row.fileName === "string" ? row.fileName : String(index));
                    const selected = selectedRow && ((selectedRow.id as string | undefined) === row.id || (selectedRow.recordId as string | undefined) === row.recordId || (selectedRow.evidenceId as string | undefined) === row.evidenceId || (selectedRow.fileName as string | undefined) === row.fileName);

                    const selectableRecord =
                      activeSection === "entities"
                        ? ({ recordType: "entity", id: typeof row.id === "string" ? row.id : "" } as const)
                        : activeSection === "relationships"
                          ? ({ recordType: "edge", id: typeof row.id === "string" ? row.id : "" } as const)
                          : activeSection === "validation"
                            ? ({ recordType: row.recordType === "edge" ? "edge" : "entity", id: typeof row.recordId === "string" ? row.recordId : "" } as const)
                            : null;

                    const checked =
                      selectableRecord !== null &&
                      selectedKeys.some((item) => item.recordType === selectableRecord.recordType && item.id === selectableRecord.id);

                    return (
                      <tr key={rowId} style={{ background: selected ? "rgba(59,130,246,0.18)" : "transparent" }} onClick={() => void onRowSelect(row)}>
                        <td style={{ ...tdStyle, width: 34 }} onClick={(event) => event.stopPropagation()}>
                          {selectableRecord ? (
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) => {
                                setSelectedKeys((prev) => {
                                  if (!event.target.checked) {
                                    return prev.filter((item) => !(item.recordType === selectableRecord.recordType && item.id === selectableRecord.id));
                                  }
                                  if (prev.some((item) => item.recordType === selectableRecord.recordType && item.id === selectableRecord.id)) {
                                    return prev;
                                  }
                                  return [...prev, selectableRecord];
                                });
                              }}
                            />
                          ) : null}
                        </td>
                        {tableColumns.map((column) => (
                          <td key={column.key} style={tdStyle}>{valueCell(column.key, row[column.key])}</td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div style={{
            borderTop: "1px solid rgba(120, 147, 183, 0.17)",
            padding: "8px 10px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 11,
            color: "#8ea8ca",
          }}>
            <div>Page {page} of {maxPage}</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button className="tab" disabled={page <= 1} onClick={() => setPage((prev) => Math.max(1, prev - 1))}>Prev</button>
              <button className="tab" disabled={page >= maxPage} onClick={() => setPage((prev) => Math.min(maxPage, prev + 1))}>Next</button>
              <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }} style={selectStyle}>
                {[25, 50, 100].map((size) => <option key={size} value={size}>{`${size} / page`}</option>)}
              </select>
            </div>
          </div>
        </main>

        <aside style={{
          border: "1px solid rgba(120, 147, 183, 0.24)",
          borderRadius: 10,
          background: "rgba(9,14,22,0.94)",
          display: "grid",
          gridTemplateRows: "auto auto 1fr",
          minHeight: 0,
        }}>
          <div style={{
            borderBottom: "1px solid rgba(120, 147, 183, 0.17)",
            padding: "9px 10px",
            fontSize: 12,
            letterSpacing: 0.6,
            textTransform: "uppercase",
            color: "#9bb4d6",
          }}>
            Record Inspector
          </div>

          <div style={{ display: "flex", gap: 6, padding: "8px 10px", borderBottom: "1px solid rgba(120, 147, 183, 0.12)" }}>
            {[
              ["summary", "Summary"],
              ["evidence", "Evidence"],
              ["validation", "Validation"],
              ["related", "Related Nodes"],
              ["raw", "Raw JSON"],
              ["history", "Change History"],
            ].map((entry) => {
              const id = entry[0] as typeof detailTab;
              const label = entry[1];
              const active = detailTab === id;
              return (
                <button
                  key={id}
                  onClick={() => setDetailTab(id)}
                  style={{
                    border: "1px solid rgba(120, 147, 183, 0.22)",
                    borderRadius: 5,
                    background: active ? "rgba(44, 82, 141, 0.42)" : "rgba(11,16,25,0.7)",
                    color: active ? "#f5f9ff" : "#9db6d9",
                    fontSize: 10,
                    padding: "5px 7px",
                    letterSpacing: 0.4,
                    cursor: "pointer",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div style={{ padding: 10, overflow: "auto", fontSize: 12 }}>
            {loadingDetail ? (
              <div style={{ color: "#8ea8ca" }}>Loading inspector detail...</div>
            ) : !detail ? (
              <div style={{ color: "#8ea8ca" }}>Select a record to inspect canonical details, provenance, related records, and raw payloads.</div>
            ) : detailTab === "summary" ? (
              <KeyValueBlock value={detail.summary} />
            ) : detailTab === "evidence" ? (
              <pre style={preStyle}>{JSON.stringify((detail.related as Record<string, unknown>).evidence ?? detail.related, null, 2)}</pre>
            ) : detailTab === "validation" ? (
              <pre style={preStyle}>{JSON.stringify((detail.related as Record<string, unknown>).events ?? detail.provenance, null, 2)}</pre>
            ) : detailTab === "related" ? (
              <pre style={preStyle}>{JSON.stringify(detail.related, null, 2)}</pre>
            ) : detailTab === "raw" ? (
              <pre style={preStyle}>{JSON.stringify(detail.raw, null, 2)}</pre>
            ) : (
              <pre style={preStyle}>{JSON.stringify(detail.timeline, null, 2)}</pre>
            )}
          </div>
        </aside>
      </section>

      {error ? (
        <div style={{
          position: "fixed",
          right: 12,
          bottom: 12,
          zIndex: 30,
          border: "1px solid rgba(248, 113, 113, 0.5)",
          background: "rgba(60, 12, 12, 0.9)",
          color: "#fecaca",
          borderRadius: 8,
          padding: "8px 10px",
          fontSize: 12,
          maxWidth: 520,
        }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}

function OverviewBlock(props: {
  title: string;
  rows: Array<Record<string, unknown>>;
}) {
  return (
    <div style={{
      border: "1px solid rgba(120, 147, 183, 0.2)",
      borderRadius: 8,
      background: "rgba(7, 11, 18, 0.82)",
      padding: "8px 9px",
      minHeight: 140,
    }}>
      <div style={{ fontSize: 11, letterSpacing: 0.5, textTransform: "uppercase", color: "#93aecd", marginBottom: 7 }}>{props.title}</div>
      {props.rows.length === 0 ? (
        <div style={{ color: "#7f97b6", fontSize: 12 }}>No data available.</div>
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          {props.rows.slice(0, 10).map((row, index) => (
            <div key={`${props.title}-${index}`} style={{
              borderBottom: "1px dashed rgba(130, 154, 188, 0.24)",
              paddingBottom: 5,
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 7,
            }}>
              <span style={{ color: "#d3e1f6", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{JSON.stringify(row).replace(/[{}\[\]"]/g, "")}</span>
              {typeof row.count === "number" ? <span style={{ color: "#9bc3f6", fontWeight: 700 }}>{row.count}</span> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function KeyValueBlock(props: { value: Record<string, unknown> }) {
  const entries = Object.entries(props.value ?? {});
  if (entries.length === 0) {
    return <div style={{ color: "#8ea8ca" }}>No detail available.</div>;
  }

  return (
    <div style={{ display: "grid", gap: 7 }}>
      {entries.map(([key, value]) => (
        <div key={key} style={{
          borderBottom: "1px dashed rgba(130, 154, 188, 0.24)",
          paddingBottom: 6,
        }}>
          <div style={{ fontSize: 10, letterSpacing: 0.6, textTransform: "uppercase", color: "#8ea8ca" }}>{key}</div>
          <div style={{ marginTop: 2, color: "#dbe6f7", wordBreak: "break-word" }}>
            {typeof value === "object" ? JSON.stringify(value) : String(value)}
          </div>
        </div>
      ))}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  borderBottom: "1px solid rgba(120, 147, 183, 0.2)",
  color: "#9cb5d6",
  textAlign: "left",
  fontSize: 10,
  letterSpacing: 0.5,
  textTransform: "uppercase",
  padding: "7px 8px",
  whiteSpace: "nowrap",
  position: "sticky",
  top: 0,
  background: "rgba(9, 13, 21, 0.98)",
};

const tdStyle: React.CSSProperties = {
  borderBottom: "1px solid rgba(120, 147, 183, 0.1)",
  padding: "7px 8px",
  color: "#d8e4f6",
  fontSize: 12,
  whiteSpace: "nowrap",
  maxWidth: 260,
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const inputStyle: React.CSSProperties = {
  border: "1px solid rgba(120, 147, 183, 0.3)",
  background: "rgba(6,9,15,0.9)",
  borderRadius: 6,
  padding: "7px 8px",
  color: "#e2ecfc",
  fontSize: 12,
};

const selectStyle: React.CSSProperties = {
  border: "1px solid rgba(120, 147, 183, 0.3)",
  background: "rgba(6,9,15,0.9)",
  borderRadius: 6,
  padding: "6px 8px",
  color: "#dbe6f7",
  fontSize: 12,
};

const preStyle: React.CSSProperties = {
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  margin: 0,
  color: "#dbe6f7",
  background: "rgba(7, 11, 18, 0.88)",
  border: "1px solid rgba(120, 147, 183, 0.2)",
  borderRadius: 8,
  padding: 10,
  lineHeight: 1.45,
};

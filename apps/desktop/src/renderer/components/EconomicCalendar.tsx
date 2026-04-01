import React, { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CalendarFilters,
  CalendarInsightFocus,
  CalendarInsightRequest,
  CalendarInsightResponse,
  EconomicEvent,
} from "@tc/shared";
import { fetchEconomicEvents, initializeEconomicCalendar, queryEconomicEvents } from "@tc/shared";
import { useSettingsStore } from "../store/settingsStore";

interface EconomicCalendarProps {
  className?: string;
}

type StatusFilter = "upcoming" | "released" | "all";
type ImportanceFilter = 1 | 2 | 3 | "all";
type CategoryFilter = EconomicEvent["eventCategory"] | "all";
type CountryFilter = string | "all";

type AdapterDescriptor = {
  id: EconomicEvent["sources"][number]["name"];
  label: string;
  optional?: boolean;
};

const ADAPTER_DEFINITIONS: AdapterDescriptor[] = [
  { id: "FRED", label: "FRED" },
  { id: "BLS", label: "BLS" },
  { id: "BEA", label: "BEA" },
  { id: "Census", label: "Census" },
  { id: "TradingEconomics", label: "Trading Economics", optional: true },
  { id: "Finnhub", label: "Finnhub", optional: true },
  { id: "AlphaVantage", label: "Alpha Vantage" },
];

export default function EconomicCalendar({ className = "" }: EconomicCalendarProps) {
  const [events, setEvents] = useState<EconomicEvent[]>([]);
  const [filteredEvents, setFilteredEvents] = useState<EconomicEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("upcoming");
  const [importanceFilter, setImportanceFilter] = useState<ImportanceFilter>("all");
  const [countryFilter, setCountryFilter] = useState<CountryFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");

  const aiEnginePreference = useSettingsStore((s) => s.aiEnginePreference);

  const [insightState, setInsightState] = useState<{
    loading: boolean;
    data: CalendarInsightResponse | null;
    error: string | null;
  }>({ loading: false, data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    let initialized = false;

    const hydrate = async (showSpinner: boolean) => {
      if (showSpinner) setLoading(true);
      try {
        if (!initialized) {
          await initializeEconomicCalendar();
          initialized = true;
        }
        const allEvents = await fetchEconomicEvents();
        if (cancelled) return;
        setEvents(allEvents);
        setLastRefresh(new Date());
        setError(null);
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (showSpinner && !cancelled) {
          setLoading(false);
        }
      }
    };

    void hydrate(true);
    const poller = setInterval(() => {
      void hydrate(false);
    }, 60_000);

    return () => {
      cancelled = true;
      clearInterval(poller);
    };
  }, []);

  useEffect(() => {
    const filters: CalendarFilters = {};
    if (statusFilter !== "all") filters.status = statusFilter;
    if (importanceFilter !== "all") filters.importance = importanceFilter;
    if (countryFilter !== "all") filters.countries = [countryFilter];
    if (categoryFilter !== "all") filters.categories = [categoryFilter];

    const results = queryEconomicEvents(filters);
    setFilteredEvents(results);
  }, [events, statusFilter, importanceFilter, countryFilter, categoryFilter]);

  const countries = useMemo(() => Array.from(new Set(events.map((e) => e.country))).sort(), [events]);
  const categories = useMemo(
    () => Array.from(new Set(events.map((e) => e.eventCategory))).sort(),
    [events]
  );

  const adapterCoverage = useMemo(() => {
    return ADAPTER_DEFINITIONS.map((adapter) => {
      const contributions = events.filter((event) =>
        event.sources.some((source) => source.name === adapter.id)
      );
      return {
        ...adapter,
        connected: contributions.length > 0,
        contribution: contributions.length,
      };
    });
  }, [events]);

  const totals = useMemo(() => {
    const upcoming = events.filter((e) => e.status === "upcoming").length;
    const released = events.filter((e) => e.status === "released").length;
    return { upcoming, released, total: events.length };
  }, [events]);

  const requestInsights = useCallback(async () => {
    if (!window.cockpit?.economicCalendar?.generateInsights) {
      setInsightState((prev) => ({ ...prev, error: "AI bridge unavailable" }));
      return;
    }

    const sourceEvents = (filteredEvents.length > 0 ? filteredEvents : events).slice(0, 20);
    if (sourceEvents.length === 0) {
      return;
    }

    const focus: CalendarInsightFocus = statusFilter === "released" ? "released" : "upcoming";
    const windowHours = statusFilter === "released" ? 48 : 72;
    const payload: CalendarInsightRequest = {
      focus,
      windowHours,
      events: sourceEvents.map(serializeForInsights),
    };

    setInsightState({ loading: true, data: insightState.data, error: null });

    try {
      const response = await window.cockpit.economicCalendar.generateInsights(payload, aiEnginePreference);
      if (response?.success && response.result) {
        setInsightState({ loading: false, data: response.result, error: null });
      } else {
        setInsightState({ loading: false, data: null, error: response?.error ?? "AI insight unavailable" });
      }
    } catch (err) {
      setInsightState({ loading: false, data: null, error: String(err) });
    }
  }, [aiEnginePreference, events, filteredEvents, statusFilter]);

  useEffect(() => {
    void requestInsights();
  }, [requestInsights]);

  const renderImportanceBadge = (importance: 1 | 2 | 3) => {
    const styles: Record<1 | 2 | 3, string> = {
      1: "bg-slate-700 text-slate-200",
      2: "bg-amber-500/20 text-amber-200",
      3: "bg-red-500/20 text-red-200",
    };
    const labels: Record<1 | 2 | 3, string> = { 1: "Low", 2: "Medium", 3: "High" };
    return <span className={`rounded-full px-3 py-1 text-xs font-semibold ${styles[importance]}`}>{labels[importance]}</span>;
  };

  const renderStatusBadge = (status: EconomicEvent["status"]) => {
    const map: Record<EconomicEvent["status"], string> = {
      upcoming: "bg-slate-700 text-blue-200",
      released: "bg-emerald-500/20 text-emerald-200",
      revised: "bg-orange-500/20 text-orange-100",
    };
    return <span className={`rounded-full px-3 py-1 text-xs font-semibold ${map[status]}`}>{status}</span>;
  };

  const renderConfidenceBadge = (label: EconomicEvent["confidenceLabel"], score?: number) => {
    if (!label || typeof score !== "number") {
      return <span className="text-xs text-slate-400">—</span>;
    }
    const palette: Record<NonNullable<EconomicEvent["confidenceLabel"]>, string> = {
      low: "bg-slate-700 text-slate-200",
      medium: "bg-sky-500/20 text-sky-100",
      high: "bg-emerald-500/20 text-emerald-100",
      critical: "bg-purple-500/20 text-purple-100",
    };
    const pct = `${Math.round(score * 100)}%`;
    return (
      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${palette[label]}`} title={`Adapter confidence ${pct}`}>
        {label.toUpperCase()} • {pct}
      </span>
    );
  };

  const formatValue = (value: number | null | undefined, unit?: string) => {
    if (value === null || value === undefined) return "—";
    return `${value.toFixed(2)}${unit ? ` ${unit}` : ""}`;
  };

  const formatDateTime = (date: Date, timezone?: string) => {
    const formatter = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone || "UTC",
    });
    return formatter.format(date);
  };

  if (loading) {
    return (
      <div className={`rounded-2xl border border-slate-800 bg-slate-900/70 p-6 text-center text-slate-300 ${className}`}>
        Loading economic events…
      </div>
    );
  }

  if (error) {
    return (
      <div className={`rounded-2xl border border-red-500/40 bg-red-500/10 p-6 text-red-100 ${className}`}>
        Failed to load economic calendar: {error}
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${className}`}>
      <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-xl shadow-slate-900/40">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Macro Pulse</p>
            <h2 className="text-2xl font-semibold text-white">Economic Calendar</h2>
            <p className="text-sm text-slate-400">
              {filteredEvents.length} visible • {totals.total} cached events
            </p>
          </div>
          <div className="flex flex-wrap gap-4">
            <SummaryChip label="Upcoming" value={totals.upcoming} accent="text-sky-300" />
            <SummaryChip label="Released" value={totals.released} accent="text-emerald-300" />
            <SummaryChip
              label="Heartbeat"
              value={lastRefresh ? `${Math.round((Date.now() - lastRefresh.getTime()) / 1000)}s ago` : "—"}
              accent="text-purple-300"
            />
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-4">
          <FilterSelect
            label="Status"
            value={statusFilter}
            onChange={(value) => setStatusFilter(value as StatusFilter)}
            options={[
              { label: "All", value: "all" },
              { label: "Upcoming", value: "upcoming" },
              { label: "Released", value: "released" },
            ]}
          />
          <FilterSelect
            label="Importance"
            value={String(importanceFilter)}
            onChange={(value) => setImportanceFilter(value === "all" ? "all" : (Number(value) as 1 | 2 | 3))}
            options={[
              { label: "All", value: "all" },
              { label: "High", value: "3" },
              { label: "Medium+", value: "2" },
              { label: "All", value: "1" },
            ]}
          />
          <FilterSelect
            label="Country"
            value={countryFilter}
            onChange={setCountryFilter}
            options={[{ label: "All", value: "all" }, ...countries.map((country) => ({ label: country, value: country }))]}
          />
          <FilterSelect
            label="Category"
            value={categoryFilter}
            onChange={(value) => setCategoryFilter(value as CategoryFilter)}
            options={[{ label: "All", value: "all" }, ...categories.map((category) => ({ label: capitalize(category), value: category }))]}
          />
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {adapterCoverage.map((adapter) => (
            <span
              key={adapter.id}
              className={`rounded-full border px-3 py-1 text-xs ${
                adapter.connected
                  ? "border-emerald-500/40 text-emerald-200"
                  : adapter.optional
                  ? "border-slate-700 text-slate-400"
                  : "border-red-500/40 text-red-200"
              }`}
            >
              {adapter.label}
              <span className="ml-2 text-slate-400">
                {adapter.connected ? `${adapter.contribution} events` : adapter.optional ? "optional" : "offline"}
              </span>
            </span>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-950/70">
          <div className="overflow-x-auto">
            {filteredEvents.length === 0 ? (
              <div className="p-8 text-center text-slate-400">No events match the selected filters.</div>
            ) : (
              <table className="min-w-full divide-y divide-slate-800">
                <thead className="bg-slate-900/60 text-xs uppercase tracking-widest text-slate-400">
                  <tr>
                    <th className="px-6 py-4 text-left">Date / Time</th>
                    <th className="px-6 py-4 text-left">Event</th>
                    <th className="px-6 py-4 text-left">Country</th>
                    <th className="px-6 py-4 text-center">Importance</th>
                    <th className="px-6 py-4 text-right">Previous</th>
                    <th className="px-6 py-4 text-right">Forecast</th>
                    <th className="px-6 py-4 text-right">Actual</th>
                    <th className="px-6 py-4 text-center">Status</th>
                    <th className="px-6 py-4 text-center">Confidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-sm text-slate-100">
                  {filteredEvents.map((event) => (
                    <tr key={event.id} className="bg-slate-900/30">
                      <td className="px-6 py-4 align-top">
                        <div className="font-semibold">{formatDateTime(event.releaseDateTime, event.timezone)}</div>
                        <div className="text-xs text-slate-500">{event.timezone}</div>
                      </td>
                      <td className="px-6 py-4 align-top">
                        <div className="font-semibold text-white">{event.title}</div>
                        {event.summary && <div className="mt-1 text-xs text-slate-400">{event.summary}</div>}
                        <div className="mt-2 text-xs text-slate-500">
                          {event.sources.map((source) => source.name).join(", ")}
                        </div>
                      </td>
                      <td className="px-6 py-4 align-top">
                        <div>{event.country}</div>
                        {event.region && <div className="text-xs text-slate-500">{event.region}</div>}
                      </td>
                      <td className="px-6 py-4 text-center align-top">{renderImportanceBadge(event.importance)}</td>
                      <td className="px-6 py-4 text-right align-top">{formatValue(event.previousValue, event.unit)}</td>
                      <td className="px-6 py-4 text-right align-top">{formatValue(event.forecastValue, event.unit)}</td>
                      <td className="px-6 py-4 text-right align-top font-semibold text-white">
                        {event.actualValue !== null && event.actualValue !== undefined ? formatValue(event.actualValue, event.unit) : "—"}
                      </td>
                      <td className="px-6 py-4 text-center align-top">{renderStatusBadge(event.status)}</td>
                      <td className="px-6 py-4 text-center align-top">{renderConfidenceBadge(event.confidenceLabel, event.confidenceScore)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <aside className="rounded-2xl border border-slate-800 bg-slate-950/70 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">AI Insights</p>
              <h3 className="text-lg font-semibold text-white">{insightState.data?.headline ?? "Calibrating calendar AI"}</h3>
            </div>
            <button
              type="button"
              onClick={() => requestInsights()}
              className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:border-slate-500"
              disabled={insightState.loading}
            >
              {insightState.loading ? "Sync…" : "Refresh"}
            </button>
          </div>
          <div className="mt-2 text-sm text-slate-400">
            {insightState.error
              ? insightState.error
              : insightState.data?.synopsis ?? "Waiting for engine response."}
          </div>
          <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-400">
            <span className="rounded-full border border-slate-700 px-3 py-1">
              Engine: {insightState.data?.aiEngine ?? aiEnginePreference}
            </span>
            <span className="rounded-full border border-slate-700 px-3 py-1">
              Window: {statusFilter === "released" ? "48h" : "72h"}
            </span>
          </div>
          <ul className="mt-4 space-y-2 text-sm text-slate-200">
            {(insightState.data?.bullets ?? []).map((bullet) => (
              <li key={bullet} className="rounded-lg bg-slate-900/60 px-3 py-2 text-slate-300">
                {bullet}
              </li>
            ))}
          </ul>
          <div className="mt-4">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Risk Signals</p>
            <div className="mt-2 space-y-2">
              {(insightState.data?.riskSignals ?? []).map((risk) => (
                <div key={risk.label} className="rounded-lg border border-slate-800/60 bg-slate-900/60 p-3">
                  <div className="text-sm font-semibold text-white">{risk.label}</div>
                  <div className="text-xs text-slate-400">{risk.detail}</div>
                  <div className="mt-1 text-xs text-slate-500">Severity: {risk.severity}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-4">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Focus Watchlist</p>
            <div className="mt-2 space-y-2">
              {(insightState.data?.focusEvents ?? []).map((event) => (
                <div key={event.id} className="rounded-lg border border-slate-800/60 bg-slate-900/60 p-3">
                  <div className="flex items-center justify-between text-sm text-white">
                    <span>{event.title}</span>
                    <span className="text-xs text-slate-400">{event.status}</span>
                  </div>
                  <div className="text-xs text-slate-500">{new Date(event.eta).toLocaleString()}</div>
                  <div className="mt-1 text-xs text-slate-300">{event.aiView}</div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function SummaryChip({ label, value, accent }: { label: string; value: string | number; accent: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/50 px-4 py-2 text-right">
      <div className="text-xs uppercase tracking-[0.3em] text-slate-500">{label}</div>
      <div className={`text-xl font-semibold ${accent}`}>{value}</div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
}) {
  return (
    <label className="text-sm text-slate-300">
      <span className="mb-2 block text-xs uppercase tracking-[0.3em] text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-slate-100 focus:border-slate-500 focus:outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function serializeForInsights(event: EconomicEvent) {
  return {
    id: event.id,
    title: event.title,
    releaseDateTime: event.releaseDateTime.toISOString(),
    status: event.status,
    importance: event.importance,
    eventCategory: event.eventCategory,
    country: event.country,
    confidenceScore: event.confidenceScore,
    summary: event.summary,
  };
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

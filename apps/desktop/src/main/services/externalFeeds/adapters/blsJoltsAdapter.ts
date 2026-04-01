import type { MacroSeries } from "../types";

const BLS_BASE = "https://api.bls.gov/publicAPI/v2/timeseries/data/";

export async function fetchJoltsSeries(params: {
  apiKey: string;
  seriesIds: string[];
  startYear?: number;
  endYear?: number;
}): Promise<MacroSeries[]> {
  const endYear = params.endYear ?? new Date().getFullYear();
  const startYear = params.startYear ?? endYear - 10;

  const res = await fetch(BLS_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      seriesid: params.seriesIds,
      startyear: String(startYear),
      endyear: String(endYear),
      registrationkey: params.apiKey,
    }),
  });

  if (!res.ok) {
    throw new Error(`BLS HTTP ${res.status}`);
  }

  const json = (await res.json()) as any;
  const series = Array.isArray(json?.Results?.series) ? json.Results.series : [];

  return series.map((s: any) => {
    const points = Array.isArray(s?.data)
      ? s.data
          .map((d: any) => ({
            date: normalizeBlsDate(d.year, d.period),
            value: Number(d.value),
          }))
          .filter((p: any) => p.date && !Number.isNaN(p.value))
          .reverse()
      : [];

    return {
      seriesId: s.seriesID ?? "",
      name: s.seriesID ?? "",
      frequency: "M",
      points,
    } satisfies MacroSeries;
  });
}

function normalizeBlsDate(year: string, period: string): string {
  const month = period?.replace("M", "");
  if (!year || !month || month === "13") return "";
  return `${year}-${month.padStart(2, "0")}`;
}

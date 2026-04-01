import { create } from "zustand";
import type {
  DisclosureEvent,
  SectorTheme,
  WatchlistCandidate,
  ValuationTag,
} from "@tc/shared";

type WindowDays = 7 | 30;
type ActionFilter = "buy-only" | "all";
type ValuationFilter = "all" | "undervalued" | "fair" | "overvalued";

type PublicFlowIntelState = {
  loading: boolean;
  candidatesLoading: boolean;
  error: string | null;
  lastUpdatedTs: number | null;
  selectedWindow: WindowDays;
  selectedThemeId: number | null;
  filters: { action: ActionFilter; valuation: ValuationFilter };
  recent: DisclosureEvent[];
  themes: Record<WindowDays, SectorTheme[]>;
  candidatesByTheme: Record<number, WatchlistCandidate[]>;
  valuations: Record<string, ValuationTag>;

  loadInitial: () => Promise<void>;
  refresh: () => Promise<void>;
  setWindow: (windowDays: WindowDays) => Promise<void>;
  selectTheme: (themeId: number | null) => Promise<void>;
  setFilters: (next: Partial<PublicFlowIntelState["filters"]>) => void;
};

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Unknown error";
}

export const usePublicFlowIntelStore = create<PublicFlowIntelState>(
  (set, get) => {
    const ensureValuations = async (tickers: string[]) => {
      const api = window.cockpit?.publicFlow;
      if (!api?.getValuations) return;
      const missing = Array.from(
        new Set(
          tickers
            .filter((t) => !!t)
            .map((t) => t.toUpperCase())
            .filter((t) => !get().valuations[t]),
        ),
      );
      if (!missing.length) return;
      try {
        const tags = (await api.getValuations(missing)) ?? {};
        const normalized: Record<string, ValuationTag> = {};
        Object.values(tags).forEach((tag) => {
          if (!tag) return;
          const ticker = tag.ticker.toUpperCase();
          normalized[ticker] = { ...tag, ticker };
        });
        set({ valuations: { ...get().valuations, ...normalized } });
      } catch (err) {
        set({ error: formatError(err) });
      }
    };

    const pickFirstTheme = (windowDays: WindowDays): number | null => {
      const list = get().themes[windowDays];
      if (!list || !list.length) return null;
      return list[0]?.id ?? null;
    };

    return {
      loading: false,
      candidatesLoading: false,
      error: null,
      lastUpdatedTs: null,
      selectedWindow: 7,
      selectedThemeId: null,
      filters: { action: "buy-only", valuation: "all" },
      recent: [],
      themes: { 7: [], 30: [] },
      candidatesByTheme: {},
      valuations: {},

      async loadInitial() {
        const api = window.cockpit?.publicFlow;
        if (!api) {
          set({ error: "Public Flow IPC API unavailable" });
          return;
        }

        set({ loading: true, error: null });

        try {
          const [recent, themes7, themes30] = await Promise.all([
            api.getRecent?.(50) ?? [],
            api.getThemes?.(7, 10) ?? [],
            api.getThemes?.(30, 10) ?? [],
          ]);

          set({
            recent: recent ?? [],
            themes: { 7: themes7 ?? [], 30: themes30 ?? [] },
            loading: false,
            error: null,
            lastUpdatedTs: Date.now(),
          });

          const initialTheme =
            get().selectedThemeId ?? pickFirstTheme(get().selectedWindow);
          if (initialTheme) {
            await get().selectTheme(initialTheme);
          }

          const tickers = (recent ?? [])
            .map((e) => e.ticker)
            .filter(Boolean) as string[];
          await ensureValuations(tickers);
        } catch (err) {
          set({ loading: false, error: formatError(err) });
        }
      },

      async refresh() {
        const api = window.cockpit?.publicFlow;
        if (!api?.refresh) {
          set({ error: "Refresh IPC endpoint missing" });
          return;
        }

        set({ loading: true, error: null });

        try {
          const res = await api.refresh();
          await get().loadInitial();
          set({
            lastUpdatedTs: (res as any)?.ts ?? Date.now(),
            loading: false,
          });
        } catch (err) {
          set({ loading: false, error: formatError(err) });
        }
      },

      async setWindow(windowDays) {
        set({ selectedWindow: windowDays });
        const nextTheme = pickFirstTheme(windowDays);
        await get().selectTheme(nextTheme);
      },

      async selectTheme(themeId) {
        set({ selectedThemeId: themeId, candidatesLoading: !!themeId });
        if (!themeId) {
          set({ candidatesLoading: false });
          return;
        }

        const cached = get().candidatesByTheme[themeId];
        if (cached) {
          set({ candidatesLoading: false });
          await ensureValuations(cached.map((c) => c.ticker));
          return;
        }

        const api = window.cockpit?.publicFlow;
        if (!api?.getCandidates) {
          set({
            candidatesLoading: false,
            error: "Candidates IPC endpoint missing",
          });
          return;
        }

        try {
          const candidates =
            (await api.getCandidates(themeId, {
              minPriority: "medium",
              minConfidence: 0.55,
            })) ?? [];
          set((state) => ({
            candidatesByTheme: {
              ...state.candidatesByTheme,
              [themeId]: candidates,
            },
            candidatesLoading: false,
          }));
          await ensureValuations(candidates.map((c) => c.ticker));
        } catch (err) {
          set({ candidatesLoading: false, error: formatError(err) });
        }
      },

      setFilters(next) {
        set({ filters: { ...get().filters, ...next } });
      },
    };
  },
);

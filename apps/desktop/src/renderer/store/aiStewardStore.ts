import { create } from "zustand";
import type { AiStewardConfig, AiStewardOverview } from "../../shared/aiSteward";

let unsubscribeUpdate: (() => void) | null = null;

interface AiStewardState {
  overview?: AiStewardOverview | null;
  loading: boolean;
  error?: string;
  testing: boolean;
  testResult?: { message: string; ts: number };
  init: () => void;
  refresh: () => Promise<void>;
  setConfig: (patch: Partial<AiStewardConfig>) => Promise<void>;
  applyTask: (taskId: string) => Promise<void>;
  runModule: (module: string) => Promise<void>;
  testResponse: () => Promise<void>;
}

function getApi() {
  return window.cockpit?.aiSteward;
}

export const useAiStewardStore = create<AiStewardState>((set, get) => ({
  overview: undefined,
  loading: false,
  error: undefined,
  testing: false,
  testResult: undefined,

  init: () => {
    const api = getApi();
    if (!api) return;
    if (!unsubscribeUpdate) {
      unsubscribeUpdate = api.onUpdate?.((data: AiStewardOverview) => {
        set({ overview: data });
      }) ?? null;
    }
    void get().refresh();
  },

  refresh: async () => {
    const api = getApi();
    if (!api?.getOverview) return;
    set({ loading: true, error: undefined });
    try {
      const overview = await api.getOverview();
      set({ overview, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  setConfig: async (patch) => {
    const api = getApi();
    if (!api?.setConfig) return;
    try {
      const next = await api.setConfig(patch);
      set((state) => ({ overview: state.overview ? { ...state.overview, config: next } : { config: next, modules: [], findings: [], tasks: [] }, error: undefined }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  applyTask: async (taskId) => {
    const api = getApi();
    if (!api?.applyTask) return;
    await api.applyTask(taskId);
    await get().refresh();
  },

  runModule: async (module) => {
    const api = getApi();
    if (!api?.runModule) return;
    await api.runModule(module);
    await get().refresh();
  },

  testResponse: async () => {
    const api = getApi();
    if (!api?.testResponse) return;
    set({ testing: true, error: undefined });
    try {
      const result = await api.testResponse();
      if (result?.ok) {
        set({ testing: false, testResult: { message: result.response ?? "(no response)", ts: Date.now() } });
      } else {
        set({ testing: false, error: result?.message ?? "Test failed" });
      }
    } catch (err) {
      set({ testing: false, error: err instanceof Error ? err.message : String(err) });
    }
  },
}));

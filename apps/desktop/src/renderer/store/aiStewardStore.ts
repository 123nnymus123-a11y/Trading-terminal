import { create } from "zustand";
import type {
  AiStewardConfig,
  AiStewardFinding,
  AiStewardHealthStatus,
  AiStewardIncidentDigest,
  AiStewardOverview,
  AiStewardTask,
} from "../../shared/aiSteward";

let unsubscribeUpdate: (() => void) | null = null;

interface AiStewardState {
  overview?: AiStewardOverview | null;
  health?: AiStewardHealthStatus | null;
  incidentDigest?: AiStewardIncidentDigest | null;
  findings: AiStewardFinding[];
  tasks: AiStewardTask[];
  loading: boolean;
  error?: string;
  testing: boolean;
  testResult?: { message: string; ts: number };
  init: () => void;
  refresh: () => Promise<void>;
  setConfig: (patch: Partial<AiStewardConfig>) => Promise<void>;
  dismissFinding: (findingId: string) => Promise<void>;
  applyTask: (taskId: string) => Promise<void>;
  runModule: (module: string) => Promise<void>;
  checkHealth: () => Promise<void>;
  testResponse: () => Promise<void>;
}

function getApi() {
  return window.cockpit?.aiSteward;
}

function unwrapIpcPayload<T>(payload: unknown): T {
  if (
    payload &&
    typeof payload === "object" &&
    "ok" in payload &&
    "data" in payload
  ) {
    const envelope = payload as {
      ok?: boolean;
      data?: unknown;
      error?: unknown;
    };
    if (envelope.ok === false) {
      const message =
        typeof envelope.error === "string"
          ? envelope.error
          : "AI steward IPC call failed";
      throw new Error(message);
    }
    return envelope.data as T;
  }
  return payload as T;
}

export const useAiStewardStore = create<AiStewardState>((set, get) => ({
  overview: undefined,
  health: undefined,
  incidentDigest: undefined,
  findings: [],
  tasks: [],
  loading: false,
  error: undefined,
  testing: false,
  testResult: undefined,

  init: () => {
    const api = getApi();
    if (!api) return;
    if (!unsubscribeUpdate) {
      unsubscribeUpdate =
        api.onUpdate?.((data: AiStewardOverview) => {
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
      const [overviewRaw, healthRaw, digestRaw] = await Promise.all([
        api.getOverview(),
        api.getHealth?.(),
        api.getIncidentDigest?.(),
      ]);
      const overview = unwrapIpcPayload<AiStewardOverview | null>(overviewRaw);
      const [findingsRaw, tasksRaw] = await Promise.all([
        api.getFindings?.(),
        api.getTasks?.(),
      ]);
      const health = healthRaw
        ? unwrapIpcPayload<AiStewardHealthStatus | null>(healthRaw)
        : null;
      const incidentDigest = digestRaw
        ? unwrapIpcPayload<AiStewardIncidentDigest | null>(digestRaw)
        : null;
      const findingsPayload = findingsRaw
        ? unwrapIpcPayload<unknown>(findingsRaw)
        : (overview?.findings ?? []);
      const tasksPayload = tasksRaw
        ? unwrapIpcPayload<unknown>(tasksRaw)
        : (overview?.tasks ?? []);
      const findings = Array.isArray(findingsPayload)
        ? (findingsPayload as AiStewardFinding[])
        : [];
      const tasks = Array.isArray(tasksPayload)
        ? (tasksPayload as AiStewardTask[])
        : [];
      set({
        overview,
        health,
        incidentDigest,
        findings,
        tasks,
        loading: false,
      });
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
      await api.setConfig(patch);
      set({ error: undefined });
      await get().refresh();
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

  dismissFinding: async (findingId) => {
    const api = getApi();
    if (!api?.dismissFinding) return;
    await api.dismissFinding(findingId);
    await get().refresh();
  },

  runModule: async (module) => {
    const api = getApi();
    if (!api?.runModule) return;
    await api.runModule(module);
    await get().refresh();
  },

  checkHealth: async () => {
    const api = getApi();
    if (!api?.checkHealth) return;
    await api.checkHealth();
    await get().refresh();
  },

  testResponse: async () => {
    const api = getApi();
    if (!api?.testResponse) return;
    set({ testing: true, error: undefined });
    try {
      const result = await api.testResponse();
      if (result?.ok) {
        set({
          testing: false,
          testResult: {
            message: result.response ?? "(no response)",
            ts: Date.now(),
          },
        });
      } else {
        set({ testing: false, error: result?.message ?? "Test failed" });
      }
    } catch (err) {
      set({
        testing: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
}));

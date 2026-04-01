import { Worker } from "node:worker_threads";
import { z } from "zod";

const WorkerRequestSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  payload: z.unknown().optional(),
});
export type WorkerRequest = z.infer<typeof WorkerRequestSchema>;

const WorkerResponseSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  ok: z.boolean(),
  payload: z.unknown().optional(),
  error: z.string().optional(),
});
export type WorkerResponse = z.infer<typeof WorkerResponseSchema>;

export type WorkerHarness = {
  send: (type: string, payload?: unknown, opts?: { timeoutMs?: number }) => Promise<WorkerResponse>;
  terminate: () => Promise<number>;
};

/**
 * Placeholder harness:
 * - typed request/response envelopes
 * - correlation IDs
 * - minimal validation at boundaries
 */
export function createWorkerHarness(workerPath: string): WorkerHarness {
  const worker = new Worker(workerPath);

  const inflight = new Map<
    string,
    { resolve: (v: WorkerResponse) => void; reject: (e: unknown) => void; t: NodeJS.Timeout }
  >();

  worker.on("message", (msg: unknown) => {
    const parsed = WorkerResponseSchema.safeParse(msg);
    if (!parsed.success) return;

    const res = parsed.data;
    const entry = inflight.get(res.id);
    if (!entry) return;

    clearTimeout(entry.t);
    inflight.delete(res.id);
    entry.resolve(res);
  });

  worker.on("error", (err) => {
    for (const [, entry] of inflight) {
      clearTimeout(entry.t);
      entry.reject(err);
    }
    inflight.clear();
  });

  worker.on("exit", (code) => {
    if (code !== 0) {
      const err = new Error(`Worker exited with code ${code}`);
      for (const [, entry] of inflight) {
        clearTimeout(entry.t);
        entry.reject(err);
      }
      inflight.clear();
    }
  });

  function makeId() {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  return {
    send(type: string, payload?: unknown, opts?: { timeoutMs?: number }) {
      const id = makeId();
      const req: WorkerRequest = { id, type, payload };

      const validated = WorkerRequestSchema.safeParse(req);
      if (!validated.success) {
        return Promise.resolve({
          id,
          type,
          ok: false,
          error: "Invalid worker request envelope",
        });
      }

      return new Promise<WorkerResponse>((resolve, reject) => {
        const timeoutMs = opts?.timeoutMs ?? 30_000;
        const t = setTimeout(() => {
          inflight.delete(id);
          reject(new Error(`Worker request timeout: ${type}`));
        }, timeoutMs);

        inflight.set(id, { resolve, reject, t });
        worker.postMessage(validated.data);
      });
    },

    terminate() {
      return worker.terminate();
    },
  };
}

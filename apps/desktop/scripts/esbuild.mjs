import esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const root = path.resolve(__dirname, "..");
const srcMain = path.join(root, "src/main/index.ts");
const srcPreload = path.join(root, "src/preload/index.ts");
const srcComputeWorker = path.join(root, "src/main/compute/worker.ts");
const srcAiWorker = path.join(root, "src/main/workers/aiResearchWorker.ts");

const outMainDir = path.join(root, "dist/main");
const outPreloadDir = path.join(root, "dist/preload");
const outWorkerFile = path.join(outMainDir, "compute/worker.cjs");
const outAiWorkerFile = path.join(outMainDir, "workers/aiResearchWorker.cjs");

const isWatch = process.argv.includes("--watch");

const shared = {
  bundle: true,
  sourcemap: true,
  platform: "node",
  target: "node20",
  logLevel: "info",
};

async function buildAll() {
  // MAIN -> CommonJS (Electron main entry)
  const mainCtx = await esbuild.context({
    ...shared,
    entryPoints: [srcMain],
    outfile: path.join(outMainDir, "index.cjs"),
    format: "cjs",
    external: ["electron", "better-sqlite3", "keytar"],
  });

  // PRELOAD -> CommonJS (MUST match what main expects)
  const preloadCtx = await esbuild.context({
    ...shared,
    entryPoints: [srcPreload],
    outfile: path.join(outPreloadDir, "index.cjs"),
    format: "cjs",
    external: ["electron"],
  });

  // COMPUTE WORKER -> CommonJS (Worker thread entry)
  const workerCtx = await esbuild.context({
    ...shared,
    entryPoints: [srcComputeWorker],
    outfile: outWorkerFile,
    format: "cjs",
    external: ["electron", "better-sqlite3", "keytar"],
  });

  const aiWorkerCtx = await esbuild.context({
    ...shared,
    entryPoints: [srcAiWorker],
    outfile: outAiWorkerFile,
    format: "cjs",
    external: ["electron", "better-sqlite3", "keytar"],
  });

  if (isWatch) {
    await mainCtx.watch();
    await preloadCtx.watch();
    await workerCtx.watch();
    await aiWorkerCtx.watch();
    console.log("[esbuild] watching main/preload...");
  } else {
    await mainCtx.rebuild();
    await preloadCtx.rebuild();
    await workerCtx.rebuild();
    await aiWorkerCtx.rebuild();
    await mainCtx.dispose();
    await preloadCtx.dispose();
    await workerCtx.dispose();
    await aiWorkerCtx.dispose();
    console.log("[esbuild] build finished.");
  }
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});

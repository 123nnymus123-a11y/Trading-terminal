import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

function ensureExists(p) {
  if (!fs.existsSync(p)) throw new Error(`Missing file: ${p}`);
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      ...opts,
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

const rendererConfig = path.resolve(root, "vite.renderer.config.ts");
ensureExists(rendererConfig);

console.log("[build] bundling main/preload with esbuild...");
await run("node", [path.resolve(root, "scripts/esbuild.mjs")], { cwd: root });

console.log("[build] building renderer with vite...");
// Use pnpm to resolve vite reliably across OSes and pnpm node_modules layouts.
await run("pnpm", ["exec", "vite", "build", "--config", rendererConfig], { cwd: root });

console.log("[build] done. Output in apps/desktop/dist/");
import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env.local so BACKEND_URL etc. reach the Electron main process
const envLocalPath = path.resolve(__dirname, "..", ".env.local");
if (fs.existsSync(envLocalPath)) {
  const lines = fs.readFileSync(envLocalPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

// ---------- helpers ----------
function ensureExists(p) {
  if (!fs.existsSync(p)) {
    throw new Error(`Missing file: ${p}`);
  }
}

function waitForPort(port, host = "127.0.0.1", timeoutMs = 60000) {
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const tick = () => {
      const socket = new net.Socket();

      socket
        .once("error", () => {
          socket.destroy();
          if (Date.now() - start > timeoutMs) {
            reject(new Error(`Timeout waiting for ${host}:${port}`));
          } else {
            setTimeout(tick, 250);
          }
        })
        .once("timeout", () => {
          socket.destroy();
          if (Date.now() - start > timeoutMs) {
            reject(new Error(`Timeout waiting for ${host}:${port}`));
          } else {
            setTimeout(tick, 250);
          }
        })
        .connect(port, host, () => {
          socket.end();
          resolve();
        });

      socket.setTimeout(800);
    };

    tick();
  });
}

function run(cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32", // so .cmd works
    ...opts
  });
  return child;
}

function runAndWait(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = run(cmd, args, opts);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code ?? "unknown"}`));
    });
    child.once("error", reject);
  });
}

// ---------- config ----------
let VITE_PORT = Number(process.env.VITE_PORT || 5173);
const VITE_HOST = process.env.VITE_HOST || "127.0.0.1";
let VITE_URL = process.env.VITE_DEV_SERVER_URL || `http://${VITE_HOST}:${VITE_PORT}`;

const rendererConfig = path.resolve(__dirname, "..", "vite.renderer.config.ts");
ensureExists(rendererConfig);

// If you ever move the renderer entry, keep this consistent.
const rendererIndex = path.resolve(__dirname, "..", "src", "renderer", "index.html");
ensureExists(rendererIndex);

// Choose a free port if the default is in use.
async function isPortInUse(port, host = VITE_HOST) {
  return await new Promise((resolve) => {
    const socket = new net.Socket();
    socket.once("connect", () => { socket.end(); resolve(true); });
    socket.once("error", () => { socket.destroy(); resolve(false); });
    socket.setTimeout(500);
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
    socket.connect(port, host);
  });
}
async function choosePort(startPort, host = VITE_HOST, maxTries = 20) {
  let p = startPort;
  for (let i = 0; i < maxTries; i++) {
    // eslint-disable-next-line no-await-in-loop
    const inUse = await isPortInUse(p, host);
    if (!inUse) return p;
    p += 1;
  }
  return startPort;
}

VITE_PORT = await choosePort(VITE_PORT, VITE_HOST, 20);
VITE_URL = process.env.VITE_DEV_SERVER_URL || `http://${VITE_HOST}:${VITE_PORT}`;
console.log(`[dev] Starting Vite dev server on ${VITE_URL} ...`);
const vite = run("vite", [
  "--config",
  rendererConfig,
  "--host",
  VITE_HOST,
  "--port",
  String(VITE_PORT),
  "--strictPort"
], {
  env: { ...process.env }
});

console.log("[dev] Starting esbuild watch (main/preload) ...");
const esbuildScript = path.resolve(__dirname, "esbuild.mjs");
ensureExists(esbuildScript);

console.log("[dev] Building Electron main/preload once before watch...");
await runAndWait("node", [esbuildScript], {
  env: { ...process.env }
});

const esbuild = run("node", [esbuildScript, "--watch"], {
  env: { ...process.env }
});

const electronEntry = path.resolve(__dirname, "..", "dist", "main", "index.cjs");
ensureExists(electronEntry);

// Rebuild native modules for Electron (better-sqlite3, keytar)
const appRoot = path.resolve(__dirname, "..");
const skipElectronRebuild =
  process.env.SKIP_ELECTRON_REBUILD === "1" ||
  process.env.SKIP_ELECTRON_REBUILD === "true";

if (skipElectronRebuild) {
  console.warn("[dev] Skipping electron-rebuild due to SKIP_ELECTRON_REBUILD.");
} else {
  console.log("[dev] Rebuilding native modules for Electron...");
  await runAndWait("pnpm", ["exec", "electron-rebuild", "-f", "-w", "better-sqlite3,keytar"], {
    cwd: appRoot,
    env: { ...process.env },
  });
  console.log("[dev] Electron native modules rebuilt.");
}

try {
  await waitForPort(VITE_PORT, VITE_HOST, 60000);
  console.log(`[dev] Vite is reachable at ${VITE_HOST}:${VITE_PORT}`);
} catch (e) {
  console.warn(`[dev] Vite readiness check failed (${e?.message || e}). Continuing anyway...`);
}

// Launch Electron (it will load VITE_URL)
console.log("[dev] Launching Electron...");
const electron = run("electron", ["."], {
  cwd: path.resolve(__dirname, ".."),
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: VITE_URL
  }
});

function shutdown(code = 0) {
  try { vite.kill("SIGINT"); } catch { }
  try { esbuild.kill("SIGINT"); } catch { }
  try { electron.kill("SIGINT"); } catch { }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

electron.on?.("exit", (code) => shutdown(code ?? 0));

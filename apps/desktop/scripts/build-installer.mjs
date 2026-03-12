import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

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

async function runElectronBuilder(args) {
  // Resolve binary through pnpm workspace instead of node_modules/.bin
  return run("pnpm", ["exec", "electron-builder", ...args], { cwd: root });
}

// Forward only the args after the script name.
const forwarded = process.argv.slice(2);

if (forwarded.length > 0) {
  console.log("[build-installer] running electron-builder via pnpm exec...");
  await runElectronBuilder(forwarded);
} else {
  await runElectronBuilder([
    "--config",
    path.join(root, "electron-builder.config.cjs"),
    "--win",
    "nsis",
  ]);

  if (process.platform !== "win32") {
    console.log("[build] Restoring native modules for host platform...");
    await runElectronBuilder(["install-app-deps"]);
    console.log("[build] Host native modules restored.");
  }
}
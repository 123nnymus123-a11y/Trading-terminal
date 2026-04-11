import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const ELECTRON_ABI_MAP = {
    "28": "119",
    "29": "121",
    "30": "123",
    "31": "125",
    "32": "127",
    "33": "129",
};

function run(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, {
            cwd: root,
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

// Dummy implementations for missing functions (replace with real ones if needed)
function cleanDir(dir) {
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function ensureExists(file) {
    if (!fs.existsSync(file)) {
        throw new Error(`[build] Required file missing: ${file}`);
    }
}

async function prepareWindowsNativeDeps() {
    console.log("[build] Preparing Windows native modules via electron-builder install-app-deps...");
    await runElectronBuilder(["install-app-deps", "--platform", "win32", "--arch", "x64"]);
    console.log("[build] Windows native modules prepared.");
}

async function main() {
    cleanDir(path.join(root, "dist"));
    cleanDir(path.join(root, "release"));

    await run("node", [path.join(root, "scripts/build.mjs")]);

    ensureExists(path.join(root, "dist/main/index.cjs"));
    ensureExists(path.join(root, "dist/preload/index.cjs"));

    // When cross-building on Linux/macOS for Windows, prepare the Windows
    // native addon binaries before packaging.
    if (process.platform !== "win32") {
        const desktopPkg = JSON.parse(
            fs.readFileSync(path.join(root, "package.json"), "utf8"),
        );
        const electronVersion = (desktopPkg.devDependencies?.electron ?? "30.5.1").replace(/[^0-9.]/g, "");
        const electronMajor = electronVersion.split(".")[0];
        const abi = ELECTRON_ABI_MAP[electronMajor];
        if (!abi) {
            throw new Error(
                `[build] No ABI mapping for Electron ${electronVersion}. Update ELECTRON_ABI_MAP in build-installer.mjs.`,
            );
        }

        await prepareWindowsNativeDeps();
    }

    await runElectronBuilder([
        "--config",
        path.join(root, "electron-builder.config.cjs"),
        "--win",
        "nsis",
    ]);

    // After cross-building for Windows, restore native addons for the host
    // platform so this development environment stays functional.
    if (process.platform !== "win32") {
        console.log("[build] Restoring native modules for host platform...");
        await runElectronBuilder(["install-app-deps"]);
        console.log("[build] Host native modules restored.");
    }
}

// Forward only the args after the script name.
const forwarded = process.argv.slice(2);

if (forwarded.length > 0) {
    console.log("[build-installer] running electron-builder via pnpm exec...");
    await runElectronBuilder(forwarded);
} else {
    await main();
}
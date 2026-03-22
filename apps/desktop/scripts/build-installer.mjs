import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

// Electron major version -> prebuild ABI tag used by better-sqlite3 releases.
// Extend this table when upgrading Electron.
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

function runElectronBuilder(args) {
    // Resolve binary through pnpm workspace instead of node_modules/.bin.
    return run("pnpm", ["exec", "electron-builder", ...args]);
}

function cleanDir(target) {
    if (fs.existsSync(target)) {
        fs.rmSync(target, { recursive: true, force: true });
    }
}

function ensureExists(target) {
    if (!fs.existsSync(target)) {
        throw new Error(`[build] Missing build output: ${target}`);
    }
}

/**
 * Download and unpack the win32-x64 pre-built binary for better-sqlite3 using
 * Python3. This avoids pnpm symlink path issues with prebuild-install wrappers.
 */
async function downloadBetterSqlite3Win32(bs3Version, electronAbi, destDir) {
    const tarName = `better-sqlite3-v${bs3Version}-electron-v${electronAbi}-win32-x64.tar.gz`;
    const url = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${bs3Version}/${tarName}`;
    const destNode = path.join(destDir, "build", "Release", "better_sqlite3.node");

    fs.mkdirSync(path.join(destDir, "build", "Release"), { recursive: true });

    const pyScript = `
import urllib.request, tarfile, io, sys

url = ${JSON.stringify(url)}
dest = ${JSON.stringify(destNode)}

print(f"[build] Fetching {url}", flush=True)
with urllib.request.urlopen(url, timeout=60) as r:
    data = r.read()

with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tf:
    node_member = next((m for m in tf.getmembers() if m.name.endswith(".node")), None)
    if node_member is None:
        print("[build] ERROR: no .node file found in tarball", flush=True)
        sys.exit(1)
    node_file = tf.extractfile(node_member)
    with open(dest, "wb") as out:
        out.write(node_file.read())

print(f"[build] Wrote {dest}", flush=True)
`.trim();

    return new Promise((resolve, reject) => {
        const child = spawn("python3", ["-c", pyScript], {
            cwd: root,
            stdio: "inherit",
        });
        child.on("exit", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`python3 download exited with code ${code}`));
        });
    });
}

async function main() {
    cleanDir(path.join(root, "dist"));
    cleanDir(path.join(root, "release"));

    await run("node", [path.join(root, "scripts/build.mjs")]);

    ensureExists(path.join(root, "dist/main/index.cjs"));
    ensureExists(path.join(root, "dist/preload/index.cjs"));

    // When cross-building on Linux/macOS for Windows, download the pre-built
    // Windows PE binaries for native addons before packaging.
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

        const bs3Pkg = JSON.parse(
            fs.readFileSync(path.join(root, "node_modules/better-sqlite3/package.json"), "utf8"),
        );
        const bs3Version = bs3Pkg.version;
        const bs3Dir = path.join(root, "node_modules/better-sqlite3");

        console.log(
            `[build] Downloading better-sqlite3 v${bs3Version} win32-x64 for Electron ${electronVersion} (ABI ${abi})...`,
        );
        await downloadBetterSqlite3Win32(bs3Version, abi, bs3Dir);
        console.log("[build] better-sqlite3 win32 binary ready.");
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

main().catch((error) => {
    console.error(error);
    process.exit(1);
});

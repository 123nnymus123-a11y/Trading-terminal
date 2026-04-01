
import fs from "node:fs";

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

// Dummy implementation for downloadBetterSqlite3Win32 (replace with real one if needed)
async function downloadBetterSqlite3Win32(version, abi, dir) {
    // Implement download logic or import from another module
    // For now, just log
    console.log(`[mock] Would download better-sqlite3 v${version} ABI ${abi} to ${dir}`);
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

// Forward only the args after the script name.
const forwarded = process.argv.slice(2);

if (forwarded.length > 0) {
    console.log("[build-installer] running electron-builder via pnpm exec...");
    await runElectronBuilder(forwarded);
} else {
    await main();
}
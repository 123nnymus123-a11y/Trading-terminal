import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rebuild } from '@electron/rebuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '..');
const nodeModulesDir = path.join(appRoot, 'node_modules');

async function run() {
    // In pnpm workspaces postinstall can run before this package has local deps linked.
    if (!fs.existsSync(nodeModulesDir)) {
        console.log('[postinstall] Skipping native rebuild: node_modules not present in apps/desktop yet.');
        return;
    }

    const pkgPath = path.join(appRoot, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const electronVersion =
        pkg.devDependencies?.electron ||
        pkg.dependencies?.electron;

    if (!electronVersion) {
        console.warn('[postinstall] Skipping native rebuild: electron version not found in package.json.');
        return;
    }

    const nativeModules = ['better-sqlite3', 'keytar'];
    console.log(`[postinstall] Rebuilding native modules for Electron ${electronVersion}...`);

    await rebuild({
        buildPath: appRoot,
        electronVersion,
        force: true,
        onlyModules: nativeModules,
    });

    console.log('[postinstall] Native rebuild complete.');
}

run().catch((error) => {
    console.error('[postinstall] Native rebuild failed:', error);
    process.exit(1);
});

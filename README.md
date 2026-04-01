# Trading Terminal Desktop

Standalone repository for the Trading Terminal desktop application.

This repo contains:

- `apps/desktop` for the Electron main, preload, renderer, packaging scripts, and installer config
- `packages/shared` for shared desktop domain contracts and utilities
- `packages/api` for backend HTTP request and response schemas
- `.github/workflows/release.yml` for Windows build and GitHub Release publication

## Quick Start

Prerequisites:

- Node.js 20+
- `pnpm` 9+

Install dependencies:

```bash
pnpm install
```

Run the desktop app in development:

```bash
pnpm dev
```

Typecheck the app:

```bash
pnpm typecheck
```

Build the production desktop bundle:

```bash
pnpm build
```

Build the Windows installer:

```bash
pnpm build:installer
```

## Backend Integration

The desktop app resolves its backend URL from environment and runtime settings, with a shared source of truth in `apps/desktop/src/shared/backendConfig.ts`.

Supported environment variables:

- `BACKEND_URL`
- `TC_BACKEND_URL`
- `VITE_BACKEND_URL`
- `VITE_TC_BACKEND_URL`

Default fallback:

- `http://localhost:8787`

The app persists runtime backend URL overrides and securely stores authenticated session material in the desktop main process.

## Releases

Windows releases are built by GitHub Actions in `.github/workflows/release.yml`.

- Push to `main` to build and upload installer artifacts
- Push a tag like `v0.0.2` to publish a GitHub Release with installer assets

Release artifacts include the Windows installer, blockmap files, and `latest*.yml` metadata for `electron-updater`.
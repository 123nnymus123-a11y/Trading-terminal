# OpenClaw Backend Server Planfile

## 1. Goal

Run Trading Terminal backend on your Ubuntu OpenClaw server, then connect the desktop app to that backend reliably and securely.

Server context target:

- Host: openclaw-v3
- OS: Ubuntu Linux 6.8.x
- Node.js: 22.x
- Workspace root: /home/ubuntu/.openclaw/workspace

## 2. Deep Repo Reality (What Matters for Deployment)

Monorepo model:

- PNPM workspace with apps/* and packages/*.
- Backend package depends on workspace packages @tc/api and @tc/shared.
- Backend startup path: apps/backend/src/index.ts -> createInfra() -> createServer() -> HTTP + WS (/ws).

Backend persistence behavior:

- If DATABASE_URL exists and works: PostgreSQL mode + auto SQL migrations.
- If DATABASE_URL missing/fails in production: backend now fails fast.
- If DATABASE_URL missing/fails in development: backend may still use memory fallback.

Migration behavior:

- Migrations are auto-applied at backend startup from apps/backend/migrations.
- Applied versions tracked in schema_migrations.

Desktop connection behavior:

- Desktop no longer hardcodes a public backend IP in source defaults.
- Backend URL now prefers env/configured values and user-persisted settings.

## 3. What Must Be Moved to the Server

Minimum files/folders to run backend from source in monorepo mode:

- package.json (workspace root)
- pnpm-lock.yaml
- pnpm-workspace.yaml
- tsconfig.base.json
- apps/backend/**
- packages/api/**
- packages/shared/**

Recommended additional:

- .npmrc (if present)
- docs/ops notes for runbook
- ops/** (added in this patch)

Do not require on server for backend runtime:

- apps/desktop/**
- desktop installer/release artifacts
- data exports/log snapshots unless backend code directly references them

## 4. Code Changes Required Before Clean Production Rollout

### 4.1 Desktop backend URL defaults

Patched in this operation:

- apps/desktop/src/main/index.ts
- apps/desktop/src/renderer/lib/apiClient.ts
- apps/desktop/src/main/persistence/db.ts
- apps/desktop/src/renderer/pages/SettingsLogs.tsx

Result:

- Removed hardcoded internet IP defaults from source.
- Default fallback is local: http://localhost:8787.
- Environment overrides are supported across dev and packaged usage.

### 4.2 Docker workspace dependency gap

Patched in this operation:

- apps/backend/Dockerfile

Result:

- Docker build now copies packages/shared metadata and source in addition to packages/api.

### 4.3 Production transport/security settings

Patched in this operation:

- apps/backend/src/server.ts
- apps/backend/src/infra.ts

Result:

- CORS_ORIGIN cannot be * in production.
- CORS_ORIGIN supports comma-separated allowed origins.
- DATABASE_URL is required in production.
- PostgreSQL init failure in production aborts startup.

## 5. New Release and Operations Artifacts Added

CI:

- .github/workflows/backend-ci.yml

Environment template:

- apps/backend/.env.production.example

Deploy and rollback:

- ops/scripts/deploy-backend.sh
- ops/scripts/rollback-backend.sh

Backups:

- ops/scripts/backup-postgres.sh

Runtime service + reverse proxy:

- ops/systemd/trading-terminal-backend.service
- ops/nginx/trading-terminal-backend.conf

Observability baseline:

- ops/monitoring/prometheus-scrape.yml
- ops/monitoring/alert-rules.yml

## 6. Server Bring-up Procedure

### Phase A: Provision host runtime

1. Install Node.js 22 and pnpm via corepack.
2. Install PostgreSQL (required for persistence and full feature set).
3. Optional: install Redis for queue/cache durability.
4. Open firewall so only reverse proxy is internet-facing.

### Phase B: Transfer code

1. Clone/pull repo into:
   /home/ubuntu/.openclaw/workspace/trading-terminal
2. Verify required folders exist:
   apps/backend, packages/api, packages/shared.

### Phase C: Install/build

1. Run from repo root:
   pnpm install --frozen-lockfile
2. Build backend:
   pnpm -C apps/backend build

### Phase D: Configure environment

1. Create production env:
   cp apps/backend/.env.production.example apps/backend/.env
2. Fill at minimum:
   - NODE_ENV=production
   - PORT=8787
   - DATABASE_URL=postgres://...
   - CORS_ORIGIN=https://app.example.com
   - JWT_SECRET=<long random value>
3. Optional:
   - REDIS_URL=redis://...
   - AI/provider keys only if feature-enabled.

### Phase E: Service and reverse proxy

1. Install systemd unit:
   sudo cp ops/systemd/trading-terminal-backend.service /etc/systemd/system/
2. Prepare logs:
   sudo mkdir -p /var/log/trading-terminal
   sudo chown -R ubuntu:ubuntu /var/log/trading-terminal
3. Enable service:
   sudo systemctl daemon-reload
   sudo systemctl enable trading-terminal-backend
   sudo systemctl start trading-terminal-backend
4. Install nginx config:
   sudo cp ops/nginx/trading-terminal-backend.conf /etc/nginx/sites-available/trading-terminal-backend
   sudo ln -sfn /etc/nginx/sites-available/trading-terminal-backend /etc/nginx/sites-enabled/trading-terminal-backend
   sudo nginx -t && sudo systemctl reload nginx
5. Provision TLS certificate (example):
   sudo certbot --nginx -d api.example.com

### Phase F: Validate runtime

- GET /health returns status ok.
- GET /metrics returns Prometheus metrics.
- Login/signup/auth endpoints work.
- Desktop receives streaming data from /ws after login.
- Confirm migrations applied in schema_migrations.

## 7. Desktop App Connection Steps

### Current quick path (no rebuild required)

1. Launch desktop app.
2. Open Settings/Logs backend URL field.
3. Set backend URL to your server endpoint (prefer HTTPS origin).
4. Save, re-authenticate, verify data + WS stream.

### Better path (after packaging release)

- Set VITE_TC_BACKEND_URL during packaging for your default environment.
- Keep backend URL editable in UI for operational fallback.

## 8. Release Discipline Baseline

CI now verifies backend path:

- shared/api/backend typecheck
- backend tests
- backend build

Recommended release process:

1. Merge only when backend-ci passes.
2. Run deploy script on server:
   bash ops/scripts/deploy-backend.sh
3. If needed, rollback quickly:
   bash ops/scripts/rollback-backend.sh

## 9. Observability and Reliability Baseline

Metrics and alerting:

- /metrics exposed by backend
- Prometheus scrape and alert examples included in ops/monitoring

Backups:

- Nightly Postgres backups using ops/scripts/backup-postgres.sh
- Example cron:
  0 2 * * * /bin/bash /home/ubuntu/.openclaw/workspace/trading-terminal/ops/scripts/backup-postgres.sh >> /var/log/trading-terminal/backup.log 2>&1

## 10. Immediate Next Action Sequence

1. Push this patch and run backend CI.
2. On server, copy env template and fill real production values.
3. Bring up systemd service and nginx TLS config.
4. Connect desktop to HTTPS backend URL and run smoke tests.
5. Add backup cron and wire alert notifications.

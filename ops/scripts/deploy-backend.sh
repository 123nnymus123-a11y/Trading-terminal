#!/usr/bin/env bash
set -euo pipefail

APP_DIR=${APP_DIR:-/home/ubuntu/.openclaw/workspace/trading-terminal}
BACKEND_DIR="$APP_DIR/apps/backend"
SERVICE_NAME=${SERVICE_NAME:-trading-terminal-backend}
RELEASES_DIR=${RELEASES_DIR:-$APP_DIR/.releases/backend}
CURRENT_RELEASE_LINK="$RELEASES_DIR/current"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
NEW_RELEASE_DIR="$RELEASES_DIR/$TIMESTAMP"

mkdir -p "$RELEASES_DIR"

cd "$APP_DIR"

git fetch --all --prune
BRANCH=${BRANCH:-$(git rev-parse --abbrev-ref HEAD)}
git checkout "$BRANCH"
git pull --ff-only

corepack enable
pnpm install --frozen-lockfile
pnpm -C apps/backend build

mkdir -p "$NEW_RELEASE_DIR"
cp -a apps/backend/dist "$NEW_RELEASE_DIR/dist"
cp -a apps/backend/migrations "$NEW_RELEASE_DIR/migrations"
cp apps/backend/package.json "$NEW_RELEASE_DIR/package.json"
cp -a packages "$NEW_RELEASE_DIR/packages"
cp pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json "$NEW_RELEASE_DIR/"

ln -sfn "$NEW_RELEASE_DIR" "$CURRENT_RELEASE_LINK"

sudo systemctl daemon-reload
sudo systemctl restart "$SERVICE_NAME"
sudo systemctl --no-pager --full status "$SERVICE_NAME"

echo "Deploy complete. Active release: $NEW_RELEASE_DIR"

#!/usr/bin/env bash
set -euo pipefail

APP_DIR=${APP_DIR:-/home/ubuntu/.openclaw/workspace/trading-terminal}
RELEASES_DIR=${RELEASES_DIR:-$APP_DIR/.releases/backend}
CURRENT_RELEASE_LINK="$RELEASES_DIR/current"
SERVICE_NAME=${SERVICE_NAME:-trading-terminal-backend}

if [[ ! -d "$RELEASES_DIR" ]]; then
  echo "Releases directory not found: $RELEASES_DIR" >&2
  exit 1
fi

mapfile -t releases < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d | sort)
if [[ ${#releases[@]} -lt 2 ]]; then
  echo "Need at least 2 releases to rollback." >&2
  exit 1
fi

previous_release=${releases[-2]}
ln -sfn "$previous_release" "$CURRENT_RELEASE_LINK"

sudo systemctl restart "$SERVICE_NAME"
sudo systemctl --no-pager --full status "$SERVICE_NAME"

echo "Rollback complete. Active release: $previous_release"

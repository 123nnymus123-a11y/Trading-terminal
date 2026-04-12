#!/usr/bin/env bash

set -euo pipefail

timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
log_dir="${SECURITY_ROTATION_LOG_DIR:-ops/logs}"
log_file="${log_dir}/secret-rotation-${timestamp}.log"

mkdir -p "${log_dir}"

required_vars=(
  "JWT_SECRET"
  "METRICS_TOKEN"
  "AUTH_BOOTSTRAP_PASSWORD"
  "AUTH_BOOTSTRAP_LICENSE_KEY"
)

echo "[${timestamp}] Starting runtime secret rotation tracking" | tee -a "${log_file}"

missing=0
for var_name in "${required_vars[@]}"; do
  if [[ -z "${!var_name:-}" ]]; then
    echo "[ERROR] Missing env var: ${var_name}" | tee -a "${log_file}"
    missing=1
  else
    echo "[OK] ${var_name} is provided" | tee -a "${log_file}"
  fi
done

if [[ "${missing}" -ne 0 ]]; then
  echo "[FAIL] Rotation aborted due to missing env vars" | tee -a "${log_file}"
  exit 1
fi

cat <<'EOF' | tee -a "${log_file}"
[ACTION REQUIRED]
1. Update each secret in secret manager.
2. Deploy rotated values to staging.
3. Verify staging with security smoke tests.
4. Deploy rotated values to production.
5. Verify production with security smoke tests.
EOF

echo "[${timestamp}] Rotation workflow checklist generated" | tee -a "${log_file}"
echo "Log file: ${log_file}"

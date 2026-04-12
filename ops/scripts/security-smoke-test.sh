#!/usr/bin/env bash

set -euo pipefail

BACKEND_BASE_URL="${BACKEND_BASE_URL:-}"
AUTH_IDENTIFIER="${AUTH_IDENTIFIER:-}"
AUTH_PASSWORD="${AUTH_PASSWORD:-}"
AUTH_LICENSE_KEY="${AUTH_LICENSE_KEY:-}"
METRICS_TOKEN="${METRICS_TOKEN:-}"
TENANT_ID="${TENANT_ID:-default}"

if [[ -z "${BACKEND_BASE_URL}" || -z "${AUTH_IDENTIFIER}" || -z "${AUTH_PASSWORD}" || -z "${AUTH_LICENSE_KEY}" || -z "${METRICS_TOKEN}" ]]; then
  echo "Missing required env vars."
  echo "Required: BACKEND_BASE_URL AUTH_IDENTIFIER AUTH_PASSWORD AUTH_LICENSE_KEY METRICS_TOKEN"
  exit 1
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

fail() {
  echo "[FAIL] $1"
  exit 1
}

pass() {
  echo "[PASS] $1"
}

health_code="$(curl -sS -o "${tmp_dir}/health.json" -w "%{http_code}" "${BACKEND_BASE_URL}/health")"
[[ "${health_code}" == "200" ]] || fail "Health endpoint returned ${health_code}"
pass "Health endpoint"

metrics_unauth="$(curl -sS -o "${tmp_dir}/metrics_unauth.json" -w "%{http_code}" "${BACKEND_BASE_URL}/metrics")"
[[ "${metrics_unauth}" == "401" ]] || fail "Metrics unauth expected 401, got ${metrics_unauth}"
pass "Metrics unauthorized blocked"

metrics_auth="$(curl -sS -o "${tmp_dir}/metrics_auth.json" -w "%{http_code}" -H "Authorization: Bearer ${METRICS_TOKEN}" "${BACKEND_BASE_URL}/metrics")"
[[ "${metrics_auth}" == "200" ]] || fail "Metrics auth expected 200, got ${metrics_auth}"
pass "Metrics authorized access"

login_body="${tmp_dir}/login.json"
login_code="$(curl -sS -o "${login_body}" -w "%{http_code}" \
  -X POST "${BACKEND_BASE_URL}/api/auth/login" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: ${TENANT_ID}" \
  -d "{\"identifier\":\"${AUTH_IDENTIFIER}\",\"password\":\"${AUTH_PASSWORD}\",\"licenseKey\":\"${AUTH_LICENSE_KEY}\"}")"

if [[ "${login_code}" != "200" ]]; then
  if [[ "${login_code}" == "400" || "${login_code}" == "401" ]]; then
    login_code="$(curl -sS -o "${login_body}" -w "%{http_code}" \
      -X POST "${BACKEND_BASE_URL}/api/auth/login" \
      -H "Content-Type: application/json" \
      -H "X-Tenant-Id: ${TENANT_ID}" \
      -d "{\"username\":\"${AUTH_IDENTIFIER}\",\"password\":\"${AUTH_PASSWORD}\",\"licenseKey\":\"${AUTH_LICENSE_KEY}\"}")"
  fi
fi

[[ "${login_code}" == "200" ]] || fail "Login expected 200, got ${login_code}"
pass "Login success"

token="$(node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); process.stdout.write(String(d.token||''));" "${login_body}")"
[[ -n "${token}" ]] || fail "Login token missing"

me_code="$(curl -sS -o "${tmp_dir}/me.json" -w "%{http_code}" \
  -H "Authorization: Bearer ${token}" \
  -H "X-Tenant-Id: ${TENANT_ID}" \
  "${BACKEND_BASE_URL}/api/me")"
[[ "${me_code}" == "200" ]] || fail "Protected endpoint /api/me expected 200, got ${me_code}"
pass "Protected endpoint authorization"

wrong_password="${AUTH_PASSWORD}-invalid"
lockout_seen=0
for _i in 1 2 3 4 5 6 7; do
  bad_code="$(curl -sS -o "${tmp_dir}/bad_login.json" -w "%{http_code}" \
    -X POST "${BACKEND_BASE_URL}/api/auth/login" \
    -H "Content-Type: application/json" \
    -H "X-Tenant-Id: ${TENANT_ID}" \
    -d "{\"username\":\"${AUTH_IDENTIFIER}\",\"password\":\"${wrong_password}\",\"licenseKey\":\"${AUTH_LICENSE_KEY}\"}")"
  if [[ "${bad_code}" == "429" ]]; then
    lockout_seen=1
    break
  fi
done

[[ "${lockout_seen}" -eq 1 ]] || fail "Lockout behavior not observed (expected a 429 after repeated failures)"
pass "Auth lockout behavior"

echo "Security smoke test completed successfully"

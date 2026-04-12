# Security Staging and Production Rollout

Date: 2026-04-12
Scope: staged deployment of security controls, runtime secret rotation, and release sign-off.

## 1. Purpose

This runbook converts the security plan into executable rollout steps for staging and production.

## 2. Prerequisites

- Backend and desktop changes are merged into the release branch.
- Secrets are managed outside repository files.
- On-call owners are assigned for backend, infra, desktop, and security.
- Rollback path is available.

## 3. Environment Variables Required

- NODE_ENV=production
- METRICS_TOKEN (24+ chars)
- AUTH_LOGIN_WINDOW_SECONDS
- AUTH_LOGIN_MAX_ATTEMPTS
- AUTH_LOGIN_LOCKOUT_SECONDS
- AUTH_SIGNUP_WINDOW_SECONDS
- AUTH_SIGNUP_MAX_ATTEMPTS_PER_IP
- AUTH_SESSION_STORE_ENABLED=true
- AUTH_REFRESH_ROTATION_ENABLED=true
- AUTH_RBAC_ENFORCED=true
- IPC_STRICT_ALLOWLIST_ENABLED=true
- MIGRATION_REQUIRE_TENANT_HEADER=true

## 4. Rollout Sequence

1. Rotate secrets in secret manager.
2. Apply rotated values to staging.
3. Restart staging backend.
4. Run security smoke test script.
5. Validate monitoring alerts and metrics auth.
6. Approve production change window.
7. Apply rotated values to production.
8. Restart production backend.
9. Run security smoke test script against production.
10. Sign off with release checklist.

## 5. Commands

### 5.1 Secret Rotation Tracking

Run:

bash ops/scripts/rotate-runtime-secrets.sh

### 5.2 Security Smoke Tests

Run with environment variables:

BACKEND_BASE_URL=https://api.example.com \
AUTH_IDENTIFIER=<admin-user-or-email> \
AUTH_PASSWORD=<admin-password> \
AUTH_LICENSE_KEY=<license-key> \
METRICS_TOKEN=<metrics-token> \
bash ops/scripts/security-smoke-test.sh

## 6. Required Pass Criteria

- Health endpoint returns HTTP 200.
- Login success returns access token.
- Invalid login attempts trigger lockout behavior.
- Metrics endpoint rejects requests without token and allows valid token.
- Protected endpoint access works with Authorization and tenant headers.
- No secrets appear in logs.

## 7. Failure Handling

If any pass criteria fails:

1. Stop rollout progression.
2. Roll back backend deploy.
3. Rotate affected credentials if leak suspected.
4. Open incident if production impact is active.

## 8. Evidence Collection

- Store smoke test output artifact.
- Store release checklist with approver names.
- Store secret rotation log with timestamp and owner.

## 9. Sign-off

- Backend lead:
- Infrastructure lead:
- Security lead:
- Release manager:

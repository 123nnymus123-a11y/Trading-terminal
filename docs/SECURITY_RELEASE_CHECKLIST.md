# Security Release Checklist

Use this checklist before publishing backend or desktop releases.

## 1. Secrets and Configuration

- No production secrets in repository changes.
- Environment values come from secret manager or protected CI secrets.
- Production config checks pass (auth/session/rbac/ipc/metrics token).

## 2. Build and Dependency Security

- Dependency review passed for PR.
- Secret scan passed (gitleaks).
- Audit gate passed (high/critical vulnerabilities reviewed).
- SBOM generated and attached to build artifacts.

## 3. Auth and Transport Controls

- HTTPS enforced for non-local endpoints.
- Metrics endpoints require token auth.
- WebSocket query-token auth path is disabled.
- Auth lockout/rate-limits validated in staging.

## 4. Desktop Security

- IPC allowlist strict mode enabled in production.
- Keytar path verified; fallback passphrase set securely if needed.
- No insecure backend URL defaults in packaged build.

## 5. Infrastructure and Runtime

- Nginx config includes TLS hardening + security headers.
- systemd service hardening enabled and validated.
- Monitoring and alerting rules loaded.

## 6. Incident Readiness

- Incident runbook available to on-call responders.
- Rollback plan documented for this release.
- Release approver confirms security sign-off.

## 7. Final Approval

- Engineering lead approval:
- Security lead approval:
- Release manager approval:
- Release date/time:

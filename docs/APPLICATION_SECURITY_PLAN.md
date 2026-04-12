# Trading Terminal Security Plan

Date: 2026-04-12
Scope: Full application stack (desktop client, backend API, data stores, deployment/infrastructure, CI/CD, dependencies, monitoring, and operational readiness)

## 1. Executive Summary

This plan is based on an independent assessment of the current repository implementation and deployment artifacts. The system has a functional security baseline, but several high-impact risks require immediate action before production hardening is considered complete.

Top immediate risks:
- Production-like credentials and secrets are present in tracked environment files.
- Insecure default security settings exist for authentication, RBAC, 2FA, session storage, refresh-token rotation, and IPC channel allowlisting.
- Desktop fallback secret storage uses weak cryptographic construction and an unsafe static fallback passphrase path.
- Desktop default backend URL is plain HTTP to a public IP, creating token and credential exposure risk if misconfigured.
- WebSocket authentication can accept token in query string under certain flags, increasing token leakage risk.
- HTTP security headers and API endpoint protection are incomplete (for example, metrics endpoints are public).

This document defines a phased remediation plan with control objectives, implementation actions, and verification criteria.

## 2. Assessment Method

The assessment covered:
- Architecture and trust boundaries across desktop, preload/IPC, backend API, WebSocket, database, Redis, and external services.
- Authentication and authorization design and defaults.
- Transport and API security controls.
- Data protection and cryptographic handling.
- Secrets lifecycle and storage.
- Infrastructure and host hardening artifacts (Nginx, systemd, PM2, Docker).
- Dependency and release supply chain controls (package manifests and GitHub workflows).
- Logging, metrics, alerting, and incident readiness.
- Security testing and verification practices.

Evidence sources included backend auth/session code, middleware, WebSocket hub, desktop main/preload/security storage code, environment templates, deployment scripts, workflow definitions, and ops configs.

## 3. System Context and Threat Model

## 3.1 Core Components
- Desktop app (Electron): main process, preload bridge, renderer UI, local persistence, key management fallback path.
- Backend (Node.js/Express): auth, domain APIs, AI orchestration, WebSocket stream endpoint, Postgres/Redis integration.
- Infrastructure: reverse proxy (Nginx), process managers (systemd/PM2), optional Docker runtime.
- CI/CD: GitHub Actions for backend CI and desktop release packaging.

## 3.2 High-Value Assets
- User credentials and password hashes.
- JWT access and refresh tokens.
- API/provider keys (AI services, TED feed, SMTP, etc.).
- Trading and user profile data in Postgres.
- Local desktop secrets/session artifacts.
- Release artifacts and update metadata consumed by auto-updater.

## 3.3 Primary Threat Actors
- External attacker over network/API/WebSocket.
- Malware or local adversary on desktop host.
- Supply chain attacker (dependency compromise, CI abuse, release tampering).
- Insider misuse or accidental exposure via logs, repos, or environment files.

## 3.4 Trust Boundaries
- Renderer to preload to main-process IPC boundary.
- Desktop app to backend network boundary.
- Backend to database/cache and third-party APIs.
- CI/CD and release pipeline boundary to end-user update channel.

## 4. Current Risk Register (Independent Findings)

Severity scale: Critical, High, Medium, Low.

1. Critical: Secrets exposure in repository-tracked env files
- Risk: Credential compromise, unauthorized access, long-lived incident blast radius.
- Evidence: Production-style values in tracked files under apps/backend.
- Plan: Immediate secret rotation, repository secret purge process, enforce secret scanning and commit blocking.

2. High: Security-critical auth controls default to disabled
- Risk: RBAC bypass risk, weak session handling, reduced account compromise resistance.
- Evidence: Defaults for AUTH_SESSION_STORE_ENABLED, AUTH_REFRESH_ROTATION_ENABLED, AUTH_RBAC_ENFORCED, AUTH_TOTP_REQUIRED are false.
- Plan: Production-safe defaults and startup fail-fast checks.

3. High: Desktop fallback secret storage weakness
- Risk: Offline token/session recovery by local attacker when keytar unavailable.
- Evidence: AES-CTR fallback storage with static/passphrase fallback and no authenticated encryption.
- Plan: Remove insecure fallback or replace with authenticated encryption + hardware-bound secret derivation and strict opt-in.

4. High: Insecure backend URL defaults in desktop
- Risk: Token and credential leakage via plaintext transport if used outside local dev.
- Evidence: Default URL points to HTTP public IP.
- Plan: Enforce HTTPS in production builds, environment-based allowlist, certificate pinning strategy.

5. High: WebSocket token acceptance via URL query parameter (conditional)
- Risk: Token leakage in logs, browser history, proxy observability, and analytics.
- Evidence: Token from query accepted when revocation checks are disabled.
- Plan: Remove query-token auth path, require Authorization/subprotocol token + short-lived WS tickets.

6. Medium: Missing comprehensive HTTP response hardening
- Risk: Increased exploitability for clickjacking/MIME confusion/insecure browser behaviors.
- Evidence: No full security-header middleware at app level.
- Plan: Add strict header policy (HSTS, CSP where applicable, frame-ancestors, etc.) at proxy and app.

7. Medium: Public metrics endpoints
- Risk: Information disclosure and attacker reconnaissance.
- Evidence: /metrics and /metrics/prometheus reachable without auth.
- Plan: Restrict by network ACL, mTLS, auth token, or separate internal bind.

8. Medium: Potential auth brute-force exposure
- Risk: Credential stuffing and account takeover.
- Evidence: Global per-IP rate limiting exists; no targeted auth lockout/backoff controls observed for login/signup.
- Plan: Add auth endpoint-specific rate controls, risk-based lockouts, and account/IP anomaly detection.

9. Medium: Tenant context model can default silently
- Risk: Cross-tenant logic mistakes if authorization checks are incomplete in endpoints.
- Evidence: Header optional unless migration flag requires it.
- Plan: Enforce tenant scoping with validated claims and mandatory tenant policy in production.

10. Medium: Release supply chain hardening incomplete
- Risk: Artifact tampering, dependency compromise, over-permissive release flow.
- Evidence: CI lacks SCA/license checks/SBOM/attestation and stronger release protections.
- Plan: Add signed provenance, dependency scanning gates, protected environment approvals.

11. Medium: Runtime hardening for service unit is minimal
- Risk: Greater blast radius in host compromise scenarios.
- Evidence: systemd unit lacks hardening directives (NoNewPrivileges, ProtectSystem, etc.).
- Plan: Add service sandboxing and restricted filesystem/capabilities.

12. Low-Medium: Docker hardening and image minimization gaps
- Risk: Larger attack surface and container privilege risk.
- Evidence: Build/runtime split and non-root constraints not fully explicit.
- Plan: Multi-stage production image, non-root user, read-only root FS, dropped capabilities.

## 5. Control Plan by Security Domain

## 5.1 Architecture Security and Threat Modeling
Objectives:
- Make threat modeling repeatable and architecture-aware.
- Enforce security requirements at trust boundaries.

Actions:
- Create and maintain a formal data flow diagram for desktop-main-preload-renderer, API, DB, Redis, and third-party services.
- Define abuse cases for token theft, IPC misuse, malicious renderer content, and release/update tampering.
- Add security architecture review gate for major feature PRs.

Verification:
- Quarterly threat model review with tracked mitigations.
- Security acceptance checklist required for architecture changes.

## 5.2 Authentication and Authorization
Objectives:
- Enforce strong identity assurance and least privilege.
- Prevent token replay/reuse and role bypass.

Actions:
- Enforce in production at startup:
  - AUTH_SESSION_STORE_ENABLED=true
  - AUTH_REFRESH_ROTATION_ENABLED=true
  - AUTH_RBAC_ENFORCED=true
  - AUTH_TOTP_REQUIRED=true for privileged roles
- Remove bootstrap/demo credentials from production paths.
- Add login defense controls: per-account lockout/backoff, IP/device risk scoring, failed-attempt telemetry.
- Add mandatory role checks on all sensitive route groups and admin-like operations.
- Verify session state on high-risk actions, not only generic API guard.

Verification:
- Unit/integration tests for session revocation, refresh reuse detection, and role enforcement.
- Negative tests for cross-tenant and privilege escalation attempts.

## 5.3 API and Transport Security
Objectives:
- Guarantee confidentiality/integrity in transit.
- Reduce protocol and endpoint attack surface.

Actions:
- Require HTTPS for all non-local environments; block HTTP backend URLs in packaged desktop builds.
- Remove WebSocket query-token auth; use Authorization header or one-time WS token exchange.
- Add full HTTP hardening headers at reverse proxy and backend.
- Restrict /metrics and /metrics/prometheus to internal network or authenticated scrape.
- Tighten CORS to explicit origins and environment-specific allowlists.
- Add API payload validation consistency checks and explicit max sizes for high-volume endpoints.

Verification:
- Automated integration tests for transport rejection rules.
- DAST checks for missing headers and open endpoints.

## 5.4 Data Protection and Cryptography
Objectives:
- Protect sensitive data at rest and in processing paths.
- Ensure cryptographic constructions are modern and misuse-resistant.

Actions:
- Replace desktop fallback secret encryption with authenticated encryption and per-record integrity checks; remove static passphrase fallback.
- Classify data fields and enforce encryption-at-rest for sensitive DB columns where required.
- Store refresh token hashes only (already done) and ensure no plaintext token logging.
- Introduce key rotation policy for JWT signing and encryption keys.
- Separate keys by purpose (JWT signing, TOTP encryption, local secret storage), never reuse by fallback.

Verification:
- Cryptography code review checklist and test vectors.
- Regular key-rotation drills in staging.

## 5.5 Secrets Management
Objectives:
- Eliminate hardcoded and repository-stored secrets.
- Centralize secret lifecycle management.

Actions:
- Immediately rotate all credentials/secrets found in tracked environment files.
- Remove secret-bearing env files from git history where feasible and document incident handling.
- Move runtime secrets to secret manager (cloud KMS/Secrets Manager/Vault or equivalent).
- Add pre-commit and CI secret scanning (for example gitleaks/trufflehog + GitHub secret scanning).
- Add startup validation to fail when placeholder/default/dev secrets are used in production.

Verification:
- CI gate fails on detected secrets.
- Monthly secret inventory and rotation attestations.

## 5.6 Cloud and Infrastructure Hardening
Objectives:
- Reduce host/process compromise blast radius.
- Harden ingress and service runtime defaults.

Actions:
- Nginx:
  - Enforce TLS 1.2+ with modern ciphers and strict HSTS.
  - Add rate limits/WAF-like protections on auth endpoints.
  - Restrict proxy headers and hide upstream details.
- systemd:
  - Add NoNewPrivileges, PrivateTmp, ProtectSystem=strict, ProtectHome, RestrictAddressFamilies, MemoryDenyWriteExecute, CapabilityBoundingSet.
- Network:
  - Private DB/Redis bind; firewall allowlist only required ports.
- Container (if used): non-root execution, read-only root filesystem, distroless/slim runtime base.

Verification:
- CIS-like host hardening checklist.
- Automated infrastructure scans and periodic penetration testing.

## 5.7 Dependency and Supply Chain Security
Objectives:
- Detect vulnerable or tampered dependencies early.
- Strengthen release integrity and provenance.

Actions:
- Add dependency scanning and policy gate (pnpm audit plus SCA platform).
- Generate SBOM (CycloneDX/SPDX) for backend and desktop artifacts.
- Adopt signed build provenance (SLSA-style attestations where possible).
- Harden release workflow:
  - Require protected tags and manual approvals for production releases.
  - Limit write permissions and use environment secrets with required reviewers.
- Verify Electron auto-update chain integrity and enforce signed update artifacts.

Verification:
- CI fails on high/critical vulnerabilities unless explicitly risk-accepted.
- Release checklist includes provenance and signature validation.

## 5.8 Logging, Monitoring, and Detection
Objectives:
- Detect abuse quickly without leaking sensitive data.
- Improve forensic quality of audit trails.

Actions:
- Expand auth audit events to include failed login reasons, lockouts, unusual refresh patterns, and privilege events.
- Ensure logs never contain secrets, tokens, or sensitive payload data.
- Add security alerts for:
  - Login brute force and credential stuffing indicators.
  - Refresh token reuse spikes.
  - 401/403 anomaly bursts by endpoint and source.
  - Sensitive endpoint access from unusual geos/IP ranges.
- Centralize logs with retention, integrity controls, and alert routing.

Verification:
- Alert simulation exercises and runbook validation.
- Log quality audits for sensitive data leakage.

## 5.9 Incident Readiness and Response
Objectives:
- Reduce mean time to detect and recover.
- Standardize containment and communication.

Actions:
- Create an incident response playbook with severity levels, on-call matrix, containment steps, and legal/notification criteria.
- Define token compromise runbook (global session revocation, forced logout, key rotation).
- Define secret leak runbook (credential rotation, audit scope, timeline reconstruction).
- Run at least two tabletop exercises per year.

Verification:
- Post-incident review template and corrective-action tracking.
- Time-bound remediation SLAs by severity.

## 5.10 Security Verification and SDLC Practices
Objectives:
- Shift security left and continuously verify controls.

Actions:
- Add mandatory security test layers:
  - SAST for TypeScript/Electron code.
  - SCA for dependencies.
  - DAST against staging APIs.
  - Targeted fuzzing for parsers and high-risk request payloads.
- Add security-focused unit/integration tests for auth, IPC allowlist enforcement, token lifecycle, and tenant isolation.
- Add pre-release security checklist and sign-off gate.

Verification:
- Trend metrics: open vulns by severity, MTTR, test coverage on security-critical modules.
- Quarterly security posture review.

## 6. Prioritized Implementation Roadmap

## Phase 0 (0-7 days): Emergency Risk Reduction
- Rotate all exposed credentials and secrets immediately.
- Remove secret-bearing files from active branch and switch to secret manager injection.
- Enforce production startup checks for secure env values and disable unsafe defaults.
- Restrict public metrics endpoints.
- Disable WebSocket query-token auth path.

Exit criteria:
- No active production secrets in repo.
- Production boot fails if insecure auth flags/default secrets are present.

## Phase 1 (Week 2-4): Core Control Hardening
- Enforce RBAC and session store in production.
- Enable refresh token rotation and reuse detection globally.
- Enforce HTTPS-only backend targets for desktop production builds.
- Harden Electron IPC allowlist and remove permissive mode in production.
- Deploy baseline header policy and auth endpoint rate limits.

Exit criteria:
- Auth and transport policies enforced in production config.
- Security regression tests passing for auth and IPC.

## Phase 2 (Month 2): Infrastructure and Supply Chain Maturity
- Apply systemd/container hardening profiles.
- Add SCA, SBOM, secret scanning, and release provenance checks in CI/CD.
- Add release approval gates and protected tag policy.
- Expand detection/alerting and centralized security log aggregation.

Exit criteria:
- CI security gates active and blocking.
- Host and pipeline hardening baselines documented and validated.

## Phase 3 (Month 3+): Assurance and Continuous Improvement
- Conduct external penetration test and remediate findings.
- Execute incident tabletop drills and key-rotation exercises.
- Implement formal risk register governance and quarterly security reviews.

Exit criteria:
- Independent validation complete.
- Ongoing governance cadence established.

## 7. Security Requirements (Production Baseline)

Mandatory production requirements:
- No plaintext production secrets in repository.
- HTTPS everywhere outside localhost.
- Auth session store, refresh rotation, RBAC enabled.
- Privileged role 2FA enforced.
- IPC strict allowlist enabled.
- Security headers and restricted observability endpoints.
- Secret scanning and dependency scanning in CI.
- Incident runbooks tested at least twice per year.

## 8. Ownership Model

Recommended ownership:
- Platform/Infra: TLS, proxy, system hardening, secret manager, monitoring pipeline.
- Backend team: auth/session/token controls, API security, tenant isolation, audit events.
- Desktop team: IPC boundary, secure storage, updater/channel hardening.
- DevEx/Release: CI/CD security gates, SBOM/provenance, dependency policy.
- Security lead: threat modeling, risk acceptance, incident governance.

## 9. Success Metrics

Track monthly:
- Count of critical/high vulnerabilities open beyond SLA.
- Mean time to remediate by severity.
- Percent of production services with hardened runtime profile.
- Percent of releases with SBOM and attestation.
- Failed auth anomaly detection time and response time.
- Security test pass rate in CI.

## 10. Immediate Next Actions Checklist

1. Trigger credential and key rotation for all exposed values.
2. Remove tracked production secret files and migrate to managed secret injection.
3. Set production-safe auth and IPC flags and enforce fail-fast validation.
4. Enforce HTTPS-only backend endpoint in desktop production mode.
5. Lock down metrics endpoints and add missing security headers.
6. Add secret scanning + SCA + SBOM generation in CI.
7. Schedule a focused security hardening sprint with owners and deadlines.

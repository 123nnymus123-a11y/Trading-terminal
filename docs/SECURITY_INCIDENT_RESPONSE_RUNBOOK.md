# Security Incident Response Runbook

Date: 2026-04-12
Scope: Trading Terminal backend, desktop, CI/CD, and release supply chain

## 1. Severity Model

- SEV-1: Active compromise, credential theft, broad user/data impact, or release tampering.
- SEV-2: Confirmed security weakness with likely exploitability but limited active impact.
- SEV-3: Security defect with low immediate exploitability or compensating controls in place.

## 2. Incident Command Roles

- Incident Commander: Owns decision flow and timeline.
- Security Lead: Owns containment/eradication strategy.
- Backend Lead: API/auth/session controls and DB safeguards.
- Desktop Lead: IPC/session/local secret handling and update channel actions.
- Infra Lead: Network, proxy, host, secret manager, and runtime isolation.
- Comms Owner: Internal/external notifications and status cadence.

## 3. Detection Triggers

- Spikes in 401/403/429 or auth lockout events.
- Refresh token reuse or abnormal session revocations.
- Secret scanning alerts or exposed credential reports.
- Unexpected release artifacts or update feed anomalies.
- Unauthorized changes to protected branches/workflows.

## 4. Immediate Response Checklist (0-30 min)

1. Declare incident and assign severity.
2. Freeze risky deploys/releases.
3. Capture timeline start and all known indicators.
4. Enable heightened logging and preserve volatile evidence.
5. Contain blast radius:
   - Revoke affected sessions.
   - Rotate exposed API keys and secrets.
   - Restrict ingress where needed.

## 5. Containment Playbooks

## 5.1 Suspected Credential/Secret Leak

1. Disable leaked credential immediately.
2. Rotate all potentially related credentials.
3. Validate no hardcoded secret remains in repository and CI variables.
4. Re-run secret scanning and dependency review.
5. Record exact rotation timestamps and owners.

## 5.2 Auth Token Compromise

1. Revoke user/all sessions as applicable.
2. Enforce re-authentication.
3. Verify refresh-token rotation and reuse detection are active.
4. Increase auth lockout/rate limits temporarily.

## 5.3 Release/Updater Supply-Chain Incident

1. Pause release workflow and tag protection bypass paths.
2. Unpublish or deprecate affected artifacts.
3. Verify checksums/signatures/provenance of latest release.
4. Rebuild from known-good commit and republish.

## 6. Eradication and Recovery

1. Patch root cause in code/config/workflow.
2. Validate with tests and security gates.
3. Restore normal traffic gradually.
4. Monitor post-recovery for recurrence indicators.

## 7. Communications

- Internal updates every 30 minutes for SEV-1/SEV-2.
- External notifications based on legal/compliance obligations.
- Post-incident summary shared with impact, fix, and prevention actions.

## 8. Post-Incident Review (within 5 business days)

1. Build factual timeline.
2. Identify root cause and contributing factors.
3. Define corrective actions with owners and due dates.
4. Update detection rules, runbooks, and tests.
5. Track closure in security backlog.

## 9. Evidence Preservation

- Keep raw logs, workflow run metadata, and key config snapshots.
- Preserve DB audit events relevant to incident window.
- Retain terminal outputs and deployment history for forensic traceability.

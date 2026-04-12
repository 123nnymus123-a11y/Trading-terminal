# Security Threat Model Template

Use this template for major features touching auth, IPC, networking, persistence, or release flows.

## 1. Feature Summary

- Feature name:
- Owner:
- Date:
- Systems touched:

## 2. Data Flow and Trust Boundaries

- Entry points:
- Data stores:
- External dependencies:
- Trust boundaries crossed:

## 3. Assets at Risk

- Credentials/tokens:
- Sensitive business/user data:
- Release/update artifacts:

## 4. Threat Scenarios

For each scenario define:
- Threat actor:
- Attack path:
- Impact:
- Existing controls:
- Control gaps:

Minimum scenarios:
- Authentication bypass/escalation
- Token theft/replay/reuse
- IPC misuse (renderer to main)
- Transport downgrade or MITM
- Secrets leakage in code/CI/runtime
- Dependency/release supply-chain tampering

## 5. Risk Ratings

- Likelihood: Low/Medium/High
- Impact: Low/Medium/High/Critical
- Overall severity:

## 6. Mitigations

- Preventive controls:
- Detective controls:
- Recovery controls:
- Residual risk and rationale:

## 7. Verification Plan

- Unit tests:
- Integration tests:
- Security tests (SAST/SCA/DAST):
- Manual validation steps:

## 8. Sign-off

- Engineering lead:
- Security lead:
- Release approver:

# Changelog

All notable changes to this project are documented in this file.

## v1.2.0 - 2026-04-12

### Added
- Security CI workflow and CodeQL workflow for continuous security scanning.
- PM2 deployment support and operational scripts for backend deploy, verification, secret rotation, and security smoke testing.
- Graph SOR migration and new graph SOR repository/service backend modules.
- Security documentation set, including threat model template, release checklist, staging-production rollout, and incident response runbook.
- Authentication/deployment quick-reference docs and onboarding guides.

### Changed
- Backend authentication/session and runtime configuration handling in server, infra, contracts, and websocket hub paths.
- Backend environment example files and monitoring/system service configuration (Prometheus alerts/scrape, Nginx, systemd).
- Desktop backend connectivity and secrets handling across main, preload, shared config/API client, and settings logs UI.
- Desktop installer build script updates for release packaging behavior.

### Notes
- Release tag `v1.2.0` was created from commit `b560118` in `TradingTerminal-SourceCode`.
- Public artifact publication is expected in `123nnymus123-a11y/Trading-terminal` via the release automation pipeline.
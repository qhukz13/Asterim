Task-ID: P10-01
Phase: 10

# [P10-01] — Enterprise Fleet Policy Engine, Governance Rules & Structured SIEM Audit Exporter

**Task ID:** P10-01  
**Phase:** Phase 10 — Enterprise Fleet Deployment, Air-Gapped Sovereign Appliances & GA Packaging  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-18  

---

## 1. Objective

Implement the Enterprise Fleet Policy Engine and Structured SIEM Audit Exporter in `apps/server`: add SQL migration `004_fleet_policies.sql`, author `FleetPolicyService.ts` for enforcing centralized model allowlists, banned command patterns, and mandatory approval thresholds, author `AuditLoggerService.ts` for structured event capture and RFC 5424 Syslog / JSON-Lines export with automatic secret redaction, expose authenticated REST endpoints under `/api/v1/enterprise`, and author a comprehensive automated test suite.

---

## 2. Why This Task Exists

As established in `blueprint/ROADMAP.md` (Phase 10), enterprise organizations require centralized security governance, strict compliance boundaries, and tamper-evident audit trails when deploying AI agent platforms across developer fleets.

The Fleet Policy Engine enables administrators to enforce organizational constraints (such as blocking high-risk models, forbidding destructive shell patterns like `rm -rf /` or `curl | sh`, and mandating Sovereign Mode), while the Structured Audit Exporter streams all security clearances, agent dispatches, and policy violations into enterprise SIEM / SOC pipelines.

---

## 3. Context & Architecture

- **Fleet Policy Specification (`FleetPolicyService`)**:
  - File-based policy support (`asterim.policy.json` in data directory) taking precedence over database policies for immutable IT configuration.
  - Policy enforcement:
    - Model allowlist / blocklist (`allowedModels`).
    - Banned shell command patterns (`bannedCommandPatterns`).
    - Forced Sovereign Mode (`enforceSovereignMode`).
    - Approval threshold enforcement (`requireApprovalThreshold`).
- **Structured Audit Logging (`AuditLoggerService`)**:
  - Structured event schema tracking timestamp, event type, severity (`INFO`, `WARN`, `HIGH`, `CRITICAL`), user identity, thread ID, action, risk level, and metadata.
  - Dual persistence: local SQLite `audit_events` table + append-only `audit.log` stream.
  - Automated secret redaction (`SecretVaultService.redactSecrets`) ensuring no tokens or credentials leak into audit streams.
  - Export formats: JSON-Lines (JSONL) and Syslog RFC 5424 for enterprise log collectors (Datadog, Splunk, Elastic).

---

## 4. Implementation Scope

1. **SQL Migration (`packages/server/src/migrations/004_fleet_policies.sql`)**:
   - `fleet_policies`: `id TEXT PRIMARY KEY`, `name TEXT NOT NULL`, `description TEXT`, `is_active INTEGER NOT NULL DEFAULT 1`, `allowed_models_json TEXT NOT NULL DEFAULT '["*"]'`, `banned_commands_json TEXT NOT NULL DEFAULT '[]'`, `enforce_sovereign_mode INTEGER NOT NULL DEFAULT 0`, `require_approval_risk_level TEXT NOT NULL DEFAULT 'HIGH'`, `created_at INTEGER NOT NULL`, `updated_at INTEGER NOT NULL`.
   - `audit_events`: `id TEXT PRIMARY KEY`, `timestamp INTEGER NOT NULL`, `event_type TEXT NOT NULL`, `severity TEXT NOT NULL DEFAULT 'INFO'`, `user_id TEXT`, `user_name TEXT`, `thread_id TEXT`, `action TEXT NOT NULL`, `risk_level TEXT`, `metadata_json TEXT NOT NULL DEFAULT '{}'`, `ip_address TEXT`.
   - Indexes: `idx_audit_events_timestamp`, `idx_audit_events_type_severity`.

2. **Shared Types (`packages/shared/src/types/fleet.ts`)**:
   - `FleetPolicy`, `FleetPolicyConfig`, `AuditEvent`, `AuditSeverity` (`INFO` | `WARN` | `HIGH` | `CRITICAL`), `AuditExportFormat` (`JSONL` | `SYSLOG_RFC5424` | `CSV`).
   - Export from `packages/shared/src/index.ts`.

3. **`FleetPolicyService.ts` (`apps/server/src/services/enterprise/FleetPolicyService.ts`)**:
   - Load policies from `asterim.policy.json` (if present) or SQLite table `fleet_policies`.
   - `validateModel(model: string): { allowed: boolean; reason?: string }`
   - `validateCommand(command: string): { allowed: boolean; violationReason?: string }`
   - `isSovereignModeForced(): boolean`
   - Integrated into `ApprovalManager.ts` and `AgentService.ts` (rejects unapproved models or banned commands before PTY spawn).

4. **`AuditLoggerService.ts` (`apps/server/src/services/enterprise/AuditLoggerService.ts`)**:
   - `logEvent(event: Omit<AuditEvent, 'id' | 'timestamp'>): Promise<AuditEvent>`
   - Appends to SQLite `audit_events` and writes JSON-lines to `<dataDir>/audit.log`.
   - Integrates with `SecretVaultService` to scrub credentials before persisting.
   - `exportLogs(options: { startTime?: number; endTime?: number; format: AuditExportFormat; minSeverity?: AuditSeverity }): string`
   - Subscribes to `EventBus` events (`agent:approval_required`, `client:approval_response`, `agent:started`, `agent:stopped`, `policy:violation`).

5. **REST API Endpoints (`apps/server/src/routes/enterprise.ts`)**:
   - `GET /api/v1/enterprise/policy` — Get active fleet policy.
   - `PUT /api/v1/enterprise/policy` — Update fleet policy.
   - `GET /api/v1/enterprise/audit-logs` — Query audit logs with pagination and filters.
   - `GET /api/v1/enterprise/audit-logs/export` — Stream audit export in JSONL or Syslog RFC 5424 format.
   - Register in `apps/server/src/server.ts`.

6. **Automated Unit & Integration Test Suite (`apps/server/src/services/enterprise/__tests__/FleetGovernance.test.ts`)**:
   - Test file-based `asterim.policy.json` loading and precedence over database settings.
   - Test banned command detection and model allowlist enforcement.
   - Test audit log capture and persistence on security events.
   - Test Syslog RFC 5424 formatting and JSON-Lines export.
   - Test secret redaction in audit payloads.
   - Wire into `apps/server/package.json` `"test"` script.

---

## 5. Constraints & Forbidden Changes

- Banned commands must fail closed with an immediate audit event and must never reach the PTY stream.
- Audit logs must never contain unredacted secrets or passwords.
- Maintain 100% test pass rate across all existing monorepo test suites.

---

## 6. Acceptance Criteria

1. Migration `004_fleet_policies.sql` applies cleanly via `MigrationEngine`.
2. `FleetPolicyService` enforces model allowlists and blocks banned commands before execution.
3. `AuditLoggerService` records structured audit events and writes to both SQLite and `<dataDir>/audit.log`.
4. Sensitive credentials are automatically redacted in all audit log entries.
5. Syslog RFC 5424 and JSONL exports generate valid, parseable log frames.
6. Authenticated REST routes under `/api/v1/enterprise/` function correctly.
7. `FleetGovernance.test.ts` passes with comprehensive policy and audit assertions.
8. Monorepo CI gates pass with 0 errors: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run build`.

---

## 7. Definition of Done

- [ ] `004_fleet_policies.sql` created and verified
- [ ] Shared fleet types in `@asterim/shared`
- [ ] `FleetPolicyService.ts` implemented
- [ ] `AuditLoggerService.ts` implemented
- [ ] REST routes registered in `server.ts`
- [ ] `FleetGovernance.test.ts` created and passing
- [ ] Monorepo CI gates pass cleanly

---

## 8. Verification Commands

```bash
# Run new Fleet Governance & Audit test suite
pnpm --filter asterim exec tsx src/services/enterprise/__tests__/FleetGovernance.test.ts

# Run pipeline, team agent & security test suites
pnpm --filter asterim exec tsx src/services/pipeline/__tests__/PipelineEngine.test.ts
pnpm --filter asterim exec tsx src/services/security/__tests__/SecretVaultService.test.ts

# Run full monorepo CI validation
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

---

## 9. Required Report

Write report to `reports/current.md` matching `.agents/templates/REPORT_TEMPLATE.md`.

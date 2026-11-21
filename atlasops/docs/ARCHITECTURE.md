# Architecture & data contracts

## Service boundary

```text
Browser (same-origin HTTPS)                 Controlled Android device / corporate SIM
        |                                                  |
        v                                                  v
Nginx web (SPA + /api reverse proxy)         RoleManager + CallLog + SIM filter
        |                                                  |
        v                                                  v
Fastify API  <--------------------------------- Device enrollment + token-auth batch
  | auth, CSRF, RBAC, provenance, audit
  |                         Optional preauthorized transcript
  |                                            |
  v                                            v
PostgreSQL 18 / RLS                     AES-256-GCM at rest
  |                                            |
  +--> CRM / expenses / calls                  +--> optional external AI (explicit approval)
  +--> metrics and deterministic rules
```

## Trust levels

The device synchronizes `CallLog.Calls` metadata only when holding the default dialer role and restricted call-log permission. An employee's business SIM selection filters `PHONE_ACCOUNT_ID`, and the software **will not** upload anything when no selection is available. The browser may separately create an `employee_reported` call; operator documents are `carrier_statement`. No carrier API is configured, so `carrier_api` is a reserved label and zero rows should carry it unless future approved code changes.

Identity roles (`owner`,`admin`,`manager`,`analyst`,`agent`) are checked server-side. The browser is not the authority. Every business operation uses a single transaction that sets `app.tenant_id` for PostgreSQL FORCE ROW LEVEL SECURITY. Referenced objects use composite `(tenant_id,id)` foreign keys. `atlasops_runtime` is a non-superuser DB role, not a table owner.

`tenant_directory` is an unscoped lookup needed to find a tenant by its exact slug during login. `auth_sessions`, `enrollment_directory` and `device_directory` hold hashes of high-entropy credentials and authorized tenant IDs. They are never available as generic business query endpoints.

## Data stores

Core tables:
`organizations`, `users`, `auth_sessions`, `employees`, `sim_cards`, `devices`, `device_enrollments`, `customers`, `leads`, `deals`, `call_events`, `tasks`, `expenses`, `revenue_events`, `carrier_imports`, `audit_events`, `analysis_reports`, `approved_transcripts`, and credential directories.

The `call_events` constraints deduplicate device `(tenant_id,device_id,external_id)` and carrier `(tenant_id,sim_id,carrier_reference)` events. Carrier matching only upgrades a previously unmatched device row when there is exactly one matching candidate within 90 seconds and 2 seconds of duration. Other mismatches are inserted as distinct statement events for investigation.

## Money & attribution semantics

All monetary amounts are MZN (`numeric(14,2)`); the web format uses MZN/MT. `estimated_cost_mzn` is an estimate and `actual_cost_mzn` is a **statement/provider reported** amount, not necessarily independently verified. A bundle price does not imply per-minute airtime deduction. `revenue_events` counts only `confirmed` records. Reported sales/deals are **not** automatically cash receipts. Tracked contribution after expenses is **not** net profit. Expense and revenue records are logged, not a legally certified accounting ledger.

## Reporting

The 7/30/90-day dashboard uses transaction-scoped aggregate queries. Agent visibility is restricted to the linked `employees.user_id`; an agent with no link receives no company-wide performance records. Daily reports use `Africa/Maputo` for day bucketing; no invented data is seeded.

`explainable-rules-v1` produces evidence-linked recommendations. The separate AI transcript module is explicitly opt-in and rejects calls when encryption/AI keys are not configured. Prompted transcript content is treated as untrusted data; model output is schema-validated.

## Deploying at scale

Replace in-memory rate limits with a shared store. Set up TLS, reverse-proxy trust boundaries, automated backups and restore tests, external metrics/logs/alerts, database migration orchestration, secret rotation, email delivery, account recovery, MFA, a retention schedule, and an authenticated carrier-integration contract before commercial launch.

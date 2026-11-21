# AtlasOps — Operations Intelligence Platform

**Mozambique-first multi-tenant operations software (source project)**

Includes a web dashboard, API, PostgreSQL data model, corporate SIM/device workflow, call-activity reconciliation, sales and task management, costs/revenue, audit events, rule-based intelligence, optional transcript-based external AI, and an experimental Android default dialer/client.

> **STATUS — NOT PRODUCTION-CERTIFIED.** This source package is a substantial implementation, **not a claim that a complete commercially deployed or fully verified product exists**. Automated rule-engine tests ran successfully in the build environment. Database integration, front-end compilation, Docker deployment, device/OEM testing, carrier API access, external AI, security audit, and legal review could not be completed here. See `docs/RELEASE_READINESS.md` before onboarding paying customers.

## Start the web service (local developer setup)

Requirements: **Docker Engine + Docker Compose**, a machine with enough resources for Postgres 18, API, and front end.

1. Copy `.env.example` to `.env`.
2. Replace `POSTGRES_PASSWORD`, `POSTGRES_APP_PASSWORD`, `SIGNUP_INVITE_CODE` with **three different long random secrets**. Ensure the password in `DATABASE_URL` matches `POSTGRES_APP_PASSWORD`. URL-encode special characters or use hex-only secrets.
3. Optional transcript module: generate a 32-byte key using `openssl rand -base64 32`, set `TRANSCRIPT_ENCRYPTION_KEY_BASE64`. Safeguard it; losing it makes existing transcripts unreadable.
4. Run:

   ```bash
   docker compose up --build -d
   docker compose ps
   ```

5. Open **http://localhost:8080**. Select **Criar workspace**, enter the same `SIGNUP_INVITE_CODE`, set the organization, slug, owner email and strong password.
6. Create staff accounts in `Acessos` and associate user IDs with employees in `Equipa` (users' IDs are available via the account API). Add company SIMs assigned to employees, then begin using CRM, call records, expenses and revenue. To enroll Android hardware, see below.

**Caution:** Web is bound to `127.0.0.1` on purpose. For production, put a trusted HTTPS ingress in front, set `PUBLIC_ORIGIN=https://your-domain`, configure hostnames/TLS, and review proxy headers. Never publicly expose this Compose deployment unchanged.

## Start API and web separately

The Compose service is the easiest way to run Postgres. Local Node uses Node 26 LTS (Node 22+ is supported for basic development):

```bash
cd api && npm install && npm run dev
cd web && npm install && npm run dev
```

For locally launched API processes, change `DATABASE_URL` host from `db` to `127.0.0.1` and publish an appropriately restricted local PostgreSQL port. The default Compose network does not publish database ports.

## Feature map

| Area | Included now | Important limit |
|---|---|---|
| Organizations & users | Organization registration, sessions, roles, user creation, account disabling, password change | No verified email invitation delivery, recovery workflow, MFA or SSO |
| Employee/phone tracking | Employee–SIM–device mapping, Android enrollment, hashed device credentials, opt-in call-log sync | Android component is **experimental** and requires default-dialer rights, platform review, device testing; not iOS |
| Call intelligence | Attempts, direction, duration, outcomes, source/provenance, estimated vs. statement cost | SIM cannot automatically provide both-side audio, carrier truth or prepaid balance without integration |
| Operator reconciliation | Manual JSON statement import with conservative matching and idempotent references | An uploaded statement is marked `carrier_statement`, NOT carrier-verified |
| CRM & operations | Customers, leads, deals, tasks, employees, SIMs, revenue, expenses | Manual data can be inaccurate; external ERP/accounting is not integrated |
| Analytics | Actual counts, per-person summaries, 7/30/90 day trend, explainable recommendations | Rules-based decision support, not predictive ML |
| AI call coaching | Consent-attested encrypted transcript storage and optional external model review | No automatic audio capture or transcription; optional external API must be provisioned |
| Audit and security | Tenant RLS, limited database runtime role, RBAC, Argon2id, CSRF, session hashing, HTTPS-ready, audit events | Independent penetration testing, security monitoring and compliance review still needed |
| Scaling/production | Container images, CI workflow, schema, docs, health endpoints | Need external backup/restore, observability, availability engineering, legal validation and production load tests |

## Operating workflow

1. Owner registers a workspace and provisions employees, accounts and company SIM assignments.
2. Admin enrolls an Android device using a **one-time enrollment token**. It is redeemed for a hashed-at-rest, revocable device token.
3. The employee explicitly sets the corporate dialer as Android's default phone app, accepts sensitive permissions, and selects the **company** phone account. Sync intentionally fails closed if it cannot recognize the selected company SIM.
4. The phone submits call **metadata only**; the backend labels the records `device_reported`, which is not independent verification.
5. Business admins can import operator itemizations with cost and external reference; matches are reconciled by account, remote number, time and duration. These become `carrier_statement` — still not cryptographically verified by the carrier.
6. Sales staff link calls to customers/leads, update outcomes, and track deals/revenue. Managers can review verified provenance per record.
7. The insights engine produces explainable warnings derived from recorded metrics.
8. Optionally, an approved third-party recording workflow can submit a **lawfully obtained transcript**; a manager must explicitly authorize any external AI processing.

## Evidence labels

- `employee_reported`: entered through a user account — **not independent**.
- `device_reported`: submitted by an enrolled app — device-sourced, but root access or hostile devices can forge it.
- `carrier_statement`: uploaded/reconciled from a statement by an admin — trusted only to the extent the statement is authentic.
- `carrier_api`: reserved for a future **authenticated commercial carrier integration**. No available project endpoint grants this level today.

Never call a reported field "verified" solely because a device or employee provided it.

## Android build and safety

Source: `android/`. Open it as a **separate project** in Android Studio with Android SDK 37, JDK 17 and Gradle 9.6 / AGP 9.4. If your machine lacks Gradle wrapper scripts/JAR, install an appropriate Gradle distribution or generate the official wrapper with `gradle wrapper --gradle-version 9.6.0` before CLI builds. A compatible Android Studio version is required.

**DO NOT install as your daily/only dialer yet.** It becomes the system default phone UI and has NOT passed OEM/lock-screen/incoming-call/emergency-calling/Bluetooth/conference/dual-SIM certification. Use a dedicated controlled test handset/SIM and review [Android's official requirements](https://developer.android.com/develop/connectivity/telecom/dialer-app). Google Play treats READ_CALL_LOG as a restricted sensitive permission; consult [its permission policy](https://support.google.com/googleplay/android-developer/answer/18265346) before distribution. Test on the exact Android/OEM versions customers use.

Set the app's server URL to a real **HTTPS** domain (local HTTP is intentionally refused). Onboard the SIM and employee on the web console first. Your Android role and permissions are voluntary and revocable.

## Development verification

```bash
cd api
node --test test/*.test.js
find src -name '*.js' -exec node --check {} \;
```

The tests include a PostgreSQL tenant isolation/CSRF integration test that runs only when `RUN_INTEGRATION_TESTS=1` and the DB is initialized with the **non-superuser** runtime role. `.github/workflows/ci.yml` demonstrates a full CI test/build environment, but workflow execution has not been verified in this environment.

## API endpoints

See `docs/API.md` for request payloads and roles. All web routes are under `/api`. Opaque session auth uses Strict SameSite cookies + CSRF header; device calls use distinct device tokens. Example code must not publish real customer numbers or secrets in issues or screenshots.

## Supporting files

- `docs/ARCHITECTURE.md` — isolation, data and trust architecture.
- `docs/SECURITY.md` — threat model and secure deployment recommendations.
- `docs/RELEASE_READINESS.md` — production blockers, test cases and deployment gate.
- `docs/API.md` — API guide and examples.
- `db/migrations/` — Postgres schema and limited-runtime-role bootstrap.

> **Database upgrade warning:** Docker's init scripts execute **only for a new, empty database volume**. Future schema changes require a proper migration runner, backups and an upgrade procedure. Never run `docker compose down -v` on a real database.

# Production release gate

This is a source implementation delivered in one development session, **not** a finished externally audited SaaS release. The remaining conditions are material blockers for live commercial use.

## Verified in the creation environment

- ✅ All API JavaScript files passed `node --check`.
- ✅ Four deterministic crypto/analytics tests passed using Node's built-in test runner.
- ✅ TypeScript/TSX source files parsed without syntax diagnostics using the installed TypeScript parser.
- ✅ No sample business activity is added to database initialization.

## Not verified in the creation environment

- ☐ `npm install` / web build: npm registry access unavailable in the execution sandbox.
- ☐ Docker Compose up and migration execution: Docker / PostgreSQL CLI/server unavailable here.
- ☐ CI integration tests: source provided, but `RUN_INTEGRATION_TESTS=1` requires a live initialized Postgres server and dependencies.
- ☐ Android Gradle build: Android SDK, Gradle wrapper JAR and device/emulator unavailable here.
- ☐ Android default-dialer compatibility and emergency calling: must test and certify.
- ☐ Operator APIs: no agreements, credentials or authenticated CDR service was supplied.
- ☐ AI provider response: no real key/model connected or tested. No automatic SIM audio recording/transcription exists.
- ☐ Penetration, load, accessibility, user acceptance and legal/privacy testing.

## Shipping requirements

1. Install dependencies and run automated tests in CI; fix any build/integration issues before deployment.
2. Run migrations on a new PostgreSQL 18 instance; confirm runtime role is neither superuser nor RLS-bypass user.
3. Test auth, tenant isolation, device enrollment, imports, financial analytics and transcript encryption with integration and end-to-end tests.
4. Connect the web console to a real HTTPS origin. Lock down trusted proxy and security response headers.
5. Establish carrier data integrations or signed company-provided statement ingestion; label evidence appropriately.
6. Finalize operations requirements (backup/restore, monitoring, retention, rate limit, MFA and legal compliance).
7. Validate Android on controlled devices before any real employee uses it as a default dialer.

Do **not** advertise "carrier-verified" data until the operator integration exists; do **not** advertise AI listening to SIM calls without an authorized recording path.

# Security model, privacy and known risks

## Protections implemented

- Argon2id password hashes, minimum 12-character passwords, DB-backed opaque 256-bit random sessions and constant-time CSRF comparison.
- Secure/HttpOnly/Strict cookies under `NODE_ENV=production`. Mutation endpoints require JSON, same-origin browser request and session-matched CSRF header.
- Access roles in backend, including per-agent scoping for leads, deals, tasks and calls.
- PostgreSQL `FORCE ROW LEVEL SECURITY` with a transaction-scoped `app.tenant_id` and a separate `NOSUPERUSER NOBYPASSRLS` app role.
- Composite tenant foreign keys, server-side typed input validation, parameterized values, deduplication, append-only API audit records, revocable device credentials and hashed enrollment codes.
- No microphone, audio recording or SMS access in Android code. Sync is restricted to the explicitly chosen corporate account and fails closed if not available.
- Optional transcript encryption via AES-256-GCM; customer transcript is not returned via list APIs or exposed in logs. External AI use is a separately gated, affirmative action.
- No example/demo credentials or fake business data automatically inserted into real tenants.

## Trust failures not preventable by software alone

- Employees can fabricate manual outcomes; Android devices can be compromised, clock-altered or rooted. Neither is proof of successful conversation.
- A human can upload altered carrier statements. A genuine, signed operator integration requires contract and implementation.
- A manager can type an inaccurate customer transcript or consent basis. Uploading it is an attestation, not a technical verification of consent.
- Local telecom charge amounts and bundle deductions cannot be known from call length alone.
- Phones may present SIM account identifiers differently; wrong mapping risks personal-number privacy. Controlled device tests are mandatory.
- The app's limited incoming-call UI is **not** certified for all emergency/assisted/conference/video/Bluetooth cases.

## Required before using with real employees

1. Engage Mozambican counsel on workplace monitoring, telecom-record privacy, customer consent, retention periods, cross-border transfers and employment notices.
2. Provide employee transparency notices, a clear corporate-SIM-only policy, and customer call-recording notices when lawful recording is used.
3. Build a legitimate approved carrier CDR interface and establish who has authority to request this information.
4. Have independent penetration testers evaluate RLS bypass, auth, API/Android clients, business logic, financial record tampering and secrets.
5. Add centrally managed credentials, 2FA/MFA, email verification/invitations, password reset/SSO, security monitoring, IP-aware shared rate limiting and emergency revoke.
6. Establish encrypted offsite backups and restore tests, retention/deletion policies, data-subject request procedures, crash recovery, operational SLAs and incident response.
7. Test the dialer on target OEM devices. Do **not** make it the phone app on a sole or business-critical handset before certification.
8. Restrict PostgreSQL runtime role/network. The migrator/DB administrator must remain a separate privileged identity.

## Key rotation

Rotate password/DB credentials through managed secrets and revoke sessions after a suspected breach. `TRANSCRIPT_ENCRYPTION_KEY_BASE64` uses one key and does not yet support transparent rotation. Plan envelope encryption and key versioning before storing significant volumes of private transcripts. A lost transcript key is not recoverable.

## Security test plan

- Two tenants each create a customer with identical names; both lists remain isolated.
- From tenant A, request tenant B's known UUID: 404; attempt FK crosslink: 400.
- Use runtime DB role to `SELECT * FROM customers` without app.tenant_id: zero rows due FORCE RLS.
- Agent with no linked employee receives zero company-wide analytics; linked agent sees only assigned work.
- Browser POST without CSRF: 403. Browser cross-origin mutation: 403.
- Revoked/expired enrollment token cannot create second device; revoked device cannot sync.
- Duplicate device event cannot be billed twice; duplicate carrier reference is ignored.
- A statement with ambiguous matches never auto-upgrades a device record.
- Transcript creation with no encryption key: 503; analyze without model/API key: 503; viewer cannot decrypt raw transcripts.
- Tampered ciphertext must fail authenticated decryption.
- Device with no corporate phone account or no default-dialer permission refuses sync.

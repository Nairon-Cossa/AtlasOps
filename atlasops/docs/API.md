# API reference — AtlasOps v1

All routes start with `/api`, respond JSON, and are same-origin behind the web gateway. Mutation requests use `Content-Type: application/json`. User routes authenticate through `ao_session` (HttpOnly cookie) and `x-csrf-token` (value from `ao_csrf` cookie). Device routes use their own `Authorization: Device <token>` header and do not use browser cookies.

## Authentication

| Route | Method | Use | Access |
|---|---|---|---|
| `/auth/register` | POST | Register workspace and owner with `signupCode` | invitation code |
| `/auth/login` | POST | Log in with exact workspace slug, email, password | public |
| `/auth/me` | GET | Current member and workspace | any user |
| `/auth/logout` | POST | Revoke current session | any user |
| `/auth/change-password` | POST | Change password and revoke other sessions | any user |
| `/auth/users` | GET/POST | List/create users | owner/admin |
| `/auth/users/:id` | PATCH | Set account role or active/disabled | owner/admin (with admin restrictions) |

Example registration:

```json
{
 "orgName":"Oficina Comercial Lda",
 "slug":"oficina-comercial",
 "fullName":"Business Owner",
 "email":"owner@example.co.mz",
 "password":"your-own-strong-password-at-least-12-characters",
 "signupCode":"YOUR_REGISTRATION_INVITE_SECRET"
}
```

`POST /auth/users` requires `email`, `fullName`, `password`, `role`. To link a user to their employee entity, create an employee with `user_id` equal to the returned user UUID. Agents must be linked to their employee to see assigned operations.

## Organization resources

All generic resource paths use `/data/:resource` and `/data/:resource/:id` with `GET` list, `GET` record, `POST` create, `PATCH` partial update and (where permitted) `DELETE`. Pagination uses `?limit=30&offset=0` (maximum 100).

| Resource name | Table | Write access |
|---|---|---|
| `employees` | `employees` | owner/admin/manager |
| `sims` | `sim_cards` | owner/admin |
| `customers` | `customers` | owner/admin/manager/agent |
| `leads` | `leads` | owner/admin/manager/assigned agent |
| `deals` | `deals` | owner/admin/manager/assigned agent |
| `tasks` | `tasks` | owner/admin/manager/assigned agent |
| `expenses` | `expenses` | owner/admin/manager |
| `revenue` | `revenue_events` | owner/admin/manager |

Reader rights are role-scoped, and agent records are filtered to the linked employee. Analysts are read-only. Financial items cannot be deleted through the generic API; instead revenue can be marked `reversed` and corrections must retain an audit trail.

Create a company SIM:

```json
{
 "employee_id":"YOUR_EMPLOYEE_UUID",
 "phone_e164":"+258840000000",
 "carrier":"Vodacom",
 "status":"active",
 "monthly_bundle_mzn":500
}
```

Create a customer and lead:

```json
{"name":"Cliente Exemplo", "phone_e164":"+258840000000", "industry":"Retail"}
```

```json
{
 "title":"Fornecimento mensal",
 "customer_id":"CUSTOMER_UUID",
 "employee_id":"EMPLOYEE_UUID",
 "status":"qualified",
 "expected_value_mzn":25000
}
```

Create an expense (UTC timestamp accepted with explicit offset):

```json
{
 "category":"Transport",
 "description":"Fuel for field visits",
 "amount_mzn":850,
 "occurred_at":"2026-11-14T10:00:00+02:00"
}
```

## Calls & operator reconciliation

| Route | Method | Access |
|---|---|---|
| `/calls` | GET | scoped user |
| `/calls` | POST | owner/admin/manager/agent |
| `/calls/:id/outcome` | PATCH | owner/admin/manager/assigned agent |
| `/carrier/statement-import` | POST | owner/admin |
| `/carrier/imports` | GET | owner/admin/manager/analyst |

Manual call example (evidence is always `employee_reported`, never supplied by browser):

```json
{
 "employee_id":"EMPLOYEE_UUID",
 "sim_id":"SIM_UUID",
 "remote_phone_e164":"+258840000000",
 "direction":"outgoing",
 "started_at":"2026-11-14T10:00:00+02:00",
 "duration_seconds":121,
 "estimated_cost_mzn":6.5,
 "outcome":"followup"
}
```

Carrier statement import (`rows` length 1–500; source is `carrier_statement`):

```json
{
 "carrier":"Vodacom",
 "filename":"business-statement.json",
 "rows":[{
   "simId":"SIM_UUID",
   "externalReference":"operator-row-123",
   "remotePhoneE164":"+258840000000",
   "direction":"outgoing",
   "startedAt":"2026-11-14T10:00:00+02:00",
   "durationSeconds":121,
   "actualCostMzn":5.5
 }]
}
```

For an enterprise carrier API integration, implement the provider-specific security adapter only **after** a signed technical agreement. **No endpoint in this release can mark a manually entered call as `carrier_api`.**

## Android enrollment & sync

| Route | Method | Access |
|---|---|---|
| `/devices` | GET | owner/admin/manager/analyst |
| `/devices/enrollment` | POST | owner/admin |
| `/device-api/enroll` | POST | possession of one-time enrollment token |
| `/device-api/calls` | POST | valid non-revoked device token |
| `/devices/:id/revoke` | POST | owner/admin |

Admin generates an enrollment token:

```json
{
 "employeeId":"EMPLOYEE_UUID",
 "simId":"ACTIVE_COMPANY_SIM_UUID_ASSIGNED_TO_EMPLOYEE",
 "deviceLabel":"Corporate Android 01"
}
```

The API replies with an `enrollmentToken`, valid 30 minutes, displayed only once. Device exchanges it:

```json
{"enrollmentToken":"ONE_TIME_TOKEN","osName":"android"}
```

Then the device calls `/device-api/calls` with `Authorization: Device <deviceToken>`:

```json
{
 "events":[{
   "externalId":"android-call-log-row-id",
   "remotePhoneE164":"+258840000000",
   "direction":"outgoing",
   "startedAt":"2026-11-14T10:00:00Z",
   "durationSeconds":121
 }]
}
```

All such records are labeled `device_reported`, deduplicated by device/external ID, and linked to the enrolled employee/corporate SIM server-side.

## Analytics

- `GET /analytics/overview?days=7|30|90` returns actual calls, answered counts, seconds, qualified leads, wins, revenue, tracked expenses, daily series and rule-based insights. Any `days` integer from 1 through 365 is supported.
- `GET /analytics/employee-performance` returns per-employee call, lead and win counts for 30 days.
- `GET /audit` lists events for owner/admin.

## Consent-gated transcript / external AI

| Route | Method | Access |
|---|---|---|
| `/intelligence/transcripts` | GET | owner/admin/manager/analyst (no plaintext returned) |
| `/intelligence/transcripts` | POST | owner/admin/manager |
| `/intelligence/transcripts/:id/analyze` | POST | owner/admin/manager, external AI approval |
| `/intelligence/transcripts/:id` | DELETE | owner/admin |

Submission requires a call record, a transcript legally sourced outside this application, evidence of consent or lawful basis, and positive compliance attestation. The text is AES-GCM encrypted at rest. Example:

```json
{
 "callId":"CALL_UUID",
 "transcript":"Agent: Bom dia ... Customer: Gostaria de receber uma proposta ...",
 "recordingSource":"Authorized provider and reference",
 "consentBasis":"Documented employee and customer notice/consent basis",
 "consentRecordedAt":"2026-11-14T10:00:00+02:00",
 "complianceAttestation":true
}
```

External processing is separately triggered with `{ "externalAiProcessingApproved": true }`. If `OPENAI_API_KEY` and `OPENAI_MODEL` are unset, the request returns HTTP 503. The external model's analysis is advisory; it does not alter call provenance or independently verify conversations.

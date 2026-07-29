# Quickstart: Phone OTP Authentication

This guide validates the planned feature after implementation. It does not
require a live Orange account.

## Prerequisites

- Node.js 24 and pnpm 10;
- Docker with Compose;
- iOS/Android Expo development environment for mobile checks;
- no production Orange credential in local files.

## Local Configuration

Copy the repository environment example using the existing bootstrap process,
then select:

```dotenv
APP_ENV=development
SMS_PROVIDER=fake
FAKE_SMS_EXPOSE_OTP=true
FAKE_SMS_TEST_NUMBERS=+221771234567
INTERNAL_METRICS_ENABLED=true
INTERNAL_METRICS_TOKEN=<base64url-of-at-least-32-csprng-bytes>
SMS_DAILY_COUNT_WARNING_PERCENT=80
SMS_DAILY_COUNT_CRITICAL_PERCENT=95
SMS_DAILY_XOF_WARNING_PERCENT=80
SMS_DAILY_XOF_CRITICAL_PERCENT=95
```

Generate independent high-entropy local values for OTP HMAC, credential HMAC,
JWT signing, fingerprint, and internal metrics keys. Do not commit them. The
completed `.env.example` must contain names and safe placeholders only.

The application must refuse:

```dotenv
APP_ENV=staging
SMS_PROVIDER=fake
```

and:

```dotenv
APP_ENV=production
SMS_PROVIDER=fake
```

## Start Dependencies And API

```bash
pnpm install
pnpm services:up
pnpm db:migrate
pnpm dev:api
```

Expected:

- migration succeeds against PostgreSQL;
- Redis health is ready;
- API starts with fake provider;
- startup output contains no secret or complete phone.

## Validate Internal Metrics Access

With metrics enabled, verify:

```bash
curl -i http://localhost:3000/internal/metrics
curl -i -H 'Authorization: Bearer wrong-token' http://localhost:3000/internal/metrics
curl -i -H "Authorization: Bearer $INTERNAL_METRICS_TOKEN" http://localhost:3000/internal/metrics
```

Expected:

- missing and invalid bearer credentials return `401` with no configuration
  detail;
- the valid credential returns `200` with the Prometheus content type and no
  sensitive or high-cardinality labels;
- setting `INTERNAL_METRICS_ENABLED=false` makes the same path return `404`;
- adding forged `X-Forwarded-For` or similar headers never grants access;
- `/internal/metrics` is absent from generated public OpenAPI.

With the default daily hard limits, the exposition must report count thresholds
of 400 warning and 475 critical, and spend thresholds of 8,000 XOF warning and
9,500 XOF critical. Current values come from the Redis UTC daily counters.
Reaching a warning or critical threshold does not reject an OTP send; only the
500 SMS or 10,000 XOF hard limit does. Configuration must reject non-integer,
out-of-range, or `warning >= critical` percentages.

For staging and production, enabling metrics without a valid
`INTERNAL_METRICS_TOKEN` must fail startup. Restrict the endpoint to monitoring
sources at ingress, firewall, or service-network level as a second layer; this
deployment allowlist does not replace the bearer credential.

## Validate The Primary Flow

Use the schemas in [contracts/openapi.yaml](./contracts/openapi.yaml).

1. Request an OTP for allowlisted local number `+221771234567`.
2. Confirm the response contains challenge/expiry/cooldown and no provider
   payload or plaintext OTP. In development, inspect the code only through the
   non-exported `FakeSmsProvider` outbox; automated tests use the isolated fake
   fixture directly. Neither mechanism changes the public response schema.
3. Verify the OTP. A new number must receive scoped registration authorization,
   not a User/session.
4. Load current mandatory legal documents.
5. Submit every exact current document ID with a new `Idempotency-Key`.
6. Confirm one User, one acceptance per document, one UserSession, and access
   plus refresh credentials.
7. Repeat completion concurrently with the same key and deliver the responses to
   the client in reverse order. Confirm identical credential fields, no duplicate
   durable row, no refresh-lineage advance, and no session replay revocation.
8. Interrupt completion after the PostgreSQL commit but before the Redis
   `COMPLETED` transition, retry with the same key, and confirm the deterministic
   durable session repairs the Redis state and returns the original credentials.
9. Restart the mobile app and confirm refresh rotation restores the session
   without OTP and returns the same `refreshExpiresAt` as the initial session.

## Required Negative Checks

- A non-`+221` country returns `UNSUPPORTED_COUNTRY`.
- Malformed Senegal input returns `INVALID_PHONE`.
- Resend before 60 seconds returns `RATE_LIMITED` with safe retry timing.
- A new accepted OTP invalidates the previous challenge.
- Five wrong codes exhaust the challenge; the sixth cannot succeed.
- Two concurrent correct verification calls produce exactly one success.
- An expired or used OTP is rejected.
- Omitting one mandatory document creates neither user nor session.
- Publishing a new current document between GET and completion returns
  `LEGAL_VERSION_STALE` without partial writes.
- Two parallel completion requests produce one user/acceptance/session set.
- Completion Redis state contains only an authenticated encrypted response
  envelope, never plaintext access, refresh, or registration credentials.
- Reusing a rotated refresh credential revokes only that device session.
- With the test clock just before the absolute session deadline, rotation keeps
  the original `refreshExpiresAt` and caps `accessExpiresAt` at that deadline.
  At or after the deadline, refresh returns `REFRESH_EXPIRED`, clears the mobile
  credential, and requires a new OTP; the test must not wait 60 real days.
- Logging out one device leaves another device session active.
- Pending promo can be prefilled, edited, or removed and creates no referral
  row, bonus, validation call, or registration failure.
- Pending promo replacement/removal survives request and resend, the latest
  value moves from OTP state into registration authorization after verification,
  and a compliant existing-user login discards it.

## Automated Validation

Run the smallest suite while implementing each stage, then the complete
bootstrap validation:

```bash
pnpm check:env
pnpm typecheck
pnpm test
pnpm lint
pnpm build:api
pnpm build:mobile:js
pnpm verify:start
```

Where introduced by implementation, also run the feature-specific scripts for:

```bash
pnpm --filter @kaynann/api test -- otp
pnpm --filter @kaynann/api test -- sms-provider
pnpm --filter @kaynann/api test -- auth-integration
pnpm --filter @kaynann/mobile test -- auth
pnpm --filter @kaynann/api openapi:check
```

The mobile auth filter must collect the MobX store, RxJS application-service,
and component-flow suites named in `tasks.md`. Verify that:

- MobX strict action enforcement rejects state mutation outside store actions;
- the mobile bootstrap imports `mobx.config.ts` before constructing any store;
- computed submit, resend, completion, and root-route state is derived rather
  than stored a second time;
- `SessionStore` is the only observable owner of session and root-route state;
- the composition root owns only `SessionStore` and `SessionFlowService`, may
  create child scopes, and retains no disposed OTP or registration instance;
- deterministic RxJS time tests cover countdown without wall-clock sleeps;
- `exhaustMap` permits only one active OTP submit;
- concurrent authenticated requests share one resettable refresh operation;
- disposing the phone/OTP scope, registration/legal scope, and application-root
  scope independently terminates every subscription and timer owned by that
  scope;
- screens invoke typed FlowService commands, services compose cold Observable
  adapters, and only service results invoke store actions;
- no screen prop exposes an RxJS subject and no unsafe mutation receives an
  automatic retry.

Do not invent these scripts if implementation chooses different existing Vitest
filters; tasks must bind each command to the final package scripts.

## Phase 8 Local Validation Report

Executed on 2026-08-01 against local PostgreSQL and Redis. Live Orange
credentials were not used and are not required for these results.

### Completed automated checks

- `pnpm check:env`: passed.
- `pnpm test` with `RUN_REDIS_INTEGRATION=1` and
  `RUN_POSTGRES_INTEGRATION=1`: API 52 files/193 tests passed; mobile 16
  files/72 tests passed.
- The mobile run collected `mobx.config.spec.ts`, `otp.store.spec.ts`,
  `otp-flow.service.spec.ts`, `registration.store.spec.ts`,
  `registration-flow.service.spec.ts`, `session.store.spec.ts`,
  `session-flow.service.spec.ts`, and `phone-auth-flow.test.tsx`.
- `pnpm lint`: passed.
- `pnpm build:api`: passed.
- `pnpm build:mobile:js`: passed and produced the Expo web export.
- `pnpm verify:start`: passed; PostgreSQL, Redis, and API health checks were
  healthy.
- `pnpm --filter @kaynann/api openapi:check`: passed.
- `pnpm --filter @kaynann/mobile typecheck`: passed.

The full fake-provider integration journey, dependency-failure recovery,
OpenAPI parity, pending-promo scope, sensitive-data regressions, and React
Native component flows passed as part of the suites above.

### Performance result

`pnpm verify:phone-auth-performance` passed with no request errors:

| Operation | Samples | Concurrency | p50 | p95 | Limit |
| --- | ---: | ---: | ---: | ---: | ---: |
| OTP request | 200 | 10 | 28.14 ms | 48.61 ms | 500 ms |
| OTP verification | 200 | 10 | 19.58 ms | 33.69 ms | 500 ms |
| Session refresh | 500 | 20 | 77.34 ms | 117.82 ms | 300 ms |

The harness starts the real NestJS application with fake SMS, uses local
PostgreSQL and Redis, creates independent identities/sessions, and cleans its
durable test records after execution.

### Open validation items

- `pnpm typecheck` is blocked by 11 existing strict TypeScript errors in
  `apps/api/src/common/redacted-exception.filter.ts`,
  `apps/api/src/sessions/application/session-rotation.integration-spec.ts`,
  `apps/api/src/sessions/application/testing/postgres-session.fixture.ts`,
  `apps/api/src/sms/infrastructure/orange/orange-error-mapper.ts`,
  `apps/api/src/sms/infrastructure/orange/orange-oauth-client.ts`,
  `apps/api/src/sms/infrastructure/orange/orange-sms.provider.ts`,
  `apps/api/src/sms/infrastructure/orange/testing/orange-mock-server.ts`, and
  `apps/api/src/sms/sms.module.ts`. The failures concern
  `exactOptionalPropertyTypes` and Node/DOM `AbortSignal` compatibility. Per
  T124, no unrelated implementation remediation was applied automatically.
- The three reference mockups were inspected, but a representative native
  iOS/Android screenshot comparison was not executed. T123 remains open and no
  visual implementation changes were made during validation.
- Automated functional scenarios passed, but the complete manual-local device
  scenario sweep has not been executed. T125 remains open.
- The moderated usability study with 20 eligible independent participants was
  not run. T127 remains open and cannot be replaced by an automated test.

## Mocked Orange Acceptance

With `SMS_PROVIDER=orange`, point `ORANGE_SMS_API_URL` and OAuth URL to the mock
HTTP server and use non-secret fixture credentials. Verify:

- one token request serves concurrent sends until safety-skew expiry;
- sender path and `tel:+221...` recipient match the official DTO;
- accepted response records only normalized message ID/status;
- invalid recipient/auth/config/balance are not retried;
- timeout/5xx retries are bounded;
- 429 respects a bounded delay;
- no Orange response or credentials reach the client or logs;
- optional duplicate/late/unknown receipts are idempotent and do not alter OTP.

## Mobile Visual And State Check

Compare native screens with:

- `docs/design/mockups/07_login_hd.png`;
- `docs/design/mockups/08_otp_verification_hd.png`;
- `docs/design/mockups/09_terms_hd.png`.

Keep their hierarchy and style, but verify fixed Senegal `+221`, no obsolete
Ghana data, no authenticated bottom navigation during auth, safe-area and
keyboard behavior, disabled/loading/error states, OTP autofill, server-driven
countdown, offline retry, and secure credential clearing.

## Moderated Usability Acceptance

Run this manual protocol only after the full new-user flow is available in a
release-like mobile build. This acceptance is not an automated CI check.

Use `FakeSmsProvider` in an isolated development or test environment so OTP
availability is controlled without live Orange credentials. Reset the test
identity before every attempt so each participant completes phone confirmation,
OTP verification, all mandatory legal acceptance, and navigation to the
authenticated main route.

Recruit exactly 20 independent participants representative of the intended MVP
audience. A participant is eligible only when they:

- are not a contributor to the project;
- have not previously seen the feature screens;
- can independently operate a supported iOS or Android device.

Use the same neutral task prompt for every participant. Logistical instructions
that do not explain the product are allowed. Any hint or intervention explaining
where to tap, what to enter, or how to proceed is product assistance and makes
the attempt unsuccessful.

For every attempt:

1. Start active task time when the phone-entry screen becomes interactive.
2. Keep the timer running during phone entry, validation, navigation, loading,
   retries, OTP entry, and legal acceptance.
3. Pause only after the server accepts the OTP request and before the controlled
   OTP is made available to the participant.
4. Resume as soon as the controlled OTP is available.
5. Stop when the authenticated main route opens.
6. Mark the attempt unsuccessful if active task time exceeds 180 seconds,
   product assistance is given, or a product crash, error, timeout, or blocked
   route prevents completion.
7. Exclude only a demonstrable device or lab failure unrelated to the product.
   Record the reason and recruit a replacement so the evaluated cohort remains
   exactly 20. Never exclude a slow or failed attempt caused by the product.

Record results in
`specs/002-phone-otp-auth/acceptance/usability.md` with these fields:

- anonymized participant identifier;
- device platform and OS version;
- active task time;
- excluded controlled OTP delivery wait;
- whether product assistance was given;
- success or failure;
- failure stage and reason, when applicable;
- any exclusion reason and replacement identifier.

Do not record phone numbers, OTP values, access tokens, refresh tokens, or
registration authorizations. Add the aggregate count and an explicit SC-011
decision. The criterion passes only when at least 19 of the 20 evaluated
participants succeed.

## Post-Credential Manual Acceptance

Run only after explicit customer approval and credentials:

1. Confirm OAuth token acquisition and synchronized cache renewal.
2. Confirm assigned sender address and approved `KAYNANN` Sender Name.
3. Confirm bundle balance and actual insufficient-balance response.
4. Send the GSM-7 template to test numbers on Senegal operators.
5. Measure delivery and verify 5 SMS/s/rate-limit behavior.
6. Validate timeout and retry decisions without duplicate SMS pumping.
7. Enable Delivery Receipt only after callback reachability and authenticity
   controls are agreed; test duplicate, late, and unknown callbacks.
8. Set production global and XOF budgets and review the independent 80%/95%
   alert percentages against the purchased bundle.
9. Disable all fake debug OTP exposure and run the secret/log scan.

Live Orange acceptance is not part of automated feature completion.

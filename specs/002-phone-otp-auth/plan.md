# Implementation Plan: Phone OTP Authentication

**Branch**: repository default (no feature branch requested) | **Date**: 2026-07-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-phone-otp-auth/spec.md`

## Summary

Add Senegal-only phone registration and login to the existing NestJS and Expo
applications. NestJS owns phone normalization, OTP generation and verification,
anti-abuse controls, legal gating, user creation, and rotating sessions.
Temporary OTP and registration state lives in Redis; durable users, legal
evidence, sessions, refresh lineage, and minimal SMS delivery metadata live in
PostgreSQL through Prisma. `OtpService` depends on an internal `SmsProvider`
port, with configuration-selected fake and Orange adapters.

The mobile application adds the phone, OTP, and legal screens using the existing
Expo application. Refresh and short-lived registration credentials use
`expo-secure-store`; access credentials remain in memory. MobX stores own
observable application and screen state, while RxJS application services own
asynchronous concurrency, cancellation, timers, and lifecycle. A pending promo
code is transported as opaque registration context only. This feature does not
validate or apply it, create a referral relationship, or award a bonus.

## Technical Context

**Language/Version**: TypeScript 5.8, Node.js 24, React 19.1, React Native 0.81

**Primary Dependencies**: NestJS 11, Expo SDK 54 with expo-dev-client, Prisma 6,
node-redis 5, Zod, class-validator, Vitest 3; planned additions are
`@nestjs/jwt`, `@nestjs/swagger`, `@nestjs/schedule`, `libphonenumber-js`,
`expo-secure-store`, `@react-navigation/native`,
`@react-navigation/native-stack`, Expo-resolved `react-native-screens` and
`react-native-safe-area-context`, `mobx`, `mobx-react-lite`, `rxjs`, and
development-only
`@testing-library/react-native`; `prom-client` provides the feature-local
Prometheus registry because bootstrap has no metrics exporter

**Storage**: PostgreSQL 17 for durable state; Redis 7 for OTP, registration
authorization, locks, counters, and budgets; device Keychain/Keystore through
Expo SecureStore

**Testing**: Vitest unit, contract, integration, and concurrency tests;
Supertest for HTTP; Docker Compose PostgreSQL and Redis; mocked HTTP server for
Orange; React Native component/state tests collected from both
`src/**/*.spec.{ts,tsx}` and `__tests__/**/*.test.tsx`, including MobX
store/action tests, RxJS marble or fake-time workflow tests, and subscription
disposal checks

**Target Platform**: Existing Linux-hosted NestJS API and Expo development
builds for iOS 15.1+ and Android 7+

**Project Type**: Existing pnpm monorepo containing a mobile application and API

**Performance Goals**: one active send per phone; provider concurrency at most
5 and Orange throughput at most 5 SMS/s; auth endpoints p95 under 500 ms
excluding external SMS latency; session refresh p95 under 300 ms under normal
dependency health

**Constraints**: Senegal `+221` only; OTP 6 digits and 5-minute TTL; resend after
60 seconds; 5 verification attempts; access at most 15 minutes; each session has
an absolute 60-day lifetime that rotation cannot extend; no plaintext OTP or
refresh credential at rest; no live Orange dependency in CI; fake provider must
fail startup in staging and production; MobX is the only owner of observable
mobile state and RxJS streams must have explicit ownership and disposal

**Scale/Scope**: MVP authentication for one country, three mobile screens, nine
public REST operations plus optional Orange delivery callback, one active OTP
per phone, and multiple sessions per user

## Constitution Check

*GATE: passed before research and passed again after design.*

| Principle | Design evidence | Result |
|---|---|---|
| One logical diff | This command changes planning artifacts and the managed Spec Kit pointer only. | PASS |
| Boundary validation | DTO validation, E.164 normalization, stable response shaping, webhook validation, and environment startup validation are explicit. | PASS |
| Explicit outputs | OpenAPI defines public success and error envelopes; provider DTOs remain private. | PASS |
| Schema safety | All PostgreSQL changes use reviewed Prisma migrations, including explicit partial indexes where Prisma cannot express them. | PASS |
| Security-sensitive work | OTP HMAC, opaque refresh credentials, replay detection, scoped registration authorization, redaction, rate limits, and budget limits are designed before implementation. | PASS |
| Minimal validation | Each implementation stage lists the smallest relevant build/test command. | PASS |
| Existing architecture | Work stays in `apps/api`, `apps/mobile`, existing `infra`, and existing scripts; no project or shared package is created. | PASS |
| Frontend reactive architecture | MobX stores exclusively own observable auth state; RxJS application services own cancellable/concurrent/time-based workflows, expose no subjects to screens, and provide explicit disposal. | PASS |

No constitution violation requires a complexity exception.

## Requirement Conflicts And Resolutions

1. `docs/mvp-requirements.md` v0.12 describes creating referral effects and
   bonuses during registration. The approved feature specification, FR-023,
   BR-010, the user's latest scope decision, and this plan explicitly defer all
   referral effects. Resolution: carry an optional opaque pending promo code
   only until registration completion, then discard it without validation or
   durable referral writes. A future referral feature must define application.
2. MVP v0.12 leaves the customer-supplied SMS provider open. The current
   feature explicitly selects Orange SMS Senegal behind a replaceable port.
   Resolution: treat the feature specification as the approved clarification;
   live credential acceptance remains a separate stage.
3. Bootstrap validates only `development|test|production` in `NODE_ENV`, while
   this feature must distinguish staging. Resolution: retain `NODE_ENV` for
   tooling and add validated `APP_ENV=development|test|staging|production` for
   deployment safety decisions.
4. Login mockups show Ghana `+233` and authenticated navigation. Requirements
   require Senegal `+221` and an unauthenticated flow. Resolution: preserve
   visual hierarchy only; do not copy obsolete country, data, or navigation.

These are resolved scope clarifications, not blocking questions. No unresolved
planning question remains.

## Architecture

### NestJS module boundaries

```text
AuthController
  -> AuthApplicationService
       -> OtpModule application port
       -> UsersModule application port -> Prisma -> PostgreSQL
       -> LegalModule application port -> Prisma -> PostgreSQL
       -> SessionsModule application port -> Prisma -> PostgreSQL

OtpModule
  -> OtpService
       -> SmsProvider port <- SmsModule factory
       -> OtpChallengeStore / AbuseGuard ports -> Redis adapters

SmsModule
  -> SMS_PROVIDER token
       -> FakeSmsProvider
       -> OrangeSmsProvider -> Orange OAuth cache -> Orange HTTPS API
  -> SmsDeliveryRepository -> Prisma -> PostgreSQL

React Native render path
  -> MobX stores -> observer screens
React Native command path
  -> screens -> typed FlowService commands
  -> FlowService commands -> Promise API / SecureStore adapters
  -> Promise API adapter -> NestJS REST/OpenAPI only
  -> FlowService results -> MobX store actions
```

- `AuthModule` coordinates outcomes but does not implement OTP, persistence, or
  Orange details. Controllers remain thin.
- `OtpModule` owns phone validation, challenge state machine, OTP HMAC, send
  serialization, verification, and anti-abuse orchestration.
- `SmsModule` exports only the `SmsProvider` injection token and normalized
  result/error types. Orange DTOs, OAuth, URLs, retry, and receipts are private.
- `UsersModule`, `LegalModule`, and `SessionsModule` own their Prisma
  repositories and application services.
- A reusable API infrastructure `RedisModule` owns the existing node-redis
  connection and loaded Lua scripts. It is not a new workspace package.
- Neither mobile nor Auth/OTP/User/Legal code imports `OrangeSmsProvider`.

Suggested API layout:

```text
apps/api/src/
├── auth/
│   ├── application/
│   ├── http/
│   └── auth.module.ts
├── otp/
│   ├── application/
│   ├── domain/
│   ├── infrastructure/redis/
│   └── otp.module.ts
├── sms/
│   ├── application/ports/
│   ├── infrastructure/fake/
│   ├── infrastructure/orange/
│   ├── infrastructure/postgres/
│   └── sms.module.ts
├── users/
├── legal/
├── sessions/
└── infrastructure/redis/
```

Suggested mobile layout:

```text
apps/mobile/src/
├── api/
├── auth/
│   ├── screens/
│   ├── stores/
│   ├── services/
│   └── storage/
├── components/
├── navigation/
└── theme/
```

Bootstrap has no reusable mobile API client or navigation package yet. Add the
smallest typed Promise-based `fetch` wrapper and native-stack navigation inside
the existing mobile app; do not introduce a shared package. RxJS application
services compose API and storage adapter calls without coupling those adapters
to React or exposing streams as public screen props.

## Core Designs

### OTP and Redis atomicity

Use versioned Lua scripts loaded once and called by SHA. Scripts atomically:

1. reserve rate and budget counters and prepare a candidate challenge with an
   immutable expiry five minutes after code generation;
2. activate a provider-accepted candidate with only its remaining lifetime,
   replace the current pointer, and set cooldown;
3. decrement an incorrect attempt or mark exhausted;
4. compare-and-consume a correct current challenge after the Node process has
   performed `crypto.timingSafeEqual`;
5. release only reservations known not to have resulted in an SMS.

The send path acquires `SET NX PX` per phone fingerprint. A candidate does not
invalidate the previous challenge until the provider accepts it. A definitive
provider rejection deletes the candidate and refunds reserved global/money
budget. A timeout has unknown delivery outcome: activate the candidate, retain
the budget, return `OTP_DELIVERY_UNCERTAIN`, and allow entry of a code that may
arrive. This prevents an old and possibly newly delivered code from both being
valid.

OTP is generated with `crypto.randomInt(0, 1_000_000)` and zero-padded.
`expiresAt` is fixed at generation time as `createdAt + 5 minutes`; provider
latency and later activation never extend it. Redis stores
`HMAC-SHA-256(keyVersion, challengeId || phone || otp)`, never the code. Node
uses fixed-length decoded digests and `timingSafeEqual`; Lua preserves the
absolute expiry during activation and performs the final version/state compare
and consume atomically. An expired candidate cannot be activated. Used and
exhausted tombstones retain only state metadata long enough to return stable
errors.

### Anti-abuse defaults

All values are Zod-validated environment configuration:

| Control | MVP default |
|---|---:|
| Sends per phone per hour | 3 |
| Sends per phone per day | 6 |
| Sends per IP per hour | 20 |
| Sends per installation per hour/day | 10 / 20 |
| Exhausted challenges before block | 3 in 24 hours |
| Temporary phone block | 30 minutes |
| Global accepted/uncertain SMS per day | 500 |
| Estimated unit cost | 20 XOF |
| Daily money budget | 10,000 XOF |
| Daily count warning / critical | 80% / 95% (400 / 475 SMS by default) |
| Daily spend warning / critical | 80% / 95% (8,000 / 9,500 XOF by default) |
| Parallel sends per phone / globally | 1 / 5 |
| Hour/day counter retention | window end + 1 hour / 48 hours |

Configure count and spend alert percentages independently as
`SMS_DAILY_COUNT_WARNING_PERCENT=80`,
`SMS_DAILY_COUNT_CRITICAL_PERCENT=95`,
`SMS_DAILY_XOF_WARNING_PERCENT=80`, and
`SMS_DAILY_XOF_CRITICAL_PERCENT=95`. Startup validation requires integer
percentages satisfying `0 < warning < critical < 100` for each dimension.
Warning begins when current consumption is greater than or equal to the
calculated warning threshold; critical begins at the critical threshold. These
thresholds provide monitoring signals only: the Redis anti-abuse guard rejects
new sends only at the configured 500 SMS or 10,000 XOF hard limit. Count and
spend counters and alert state reset at the same UTC daily-window boundary.

Order: normalize and validate, check temporary block, acquire phone lock, then
atomically test phone, installation, IP, global, and monetary limits before
provider work. Responses never disclose whether a user exists. IP and
installation identifiers are HMAC-fingerprinted. The global semaphore and
5-per-second limiter also protect Orange. Production limits must be reviewed
against the purchased Orange bundle before activation.

### Registration and legal

- OTP verification for a compliant existing user creates a device session
  immediately.
- New or legally stale users receive a 15-minute, opaque, 256-bit registration
  credential. Redis stores only its HMAC lookup digest and scoped state.
- The credential permits current legal retrieval and exactly one registration
  or legal-completion workflow. It is not accepted by application guards.
- Pending promo text is bounded to 64 safe printable characters and initially
  carried in protected OTP challenge state. Request/resend/verify can explicitly
  replace it or remove it with `null`; successful OTP routing copies the latest
  value into registration state. It remains editable/removable, is never
  interpreted, is discarded for a compliant existing-user login, and is removed
  after registration completion.
- Completion requires `Idempotency-Key`. A Redis lease serializes a registration
  authorization. A PostgreSQL transaction rechecks current mandatory document
  IDs, creates/upserts the user by phone, inserts exact acceptances with unique
  constraints, and creates one deterministic initial session.
- Before the PostgreSQL transaction, the service generates the deterministic
  initial-session credentials and stores only an AES-256-GCM sealed completion
  response envelope in Redis. The versioned 32-byte server key comes from
  validated configuration; a random 96-bit nonce and AAD binding the
  registration flow, idempotency-key digest, and session ID prevent substitution.
  PostgreSQL stores only the refresh digest. No credential response is returned
  before the transaction commits.
- After commit, authorization state becomes `COMPLETED` until its original TTL.
  A same-key retry opens and returns the same sealed response envelope without
  rotating refresh lineage; a different key is rejected. A transaction failure
  cannot expose the prepared envelope, and retry reuses it rather than generating
  a second session credential. No plaintext credential is stored in Redis and no
  duplicate user, acceptance, or session is created.
- If the process fails after PostgreSQL commit but before the Redis transition
  to `COMPLETED`, a same-key retry compares the deterministic session and
  generation-zero digest with the prepared envelope, atomically repairs the
  Redis state, and returns that envelope. If no matching durable aggregate
  exists, the original prepared envelope is reused for a normal transaction
  retry. No distributed Redis/PostgreSQL transaction is assumed.
- A stale legal set aborts before writes with `LEGAL_VERSION_STALE`. Dependency
  failure leaves authorization retryable until expiry.

### Sessions

- Access token: signed JWT HS256 with `exp = min(issuedAt + 15 minutes,
  session.expiresAt)` and claims `iss`, `aud`, `sub`, `sid`, `jti`, `iat`, and
  `exp`. No phone or legal document data is embedded.
- Session lifetime is absolute: immutable `session.expiresAt =
  session.createdAt + 60 days`. The initial and every rotated opaque 256-bit
  refresh credential use that same deadline; rotation, activity, restart, legal
  acceptance, and idempotent registration recovery never extend it. PostgreSQL
  stores only keyed HMAC digests and generation metadata.
- Each refresh transaction uses the PostgreSQL clock to conditionally claim
  exactly one ACTIVE rotation row only while the session deadline is in the
  future, changes it to ROTATED, creates the next row with the unchanged
  `session.expiresAt`, and updates session activity. At or after the deadline it
  marks the session/token expired and returns `REFRESH_EXPIRED` without issuing
  credentials. Reuse of a ROTATED digest revokes that session/family atomically.
- Access guards validate signature, active `sid` server state, and the absolute
  session deadline, so logout, replay revocation, or expiry takes effect without
  waiting for JWT expiry.
- Each installation has a separate session. Logout revokes only the current
  `sid`. The API root module initializes `ScheduleModule.forRoot()` once, while
  `AuthModule` registers the retention scheduler and service as providers. The
  daily `03:00 UTC` job uses `waitForCompletion` against same-process overlap.
  Its service opens a Prisma interactive transaction, attempts
  `pg_try_advisory_xact_lock`, skips cleanup when the lock is unavailable, and
  otherwise performs the idempotent deletions in that same transaction. The
  transaction-scoped lock coordinates API replicas and is released at
  transaction end. Expired/revoked security metadata is retained for 90 days
  and SMS delivery records for 30 days before deletion according to policy.

### React Native

- Use mockups 07, 08, and 09 for visual direction, overriding obsolete `+233`
  and bottom navigation.
- `SessionStore` is the sole observable owner of access, session, and
  root-route state. `OtpStore` exclusively owns phone/OTP/challenge/UI state,
  and `RegistrationStore` exclusively owns registration/legal/pending-promo UI
  state. No `AuthStore` mirrors those values. The non-observable
  `AuthCompositionRoot` owns only the application-root `SessionStore` and
  `SessionFlowService`. It may expose factories for child auth and registration
  scopes, but it never retains their store or service instances and never
  copies application state.
- `apps/mobile/src/mobx.config.ts` configures MobX with
  `enforceActions: "always"` and is imported by the mobile bootstrap before any
  store is constructed.
- `OtpFlowService`, `RegistrationFlowService`, and `SessionFlowService` use RxJS
  only for asynchronous orchestration: `exhaustMap` duplicate-submit
  suppression, cancellable replaceable work, server-time countdowns, refresh
  single-flight, and explicitly allowed retry policies. They mutate stores only
  through actions and expose an idempotent `dispose()` that terminates every
  owned subscription and timer.
- The composition context supplies typed `{ store, commands }` references.
  Screens use `observer` to read stores and invoke typed FlowService command
  methods. Screens never call APIs, SecureStore, internal store-transition
  actions, or RxJS subjects directly; subjects and subscriptions remain private
  to their service. Services call Promise adapters and publish results through
  store actions. Local React state is limited to ephemeral native-control state
  that is not application state.
- `OtpFlowService` has phone/OTP authentication-flow scope and is disposed when
  that provider unmounts or the flow is replaced. `RegistrationFlowService` has
  registration/legal scope and is disposed when registration completes, is
  cancelled, or is replaced. `SessionFlowService` has application-root scope
  and is disposed only when the root composition unmounts. Every disposal is
  idempotent.
- Phone entry fixes the country context to `+221`, accepts local input, validates
  for UX, supports pending promo prefill/edit/remove, and prevents duplicate
  presses.
- OTP uses one controlled six-digit input rendered as six cells with
  `autoComplete="sms-otp"` on Android and `textContentType="oneTimeCode"` on
  iOS. Server timestamps drive the resend countdown.
- Legal renders exact current documents and requires every mandatory checkbox.
- Refresh and registration credentials use Expo SecureStore. OTP is never
  persisted. Access tokens and transient screen data remain in memory.
- Startup reads refresh, calls rotation once through a single-flight client,
  stores the new refresh before exposing authenticated state, and clears secure
  state on terminal refresh failure.
- Network failures preserve non-secret phone/promo input and checked legal UI
  state in memory; credentials remain secure. Retryable and terminal product
  error codes drive screen state.
- RxJS must not automatically retry OTP sends or other side-effecting mutations.
  A mutation retry is allowed only when the API contract is idempotent and the
  same idempotency key is retained.

## API And Error Contract

The source contract is [contracts/openapi.yaml](./contracts/openapi.yaml).
Implementation adds Nest Swagger decorators and a deterministic OpenAPI
generation/check command consistent with the existing Nest build.

Stable product codes include:

`INVALID_PHONE`, `UNSUPPORTED_COUNTRY`, `RATE_LIMITED`, `SMS_BUDGET_EXHAUSTED`,
`SMS_CONFIGURATION_ERROR`, `SMS_AUTH_FAILED`, `SMS_BALANCE_EXHAUSTED`,
`SMS_PROVIDER_RATE_LIMITED`, `SMS_INVALID_RECIPIENT`, `SMS_REJECTED`,
`SMS_TIMEOUT`, `SMS_TEMPORARILY_UNAVAILABLE`, `OTP_INVALID`, `OTP_EXPIRED`,
`OTP_USED`, `OTP_ATTEMPTS_EXHAUSTED`, `REGISTRATION_AUTH_INVALID`,
`REGISTRATION_AUTH_EXPIRED`, `LEGAL_VERSION_STALE`, `DEPENDENCY_UNAVAILABLE`,
`SESSION_CREATION_FAILED`, `REFRESH_INVALID`, `REFRESH_EXPIRED`, and
`REFRESH_REPLAYED`.

Raw Orange/storage errors and payloads never leave adapters. Logs, metrics, and
traces exclude plaintext OTP, complete phone numbers, all bearer credentials,
Orange secrets, and complete provider payloads.

## Delivery Receipt Decision

Create the minimal `SmsDelivery` model with sending metadata because it supports
provider message correlation and later delivery metrics without schema redesign.
The callback controller is disabled unless `ORANGE_SMS_DR_ENABLED=true`.
Documented Orange callbacks do not provide a cryptographic signature; therefore
the first release validates schema, known callback/message identifiers, HTTPS,
and configured network restrictions only. Duplicate status events are
idempotent, unknown IDs are acknowledged and safely counted, and late events do
not affect OTP validity. Live authenticity controls and allowlists must be
confirmed in post-credential acceptance.

## Observability

Counters/histograms:

- `otp_requests_total`, `sms_send_total{provider,outcome,category}`;
- `otp_verifications_total{outcome}`;
- `auth_rate_limit_total{dimension}`, `sms_budget_limit_total`;
- `session_refresh_total{outcome}`, `session_replay_total`;
- `sms_delivery_receipt_total{status}` and delivery latency when enabled.

The metrics registry reads authoritative current daily count and XOF consumption
from Redis at scrape time and exports:

- `sms_daily_count_current`, `sms_daily_count_limit`, and
  `sms_daily_count_alert_threshold{severity="warning|critical"}`;
- `sms_daily_spend_xof_current`, `sms_daily_spend_xof_limit`, and
  `sms_daily_spend_xof_alert_threshold{severity="warning|critical"}`.

Threshold gauges contain absolute values calculated from the configured hard
limit and percentage using `ceil(limit * percent / 100)`. With defaults they
are 400/475 SMS and 8,000/9,500 XOF. Deployment monitoring fires warning when
current consumption reaches the warning gauge and critical when it reaches the
critical gauge; critical supersedes warning. The application exposes these
deterministic inputs but does not implement notification delivery.

An `ObservabilityModule` owns a dedicated `prom-client` registry and exposes it
through `GET /internal/metrics`. The endpoint is not part of the public mobile
API or generated public OpenAPI. `INTERNAL_METRICS_ENABLED=false` makes the
route unavailable with `404`. When enabled, the endpoint requires
`Authorization: Bearer <INTERNAL_METRICS_TOKEN>`; the server compares the
credential in constant time and never logs it. The token is an independent
server-side secret generated by a cryptographically secure random source,
base64url-encoded, and validated to decode to at least 32 bytes. Staging and
production fail startup when metrics are enabled without a valid token. Missing
or invalid credentials return `401` without revealing configuration details.

Application-level bearer authorization is the mandatory protection and does
not trust `X-Forwarded-For` or other client-controlled proxy headers. A
monitoring-source allowlist at ingress, firewall, or service-network level is a
second defense-in-depth deployment requirement, not an existing bootstrap
capability and not a replacement for bearer authorization. Contract tests
verify disabled, unauthorized, and authorized behavior, the Prometheus output,
required series, absence from public OpenAPI, and absence of
sensitive/high-cardinality labels. Current SMS count and XOF budget utilization
are exported as gauges; warning and critical threshold series make
deployment-owned alert rules possible without embedding an alerting platform
in this feature.

Structured logs use request ID, challenge/session UUID, HMAC phone fingerprint,
provider category, retry count, and latency only. Metric labels never contain
phone, installation, IP, message text, tokens, or provider payload.

## Implementation Phases

1. **Contracts, configuration, and data model**: add validated auth/SMS settings,
   Prisma models/migration, internal ports, product error envelope, and OpenAPI.
   Validate with `pnpm check:env`, Prisma validation/migration test, API
   typecheck, and OpenAPI snapshot check.
2. **OTP and Redis**: implement normalization, Lua-backed state machine, HMAC,
   locks, counters, budget, and unit/concurrency tests. Depends on phase 1.
3. **FakeSmsProvider**: implement shared provider contract and test outbox;
   permit plaintext inspection only through the non-exported outbox for
   allowlisted numbers under development-specific opt-in or through an isolated
   test fixture. Never add the code to the public OpenAPI or normal OTP response.
   Test startup failure in staging/production.
4. **OrangeSmsProvider**: implement mocked OAuth, synchronized token cache,
   official send DTO, error mapping, bounded retry, and optional receipt parser.
   No live call. Depends on phases 1 and 3 contract suite.
5. **Registration and legal**: implement version retrieval, scoped Redis
   authorization, OTP-to-registration pending-context handoff, sealed completion
   response recovery, transaction, stale-version guard, and idempotency.
   Apply/verify migration.
6. **Access/refresh sessions**: absolute 60-day session deadlines, JWT guards,
   opaque refresh rotation without lifetime extension, replay revocation,
   multi-device logout, cleanup, and integration tests.
7. **React Native flow**: add typed Promise adapters, MobX stores, typed RxJS
   FlowService command facades with private subjects, explicit per-flow/root
   lifetimes, navigation, SecureStore, three mockup-guided screens,
   restore/refresh single-flight, and store/reactive-flow tests.
8. **Observability and hardening**: redaction, stable exception mapping,
   Prometheus export, alert-ready budget threshold metrics, receipt feature
   flag, and dependency failure paths.
9. **Automated acceptance**: execute full fake-based E2E, PostgreSQL/Redis
   integration, mocked Orange contract, mobile state, security scan, lint,
   typecheck, tests, builds, and a repeatable normal-health performance profile
   proving auth endpoint p95 below 500 ms and refresh p95 below 300 ms while
   excluding external SMS latency.
10. **Post-credential Orange acceptance**: manually verify OAuth, Sender Name
    approval, sender address, bundle/balance, Senegal delivery, 5 TPS behavior,
    timeout/retry, callback reachability/authenticity, receipt statuses, and
    production limits. This stage requires explicit customer credentials and
    never runs in CI.

Schema migration is introduced in phase 1 and must be reviewed before applying.
Manual UI comparison occurs in phase 7. Manual Orange network acceptance is
isolated to phase 10.

## Testing Strategy

- OTP unit tests cover generation, digesting, states, TTL, cooldown, five
  attempts, replacement, definitive send failure, and ambiguous timeout.
- Redis concurrency tests prove one parallel send and one successful consume.
- Shared `SmsProvider` contract tests run against fake and mocked Orange.
- Orange tests cover OAuth cache expiry/skew, single-flight refresh, request
  schema, 5 TPS limiter, retry matrix, and documented error normalization.
- Nest integration tests run with Docker PostgreSQL/Redis for transactions,
  same-key sealed-result idempotency, out-of-order completion responses, stale
  legal, session rotation/replay, and device isolation.
- Configuration tests prove fake is rejected for staging/production and Orange
  secrets are required only when Orange is selected.
- Mobile tests cover all specified screen states, deep-link prefill/edit/remove,
  countdown, duplicate press, offline retry, secure restoration, and logout.
  Store tests prove all mutations run through actions and computed values remain
  derived rather than duplicated. A bootstrap test proves MobX strict mode is
  loaded before store construction and rejects mutation outside actions. RxJS
  tests use deterministic time to prove `exhaustMap` duplicate suppression,
  refresh single-flight, cancellation, and disposal of every timer/subscription
  at the phone/OTP, registration/legal, and application-root scope boundaries
  without retrying unsafe mutations.
  The existing Vitest runner loads `apps/mobile/vitest.setup.ts` through
  `setupFiles`; that setup installs React Native Testing Library matchers and
  deterministic mocks for SecureStore, Safe Area, React Navigation/native-stack,
  and native-only authentication dependencies. A minimal RNTL render/interaction
  smoke test must pass before the full component-flow suite is implemented.
- PostgreSQL retention tests keep scheduler/provider and same-process overlap
  checks at unit level. A Docker PostgreSQL integration test opens two
  independent Prisma connections and proves one advisory-lock winner, no
  deletion by the loser, and lock release at transaction end. Redis tombstones
  and counters are excluded from this scheduler suite because their lifecycle
  is enforced and tested through Redis TTL.
- Security tests scan responses/logs/metrics/repository for OTP, full phone,
  tokens, and credentials.
- A deterministic local performance harness runs against seeded PostgreSQL,
  Redis, and fake SMS under normal dependency health. Profile A uses 200
  independent phone/install identities at concurrency 10 for OTP request and
  verification with the in-process fake provider; profile B rotates 500
  independent active sessions at concurrency 20. It reports per-operation
  p50/p95/error rate and fails when an auth operation p95 exceeds 500 ms or
  refresh p95 exceeds 300 ms. No external SMS delivery is part of either
  measurement.
- Moderated usability acceptance uses 20 independent participants representative
  of the intended MVP audience. Participants MUST NOT be project contributors
  and MUST NOT have previously seen the feature screens. Each participant uses a
  release-like mobile build with `FakeSmsProvider` and a reset test identity so
  the complete new-user phone confirmation and mandatory legal-acceptance flow
  is exercised.
- Active task time starts when the phone-entry screen becomes interactive and
  stops when the authenticated main route opens. The timer may pause only after
  the server accepts the OTP request and before the controlled OTP becomes
  available to the participant. Phone entry, OTP entry, navigation, loading,
  validation, retries, and legal acceptance all count toward the 180-second
  limit.
- A neutral task prompt and non-product logistical instructions are allowed.
  Any hint or intervention explaining how to use the product counts as product
  assistance and makes the attempt unsuccessful. Product crashes, errors,
  blocked routes, and timeouts count as unsuccessful attempts. Only a documented
  device or lab failure unrelated to the product may be excluded; the
  participant MUST be replaced so the evaluated cohort remains 20.
- The acceptance record contains only an anonymized participant identifier,
  platform and OS version, active task time, excluded OTP delivery wait,
  assistance given, outcome, and failure stage or reason. It MUST NOT contain a
  phone number, OTP, or token. SC-011 passes only when at least 19 of 20 attempts
  are successful.
- The manual post-credential checklist is in [quickstart.md](./quickstart.md).
  It is an operational release gate after credentials arrive, not a prerequisite
  for completing implementation tasks or automated acceptance.

## Project Structure

### Documentation (this feature)

```text
specs/002-phone-otp-auth/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── openapi.yaml
└── tasks.md             # generated later by /speckit-tasks
```

### Source Code (repository root)

```text
apps/
├── api/
│   ├── prisma/
│   ├── src/
│   │   ├── auth/
│   │   ├── otp/
│   │   ├── sms/
│   │   ├── users/
│   │   ├── legal/
│   │   ├── sessions/
│   │   └── infrastructure/redis/
│   └── test/
└── mobile/
    ├── src/
    │   ├── api/
    │   ├── auth/
    │   ├── components/
    │   ├── navigation/
    │   ├── theme/
    │   └── .../*.spec.ts(x)
    └── __tests__/
infra/
└── compose.yaml
```

**Structure Decision**: extend the existing API and mobile workspaces. Do not
create a project, service, package, or duplicate infrastructure.

## Complexity Tracking

No constitution violation or unjustified abstraction is introduced.

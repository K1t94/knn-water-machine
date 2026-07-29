# Tasks: Phone OTP Authentication

**Input**: Design documents from `/specs/002-phone-otp-auth/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`,
`contracts/openapi.yaml`, and `quickstart.md`

**Tests**: Tests are required by the feature specification. Within each user
story, test tasks precede the implementation they verify.

**Organization**: Shared infrastructure is limited to prerequisites used by
multiple stories. Feature behavior is grouped by user story so that every story
has an independent checkpoint. The requested technical stages are represented
inside those story phases rather than as infrastructure-only silos.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel because it changes different files and has no
  dependency on an incomplete task.
- **[US1]–[US4]**: Maps the task to a user story from `spec.md`.
- Every task names the exact file or files it creates or changes.

## Phase 1: Shared Contracts And Configuration

**Purpose**: Add only feature dependencies, validated configuration, and stable
internal contracts. Do not recreate bootstrap infrastructure.

- [X] T001 [P] Add API runtime dependencies `@nestjs/jwt`, `@nestjs/swagger`, `@nestjs/schedule`, `libphonenumber-js`, and `prom-client` in `apps/api/package.json` and `pnpm-lock.yaml`
- [X] T002 Add mobile runtime dependencies `expo-secure-store`, `@react-navigation/native`, `@react-navigation/native-stack`, `mobx`, `mobx-react-lite`, and `rxjs`; install `react-native-screens` and `react-native-safe-area-context` through Expo version resolution; add development-only `@testing-library/react-native` without `react-test-renderer` or Jest; register the SecureStore config plugin in `apps/mobile/package.json` and `apps/mobile/app.config.ts`; and reconcile the resulting `pnpm-lock.yaml` after T001; depends on T001
- [X] T003 Configure MobX with `enforceActions: "always"` in `apps/mobile/src/mobx.config.ts`, import that module from `apps/mobile/src/App.tsx` before any store construction, and add a bootstrap test proving external observable mutation fails in `apps/mobile/src/mobx.config.spec.ts`; depends on T002
- [X] T004 Configure the existing mobile Vitest runner to discover `src/**/*.spec.{ts,tsx}` and `__tests__/**/*.test.tsx`, load deterministic mocks for Expo SecureStore, React Native Safe Area Context, React Navigation/native-stack, and native-only authentication dependencies through `setupFiles`, and prove render/interaction with React Native Testing Library in `apps/mobile/vitest.config.ts`, `apps/mobile/vitest.setup.ts`, and `apps/mobile/__tests__/test-harness.test.tsx`; depends on T002 and T003
- [X] T005 Define Zod-validated `APP_ENV=development|test|staging|production` independently of bootstrap `NODE_ENV`, plus auth, OTP, anti-abuse, SMS budget, fake provider, Orange, JWT, Delivery Receipt, a versioned base64url AES-256-GCM registration-result key, independently configurable daily count/XOF warning and critical percentages defaulting to 80/95 with `0 < warning < critical < 100`, and `INTERNAL_METRICS_ENABLED`/`INTERNAL_METRICS_TOKEN`; require valid base64url secret decoding to the exact or minimum sizes required by each primitive and use `APP_ENV` for deployment-safety decisions, including failure of staging/production startup when metrics are enabled without a valid token, in `apps/api/src/config/env.ts`
- [X] T006 Add safe placeholder names for all feature settings, including `APP_ENV=development`, `SMS_PROVIDER`, HMAC key versions, registration-result encryption key/version, Orange server-only values, disabled Delivery Receipt defaults, `SMS_DAILY_COUNT_WARNING_PERCENT=80`, `SMS_DAILY_COUNT_CRITICAL_PERCENT=95`, `SMS_DAILY_XOF_WARNING_PERCENT=80`, `SMS_DAILY_XOF_CRITICAL_PERCENT=95`, `INTERNAL_METRICS_ENABLED=false`, and an unset `INTERNAL_METRICS_TOKEN` placeholder in `apps/api/.env.example`
- [X] T007 [P] Add configuration tests for `APP_ENV` validation and independence from `NODE_ENV`, registration-result key decoding/exact AES-256 length and key version, alert defaults and invalid percentage ordering/ranges, other invalid secrets, missing Orange settings, rejection of `SMS_PROVIDER=fake` based on `APP_ENV=staging|production` even when `NODE_ENV` differs, disabled metrics without a token, and staging/production startup rejection when metrics are enabled without a valid token in `apps/api/src/config/env.auth.spec.ts`
- [X] T008 [P] Define stable public authentication error codes and explicitly shaped error responses in `apps/api/src/auth/http/auth-error-code.ts` and `apps/api/src/auth/http/auth-error.response.ts`
- [X] T009 [P] Define internal request metadata, installation identity, idempotency, clock, and random-source ports in `apps/api/src/auth/application/auth-context.ts` and `apps/api/src/auth/application/ports.ts`
- [X] T010 [P] Define the provider-neutral `SmsProvider`, send result, delivery capability, and normalized error category contracts in `apps/api/src/sms/application/ports/sms-provider.ts` and `apps/api/src/sms/application/sms-error.ts`
- [X] T011 Add deterministic Nest OpenAPI generation and drift-check commands without changing the source contract in `apps/api/src/openapi/generate-openapi.ts` and `apps/api/package.json`

---

## Phase 2: Foundational Data, Redis, And Fake SMS

**Purpose**: Create the blocking persistence and provider primitives required by
all user stories. PostgreSQL migrations land before dependent services.

**Critical**: Do not start a user-story implementation until T012–T027 are
complete.

### PostgreSQL Models And Migration

- [X] T012 Add Prisma enums and models for `User`, `LegalDocument`, `LegalAcceptance`, `UserSession`, `SessionRefreshToken`, and minimal `SmsDelivery`, including all planned indexes and unique constraints, in `apps/api/prisma/schema.prisma`
- [X] T013 Create the PostgreSQL migration for the phone uniqueness, current legal version, acceptance idempotency, session lineage, and SMS delivery constraints in `apps/api/prisma/migrations/20260728000100_phone_otp_auth/migration.sql`
- [X] T014 Add migration-level tests for duplicate phones, duplicate acceptances, deterministic session creation, refresh lineage, and provider message correlation in `apps/api/test/phone-otp-migration.integration-spec.ts`

### Redis And Security Primitives

- [X] T015 [P] Extend the existing Redis connection into a reusable Nest module with startup health and fail-closed behavior in `apps/api/src/infrastructure/redis/redis.module.ts` and `apps/api/src/infrastructure/redis/redis.service.ts`
- [X] T016 [P] Implement versioned Lua-script loading, SHA caching, `NOSCRIPT` recovery, and typed invocation in `apps/api/src/infrastructure/redis/redis-script-runner.ts`
- [X] T017 [P] Implement versioned HMAC digesting, constant-time digest comparison, opaque credential generation, phone/IP/installation fingerprinting, and AES-256-GCM seal/open helpers with random 96-bit nonces and caller-supplied AAD in `apps/api/src/common/security/credential-crypto.service.ts`
- [X] T018 [P] Add deterministic test clocks and cryptographic test doubles that never use `Math.random()` in `apps/api/src/common/testing/fixed-clock.ts` and `apps/api/src/common/testing/crypto-fixtures.ts`

### SMS Provider Contract And Fake Provider

- [X] T019 [P] Create the reusable `SmsProvider` behavior suite for normalized success, optional message ID, delivery capability, stable errors, and sensitive-data exclusion in `apps/api/src/sms/testing/sms-provider.contract.ts`
- [X] T020 [P] Add failing contract and local debug-channel tests for `FakeSmsProvider`, including allowlisted-number and environment restrictions and proof that no plaintext OTP enters the provider-neutral result or normal HTTP response, in `apps/api/src/sms/infrastructure/fake/fake-sms.provider.spec.ts`
- [X] T021 Implement deterministic accepted/failure fixtures plus a non-exported local/test outbox for allowlisted OTP inspection; keep plaintext inspection limited to direct development/test fixture access and never add it to the provider-neutral result, public OpenAPI, or normal OTP response in `apps/api/src/sms/infrastructure/fake/fake-sms.provider.ts` and `apps/api/src/sms/infrastructure/fake/fake-sms.outbox.ts`
- [X] T022 Add provider-selection tests proving `SmsModule` exports only the provider-neutral token and fails closed for invalid environment/provider combinations in `apps/api/src/sms/sms.module.spec.ts`
- [X] T023 Implement the configuration-selected provider factory and injection token without exporting concrete adapters in `apps/api/src/sms/sms.module.ts`
- [X] T024 [P] Add an SMS message builder test that proves the production template is six-digit aware, GSM-7 compatible, link-free, and one segment in `apps/api/src/sms/application/sms-message-builder.spec.ts`
- [X] T025 Implement the exact `KAYNANN code: 123456. Valid for 5 minutes.` template and GSM-7 segment guard in `apps/api/src/sms/application/sms-message-builder.ts`
- [X] T026 Implement the minimal provider-neutral SMS delivery repository used for message correlation and 30-day retention in `apps/api/src/sms/infrastructure/postgres/sms-delivery.repository.ts`
- [X] T027 Wire Prisma, Redis, shared security, and `SmsModule` into the existing Nest application without importing Orange outside `SmsModule` in `apps/api/src/app.module.ts`

**Checkpoint**: The migration applies, Redis scripts can be loaded, the fake
provider passes the shared contract, and staging/production cannot start with
the fake provider.

---

## Phase 3: User Story 1 - Confirm A Senegalese Phone Number (Priority: P1)

**Goal**: Request, resend, and atomically verify a five-minute OTP for a
normalized Senegalese `+221` number without creating a user or session.

**Independent Test**: With PostgreSQL and Redis running and
`SMS_PROVIDER=fake`, request an OTP for an allowlisted Senegalese number, verify
it exactly once, reject early resend, old/expired/used codes and a sixth wrong
attempt, and confirm that no `User` or `UserSession` exists.

### Tests For User Story 1

- [x] T028 [P] [US1] Add table-driven phone parsing tests for local Senegal formats, E.164 output, invalid length, and unsupported countries in `apps/api/src/otp/domain/senegal-phone.spec.ts`
- [x] T029 [P] [US1] Add OTP cryptography tests for six zero-padded digits, HMAC-only persistence material, key versions, and timing-safe verification in `apps/api/src/otp/domain/otp-crypto.spec.ts`
- [x] T030 [P] [US1] Add Redis state-machine tests for `PREPARED -> ACTIVE -> USED/EXHAUSTED`, five attempts, immutable expiry five minutes after code generation, provider-delay activation with only the remaining TTL, expired-candidate rejection, 60-second cooldown, tombstones, challenge replacement, and bounded pending-promo preserve/replace/remove semantics across request and resend in `apps/api/src/otp/infrastructure/redis/otp-challenge.store.spec.ts`
- [x] T031 [P] [US1] Add Redis concurrency tests proving one send per phone, owner-only lock release, one current challenge, and correct provider-failure reservation handling in `apps/api/src/otp/infrastructure/redis/otp-send-concurrency.spec.ts`
- [x] T032 [P] [US1] Add Redis concurrency tests proving two simultaneous correct verifications yield one success and incorrect attempts cannot race below zero in `apps/api/src/otp/infrastructure/redis/otp-verify-concurrency.spec.ts`
- [x] T033 [P] [US1] Add anti-abuse tests for phone/IP/installation windows, exhaustion blocks, global count/XOF budgets, global concurrency, and non-enumerating responses in `apps/api/src/otp/application/otp-abuse-guard.spec.ts`
- [x] T034 [P] [US1] Add HTTP contract tests for request, resend, and verify DTO validation, safe error codes, response shaping, retry timing, and absence of OTP/provider payloads outside the isolated fake test fixture in `apps/api/test/otp-http.contract-spec.ts`
- [x] T035 [P] [US1] Add MobX `OtpStore` tests for every phone and OTP state, action-only mutation, computed submit/resend state, and no OTP persistence in `apps/mobile/src/auth/stores/otp.store.spec.ts`; add deterministic `OtpFlowService` tests proving typed commands compose cold Observable adapters, results update the store only through actions, private RxJS orchestration provides server-time countdown, offline recovery, `exhaustMap` duplicate-submit suppression and cancellation without automatic OTP-send retry, and disposal terminates all work when the phone/OTP provider unmounts or the flow is replaced in `apps/mobile/src/auth/services/otp-flow.service.spec.ts`

### Implementation For User Story 1

- [x] T036 [P] [US1] Implement server-side Senegal-only parsing and canonical E.164 normalization using the selected phone library in `apps/api/src/otp/domain/senegal-phone.ts`
- [x] T037 [P] [US1] Implement `crypto.randomInt` OTP generation and versioned HMAC verification material in `apps/api/src/otp/domain/otp-crypto.ts`
- [x] T038 [US1] Implement atomic reservation and candidate preparation with immutable `expiresAt = createdAt + 5 minutes`, bounded pending-promo replace/remove state, accepted/uncertain activation that preserves the absolute expiry and latest promo context while applying only the remaining TTL, expired-candidate rejection, old-challenge replacement, cooldown, and definitive-failure refund Lua operations in `apps/api/src/otp/infrastructure/redis/otp-send.scripts.ts`
- [x] T039 [US1] Implement atomic incorrect-attempt decrement, exhaustion/block recording, current-version compare-and-consume, and safe tombstones in `apps/api/src/otp/infrastructure/redis/otp-verify.scripts.ts`
- [x] T040 [US1] Implement the typed OTP challenge store and per-phone lock adapter over the versioned Lua runner in `apps/api/src/otp/infrastructure/redis/otp-challenge.store.ts`
- [x] T041 [US1] Implement atomic phone/IP/installation/global/rate/budget enforcement in the specified check order in `apps/api/src/otp/infrastructure/redis/otp-abuse-guard.ts`
- [x] T042 [US1] Implement request, resend, provider-error handling, timeout-as-uncertain behavior, pending-promo preserve/replace/remove, and verification orchestration returning the verified challenge context through only `SmsProvider` and Redis ports in `apps/api/src/otp/application/otp.service.ts`
- [x] T043 [US1] Export only provider-neutral OTP application operations from `OtpModule` in `apps/api/src/otp/otp.module.ts`
- [x] T044 [P] [US1] Define validated request/resend/verification DTOs with explicit `pendingPromoCode` omitted/present/null semantics and explicitly shaped responses matching the OpenAPI contract in `apps/api/src/auth/http/dto/otp.dto.ts`
- [x] T045 [US1] Implement thin request, resend, and verify endpoints with request metadata extraction and stable exception mapping in `apps/api/src/auth/http/auth.controller.ts` and `apps/api/src/auth/auth.module.ts`
- [x] T046 [P] [US1] Implement the typed cold-Observable mobile `fetch` adapter, product-error decoding, request IDs, installation IDs, RxJS timeout, unsubscribe-driven request cancellation, and offline classification without React or MobX ownership in `apps/mobile/src/api/auth-api.ts`
- [x] T047 [US1] Implement `OtpStore` as the sole observable owner of phone/OTP/challenge/UI state and `OtpFlowService` as a typed command facade with private RxJS request/countdown orchestration, direct Observable-adapter composition, action-only store updates, and idempotent auth-flow-scope disposal; define the typed `{ store, commands }` context contract and provider that exclusively owns and releases this child scope in `apps/mobile/src/auth/stores/otp.store.ts`, `apps/mobile/src/auth/services/otp-flow.service.ts`, and `apps/mobile/src/auth/auth-flow.context.tsx`
- [x] T048 [US1] After T047, inspect `docs/design/mockups/07_login_hd.png` and implement the `observer`-wrapped fixed `+221` phone screen against the typed auth-flow context, with all specified loading/error states, safe-area, keyboard, and disabled controls in `apps/mobile/src/auth/screens/PhoneEntryScreen.tsx`; depends on T047
- [x] T049 [US1] After T047 and T048, inspect `docs/design/mockups/08_otp_verification_hd.png`, implement the `observer`-wrapped single controlled six-digit OTP input against the typed auth-flow context with OS autofill, server-timestamp resend display, and all specified states, then wire unauthenticated phone-to-OTP navigation without moving child-scope ownership into the root in `apps/mobile/src/auth/screens/OtpVerificationScreen.tsx`, `apps/mobile/src/navigation/AuthNavigator.tsx`, and `apps/mobile/src/App.tsx`; depends on T047 and T048

**Checkpoint US1**: Run the US1 tests and the independent fake-provider flow.
The phone can be confirmed once, all OTP rules are server-enforced, and the
database contains no user or session.

---

## Phase 4: User Story 2 - Complete Registration With Legal Acceptance (Priority: P1)

**Goal**: After OTP, let a new or legally stale participant retrieve exact
current legal documents and atomically complete registration. Carry an optional
promo string only as pending context.

**Independent Test**: Verify OTP for a new phone, edit/remove a pending promo,
accept every current mandatory document, and observe exactly one user,
acceptance set, and initial session. Parallel or repeated completion creates no
duplicates; a changed legal version causes no partial writes.

### Tests For User Story 2

- [x] T050 [P] [US2] Add registration-authorization Redis tests for 15-minute TTL, scoped access, opaque token digest lookup, OTP-context promo handoff plus later edit/remove, completion lease, AES-256-GCM sealed result preparation/recovery with AAD substitution rejection, identical same-key responses without rotation, different-key rejection, atomic repair from `COMPLETING` to `COMPLETED`, no pre-commit exposure, and terminal/expired states in `apps/api/src/auth/infrastructure/redis/registration-authorization.store.spec.ts`
- [x] T051 [P] [US2] Add legal service tests for deterministic current mandatory sets, immutable versions, locale filtering, and stale-set rejection in `apps/api/src/legal/application/legal.service.spec.ts`
- [x] T052 [P] [US2] Add PostgreSQL transaction tests for exact legal acceptance, unique phone, audit context, and rollback on legal or session failure in `apps/api/src/auth/application/registration.service.integration-spec.ts`
- [x] T053 [P] [US2] Add concurrent/idempotent completion tests proving one user, one acceptance per document, one deterministic initial session, and byte-identical usable credential results for the same key even when responses are observed out of order; inject a process boundary after PostgreSQL commit but before the Redis `COMPLETED` transition and prove same-key repair returns the original result; assert no refresh-lineage advance or replay revocation and different-key rejection in `apps/api/src/auth/application/registration-concurrency.integration-spec.ts`
- [x] T054 [P] [US2] Add API contract tests for registration context, current legal retrieval, and completion authorization, idempotency, stale versions, and safe dependency failures in `apps/api/test/registration-http.contract-spec.ts`
- [x] T055 [P] [US2] Add MobX `RegistrationStore` tests for promo prefill/edit/remove, action-only mutation, computed completion eligibility, and every legal screen state in `apps/mobile/src/auth/stores/registration.store.spec.ts`; add deterministic `RegistrationFlowService` tests proving typed commands compose cold Observable adapters, results update the store only through actions, private RxJS orchestration handles stale versions, offline recovery, incomplete acceptance, same-key idempotent completion retry and cancellation, and disposal terminates all work on completion, cancellation, or flow replacement without retrying non-idempotent mutations in `apps/mobile/src/auth/services/registration-flow.service.spec.ts`

### Implementation For User Story 2

- [x] T056 [P] [US2] Implement user lookup/create primitives without creating users during OTP-only flows in `apps/api/src/users/infrastructure/postgres/users.repository.ts` and `apps/api/src/users/users.module.ts`
- [x] T057 [P] [US2] Implement atomic immutable legal publication/current-version switching plus exact-acceptance persistence with deterministic ordering and unique-conflict handling in `apps/api/src/legal/infrastructure/postgres/legal.repository.ts` and `apps/api/src/legal/legal.module.ts`
- [x] T058 [P] [US2] Implement initial device-session and generation-zero refresh-row persistence needed by registration completion in `apps/api/src/sessions/infrastructure/postgres/sessions.repository.ts`
- [x] T059 [US2] Implement opaque registration authorization issuance from verified OTP context, original-TTL preservation, promo context mutation, completion lease semantics, and pre-commit AES-256-GCM sealed completion-result storage/recovery bound by flow, idempotency-key digest, and session ID without plaintext credentials in `apps/api/src/auth/infrastructure/redis/registration-authorization.store.ts`
- [x] T060 [US2] Implement current mandatory document retrieval and exact-version validation in `apps/api/src/legal/application/legal.service.ts`
- [x] T061 [US2] Implement OTP post-verification routing that copies the latest verified pending promo into registration authorization for new/legally stale users, discards it for compliant existing users, and grants no main access to incomplete users in `apps/api/src/auth/application/auth.service.ts`
- [x] T062 [US2] Implement the single Prisma registration transaction for user creation/activation, phone confirmation, exact acceptances, audit fields, deterministic session, and initial refresh digest in `apps/api/src/auth/application/registration.service.ts`
- [x] T063 [US2] Generate and seal the deterministic bootstrap credential result before the Prisma transaction, persist only its refresh digest during commit, expose it only after commit, and implement byte-identical same-key recovery without refresh rotation plus different-key rejection; after a post-commit/pre-Redis-transition failure, verify the deterministic session and generation-zero digest before atomically repairing registration state, otherwise reuse the envelope for a transaction retry until authorization expiry, without assuming a distributed Redis/PostgreSQL transaction, in `apps/api/src/auth/application/registration.service.ts`
- [x] T064 [P] [US2] Define validated promo-context, legal-document, and registration-completion DTOs without any referral result fields in `apps/api/src/auth/http/dto/registration.dto.ts` and `apps/api/src/legal/http/dto/legal.dto.ts`
- [x] T065 [US2] Implement scoped registration context, current legal document, and idempotent completion endpoints in `apps/api/src/auth/http/auth.controller.ts` and `apps/api/src/legal/http/legal.controller.ts`
- [x] T066 [P] [US2] Add a cold-Observable secure registration-authorization storage adapter that confines native SecureStore Promises to `defer`/`from`, implement `RegistrationStore` as the sole observable owner of non-secret registration/promo/legal state, implement `RegistrationFlowService` as a typed command facade with private RxJS orchestration and action-only store updates, and provide `{ store, commands }` through a typed registration-scope context that disposes the service on completion, cancellation, or replacement in `apps/mobile/src/auth/storage/registration-authorization.storage.ts`, `apps/mobile/src/auth/stores/registration.store.ts`, `apps/mobile/src/auth/services/registration-flow.service.ts`, and `apps/mobile/src/auth/registration-flow.context.tsx`
- [x] T067 [P] [US2] After T066, extend the phone screen through the typed registration commands for deep-link-prefilled, manually entered, edited, and removed pending promo text without validation or referral calls in `apps/mobile/src/auth/screens/PhoneEntryScreen.tsx`; depends on T066
- [x] T068 [P] [US2] After T066, inspect `docs/design/mockups/09_terms_hd.png` and implement the `observer`-wrapped exact mandatory legal rendering against the typed registration context, all required checkboxes, and every specified loading/submission/error/success state in `apps/mobile/src/auth/screens/LegalAcceptanceScreen.tsx`; depends on T066
- [x] T069 [US2] After T067 and T068, parse the configured referral deep link only into pending promo context, route registration-required outcomes through secure registration context to legal completion, clear pending promo after success, and expose no main-app route before completion in `apps/mobile/src/navigation/AuthNavigator.tsx`; depends on T067 and T068

**Checkpoint US2**: Run the US2 tests and complete registration twice with the
same idempotency key. Confirm one durable aggregate, stale legal rollback, and
no promo validation, referral row, bonus, or registration blockage.

---

## Phase 5: User Story 3 - Log In And Restore A Session (Priority: P1)

**Goal**: Issue access credentials for at most 15 minutes within an absolute
60-day session window, rotate refresh credentials without extending that
window, restore sessions without OTP, detect replay, isolate device sessions,
and gate new mandatory legal versions.

**Independent Test**: Log in a compliant user, restart the mobile state,
successfully rotate refresh once and confirm its absolute expiry is unchanged,
then replay the old token to revoke only that device session and verify a second
device remains active. Advance the test clock to the session deadline and
confirm renewal fails with `REFRESH_EXPIRED` and requires OTP. A stale legal
user is routed to acceptance, not the main application.

### Tests For User Story 3

- [x] T070 [P] [US3] Add access JWT and opaque refresh credential tests for claims, signing, digest-only persistence, sensitive-claim exclusion, immutable `createdAt + 60 days` session expiry, identical expiry across refresh generations, and access expiry capped at the session deadline in `apps/api/src/sessions/application/session-credentials.spec.ts`
- [x] T071 [P] [US3] Add refresh transaction concurrency and boundary-clock tests proving one winner for simultaneous rotation, consistent generation lineage, no deadline extension, and no credential issuance at or after the absolute session deadline in `apps/api/src/sessions/application/session-rotation.integration-spec.ts`
- [x] T072 [P] [US3] Add refresh replay tests proving old-token reuse revokes the session family and denies its newest token in `apps/api/src/sessions/application/session-replay.integration-spec.ts`
- [x] T073 [P] [US3] Add multi-device and current-device logout tests proving other installation sessions remain active in `apps/api/src/sessions/application/session-devices.integration-spec.ts`
- [x] T074 [P] [US3] Add auth endpoint tests for compliant login, stale-legal gating, refresh rotation with unchanged `refreshExpiresAt`, `REFRESH_EXPIRED` at the absolute deadline, terminal refresh errors, access guard revocation/expiry, and logout idempotency in `apps/api/test/session-http.contract-spec.ts`
- [x] T075 [P] [US3] Add MobX `SessionStore` tests proving it is the only observable owner of access/session/root-route state, with action-only restoration/authentication/logout transitions, computed root-route gating, stale-legal routing, offline state, and terminal credential clearing plus OTP routing on absolute session expiry in `apps/mobile/src/auth/stores/session.store.spec.ts`; add deterministic `SessionFlowService` tests proving typed commands compose cold Observable adapters, results update the store only through actions, private RxJS orchestration provides startup and concurrent refresh single-flight with atomic SecureStore replacement, and application-root disposal terminates all work in `apps/mobile/src/auth/services/session-flow.service.spec.ts`

### Implementation For User Story 3

- [x] T076 [P] [US3] Implement HS256 access JWT issuance and validation with only `iss`, `aud`, `sub`, `sid`, `jti`, `iat`, and `exp` claims and `exp` capped at the absolute session deadline in `apps/api/src/sessions/application/access-token.service.ts`
- [x] T077 [P] [US3] Implement opaque 256-bit refresh generation and versioned HMAC lookup material in `apps/api/src/sessions/application/refresh-token.service.ts`
- [x] T078 [US3] Implement atomic conditional refresh rotation using the PostgreSQL clock, immutable `UserSession.expiresAt`, unchanged per-generation expiry, lineage linking, activity updates, expiry transition, and replay-triggered family revocation in `apps/api/src/sessions/infrastructure/postgres/sessions.repository.ts`
- [x] T079 [US3] Implement session issuance with `expiresAt = createdAt + 60 days`, rotation without deadline extension, current-device logout, active-session lookup, and safe terminal `REFRESH_EXPIRED` mapping in `apps/api/src/sessions/application/sessions.service.ts`
- [x] T080 [US3] Implement an access guard that validates JWT claims, current `sid` state, and the absolute session deadline so logout, replay revocation, and expiry are immediate in `apps/api/src/sessions/http/access-session.guard.ts`
- [x] T081 [US3] Export session application ports and guards without exposing token digests or Prisma rows in `apps/api/src/sessions/sessions.module.ts`
- [x] T082 [US3] Complete the compliant-existing-user OTP branch and stale-legal acceptance transaction in `apps/api/src/auth/application/auth.service.ts` and `apps/api/src/auth/application/registration.service.ts`
- [x] T083 [P] [US3] Define explicitly shaped refresh, logout, and stale-legal acceptance DTOs in `apps/api/src/sessions/http/dto/session.dto.ts` and `apps/api/src/legal/http/dto/legal-acceptance.dto.ts`
- [x] T084 [US3] Implement refresh, current-session logout, and existing-user legal acceptance endpoints in `apps/api/src/sessions/http/sessions.controller.ts` and `apps/api/src/legal/http/legal.controller.ts`
- [x] T085 [P] [US3] Implement cold-Observable refresh persistence/deletion adapters using Expo SecureStore on native and an isolated localStorage key on development-only web, confine native SecureStore Promises to `defer`/`from`, reject the web adapter outside `__DEV__`, and keep access tokens only in memory in `apps/mobile/src/auth/storage/session.storage.ts` and `apps/mobile/src/App.tsx`
- [x] T086 [US3] Implement `SessionStore` as the sole observable owner of access/session/root-route state and `SessionFlowService` as a typed command facade with private RxJS ownership of authenticated request coordination, resettable shared refresh single-flight, startup restoration, atomic credential replacement, terminal logout, and stale-legal routing; add a non-observable `AuthCompositionRoot` and typed context that own only the root-scoped `SessionStore` and `SessionFlowService`, expose factories for child auth/registration scopes without retaining created child instances, wire main-route gating, prove disposed children are released, and dispose `SessionFlowService` only at application-root teardown in `apps/mobile/src/auth/stores/session.store.ts`, `apps/mobile/src/auth/services/session-flow.service.ts`, `apps/mobile/src/auth/auth-composition-root.ts`, `apps/mobile/src/auth/auth.context.tsx`, `apps/mobile/src/api/auth-api.ts`, `apps/mobile/src/navigation/RootNavigator.tsx`, and `apps/mobile/src/App.tsx`

**Checkpoint US3**: Run the US3 lifetime, boundary-clock, concurrency, replay,
multi-device, endpoint, and mobile restoration tests. A valid session survives
restart without OTP, rotations preserve its original 60-day deadline, expiry
requires OTP, and a replay revokes only its device family.

---

## Phase 6: User Story 4 - Operate SMS Delivery Safely Without Production Credentials (Priority: P2)

**Goal**: Provide a mocked-contract-tested Orange adapter behind `SmsProvider`
while retaining a safe fake provider for development and automated tests.

**Independent Test**: Point the Orange adapter at the local mock HTTP server,
exercise official success and documented failure fixtures, prove synchronized
OAuth caching and bounded retry, run the shared provider contract against both
adapters, and verify that no live credentials or network are required.

### Tests For User Story 4

- [x] T087 [P] [US4] Build a local Orange OAuth, SMS submission, and Delivery Receipt mock server with official-shape fixtures only in `apps/api/src/sms/infrastructure/orange/testing/orange-mock-server.ts` and `apps/api/src/sms/infrastructure/orange/testing/orange-fixtures.ts`
- [x] T088 [P] [US4] Add OAuth cache tests for Basic client credentials, expiry safety skew, one refresh for concurrent sends, cache invalidation, and auth failure in `apps/api/src/sms/infrastructure/orange/orange-oauth-client.spec.ts`
- [x] T089 [P] [US4] Add Orange send tests for the official sender path, `tel:+221...` recipient, outbound DTO, provider message ID, and no provider DTO leakage in `apps/api/src/sms/infrastructure/orange/orange-sms.provider.spec.ts`
- [x] T090 [P] [US4] Add error-normalization tests for invalid config/credentials, balance, 429, invalid recipient, rejection, timeout, 5xx, malformed response, and dependency failure in `apps/api/src/sms/infrastructure/orange/orange-error-mapper.spec.ts`
- [x] T091 [P] [US4] Add bounded retry tests proving backoff only for configured transient failures and no retry for permanent failures in `apps/api/src/sms/infrastructure/orange/orange-retry.spec.ts`
- [x] T092 [P] [US4] Apply the shared provider behavior suite to `OrangeSmsProvider` and re-run it against `FakeSmsProvider` in `apps/api/src/sms/infrastructure/orange/orange-sms.contract.spec.ts` and `apps/api/src/sms/infrastructure/fake/fake-sms.contract.spec.ts`
- [x] T093 [P] [US4] Add Delivery Receipt tests for feature disablement, schema/network checks, duplicate and late transitions, unknown message IDs, and no OTP effect in `apps/api/test/orange-delivery-receipt.contract-spec.ts`

### Implementation For User Story 4

- [x] T094 [P] [US4] Define private Orange OAuth, outbound SMS, response, and receipt DTOs matching only documented official fields in `apps/api/src/sms/infrastructure/orange/orange.dto.ts`
- [x] T095 [P] [US4] Implement documented Orange response classification into provider-neutral stable categories in `apps/api/src/sms/infrastructure/orange/orange-error-mapper.ts`
- [x] T096 [US4] Implement synchronized OAuth client-credentials acquisition and token reuse until the configured pre-expiry safety point in `apps/api/src/sms/infrastructure/orange/orange-oauth-client.ts`
- [x] T097 [US4] Implement bounded exponential backoff with maximum attempts/delay and permanent-error exclusion in `apps/api/src/sms/infrastructure/orange/orange-retry.ts`
- [x] T098 [US4] Implement Orange SMS submission, approved sender address/name handling, normalized result capture, timeouts, and private DTO containment in `apps/api/src/sms/infrastructure/orange/orange-sms.provider.ts`
- [x] T099 [US4] Register the Orange adapter privately in the configuration-selected `SmsModule` factory without changing the exported provider contract in `apps/api/src/sms/sms.module.ts`
- [x] T100 [US4] Implement idempotent provider-neutral Delivery Receipt state transitions and unknown-event acknowledgement in `apps/api/src/sms/application/sms-delivery.service.ts`
- [x] T101 [US4] Implement the feature-flagged Orange receipt callback with validation and configured network restriction checks in `apps/api/src/sms/infrastructure/orange/orange-delivery-receipt.controller.ts`
- [x] T102 [US4] Add an end-to-end mocked Orange test covering token acquisition, accepted SMS persistence, normalized errors, retries, and optional receipts in `apps/api/test/orange-sms.integration-spec.ts`
- [x] T103 [US4] Add a no-live-credentials CI test that fails on external Orange hosts and proves all Orange suites use the local mock server in `apps/api/test/orange-offline-safety.spec.ts`

**Checkpoint US4**: Both implementations pass the same provider contract;
Orange OAuth/send/error/retry/receipt behavior passes against the mock server;
local and CI validation require no customer credential.

---

## Phase 7: Observability, Limits, And SMS-Pumping Hardening

**Purpose**: Complete cross-story security and operational requirements without
changing public business behavior.

- [X] T104 [P] Add metric contract tests for disabled route `404`, missing/invalid bearer `401`, valid bearer `200` with Prometheus content type, spoofed proxy headers without access, OTP/send/verification/rate/budget/refresh/replay/optional receipt series, Redis-backed current count/XOF consumption, hard limits, default absolute warning/critical gauges of 400/475 SMS and 8,000/9,500 XOF, UTC reset behavior, and absence of sensitive or high-cardinality labels in `apps/api/src/observability/auth-metrics.spec.ts` and `apps/api/test/internal-metrics.contract-spec.ts`
- [X] T105 Implement a dedicated `prom-client` registry and auth metrics facade that reads authoritative daily budget counters from Redis, derives absolute count/XOF warning and critical gauges with `ceil(limit * percent / 100)`, and exposes them through `GET /internal/metrics` guarded by `INTERNAL_METRICS_ENABLED` plus timing-safe bearer comparison without credential logging; instrument OTP, SMS, registration, session, and receipt services in `apps/api/src/observability/auth-metrics.ts`, `apps/api/src/observability/internal-metrics.guard.ts`, `apps/api/src/observability/metrics.controller.ts`, and `apps/api/src/observability/observability.module.ts`
- [X] T106 [P] Add structured-log redaction tests for OTPs, complete phones, promo text, all token types, Orange credentials, SMS bodies, and provider payloads in `apps/api/src/common/redacted-exception.filter.spec.ts`
- [X] T107 Extend exception mapping and structured security logging to use request IDs, UUIDs, fingerprints, normalized categories, and safe latency only in `apps/api/src/common/redacted-exception.filter.ts` and `apps/api/src/common/security/safe-auth-logger.ts`
- [X] T108 [P] Add SMS-pumping integration tests for check ordering, fixed-window expiry, non-refundable actor probes, refundable definitive no-send budget, uncertain-send retention, provider throughput, and global semaphore recovery in `apps/api/test/sms-pumping.integration-spec.ts`
- [X] T109 Harden the abuse Lua operations against partial reservation and semaphore leaks and expose only safe retry guidance in `apps/api/src/otp/infrastructure/redis/otp-abuse-guard.ts` and `apps/api/src/otp/infrastructure/redis/otp-send.scripts.ts`
- [X] T110 [P] Add HTTPS/trusted-proxy boundary tests for production auth routes and Delivery Receipt network restrictions; prove `X-Forwarded-For` and related spoofable headers never authorize the metrics endpoint in `apps/api/test/auth-transport-security.spec.ts`
- [X] T111 Enforce secure transport and trusted request metadata extraction outside isolated local development, while keeping internal metrics authorization independent of client IP and proxy headers, in `apps/api/src/main.ts` and `apps/api/src/auth/http/auth-request-context.middleware.ts`
- [X] T112 [P] Add unit tests for retention cutoff calculation and deletion selection for expired/revoked sessions, refresh lineage metadata, and 30-day SMS delivery records in `apps/api/src/auth/application/auth-retention.service.spec.ts`; exclude Redis tombstones and counters because T030 and T108 verify their TTL lifecycle
- [X] T113 [P] Add unit tests for daily `03:00 UTC` cron/provider registration and same-process overlap suppression in `apps/api/src/auth/application/auth-retention.scheduler.spec.ts`
- [X] T114 [P] Add a Docker PostgreSQL integration test with two independent Prisma connections proving that the failed `pg_try_advisory_xact_lock` transaction performs no deletion, the successful holder cleans up in the same interactive transaction, and the lock is available after transaction end in `apps/api/test/auth-retention-lock.integration-spec.ts`
- [X] T115 Initialize `ScheduleModule.forRoot()` once in the API root module; register the retention scheduler and service as `AuthModule` providers; implement a daily `03:00 UTC` cron handler with `waitForCompletion: true`; and run idempotent 90-day session-history and 30-day SMS-delivery cleanup only after successful `pg_try_advisory_xact_lock` acquisition inside the same Prisma interactive transaction, skipping cleanup when the lock is unavailable, in `apps/api/src/app.module.ts`, `apps/api/src/auth/auth.module.ts`, `apps/api/src/auth/application/auth-retention.scheduler.ts`, and `apps/api/src/auth/application/auth-retention.service.ts`

---

## Phase 8: API, Mobile, Integration, Security, And Acceptance Validation

**Purpose**: Verify all story boundaries together, OpenAPI parity, all mobile
states, and absence of out-of-scope referral effects.

- [X] T116 [P] Add Swagger decorators and deterministic schemas to all feature controllers and DTOs, then reconcile generated output with `specs/002-phone-otp-auth/contracts/openapi.yaml` in `apps/api/src/auth/http/auth.controller.ts`, `apps/api/src/legal/http/legal.controller.ts`, and `apps/api/src/sessions/http/sessions.controller.ts`
- [X] T117 [P] Add OpenAPI parity tests for every auth, legal, session, and optional receipt endpoint, response, auth scheme, idempotency header, stable error code, and `Cache-Control: no-store` on credential responses; assert response credential fields remain present in generated mobile response types without `writeOnly`, every public OTP response omits plaintext/debug OTP fields, and `/internal/metrics` is absent from the generated public contract in `apps/api/test/openapi.contract-spec.ts`
- [X] T118 [P] Add a full fake-provider integration journey that asserts no `User` or `UserSession` exists for a new phone after SMS acceptance or OTP verification alone, then covers pending-promo replacement/removal through resend and verified-context handoff, legal registration, byte-identical same-key retry without refresh rotation, session restart/rotation, stale legal acceptance, logout, and no duplicate durable records in `apps/api/test/phone-auth.integration-spec.ts`
- [X] T119 [P] Add dependency-failure integration tests for Redis/PostgreSQL/provider unavailability after OTP confirmation and retryable registration completion in `apps/api/test/phone-auth-dependency-failure.integration-spec.ts`
- [X] T120 [P] Add security regression tests that inspect public responses, logs, metrics, Prisma rows, and Redis values for forbidden plaintext OTPs, tokens, full phones, Orange secrets, and provider payloads in `apps/api/test/phone-auth-sensitive-data.security-spec.ts`
- [X] T121 [P] Add an explicit scope test proving pending promo never invokes validation, creates referral persistence, awards value, or blocks registration in `apps/api/test/pending-promo-scope.integration-spec.ts`
- [X] T122 [P] After the T004 RNTL harness smoke test passes, add React Native component-flow tests using real MobX stores with mocked typed command facades for all phone, OTP, legal, startup, refresh, and offline states; assert accessibility, duplicate-press suppression, observer-driven rerenders, no public RxJS subjects in screen props, correct `{ store, commands }` context use, phone/OTP disposal on auth-provider unmount or replacement, registration disposal on completion/cancellation/replacement, session disposal only on application-root unmount, and that `AuthCompositionRoot` retains no disposed child auth or registration scope instance in `apps/mobile/__tests__/phone-auth-flow.test.tsx`
- [ ] T123 Compare phone, OTP, and legal screens on representative iOS/Android sizes against `docs/design/mockups/07_login_hd.png`, `docs/design/mockups/08_otp_verification_hd.png`, and `docs/design/mockups/09_terms_hd.png`, and record observed deviations only in `specs/002-phone-otp-auth/quickstart.md`; do not edit implementation files, and create separately approved follow-up tasks with exact paths for any required remediation
- [ ] T124 Run the feature filters and repository validation commands; verify from Vitest collection/output that `mobx.config.spec.ts`, `otp.store.spec.ts`, `otp-flow.service.spec.ts`, `registration.store.spec.ts`, `registration-flow.service.spec.ts`, `session.store.spec.ts`, `session-flow.service.spec.ts`, and `phone-auth-flow.test.tsx` all execute; record commands, results, and any failures only in `specs/002-phone-otp-auth/quickstart.md`; do not edit implementation files, and block the checkpoint until separately approved exact-path remediation tasks pass
- [ ] T125 Execute every functional automated and manual-local scenario currently defined in `specs/002-phone-otp-auth/quickstart.md` and record the local acceptance result without marking performance, moderated usability, or live Orange checks complete
- [X] T126 Add and run a deterministic normal-health performance harness with 200 independent OTP request/verification identities at concurrency 10 and 500 independent refresh sessions at concurrency 20; seed local PostgreSQL/Redis, use fake SMS, report per-operation p50/p95/error rate, and fail above auth p95 500 ms or refresh p95 300 ms in `scripts/verify-phone-auth-performance.mjs`, `package.json`, and `specs/002-phone-otp-auth/quickstart.md`
- [ ] T127 Run the SC-011 moderated usability protocol from `specs/002-phone-otp-auth/quickstart.md` with 20 eligible independent participants and create `specs/002-phone-otp-auth/acceptance/usability.md` containing the anonymized per-participant evidence, exclusions and replacements, aggregate result, and explicit pass/fail decision; pass only when at least 19 of 20 participants complete the full new-user phone confirmation and mandatory legal-acceptance flow without product assistance within 180 seconds of active task time

**Checkpoint**: All four stories work together with fake or mocked Orange,
OpenAPI is in sync, sensitive-data scans pass, every mobile state is covered,
the documented p95 thresholds pass, and SC-011 has a recorded result showing at
least 19 successful attempts in the fixed cohort of 20 eligible participants.

---

## Phase 9: Post-Credential Orange Acceptance Checklist

**Purpose**: Validate customer-specific Orange behavior only after explicit
credential approval. This phase does not block local implementation or automated
feature completion. The following manual release gates are intentionally not
implementation tasks and are not processed by the Speckit task-completion
workflow:

- Confirm live OAuth acquisition, synchronized renewal, assigned sender address, approved Sender Name, and secret handling, then record redacted evidence in `specs/002-phone-otp-auth/acceptance/orange-live-checklist.md`.
- Confirm live Senegal delivery, GSM-7 rendering, provider message ID, purchased-bundle balance behavior, documented failures, throughput, timeout, and retry safety, then record redacted evidence in `specs/002-phone-otp-auth/acceptance/orange-live-checklist.md`.
- Confirm callback reachability and customer-approved authenticity/network controls before enabling duplicate, late, and unknown Delivery Receipt checks in `specs/002-phone-otp-auth/acceptance/orange-live-checklist.md`.
- Recalculate production global SMS/XOF budgets from the purchased Orange bundle, update deployment-owned values, and record approval without committing secrets in `specs/002-phone-otp-auth/acceptance/orange-live-checklist.md`.
- Run the production configuration, fake-exposure, secret, log, metric, and public-response audit and record sign-off in `specs/002-phone-otp-auth/acceptance/orange-live-checklist.md`.

---

## Dependencies And Execution Order

### Phase Dependencies

- **Phase 1** has no feature dependency and reuses the bootstrap monorepo.
- **Phase 2** depends on Phase 1 and blocks every user story.
- **US1 (Phase 3)** depends on Phase 2.
- **US2 (Phase 4)** depends on US1's verified-phone outcome and Phase 2 durable
  models; it does not depend on Orange.
- **US3 (Phase 5)** depends on US2's initial-session persistence, while its
  rotation/replay tests remain independently runnable with fixtures.
- **US4 (Phase 6)** depends only on the Phase 2 provider contract and can run in
  parallel with US1–US3 after Phase 2.
- **Phase 7** depends on the services it instruments and hardens.
- **Phase 8** depends on the selected story phases and Phase 7; T127 follows a
  usable mobile build and may be scheduled separately from automated CI.
- **Phase 9** is a manual operational release checklist that depends on customer
  credentials and approvals, not a set of implementation tasks and not a
  prerequisite for local feature completion.

### Requested Technical Stage Mapping

| Requested stage                           | Tasks                                                              |
| ----------------------------------------- | ------------------------------------------------------------------ |
| 1. Contracts, configuration, models       | T001–T018                                                          |
| 2. OTP challenge and atomic Redis         | T030–T043                                                          |
| 3. `SmsProvider` and shared contract      | T010, T019, T022–T023, T092                                        |
| 4. `FakeSmsProvider`                      | T020–T021, T092                                                    |
| 5. Mocked `OrangeSmsProvider`             | T087–T103                                                          |
| 6. Registration and legal                 | T050–T069                                                          |
| 7. Sessions, rotation, replay             | T058, T070–T086                                                    |
| 8. API contracts and Nest endpoints       | T011, T034, T044–T045, T054, T064–T065, T074, T083–T084, T116–T117 |
| 9. React Native auth flow                 | T002–T004, T035, T046–T049, T055, T066–T069, T075, T085–T086, T122–T124 |
| 10. Observability and pumping defenses    | T033, T041, T104–T115                                              |
| 11. Integration/security/acceptance tests | T014, T052–T054, T071–T075, T102–T103, T108, T110, T112–T114, T117–T127 |
| 12. Post-credential Orange acceptance     | Manual checklist in Phase 9; no implementation task IDs             |

### User Story Dependency Graph

```text
Phase 1 -> Phase 2 -> US1 -> US2 -> US3
                     \---------------> US4
US1 + US2 + US3 + US4 -> Phase 7 -> Phase 8

Phase 9: optional post-credential release checklist outside task completion
```

### Within Each User Story

- Write the listed tests first and confirm they fail for the expected missing
  behavior.
- Complete domain/storage primitives before application services.
- Complete services before controllers and mobile integration.
- Run the smallest story-specific test filter after each logical diff.
- Do not mark a story checkpoint complete until its independent test passes.

## Parallel Opportunities

### User Story 1

```text
T028, T029, T030, T031, T032, T033, T034, and T035 can be authored in parallel.
After backend contracts stabilize, T046 can proceed independently. Complete
T047 before T048, then complete T049 after both typed context and phone screen
are available.
```

### User Story 2

```text
T050, T051, T052, T053, T054, and T055 can be authored in parallel.
After the migration, T056, T057, and T058 can proceed in parallel.
After DTOs stabilize, complete T066. T067 and T068 may then proceed in parallel;
T069 follows both.
```

### User Story 3

```text
T070 through T075 can be authored in parallel.
T076 and T077 can proceed in parallel; T083 and T085 can proceed in parallel.
```

### User Story 4

```text
T087 through T093 can be authored in parallel against the documented fixtures.
T094 and T095 can proceed in parallel before the OAuth/send adapter is assembled.
```

## Implementation Strategy

### MVP First

1. Complete Phase 1 and Phase 2.
2. Complete US1 and validate phone confirmation independently.
3. Complete US2 so a confirmed participant can become a registered user.
4. Complete US3 so registration/login yields a durable rotating session.
5. Use `FakeSmsProvider`; do not wait for Orange credentials.

### Incremental Delivery

1. **Foundation**: migration, Redis runner, security primitives, provider
   contract, and safe fake provider.
2. **US1**: Senegal phone confirmation with atomic OTP behavior.
3. **US2**: legal-gated, idempotent registration with pending promo context only.
4. **US3**: rotating multi-device sessions and mobile restoration.
5. **US4**: Orange adapter validated entirely through mock HTTP.
6. **Hardening**: metrics, pumping controls, transport, retention, and complete
   cross-story acceptance.
7. **Live acceptance**: only after customer credentials and explicit approval.

## Functional Requirement Coverage

| Requirement | Covering tasks                                                                     |
| ----------- | ---------------------------------------------------------------------------------- |
| FR-001      | T028, T036, T048                                                                   |
| FR-002      | T028, T036, T048                                                                   |
| FR-003      | T028, T036, T044                                                                   |
| FR-004      | T029, T037                                                                         |
| FR-005      | T017, T029, T037, T120                                                             |
| FR-006      | T029, T032, T037–T040                                                              |
| FR-007      | T030–T032, T038–T040                                                               |
| FR-008      | T030, T032, T039–T042                                                              |
| FR-009      | T030, T035, T038, T049                                                             |
| FR-010      | T005, T033, T041, T108–T109                                                        |
| FR-011      | T031, T038, T040–T042                                                              |
| FR-012      | T024–T025                                                                          |
| FR-013      | T034, T042, T118                                                                    |
| FR-014      | T051, T060–T061, T082                                                              |
| FR-015      | T050, T059, T061, T066                                                             |
| FR-016      | T052, T060–T062                                                                    |
| FR-017      | T012–T014, T052, T058, T062                                                        |
| FR-018      | T005–T007, T013–T014, T017, T050, T053, T059, T062–T063, T117–T120                 |
| FR-019      | T012–T014, T056, T062                                                              |
| FR-020      | T051–T054, T060, T062, T068                                                        |
| FR-021      | T050, T052, T059, T063, T119                                                       |
| FR-022      | T050, T054, T059, T066                                                             |
| FR-023      | T030, T038, T042, T044, T050, T055, T059, T061, T064, T067, T069, T118, T121       |
| FR-024      | T058, T070, T076–T079, T082                                                        |
| FR-025      | T005, T070, T076–T079                                                              |
| FR-026      | T012–T014, T070–T071, T077–T079                                                    |
| FR-027      | T072, T078–T080                                                                    |
| FR-028      | T073–T074, T079–T086                                                               |
| FR-029      | T075, T085–T086                                                                    |
| FR-030      | T074–T075, T079, T086                                                              |
| FR-031      | T051, T054, T074–T075, T082–T086                                                   |
| FR-032      | T010, T019, T023, T042, T092                                                       |
| FR-033      | T010, T019–T023, T092, T098                                                        |
| FR-034      | T010, T023, T042–T045, T094–T099                                                   |
| FR-035      | T005–T007, T022–T023, T099                                                         |
| FR-036      | T005–T007, T020–T023                                                               |
| FR-037      | T005–T007, T020–T021                                                               |
| FR-038      | T087–T089, T094, T096–T098, T102                                                   |
| FR-039      | T005–T007, T087–T103, T106–T107, T120                                              |
| FR-040      | T008, T010, T090, T095, T098                                                       |
| FR-041      | T091, T097–T098, T102                                                              |
| FR-042      | T087–T103; Phase 9 manual checklist                                                |
| FR-043      | T012–T014, T026, T093, T100–T102                                                   |
| FR-044      | T019–T022, T087–T103                                                               |
| FR-045      | T008, T034, T044–T045, T054, T074, T090, T095, T106–T107                           |
| FR-046      | T017, T019–T021, T034, T070, T087–T103, T106–T107, T120                            |
| FR-047      | T005–T007, T034, T044–T045, T054, T074, T110–T111, T119                            |
| FR-048      | T033, T041, T104–T109                                                              |
| FR-049      | T026, T093, T100–T105                                                              |
| FR-050      | T008, T034–T035, T044–T049, T054–T055, T064–T069, T074–T075, T083–T086, T090, T095 |

**Unmapped functional requirements**: None.

## Success Criteria Coverage

| Criterion | Covering tasks |
| --------- | -------------- |
| SC-001 | T028, T034, T036, T118 |
| SC-002 | T030–T032, T038–T040 |
| SC-003 | T030, T032, T035, T038–T039, T049 |
| SC-004 | T052–T053, T062, T118 |
| SC-005 | T051–T055, T061–T062, T068, T074–T075, T082–T086, T118 |
| SC-006 | T071–T075, T078–T080, T085–T086, T118 |
| SC-007 | T106–T107, T120 |
| SC-008 | T007, T020–T023, T087–T103, T124–T125 |
| SC-009 | T008, T090–T091, T095, T097–T098, T106–T107 |
| SC-010 | T010, T019–T023, T042, T092, T099 |
| SC-011 | T122–T123, T127 |
| SC-012 | T033, T041, T104–T109 |
| SC-013 | T050, T055, T059, T064, T067, T069, T121 |
| SC-014 | T126 |

## Supporting Plan Decision Coverage

These enabling tasks implement approved plan and architecture decisions rather
than one isolated product requirement. They remain traceable as follows:

| Tasks | Approved decision or story support |
| ----- | ---------------------------------- |
| T001 | API dependencies required by FR-001, FR-024, FR-045, and FR-048 |
| T002–T004 | Mobile secure storage, navigation, MobX/RxJS ownership, and US1–US3 test harness |
| T009 | Request metadata, idempotency, clock, and randomness ports supporting US1–US3 |
| T011 | Bootstrap-compatible OpenAPI generation supporting FR-045 and FR-050 |
| T015–T016 | Redis health and atomic Lua execution supporting FR-006–FR-011 |
| T018 | Deterministic cryptographic/time fixtures supporting OTP and session tests |
| T027 | Provider-neutral Nest wiring supporting FR-032–FR-034 |
| T057 | Durable legal version/acceptance behavior supporting FR-016, FR-017, and FR-020 |
| T112–T115 | Session/SMS retention lifecycle and scheduler decisions from `data-model.md` |
| T116–T117 | Public OpenAPI parity and response-shaping decisions supporting FR-045 and FR-050 |

## Scope Guard

No task implements promo validation/application, referral relationships,
bonuses, referral history, fallback SMS routing, non-Senegal numbers, email or
social recovery, water purchase/dispensing, QR, MQTT, payments, liter balance,
or push notifications.

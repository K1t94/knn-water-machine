# Tasks: Referral Program Scope Revision

**Input**: Design documents from `specs/005-referral-program/`

**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`,
`contracts/`, and `quickstart.md`

**Tests**: Required by the specification and quickstart. Story test tasks are
listed before implementation tasks and must initially fail for the revised
behavior.

**Migration context**: The referral feature already exists. These tasks migrate
the current implementation; they do not recreate it. Historical relationships,
entitlements, wallet operations, and promo codes are preserved.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel because it targets different files and has no
  dependency on another incomplete task in the same phase.
- **[US#]**: Maps the task to a user story in `spec.md`.
- Every task names the exact file or files it changes.

## Technical Phase Mapping

| Requested technical work | Task phase |
|---|---|
| Additive migration and persistent feature state | Phases 1-2 |
| Registration-only inviter bonus | Phase 3, US1 |
| Remove welcome/apply/eligibility behavior | Phase 3, US1 |
| Operational API, curl, and package commands | Phase 4, US2 |
| Public availability and `FEATURE_DISABLED` | Phase 4, US2 |
| Recovery pause/resume and wallet race barrier | Phase 4, US2 |
| Mobile MobX/RxJS availability and hidden UI | Phase 5, US3 |
| Eligibility contract migration | Phase 7 |
| Contract, integration, concurrency, mobile, and rollout validation | Phase 8 |

---

## Phase 1: Setup - Additive Migration And Configuration

**Purpose**: Introduce the durable flag without changing current enabled
behavior or historical referral data.

- [X] T001 Add the singleton `ReferralFeatureState` Prisma model and the enabled-by-default, idempotent seed migration in `apps/api/prisma/schema.prisma` and `apps/api/prisma/migrations/20260812000100_add_referral_feature_state/migration.sql`
- [X] T002 Add PostgreSQL migration assertions for seeded enabled state, constraints, restart persistence, and unchanged referral/wallet row counts in `apps/api/test/referral-migration.integration-spec.ts`
- [X] T003 [P] Replace `REFERRAL_WELCOME_BONUS_ML` with validated `REFERRAL_OPERATIONS_TOKEN` configuration while retaining `REFERRAL_INVITER_BONUS_ML` in `apps/api/src/config/env.ts`, `apps/api/src/config/env.referral.spec.ts`, and `apps/api/.env.example`
- [X] T004 [P] Add fixture helpers for reading, resetting, and locking the singleton feature row through independent Prisma clients in `apps/api/test/referral-postgres.fixture.ts`

**Checkpoint**: The expand migration is deployable first, seeds existing
installations as enabled, and does not alter accounting facts.

**Minimal validation**: Run `pnpm db:generate`,
`pnpm --filter @kaynann/api typecheck`, and, when the PostgreSQL acceptance
environment is available,
`RUN_POSTGRES_INTEGRATION=1 pnpm --filter @kaynann/api exec vitest run test/referral-migration.integration-spec.ts`.

---

## Phase 2: Foundational - Persistent Feature State Boundary

**Purpose**: Provide one server-authoritative availability boundary shared by
registration, public reads, operations, recovery, and the wallet guard.

**CRITICAL**: Complete this phase before any user-story implementation.

- [X] T005 Define typed read, shared-lock assertion, and idempotent exclusive-update ports for `REFERRAL_PROGRAM` in `apps/api/src/referral/application/ports/referral-feature-state.repository.ts`
- [X] T006 [P] Add service unit tests for enabled/disabled reads, same-value updates, revision transitions, and fail-closed storage errors in `apps/api/src/referral/application/referral-feature-state.service.spec.ts`
- [X] T007 [P] Add PostgreSQL tests using independent Prisma clients for shared/exclusive lock ordering, idempotent updates, revision monotonicity, and multi-instance visibility in `apps/api/test/referral-feature-state.integration-spec.ts`
- [X] T008 Implement the feature-state application service without an authoritative in-memory cache in `apps/api/src/referral/application/referral-feature-state.service.ts`
- [X] T009 Implement the Prisma repository and transactional lock operations in `apps/api/src/referral/infrastructure/postgres/prisma-referral-feature-state.repository.ts`
- [X] T010 Register the feature-state port, repository, and service for shared use in `apps/api/src/referral/referral.module.ts`

**Checkpoint**: All API instances obtain availability from the same persistent
row, and storage failure cannot silently enable referral effects.

**Minimal validation**: Run
`pnpm --filter @kaynann/api test -- src/referral/application/referral-feature-state.service.spec.ts`
after the service diff, then
`pnpm --filter @kaynann/api test:referral:postgres -- test/referral-feature-state.integration-spec.ts`
when the PostgreSQL acceptance environment is available.

---

## Phase 3: User Story 1 - Apply A Promo Code During Registration (Priority: P1) MVP

**Goal**: Complete registration with optional pending promo context, creating
one relationship and one inviter bonus only for a valid code while enabled.
Remove welcome, invitee, post-registration apply, and purchase-eligibility
behavior from the active implementation.

**Independent Test**: Complete no-code, valid, invalid, unavailable, and self
registrations after OTP and legal acceptance; replace/remove pending context;
retry and race completion; verify only the valid enabled case creates one
`REGISTRATION` relationship, one `INVITER` entitlement, and one inviter wallet
credit, with no invitee or welcome credit.

### Tests For User Story 1

- [X] T011 [P] [US1] Rewrite onboarding unit tests for no-code, valid, invalid, self, disabled, welcome-free, and invitee-credit-free outcomes in `apps/api/src/auth/application/registration.service.spec.ts` and `apps/api/src/referral/application/referral-provisioning.service.spec.ts`
- [X] T012 [P] [US1] Rewrite PostgreSQL registration acceptance tests for OTP/legal ordering, final pending-code selection, one inviter entitlement, zero registering-user referral operations, and an immutable configured-amount snapshot that is unchanged by later configuration changes in `apps/api/test/referral-registration.integration-spec.ts`
- [X] T013 [P] [US1] Add at least 100 replay and concurrent completion attempts, including competing valid codes, proving one immutable inviter relationship and at most one inviter credit in `apps/api/test/referral-concurrency.integration-spec.ts` and `apps/api/src/auth/application/registration-concurrency.integration-spec.ts`
- [X] T014 [P] [US1] Remove the post-registration operation and eligibility/application schemas from `specs/005-referral-program/contracts/openapi.yaml`, then update registration HTTP contract tests to preserve auth/session responses while proving the removed route is absent in `apps/api/test/registration-http.contract-spec.ts` and `apps/api/test/referral-http.contract-spec.ts`
- [X] T015 [P] [US1] Rewrite delivery tests so only `INVITER` entitlements can reach the wallet, entitlement amount remains the immutable creation-time snapshot, and legacy `WELCOME` rows remain inert in `apps/api/src/referral/application/referral-bonus-delivery.service.spec.ts`

### Implementation For User Story 1

- [X] T016 [US1] Replace the onboarding boundary with registration-completion input/result semantics and remove post-registration command types in `apps/api/src/referral/application/referral-registration.integration.ts`
- [X] T017 [US1] Refactor the Prisma registration integration to lock availability in the registration transaction, provision a stable user code, and atomically create only `REGISTRATION`/`INVITER` facts in `apps/api/src/referral/infrastructure/postgres/prisma-referral-registration.integration.ts`
- [X] T018 [US1] Invoke referral completion only after OTP, current legal acceptance, and successful registration finalization while consuming the final pending promo context in `apps/api/src/auth/application/registration.service.ts`
- [X] T019 [US1] Restrict provisioning to idempotent stable promo-code creation and remove eligibility creation in `apps/api/src/referral/application/referral-provisioning.service.ts` and `apps/api/src/referral/infrastructure/postgres/referral-promo-provisioner.ts`
- [X] T020 [US1] Remove welcome/invitee entitlement creation and post-registration application methods from `apps/api/src/referral/application/referral-application.service.ts`
- [X] T021 [US1] Restrict delivery constants and logic to inviter obligations without modifying historical delivered wallet operations in `apps/api/src/referral/application/referral-bonus-delivery.service.ts` and `apps/api/src/referral/domain/referral-types.ts`
- [X] T022 [US1] Remove eligibility, welcome, post-registration application, and attached-code operations from the repository port and Prisma repository while retaining historical enum/channel reads in `apps/api/src/referral/application/ports/referral.repository.ts` and `apps/api/src/referral/infrastructure/postgres/prisma-referral.repository.ts`
- [X] T023 [US1] Delete the active eligibility service and purchase-close boundary files `apps/api/src/referral/application/referral-eligibility.service.ts`, `apps/api/src/referral/application/referral-eligibility.service.spec.ts`, and `apps/api/src/referral/composition/close-referral-eligibility.ts`
- [X] T024 [US1] Remove application request DTOs, eligibility/attached-code response fields, and stale application error mappings in `apps/api/src/referral/http/dto/referral-request.dto.ts`, `apps/api/src/referral/http/dto/referral-response.dto.ts`, `apps/api/src/referral/http/referral-response.mapper.ts`, `apps/api/src/referral/http/referral-response.mapper.spec.ts`, `apps/api/src/referral/http/referral-error.filter.ts`, and `apps/api/src/referral/domain/referral-errors.ts`
- [X] T025 [US1] Remove `POST /v1/referrals/applications` and its injected application service from `apps/api/src/referral/http/referral.controller.ts`
- [X] T026 [US1] Remove eligibility/application providers and purchase-close exports while retaining registration, query, recovery, and provisioning composition in `apps/api/src/referral/referral.module.ts` and `apps/api/src/referral/referral.module.spec.ts`

**Checkpoint**: US1 is independently usable as the MVP. Registration is the
only referral-application point and never rewards the registering user.

**Minimal validation**: Run the changed unit and HTTP contract files with
`pnpm --filter @kaynann/api test -- src/auth/application/registration.service.spec.ts src/referral/application/referral-provisioning.service.spec.ts src/referral/application/referral-bonus-delivery.service.spec.ts test/registration-http.contract-spec.ts test/referral-http.contract-spec.ts`, then run
`pnpm --filter @kaynann/api typecheck` and
`pnpm --filter @kaynann/api test:referral:registration` when PostgreSQL and
Redis acceptance services are available.

---

## Phase 4: User Story 2 - Control Referral Availability (Priority: P1)

**Goal**: Let authorized operators toggle a persistent runtime flag through
HTTP, curl, and root package commands; enforce the state across public APIs,
registration, recovery, and the final wallet-write boundary.

**Independent Test**: Toggle through curl and package commands, repeat each
operation, reject bad credentials/body, restart and use multiple API instances,
register while disabled, and pause/resume a pending inviter entitlement without
creating a duplicate credit.

### Operational API, Curl, And Package Commands

- [x] T027 [P] [US2] Add strict operational GET/PUT contract tests for authentication, validation, no-store headers, idempotent revision behavior, secret-safe failures, successful enable/disable completion within 30 seconds, and zero state changes from unauthorized attempts in `apps/api/test/referral-feature-operations.contract-spec.ts`
- [x] T028 [P] [US2] Add unit tests for constant-time bearer-token validation and strict boolean-only DTO input in `apps/api/src/referral/http/referral-operations.guard.spec.ts` and `apps/api/src/referral/http/dto/referral-feature-operation.dto.spec.ts`
- [x] T029 [US2] Implement the dedicated operations bearer guard without logging or returning credentials in `apps/api/src/referral/http/referral-operations.guard.ts`
- [x] T030 [P] [US2] Implement strict operational request/response DTO shaping with decimal-string revisions in `apps/api/src/referral/http/dto/referral-feature-operation.dto.ts`
- [x] T031 [US2] Implement protected, no-store `GET` and idempotent `PUT /internal/feature-flags/referral-program` outside public Swagger in `apps/api/src/referral/http/referral-feature-operations.controller.ts`
- [x] T032 [US2] Register the operational controller and guard in `apps/api/src/referral/referral.module.ts`
- [x] T033 [P] [US2] Add Node tests for missing env, enable/disable, PUT-then-GET verification, malformed/non-2xx responses, state mismatch, network failure, and token redaction in `scripts/set-referral-feature.test.mjs`
- [x] T034 [US2] Implement the environment-driven HTTP helper with strict failure handling and authoritative read-back in `scripts/set-referral-feature.mjs`
- [x] T035 [US2] Add root `referral:enable` and `referral:disable` scripts that pass no repository secret in `package.json`

### Public Availability And `FEATURE_DISABLED`

- [x] T036 [P] [US2] Add public app-config and `FEATURE_DISABLED` definitions to `specs/005-referral-program/contracts/openapi.yaml`, then add contract tests for exact privacy-safe shape, no-store headers, storage failure, and visibility of every successful change across at least three live API instances within five seconds in `apps/api/test/app-config.contract-spec.ts`
- [x] T037 [P] [US2] Add referral HTTP tests requiring identical `503 FEATURE_DISABLED` envelopes from both public referral reads while registration remains available in `apps/api/test/referral-http.contract-spec.ts`
- [x] T038 [US2] Implement the public app-config response DTO and unauthenticated no-store controller in `apps/api/src/app-config/http/dto/app-config-response.dto.ts` and `apps/api/src/app-config/http/app-config.controller.ts`
- [x] T039 [US2] Compose the public app-config endpoint with the referral availability service in `apps/api/src/app-config/app-config.module.ts` and `apps/api/src/app.module.ts`
- [x] T040 [US2] Add stable `FEATURE_DISABLED` domain-to-HTTP mapping without exposing preserved data in `apps/api/src/referral/domain/referral-errors.ts`, `apps/api/src/referral/http/referral-error.filter.ts`, and `apps/api/src/referral/http/referral.controller.ts`
- [x] T041 [US2] Gate referral summary and invitation queries with an authoritative availability read in `apps/api/src/referral/application/referral-query.service.ts`

### Recovery Pause/Resume And Wallet Race Barrier

- [x] T042 [P] [US2] Rewrite recovery unit tests for inviter-only claims, disabled zero-claim behavior, lost-guard release, legacy welcome exclusion, and re-enabled idempotent delivery in `apps/api/src/referral/application/referral-recovery.service.spec.ts`
- [x] T043 [P] [US2] Add PostgreSQL race tests for toggle-before-claim, toggle-after-claim, wallet-commit/link failure, concurrent workers, both toggle/registration lock orders, and at least 100 disable/re-enable cycles that preserve existing facts and deliver every pre-disable incomplete inviter obligation exactly once in `apps/api/test/referral-recovery.integration-spec.ts` and `apps/api/test/referral-concurrency.integration-spec.ts`
- [x] T044 [US2] Extend the trusted wallet command boundary with referral feature-guard context in `apps/api/src/wallet/application/wallet-command.ts` and `apps/api/src/wallet/application/ports/wallet.repository.ts`
- [x] T045 [US2] Acquire the shared feature-row lock immediately before the idempotent referral ledger insert in `apps/api/src/wallet/application/wallet-command.service.ts` and `apps/api/src/wallet/infrastructure/postgres/prisma-wallet.repository.ts`
- [x] T046 [US2] Pause inviter claims while disabled and safely release or resume already claimed obligations in `apps/api/src/referral/application/referral-recovery.service.ts` and `apps/api/src/referral/composition/referral-recovery.scheduler.ts`
- [x] T047 [US2] Pass the trusted feature guard through live delivery and recovery CLI composition in `apps/api/src/referral/application/referral-bonus-delivery.service.ts` and `apps/api/src/referral/cli/recover-referral-bonuses.ts`

**Checkpoint**: US2 is independently testable through both operator interfaces;
after a successful disable boundary, no new relationship, entitlement, or
referral wallet credit can start, and pending inviter work resumes once.

**Minimal validation**: Run changed guard, DTO, service, script, and HTTP tests
with `pnpm --filter @kaynann/api test -- src/referral/application/referral-feature-state.service.spec.ts src/referral/http/referral-operations.guard.spec.ts src/referral/http/dto/referral-feature-operation.dto.spec.ts src/referral/application/referral-recovery.service.spec.ts test/referral-feature-operations.contract-spec.ts test/app-config.contract-spec.ts test/referral-http.contract-spec.ts` and
`node --test scripts/set-referral-feature.test.mjs`; run
`pnpm --filter @kaynann/api openapi:check` after public controller changes, then
run the PostgreSQL race suites when their acceptance environment is available.

---

## Phase 5: User Story 3 - Share My Referral Code (Priority: P2)

**Goal**: Preserve enabled code/link sharing while making server availability
the MobX-owned source for registration and referral UI, with RxJS cancellation
and complete removal of signed-in apply behavior.

**Independent Test**: Load enabled availability, view/copy/share a stable code,
open a link while signed out and signed in, disable during active requests and
registration, then verify all referral UI/context is hidden or cleared and late
results cannot restore it.

### Tests For User Story 3

- [x] T048 [P] [US3] Add cold Observable app-config adapter tests for strict response shaping, abort teardown, and privacy-field rejection in `apps/mobile/src/api/app-config-api.spec.ts`
- [x] T049 [P] [US3] Add MobX tests for unknown/loading/enabled/disabled/error transitions, revision-free public state, atomic clearing on session replacement, and complete hidden/visible UI eligibility within five seconds of an authoritative refresh in `apps/mobile/src/features/stores/feature-availability.store.spec.ts`
- [x] T050 [P] [US3] Add RxJS service tests for refresh, stale-request cancellation, disable publication within five seconds, session replacement, retry, and disposal in `apps/mobile/src/features/services/feature-availability.service.spec.ts`
- [x] T051 [US3] Rewrite mobile referral API/store/flow tests after T049 to remove apply and eligibility state, translate a referral `FEATURE_DISABLED` response into the shared `FeatureAvailabilityStore` disabled transition, atomically clear referral state, and reject stale data after disable in `apps/mobile/src/api/referral-api.spec.ts`, `apps/mobile/src/referral/stores/referral.store.spec.ts`, `apps/mobile/src/referral/services/referral-flow.service.spec.ts`, and `apps/mobile/src/features/stores/feature-availability.store.spec.ts`
- [x] T052 [P] [US3] Rewrite deep-link tests for enabled anonymous pending context, disabled/unknown rejection, and unconditional signed-in ignore behavior in `apps/mobile/src/navigation/referral-link-coordinator.spec.ts`
- [x] T053 [P] [US3] Update auth/navigation UI tests for hidden promo input/routes, disable-during-registration local and authorized-server context clearing, enabled sharing, and logout/session isolation in `apps/mobile/__tests__/phone-auth-flow.test.tsx`, `apps/mobile/src/auth/services/registration-flow.service.spec.ts`, `apps/mobile/src/navigation/AuthNavigator.spec.ts`, and `apps/mobile/src/navigation/MainNavigator.spec.tsx`

### Implementation For User Story 3

- [x] T054 [US3] Implement a typed cold Observable public app-config adapter with AbortController teardown in `apps/mobile/src/api/app-config-api.ts`
- [x] T055 [US3] Implement `FeatureAvailabilityStore` as the sole owner of unknown/loading/enabled/disabled/error availability state in `apps/mobile/src/features/stores/feature-availability.store.ts`
- [x] T056 [US3] Implement the disposable RxJS refresh/cancellation workflow that publishes authoritative availability to MobX in `apps/mobile/src/features/services/feature-availability.service.ts`
- [x] T057 [US3] Compose and dispose app-config availability with auth and referral scopes in `apps/mobile/src/App.tsx` and `apps/mobile/src/auth/auth-composition-root.ts`
- [x] T058 [US3] Remove apply operations and eligibility/attached-code state, route referral `FEATURE_DISABLED` API errors into the single `FeatureAvailabilityStore` disabled transition, and atomically clear/invalidate referral data and in-flight reads on disable or session epoch change in `apps/mobile/src/api/referral-api.ts`, `apps/mobile/src/referral/stores/referral.store.ts`, `apps/mobile/src/referral/services/referral-flow.service.ts`, `apps/mobile/src/referral/referral-composition-root.ts`, and `apps/mobile/src/features/stores/feature-availability.store.ts`
- [x] T059 [US3] Make anonymous deep links populate editable pending context only while enabled and ignore all signed-in referral links in `apps/mobile/src/navigation/referral-link-coordinator.ts`
- [x] T060 [US3] Hide or clear registration promo context while availability is unknown/disabled, persist null through the existing authenticated registration-context update when authorization is available, and omit the code from OTP/completion payloads in `apps/mobile/src/auth/stores/registration.store.ts`, `apps/mobile/src/auth/services/registration-flow.service.ts`, `apps/mobile/src/auth/services/otp-flow.service.ts`, and `apps/mobile/src/auth/screens/PhoneEntryScreen.tsx`
- [x] T061 [US3] Delete `apps/mobile/src/referral/screens/ApplyReferralCodeScreen.tsx` and `apps/mobile/src/referral/screens/ApplyReferralCodeScreen.spec.tsx`, then remove the route, imports, callbacks, and signed-in navigation binding from `apps/mobile/src/navigation/MainNavigator.tsx`
- [x] T062 [US3] Observe availability in root/main navigation, hide referral entry points and routes while unknown/disabled, and leave an active referral route on disable in `apps/mobile/src/navigation/RootNavigator.tsx`, `apps/mobile/src/navigation/MainNavigator.tsx`, and `apps/mobile/src/wallet/screens/WalletScreen.tsx`
- [x] T063 [US3] Preserve enabled code/link rendering and copy/share actions without apply controls, including an acceptance check that users can locate and copy the code/link and open the supported system share flow within 10 seconds, in `apps/mobile/src/referral/screens/ReferralScreen.tsx`, `apps/mobile/src/referral/screens/ReferralScreen.spec.tsx`, and `apps/mobile/src/referral/native/referral-native-actions.spec.ts`

**Checkpoint**: US3 remains independently testable when enabled, while disabled
and unknown states expose no referral navigation, content, input, or retained
deep-link context.

**Minimal validation**: Run changed mobile tests with
`pnpm --filter @kaynann/mobile test -- src/api/app-config-api.spec.ts src/features/stores/feature-availability.store.spec.ts src/features/services/feature-availability.service.spec.ts src/api/referral-api.spec.ts src/referral/stores/referral.store.spec.ts src/referral/services/referral-flow.service.spec.ts src/navigation/referral-link-coordinator.spec.ts src/auth/services/registration-flow.service.spec.ts src/navigation/AuthNavigator.spec.ts src/navigation/MainNavigator.spec.tsx __tests__/phone-auth-flow.test.tsx src/referral/screens/ReferralScreen.spec.tsx src/referral/native/referral-native-actions.spec.ts`, followed by
`pnpm --filter @kaynann/mobile typecheck`; use
`pnpm --filter @kaynann/mobile build:js` after navigation/composition changes.

---

## Phase 6: User Story 4 - Review Referral Results (Priority: P2)

**Goal**: Preserve privacy-safe inviter totals and deterministic paginated
history while enabled, and return no data while disabled.

**Independent Test**: Load zero, one-page, and multi-page histories for separate
inviters, verify exact credited inviter-only totals and stable ordering, then
disable and re-enable without changing or duplicating stored data.

### Tests For User Story 4

- [x] T064 [P] [US4] Add query unit tests for inviter-only credited totals, final-two-digit privacy labels, stable pagination, owner isolation, enabled-state enforcement, and traversal of at least 250 records without duplicates or omissions in `apps/api/src/referral/application/referral-query.service.spec.ts`
- [x] T065 [P] [US4] Update PostgreSQL repository tests for preserved history, deterministic cursors across at least 250 records, inviter-only totals, and unchanged data across at least 100 disable/re-enable cycles in `apps/api/test/referral-repository.integration-spec.ts`
- [x] T066 [P] [US4] Update mobile history tests for zero, loaded, traversal of at least 250 records, retry, disable clearing, re-enable reload, and stale page rejection in `apps/mobile/src/referral/screens/ReferralScreen.spec.tsx`

### Implementation For User Story 4

- [x] T067 [US4] Remove eligibility/application fields from referral summary projection while retaining owner-scoped inviter totals and privacy-safe cursor history in `apps/api/src/referral/application/referral-query.service.ts` and `apps/api/src/referral/infrastructure/postgres/prisma-referral.repository.ts`
- [x] T068 [US4] Keep summary/history MobX and RxJS pagination state enabled-only, serialized, session-scoped, and resettable on disable in `apps/mobile/src/referral/stores/referral.store.ts` and `apps/mobile/src/referral/services/referral-flow.service.ts`
- [x] T069 [US4] Render zero/loaded/paginated inviter history from API truth and suppress all content/actions when unavailable in `apps/mobile/src/referral/screens/ReferralScreen.tsx`

**Checkpoint**: US4 reports only credited inviter outcomes, remains private and
deterministic, and preserves data invisibly through a disabled interval.

**Minimal validation**: Run
`pnpm --filter @kaynann/api test -- src/referral/application/referral-query.service.spec.ts`
and the changed mobile referral-screen test, then run the PostgreSQL repository
suite when its acceptance environment is available.

---

## Phase 7: Eligibility Contract Migration

**Purpose**: Prepare and test the schema contraction before rollout, then remove
transient purchase-eligibility storage only after all new runtime code is
deployed and old API instances have been drained.

- [x] T070 Prove no runtime code or generated client references `ReferralEligibility` before contraction in `apps/api/src/referral/referral-boundaries.spec.ts` and `apps/api/test/referral-migration.integration-spec.ts`
- [x] T071 Prepare the non-cascading contract migration that drops only `ReferralEligibility` constraints/table and remove its Prisma relation/model while retaining legacy bonus/channel enum values in `apps/api/prisma/migrations/20260812000200_drop_referral_eligibility/migration.sql` and `apps/api/prisma/schema.prisma`; do not apply this migration to a shared environment yet
- [x] T072 Add and run disposable-database contract-migration assertions for preserved users, promo codes, relationships, entitlements, and wallet ledger rows, prove the new binary works with the contracted schema, and document that post-contraction recovery rejects legacy binaries and uses a corrected forward deployment rather than a down migration or recreated eligibility data in `apps/api/test/referral-migration.integration-spec.ts` and `specs/005-referral-program/checklists/rollout-readiness.md`
- [ ] T073 After T070-T072 pass and the compatible backend is deployed, record and approve the blocking pre-application gate with deployed API versions, proof that every live instance is covered by T070, old-instance termination/drain evidence, and the responsible approver; then apply the prepared migration and record its applied identity plus post-apply preservation checks in `specs/005-referral-program/checklists/rollout-readiness.md`

**Checkpoint**: Eligibility storage is absent only after the rolling-deployment
drain gate, with no cascade or rewrite of historical accounting data.

**Minimal validation**: Before any shared-environment drain, run
`pnpm db:generate`, `pnpm --filter @kaynann/api typecheck`, and the targeted
migration acceptance suite in a disposable PostgreSQL database. T073 separately
records the gate, application, and post-apply checks for the target environment.

---

## Phase 8: Contracts, Integration, Concurrency, Mobile, And Rollout Validation

**Purpose**: Synchronize source/generated contracts and close all cross-story,
security, concurrency, visual, migration, rollout, and rollback gates.

- [x] T074 Reconcile the public OpenAPI source updated in T014 and T036 with the completed controllers/DTOs, proving removed post-registration and eligibility schemas remain absent and operational routes remain excluded, in `specs/005-referral-program/contracts/openapi.yaml`
- [x] T075 [P] Verify the protected GET/PUT implementation remains aligned with its standalone internal contract in `specs/005-referral-program/contracts/operational-feature-flag.openapi.yaml` and `apps/api/test/referral-feature-operations.contract-spec.ts`
- [x] T076 Regenerate the aggregate public artifact after updating generator inputs in `apps/api/src/openapi/generate-openapi.ts` and `specs/005-referral-program/contracts/openapi.generated.json`
- [x] T077 Add aggregate contract assertions for app-config, disabled errors, removed apply route/schemas, and exclusion of operational routes in `apps/api/test/openapi.contract-spec.ts` and `apps/api/test/referral-http.contract-spec.ts`
- [x] T078 [P] Add static regression checks that welcome env/config, public apply route, eligibility-close command, apply screen, and active eligibility access cannot return in `apps/api/src/referral/referral-boundaries.spec.ts`, `apps/api/src/config/env.referral.spec.ts`, and `apps/mobile/src/navigation/MainNavigator.spec.tsx`
- [x] T079 Run and independently record quickstart curl and package-script enable/disable completion under 30 seconds, repeated idempotent toggles, unauthorized attempts with zero state changes, and failed-toggle handling in the operational-control section of `specs/005-referral-program/checklists/runtime-rollout-validation.md`
- [x] T080 Run and independently record restart persistence plus authoritative flag visibility across at least three API instances within five seconds in the persistence-and-multi-instance section of `specs/005-referral-program/checklists/runtime-rollout-validation.md`
- [x] T081 Run and independently record enabled/disabled registration outcomes, at least 100 data-preserving disable/enable cycles, paused obligation behavior, and exactly-once recovery after re-enable in the registration-and-recovery section of `specs/005-referral-program/checklists/runtime-rollout-validation.md`
- [x] T082 Run and record targeted API typecheck, unit, OpenAPI, PostgreSQL migration, registration, recovery, wallet-race, and concurrency results in `specs/005-referral-program/checklists/backend-validation.md`
- [ ] T083 Run and record mobile typecheck/build/tests plus iOS and Android comparison with `docs/design/mockups/06_referral_program_hd.png`, proving enabled hierarchy, complete disabled UI absence within five seconds of authoritative refresh, and code/link copy plus supported system share discoverability within 10 seconds in `specs/005-referral-program/checklists/mobile-visual.md`
- [ ] T084 Complete `specs/005-referral-program/checklists/rollout-readiness.md` with the executed rollout order, confirmation that the T073 gate immediately preceded migration application, historical row-count checks, the disabled-first forward-recovery procedure, and residual risks

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 - Setup**: Starts immediately; the additive migration must deploy
  before backend code expects the feature row.
- **Phase 2 - Foundational**: Depends on Phase 1 and blocks all user stories.
- **Phase 3 - US1**: Depends on Phase 2; establishes the revised registration
  and inviter-only domain behavior.
- **Phase 4 - US2**: Depends on Phase 2 and uses the US1 registration boundary
  for disabled/toggle race validation. Finish US1 before the final US2 race
  tasks T043-T047.
- **Phase 5 - US3**: Depends on Phase 4 public app-config availability; enabled
  sharing can otherwise be developed independently from US4 history work.
- **Phase 6 - US4**: Depends on Phase 4 server gating and Phase 5 shared mobile
  availability/store lifecycle.
- **Phase 7 - Contract Migration**: Depends on Phases 3-6. Prepare and validate
  the contraction through T070 -> T071 -> T072 before the production drain;
  T073 may apply it only after the compatible backend is deployed and every old
  API instance is drained.
- **Phase 8 - Validation**: Depends on every selected story and the migration
  phase intended for that rollout.

### User Story Dependencies

- **US1 (P1)**: Begins after the persistent flag foundation; no dependency on
  sharing or history UI.
- **US2 (P1)**: Begins after the persistent flag foundation; operational API
  and public availability are independently testable before recovery race tests
  integrate with US1.
- **US3 (P2)**: Requires the US2 public availability contract, but not US4.
- **US4 (P2)**: Requires the shared US2 gating and US3 availability lifecycle;
  backend query tests can begin after Phase 2.

### Within Each User Story

- Write the listed story tests first and confirm revised assertions fail.
- Implement boundary models/ports before services and controllers.
- Implement server availability before mobile consumption.
- Run focused unit/contract tests before PostgreSQL race suites.
- After each logical diff, run and record the smallest applicable validation
  command from its phase checkpoint rather than deferring all checks to T082 or
  T083.
- Do not apply the eligibility contract migration to a shared environment during
  T071 or T072. T073 must record and approve the complete old-binary drain
  immediately before application.

---

## Parallel Opportunities

### User Story 1

```text
T011: registration/provisioning unit tests
T012: PostgreSQL registration acceptance tests
T013: replay and competing-code concurrency tests
T014: registration/referral HTTP contract tests
T015: inviter-only delivery unit tests
```

### User Story 2

```text
T027: operational HTTP contract tests
T028: operational guard/DTO unit tests
T033: root helper Node tests
T036: public app-config contract tests
T037: FEATURE_DISABLED referral HTTP tests
T042: recovery unit tests
T043: PostgreSQL race tests after US1 registration semantics are complete
```

### User Story 3

```text
T048: app-config adapter tests
T049: MobX availability-store tests
T050: RxJS availability-service tests
T051: referral API/store/flow migration tests after T049
T052: deep-link tests
T053: auth/navigation UI tests
```

### User Story 4

```text
T064: query-service tests
T065: PostgreSQL repository tests
T066: mobile history tests
```

---

## Implementation Strategy

### MVP First

1. Complete Phases 1 and 2.
2. Complete Phase 3 (US1).
3. Validate registration independently, including absence of invitee/welcome
   credit and idempotent inviter-only delivery.
4. Do not ship the revised behavior without the US2 kill switch if runtime
   disablement is part of the release acceptance gate.

### Incremental Delivery

1. Deploy the additive feature-state migration seeded enabled.
2. Deploy US1 and US2 backend code, then verify operational disable/enable,
   public availability, registration gating, and recovery barriers.
3. Release US3/US4 mobile behavior after the server app-config contract exists.
4. Prepare and pass T070-T072 in a disposable database, deploy the compatible
   backend, then drain every old instance and execute the T073 gate/application.
5. Complete Phase 8 evidence before enabling referral acquisition after rollout.

### Rollback Rule

Disable referrals first, then roll back only to a schema-compatible binary that
cannot recreate welcome or post-registration behavior. Never reverse wallet
credits, delete historical referral facts, or use a destructive data down
migration.

## Notes

- `[P]` tasks target different files or independent test fixtures.
- Story labels provide traceability to `spec.md`; setup, foundational,
  migration, and final validation tasks intentionally have no story label.
- Legacy `WELCOME` and `POST_REGISTRATION` enum values remain historical-only;
  retaining them is not permission to create new rows.
- `ReferralEligibility` remains only for rolling compatibility until Phase 7.
- Contract source changes in T014 and T036 precede backend/mobile consumers;
  T074 is a final reconciliation rather than the first contract update.
- Commit and validate one logical diff at a time in the listed dependency order,
  using the phase-specific minimal validation commands above.

# Tasks: Water Wallet And Immutable Ledger

**Input**: Design documents from `/specs/004-water-wallet-ledger/`

**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`,
`contracts/openapi.yaml`, `contracts/internal-wallet-commands.md`, and
`quickstart.md`

**Tests**: Tests are required. In every behavior phase, contract or unit tests
are added before implementation. PostgreSQL concurrency, transaction,
constraint, and trigger behavior must be tested against real PostgreSQL 17 and
must not be replaced with mocks or SQLite.

**Organization**: The technical stages from `plan.md` are retained while work
is tagged to user stories. The transactional write core (US2) precedes the read
stories because it establishes the invariants and test data they consume.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Safe to execute in parallel because it changes different files and
  does not depend on another incomplete task in the same phase.
- **[US1]–[US4]**: Maps the task to a user story in `spec.md`.
- Every task names exact files, explicit dependencies, a minimum validation
  command, and an observable completion criterion.

## Phase Mapping

| Tasks phase | `plan.md` implementation phase |
| --- | --- |
| Phase 1 | Setup and baseline verification |
| Phase 2 | 1. Domain contracts and Prisma migration |
| Phase 3 | 2. Transactional repository and internal commands |
| Phases 4-5 | 3. Authenticated read API |
| Phase 6 | 4. Mobile API, MobX store, and RxJS flow |
| Phase 7 | 5. Minimal wallet presentation |
| Phase 8 | 6. Regression and acceptance validation |

---

## Phase 1: Setup And Baseline

**Purpose**: Confirm the existing toolchain and service prerequisites without
adding dependencies or changing framework versions.

- [X] T001 Verify the locked Node, pnpm, Prisma, PostgreSQL, NestJS, Expo, MobX, RxJS, Vitest, ESLint, TypeScript, and Prettier baseline and the existing validation scripts in `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `apps/api/package.json`, `apps/mobile/package.json`, and `infra/compose.yaml`; depends on no prior task; validate with `pnpm check:repo && pnpm check:env`; done when all required commands exist, the workspace is healthy, and implementation requires no new dependency or framework upgrade.

**Checkpoint**: The repository baseline is reproducible and no dependency
installation is planned.

---

## Phase 2: Domain Contracts And Prisma Migration

**Purpose**: Establish exact integer domain contracts and database-enforced
wallet/ledger invariants before implementing business behavior.

**Critical**: Complete this phase before any repository, HTTP, or mobile task.

### Tests First

- [X] T002 [P] Add failing table-driven unit tests for positive `bigint` water amounts, zero-balance representation, signed-delta overflow boundaries, string serialization, and rejection of fractional/number/unsafe values in `apps/api/src/wallet/domain/water-amount.spec.ts`; depends on T001; validate with `pnpm --filter @kaynann/api test -- src/wallet/domain/water-amount.spec.ts`; done when the tests encode millilitre-only arithmetic and fail only because the domain types are not implemented.
- [X] T003 [P] Add a real-PostgreSQL migration test suite covering a fresh database, a database with the completed feature-002 migration and representative auth data, foreign keys, global business-key uniqueness, positive amount checks, non-negative balance checks, signed-delta consistency, compensation constraints, ledger immutability under `UPDATE` and `DELETE`, and required indexes in `apps/api/test/wallet-migration.integration-spec.ts`; depends on T001; validate with `RUN_POSTGRES_INTEGRATION=1 pnpm --filter @kaynann/api test -- test/wallet-migration.integration-spec.ts`; done when the suite is automatically skipped without the opt-in flag and fails against PostgreSQL until the wallet migration exists.

### Domain And Persistence Foundation

- [X] T004 Implement exact `bigint` millilitre value parsing, checked arithmetic, bounds, and public decimal-string serialization in `apps/api/src/wallet/domain/water-amount.ts` and stable domain/application errors for invalid amount, insufficient balance, overflow, idempotency conflict, invalid compensation, and reconciliation failure in `apps/api/src/wallet/domain/wallet-errors.ts`; depends on T002; validate with `pnpm --filter @kaynann/api test -- src/wallet/domain/water-amount.spec.ts`; done when no wallet calculation accepts floating-point input and every boundary test passes.
- [X] T005 Define immutable operation facts, bounded direction/kind/source types, compensation origin facts, deterministic history cursor/page types, internal credit/debit/compensate commands, and repository interfaces in `apps/api/src/wallet/domain/wallet-operation.ts`, `apps/api/src/wallet/application/wallet-command.ts`, and `apps/api/src/wallet/application/ports/wallet.repository.ts`; depends on T004; validate with `pnpm --filter @kaynann/api typecheck`; done when application contracts contain no Prisma types, money fields, HTTP DTOs, or dependencies on referral, payment, MQTT, or dispensing modules.
- [X] T006 Add the `WaterWallet` balance projection, immutable `WalletLedgerEntry`, direction enum, owner relation, global business-event uniqueness, monotonic sequence, compensation self-relation, timestamps, and planned indexes to `apps/api/prisma/schema.prisma`; depends on T005; validate with `pnpm --filter @kaynann/api exec prisma format`; done when Prisma models express all portable keys/relations without automatic schema synchronization.
- [X] T007 Create the reviewed SQL migration in `apps/api/prisma/migrations/20260804000100_water_wallet_ledger/migration.sql`, adding tables/enums/sequences plus explicit PostgreSQL `CHECK` constraints, unique/index definitions, foreign keys, and a `BEFORE UPDATE OR DELETE` immutable-ledger trigger/function; depends on T006; validate with `pnpm --filter @kaynann/api db:generate`; done when SQL protects positive amounts, non-negative balances, signed direction consistency, compensation shape, globally unique business keys, and ledger immutability beyond Prisma capabilities.
- [X] T008 Extend `apps/api/test/wallet-migration.integration-spec.ts` with named assertions for the finalized SQL constraint and trigger errors, including rejection of direct projection underflow and overflow; depends on T007; validate with `RUN_POSTGRES_INTEGRATION=1 pnpm --filter @kaynann/api test -- test/wallet-migration.integration-spec.ts`; done when every database invariant fails closed using real PostgreSQL and the test distinguishes constraint failures from test setup failures.
- [X] T009 Generate the package-managed Prisma Client and validate schema/type compatibility for `apps/api/prisma/schema.prisma` and `apps/api/tsconfig.json`; depends on T007; validate with `pnpm db:generate && pnpm --filter @kaynann/api typecheck`; done when generated wallet types compile from the configured `prisma-client-js` generator and no generated file is manually edited or linted.
- [X] T010 Validate forward-only migration application on both an empty database and an existing feature-002 database using `apps/api/prisma/migrations/20260804000100_water_wallet_ledger/migration.sql`, `apps/api/test/wallet-migration.integration-spec.ts`, and `scripts/db-migrate.mjs`; depends on T008 and T009; validate with `RUN_POSTGRES_INTEGRATION=1 pnpm --filter @kaynann/api test -- test/wallet-migration.integration-spec.ts`; done when both upgrade paths preserve auth/session rows and produce an initially absent wallet that reads as zero by contract.

**Checkpoint**: Exact domain types compile, the reviewed migration upgrades
fresh and feature-002 databases, and PostgreSQL itself enforces ledger
immutability and numeric invariants.

---

## Phase 3: User Story 2 - Record A Balance Change Exactly Once (Priority: P1)

**Goal**: Trusted internal commands atomically credit, debit, and compensate a
wallet exactly once without allowing negative balances, overflow, lost updates,
or partial ledger records.

**Independent Test**: On real PostgreSQL, execute successful and repeated
commands, conflicting retries, concurrent debits, concurrent same-key credits,
compensation, forced rollback, and reconciliation; observe one projection and
an immutable, exactly matching ledger.

### Tests First

- [X] T011 [P] [US2] Add unit tests for command validation, stable error mapping including unknown and ineligible owners as `WALLET_USER_INELIGIBLE`, idempotent-result reuse, conflicting immutable facts, and no repository call for malformed credit/debit/compensation commands in `apps/api/src/wallet/application/wallet-command.service.spec.ts`; depends on T010; validate with `pnpm --filter @kaynann/api test -- src/wallet/application/wallet-command.service.spec.ts`; done when tests define the internal command boundary and fail before the service implementation.
- [X] T012 [P] [US2] Add real-PostgreSQL integration tests for lazy wallet creation by the first accepted mutation, exact credit/debit projection updates, 100 sequential identical-event submissions producing one effect, global database-backed idempotency across users, conflicting retry rejection, explicit unknown and `SUSPENDED` owner rejection with `WALLET_USER_INELIGIBLE`, insufficient balance, upper-bound overflow, and one ledger entry per accepted command in `apps/api/test/wallet-postgres.integration-spec.ts`; depends on T010; validate with `RUN_POSTGRES_INTEGRATION=1 pnpm --filter @kaynann/api test -- test/wallet-postgres.integration-spec.ts`; done when tests use the real Prisma/PostgreSQL adapter, preserve zero state for ineligible owners, and cannot pass with application-only idempotency.
- [X] T013 [P] [US2] Add real-PostgreSQL race tests using separate database connections and a start barrier for at least 100 concurrent debit attempts whose total demand exceeds the balance and 100 concurrent credits sharing one business key in `apps/api/test/wallet-concurrency.integration-spec.ts`; depends on T010; validate with `RUN_POSTGRES_INTEGRATION=1 pnpm --filter @kaynann/api test -- test/wallet-concurrency.integration-spec.ts`; done when assertions require no negative balance, no lost update, exactly one same-key ledger entry and balance effect, and deterministic retry classification for every completed caller.
- [X] T014 [P] [US2] Add real-PostgreSQL tests for validation failure before transaction, conditional insufficient/overflow no-match, forced ledger-insert failure after projection update, losing unique-key race, valid compensation of a same-user debit, multiple compensations with distinct business keys referencing the same debit, duplicate compensation-key replay, rejection of cross-user/non-debit/missing origins, immutable ledger behavior through the repository, and projection-to-ledger reconciliation in `apps/api/test/wallet-transaction.integration-spec.ts`; depends on T010; validate with `RUN_POSTGRES_INTEGRATION=1 pnpm --filter @kaynann/api test -- test/wallet-transaction.integration-spec.ts`; done when the forced post-update failure rolls back both records, every other rejected boundary preserves the last committed state without an append, and valid distinct compensation events remain independently idempotent.

### Implementation

- [X] T015 [US2] Implement Prisma-to-domain mapping, active-owner verification, lazy projection creation, operation lookup by global business key, and transaction-local helpers in `apps/api/src/wallet/infrastructure/postgres/prisma-wallet.repository.ts`; depends on T012; validate with `pnpm --filter @kaynann/api typecheck`; done when infrastructure is the only wallet layer importing Prisma and missing/deactivated owners cannot receive a wallet mutation.
- [X] T016 [US2] Implement `READ COMMITTED` transactions with conditional atomic `UPDATE ... WHERE ... RETURNING` credit/debit statements and same-transaction ledger insertion in `apps/api/src/wallet/infrastructure/postgres/prisma-wallet.repository.ts`; depends on T015; validate with `RUN_POSTGRES_INTEGRATION=1 pnpm --filter @kaynann/api test -- test/wallet-postgres.integration-spec.ts -t "credit|debit|insufficient|overflow"`; done when insufficient balance and overflow are distinguished without read-then-write races and all accepted mutations are atomic.
- [X] T017 [US2] Implement database-unique-key race handling with rollback followed by out-of-transaction immutable-fact comparison in `apps/api/src/wallet/infrastructure/postgres/prisma-wallet.repository.ts`; depends on T016; validate with `RUN_POSTGRES_INTEGRATION=1 pnpm --filter @kaynann/api test -- test/wallet-postgres.integration-spec.ts -t "idempotent|conflict"`; done when identical retries return the original result and conflicting retries never alter either user's balance.
- [X] T018 [US2] Implement compensation-origin locking/validation and the linked compensation credit transaction in `apps/api/src/wallet/infrastructure/postgres/prisma-wallet.repository.ts`; depends on T017; validate with `RUN_POSTGRES_INTEGRATION=1 pnpm --filter @kaynann/api test -- test/wallet-transaction.integration-spec.ts -t "compensation"`; done when each compensation references a same-user debit, multiple distinct compensation business keys may reference that debit, each key remains idempotent, and no cumulative cap, source-bucket, or bonus policy is introduced.
- [X] T019 [US2] Implement deterministic projection-versus-ledger reconciliation for diagnostics/tests in `apps/api/src/wallet/infrastructure/postgres/prisma-wallet.repository.ts`; depends on T018; validate with `RUN_POSTGRES_INTEGRATION=1 pnpm --filter @kaynann/api test -- test/wallet-transaction.integration-spec.ts -t "reconciliation"`; done when reconciliation uses exact signed `bigint` totals and detects any seeded projection mismatch.
- [X] T020 [US2] Implement the internal `WalletCommandService` orchestration for credit, debit, and compensation in `apps/api/src/wallet/application/wallet-command.service.ts`; depends on T011 and T019; validate with `pnpm --filter @kaynann/api test -- src/wallet/application/wallet-command.service.spec.ts`; done when callers use typed commands, stable outcomes/errors, and no write command is exposed as an HTTP handler.
- [X] T021 [US2] Register the private repository provider and export only `WalletCommandService` from `apps/api/src/wallet/wallet.module.ts`; depends on T020; validate with `pnpm --filter @kaynann/api typecheck`; done when Prisma remains private to infrastructure, no nonexistent query service is registered, and the module has no dependency on future referral, payment, MQTT, or dispensing modules.
- [X] T022 [US2] Run the complete wallet unit suite for `apps/api/src/wallet/domain/water-amount.spec.ts` and `apps/api/src/wallet/application/wallet-command.service.spec.ts`; depends on T021; validate with `pnpm --filter @kaynann/api test -- src/wallet/domain/water-amount.spec.ts src/wallet/application/wallet-command.service.spec.ts`; done when exact arithmetic and command semantics pass without a database.
- [X] T023 [US2] Run the complete real-PostgreSQL mutation suite in `apps/api/test/wallet-postgres.integration-spec.ts`, `apps/api/test/wallet-concurrency.integration-spec.ts`, and `apps/api/test/wallet-transaction.integration-spec.ts`; depends on T022; validate with `RUN_POSTGRES_INTEGRATION=1 pnpm --filter @kaynann/api test -- test/wallet-postgres.integration-spec.ts test/wallet-concurrency.integration-spec.ts test/wallet-transaction.integration-spec.ts`; done when concurrent debit, same-key credit, rollback, compensation, idempotency, constraints, immutability, and reconciliation all pass on PostgreSQL 17.

**Checkpoint**: US2 is independently usable by future trusted modules through
internal application commands, with no public write endpoint.

---

## Phase 4: User Story 1 - View My Water Balance (Priority: P1)

**Goal**: An authenticated user retrieves only their exact current water
balance; a user without wallet activity receives a predictable zero balance.

**Independent Test**: Call `GET /v1/wallet/balance` with valid, missing,
expired, and replaced sessions before and after an internal credit; observe
zero/exact string quantities, safe auth behavior, and no internal fields.

### Tests First

- [X] T024 [P] [US1] Add unit tests for zero-on-absent-wallet reads, exact projected balance reads, owner scoping, and infrastructure-error propagation in `apps/api/src/wallet/application/wallet-query.service.spec.ts`, and add the real-PostgreSQL absent-wallet read case to `apps/api/test/wallet-postgres.integration-spec.ts`; depends on T023; validate with `pnpm --filter @kaynann/api test -- src/wallet/application/wallet-query.service.spec.ts && RUN_POSTGRES_INTEGRATION=1 pnpm --filter @kaynann/api test -- test/wallet-postgres.integration-spec.ts -t "zero|absent"`; done when application behavior is defined without NestJS and the database-backed test fails only because the owner-scoped read repository method is not yet implemented.
- [X] T025 [P] [US1] Add HTTP contract tests for authenticated `GET /v1/wallet/balance`, `AccessSessionGuard`, missing/invalid/replaced sessions, exact decimal-string response shaping, cache policy, omission of owner IDs/database fields, and a forced storage failure mapped to `WALLET_TEMPORARILY_UNAVAILABLE` without Prisma details, SQLSTATE, constraint names, or stack traces in `apps/api/test/wallet-http.contract-spec.ts`; depends on T023; validate with `pnpm --filter @kaynann/api test -- test/wallet-http.contract-spec.ts -t "balance"`; done when tests fail until the guarded balance route and safe dependency-failure response exist and never accept a caller-supplied user ID.

### Implementation

- [X] T026 [US1] Implement the owner-scoped balance read, including absent-projection-as-zero behavior, in `apps/api/src/wallet/infrastructure/postgres/prisma-wallet.repository.ts`; depends on T012 and T024; validate with `RUN_POSTGRES_INTEGRATION=1 pnpm --filter @kaynann/api test -- test/wallet-postgres.integration-spec.ts -t "zero|balance"`; done when the real-PostgreSQL absent-wallet test passes and reading creates neither a wallet row nor a ledger entry.
- [X] T027 [US1] Implement `WalletQueryService.getBalance()` against the repository port in `apps/api/src/wallet/application/wallet-query.service.ts`; depends on T026; validate with `pnpm --filter @kaynann/api test -- src/wallet/application/wallet-query.service.spec.ts`; done when the application result is exact, owner-scoped, and independent of HTTP/Prisma types.
- [X] T028 [US1] Define explicit balance response DTOs and stable wallet error response shaping in `apps/api/src/wallet/http/dto/wallet-response.dto.ts` and `apps/api/src/wallet/http/wallet-error.filter.ts`; depends on T027; validate with `pnpm --filter @kaynann/api typecheck`; done when public quantities are decimal strings and internal IDs, business keys, stack traces, and database errors cannot enter the response.
- [X] T029 [US1] Register and export `WalletQueryService`, implement the thin guarded balance handler, and wire `WalletModule` into the application in `apps/api/src/wallet/http/wallet.controller.ts`, `apps/api/src/wallet/wallet.module.ts`, and `apps/api/src/app.module.ts`; depends on T025 and T028; validate with `pnpm --filter @kaynann/api test -- test/wallet-http.contract-spec.ts -t "balance" && pnpm --filter @kaynann/api typecheck`; done when `GET /v1/wallet/balance` derives identity solely from `AccessSessionGuard`, delegates all behavior to `WalletQueryService`, and NestJS DI resolves the query service.
- [X] T030 [US1] Extend deterministic aggregate OpenAPI generation for feature 004 while retaining feature-002 contract evidence in `apps/api/src/openapi/generate-openapi.ts`, `apps/api/test/openapi.contract-spec.ts`, and `specs/004-water-wallet-ledger/contracts/openapi.generated.json`; depends on T029; validate with `pnpm --filter @kaynann/api openapi:generate && pnpm --filter @kaynann/api openapi:check`; done when the generated snapshot includes the guarded balance operation, agrees with `specs/004-water-wallet-ledger/contracts/openapi.yaml`, and does not remove feature-002 endpoints.
- [X] T031 [US1] Validate the complete balance story through `apps/api/src/wallet/application/wallet-query.service.spec.ts`, `apps/api/test/wallet-http.contract-spec.ts`, and `specs/004-water-wallet-ledger/contracts/openapi.generated.json`; depends on T030; validate with `pnpm --filter @kaynann/api test -- src/wallet/application/wallet-query.service.spec.ts test/wallet-http.contract-spec.ts && pnpm --filter @kaynann/api openapi:check`; done when zero, credited balance, authorization, response shaping, and documented contract all pass.

**Checkpoint**: US1 is independently demonstrable through the authenticated
balance endpoint without exposing a write API.

---

## Phase 5: User Story 3 - Review Water Balance History (Priority: P2)

**Goal**: An authenticated user retrieves only their immutable operations in a
stable newest-first cursor order.

**Independent Test**: Seed same-timestamp and multi-page operations for two
users, traverse every page using returned cursors, and observe no gaps,
duplicates, foreign entries, or private fields.

### Tests First

- [X] T032 [P] [US3] Add unit tests for opaque `{ v: 1, beforeSequence }` cursor encode/decode, malformed cursor rejection, exclusive `sequence DESC` ordering, default limit 20, maximum limit 100, and `limit + 1` page slicing in `apps/api/src/wallet/infrastructure/postgres/wallet-cursor.spec.ts`; depends on T031; validate with `pnpm --filter @kaynann/api test -- src/wallet/infrastructure/postgres/wallet-cursor.spec.ts`; done when deterministic pagination rules are executable without a database and `occurredAt` is not used as a cursor field.
- [X] T033 [P] [US3] Add real-PostgreSQL history tests for empty history, equal timestamps, at least 250 owner operations traversed across pages, owner isolation with unrelated entries, compensation links, no gaps/duplicates, and stable repeated traversal by `sequence DESC` in `apps/api/test/wallet-history.integration-spec.ts`; depends on T031; validate with `RUN_POSTGRES_INTEGRATION=1 pnpm --filter @kaynann/api test -- test/wallet-history.integration-spec.ts`; done when all 250 owner operations appear exactly once, equal timestamps do not affect sequence ordering, and tests require the real owner/sequence index.
- [X] T034 [P] [US3] Extend HTTP contract tests for authenticated `GET /v1/wallet/operations`, query validation, default/max limits, malformed cursors, next-cursor behavior, safe operation shaping, owner isolation, and stable errors in `apps/api/test/wallet-http.contract-spec.ts`; depends on T031; validate with `pnpm --filter @kaynann/api test -- test/wallet-http.contract-spec.ts -t "operations|history|cursor"`; done when no internal business key, database owner ID, raw sequence, or another user's operation can appear publicly.

### Implementation

- [X] T035 [US3] Implement versioned opaque `{ v: 1, beforeSequence }` cursor encoding/decoding and validated pagination primitives in `apps/api/src/wallet/infrastructure/postgres/wallet-cursor.ts`; depends on T032; validate with `pnpm --filter @kaynann/api test -- src/wallet/infrastructure/postgres/wallet-cursor.spec.ts`; done when cursors preserve only the exclusive sequence boundary without accepting arbitrary SQL/order input.
- [X] T036 [US3] Implement owner-scoped newest-first `limit + 1` history reads using `WHERE userId = owner AND sequence < beforeSequence`, `ORDER BY sequence DESC`, and the planned owner/sequence index in `apps/api/src/wallet/infrastructure/postgres/prisma-wallet.repository.ts`; depends on T033 and T035; validate with `RUN_POSTGRES_INTEGRATION=1 pnpm --filter @kaynann/api test -- test/wallet-history.integration-spec.ts`; done when traversal is deterministic across equal timestamps, returns all 250 test operations exactly once, and never crosses owners.
- [X] T037 [US3] Extend `WalletQueryService` with validated history pagination and domain-to-public result mapping in `apps/api/src/wallet/application/wallet-query.service.ts` and `apps/api/src/wallet/application/wallet-query.service.spec.ts`; depends on T036; validate with `pnpm --filter @kaynann/api test -- src/wallet/application/wallet-query.service.spec.ts`; done when the service returns items plus an optional next cursor with no HTTP or Prisma leakage.
- [X] T038 [US3] Add history query/response DTOs and the thin guarded operations handler in `apps/api/src/wallet/http/dto/wallet-history-query.dto.ts`, `apps/api/src/wallet/http/dto/wallet-response.dto.ts`, and `apps/api/src/wallet/http/wallet.controller.ts`; depends on T034 and T037; validate with `pnpm --filter @kaynann/api test -- test/wallet-http.contract-spec.ts -t "operations|history|cursor"`; done when limit/cursor validation is explicit and response entries contain only documented public fields.
- [X] T039 [US3] Update `specs/004-water-wallet-ledger/contracts/openapi.generated.json` and `apps/api/test/openapi.contract-spec.ts` for the operations endpoint and add a negative assertion that no wallet credit/debit/compensation/write route is public; depends on T038; validate with `pnpm --filter @kaynann/api openapi:generate && pnpm --filter @kaynann/api openapi:check`; done when both read routes match `specs/004-water-wallet-ledger/contracts/openapi.yaml` and the public surface remains read-only.
- [X] T040 [US3] Validate the complete history story through `apps/api/src/wallet/infrastructure/postgres/wallet-cursor.spec.ts`, `apps/api/test/wallet-history.integration-spec.ts`, `apps/api/test/wallet-http.contract-spec.ts`, and `apps/api/test/openapi.contract-spec.ts`; depends on T039; validate with `pnpm --filter @kaynann/api test -- src/wallet/infrastructure/postgres/wallet-cursor.spec.ts test/wallet-http.contract-spec.ts test/openapi.contract-spec.ts && RUN_POSTGRES_INTEGRATION=1 pnpm --filter @kaynann/api test -- test/wallet-history.integration-spec.ts`; done when deterministic pagination, isolation, safe shaping, and read-only OpenAPI all pass.

**Checkpoint**: US3 is independently demonstrable with empty and multi-page
histories and cannot disclose another user's data.

---

## Phase 6: User Story 4 - Mobile API, Store, And Session-Aware RxJS Flow (Priority: P2)

**Goal**: Mobile wallet state loads through cold Observables, follows the
current session, supports refresh/pagination/retry, and rejects stale results.

**Independent Test**: With controlled delayed API Observables, restore, replace,
and clear sessions while requests are in flight; observe correct loading/data/
error transitions, cancellation, disposal, and no stale state publication.

### Tests First

- [X] T041 [P] [US4] Add API adapter tests proving each balance/history call is cold, performs no fetch before subscription, sends the access credential through the existing authenticated client boundary, maps exact string quantities, validates response shape, and aborts on unsubscribe in `apps/mobile/src/api/wallet-api.spec.ts`; depends on T040; validate with `pnpm --filter @kaynann/mobile test -- src/api/wallet-api.spec.ts`; done when tests fail until a cold cancellable adapter exists and never coerce millilitres to JavaScript `number`.
- [X] T042 [P] [US4] Add MobX store tests for initial/loading/empty/loaded/retryable-error states, exact balance/history data, refresh-with-existing-data, append pagination, deduplication, action-only mutation, stale request tokens, and clear/reset in `apps/mobile/src/wallet/stores/wallet.store.spec.ts`; depends on T040; validate with `pnpm --filter @kaynann/mobile test -- src/wallet/stores/wallet.store.spec.ts`; done when all observable mutations are specified under the existing `enforceActions: "always"` policy.
- [X] T043 [P] [US4] Add deterministic RxJS flow tests for login, session restoration, logout, session replacement, cancellation of balance/history requests, stale completion/error suppression, retry, refresh, next-page serialization, and disposal in `apps/mobile/src/wallet/services/wallet-flow.service.spec.ts`; depends on T040; validate with `pnpm --filter @kaynann/mobile test -- src/wallet/services/wallet-flow.service.spec.ts`; done when a superseded session can never publish data and unmount/disposal terminates all work.

### Implementation

- [X] T044 [US4] Define public wallet response models and implement cold cancellable balance/history Observables using the existing authenticated API conventions in `apps/mobile/src/api/wallet-api.ts`; depends on T041; validate with `pnpm --filter @kaynann/mobile test -- src/api/wallet-api.spec.ts`; done when every subscription creates its own request, unsubscription aborts it, and quantities remain exact decimal strings.
- [X] T045 [US4] Implement the MobX `WalletStore`, computed presentation state, request-generation tokens, refresh/pagination bookkeeping, deduplication, and explicit action-only reset/update methods in `apps/mobile/src/wallet/stores/wallet.store.ts`; depends on T042; validate with `pnpm --filter @kaynann/mobile test -- src/wallet/stores/wallet.store.spec.ts`; done when loading, empty, loaded, retryable error, refresh, pagination, and clear states are deterministic.
- [X] T046 [US4] Implement disposable `WalletFlowService` orchestration with cold API composition, session epoch checks, cancellation, serialized next-page loading, retry/refresh commands, and no automatic unsafe write retry in `apps/mobile/src/wallet/services/wallet-flow.service.ts`; depends on T043, T044, and T045; validate with `pnpm --filter @kaynann/mobile test -- src/wallet/services/wallet-flow.service.spec.ts`; done when logout/session replacement clears immediately and no late result or error can mutate the new session's store.
- [X] T047 [US4] Create a session-scoped `WalletCompositionRoot` and connect creation/disposal to the existing auth composition lifecycle without changing session contracts in `apps/mobile/src/wallet/wallet-composition-root.ts` and `apps/mobile/src/App.tsx`; depends on T046; validate with `pnpm --filter @kaynann/mobile typecheck && pnpm --filter @kaynann/mobile test -- src/wallet/services/wallet-flow.service.spec.ts`; done when login/restoration starts one wallet flow, logout/replacement disposes the old flow, and OTP/auth behavior remains untouched.
- [X] T048 [US4] Validate the headless mobile wallet layer in `apps/mobile/src/api/wallet-api.spec.ts`, `apps/mobile/src/wallet/stores/wallet.store.spec.ts`, and `apps/mobile/src/wallet/services/wallet-flow.service.spec.ts`; depends on T047; validate with `pnpm --filter @kaynann/mobile test -- src/api/wallet-api.spec.ts src/wallet/stores/wallet.store.spec.ts src/wallet/services/wallet-flow.service.spec.ts`; done when API coldness, MobX state, RxJS cancellation, stale protection, retry, refresh, pagination, and disposal all pass without UI assumptions.

**Checkpoint**: US4's data layer is independently testable and correctly tracks
session restoration, replacement, and logout.

---

## Phase 7: User Story 4 - Minimal Wallet Presentation (Priority: P2)

**Goal**: Replace only the authenticated placeholder with a minimal accessible
wallet view while preserving all existing authentication navigation.

**Independent Test**: Render the authenticated route with controlled store
states and observe exact litre/balance display plus loading, empty, loaded,
retryable error, refresh, and next-page behavior; logout still returns to auth.

### Tests First

- [X] T049 [US4] Add React Native Testing Library tests for balance loading/error/retry/loaded display, exact derived litre formatting without balance arithmetic, empty/history states, refresh, pagination, accessibility labels/roles, unmount disposal, and preserved logout behavior in `apps/mobile/__tests__/wallet-flow.test.tsx`; depends on T048; validate with `pnpm --filter @kaynann/mobile test -- __tests__/wallet-flow.test.tsx`; done when tests cover every required visible state and fail until the minimal screen is connected.

### Implementation

- [X] T050 [US4] Implement the minimal observer-based wallet screen with balance, operation history, loading/empty/loaded/retryable-error, pull-to-refresh, next-page, and accessible controls in `apps/mobile/src/wallet/screens/WalletScreen.tsx`; depends on T049; validate with `pnpm --filter @kaynann/mobile test -- __tests__/wallet-flow.test.tsx`; done when display may derive litres for humans but all stored/API arithmetic remains integer millilitres and no unrelated dashboard feature is added.
- [X] T051 [US4] Replace only the authenticated main placeholder with `WalletScreen` while retaining existing auth/session routing and logout behavior in `apps/mobile/src/navigation/RootNavigator.tsx` and `apps/mobile/src/App.tsx`; depends on T050; validate with `pnpm --filter @kaynann/mobile test -- __tests__/wallet-flow.test.tsx __tests__/phone-auth-flow.test.tsx`; done when session restoration reaches the wallet, logout returns to auth, and OTP/legal/navigation contracts are unchanged.
- [X] T052 [US4] Validate the complete mobile story in `apps/mobile/__tests__/wallet-flow.test.tsx`, `apps/mobile/src/api/wallet-api.spec.ts`, `apps/mobile/src/wallet/stores/wallet.store.spec.ts`, and `apps/mobile/src/wallet/services/wallet-flow.service.spec.ts`; depends on T051; validate with `pnpm --filter @kaynann/mobile test -- __tests__/wallet-flow.test.tsx src/api/wallet-api.spec.ts src/wallet/stores/wallet.store.spec.ts src/wallet/services/wallet-flow.service.spec.ts && pnpm --filter @kaynann/mobile typecheck`; done when every mobile wallet state and session race passes without changing product behavior outside wallet presentation.

**Checkpoint**: The authenticated app has a minimal usable wallet view, and US4
passes as a full vertical slice.

---

## Phase 8: Regression And Acceptance Validation

**Purpose**: Prove feature-004 invariants end to end, preserve feature 002, and
enforce the repository's lint/format/type/build gates.

- [X] T053 Run the complete feature-002 API and mobile regression suites covering OTP, registration, legal acceptance, SMS, session creation/restoration/refresh/logout, and auth navigation in `apps/api/src/auth/`, `apps/api/src/otp/`, `apps/api/test/`, `apps/mobile/src/auth/`, `apps/mobile/__tests__/phone-auth-flow.test.tsx`, and `apps/mobile/__tests__/App.test.tsx`; depends on T052; validate with `pnpm test`; done when all pre-wallet automated tests pass unchanged and no feature-002 contract or product behavior regresses.
- [X] T054 Run the complete real-PostgreSQL wallet acceptance suite for migration upgrade, constraints, trigger immutability, 100 sequential same-event retries, 100 concurrent same-key credits, at least 100 concurrent debits, all specified rollback/no-append boundaries, multiple distinct compensations of one debit, reconciliation, isolation, and traversal of at least 250 operations in `apps/api/test/wallet-migration.integration-spec.ts`, `apps/api/test/wallet-postgres.integration-spec.ts`, `apps/api/test/wallet-concurrency.integration-spec.ts`, `apps/api/test/wallet-transaction.integration-spec.ts`, and `apps/api/test/wallet-history.integration-spec.ts`; depends on T053; validate with `RUN_POSTGRES_INTEGRATION=1 pnpm --filter @kaynann/api test -- test/wallet-migration.integration-spec.ts test/wallet-postgres.integration-spec.ts test/wallet-concurrency.integration-spec.ts test/wallet-transaction.integration-spec.ts test/wallet-history.integration-spec.ts`; done when every quantitative database-backed acceptance threshold passes on PostgreSQL 17 and none is substituted with mocks or SQLite.
- [X] T055 Add and run a cross-cutting US1/US3 local real-PostgreSQL read-performance acceptance test in `apps/api/test/wallet-read-performance.acceptance-spec.ts`; depends on T054; validate with `RUN_POSTGRES_INTEGRATION=1 pnpm --filter @kaynann/api test -- test/wallet-read-performance.acceptance-spec.ts`; done when the fixture contains 250 owner entries plus 50 unrelated-user entries, each endpoint receives 5 warm-ups and 20 measured requests without added synthetic concurrency, and at least 19 balance requests and 19 first-page history requests complete within 2 seconds, with results reported as a local regression threshold rather than a production capacity claim.
- [X] T056 Validate source/generated contract consistency and the absence of public wallet write endpoints in `specs/004-water-wallet-ledger/contracts/openapi.yaml`, `specs/004-water-wallet-ledger/contracts/openapi.generated.json`, `apps/api/src/openapi/generate-openapi.ts`, and `apps/api/test/openapi.contract-spec.ts`; depends on T055; validate with `pnpm --filter @kaynann/api openapi:check && pnpm --filter @kaynann/api test -- test/openapi.contract-spec.ts`; done when both wallet reads are documented, all feature-002 paths remain present, and no credit/debit/compensation/admin route exists.
- [X] T057 Apply only safe formatter/linter fixes and validate static-analysis boundaries across `apps/api/src/wallet/`, `apps/api/test/`, `apps/api/prisma/`, `apps/mobile/src/wallet/`, `apps/mobile/src/api/wallet-api.ts`, and `apps/mobile/__tests__/wallet-flow.test.tsx`; depends on T056; validate with `pnpm lint && pnpm lint:rules:test && pnpm format:check`; done when ESLint and Prettier pass without global rule suppression, generated-code linting, or behavior-changing auto-fixes.
- [X] T058 Run workspace typechecks and all unit/contract tests for `apps/api/` and `apps/mobile/`; depends on T057; validate with `pnpm typecheck && pnpm test`; done when exact bigint contracts, NestJS DI, MobX/RxJS lifecycle, HTTP contracts, and all existing tests pass.
- [X] T059 Build both applications using `apps/api/tsconfig.build.json`, `apps/mobile/tsconfig.json`, and the existing workspace scripts in `package.json`; depends on T058; validate with `pnpm build:api && pnpm build:mobile:js`; done when production API compilation and Expo JS export succeed without adding wallet-only build exceptions.
- [X] T060 Execute and document the final acceptance commands, PostgreSQL opt-in requirement, migration procedure, local read-performance profile, and known deferred product decisions in `specs/004-water-wallet-ledger/quickstart.md`; depends on T059; validate with `pnpm check:repo && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build:api && pnpm build:mobile:js`; done when the quickstart is reproducible, the separate PostgreSQL performance command is documented, the diff contains only wallet/ledger work, and referral, bonuses, payments, source buckets, bonus-first spending, QR, MQTT, machines, and dispensing remain unimplemented.

**Final Checkpoint**: All four user stories pass their independent criteria,
feature-002 behavior is unchanged, PostgreSQL proves the critical invariants,
and the repository passes lint, format, typecheck, tests, and builds.

---

## Dependencies And Execution Order

### Phase Dependencies

- Phase 1 has no dependencies.
- Phase 2 depends on Phase 1 and blocks all feature behavior.
- Phase 3 (US2) depends on Phase 2 because database invariants precede writes.
- Phase 4 (US1) depends on Phase 3 for a proven projection and credited-balance fixture.
- Phase 5 (US3) depends on Phase 4 and reuses the authenticated query boundary.
- Phase 6 (US4 data layer) depends on both public read contracts from Phases 4-5.
- Phase 7 (US4 presentation) depends on the tested mobile data layer.
- Phase 8 depends on all story phases.

### User Story Dependencies

- **US2 (P1)**: First independently deliverable story after foundation; it has no dependency on another story.
- **US1 (P1)**: Depends on US2's projection/repository but not on US3 or mobile work.
- **US3 (P2)**: Depends on the shared authenticated query boundary from US1 and immutable entries from US2.
- **US4 (P2)**: Depends on the US1/US3 read contracts; its headless layer and presentation are separately checkpointed.

### Parallel Opportunities

- T002 and T003 can proceed in parallel after T001.
- T011-T014 can proceed in parallel after Phase 2 because they create separate test files.
- T024 and T025 can proceed in parallel after US2.
- T032-T034 can proceed in parallel after US1.
- T041-T043 can proceed in parallel after both API stories.
- Within an implementation task, do not parallelize edits to `prisma-wallet.repository.ts`, `wallet-query.service.ts`, `wallet.controller.ts`, `App.tsx`, or generated OpenAPI snapshots.

---

## Implementation Strategy

### Smallest Safe Delivery

1. Complete Phases 1-2 to establish database and exact-type invariants.
2. Complete Phase 3 to deliver the internal wallet/ledger foundation (US2).
3. Complete Phase 4 to expose the smallest end-user value: authenticated balance (US1).
4. Stop here only if an incremental review is required; do not treat the feature as accepted until Phases 5-8 pass.

### Existing-Code Remediation

- **Safe automatic fixes**: import ordering, unused imports, and Prettier-only whitespace in wallet-touched files.
- **Mechanical manual fixes**: explicit `bigint`/string conversions, DTO annotations, test fixture typing, and NestJS provider wiring with unchanged behavior.
- **Potentially behavior-changing fixes**: any OTP/session/legal contract change, user lifecycle rewrite, business bonus policy, source allocation, automatic compensation policy, or navigation redesign. Do not implement these; record them as blockers or deferred decisions.

### Deferred Decisions, Not Tasks

- Bonus sizes, referral rules, expiry, source buckets, and bonus-first spending remain deferred.
- Payment, QR, MQTT, machine, and dispensing integration remain deferred.
- Administrative balance mutation remains excluded.
- Automatic compensation policy remains deferred; this feature only provides a validated internal compensation command.
- No current artifact conflict requires a blocking product decision. If implementation reveals one, stop that task and add an explicit blocker rather than choosing behavior silently.

# Implementation Plan: Water Wallet And Immutable Ledger

**Branch**: `water-wallet-ledger-feature` | **Date**: 2026-08-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/004-water-wallet-ledger/spec.md`

## Summary

Add a dedicated NestJS wallet module and a minimal Expo wallet experience. The
API stores exact whole millilitres in PostgreSQL `bigint`, appends an immutable
ledger entry for every accepted change, and keeps a transactional balance
projection for constant-time reads. Trusted application commands use a short
Prisma interactive transaction, a conditional atomic SQL update, database
checks, and a globally unique namespaced business-event key. No public balance
mutation endpoint is introduced.

The mobile application follows the existing MobX/RxJS architecture: a cold
Observable API adapter, a MobX-owned wallet store, and a disposable flow service
that cancels and epochs requests when the authenticated session changes. The
current placeholder main content is replaced only with the minimum balance and
history states; OTP, registration, legal, and session contracts remain intact.

## Technical Context

**Language/Version**: Node.js `>=24 <25`; TypeScript declared `^5.8.3`, resolved `5.9.3`

**Primary Dependencies**: NestJS `11.1.28`; Prisma/Prisma Client `6.19.3`;
Expo SDK `54.0.36`; React Native `0.81.5`; React `19.1.0`; MobX `6.16.1`;
RxJS `7.8.2`; no new dependency planned

**Storage**: PostgreSQL 17; wallet values use signed PostgreSQL `bigint` and
TypeScript `bigint`; no Redis or mobile persistence for wallet data

**Testing**: Vitest `3.2.7`, Supertest, real PostgreSQL integration and
concurrency tests, React Native Testing Library `14.0.1`

**Target Platform**: Existing Linux-hosted NestJS API and Expo iOS/Android app

**Project Type**: Existing pnpm `11.18.0` mobile + API monorepo under `apps/*`

**Performance Goals**: balance read uses one indexed owner lookup; history uses
an indexed bounded cursor query; one wallet mutation holds a lock only on the
affected wallet row for the duration of one short transaction; no full-ledger
sum occurs on the public read path; after 5 warm-ups, at least 95% of 20 local
requests per read endpoint complete within 2 seconds against 250 owner entries
plus 50 unrelated-user entries on the documented PostgreSQL 17 environment

**Constraints**: exact whole millilitres only; non-negative balance; no public
write endpoint; database-enforced idempotency and immutability; Prisma confined
to infrastructure; existing session guard remains authoritative; no product
behavior from referral/payment/dispensing features

**Scale/Scope**: one logical wallet per registered user, one append-only ledger,
two authenticated GET endpoints, three trusted internal command forms, and one
minimal mobile balance/history surface

## Constitution Check

_GATE: passed before research and passed again after Phase 1 design._

| Principle                      | Design evidence                                                                                                                                                | Result |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| One logical diff               | Planning changes only feature artifacts and the managed Spec Kit pointer; implementation is split into migration, backend, API, mobile, and validation phases. | PASS   |
| Boundary validation            | HTTP query DTOs and internal command value objects validate limits, cursor syntax, keys, kinds, sources, timestamps, and positive `bigint` amounts.            | PASS   |
| Explicit outputs               | Dedicated response DTOs omit owner IDs, business keys, database sequence values, compensation internals, and Prisma objects.                                   | PASS   |
| Schema safety                  | Prisma schema is accompanied by a reviewed migration containing the checks, indexes, and immutability trigger Prisma cannot express.                           | PASS   |
| Security-sensitive work        | Existing `AccessSessionGuard` supplies the owner identity; routes never accept a user ID and session contracts are unchanged.                                  | PASS   |
| Minimal validation             | Each phase names a focused command before broader lint, typecheck, tests, and builds.                                                                          | PASS   |
| Durable style memory           | Style memory was read and is not modified.                                                                                                                     | PASS   |
| Context discipline             | Research was limited to current manifests/configs, wallet inputs, feature 002/003 artifacts, and relevant auth/session/mobile code.                            | PASS   |
| Frontend reactive architecture | MobX owns wallet state; RxJS owns cancellation, request concurrency, refresh, and disposal; components remain presentation-oriented.                           | PASS   |

No constitution violation requires a complexity exception.

## Conflicts And Assumptions

1. `docs/mvp-requirements.md` anticipates separate purchased and bonus litre
   buckets and bonus-first consumption. Feature 004 explicitly limits the
   foundation to one aggregate balance. The ledger records extensible source and
   operation-kind strings, but bucket allocation, expiry, and spend order are
   deferred and cannot be inferred from those strings.
2. The current Prisma schema has no wallet relation and registration must not be
   changed. A wallet therefore has a logical zero before a physical row exists;
   reads return zero without writing, and the first accepted internal command
   creates the row inside its transaction.
3. PostgreSQL `bigint` exceeds JavaScript's safe integer range and JSON cannot
   serialize TypeScript `bigint`. Public millilitre values are non-negative
   base-10 strings. A derived litre string may be included for display but is
   never accepted back or used in calculations.
4. The existing main mobile route is a placeholder rather than a complete home
   screen. This feature replaces only that placeholder content with the minimal
   wallet surface and retains logout and all auth routing behavior.
5. Compensation eligibility beyond a same-owner committed debit is future
   product policy. This feature permits multiple linked compensation entries,
   each idempotent by its own business key, and does not invent caps, expiry, or
   under-dispensing calculations.

These are explicit scope resolutions; no unresolved planning clarification
blocks implementation.

## Architecture

### Backend boundaries

```text
WalletController
  -> WalletQueryService
       -> WalletRepository port
            <- PrismaWalletRepository -> PrismaService -> PostgreSQL

Future trusted feature module
  -> WalletCommandService (exported application API)
       -> wallet domain values and invariants
       -> WalletRepository port
            <- PrismaWalletRepository -> one database transaction
```

- `wallet/domain` is framework-free and contains exact amount, direction,
  operation facts, cursor facts, and domain errors.
- `wallet/application` contains command/query services and repository ports. It
  imports neither Prisma nor future referral, payment, machine, or MQTT modules.
- `wallet/infrastructure/postgres` is the only wallet code allowed to import
  Prisma. It owns transaction SQL, error classification, persistence mapping,
  and cursor query details.
- `wallet/http` owns guarded GET routes, query validation, stable error mapping,
  Swagger metadata, and explicit response shaping. There are no HTTP command
  routes.
- `WalletModule` imports `SessionsModule`, provides the repository port, exports
  only `WalletCommandService`, and is imported by `AppModule`.

### Mobile boundaries

```text
WalletScreen -> WalletStore observable state
WalletScreen -> WalletFlowService commands
WalletFlowService -> SessionFlowService.withAccess(...)
WalletFlowService -> WalletApi cold Observables
WalletFlowService -> WalletStore actions
App composition -> owns/disposes auth and wallet scopes
```

`WalletCompositionRoot` receives the existing authenticated request capability,
owns the store and flow, and observes only a narrow session snapshot adapter.
It clears and invalidates wallet work synchronously whenever the session leaves
`authenticated` or its access credential changes. This avoids coupling wallet
code to storage or refresh-token details and does not represent wallet state in
React `useState`.

## Core Design

### Persistence model

- `WaterWallet` uses `userId` as its primary key and owner foreign key, with
  `balanceMl bigint`, `createdAt`, and `updatedAt`.
- `WalletLedgerEntry` stores a UUID public ID, monotonic `bigint` sequence,
  owner, global namespaced business key, `CREDIT|DEBIT`, positive amount,
  extensible operation kind/source, resulting balance, effective/recorded time,
  and optional self-referencing compensation origin.
- PostgreSQL checks enforce non-negative balances, positive amounts, signed
  `bigint` range, non-empty bounded classifier/key formats, and valid
  compensation direction. Foreign keys use `RESTRICT`.
- A migration-defined `BEFORE UPDATE OR DELETE` trigger rejects ledger mutation.
  Prisma expresses models, relations, ordinary unique constraints, and indexes;
  raw migration SQL expresses checks and the trigger.
- The balance projection is retained for bounded reads and conditional debits.
  Ledger entries are audit truth; every supported application projection change
  and append is performed together through the sole wallet repository writer.
  Database-backed reconciliation tests compare projection with signed ledger
  totals, and operational reconciliation detects unsupported privileged SQL
  changes rather than treating them as a valid mutation path.

The supported amount and balance range is `1..9_223_372_036_854_775_807` mL for
an operation and `0..9_223_372_036_854_775_807` mL for a balance. Credits use a
pre-subtraction capacity predicate so the SQL expression cannot overflow.

### Transaction and concurrency strategy

Use Prisma interactive transactions at PostgreSQL's default `READ COMMITTED`:

1. Validate and normalize immutable command facts before opening a transaction.
2. Lock and verify the owner row as `ACTIVE` for the short transaction, then
   create the wallet lazily with parameterized
   `INSERT ... ON CONFLICT DO NOTHING`. An absent or ineligible owner changes
   neither wallet nor ledger.
3. Look up the business key. Identical persisted facts return the prior result;
   different facts return `WALLET_EVENT_CONFLICT`.
4. For compensation, load and validate the same-owner committed debit origin.
5. Execute one tagged, parameterized conditional SQL update with `RETURNING`:
   debit requires `balanceMl >= amount`; credit requires
   `balanceMl <= BIGINT_MAX - amount`. The statement also updates `updatedAt`.
6. If no row returns, classify insufficient balance or capacity failure without
   appending a ledger entry.
7. Append the ledger row with the returned balance and commit.
8. If a concurrent insert wins the unique business-key race, the losing
   transaction rolls back in full. Outside that failed transaction, reload the
   winner and compare every immutable fact: identical means idempotent success;
   any difference means stable conflict.

PostgreSQL serializes concurrent updates of the same wallet row and re-evaluates
the conditional predicate after a waiter acquires the row. This prevents lost
updates and overdraft without a prior read. Explicit `SELECT FOR UPDATE` adds a
round trip and longer lock duration but no benefit for the ordinary single-row
mutation; it remains appropriate only if a future rule must serialize aggregate
facts such as a compensation cap. `SERIALIZABLE` adds mandatory `40001` retry
handling and predicate-lock overhead without strengthening the selected unique
key plus conditional-row-update invariants, so it is not the default.

Sequences may contain gaps after rollbacks; they are ordering cursors, never
balance evidence. Transaction failure, unique conflict, or ledger insertion
failure rolls back both the projection update and append.

### Idempotency contract

- `businessEventKey` is a private global unique string up to 200 characters in
  `<namespace>:<stable-id>` form, for example `dispensing:<uuid>`.
- Global scope deliberately prevents the same upstream event from being applied
  to two users; such reuse is a conflict, not a second valid operation.
- Retry equivalence compares owner, direction, amount, operation kind, source,
  effective time, and compensation origin. The database unique constraint is
  the race arbiter; in-memory pre-checking is only an optimization.

### Internal command contracts

`WalletCommandService` exposes trusted TypeScript application methods, not
controllers:

```ts
credit(input: WalletCreditCommand): Promise<WalletCommandResult>
debit(input: WalletDebitCommand): Promise<WalletCommandResult>
compensate(input: WalletCompensationCommand): Promise<WalletCommandResult>
```

All inputs carry `userId`, `businessEventKey`, positive `amountMl: bigint`,
`operationKind`, `source`, and `occurredAt`; compensation additionally carries
`compensatesEntryId`. Results contain the stable entry ID, exact resulting
balance as `bigint`, and whether the result was an idempotent replay. Typed
application errors distinguish invalid amount/facts, ineligible or unknown
user, insufficient balance, event conflict, invalid compensation origin,
capacity exhaustion, and temporary storage failure.

### Public HTTP contracts

- `GET /v1/wallet/balance`: guarded by `AccessSessionGuard`; returns
  `{ balanceMl, balanceLiters, observedAt }` where both quantities are strings.
- `GET /v1/wallet/operations?limit=20&cursor=...`: guarded identically; limit is
  `1..100`; returns explicit public entries, `nextCursor`, and `hasMore`.
- Owner identity always comes from `request.sessionClaims.sub`; neither route
  accepts a user ID.
- History orders by internal `sequence DESC`, requests `limit + 1`, and uses an
  opaque versioned base64url cursor containing the exclusive sequence boundary.
  The database query always filters owner plus `sequence < boundary`.
- Public items omit owner, sequence, business key, resulting projection,
  compensation internals, raw provider data, and Prisma fields.
- Existing auth errors remain authoritative. Wallet adds stable
  `WALLET_CURSOR_INVALID` and `WALLET_TEMPORARILY_UNAVAILABLE` public read errors;
  command errors remain internal until a future trusted caller maps them.

The exact schemas are in [contracts/openapi.yaml](./contracts/openapi.yaml) and
[contracts/internal-wallet-commands.md](./contracts/internal-wallet-commands.md).

### Mobile state and lifecycle

- `WalletApi` returns cold Observables for balance and history. `FetchWalletApi`
  creates its `AbortController` inside `defer`, parses unknown JSON into exact
  public models, and never converts canonical values to JavaScript `number`.
- `WalletStore` owns balance, entries, next cursor, initial/refresh/page loading,
  empty/loaded state, and retryable error state through MobX actions/computed
  values.
- `WalletFlowService` owns refresh, retry, and pagination subjects/subscriptions.
  Session changes advance an epoch, cancel current streams with `switchMap`, and
  clear the store before a new authenticated load can publish.
- Initial load and refresh fetch balance and first history page together;
  refresh discards the old cursor. Pagination serializes duplicate taps and
  merges only unseen stable IDs from the same epoch.
- Authentication uses the existing `SessionFlowService.withAccess`, preserving
  refresh behavior. Anonymous, stale-legal, offline-session, logout, and dispose
  transitions cancel requests and clear all wallet data.
- The minimal screen covers initial loading, zero balance, non-zero balance,
  empty history, retry, pull/explicit refresh, page loading, and logout. It does
  not add navigation, referral, payment, QR, map, or dispensing UI.

## Project Structure

### Documentation (this feature)

```text
specs/004-water-wallet-ledger/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── internal-wallet-commands.md
│   └── openapi.yaml
└── tasks.md                         # created later by /speckit-tasks
```

### Planned source changes

```text
apps/api/
├── prisma/
│   ├── schema.prisma
│   └── migrations/<timestamp>_water_wallet_ledger/migration.sql
├── src/
│   ├── app.module.ts
│   ├── openapi/generate-openapi.ts
│   └── wallet/
│       ├── domain/
│       │   ├── wallet-errors.ts
│       │   ├── wallet-operation.ts
│       │   ├── water-amount.ts
│       │   └── water-amount.spec.ts
│       ├── application/
│       │   ├── ports/wallet.repository.ts
│       │   ├── wallet-command.ts
│       │   ├── wallet-command.service.ts
│       │   ├── wallet-command.service.spec.ts
│       │   ├── wallet-query.service.ts
│       │   └── wallet-query.service.spec.ts
│       ├── infrastructure/postgres/
│       │   ├── prisma-wallet.repository.ts
│       │   ├── wallet-cursor.ts
│       │   └── wallet-cursor.spec.ts
│       ├── http/
│       │   ├── dto/wallet-history-query.dto.ts
│       │   ├── dto/wallet-response.dto.ts
│       │   ├── wallet-error.filter.ts
│       │   └── wallet.controller.ts
│       └── wallet.module.ts
└── test/
    ├── wallet-http.contract-spec.ts
    ├── wallet-migration.integration-spec.ts
    ├── wallet-postgres.integration-spec.ts
    ├── wallet-concurrency.integration-spec.ts
    ├── wallet-transaction.integration-spec.ts
    ├── wallet-history.integration-spec.ts
    └── wallet-read-performance.acceptance-spec.ts

apps/mobile/
├── src/
│   ├── App.tsx
│   ├── api/
│   │   ├── wallet-api.ts
│   │   └── wallet-api.spec.ts
│   ├── navigation/RootNavigator.tsx
│   └── wallet/
│       ├── screens/WalletScreen.tsx
│       ├── services/
│       │   ├── wallet-flow.service.ts
│       │   └── wallet-flow.service.spec.ts
│       ├── stores/
│       │   ├── wallet.store.ts
│       │   └── wallet.store.spec.ts
│       └── wallet-composition-root.ts
└── __tests__/
    └── wallet-flow.test.tsx

specs/004-water-wallet-ledger/contracts/
└── openapi.generated.json
```

Existing test files for feature 002 may receive only assertions needed to prove
unchanged auth/session behavior. The OpenAPI snapshot generator is extended to
emit/check the feature-004 aggregate contract without deleting feature-002
evidence.

**Structure Decision**: retain the established `apps/api` and `apps/mobile`
feature-local layouts. No shared workspace package or new dependency is needed;
the API and mobile communicate only through explicit HTTP DTOs.

## Implementation Phases

### Phase 1 - Domain contracts and migration design

- Add domain values/errors, repository port, proposed Prisma relations, and one
  reviewed migration with checks, indexes, foreign keys, and ledger guard.
- Add migration-level tests for constraints and trigger behavior before command
  service implementation.
- Completion: Prisma formatting/generation succeeds, migration applies to a
  clean PostgreSQL database, and direct invalid/UPDATE/DELETE probes fail.

### Phase 2 - Transactional repository and internal commands

- Implement lazy wallet creation, conditional credit/debit updates, append,
  replay classification, compensation-origin validation, and reconciliation.
- Add unit tests for validation/error mapping and real-PostgreSQL tests for
  exact operations, insufficient balance, rollback, overflow, idempotent and
  conflicting retries, concurrent debits, concurrent same-key credits,
  compensation, and cross-user ownership.
- Completion: after every committed supported application command, projection
  equals the signed committed ledger sum, and all concurrency tests pass
  repeatedly against PostgreSQL 17.

### Phase 3 - Authenticated read API

- Add query service, cursor codec, DTOs, guarded controller, response shaping,
  Swagger contract, and `AppModule` wiring.
- Add contract/integration tests for zero balance without a row, isolation,
  bounded deterministic pagination, invalid cursors/limits, stable errors, and
  absence of private fields.
- Completion: both GET contracts match OpenAPI and no mutation route exists.

### Phase 4 - Mobile API, store, and flow

- Add exact-string response parsing, cold Observable adapter, MobX store,
  disposable RxJS flow, session epoch/cancellation, refresh, and pagination.
- Test initial/zero/loaded/error/empty/page states, stale request suppression,
  retry, logout, session replacement, restoration, and disposal.
- Completion: wallet state cannot survive or publish across a session boundary.

### Phase 5 - Minimal wallet presentation

- Replace only the authenticated placeholder with `WalletScreen`, preserving
  logout and existing auth/legal navigation.
- Render exact litre text from server/canonical string data and the minimum
  accessible history/loading/empty/error controls.
- Completion: iOS/Android-compatible component tests and mobile JS build pass;
  no unrelated main-screen product features appear.

### Phase 6 - Regression, contract, and acceptance validation

- Run migration validation, real database suites, API/mobile tests, OpenAPI
  check, lint, typecheck, and both builds.
- Re-run feature-002 auth/session regression suites and verify the migration
  does not alter existing rows or contracts.
- Completion: all feature acceptance scenarios have automated evidence or an
  explicitly documented environment-only verification command.

## Validation Strategy

Run the smallest check after each logical diff, then the full gate:

```bash
pnpm --filter @kaynann/api db:generate
pnpm --filter @kaynann/api typecheck
RUN_POSTGRES_INTEGRATION=1 pnpm --filter @kaynann/api test -- wallet
pnpm --filter mobile test -- wallet
pnpm --filter mobile typecheck
pnpm --filter @kaynann/api openapi:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build:api
pnpm build:mobile:js
```

Database-backed tests require PostgreSQL 17 from `pnpm services:up`, an explicit
test `DATABASE_URL`, and applied migrations. In-memory mocks may test application
branching but cannot satisfy concurrency, rollback, uniqueness, check-constraint,
foreign-key, or trigger acceptance criteria.

The PostgreSQL suite must coordinate separate Prisma connections with barriers,
not merely issue sequential `Promise.all` work through one transaction. Repeat
the same-key event 100 times sequentially and concurrently, and run at least 100
concurrent debit attempts whose total demand exceeds the balance. A forced
ledger insert failure after the conditional update proves rollback; validation
failure, conditional no-match, and a losing unique-key race must also append no
rejected operation. Direct SQL
attempts prove immutable ledger behavior. Exact tests include values above
`Number.MAX_SAFE_INTEGER` as strings/`bigint` and reject decimal/floating input.

The local read-performance acceptance test uses one authenticated owner with
250 ledger entries plus 50 entries for another owner. After 5 unmeasured warm-up
requests per endpoint, it records 20 balance requests and 20 first-page history
requests with no additional synthetic concurrency; at least 19 in each set must
complete within 2 seconds. This is a reproducible local regression threshold,
not a production capacity claim.

Feature-002 controller, session-flow, registration, legal, and OTP tests are the
regression gate. No snapshots are updated merely to accept behavioral drift.

## Migration Strategy

1. Modify `schema.prisma` and create a named Prisma migration; do not use
   `db push`.
2. Review generated DDL, then add explicit SQL checks and the immutability
   trigger/function in the same migration.
3. Apply the migration to an empty PostgreSQL 17 database and to a database
   containing feature-002 users/sessions; existing users receive no ledger row
   and read as zero.
4. Generate Prisma Client and run schema/migration tests.
5. Treat migration failure as deployment failure. There is no destructive
   automatic rollback; correction uses a reviewed forward migration.

## Risks And Deferred Decisions

- **Projection drift**: database constraints cannot prove an aggregate ledger
  sum on every row update. The supported application guarantee is scoped to the
  sole wallet repository writer, which atomically changes the projection and
  appends the immutable entry; there is no public writer. Reconciliation tests
  and an operational query detect unsupported privileged SQL changes. A stored
  procedure/privilege split is deferred until another database writer is
  introduced, at which point it becomes a prerequisite rather than an optional
  optimization.
- **Lock contention**: all writes for one user serialize on one wallet row. This
  is intentional and bounded; transaction code performs no network calls.
- **Sequence visibility**: PostgreSQL sequences can have gaps and allocation
  order is not commit order. Cursor continuation remains duplicate-free for its
  boundary; a refresh is required to include operations committed after an
  earlier page snapshot.
- **Classifier governance**: source and operation kind are bounded extensible
  strings rather than PostgreSQL enums to avoid a schema migration per future
  feature. Each trusted caller must add an application-level allowlist and tests.
- **Compensation policy**: cumulative caps, partial compensation semantics,
  under-dispensing calculation, expiry, and authorization belong to future
  dispensing/payment requirements.
- **Balance allocation**: purchased/bonus buckets, bonus-first order, referral
  awards, expiry, reservations, and money conversion are explicitly deferred.
- **Administrative repair**: no arbitrary mutation API or admin UI is planned.
  Any future repair must append a separately authorized compensating event.

## Complexity Tracking

No constitution violation requires an exception.

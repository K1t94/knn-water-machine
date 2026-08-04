# Quickstart: Water Wallet And Immutable Ledger

This file describes the implemented feature-004 acceptance workflow and the
commands used to validate it locally.

## Prerequisites

- Node.js 24 and pnpm 11.18.0.
- Docker-compatible runtime for PostgreSQL 17.
- Repository dependencies already installed with the lockfile unchanged.
- A dedicated test database URL. Never run destructive test setup against a
  shared or production database.

## Start Infrastructure

```bash
pnpm services:up
```

Use the existing local PostgreSQL settings from `infra/compose.yaml`. Export the
repository's documented local `DATABASE_URL` before Prisma commands.

## Migration Workflow

Implementation creates a reviewed migration; it does not use `prisma db push`.

```bash
pnpm --filter @kaynann/api db:generate
pnpm --filter @kaynann/api db:migrate
```

Validate it twice:

1. Apply all migrations to an empty PostgreSQL 17 database.
2. Apply the wallet migration over a database populated through feature 002,
   then verify existing users/sessions and logical zero wallets remain intact.

The migration test must directly prove:

- negative wallet balance is rejected;
- zero/negative ledger amount is rejected;
- duplicate business key is rejected;
- unknown owner and compensation origin are rejected;
- ledger `UPDATE` and `DELETE` are rejected by the trigger;
- deleting an owner/origin with ledger references is restricted.

## Focused Backend Checks

Fast checks after domain/application changes:

```bash
pnpm --filter @kaynann/api typecheck
pnpm --filter @kaynann/api test -- wallet
```

Acceptance-critical database tests:

```bash
RUN_POSTGRES_INTEGRATION=1 pnpm --filter @kaynann/api exec vitest run \
  test/wallet-migration.integration-spec.ts \
  test/wallet-postgres.integration-spec.ts \
  test/wallet-concurrency.integration-spec.ts \
  test/wallet-transaction.integration-spec.ts \
  test/wallet-history.integration-spec.ts
```

The database suite must use separate connections and synchronization barriers
for these races:

- at least 100 concurrent debits whose total demand exceeds the balance;
- 100 concurrent credits with the same business key and identical facts;
- same business key with conflicting facts;
- rollback forced after the balance update but before a valid ledger append.

The idempotency suite also submits the same event 100 times sequentially. The
history suite traverses at least 250 owner operations and proves each appears
exactly once in `sequence DESC` order.

At every committed checkpoint, query the signed ledger sum and compare it with
the wallet projection. Do not replace these tests with mocks or SQLite.

## Local Read Performance Check

The reproducible local regression profile uses PostgreSQL 17 with one
authenticated wallet containing 250 ledger entries and another user containing
50 unrelated entries. It adds no synthetic concurrent traffic.

```bash
RUN_POSTGRES_INTEGRATION=1 pnpm --filter @kaynann/api exec vitest run \
  test/wallet-read-performance.acceptance-spec.ts
```

For each of `GET /v1/wallet/balance` and the first 20-entry history page, discard
5 warm-up requests and measure 20 requests. At least 19 of 20 for each endpoint
must complete within 2 seconds. This guards local query regressions; it is not a
production load or capacity claim.

On 2026-08-06, the local PostgreSQL 17 acceptance run measured balance p95 at
3.6 ms (4.0 ms max) and history p95 at 4.0 ms (5.9 ms max). These numbers are
environment-specific regression evidence, not a production SLO or capacity
estimate.

## Public Contract Checks

```bash
pnpm --filter @kaynann/api openapi:generate
pnpm --filter @kaynann/api openapi:check
pnpm --filter @kaynann/api test -- wallet-http
```

Contract assertions cover:

- authenticated current-user ownership only;
- zero response without a wallet row;
- limit default 20 and maximum 100;
- malformed, wrong-version, and cross-user cursor handling;
- deterministic newest-first continuation without duplicates;
- exact decimal strings beyond `Number.MAX_SAFE_INTEGER`;
- absence of user IDs, business keys, sequence, Prisma fields, and compensation
  internals;
- no public credit, debit, compensation, or adjustment route.

## Mobile Checks

```bash
pnpm --filter @kaynann/mobile test -- wallet
pnpm --filter @kaynann/mobile typecheck
pnpm build:mobile:js
```

Use controlled cold Observable API fixtures to test:

- initial loading, zero, non-zero, empty history, error, retry, refresh, and page
  loading states;
- repeated pagination taps issue at most one page request for the cursor;
- refresh discards old entries and cursor;
- logout/session loss clears state immediately;
- a delayed result from the previous session cannot update the new session;
- restored credentials load wallet data through existing access refresh logic;
- disposing the composition root unsubscribes and aborts work.

## Full Gate

```bash
pnpm check:repo
pnpm lint
pnpm lint:rules:test
pnpm format:check
pnpm typecheck
pnpm test
pnpm --filter @kaynann/api openapi:check
pnpm build:api
pnpm build:mobile:js
```

Run the real-PostgreSQL acceptance and performance commands above separately
with `RUN_POSTGRES_INTEGRATION=1`; the default `pnpm test` intentionally skips
these destructive, isolated-schema suites.

Re-run the feature-002 auth, session, registration, legal, SMS, and mobile-flow
tests without weakening their assertions. The gate fails if migration/schema or
mobile composition changes alter those public contracts.

## Manual Read Smoke Test

After automated checks pass, use an existing development session token:

```bash
curl -H "Authorization: Bearer <access-token>" http://localhost:3000/v1/wallet/balance
curl -H "Authorization: Bearer <access-token>" "http://localhost:3000/v1/wallet/operations?limit=20"
```

Expected new-user results are an exact zero balance and an empty page. There is
intentionally no curl command for changing a balance; test fixtures call the
trusted application command service directly.

## Completion Evidence

- Reviewed Prisma migration plus raw SQL constraints/trigger.
- Passing real-PostgreSQL race, rollback, constraint, and immutability tests.
- Passing OpenAPI and authenticated isolation tests.
- Passing MobX/RxJS session-lifecycle tests.
- Clean lint, format, typecheck, unit tests, API build, and mobile JS build.
- Unchanged feature-002 externally observable behavior.

## Deferred Product Decisions

Feature 004 intentionally does not define or implement referral relationships,
welcome/referral bonus rules, expiry, payments, source buckets, bonus-first
spending, QR, MQTT, machine selection, or physical dispensing. Their event
semantics and policies require separate features; future modules may call the
internal idempotent wallet commands without adding public wallet write routes.

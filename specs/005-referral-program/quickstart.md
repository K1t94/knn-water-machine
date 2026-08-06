# Quickstart: Referral Program

This document describes the implemented rollout, operation, and validation
workflow. Run service-backed commands only against disposable local/test
schemas; none of the commands below is an automatic schema-sync workflow.

## Prerequisites

- Node.js `>=24 <25`
- pnpm `11.18.0`
- Docker with PostgreSQL 17 and Redis for opt-in integration suites
- Existing workspace dependencies installed with the repository lockfile

Start local services when database/Redis validation is required:

```bash
pnpm services:up
```

Load API environment variables in the same terminal that runs Prisma or the
opt-in test process:

```bash
set -a
source apps/api/.env
set +a
```

The `.env` file remains local and must not be committed.

## Bonus Configuration

Development and test environments default to:

```dotenv
REFERRAL_WELCOME_BONUS_ML=10000
REFERRAL_INVITER_BONUS_ML=5000
```

Staging and production must set both values explicitly. Values are positive
whole millilitres in `1..9223372036854775807`; invalid or absent required values
fail API startup. Changing a value affects only entitlements created afterward.

## Migration Validation

Format and validate the Prisma schema:

```bash
pnpm --filter @kaynann/api exec prisma format --schema prisma/schema.prisma
pnpm --filter @kaynann/api exec prisma validate --schema prisma/schema.prisma
pnpm db:generate
```

Review the generated SQL migration before applying it. It must create referral
schema objects, constraints, indexes, and triggers only. It must not create
promo codes, welcome entitlements, relationships, eligibility locks, or wallet
ledger operations.

Validate migration paths on disposable PostgreSQL schemas:

1. Empty database through every committed migration.
2. Database upgraded through feature 002 migrations.
3. Database upgraded through feature 004 wallet migrations with existing users.
4. Trigger attempts for promo/relationship update/delete.
5. CHECK/UNIQUE/partial-index failures and transaction rollback.

Apply reviewed migrations to the configured local database with the existing
command:

```bash
pnpm db:migrate
```

Automatic schema synchronization is not an accepted workflow.

## Existing-User Provisioning

The API exposes idempotent provisioning commands for existing users:

```bash
pnpm --filter @kaynann/api referral:provision -- --dry-run
pnpm --filter @kaynann/api referral:provision
```

The dry run reports users missing promo/eligibility records without writing.
The real command uses bounded UUID-keyset batches and reports scanned, created,
already-present, collision, and failure counts. It is safe to rerun. Verify that
the missing count is zero before enabling referral UI.

Provisioning creates neither welcome bonuses nor any wallet operation for
existing users.

### Schema-First Rollout

1. Deploy the reviewed referral migration while referral routes and mobile
   navigation remain unexposed.
2. Drain or restart old API writers before provisioning. This repository uses no
   runtime feature flag, so mixed old/new writers are not an accepted rollout
   state.
3. Run `referral:provision -- --dry-run`, review its counters, then run the write
   command.
4. Repeat the dry run until it reports **zero missing** users. Safe lazy
   provisioning remains enabled for a user created or missed during the batch.
5. Deploy the API that exposes referral reads/apply and starts recovery, then
   expose the authenticated Referral navigation in mobile.

Issued promo codes, relationships, and entitlements are immutable records and
must be preserved during rollback. Database rollback is therefore fix-forward:
disable referral traffic, retain issued records, correct the code or migration,
redeploy, and run recovery. Do not reverse the migration, delete referral rows,
or manually edit wallet balances.

## Recovery Operations

Nest scheduling performs normal leased recovery once per second. The API also
provides a one-shot command using the same claim/lease and wallet-idempotency
path:

```bash
pnpm --filter @kaynann/api referral:recover
```

It claims only due or expired entitlements and cannot manually edit a balance.
Inspect structured counters for claimed, delivered, replayed, retried,
permanent-failure, stale-lease, and remaining-due work.

## Targeted Validation

Hermetic and source-contract commands:

```bash
pnpm lint:api
pnpm lint:mobile
pnpm lint
pnpm format:check
pnpm --filter @kaynann/api typecheck
pnpm --filter @kaynann/mobile typecheck
pnpm --filter @kaynann/api exec vitest run src/referral test/referral-http.contract-spec.ts test/openapi.contract-spec.ts
pnpm --filter @kaynann/mobile exec vitest run referral src/navigation/MainNavigator.spec.tsx
pnpm --filter @kaynann/api openapi:generate
pnpm --filter @kaynann/api openapi:check
pnpm build:api
pnpm build:mobile:js
```

The OpenAPI implementation task retargets the aggregate generated snapshot to
feature 005 while retaining auth and wallet routes. Generation and check must
prove that no public referral bonus/recovery/eligibility endpoint and no wallet
write endpoint exists.

## Real PostgreSQL And Redis Suites

Persistence guarantees require PostgreSQL 17. The opt-in command is:

```bash
RUN_POSTGRES_INTEGRATION=1 \
DATABASE_URL="$DATABASE_URL" \
pnpm --filter @kaynann/api test:referral:postgres
```

The database role must be able to create and drop isolated test schemas. The
suite owns disposable schemas, applies committed migrations, and must never use
a shared production database. It covers uniqueness/check constraints, triggers,
rollback, 100-way same/competing apply races, apply-vs-lock ordering, lease
reclaim, concurrent workers, process-interruption replay, exactly-one wallet
effect, and traversal of at least 250 invitations.

Registration integration additionally requires real Redis:

```bash
RUN_POSTGRES_INTEGRATION=1 \
RUN_REDIS_INTEGRATION=1 \
DATABASE_URL="$DATABASE_URL" \
REDIS_URL="$REDIS_URL" \
pnpm --filter @kaynann/api test:referral:registration
```

Default `pnpm test` remains hermetic and skips opt-in service-backed suites.

### SC-006 Visibility Checks

The acceptance suites also exercise the real one-second recovery scheduler and
poll authenticated read endpoints every 100 milliseconds for no more than five
seconds after a successful write response:

```bash
RUN_POSTGRES_INTEGRATION=1 \
pnpm --filter @kaynann/api test:referral:postgres -- \
  -t "concurrent|250|isolation|cursor|SC-006 apply"

RUN_POSTGRES_INTEGRATION=1 \
RUN_REDIS_INTEGRATION=1 \
pnpm --filter @kaynann/api test:referral:registration
```

The apply check observes the attached relationship, invitation, inviter summary,
and exactly one inviter wallet credit. The registration check observes the same
relationship plus exactly one 10,000 ml welcome credit and one 5,000 ml inviter
credit. Both tests start and dispose their scheduler instance explicitly.

## Manual API Check

With a local API and two authenticated test users:

1. Call `GET /v1/referrals/me` for each user and verify stable distinct codes.
2. Apply inviter A's code as user B with
   `POST /v1/referrals/applications`.
3. Repeat the same request and verify `ALREADY_ATTACHED` without another credit.
4. Submit a different code and verify `REFERRAL_ALREADY_ATTACHED`.
5. Verify B's balance increased only by the welcome amount applicable at its
   registration and A's by exactly one inviter amount.
6. Call `GET /v1/referrals/invitations`; verify only masked `**NN` identity and
   no database/user/entitlement/business-key fields.
7. Verify every authenticated response uses `Cache-Control: no-store`.

## Manual Mobile Check

1. Open `kaynann://register?promo=<CODE>` while signed out; verify the editable
   registration promo field is populated but not applied automatically.
2. Complete OTP and legal acceptance; verify existing session/navigation
   behavior remains intact.
3. Open Referral from the wallet experience and inspect loading, loaded, empty,
   refresh, and retry states.
4. Copy the real promo code and share the API-provided referral link.
5. Open a referral link while signed in; verify Apply is prefilled and still
   requires explicit confirmation.
6. Verify success locks the input; closed eligibility shows a reason.
7. Exercise pagination with more than one page.
8. Log out or replace the session while a request is pending; verify private
   state clears and stale responses do not repopulate it.

The screen follows the mockup hierarchy only. It must not show the illustrative
20 L reward, full invitee names, reward-after-purchase promise, sample code, or
mockup bottom navigation.

Record the completed iOS/Android visual and SC-005 timed checks in
`specs/005-referral-program/checklists/mobile-visual.md`. Consolidated automated,
service-backed, and manual evidence belongs in
`specs/005-referral-program/checklists/acceptance.md`.

## Full Acceptance Gate

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build:api
pnpm build:mobile:js
pnpm --filter @kaynann/api openapi:check
```

Run both opt-in suites separately before feature acceptance. Stop local services
after validation:

```bash
pnpm services:down
```

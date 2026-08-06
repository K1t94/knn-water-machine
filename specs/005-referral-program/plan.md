# Implementation Plan: Referral Program

**Branch**: `refferal-program-feature` | **Date**: 2026-08-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/005-referral-program/spec.md`

## Summary

Add a dedicated NestJS referral module and a minimal Expo referral experience.
Every registered user receives one immutable random promo code and one explicit
eligibility state. Registration and authenticated application create immutable
relationships plus durable bonus entitlements; the existing wallet application
command delivers captured exact millilitre amounts with a globally unique
`referral_bonus:<entitlement-id>` key. PostgreSQL leases recover interrupted
delivery without a new queue or a false distributed-transaction guarantee.

Existing users receive promo/eligibility records through a dry-run-capable,
idempotent backfill plus lazy repair, but never receive a retroactive welcome
bonus. Public reads expose only own code/summary and masked successfully credited invitation
history. Mobile follows the existing MobX/RxJS lifecycle, preserves
`kaynann://register?promo=...`, adds explicit signed-in application, copy/share,
and a small authenticated native stack without adopting the mockup's product
values or bottom navigation.

## Technical Context

**Language/Version**: Node.js `>=24 <25`; TypeScript declared `^5.8.3`, resolved `5.9.3`

**Primary Dependencies**: NestJS `11.1.28`; Prisma/Prisma Client `6.19.3`;
Nest Schedule `6.1.3`; Expo SDK `54.0.36`; React Native `0.81.5`; React
`19.1.0`; MobX `6.16.1`; RxJS `7.8.2`; one planned SDK-aligned dependency,
`expo-clipboard`

**Storage**: PostgreSQL 17 for referral facts, entitlements, leases, and wallet;
Redis `5.12.1` remains authoritative only for pending registration context;
no mobile persistence for server referral state

**Testing**: Vitest `3.2.7`, Supertest, React Native Testing Library `14.0.1`,
real PostgreSQL 17 concurrency/migration tests, and Redis-backed registration
integration tests

**Target Platform**: Existing Linux NestJS API and Expo iOS/Android app

**Project Type**: Existing pnpm `11.18.0` mobile + API monorepo under `apps/*`

**Performance Goals**: own-summary uses bounded indexed reads; invitation pages
use `(inviterUserId, sequence DESC)` and remain deterministic through at least
250 rows; promo lookup uses one unique index; registration adds bounded writes;
normal inline delivery makes accepted bonuses visible within the specification's
five-second objective while durable recovery handles outages

**Constraints**: exact integer millilitres; immutable code/relationship facts;
one relationship per invitee; no retroactive welcome; no public wallet/referral
write other than explicit code application; no queue/framework migration;
existing OTP/legal/session request and response contracts remain unchanged

**Scale/Scope**: four referral persistence concepts, three authenticated HTTP
routes, three trusted internal commands, one leased recovery worker, one
provisioning CLI, two mobile screens, and a minimal authenticated navigator

## Constitution Check

_GATE: passed before research and passed again after design._

| Principle | Design evidence | Result |
| --- | --- | --- |
| One logical diff | Nine dependency-ordered phases isolate domain, schema, persistence, delivery, auth integration, HTTP, mobile data, UI, and acceptance work. | PASS |
| Boundary validation | DTOs bound promo/cursor/limit input; config and internal command values are validated before persistence. | PASS |
| Explicit outputs | Dedicated mappers expose masked labels and exact strings while omitting user IDs, entitlement/recovery state, wallet keys, and Prisma records. | PASS |
| Schema safety | A reviewed Prisma migration adds checks, partial indexes, and triggers; migration performs no data backfill or credit. | PASS |
| Security-sensitive work | Existing `AccessSessionGuard` owns user identity; registration HTTP/session contracts are unchanged and auth regression is mandatory. | PASS |
| Minimal validation | Every phase has focused tests before workspace-wide checks. | PASS |
| Durable style memory | Style memory was read and is not modified. | PASS |
| Context discipline | Research was limited to requested feature artifacts, manifests, auth/registration, wallet, navigation, configs, and the supplied mockup. | PASS |
| Frontend reactive architecture | MobX exclusively owns referral screen state; disposable RxJS services own requests, cancellation, retry, session replacement, and deep-link orchestration. | PASS |

No constitution violation requires a complexity exception.

## Conflicts, Assumptions, And Deferred Product Decisions

1. The current wallet repository always starts its own transaction and accepts
   no external Prisma client. Referral therefore cannot honestly promise one
   transaction across relationship and wallet credit without weakening module
   boundaries. A durable entitlement is committed with the relationship and is
   delivered at least once; wallet uniqueness provides exactly one effect.
2. Pending promo text currently lives in Redis registration authorization,
   accepts broader printable input up to 64 characters, and disappears when
   completion is finalized. Feature 005 canonicalizes it before completion
   leaves editable state and revalidates it in the database transaction. Redis
   remains context storage, never referral truth.
3. Registration retries currently recover prepared credentials through the
   existing completion identity. The referral onboarding adapter is idempotent
   under database uniqueness; it does not alter credentials or public response.
   Pre-existing finite Redis recovery TTL and legal recheck semantics are auth
   risks outside this feature and must not be silently redesigned here.
4. The MVP refers to first successful purchase, but no purchase model exists.
   This feature exposes only a trusted, idempotent eligibility-close application
   contract. Failed/cancelled/incomplete purchases are explicitly not modeled.
5. The mockup shows 20 L, full names, a reward-after-purchase narrative, sample
   code, and bottom tabs. These conflict with the approved spec or exceed scope.
   Only hierarchy and visual direction are retained.
6. The canonical referral link remains the configured custom scheme. Universal
   links/install fallback are deferred until a public domain and platform
   association files exist.
7. Temporary bonus amounts remain policy configuration: development/test use
   10,000 mL welcome and 5,000 mL inviter; staging/production require explicit
   values. No expiry, source buckets, bonus-first ordering, or invitee bonus is
   inferred.

No unresolved clarification blocks technical task generation.

## Architecture

### Backend boundaries

```text
RegistrationService serializable transaction
  -> ReferralRegistrationIntegration (transaction-aware composition adapter)
       -> referral repository with Prisma.TransactionClient
       -> durable promo/eligibility/relationship/entitlement facts

ReferralController
  -> ReferralApplicationService / ReferralQueryService
       -> ReferralRepository port
            <- PrismaReferralRepository -> PrismaService -> PostgreSQL

Inline attempt or ReferralRecoveryScheduler
  -> ReferralBonusDeliveryService
       -> WalletCommandService exported application boundary
       -> ReferralRepository delivery metadata

Future trusted Purchase application
  -> CloseReferralEligibility command
       -> ReferralRepository; no public HTTP adapter
```

- `referral/domain` contains framework-free promo, entitlement, eligibility,
  cursor, masking, and stable error types.
- `referral/application` owns commands, queries, repository/clock/random ports,
  delivery classification, provisioning, and recovery policy. It imports no
  Prisma and never mutates wallet persistence.
- `referral/infrastructure/postgres` is the only referral layer importing
  Prisma. It owns locks, claims, SQL error classification, transaction-aware
  onboarding, keyset provisioning, and cursor queries.
- `referral/http` owns guarded routes, DTO validation, stable error mapping,
  Swagger annotations, no-store headers, and response shaping.
- `referral/composition` integrates registration and wallet application
  boundaries without exporting infrastructure to other domains.
- `ReferralModule` imports sessions and wallet modules, exports only trusted
  onboarding and eligibility-close application tokens, and registers no public
  delivery/provisioning controller.

### Mobile boundaries

```text
ReferralScreen / ApplyReferralCodeScreen
  -> ReferralStore observable state
  -> ReferralFlowService commands
       -> SessionFlowService.withAccess(...)
       -> ReferralApi cold Observables
       -> ReferralNativeActions cold copy/share Observables

App-level ReferralLinkCoordinator
  -> signed-out editable registration promo
  -> signed-in explicit ApplyReferralCode navigation
```

`ReferralCompositionRoot` receives the existing authenticated request/session
capability, owns store/flow/native actions, and disposes before auth root. The
flow epochs session identity, aborts in-flight work, and clears private data on
logout/replacement. Components hold only ephemeral form text where necessary;
server/screen state belongs solely to MobX.

## Core Design

### Promo codes

- Exactly 12 uppercase characters from
  `23456789ABCDEFGHJKMNPQRSTVWXYZ`; the alphabet removes `0`, `1`, `I`, `L`,
  `O`, and `U`.
- Boundary handling is `trim -> uppercase -> exact regex`. Maximum raw request
  length remains 64 to match pending registration storage; canonical storage is
  12 characters.
- Generation uses Node `crypto.randomBytes` with rejection sampling and up to
  eight retries after a database unique collision. Roughly 59 bits of space and
  no identity-derived input prevent practical prediction.
- Invalid, unknown, and codes owned by a `SUSPENDED` user share
  `REFERRAL_CODE_UNAVAILABLE`. New attachments require an `ACTIVE` owner;
  database uniqueness remains authoritative, while self/conflict/closed cases
  remain actionable. Suspension after attachment does not alter the immutable
  relationship or stop delivery/recovery of its captured entitlement.
- Link format is `kaynann://register?promo=<CODE>`. Links never auto-apply.

### Persistence

Concrete models and SQL invariants are defined in [data-model.md](./data-model.md):

- `ReferralPromoCode`: one immutable unique canonical code per user.
- `ReferralEligibility`: `OPEN`, `ATTACHED`, or `CLOSED`; the shared row lock for
  apply-vs-purchase ordering.
- `ReferralRelationship`: immutable inviter/invitee/channel facts, unique
  invitee, public UUID, monotonic `bigint` sequence.
- `ReferralBonusEntitlement`: immutable captured wallet command plus mutable
  leased delivery metadata.

Prisma expresses relations, enums, ordinary indexes, and ordinary uniqueness.
Reviewed SQL adds canonical-code and state checks, self-referral prevention,
partial welcome uniqueness, lease/delivery checks, transition restrictions,
and immutable promo/relationship/entitlement-fact triggers. Foreign keys use
`RESTRICT`. Migration code neither provisions users nor credits wallet.

### Registration integration

For registration without promo:

1. Existing OTP/legal/install validation remains unchanged.
2. Existing completion identity and session credentials are prepared.
3. In the serializable Prisma transaction, user/legal/session effects run as
   today, then onboarding provisions promo and `OPEN` eligibility.
4. A genuinely new user receives one captured welcome entitlement; an existing
   user receives no retroactive entitlement.
5. Commit, preserve current registration response, mark Redis completion, then
   attempt bounded inline delivery; recovery owns failures.

For registration with promo, canonicalize/resolve before `beginCompletion` so a
bad value remains editable. Inside the same database transaction, lock the
invitee eligibility, re-resolve owner, reject self, create relationship plus
inviter entitlement, and set `ATTACHED`. New-user welcome remains exactly one;
there is no second invitee entitlement. Unknown/self code fails registration
without creating user/session/referral facts. Concurrent/repeated completion is
arbitrated by existing completion identity plus database uniqueness.

A crash after database commit cannot lose entitlements. If Redis completion or
the caller response is interrupted, existing registration recovery returns the
same credentials; onboarding uniqueness returns the same durable facts. Wallet
may not yet be visible, but normal inline/scheduled delivery targets the
five-second visibility objective. Its acceptance clock starts when success is
returned and runs with healthy PostgreSQL, Redis where registration requires
it, and wallet boundary, the one-second scheduler enabled, no injected failure,
and authenticated read polling at most 100 milliseconds apart.

### Post-registration apply and eligibility lock

`POST /v1/referrals/applications` uses session-derived identity and no
`Idempotency-Key`: exactly one relationship is the natural durable result.
Apply locks eligibility, validates code owner, and atomically creates
relationship/inviter entitlement. Same-code replay returns
`ALREADY_ATTACHED`; another code returns `REFERRAL_ALREADY_ATTACHED`; a closed
row returns `REFERRAL_ELIGIBILITY_CLOSED`.

Future `CloseReferralEligibility` accepts trusted `userId`, stable successful
purchase key, and success time. It is idempotent and has no controller. Apply
and close lock the same row; whichever transaction commits its valid transition
first wins. This plan does not create a purchase table or infer failed status.

### Bonus configuration and delivery

- Add `REFERRAL_WELCOME_BONUS_ML` and `REFERRAL_INVITER_BONUS_ML` to the Zod
  environment schema and examples.
- Parse canonical positive decimal strings to `bigint` in
  `1..9223372036854775807`; fail startup on missing required production values
  or invalid values. Development/test default to `10000` and `5000`.
- Capture amount, beneficiary, key, operation kind, source, and occurred time in
  the entitlement. Later config changes affect only new rows.
- Call `WalletCommandService.credit` with business key
  `referral_bonus:<entitlement-uuid>`, source `REFERRAL_PROGRAM`, and kind
  `REFERRAL_WELCOME_BONUS` or `REFERRAL_INVITER_BONUS`.
- Perform one bounded post-commit inline attempt. The scheduled worker claims 25
  due/expired rows using `FOR UPDATE SKIP LOCKED`, a 30-second lease, and a
  one-second non-overlapping schedule. Retry delay grows from one second to five
  minutes with jitter. Transient obligations have no discard limit.
- Wallet success/replay conditionally sets `DELIVERED`; immutable-fact conflict
  sets `PERMANENT_FAILURE` and emits high-severity structured diagnostics. No
  recovery status is public.
- `referral:recover` reuses the claim service for safe operations; it cannot
  write wallet projection/ledger directly.

### Existing-user rollout

Use an application backfill plus lazy repair, not migration data generation:

1. Deploy the reviewed schema migration.
2. Deploy compatible application code and drain old writers that do not
   provision referral records.
3. Keep referral reads safe through lazy provisioning during the rollout.
4. Run `referral:provision -- --dry-run` and inspect structured counters.
5. Run bounded UUID-keyset batches and repeat until verification reports zero
   users without promo and eligibility records.
6. Expose referral navigation through normal release sequencing after
   verification. No runtime feature-flag dependency is introduced.

The command creates only promo and `OPEN` eligibility rows. Randomness belongs
to application code; batch commits avoid table-wide locks. Migration rollback
means PostgreSQL transaction rollback when application of the reviewed SQL
fails; no destructive down migration is provided. After a migration has been
deployed, operational rollback consists of disabling referral exposure and
applying a reviewed fix-forward migration. Issued promo codes and referral
records are never deleted as rollback behavior.

### Public API

The source contract is [contracts/openapi.yaml](./contracts/openapi.yaml).

| Method and route | Result |
| --- | --- |
| `GET /v1/referrals/me` | Own code/link, eligibility, attached code when applicable, current inviter reward, successfully credited total and count |
| `POST /v1/referrals/applications` | Explicit code attachment or same-code replay |
| `GET /v1/referrals/invitations` | Successfully credited masked newest-first history, default 20/max 100 |

All routes use `AccessSessionGuard`, derive identity from the session, return
`Cache-Control: no-store`, and use explicit DTOs. Exact millilitres are strings.
History includes only delivered inviter entitlements and labels `**NN`; it omits
phones, both user IDs, wallet keys, entitlement/lease/error fields, and database
columns. Cursor is opaque base64url `{v:1,beforeSequence:"..."}` and queries
`sequence < cursor` with `limit + 1`.

Stable public errors include `REFERRAL_CODE_UNAVAILABLE`,
`REFERRAL_SELF_NOT_ALLOWED`, `REFERRAL_ALREADY_ATTACHED`,
`REFERRAL_ELIGIBILITY_CLOSED`, and `REFERRAL_SERVICE_UNAVAILABLE`, plus existing
authentication errors. There are no public bonus, recovery, backfill,
eligibility-close, inviter-change, relationship-delete, or wallet-credit routes.

The existing aggregate Swagger generator/snapshot moves from the feature-004
contract location to feature 005 and must retain every auth and wallet route.

### Mobile behavior

- `ReferralApi` wraps `fetch` in `defer`, validates exact public shapes, attaches
  access session through the current flow, and aborts on unsubscribe.
- `ReferralStore` owns summary, history, cursor, initial/refresh/page/apply,
  validation/success/closed/retry states and computed presentation states.
- `ReferralFlowService` reacts to session identity, uses generation checks,
  cancels on logout/replacement, performs joined initial reads, resets pagination
  on refresh, serializes load-more, and never lets stale work mutate state.
- One app-lifecycle link coordinator consumes initial and later URLs once.
  Signed-out links update editable pending registration context; signed-in links
  navigate with a prefilled code but require confirmation. Attached/closed users
  see deterministic states.
- `ReferralScreen` uses API amounts and masked history; it supports loading,
  empty, loaded, refresh, retry, pagination, copy, and share. The apply screen
  supports local format feedback without duplicating backend ownership rules.
- A minimal authenticated native stack contains Wallet, Referral, and Apply.
  Logout, session restoration, auth navigation, and back behavior remain intact.

Dependency decision:

| Candidate | Decision | Reason |
| --- | --- | --- |
| `expo-clipboard` | Select during implementation via Expo SDK-aware install | Core RN has no supported Clipboard API; SDK 54-compatible module provides exact code copy with small, bounded native cost. |
| React Native `Share` | Use existing platform API | Correct text/link share sheet; no dependency. |
| `expo-sharing` | Reject | File sharing does not solve invitation text. |
| `expo-linking` | Reject | Existing RN `Linking` and configured custom scheme are sufficient. |
| Expo Router, bottom-tabs, icon/SVG, persistence libraries | Reject | Broad migration or unnecessary state/assets; no required guarantee. |

## Project Structure

### Documentation

```text
specs/005-referral-program/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── spec.md
├── checklists/
│   ├── acceptance.md                  # Phase 9 validation evidence
│   └── mobile-visual.md               # Phase 8 manual evidence
├── contracts/
│   ├── internal-referral-commands.md
│   └── openapi.yaml
└── tasks.md                         # generated later by speckit-tasks
```

### Planned API files

```text
apps/api/
├── package.json                     # add provision/recover/PG test scripts
├── .env.example                     # document exact bonus configuration
├── prisma/
│   ├── schema.prisma                # referral enums/models/relations
│   └── migrations/<timestamp>_add_referral_program/migration.sql
├── src/
│   ├── app.module.ts
│   ├── config/env.ts
│   ├── openapi/generate-openapi.ts  # feature-005 aggregate snapshot target
│   ├── auth/application/registration.service.ts
│   └── referral/
│       ├── referral.module.ts
│       ├── domain/
│       │   ├── promo-code.ts
│       │   ├── referral-errors.ts
│       │   ├── referral-types.ts
│       │   └── phone-mask.ts
│       ├── application/
│       │   ├── ports/referral.repository.ts
│       │   ├── referral-application.service.ts
│       │   ├── referral-query.service.ts
│       │   ├── referral-bonus-delivery.service.ts
│       │   ├── referral-recovery.service.ts
│       │   ├── referral-provisioning.service.ts
│       │   └── referral-registration.integration.ts
│       ├── composition/
│       │   ├── referral-recovery.scheduler.ts
│       │   └── close-referral-eligibility.ts
│       ├── infrastructure/postgres/
│       │   ├── prisma-referral.repository.ts
│       │   └── referral-cursor.ts
│       ├── http/
│       │   ├── dto/referral-request.dto.ts
│       │   ├── dto/referral-response.dto.ts
│       │   ├── referral-response.mapper.ts
│       │   ├── referral-response.mapper.spec.ts
│       │   ├── referral-error.filter.ts
│       │   └── referral.controller.ts
│       └── cli/
│           ├── provision-referrals.ts
│           └── recover-referral-bonuses.ts
└── test/
    ├── openapi.contract-spec.ts
    ├── referral-http.contract-spec.ts
    ├── referral-migration.integration-spec.ts
    ├── referral-postgres.fixture.ts
    ├── referral-repository.integration-spec.ts
    ├── referral-concurrency.integration-spec.ts
    ├── referral-recovery.integration-spec.ts
    └── referral-registration.integration-spec.ts
```

Small co-located `*.spec.ts` files accompany domain, application, cursor,
configuration, scheduler, and provisioning units. Existing auth/wallet tests are
modified only where the integration surface or aggregate OpenAPI snapshot
requires regression assertions.

### Planned mobile files

```text
apps/mobile/
├── package.json                     # add SDK-aligned expo-clipboard
└── src/
    ├── App.tsx                      # compose/dispose referral lifecycle
    ├── api/referral-api.ts
    ├── api/referral-api.spec.ts
    ├── navigation/
    │   ├── RootNavigator.tsx
    │   ├── AuthNavigator.tsx        # delegate link ownership
    │   ├── MainNavigator.tsx
    │   ├── MainNavigator.spec.tsx
    │   ├── referral-link-coordinator.ts
    │   └── referral-link-coordinator.spec.ts
    └── referral/
        ├── referral-composition-root.ts
        ├── native/referral-native-actions.ts
        ├── native/referral-native-actions.spec.ts
        ├── screens/ReferralScreen.tsx
        ├── screens/ReferralScreen.spec.tsx
        ├── screens/ApplyReferralCodeScreen.tsx
        ├── screens/ApplyReferralCodeScreen.spec.tsx
        ├── services/referral-flow.service.ts
        ├── services/referral-flow.service.spec.ts
        ├── stores/referral.store.ts
        └── stores/referral.store.spec.ts
```

**Structure Decision**: Preserve the implemented feature-002/004 module and
composition conventions. Do not create a shared package or leak Prisma types
beyond infrastructure/composition adapters.

## Implementation Phases

### Phase 1: Domain contracts, configuration, and promo rules

**Goal**: Establish exact framework-free invariants and fail-fast policy before
persistence work.

**Files**: referral domain/application port files, config schema/provider and
tests, `.env.example`, internal contract tests.

**Dependencies**: none.

**Work**: implement CSPRNG generation/canonicalization/collision classification,
exact `bigint` bonus config, eligibility/entitlement types, phone masking,
cursor value, stable errors, repository/registration/purchase command ports.

**Minimum validation**:
`pnpm --filter @kaynann/api test -- promo-code referral-config phone-mask` and
`pnpm --filter @kaynann/api typecheck`.

**Completion**: unit tests prove alphabet/format, rejection sampling boundary,
eight collision retries, invalid/unknown error equivalence, exact 10,000/5,000
test defaults, invalid startup values, no invitee referral bonus, and masked
output. This closes floating-point, predictability, config, and enumeration risk.

### Phase 2: Prisma migration and existing-user provisioning

**Goal**: Make all durable invariants database-verifiable without changing
balances or existing users during migration.

**Files**: Prisma schema/migration, generated client, Prisma repository
provisioning primitives, provisioning service/CLI/tests, API scripts.

**Dependencies**: Phase 1.

**Work**: add models/enums/checks/indexes/triggers; validate fresh, feature-002,
and feature-004 upgrades; add dry-run/keyset/idempotent provisioning plus lazy
repair; add the opt-in `test:referral:postgres` script before repository phases
consume it; document rolling rollout.

**Minimum validation**: Prisma format/validate/generate, targeted migration test
with `RUN_POSTGRES_INTEGRATION=1`, and provisioning unit test.

**Completion**: reviewed SQL passes all upgrade paths; mutation triggers and
unique/check constraints fail correctly; dry run writes nothing; rerun is safe;
existing users get codes/OPEN eligibility and no entitlement or wallet entry.

### Phase 3: Referral repository, concurrency, and immutability

**Goal**: Implement transactional relationship/application/query behavior with
database-authoritative races.

**Files**: repository port, Prisma repository/cursor, application/query services,
unit and PostgreSQL tests.

**Dependencies**: Phase 2.

**Work**: lock eligibility, attach/replay/conflict/self/closed flows, atomically
persist the relationship plus complete inviter-entitlement fact snapshot, future
eligibility-close command, deterministic history and summary, 250-item cursor
traversal, immutable relationship tests. Phase 3 stores only referral-domain
facts; wallet operation mapping and delivery remain Phase 4 responsibilities.

**Minimum validation**:
`RUN_POSTGRES_INTEGRATION=1 pnpm --filter @kaynann/api test:referral:postgres`
targeted to repository/concurrency files.

**Completion**: 100-way same-code creates one relationship; competing codes
produce one winner and deterministic conflicts; apply-vs-close follows commit
order; one inviter per invitee and self/UPDATE/DELETE are database-rejected;
owner isolation and pagination are proven.

### Phase 4: Entitlements, wallet delivery, and recovery

**Goal**: Guarantee no lost obligation and exactly one wallet effect across
timeouts, failures, restarts, and concurrent workers.

**Files**: delivery/recovery services, scheduler, recovery CLI, repository claim
SQL, module wiring, scripts, unit/PostgreSQL recovery tests.

**Dependencies**: Phase 3 and existing wallet feature 004.

**Work**: create welcome entitlements, deliver already-persisted inviter
entitlements without recreating them, inline attempt, `SKIP LOCKED` claims,
leases, conditional completion, retry/backoff/jitter, permanent-conflict
classification, structured metrics/logs, safe one-shot recovery.

**Minimum validation**: targeted service tests plus real PostgreSQL recovery and
wallet reconciliation tests.

**Completion**: process interruption after wallet credit replays one ledger
entry; concurrent/expired leases are safe; temporary failure remains recoverable;
config changes do not alter existing entitlements; manual retry cannot mutate
balance directly. This closes lost/duplicate bonus risk without a queue.

### Phase 5: Registration completion integration

**Goal**: Complete pending-promo and welcome behavior without changing OTP,
legal, registration response, credentials, or session issuance.

**Files**: transaction-aware onboarding adapter, referral module, registration
service/module integration, Redis/auth referral regression tests, API scripts.

**Dependencies**: Phases 2-4.

**Work**: prevalidate editable pending context; run provisioning, new-user
welcome, optional relationship/inviter entitlement inside the existing
serializable transaction; invoke inline delivery after commit; preserve
completion recovery; add the opt-in `test:referral:registration` script before
the phase completion gate invokes it.

**Minimum validation**:
`RUN_POSTGRES_INTEGRATION=1 RUN_REDIS_INTEGRATION=1 pnpm --filter @kaynann/api test:referral:registration`
plus existing registration contract tests.

**Completion**: no-promo registration earns one welcome; valid promo adds only
one inviter bonus; pending data causes no pre-OTP/legal effect; invalid/self is
editable and atomic; repeat/concurrent completion duplicates neither records nor
wallet effects; existing users receive no retroactive welcome.

### Phase 6: Authenticated referral API and OpenAPI

**Goal**: Expose only the minimum privacy-safe own-data contract.

**Files**: controller, DTOs, filter, response mapper, module/app wiring, source
Swagger annotations, generated aggregate target/snapshot, HTTP/OpenAPI tests.

**Dependencies**: Phases 3-5.

**Work**: implement three guarded routes, no-store, exact string shaping,
masked history, bounded opaque cursor, stable errors, and same-code replay.

**Minimum validation**:
`pnpm --filter @kaynann/api test -- referral-http openapi` followed by
`pnpm --filter @kaynann/api openapi:generate && pnpm --filter @kaynann/api openapi:check`.

**Completion**: cross-user requests are impossible because routes accept no
owner ID; snapshots match source; auth/wallet routes remain; forbidden public
bonus/recovery/lock/wallet-write endpoints are absent; no internal field leaks.

### Phase 7: Mobile API, store, flow, and deep links

**Goal**: Add session-safe reactive data/application behavior before UI styling.

**Files**: `ReferralApi`, store, flow, composition root, native-actions adapter,
app-level link coordinator, unit tests, package dependency update.

**Dependencies**: Phase 6; Expo-compatible `expo-clipboard` installation is an
explicit dependency-change task requiring implementation approval.

**Work**: cold abortable requests, strict response mapping, session generation,
initial load/retry/refresh/page/apply, copy/share Observables, one-shot deep-link
routing, logout/replacement cancellation and stale-response protection.

**Minimum validation**:
`pnpm --filter @kaynann/mobile test -- referral` and
`pnpm --filter @kaynann/mobile typecheck`.

**Completion**: network work is cold/cancellable; session restoration reloads;
logout/replacement clears data; stale requests cannot commit; pagination is
serialized; signed-out links populate registration and signed-in links prefill
explicit apply exactly once.

### Phase 8: Minimal referral UI and navigation

**Goal**: Deliver accessible responsive referral/application screens without a
home redesign or mockup-derived business rules.

**Files**: referral screens, main/root/auth navigators, App composition, screen
and navigation tests.

**Dependencies**: Phase 7.

**Work**: minimal Wallet-to-Referral entry, native stack/back behavior, hero/code
card, copy/share, explanation, credited total/history, apply confirmation,
loading/empty/error/success/closed/pagination states and accessible labels/roles.

**Minimum validation**: targeted mobile tests, lint/typecheck, mobile JS build,
and manual iOS/Android visual/deep-link check.

**Completion**: server values drive all amounts/text; labels are masked; mockup
20 L/full names/reward-after-purchase/sample data/tabs are absent; logout and
auth navigation remain intact across phone sizes.

### Phase 9: Regression, PostgreSQL acceptance, and full validation

**Goal**: Prove feature invariants and preserve completed features 002-004.

**Files**: acceptance/concurrency/migration/security/performance tests,
quickstart/readme/script documentation, generated OpenAPI snapshot.

**Dependencies**: Phases 1-8.

**Work**: complete 100-way races, concurrent invitees, rollback, lease/process
interruption, 250-history traversal, privacy and forbidden-endpoint checks; run
auth, ESLint, wallet, build, format, and migration regression.

**Minimum validation**: all commands in the Validation Matrix, including both
opt-in service-backed suites.

**Completion**: every acceptance scenario in spec is automated or explicitly
manual for native visuals; T086 records separate iOS and Android SC-005 timing
evidence; T090 and T092 exercise the real one-second recovery scheduler and
authenticated reads for both SC-006 paths; all gates pass; no product behavior
from purchase, payment, machine, MQTT, dispensing, or source buckets is present.

## Validation Matrix

Commands below already exist unless marked **planned**; tasks must add planned
scripts before invoking them.

| Concern | Command |
| --- | --- |
| Prisma format | `pnpm --filter @kaynann/api exec prisma format --schema prisma/schema.prisma` |
| Prisma validate | `pnpm --filter @kaynann/api exec prisma validate --schema prisma/schema.prisma` |
| Prisma client | `pnpm db:generate` |
| Reviewed migration apply | `pnpm db:migrate` against disposable/local PostgreSQL after SQL review |
| API lint | `pnpm lint:api` |
| Mobile lint | `pnpm lint:mobile` |
| Workspace lint | `pnpm lint` |
| Formatting | `pnpm format:check` |
| API typecheck | `pnpm --filter @kaynann/api typecheck` |
| Mobile typecheck | `pnpm --filter @kaynann/mobile typecheck` |
| Workspace typecheck | `pnpm typecheck` |
| API referral unit/HTTP | `pnpm --filter @kaynann/api test -- referral` |
| Mobile referral | `pnpm --filter @kaynann/mobile test -- referral src/navigation/MainNavigator.spec.tsx` |
| PostgreSQL referral | **planned in Phase 2** `RUN_POSTGRES_INTEGRATION=1 pnpm --filter @kaynann/api test:referral:postgres` |
| Registration + Redis | **planned in Phase 5** `RUN_POSTGRES_INTEGRATION=1 RUN_REDIS_INTEGRATION=1 pnpm --filter @kaynann/api test:referral:registration` |
| Provision dry run | **planned** `pnpm --filter @kaynann/api referral:provision -- --dry-run` |
| Recovery one-shot | **planned** `pnpm --filter @kaynann/api referral:recover` |
| Auth regression | `pnpm --filter @kaynann/api test -- phone-auth registration session pending-promo` and `pnpm --filter @kaynann/mobile test -- auth registration session` |
| Wallet regression | `pnpm --filter @kaynann/api test -- wallet` and `pnpm --filter @kaynann/mobile test -- wallet` |
| Intentional OpenAPI regeneration | `pnpm --filter @kaynann/api openapi:generate` only after an intentional source-contract change |
| OpenAPI consistency gate | `pnpm --filter @kaynann/api openapi:check` without preceding generation; fails when the committed snapshot is stale |
| API build | `pnpm build:api` |
| Mobile JS build | `pnpm build:mobile:js` |
| Default test suite | `pnpm test` (service-backed suites remain opt-in) |

Acceptance requires both opt-in suites with isolated PostgreSQL schemas and a
test Redis instance, then workspace lint, format, typecheck, tests, OpenAPI
check, and both builds. Migration validation covers empty, feature-002, and
feature-004 databases. Mock/SQLite tests cannot replace database guarantees.

## Risks And Controls

| Risk | Control |
| --- | --- |
| Bonus exists durably but is not yet visible | Inline attempt plus one-second leased recovery, observable due/age counters, no finite transient discard |
| Wallet succeeds before entitlement acknowledgement | Stable stored wallet facts and globally unique key make replay return the same ledger entry |
| Concurrent apply/close or competing codes | One eligibility row lock, unique invitee, checks, and real PostgreSQL race tests |
| Backfill misses users during rolling deploy | Drain incompatible writers, bounded rerunnable command, zero-missing verification, lazy repair |
| Existing users receive accidental bonus | Migration/provisioning/lazy paths cannot create entitlements; PostgreSQL tests assert zero wallet changes |
| Registration pending promo is lost/frozen | Validate before completion transition and revalidate in the database transaction |
| Public privacy leak | Session-derived ownership, explicit response DTOs, fixed phone mask, no-store, contract/security tests |
| Recovery workers overlap or die | `SKIP LOCKED`, lease expiry, conditional ownership updates, per-process overlap guard |
| Promo brute force/enumeration | ~59-bit CSPRNG code, bounded input, same invalid/unknown error; broader rate limiting remains platform security work |
| Custom deep link lacks install fallback | Preserve working scheme; universal links explicitly deferred pending domain infrastructure |
| Clipboard native compatibility | Install through Expo SDK 54-aware tooling and validate native/JS build before UI completion |

## Deferred Work

- Production bonus values and any future policy versioning beyond captured
  entitlement amounts.
- Universal/App Links and web/install fallback.
- First-successful-purchase implementation; feature 005 supplies only its
  trusted eligibility boundary.
- Referral abuse/fraud policy, device/phone velocity rules, and platform-wide
  rate limiting beyond safe non-enumerating errors.
- Bonus expiry, source buckets, bonus-first spending, payments, QR, map,
  machines, MQTT, and dispensing.
- Admin UI/endpoints and arbitrary manual balance or relationship mutation.

## Complexity Tracking

No constitution exception. Durable entitlements and a scheduler add operational
state, but they are the smallest design that survives the existing independent
wallet transaction boundary without a new queue or misleading atomicity claim.

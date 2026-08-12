# Implementation Plan: Referral Program Scope Revision

**Branch**: `005-referral-program` | **Date**: 2026-08-12 | **Spec**: `specs/005-referral-program/spec.md`

**Input**: Updated requirements in `specs/005-referral-program/spec.md`. This plan migrates the implemented code; it is not a greenfield design and does not restore superseded requirements.

## Summary

Refactor the existing referral implementation so registration can create only one inviter relationship/bonus, remove welcome and post-registration application/eligibility behavior, and add a PostgreSQL-authoritative runtime flag. The flag is controlled by protected operational HTTP plus root package scripts, gates all server side effects and public referral reads, pauses recoverable inviter obligations, and drives a MobX/RxJS mobile availability owner that hides and clears all referral UI while disabled.

Historical promo codes, relationships, entitlements, and wallet entries remain immutable. Legacy enum values stay readable; transient eligibility storage is removed only after old instances are drained.

## Technical Context

**Language/Version**: TypeScript 5.8; Node.js 24; React Native/Expo versions already pinned in the workspace

**Primary Dependencies**: NestJS, Prisma, PostgreSQL, React Native, MobX, RxJS, Zod, Vitest; no new runtime dependency

**Storage**: Existing PostgreSQL/Prisma for users, referral facts, wallet ledger, and new singleton feature state; Redis remains part of auth/registration only

**Testing**: Vitest unit/contract/integration tests, PostgreSQL and Redis acceptance suites, Nest OpenAPI generation/check, React Native Testing Library

**Target Platform**: Existing NestJS API deployment with multiple instances; existing iOS/Android Expo client

**Project Type**: pnpm monorepo with API and mobile applications

**Performance Goals**: Preserve existing bounded pagination and recovery batches; flag visibility across instances within 5 seconds; no additional network service

**Constraints**: Runtime toggle without rebuild/restart/release; registration stays available; no credit after successful disable response; exactly-once wallet effect; no secrets in repository/public responses; mobile fail-closed on unknown state

**Scale/Scope**: One runtime flag, two retained authenticated referral reads, one public app-config read, two operational methods, registration/recovery/wallet integration, and referral-related mobile navigation/state

**Pre-implementation baseline (captured 2026-08-12)**: Welcome entitlement, post-registration POST, eligibility model/purchase-close command, and signed-in apply UI were implemented and had to be removed. No runtime availability mechanism existed. Current implementation progress is tracked in `tasks.md`.

All technical questions are resolved in `research.md`.

## Constitution Check

*GATE: Passed before research and re-checked after design.*

| Principle | Design Evidence | Status |
|---|---|---|
| I. One Logical Diff at a Time | Work is phased as schema expand, backend semantics, operations, mobile gating, contract cleanup, then validation. | PASS |
| II. Explicit Boundary Validation | Strict operational DTO, typed public config parser, canonical promo validation, and shaped public/internal responses. | PASS |
| III. Explicit Outputs and Error Paths | `FEATURE_DISABLED`, storage-unavailable, unauthorized, script exit, registration skip, and recovery pause outcomes are specified. | PASS |
| IV. Database and Migration Discipline | Additive default-enabled migration, non-cascading later eligibility drop, retained immutable facts/enums, no auto-sync. | PASS |
| V. Security Review for Sensitive Changes | Dedicated timing-safe bearer guard, no query secrets, public/private contract separation, no credential logging. | PASS |
| VI. Smallest Relevant Validation | Each phase lists unit/contract/integration checks; PostgreSQL tests cover locks and exactly-once behavior. | PASS |
| VII. Durable Style Memory Only on Explicit Request | No style-memory update is planned. | PASS |
| VIII. Context-Efficient Engineering | Only referral/auth/wallet boundaries, schema/migrations, env/packages, mobile composition, tests, artifacts, and mapped mockup were inspected. | PASS |
| IX. Frontend State and Reactive Workflow Discipline | One MobX availability owner, RxJS cancellation/session replacement, explicit disposal, presentation-only observers. | PASS |

There are no constitution violations requiring a complexity exception.

## Pre-implementation Actual-State Gaps (Captured 2026-08-12)

- Registration provisioned eligibility and a `WELCOME` entitlement for every new user before optional inviter application.
- `ReferralApplicationService` and its repository exposed post-registration apply; the controller exposed `POST /v1/referrals/applications`.
- `ReferralEligibilityService` and `CloseReferralEligibility` retained purchase-based eligibility, although no external consumer was found.
- Summary/DTO/mobile API exposed eligibility and attached code.
- Recovery claimed all entitlement kinds and could reach wallet after a service-layer flag check; a wallet-transaction guard did not exist.
- Env schema/templates required welcome and inviter amounts.
- The root package had no operational toggle scripts; the API had only the separate internal metrics-token pattern.
- Mobile constructed referral state unconditionally, always showed the wallet/navigation entry and phone-registration promo input, and routed signed-in deep links to `ApplyReferralCodeScreen`.
- At planning time, existing spec artifacts and tests encoded the superseded behavior. The regenerated `tasks.md` is the source of truth for current implementation progress.

## Project Structure

### Documentation

```text
specs/005-referral-program/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── openapi.yaml
│   ├── openapi.generated.json
│   ├── operational-feature-flag.openapi.yaml
│   └── internal-referral-commands.md
└── tasks.md                 # intentionally unchanged by speckit-plan
```

### Existing Source Areas

```text
apps/api/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── src/
│   ├── auth/application/registration.service.ts
│   ├── config/env.ts
│   ├── observability/internal-metrics.guard.ts
│   ├── referral/
│   │   ├── application/
│   │   ├── composition/
│   │   ├── domain/
│   │   ├── http/
│   │   └── infrastructure/postgres/
│   ├── wallet/application/
│   └── wallet/infrastructure/postgres/
├── test/referral-*.integration-spec.ts
└── .env.example

apps/mobile/
├── src/
│   ├── App.tsx
│   ├── api/
│   ├── auth/
│   ├── navigation/
│   ├── referral/
│   └── wallet/
└── __tests__/

scripts/
package.json
```

**Structure Decision**: Extend the current API/mobile modules. Put public availability in a small app-config/feature module shared by auth and referral, keep operator controller/guard isolated from public Swagger, and preserve referral domain/repository boundaries. Do not add a new service or shared package.

## Persistence and Concurrency Design

### Authoritative Flag

Add `ReferralFeatureState` as defined in `data-model.md`. All API instances query the same PostgreSQL row; no in-memory authoritative cache. The public config response uses `Cache-Control: no-store`. Storage failures do not assume enabled.

### Registration Atomicity

The existing serializable registration transaction is retained. Referral onboarding first takes a shared lock/read on the feature row. Disabled/unavailable means promo context is discarded and registration continues. Enabled completion provisions a code and, for a valid non-self pending code, writes relationship and inviter entitlement atomically. Existing registration result identity plus unique invitee/relationship/event constraints handles retry and competing codes.

Promo prevalidation must not run before the flag decision in a way that blocks disabled registration. No referral state is written before OTP, legal acceptance, and final completion.

### Disable/Credit Barrier

Service-layer checks do not close the recovery race because wallet credit runs in a separate transaction. Add a narrow trusted referral wallet command/repository path that obtains a shared lock on `ReferralFeatureState` inside the wallet mutation transaction immediately before ledger insert. Operational PUT obtains an exclusive lock. Therefore:

- an already guarded registration/credit completes before the disable response; or
- disable wins, and the later operation observes disabled and creates nothing.

The successful PUT response is the external boundary after which no new referral credit starts. Wallet business-event uniqueness still resolves crash-after-commit ambiguity.

### Recovery

Claims filter to `INVITER` and require enabled state. Disabled scheduled/inline runs claim zero. A claim that cannot pass the wallet guard is released to retryable pending; lease identity and event key stay unchanged. Re-enable resumes due obligations with existing backoff and `SKIP LOCKED` concurrency. Historical `WELCOME` rows are retained but inert.

## API and Security Design

### Public

- `GET /v1/app-config`, no auth, returns only `features.referralProgramEnabled`, `no-store`.
- `GET /v1/referrals/me`, authenticated, returns code/link/inviter totals with no eligibility/attached code.
- `GET /v1/referrals/invitations`, authenticated, preserves bounded opaque-cursor history.
- Disabled referral reads return HTTP 503 and stable `FEATURE_DISABLED`; storage failures use retryable `REFERRAL_SERVICE_UNAVAILABLE`.
- `POST /v1/referrals/applications` and its DTO/mapper/contract are removed, not deprecated in place.

### Operational

- `GET /internal/feature-flags/referral-program` reads state.
- `PUT /internal/feature-flags/referral-program` accepts exactly `{enabled:boolean}`.
- Dedicated `REFERRAL_OPERATIONS_TOKEN`, timing-safe bearer comparison, `no-store`, excluded from Swagger.
- Missing/invalid token returns 401 without state; request validation occurs after authentication.
- Same-value PUT does not advance revision; real transition increments once.
- Never log authorization, echo secrets, accept query credentials, or expose operational fields publicly.

### Operator Scripts

Root scripts:

```json
{
  "referral:enable": "node scripts/set-referral-feature.mjs enabled",
  "referral:disable": "node scripts/set-referral-feature.mjs disabled"
}
```

The helper requires `REFERRAL_OPERATIONS_URL` and `REFERRAL_OPERATIONS_TOKEN`, performs strict PUT, validates JSON, then GET-verifies authoritative state. It exits non-zero on every HTTP/network/schema/mismatch failure and never prints the credential. Curl uses the same contract and variables.

## Mobile Design

The referral mockup `docs/design/mockups/06_referral_program_hd.png` was inspected. Keep its share-first hierarchy as visual direction only. Do not restore fixed rewards, purchase prerequisites, full names, or apply-code UI.

- Add a strict typed app-config adapter and one MobX `FeatureAvailabilityStore` with unknown/loading/enabled/disabled/error state.
- Add an RxJS service using `switchMap` for startup and refresh so stale responses cannot win; expose `dispose()`.
- Inject the single store through `App.tsx`, auth composition, referral composition, and navigation; do not duplicate availability in React state or `ReferralStore`.
- Treat unknown/error as hidden. Omit referral route/card/actions and phone-entry promo field unless enabled.
- On enabled to disabled: advance request generation, unsubscribe in-flight referral work, clear referral store, leave an open referral route, clear/persist-null registration promo, and prevent OTP callbacks from sending it.
- Remove signed-in deep-link behavior. Anonymous links only populate editable registration context while availability is enabled.
- A `FEATURE_DISABLED` referral response updates availability to disabled and clears state; public config remains primary authority.
- Re-enable refreshes availability and referral data but never restores discarded promo context.

## File Change Map

Exact filenames may be refined by existing naming conventions during task generation; boundaries below are fixed.

### Existing Files to Modify

- `apps/api/prisma/schema.prisma`
- `apps/api/src/auth/application/registration.service.ts`
- `apps/api/src/config/env.ts`
- `apps/api/.env.example`
- `apps/api/src/referral/referral.module.ts`
- `apps/api/src/referral/application/ports/referral.repository.ts`
- `apps/api/src/referral/application/referral-registration.integration.ts`
- `apps/api/src/referral/application/referral-bonus-delivery.service.ts`
- `apps/api/src/referral/application/referral-recovery.service.ts`
- `apps/api/src/referral/application/referral-provisioning.service.ts`
- `apps/api/src/referral/application/referral-query.service.ts`
- `apps/api/src/referral/domain/referral-types.ts`
- `apps/api/src/referral/domain/referral-errors.ts`
- `apps/api/src/referral/http/referral.controller.ts`
- `apps/api/src/referral/http/dto/referral-request.dto.ts`
- `apps/api/src/referral/http/dto/referral-response.dto.ts`
- `apps/api/src/referral/http/referral-response.mapper.ts`
- `apps/api/src/referral/http/referral-error.filter.ts`
- `apps/api/src/referral/infrastructure/postgres/prisma-referral.repository.ts`
- `apps/api/src/referral/infrastructure/postgres/prisma-referral-registration.integration.ts`
- `apps/api/src/wallet/application/wallet-command.service.ts`
- `apps/api/src/wallet/application/ports/wallet.repository.ts`
- `apps/api/src/wallet/infrastructure/postgres/prisma-wallet.repository.ts`
- `apps/api/src/openapi/generate-openapi.ts` and public OpenAPI contract tests as required by the new controller
- Referral/env/unit/integration tests under `apps/api/src/**` and `apps/api/test/referral-*.integration-spec.ts`
- `apps/mobile/src/App.tsx`
- `apps/mobile/src/api/referral-api.ts`
- `apps/mobile/src/auth/auth-composition-root.ts`
- `apps/mobile/src/auth/services/registration-flow.service.ts`
- `apps/mobile/src/auth/services/otp-flow.service.ts`
- `apps/mobile/src/auth/stores/registration.store.ts`
- `apps/mobile/src/auth/screens/PhoneEntryScreen.tsx`
- `apps/mobile/src/navigation/MainNavigator.tsx`
- `apps/mobile/src/navigation/RootNavigator.tsx`
- `apps/mobile/src/navigation/referral-link-coordinator.ts`
- `apps/mobile/src/referral/referral-composition-root.ts`
- `apps/mobile/src/referral/services/referral-flow.service.ts`
- `apps/mobile/src/referral/stores/referral.store.ts`
- `apps/mobile/src/referral/screens/ReferralScreen.tsx`
- `apps/mobile/src/wallet/screens/WalletScreen.tsx`
- Corresponding mobile specs and `apps/mobile/__tests__/phone-auth-flow.test.tsx`
- Root `package.json`
- `AGENTS.md` managed Spec Kit section

### New Files

- `apps/api/prisma/migrations/20260812000100_add_referral_feature_state/migration.sql`
- `apps/api/prisma/migrations/20260812000200_drop_referral_eligibility/migration.sql`
- API feature-state domain/port/service and Prisma repository files under the existing module layout
- Public app-config controller/DTO and tests
- Operational referral feature controller/DTO/guard and tests
- `scripts/set-referral-feature.mjs` and its focused tests
- `apps/mobile/src/api/app-config-api.ts` and tests
- `apps/mobile/src/features/stores/feature-availability.store.ts` and tests, using the final existing directory convention
- `apps/mobile/src/features/services/feature-availability.service.ts` and tests
- `specs/005-referral-program/contracts/operational-feature-flag.openapi.yaml`

### Files to Delete

- `apps/api/src/referral/application/referral-eligibility.service.ts`
- `apps/api/src/referral/application/referral-eligibility.service.spec.ts`
- `apps/api/src/referral/composition/close-referral-eligibility.ts`
- `apps/mobile/src/referral/screens/ApplyReferralCodeScreen.tsx`
- `apps/mobile/src/referral/screens/ApplyReferralCodeScreen.spec.tsx`

Post-registration methods inside shared application/repository/DTO files are deleted in place. No separate public apply contract file exists; the operation and schemas are removed from `contracts/openapi.yaml` and `openapi.generated.json`. `tasks.md` is not modified by this plan.

## Implementation Stages

These design stages are lettered to avoid ambiguity with the dependency-ordered
implementation phases in `tasks.md`.

### Stage A: Expand Schema and Configuration

1. Add/seed `ReferralFeatureState` default enabled through migration and Prisma schema.
2. Add authoritative read/shared-lock/exclusive-update repository behavior and concurrency tests using independent Prisma clients.
3. Add `REFERRAL_OPERATIONS_TOKEN` env validation/template; remove welcome amount and its tests/default.
4. Verify migration preserves all existing row counts and restarts retain state.

Validation: Prisma generate/validation, env unit tests, focused PostgreSQL migration/state tests.

### Stage B: Registration-Only Inviter Semantics

1. Refactor onboarding to check/lock flag before promo validation/effects.
2. Remove welcome creation and all invitee credit paths.
3. Restrict relationship creation to final registration with `REGISTRATION` channel.
4. Remove application/eligibility services, ports, errors, response fields, and module exports.
5. Refactor provisioning to create stable promo code only.
6. Remove `POST /v1/referrals/applications`; retain registration context edit/remove until completion.

Validation: unit tests, registration no-code/valid/invalid/self, retry and competing-code PostgreSQL tests, explicit absence of welcome/invitee wallet operations, route contract test.

### Stage C: Server Flag Enforcement and Operations

1. Gate public referral queries with authoritative availability and stable errors.
2. Add public app-config response.
3. Gate claims and add trusted wallet-transaction referral credit guard.
4. Add protected operational GET/PUT with idempotent revision semantics.
5. Add root helper/scripts and env documentation.
6. Prove toggle/registration and toggle/recovery lock order on multiple clients.

Validation: operational auth/DTO/unit tests, API contracts, script tests, PostgreSQL race/restart/multi-instance/pause-resume/exactly-once tests.

### Stage D: Mobile Availability and UI Removal

1. Add app-config adapter, MobX availability store, and RxJS refresh/cancellation service.
2. Inject availability into auth/referral composition and navigator observers.
3. Hide every referral entry/screen/action and registration promo input when disabled/unknown.
4. Clear referral and pending registration context on disable; block stale network publication.
5. Delete apply screen/state/API and signed-in deep-link handling.
6. Preserve enabled share/history UI and compare hierarchy against the mapped PNG.

Validation: adapter parser/cancellation, store/service transitions/disposal, navigation/UI visibility, mid-flight disable, OTP promo suppression, signed-in link ignore, logout/session replacement, mobile typecheck/build, visual comparison.

### Stage E: Contract Migration and Cleanup

1. Confirm no runtime query or generated client references `ReferralEligibility`.
2. Prepare the non-cascading contract migration and contracted Prisma schema while retaining legacy enums, channel, relationships, entitlements, and ledger.
3. Run migration, preservation, compatibility, and forward-recovery acceptance in a disposable database before any production drain.
4. Deploy the compatible backend, drain every old API instance, and approve the operational gate immediately before applying the prepared schema contraction.
5. Apply the prepared migration, run post-apply preservation checks, regenerate the public OpenAPI artifact, and complete the targeted acceptance guide.

Validation: forward-recovery rehearsal in a disposable database, row-count/checksum assertions, generated/source OpenAPI diff, and all referral acceptance suites. After contraction, the rehearsal must prove the new binary works with the contracted schema, reject rollback to any binary that reads `ReferralEligibility`, and recover through a corrected forward deployment rather than a down migration or recreation of semantic eligibility data.

## Test Matrix

### Unit

- Flag parsing, state transition/revision, fail-closed errors, strict operational DTO/guard.
- Registration integration creates only inviter entitlement and skips all effects disabled.
- Recovery filters inviter kind and pauses/releases claims.
- Script env, HTTP, response-schema, read-back mismatch, and secret-redaction cases.
- MobX availability/referral/registration transitions and RxJS cancellation/disposal.

### API Contract

- Public app-config safe shape and no-store.
- Removed POST route and removed eligibility/attached-code schemas.
- `FEATURE_DISABLED` on both authenticated referral reads.
- Operational GET/PUT success, repeat, invalid input, missing/wrong credential, unavailable storage.
- OpenAPI source and generated JSON agree.

### PostgreSQL Acceptance and Concurrency

- Default enabled seed, persistence after restart, visibility from at least three clients.
- Registration without code, valid code, invalid code, self-referral, disabled code, retry, and competing completion.
- Toggle races registration in both lock orders with no partial facts.
- Toggle races wallet delivery in both lock orders; successful disable is the no-new-credit boundary.
- Disabled recovery claims/credits none; re-enable delivers one ledger entry exactly once after crash/retry.
- Existing data is unchanged through disable/re-enable and eligibility contraction.

### Mobile

- Unknown/disabled hides navigation, screen, promo input, code/link/history/totals/copy/share.
- Enabled preserves current inviter sharing/history experience.
- Disable clears state, leaves route, cancels stale requests, clears remote/local pending promo, blocks OTP promo.
- Signed-in/disabled deep links are ignored; re-enable does not resurrect context.
- Session replacement/logout cleanup and explicit service disposal.

## Rollout Order

1. Prepare and pass the eligibility contract-migration suite in a disposable database without applying the contraction to a shared environment.
2. Back up and measure referral/wallet data; apply the additive flag migration seeded enabled.
3. Deploy backend supporting authoritative flag, inviter-only registration, removed apply route, paused recovery, public config, and operations API. Use rolling compatibility with eligibility table still present.
4. Configure `REFERRAL_OPERATIONS_TOKEN`, validate curl and package scripts, verify all instances and restart persistence while enabled.
5. Deploy availability-aware mobile. Old mobile versions may still show entry points, but backend enforcement returns `FEATURE_DISABLED`; new mobile hides them.
6. Exercise disable/enable, recovery, registration, and preservation acceptance in a controlled environment.
7. Drain old backend binaries, record and approve the pre-application gate, then apply the already tested eligibility contract migration.
8. Run post-apply preservation checks, regenerate/verify contracts, and complete production monitoring checks.

## Rollback Behavior

- The flag defaults enabled for compatibility, but disable it before rollback when new referral writes must stop.
- Backend rollback is allowed only to a binary compatible with the additive table and explicitly approved not to reintroduce forbidden welcome/apply effects.
- Mobile rollback cannot override server enforcement; old UI may expose dead entry points, so prefer forward fix.
- Do not reverse wallet credits, rewrite entitlements/relationships, delete promo codes, remove legacy enum values, or run destructive data down migrations.
- If eligibility contraction has run, do not roll back to a binary that reads the table; restore application forward, not by recreating semantic eligibility data.

## Risks and Controls

| Risk | Control |
|---|---|
| Credit commits after disable | Shared flag lock inside trusted wallet transaction; exclusive toggle lock; concurrency acceptance tests. |
| Registration partially creates relationship | Shared flag lock and relationship/entitlement in existing serializable completion transaction. |
| Multi-instance stale state | PostgreSQL read per operation, no authoritative process cache, no-store public refresh. |
| Crash between wallet and entitlement completion | Stable event key, immutable ledger, replay reconciliation after re-enable. |
| Legacy welcome delivery | Recovery query explicitly filters `INVITER`; legacy rows retained inert and tested. |
| Rolling deploy reads dropped eligibility | Separate contract migration only after old instances are drained. |
| Mobile stale request reveals data | RxJS switchMap/unsubscribe plus MobX generation invalidation and clear-on-disable. |
| Pending promo survives disable | Availability reaction clears local and authorized server registration context; OTP getter fail-closed. |
| Operator credential leak/escalation | Dedicated env secret, timing-safe bearer comparison, Swagger exclusion, no logs/query tokens/public fields. |
| Script reports false success | Strict status/schema validation plus authenticated GET read-back and non-zero exit. |

## Post-Design Constitution Re-check

The design still passes every constitution gate. The only schema contraction is isolated after a compatible rollout and preserves all accounting facts. The only new security authority is a dedicated minimal operational bearer boundary. MobX and RxJS remain the sole long-lived mobile state/workflow owners. No broad abstraction, new dependency, destructive history rewrite, or unresolved clarification is introduced.

## Deferred Work

- `tasks.md` regeneration via a separate `speckit-tasks` run.
- Any generic multi-feature flag platform; this plan implements the one required durable flag without preventing later extraction.
- Removal of legacy `WELCOME`/`POST_REGISTRATION` enum values or channel audit data; intentionally out of scope because historical rows may reference them.

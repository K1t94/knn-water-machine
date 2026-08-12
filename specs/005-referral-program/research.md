# Research: Referral Program Scope Revision

**Date**: 2026-08-12
**Spec**: `specs/005-referral-program/spec.md`

All technical questions are resolved. The specification is the requirements source; the repository is the source for current implementation state.

## R1. Existing-State Migration, Not Greenfield Work

**Decision**: Refactor the implemented referral module in place. Preserve promo-code, relationship, entitlement, wallet-boundary, pagination, masking, lease, and retry foundations; remove welcome creation and post-registration application/eligibility paths.

**Rationale**: The code already has durable uniqueness and idempotent wallet event keys. Replacing it would increase migration and duplicate-credit risk.

**Alternatives considered**: A parallel v2 module was rejected because two active referral paths would be hard to gate and reconcile. Adding new behavior beside stale behavior was rejected because it would leave contradictory APIs and states.

## R2. Persistent Runtime Flag

**Decision**: Add a dedicated singleton `ReferralFeatureState` row in PostgreSQL through Prisma. The row has fixed key `REFERRAL_PROGRAM`, `enabled`, monotonically increasing `revision`, and `updatedAt`. The migration inserts it as enabled and uses an upsert so existing deployments preserve current behavior.

Every protected business operation reads the database; the flag is not cached in process memory. Public availability may be HTTP-cached only with `Cache-Control: no-store`, so each refresh observes authoritative storage.

**Rationale**: PostgreSQL is already mandatory, durable, shared by API instances, and supports transactions and locks. This satisfies restart persistence and multi-instance consistency without Redis pub/sub or a new service.

**Alternatives considered**: Environment variables and mobile constants require restart/release. Per-instance memory is inconsistent. Redis adds a dependency and persistence semantics not needed here. A generic feature-flag platform is disproportionate for one flag.

## R3. Flag Failure Semantics

**Decision**: Referral behavior fails closed when the flag row cannot be read. Public availability reports `referralProgramEnabled: false` only when an authoritative disabled row is read; storage failures return retryable `503`, and mobile treats unknown/error as unavailable and hides referral UI. Registration itself continues; if the flag cannot be authoritatively read at completion, it skips referral effects and clears pending promo context rather than failing account creation.

**Rationale**: This prevents accidental bonuses and UI exposure while preserving the primary registration flow. It also avoids misrepresenting a database outage as a durable operator decision.

**Alternatives considered**: Defaulting enabled on read errors risks uncontrolled awards. Failing registration violates the specification. Returning `false` on server failure prevents clients from distinguishing an outage from a deliberate disable.

## R4. Toggle Linearization and Races

**Decision**: Use the singleton row as the database serialization point. Referral relationship/entitlement creation and recovery claim acquisition take a shared lock on the enabled row within their transaction. Add a narrow trusted wallet method for referral credit that takes the same shared row lock inside the wallet ledger transaction immediately before the idempotent ledger insert. The operational update takes an exclusive lock, changes `enabled/revision`, and returns only after earlier shared-lock holders complete. Claimed work is returned to retryable pending state when disabled.

The toggle response is the external linearization boundary: work that already held the shared lock may complete before the disable response; no new relationship, entitlement, claim, or credit may start after that response. Stable wallet business-event keys and unique constraints cover crash/retry ambiguity.

**Rationale**: This gives precise semantics across API instances without a distributed cache. A service-layer precheck alone is insufficient because the existing wallet credit uses its own transaction. The wallet remains the sole ledger writer; the new trusted method only adds the feature-state guard. Tests must pause at lock/check hooks to prove both orderings.

**Alternatives considered**: A bounded cache or service-layer recheck cannot give the required post-toggle boundary. Holding a database transaction open across arbitrary network I/O was rejected. Cancelling historical obligations was rejected.

## R5. Registration-Only Application

**Decision**: Keep pending promo context only in the existing registration flow. Prevalidation remains privacy-safe, but durable referral work runs only in successful registration completion after OTP and legal acceptance. Within that transaction, check enabled state, provision the new user's stable promo code, and optionally create one `REGISTRATION` relationship plus one `INVITER` entitlement. Disabled/unknown state creates neither and does not retain the supplied code.

Repeated registration completion uses the existing registration completion identity plus database uniqueness (`inviteeUserId`, relationship entitlement, wallet event key). Competing codes have one durable winner; retries return the stored result.

**Rationale**: The current registration integration already runs at the correct lifecycle boundary. Removing its welcome branch and post-registration service narrows rather than replaces the transaction.

**Alternatives considered**: Applying at OTP verification is premature because legal acceptance can remain incomplete. Applying after commit creates a relationship/registration split. Keeping an authenticated apply endpoint conflicts with the specification.

## R6. Legacy Schema and Historical Data

**Decision**: Use two migrations. The expand migration adds/seeds the feature-state row and leaves `ReferralEligibility` available for rolling compatibility. After all old API instances are drained and the new backend no longer reads or writes eligibility, a contract migration drops the `ReferralEligibility` table and its user relation. It is transient permission state, not an accounting fact, and is no longer meaningful. Do not cascade to users, relationships, entitlements, or wallet rows.

Retain `ReferralApplicationChannel.POST_REGISTRATION` and `ReferralBonusKind.WELCOME` as legacy-only enum values. Retain all historical relationships and entitlement rows unchanged. New code writes only `REGISTRATION` and `INVITER`; queries and recovery are explicitly scoped to inviter entitlements. Historical delivered welcome wallet entries remain immutable. Undelivered legacy welcome entitlements are retained for audit but are not claimed by the revised referral recovery path.

**Rationale**: Removing enum values in PostgreSQL while rows may reference them requires destructive rewrites and provides no product value. Dropping eligibility removes operationally stale state safely because relationship and ledger facts live elsewhere.

**Alternatives considered**: Dropping all legacy columns/enums risks historical loss. Keeping eligibility indefinitely invites accidental reuse. Converting welcome rows to inviter rows would falsify audit history.

## R7. Bonus Configuration

**Decision**: Remove `REFERRAL_WELCOME_BONUS_ML` from env schema, defaults, templates, services, and tests. Keep and validate only `REFERRAL_INVITER_BONUS_ML`; copy its value into each entitlement at creation.

**Rationale**: Only the inviter amount remains configurable, while storing the awarded amount preserves audit behavior after configuration changes.

**Alternatives considered**: Setting welcome to zero retains dead configuration and invalid zero-value semantics. Deleting the historical entitlement amount would damage auditability.

## R8. Operational HTTP Security

**Decision**: Add an OpenAPI-excluded controller at `GET` and `PUT /internal/feature-flags/referral-program`. Protect both with a dedicated `REFERRAL_OPERATIONS_TOKEN` supplied as `Authorization: Bearer ...`, compared using the existing SHA-256 plus `timingSafeEqual` pattern. Require the token in staging/production; an absent/invalid token returns `401` with no state. Validate PUT strictly as `{ "enabled": boolean }`; reject extra fields. Do not accept actor identity from clients or log the token/body headers.

The PUT is idempotent: setting the current value returns the same state and does not advance `revision`; a real transition increments it. Responses contain only `key`, `enabled`, `revision`, and `updatedAt`.

**Rationale**: This matches the existing internal metrics boundary while separating operational authority from metrics credentials. Excluding the endpoint from the public generated API prevents accidental client exposure.

**Alternatives considered**: Reusing access JWTs grants end users the wrong authority. Reusing the metrics token unnecessarily couples privileges. Query-string secrets leak through logs.

## R9. Curl and Root Package Commands

**Decision**: Add `scripts/set-referral-feature.mjs` and root scripts `referral:enable` and `referral:disable`. The script reads `REFERRAL_OPERATIONS_URL` and `REFERRAL_OPERATIONS_TOKEN`, sends strict JSON PUT with Node's built-in `fetch`, fails on non-2xx/malformed responses, then performs authenticated GET read-back and exits non-zero unless the authoritative value matches. Curl examples use `--fail-with-body --silent --show-error` and the same environment variables.

**Rationale**: A checked-in Node helper is portable in the repository's required Node 24 runtime and can reliably parse and verify state. No shell quoting or secret is embedded in `package.json`.

**Alternatives considered**: Inline curl scripts are platform-dependent and awkward to verify. Adding a CLI dependency is unnecessary.

## R10. Public Availability and Disabled Errors

**Decision**: Add unauthenticated `GET /v1/app-config` returning `{ "features": { "referralProgramEnabled": boolean } }` with `Cache-Control: no-store`. This endpoint contains no operational revision, timestamps, or configuration values. Authenticated `GET /v1/referrals/me` and `/invitations` return HTTP `503` with the standard public envelope and code `FEATURE_DISABLED` when authoritatively disabled. The removed POST apply endpoint returns the normal route-not-found behavior because it no longer exists.

**Rationale**: Registration UI needs availability before authentication, and an app-config envelope is extensible without exposing operational state. A stable 503 code is explicit and retryable after operator re-enable.

**Alternatives considered**: An authenticated-only endpoint cannot gate registration UI. Returning empty referral data would conflate disabled and no-history states. `404` was rejected because clients need a stable disabled result.

## R11. Recovery Pause and Resume

**Decision**: Claim only `INVITER` entitlements while enabled. On disabled state, scheduled and inline recovery claim zero rows. A worker that loses the race after claiming rechecks before wallet credit and releases the lease back to pending without incrementing business identity. On re-enable, the existing lease/backoff worker resumes; wallet event uniqueness makes delivery exactly once.

**Rationale**: Durable entitlements are obligations and must survive the pause. Deleting them or marking permanent failure would violate recovery requirements.

**Alternatives considered**: Letting already claimed jobs deliver after disable contradicts the successful-toggle boundary. Creating a second paused status is unnecessary because pending plus leases already model resumable work.

## R12. Mobile State and Cancellation

**Decision**: Add a typed app-config adapter, a MobX `FeatureAvailabilityStore`, and an RxJS-backed service using `switchMap` for startup/refresh/session replacement. Unknown/loading/error fail closed in presentation. Inject the single availability owner through `App.tsx`, auth composition, referral composition, and navigators.

On enabled to disabled, cancel/invalidate referral requests, clear `ReferralStore`, clear pending registration promo (and persist null when authorized), hide the promo field and all referral navigation/content/actions, and leave an open referral route. Signed-in referral deep links are ignored. `FEATURE_DISABLED` responses also invalidate visible referral state. Re-enable reloads server data but never resurrects an old pending code.

**Rationale**: This follows the project's MobX ownership and RxJS cancellation rules and extends existing generation-token protection rather than duplicating state in React.

**Alternatives considered**: React-local flags duplicate state. Build-time constants are not authoritative. Merely disabling buttons leaks stale data and violates the UI requirement.

## R13. OpenAPI Source and Generated Artifact

**Decision**: Keep public endpoints in `contracts/openapi.yaml`; place the excluded internal controller contract in `contracts/operational-feature-flag.openapi.yaml`. Update `openapi.generated.json` to the intended public surface and regenerate it from Nest decorators during implementation to detect drift. Delete apply DTO schemas and eligibility fields from both public artifacts.

**Rationale**: Public and privileged API boundaries should be reviewed separately, while source and generated public contracts must agree.

**Alternatives considered**: Publishing operational routes in the mobile-facing OpenAPI increases accidental exposure. Leaving stale generated schemas makes contract tests misleading.

## R14. Rollout and Rollback

**Decision**: Roll out in compatibility order: additive flag migration default-enabled; backend that supports both old stored history and new semantics; operator credentials/scripts; mobile availability gating; validation; then optional disable/enable exercise. Remove eligibility only in the backend-compatible migration window. Do not deploy a mobile version that assumes the public config endpoint before backend availability.

Rollback uses the previous backend only while the additive flag table and retained legacy enum/data remain compatible. Do not roll back to code that creates welcome/apply effects after product cutover unless the business explicitly accepts that behavior. The flag can be disabled before application rollback to prevent new referral effects. Schema rollback must never delete history or reverse wallet entries.

**Rationale**: Default-enabled avoids an accidental outage, while backend-first preserves old mobile behavior until the availability-aware release is deployed.

**Alternatives considered**: Mobile-first produces unknown availability and hidden UI. Destructive down migrations conflict with immutable history.

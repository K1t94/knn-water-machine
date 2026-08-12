# Quickstart: Referral Program Scope Revision

This is the post-implementation validation guide. It intentionally contains no post-registration apply or welcome-bonus scenario.

## Prerequisites

- Node 24 and pnpm from the root `package.json`.
- PostgreSQL and Redis integration services running.
- Expand and contract migrations applied in the rollout order from `plan.md`.
- API configured with only the inviter amount and a dedicated operations credential.

```dotenv
REFERRAL_INVITER_BONUS_ML=5000
REFERRAL_OPERATIONS_TOKEN=<base64url-secret-at-least-32-bytes>
```

The root operator helper also requires:

```bash
export REFERRAL_OPERATIONS_URL=http://localhost:3000
export REFERRAL_OPERATIONS_TOKEN='<secret>'
```

`REFERRAL_OPERATIONS_URL` is a client-side script variable, not an API secret. Never commit the token. `REFERRAL_WELCOME_BONUS_ML` must not exist in the revised env contract.

## Minimal Automated Validation

```bash
pnpm --filter @kaynann/api typecheck
pnpm --filter @kaynann/mobile typecheck
pnpm --filter @kaynann/api test -- referral
pnpm --filter @kaynann/mobile test -- referral
pnpm --filter @kaynann/api openapi:generate
pnpm --filter @kaynann/api openapi:check
pnpm --filter @kaynann/api test:referral:postgres
pnpm --filter @kaynann/api test:referral:registration
pnpm check:env
pnpm build:api
pnpm build:mobile:js
```

Run targeted tests first; use the broader commands only after the focused suites pass. The implementation phase must use the exact scripts present at that time rather than inventing missing commands.

## Read and Toggle with Curl

Read authoritative state:

```bash
curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer ${REFERRAL_OPERATIONS_TOKEN}" \
  "${REFERRAL_OPERATIONS_URL}/internal/feature-flags/referral-program"
```

Disable:

```bash
curl --fail-with-body --silent --show-error \
  -X PUT \
  -H "Authorization: Bearer ${REFERRAL_OPERATIONS_TOKEN}" \
  -H 'Content-Type: application/json' \
  --data '{"enabled":false}' \
  "${REFERRAL_OPERATIONS_URL}/internal/feature-flags/referral-program"
```

Enable by sending the same request with `{"enabled":true}`. The response must contain `key`, the requested `enabled`, decimal-string `revision`, and `updatedAt`. Repeat the same PUT and verify the state stays the same and revision does not advance.

Unauthorized and validation checks:

```bash
curl --fail-with-body --silent --show-error \
  -H 'Authorization: Bearer wrong-token' \
  "${REFERRAL_OPERATIONS_URL}/internal/feature-flags/referral-program"

curl --fail-with-body --silent --show-error \
  -X PUT \
  -H "Authorization: Bearer ${REFERRAL_OPERATIONS_TOKEN}" \
  -H 'Content-Type: application/json' \
  --data '{"enabled":"false","extra":true}' \
  "${REFERRAL_OPERATIONS_URL}/internal/feature-flags/referral-program"
```

Both commands must exit non-zero; a subsequent authorized GET must show unchanged state.

## Toggle with Root Package Scripts

```bash
pnpm referral:disable
pnpm referral:disable
pnpm referral:enable
pnpm referral:enable
```

Each command must PUT the requested value, perform an authenticated GET read-back, print only non-secret state, and exit non-zero on missing env, network error, non-2xx, malformed body, or state mismatch. Test failure handling with an unreachable URL and wrong token; neither case may print the token.

## Public Availability

```bash
curl --fail-with-body --silent --show-error \
  "${REFERRAL_OPERATIONS_URL}/v1/app-config"
```

Expected shape is exactly the public app-config envelope with `features.referralProgramEnabled`; it must not include revision, timestamps, amounts, credentials, or internal configuration. Toggle from another API instance and poll this endpoint on at least three instances. All must reflect the new state within the specification's five-second bound. Restart all instances and verify the last state persists.

## Registration Scenarios

Use the existing OTP/legal acceptance test helpers and capture wallet/relationship/entitlement row counts before each scenario.

1. Enabled, no promo: registration succeeds; stable user promo is provisioned; no relationship, entitlement, or referral wallet operation is created.
2. Enabled, valid other-user promo: registration succeeds; one `REGISTRATION` relationship, one `INVITER` entitlement, and one inviter wallet credit exist; invitee wallet has no referral credit.
3. Enabled, invalid or self promo: the registration flow returns the specified privacy-safe validation outcome and creates no referral fact.
4. Replace/remove pending promo before completion: only the final context is considered.
5. Retry the same completion and race competing valid codes: one relationship, one inviter entitlement, and one wallet credit maximum.
6. Disabled, valid/invalid/self promo: registration and session issuance succeed; no promo validation leak, relationship, entitlement, or wallet credit occurs; re-enable does not apply the old code.
7. Inspect new rows and prove there is no new `WELCOME` entitlement and no invitee referral ledger entry.

Verify POST `/v1/referrals/applications` is absent and authenticated deep-link/application attempts cannot retain or apply a code. Verify no purchase event calls an eligibility-close command.

## Disabled Public Referral API

With the flag disabled, call authenticated `GET /v1/referrals/me` and `GET /v1/referrals/invitations`. Both must return `503` with public code `FEATURE_DISABLED`, `Cache-Control: no-store`, and no referral data. Registration endpoints remain available.

Re-enable and verify the same user sees the preserved code, total, and history. Compare database counts before/after the disabled interval: codes, relationships, inviter entitlements, and wallet entries must be unchanged.

## Recovery and Toggle Races

Create an inviter entitlement whose wallet delivery is pending using a controlled integration fixture.

1. Disable before claim: worker claims zero and wallet is unchanged.
2. Claim, pause before guarded wallet transaction, then disable: disable wins or waits according to lock order; after the successful disable response, no credit starts.
3. Re-enable and run concurrent workers: exactly one ledger entry is linked and entitlement becomes delivered.
4. Simulate wallet commit followed by referral completion failure, disable, then re-enable: idempotent replay links the original ledger entry without a second credit.
5. Race registration transaction and toggle in both lock orders: the completion is wholly enabled or wholly disabled, never a partial relationship without entitlement.

Run these against PostgreSQL with two independent Prisma clients/API instances. In-memory fakes do not prove the concurrency contract.

## Mobile Acceptance

Compare the enabled referral screen with `docs/design/mockups/06_referral_program_hd.png` for hierarchy only. Do not restore its illustrative reward, purchase prerequisite, full names, or stale apply action.

1. Enabled: referral navigation/card, screen, code/link, inviter total/history, copy, share, and registration promo input are available.
2. Disabled before launch: none of those elements or routes is visible; registration continues without a promo field.
3. Enabled to disabled while the screen/request is active: leave the route, clear visible state, cancel/invalidate requests, and prove a late response cannot repopulate it.
4. Disable during registration: clear pending promo locally and through registration context when authorized; OTP payloads no longer carry it.
5. Open a referral link signed in: ignore it with no storage or apply UI. Open while anonymous and disabled/unknown: do not retain it.
6. Re-enable and refresh: referral navigation/data return, but previously discarded pending promo does not.
7. Logout/session replacement: dispose subscriptions and clear referral data independently of the flag.

## Historical Data and Migration

Before and after migrations/toggles, record counts for promo codes, relationships by channel, entitlements by kind/status, and referral wallet entries.

- The expand migration seeds enabled and changes no historical count.
- The application cutover creates only `REGISTRATION`/`INVITER` facts.
- Legacy delivered `WELCOME` rows and wallet entries remain unchanged.
- Legacy undelivered `WELCOME` rows remain stored and are not claimed.
- The later eligibility contract migration drops only transient eligibility rows; no cascade or count change is allowed in users, codes, relationships, entitlements, or wallet ledger.

## Rollback Exercise

Disable referrals, stop new instances, and roll application code back only to a schema-compatible version. Do not run a destructive down migration or compensate credits. Confirm the feature-state and historical tables remain readable. Re-enable only if the rolled-back binary is explicitly approved not to recreate welcome or post-registration behavior.

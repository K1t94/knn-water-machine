# Data Model: Referral Program Scope Revision

**Date**: 2026-08-12
**Spec**: `specs/005-referral-program/spec.md`

## Active Enums

### ReferralFeatureKey

- `REFERRAL_PROGRAM`: the singleton runtime switch.

### ReferralApplicationChannel

- `REGISTRATION`: the only value new code may write.
- `POST_REGISTRATION`: retained as legacy-only PostgreSQL data for existing relationships; no active command accepts it.

### ReferralBonusKind

- `INVITER`: the only value new code may write or revised recovery may claim.
- `WELCOME`: retained as legacy-only audit data; no creation or revised recovery path uses it.

### ReferralBonusDeliveryStatus

- `PENDING`, `PROCESSING`, `DELIVERED`, `PERMANENT_FAILURE`: unchanged lease/delivery lifecycle.

## Entities

### ReferralFeatureState

Authoritative singleton used by API, registration, recovery, wallet, and operators.

| Field | Type | Rules |
|---|---|---|
| `key` | enum/string | Primary key; exactly `REFERRAL_PROGRAM` |
| `enabled` | boolean | Seeded `true`; server authoritative |
| `revision` | bigint | Starts at `1`; increments only when value changes |
| `updatedAt` | timestamptz | Database timestamp of the accepted transition |

Invariants:

- One row exists after the expand migration.
- Reads and updates use the same PostgreSQL primary/authoritative connection.
- Idempotent PUT of the current value does not increment `revision`.
- Referral write and wallet-credit boundaries obtain a shared lock on this row; toggle obtains an exclusive lock.
- Credentials and caller-supplied actor metadata are never stored in this entity.

### ReferralPromoCode

| Field | Type | Rules |
|---|---|---|
| `userId` | UUID | Primary key and restricted FK to `User` |
| `code` | varchar(12) | Unique canonical public code |
| `createdAt` | timestamptz | Immutable creation time |

Each registered user has at most one stable code. Provisioning creates missing codes without relationships, entitlements, or wallet effects. Existing codes survive disable/enable. A code is exposed only while enabled.

### ReferralRelationship

| Field | Type | Rules |
|---|---|---|
| `id` | UUID | Primary key |
| `sequence` | bigint | Unique pagination tie-breaker |
| `inviterUserId` | UUID | Restricted FK to owner of the accepted code |
| `inviteeUserId` | UUID | Unique restricted FK; at most one inviter |
| `channel` | enum | New value always `REGISTRATION`; legacy values retained |
| `appliedAt` | timestamptz | Assigned on durable registration completion |
| `createdAt` | timestamptz | Audit timestamp |

Relationships are immutable after insert. New insertion requires an enabled shared-lock scope and creation of its inviter entitlement in the same transaction. Self-referral is rejected without revealing owner details.

### ReferralBonusEntitlement

| Field | Type | Rules |
|---|---|---|
| `id` | UUID | Primary key and stable retry identity |
| `kind` | enum | New rows are `INVITER`; `WELCOME` is legacy-only |
| `beneficiaryUserId` | UUID | Inviter for all new rows |
| `relationshipId` | UUID/null | Unique and required for all new inviter rows |
| `amountMl` | bigint | Positive whole ml copied at creation |
| `walletBusinessEventKey` | varchar(200) | Unique stable wallet idempotency key |
| `walletOperationKind` | varchar(64) | Trusted referral bonus operation |
| `walletSource` | varchar(64) | Trusted referral source |
| `occurredAt` | timestamptz | Relationship registration completion time |
| `status` | delivery enum | Durable delivery lifecycle |
| `walletLedgerEntryId` | UUID/null | Unique link after delivery |
| `attemptCount` | integer | Monotonic claim count |
| `nextAttemptAt` | timestamptz | Retry scheduling boundary |
| `leaseOwner` | UUID/null | Current worker claim |
| `leaseExpiresAt` | timestamptz/null | Stale claim recovery |
| `lastErrorCode` | varchar(64)/null | Safe diagnostic code |
| `deliveredAt` | timestamptz/null | Successful delivery timestamp |
| `createdAt`, `updatedAt` | timestamptz | Audit timestamps |

Invariants:

- Exactly one new inviter entitlement exists per relationship.
- No entitlement is created for the invitee and no welcome entitlement is created.
- Revised recovery claims only `INVITER` rows.
- Wallet credit occurs only through the trusted flag-guarded wallet command.
- A repeated wallet event produces the same ledger entry, never another credit.
- Existing delivered and undelivered legacy `WELCOME` rows remain unchanged; revised recovery leaves undelivered legacy rows inert.

### WalletLedgerEntry

Existing immutable accounting fact. Referral code may request only a trusted inviter credit; it cannot mutate balances directly. `businessEventKey` uniqueness provides exactly-once financial effect despite retries or crashes.

### Registration Pending Promo Context

Existing short-lived registration state, not a referral attachment.

| Field | Type | Rules |
|---|---|---|
| `pendingPromoCode` | string/null | Canonicalized, replaceable/removable before completion |

It is considered only after OTP, mandatory legal acceptance, and successful registration completion. Disabled or unavailable authoritative state causes it to be discarded with no deferred or retroactive effect. It is absent from completed-user referral models.

### ReferralInvitation Projection

Read model derived only from `DELIVERED` `INVITER` entitlements joined to relationships.

- Stable public invitation id.
- Masked invitee label revealing at most the final two phone digits.
- `appliedAt`, `CREDITED`, and exact credited `amountMl`.
- Ordered by `(relationship.sequence DESC, relationship.id DESC)` with an opaque cursor.
- No eligibility, attached-code, wallet event, internal user id, lease, or feature revision fields.

## Removed Active Entity

### ReferralEligibility

No eligibility exists after registration. Application code, purchase-close commands, response fields, and provisioning writes are removed first. The table is retained only during rolling deployment and then dropped by a non-cascading contract migration. It has no historical accounting authority.

## State Transitions

### Registration Completion

1. Registration has verified phone and accepted mandatory legal documents.
2. Serializable completion transaction locks/reads `ReferralFeatureState`.
3. Provision the user's stable promo code idempotently.
4. If disabled or state cannot be authoritatively read, create no referral effect and consume pending context.
5. If enabled with no pending code, create no relationship or entitlement.
6. If enabled with a valid non-self code, insert one immutable relationship and one `INVITER` entitlement atomically.
7. Commit registration; delivery occurs after commit and remains recoverable.

### Feature Toggle

1. Guard authenticates the operator and DTO validation accepts exactly one boolean.
2. Transaction obtains exclusive lock on `ReferralFeatureState`.
3. Same-value request returns unchanged row; changed value increments revision and timestamp.
4. The response is returned only after earlier guarded referral side effects finish.
5. All instances observe the row on their next operation/config refresh.

### Recovery

`PENDING -> PROCESSING -> DELIVERED` on successful trusted wallet credit. Temporary failure or observed disable releases/schedules the same obligation for retry. Permanent wallet-domain failure uses `PERMANENT_FAILURE`. Expired leases may be reclaimed. Disabled state yields no new claims or credits; re-enable resumes the same identities.

## Migration Plan and Historical Impact

### Expand Migration

- Create `ReferralFeatureState` with key/boolean/revision/timestamp constraints.
- Insert `REFERRAL_PROGRAM = true` idempotently.
- Do not update or delete existing referral or wallet rows.

### Application Cutover

- Stop reading/writing `ReferralEligibility`.
- Stop creating or claiming `WELCOME` entitlements.
- Stop writing `POST_REGISTRATION` relationships.
- Preserve existing enum values, channel column, entitlements, relationships, and ledger entries.

### Contract Migration

- After all old API instances are drained, drop `ReferralEligibility` and its indexes/constraints without cascade.
- Keep legacy enum values and immutable historical facts.
- Verify row counts and wallet ledger checksums before and after; eligibility row removal must not change any user, relationship, entitlement, wallet, or promo-code count.

Rollback never reverses wallet entries or deletes historical facts. The additive feature-state table may remain if application code rolls back; disable the feature before rolling back to binaries that could recreate removed behavior.

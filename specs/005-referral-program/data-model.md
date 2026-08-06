# Data Model: Referral Program

## Representation Rules

- Water amounts use PostgreSQL `bigint` and TypeScript `bigint`. Public JSON
  represents millilitres as canonical non-negative decimal strings.
- Promo codes are canonical uppercase ASCII and are never derived from a phone,
  user ID, or database sequence.
- Referral relationships and promo ownership are immutable. Delivery metadata
  is mutable only through the referral repository.
- All timestamps are timezone-aware PostgreSQL timestamps and ISO 8601 UTC in
  public responses.
- Database constraints are authoritative for uniqueness and concurrency.

## Enums

### ReferralApplicationChannel

- `REGISTRATION`: the code was confirmed during registration completion.
- `POST_REGISTRATION`: an authenticated user explicitly applied the code.

### ReferralEligibilityStatus

- `OPEN`: a promo may still be attached.
- `ATTACHED`: an immutable relationship exists.
- `CLOSED`: a future successful-purchase event permanently closed eligibility.

Only `OPEN -> ATTACHED` and `OPEN -> CLOSED` transitions are valid.

### ReferralBonusKind

- `WELCOME`: the one welcome entitlement for a newly registered user.
- `INVITER`: the one inviter entitlement for a confirmed relationship.

The invitee receives no separate referral entitlement.

### ReferralBonusDeliveryStatus

- `PENDING`: due or scheduled for a wallet delivery attempt.
- `PROCESSING`: claimed by a worker with a bounded lease.
- `DELIVERED`: wallet accepted the exact immutable command facts.
- `PERMANENT_FAILURE`: immutable data conflicts with an existing wallet event or
  is otherwise non-retryable; operator intervention is required.

Technical delivery states are never returned by the public API.

## ReferralPromoCode

| Field | Storage | Rules |
| --- | --- | --- |
| `userId` | UUID PK/FK | Exactly one code per user; `ON DELETE RESTRICT` |
| `code` | `varchar(12)` | Canonical alphabet, globally unique |
| `createdAt` | timestamptz | Set once |

SQL supplements Prisma with a code-format `CHECK` and a trigger rejecting
`UPDATE` and `DELETE`. Ownership can therefore neither move nor change.

## ReferralEligibility

| Field | Storage | Rules |
| --- | --- | --- |
| `userId` | UUID PK/FK | One state row per provisioned user |
| `status` | enum | `OPEN`, `ATTACHED`, or `CLOSED` |
| `closedByEventKey` | `varchar(200)` nullable | Globally unique when present |
| `closedAt` | timestamptz nullable | Set with a successful close |
| `createdAt` | timestamptz | Creation time |
| `updatedAt` | timestamptz | Last valid transition |

Checks require both closure fields only for `CLOSED`. A transition trigger
rejects reversal, deletion, owner changes, and all transitions except
`OPEN -> ATTACHED` or `OPEN -> CLOSED`. `ATTACHED` is also backed by the unique
relationship invitee key. A user can therefore have no inviter while being
permanently ineligible.

## ReferralRelationship

| Field | Storage | Rules |
| --- | --- | --- |
| `id` | UUID PK | Safe public invitation identity |
| `sequence` | identity `bigint` | Globally unique ordering cursor |
| `inviterUserId` | UUID FK | Indexed owner of invitation history |
| `inviteeUserId` | UUID FK/unique | At most one inviter per invitee |
| `channel` | enum | Registration or post-registration |
| `appliedAt` | timestamptz | Database-assigned insertion time persisted only by the transaction that successfully creates the relationship; never caller-supplied |
| `createdAt` | timestamptz | Persistence time |

Foreign keys use `ON DELETE RESTRICT`; a `CHECK` rejects self-referral. A trigger
rejects every `UPDATE` and `DELETE`. The history index is
`(inviterUserId, sequence DESC)`. The public invitee label is computed from the
current phone as fixed text `**` plus at most its last two digits; the phone and
both user IDs are never serialized.

`appliedAt` is assigned by the database default when the relationship row is
inserted. Same-code replay reads that persisted value; application and HTTP
commands cannot provide or replace it.

## ReferralBonusEntitlement

| Field | Storage | Rules |
| --- | --- | --- |
| `id` | UUID PK | Stable delivery identity |
| `kind` | enum | `WELCOME` or `INVITER` |
| `beneficiaryUserId` | UUID FK | Wallet owner to credit |
| `relationshipId` | UUID FK nullable/unique | Required only for `INVITER` |
| `amountMl` | `bigint` | Immutable positive captured amount |
| `walletBusinessEventKey` | `varchar(200)` unique | `referral_bonus:<id>` |
| `walletOperationKind` | `varchar(64)` | Captured wallet command classifier |
| `walletSource` | `varchar(64)` | `REFERRAL_PROGRAM` |
| `occurredAt` | timestamptz | Captured wallet command time |
| `status` | enum | Delivery state |
| `walletLedgerEntryId` | UUID FK nullable/unique | Present after delivery |
| `attemptCount` | integer | Non-negative claim count |
| `nextAttemptAt` | timestamptz | Retry scheduling time |
| `leaseOwner` | UUID nullable | Current worker identity |
| `leaseExpiresAt` | timestamptz nullable | Bounded claim expiry |
| `lastErrorCode` | `varchar(64)` nullable | Redacted diagnostic classifier |
| `deliveredAt` | timestamptz nullable | Successful confirmation time |
| `createdAt` | timestamptz | Obligation creation time |
| `updatedAt` | timestamptz | Delivery metadata update time |

Raw SQL adds a partial unique index on `beneficiaryUserId` where
`kind = 'WELCOME'`, guaranteeing one welcome entitlement per user. Unique
`relationshipId` plus checks guarantee one inviter entitlement per relationship
and prohibit a relationship on welcome entitlements. Additional checks enforce
the signed `bigint` range, positive amount, delivery/ledger consistency, and
lease-field consistency.

A trigger rejects deletion and changes to kind, beneficiary, relationship,
amount, wallet key, operation kind, source, occurred time, and creation time.
Only delivery/lease metadata may change. Foreign keys use `ON DELETE RESTRICT`.

Wallet command facts are:

| Entitlement | Operation kind | Source | Amount |
| --- | --- | --- | --- |
| Welcome | `REFERRAL_WELCOME_BONUS` | `REFERRAL_PROGRAM` | Captured welcome config |
| Inviter | `REFERRAL_INVITER_BONUS` | `REFERRAL_PROGRAM` | Captured inviter config |

The stored `occurredAt` is reused on every retry because wallet idempotent replay
compares all immutable command facts, not only the business key.

## Transactional Invariants

### Registration completion

Inside the existing serializable registration transaction:

1. Provision the user's promo and eligibility rows if absent.
2. For a genuinely new user, create the unique welcome entitlement.
3. If a validated pending code exists, lock eligibility, re-resolve the code,
   create the relationship and inviter entitlement, and transition to
   `ATTACHED`.
4. Commit user, legal, session, referral state, and durable obligations
   together. Wallet delivery occurs only after commit.

An existing user completing registration receives provisioning but no
retroactive welcome entitlement.

### Post-registration application

The repository locks the invitee eligibility row `FOR UPDATE`. `OPEN` may create
one relationship and inviter entitlement in one transaction. `ATTACHED` returns
idempotent success only for the same canonical inviter code; a different code
is a conflict. `CLOSED` is a conflict. Unique/check constraints arbitrate races.

### Eligibility closure

The trusted future purchase boundary locks eligibility and transitions only
`OPEN -> CLOSED`, recording its stable successful-purchase event key. Repeating
that key is idempotent. Competing apply and close operations are decided by the
order in which their transactions acquire the row lock and successfully commit.

### Bonus delivery

Relationship or registration transactions create durable obligations, never
wallet rows. After commit, inline delivery and leased recovery both call the
existing wallet application command. The global wallet business-key uniqueness
provides exactly one wallet effect under at-least-once delivery.

## Deterministic Pagination

Invitation history is ordered by `sequence DESC`, then queried with
`sequence < beforeSequence` for the authenticated inviter. The API fetches
`limit + 1`, returns at most `limit`, and emits a cursor only when another page
exists. The opaque base64url cursor payload is:

```json
{ "v": 1, "beforeSequence": "123" }
```

Only relationships whose inviter entitlement is `DELIVERED` appear in the
public total and history. Newer concurrent insertions do not shift an existing
cursor traversal.

## Migration And Provisioning

The reviewed migration creates enums, tables, constraints, partial indexes,
ordinary indexes, and immutability/transition triggers. It creates no promo
rows, relationships, entitlements, eligibility locks, or wallet entries.

After compatible application deployment, `referral:provision` scans existing
users with UUID keyset pagination, supports `--dry-run`, creates only promo and
`OPEN` eligibility rows, retries collisions, and commits bounded batches. It is
idempotent and emits aggregate counts. Authenticated reads lazily repair a
missing pair. Neither path creates a welcome entitlement for pre-feature users.

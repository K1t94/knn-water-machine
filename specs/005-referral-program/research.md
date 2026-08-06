# Research: Referral Program

## Decision 1: Preserve The Existing Registration Boundary

**Decision**: Extend the existing `RegistrationService` serializable Prisma
transaction through a narrow referral onboarding application port that accepts
`Prisma.TransactionClient`. The port provisions the new user's promo code and
eligibility, records the welcome entitlement for a genuinely new user, and,
when a valid pending promo exists, records the relationship and inviter
entitlement. The public registration request, response, session credentials,
OTP, and legal contracts remain unchanged.

Before `beginCompletion`, the service canonicalizes and resolves pending promo
text while the Redis authorization is still `ACTIVE`; malformed, unavailable,
or self-owned codes therefore fail without freezing the user's ability to edit
or remove pending context. The same facts are revalidated and locked inside the
database transaction. New-user identity comes from the stable completion data;
existing-user status comes from the inspected authorization and is verified
against the transaction result.

**Rationale**: Today registration inspects Redis authorization, validates legal
documents, creates stable completion/session identities, and commits user,
legal acceptance, and initial session in one `SERIALIZABLE` PostgreSQL
transaction. Redis is marked `COMPLETED` only after that commit and then removes
phone/promo context. Retrying the same completion key recovers prepared
credentials. Referral records must therefore be committed alongside the
existing database effects and before Redis completion clears the promo.

**Alternatives considered**:

- Process pending promo after registration returns. Rejected because a crash
  could lose the only pending context and FR-030 would be false.
- Put referral logic directly in the auth repository. Rejected because it
  mixes business domains and makes auth responsible for wallet policy.
- Change registration HTTP payloads or credentials. Rejected by FR-033.

## Decision 2: Use Durable Bonus Entitlements, Not A Cross-Module Transaction

**Decision**: Persist each `ReferralBonusEntitlement` in the same PostgreSQL
transaction as the registration or referral relationship that creates the
obligation. Deliver it afterward through the exported `WalletCommandService`
using a stable key `referral_bonus:<entitlement-uuid>`. Perform one bounded
inline delivery attempt after commit and recover all unfinished work with a
PostgreSQL-backed scheduled worker.

**Rationale**: The current `PrismaWalletRepository` always opens its own
`READ COMMITTED` transaction and does not accept an external transaction
client. A single referral/wallet transaction would require widening the wallet
port and coupling registration to wallet persistence and lock ordering. A
durable entitlement is an outbox-style obligation: transaction commit cannot
lose it, while the wallet's globally unique business-event key makes repeated
delivery produce one ledger effect. If the process crashes after wallet credit
but before marking delivery complete, retry returns the original wallet entry.
The normal inline attempt supports the five-second visibility objective; a
temporary wallet failure does not undo an already valid registration.

This is at-least-once delivery with an exactly-once wallet effect. It is not a
distributed transaction and is not described as exactly-once delivery.

**Alternatives considered**:

- Add `creditInTransaction(transaction, command)` and include wallet mutation in
  the registration/referral transaction. This could provide one database
  commit, but it leaks Prisma transaction context across the wallet application
  boundary, expands auth lock ordering, and makes temporary wallet failure block
  session issuance. Rejected for this feature.
- Publish to Redis or add a queue framework. Rejected because PostgreSQL already
  stores the durable obligation and the project already has Nest scheduling;
  a new broker/dependency adds no required guarantee.

## Decision 3: Claim Recovery Work With PostgreSQL Leases

**Decision**: A scheduled worker claims due entitlements in short transactions
with `FOR UPDATE SKIP LOCKED`, changes them to `PROCESSING`, assigns a random
worker/lease identity, and commits before calling wallet. Defaults are a batch
of 25, a 30-second lease, a one-second schedule, and exponential retry delays
bounded between one second and five minutes with jitter. Only one run per
process may overlap. Expired leases are reclaimable after restart.

After wallet success or idempotent replay, a conditional update matching the
lease stores the ledger entry identity and `DELIVERED`. Transient dependency
failures return the entitlement to `PENDING` with the next attempt time.
Conflicting wallet facts or corrupt immutable entitlement data become
`PERMANENT_FAILURE`, emit a high-severity metric/log, and are never silently
presented to a user. Transient work has no finite terminal retry count.

An internal `referral:recover` one-shot command runs the same claim/delivery
service for due or expired work; it does not edit balances or expose HTTP. This
is the supported manual operational retry.

**Rationale**: Leasing permits multiple API instances and restarts without a
second queue. A claim transaction must not remain open during wallet work.
Conditional lease ownership plus wallet idempotency makes stale workers safe.

**Alternatives considered**:

- Keep a transaction open while crediting wallet. Rejected because it holds row
  locks during a second transaction and creates avoidable deadlock/latency risk.
- Mark every failure permanent after a maximum count. Rejected because it can
  lose an obligatory credit during a long outage.

## Decision 4: Use A Separate Immutable Promo-Code Record

**Decision**: Store promo ownership in `ReferralPromoCode`, keyed by `userId`,
instead of adding a required random field directly to `User`. Prevent update and
delete with a migration trigger. New registrations create their code in the
registration transaction.

**Rationale**: A separate record avoids an unsafe non-null random backfill on
the hot user table, keeps referral persistence within its module, and supports
collision retries without changing user identity. One row per user and a unique
canonical code prove stable ownership.

**Alternatives considered**:

- Required `User.promoCode`. Rejected because adding a non-null unique random
  column to existing users complicates migration locking and rollback.
- Derive the code from phone/user ID. Rejected because it is predictable and
  leaks private identity.

## Decision 5: Generate 12-Character CSPRNG Codes

**Decision**: Canonical codes are exactly 12 uppercase ASCII characters from
`23456789ABCDEFGHJKMNPQRSTVWXYZ`. Input is trimmed and uppercased, then must
match that exact alphabet and length. The alphabet excludes visually ambiguous
`0`, `1`, `I`, `L`, `O`, and `U`. Generate with Node `crypto.randomBytes` and
rejection sampling, not modulo-biased `Math.random`. Retry a database unique
collision up to eight times before returning a retryable dependency error.

**Rationale**: Thirty symbols over twelve positions provide about 59 bits of
space without embedding phone/user data. The database unique index remains the
collision authority. Exact parsing limits brute-force input surface; ordinary
API throttling remains an HTTP security concern rather than a property of the
code itself.

Invalid format and syntactically valid unknown code share
`REFERRAL_CODE_UNAVAILABLE`, preventing account-owner enumeration. Self,
attachment conflict, and closed eligibility remain distinct actionable errors.

**Alternatives considered**:

- Short numeric or user-derived codes. Rejected as predictable.
- UUIDs. Rejected as unnecessarily difficult to type/share.
- Case-sensitive codes or separator tolerance. Rejected because they create
  confusing identities and more ambiguous canonicalization.

## Decision 6: Keep The Existing Custom Deep Link

**Decision**: The API returns the canonical link
`kaynann://register?promo=<CANONICAL_CODE>`. A single app-lifecycle listener
parses both the initial URL and later `Linking` events. Signed-out links populate
editable pending registration context. Signed-in links prefill the explicit
apply screen. Neither path applies automatically, and each incoming URL is
consumed once across the auth-to-main transition.

**Rationale**: This preserves the feature-002 route and configured Expo scheme.
There is no configured web domain, associated-domain file, or Android App Link,
so a browser/install fallback cannot honestly be promised.

**Alternatives considered**:

- Universal/App Links. Deferred until a public domain and association-file
  deployment exist.
- Add a second listener inside the authenticated navigator. Rejected because a
  cold-start URL can be processed twice when auth state changes.

## Decision 7: Model Eligibility As OPEN, ATTACHED, Or CLOSED

**Decision**: Give every provisioned user one `ReferralEligibility` row.
`OPEN` permits application, `ATTACHED` means the user already has a relationship,
and `CLOSED` records the stable future successful-purchase event key and time.
Both apply and close commands lock this row `FOR UPDATE`; the transaction that
obtains the lock and commits first determines the outcome.

If apply wins, it creates the relationship/entitlement and changes `OPEN` to
`ATTACHED`; the later purchase command returns `ALREADY_ATTACHED`. If purchase
close wins, it changes `OPEN` to `CLOSED`; later apply returns
`REFERRAL_ELIGIBILITY_CLOSED`. Repeating the same purchase identity is
idempotent. Failed/cancelled/incomplete purchases never call this boundary.

**Rationale**: A separate eligibility row represents a user with no inviter but
permanently closed eligibility and gives both commands one reliable concurrency
lock. Commit order is deterministic and needs no time-window heuristic.

**Alternatives considered**:

- Infer eligibility from absence of a relationship. Rejected because it cannot
  represent a purchase-closed user.
- Compare timestamps after concurrent work. Rejected as race-prone.

## Decision 8: Rely On Relationship Identity For Apply Idempotency

**Decision**: `POST /v1/referrals/applications` does not require an
`Idempotency-Key`. The authenticated invitee identity and unique relationship
are the durable command identity: retrying the attached canonical code returns
`ALREADY_ATTACHED`; a different code returns `REFERRAL_ALREADY_ATTACHED`.
Concurrent attempts serialize on eligibility and database uniqueness.

**Rationale**: A header would require an additional durable request-result
table to add guarantees. The domain itself already has exactly one permanent
result per invitee, so a client key would duplicate rather than strengthen
idempotency.

**Alternatives considered**:

- Require `Idempotency-Key` but do not persist it. Rejected as misleading.
- Persist public request identities. Rejected as unnecessary state for a
  naturally idempotent one-time command.

## Decision 9: Provision Existing Codes With Backfill Plus Lazy Repair

**Decision**: The schema migration creates only empty referral tables,
constraints, indexes, and triggers. A separate idempotent `referral:provision`
command creates promo/eligibility rows for existing users in bounded keyset
batches, retries code collisions, and supports `--dry-run`. Deployment runs the
command before enabling referral UI. Authenticated reads may lazily provision a
missing promo/eligibility pair as a safety net.

Provisioning never creates welcome entitlements, relationships, or wallet
operations. It logs scanned/created/already-present/collision/failure counts and
can be safely rerun. Batch commits avoid a long user-table lock; rollback means
disabling UI and rerunning after correction, not deleting already issued stable
codes.

**Rationale**: Random codes cannot be safely or deterministically generated in
a reviewed SQL migration with application collision policy. A separate command
provides dry-run, bounded locks, observability, and repeatability while lazy
repair prevents a missed row from breaking one user.

**Alternatives considered**:

- SQL migration backfill. Rejected because collision handling and operational
  visibility are poor and migration duration grows with user count.
- Lazy-only provisioning. Rejected because it does not ensure all existing
  registered users are ready before rollout.

## Decision 10: Validate Bonus Configuration At Startup

**Decision**: Add `REFERRAL_WELCOME_BONUS_ML` and
`REFERRAL_INVITER_BONUS_ML` to the existing Zod environment schema. Values are
canonical positive integers in `1..9223372036854775807`, parsed to `bigint` by a
referral configuration provider. Development/test defaults are `10000` and
`5000`. Staging/production require both values explicitly. Missing, zero,
negative, fractional, or out-of-range values fail startup.

Each entitlement stores the parsed amount at creation. Delivery uses that
stored amount; later configuration changes affect only new entitlements. Mobile
never submits an amount. The authenticated summary may expose only the current
inviter reward needed to explain the screen.

**Rationale**: Fail-fast prevents a running instance from creating incomplete
obligations with invalid policy. Exact strings avoid JavaScript number limits.

**Alternatives considered**:

- Disable referral processing while the API otherwise starts. Rejected because
  it creates a partially healthy deployment and ambiguous registration effects.
- Hard-code amounts in mobile or domain code. Rejected by FR-009/FR-020.

## Decision 11: Combine Promo And Summary Reads

**Decision**: Expose three authenticated routes:

- `GET /v1/referrals/me` returns own code/link, eligibility/attachment state,
  current inviter reward for explanation, credited inviter-bonus total, and
  credited invitation count.
- `POST /v1/referrals/applications` explicitly applies one submitted code.
- `GET /v1/referrals/invitations` returns successfully credited invitation
  history with
  opaque cursor pagination.

All responses use `Cache-Control: no-store`, derive owner identity from
`AccessSessionGuard`, and shape explicit DTOs. History contains only a public
relationship UUID, a label revealing at most the last two phone digits,
database-assigned `appliedAt` persisted by the transaction that successfully
creates the relationship and returned unchanged on replay,
`CREDITED`, and exact credited millilitres. Recovery state,
database IDs of either user, full phones, business keys, and wallet fields are
absent.

**Rationale**: Combining promo and summary avoids an extra initial request while
keeping the separately paginated collection bounded. Only `DELIVERED` inviter
entitlements contribute to `creditedInvitationCount`, credited totals, and
`CREDITED` history rows.

**Alternatives considered**:

- Separate promo and summary endpoints. Rejected as redundant for the single
  referral screen.
- Return relationship/delivery internals. Rejected by FR-039.

## Decision 12: Use A Monotonic Sequence Cursor

**Decision**: Give each relationship a database-generated unique `bigint`
sequence and order history by `sequence DESC`, indexed with
`(inviterUserId, sequence DESC)`. The opaque cursor is a bounded base64url
versioned object containing the last canonical decimal sequence. Query with the
authenticated inviter and `sequence < cursor`, fetching `limit + 1`. Default
limit is 20; maximum is 100.

**Rationale**: This matches the implemented wallet-history convention, avoids
timestamp ties and UUID ordering, and gives stable continuation when new rows
arrive. Ownership is always included in the query.

**Alternatives considered**:

- Offset pagination. Rejected because concurrent inserts cause duplicates or
  omissions.
- Sort by delivery time. Rejected because retries would change relationship
  ordering.

## Decision 13: Follow The Existing MobX/RxJS Composition Pattern

**Decision**: Add `ReferralApi`, `ReferralStore`, a disposable
`ReferralFlowService`, and `ReferralCompositionRoot` beside the wallet feature.
Adapters expose cold Observables with abort teardown. The flow reacts to session
identity, cancels work on logout/replacement, checks a session generation before
every mutation, reloads after restoration/login, serializes pagination, and
clears all private state on invalidation. React screens only observe stores and
invoke commands.

Add a minimal authenticated native stack containing `Wallet`, `Referral`, and
`ApplyReferralCode`; do not add bottom tabs or redesign the home experience.

**Rationale**: This is the implemented feature-002/004 architecture and meets
Constitution IX without duplicating state in components.

**Alternatives considered**:

- Component-owned fetch/React state. Rejected because cancellation and identity
  replacement become unreliable.
- Expo Router or a new navigation system. Rejected as a broad migration.

## Decision 14: Add Only Expo Clipboard

**Decision**: Plan one new runtime dependency, Expo SDK 54-compatible
`expo-clipboard` (resolved by `expo install` during implementation), for copying
the exact code. Use React Native's existing `Share` API for text/link sharing.
Wrap both Promise APIs behind a cold Observable native-actions adapter.

**Rationale**: React Native core no longer supplies a supported Clipboard API,
while Expo Clipboard is the SDK-aligned small native module. Core `Share`
already opens the correct system share sheet.

**Alternatives considered**:

- `expo-sharing`: rejected because it shares files, not invitation text.
- `expo-linking`: rejected because existing `Linking` and the API-provided link
  cover the custom-scheme requirement.
- bottom-tabs, icon, SVG, AsyncStorage, or new state dependencies: rejected as
  unnecessary or harmful to server-authoritative session-scoped data.

## Decision 15: Treat The Mockup As Visual Direction Only

**Decision**: Preserve the mockup's back header, strong referral hero, prominent
code card, copy/share action, explanation, total, and history hierarchy using
native responsive components. Do not embed the mockup image. Replace its 20 L,
full names, reward-after-purchase wording, illustrative code/data, and five-tab
navigation with server values, masked labels, relationship-attachment semantics
for apply responses, delivered-only `CREDITED` history, real code, and
native-stack navigation.

**Rationale**: Those mockup details conflict with the approved specification and
AGENTS UI rules.

**Alternatives considered**:

- Pixel-copy the complete screen and business text. Rejected because the mockup
  is demonstrative, not a product contract.

## Decision 16: Require Real PostgreSQL For Persistence Guarantees

**Decision**: Unit tests cover canonicalization, domain errors, configuration,
DTO shaping, worker classification, stores, and flows. HTTP tests cover auth and
public contracts. Opt-in PostgreSQL tests deploy real migrations into isolated
schemas and cover unique/check constraints, triggers, rollback, 100-way races,
lease reclaim/concurrent workers, exactly-once wallet effects, and 250-row
pagination. Redis-backed auth tests cover pending promo/completion recovery.

**Rationale**: Mocks and SQLite cannot prove PostgreSQL row locks,
`SKIP LOCKED`, partial unique indexes, trigger immutability, or transactional
rollback.

**Alternatives considered**:

- Mock-only concurrency tests. Rejected because they test an invented scheduler,
  not database behavior.

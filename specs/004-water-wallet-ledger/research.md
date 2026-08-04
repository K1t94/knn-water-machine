# Research: Water Wallet And Immutable Ledger

## Resolved Technical Context

| Area            | Repository evidence                                                                                      | Planning consequence                                                                                     |
| --------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Runtime/tooling | Node `>=24 <25`, pnpm `11.18.0`, TypeScript `5.9.3`, ESLint `9.39.5`, Prettier `3.9.6`, Vitest `3.2.7`   | Use existing scripts and dependencies; no upgrade or addition is required.                               |
| API             | NestJS `11.1.28`, Prisma `6.19.3`, PostgreSQL 17                                                         | Add one Nest feature module and a reviewed Prisma migration with PostgreSQL-specific SQL.                |
| Mobile          | Expo `54.0.36`, React Native `0.81.5`, React `19.1.0`, MobX `6.16.1`, RxJS `7.8.2`                       | Follow feature-002 cold Observable, MobX store, flow-service, composition-root, and disposal patterns.   |
| Authentication  | `AccessSessionGuard` validates the bearer session and places `sub`/`sid` claims on the request           | Reuse it; never accept a wallet owner in path, query, or body.                                           |
| Persistence     | `PrismaService` is global; Prisma is already isolated in infrastructure repositories                     | Wallet application/domain layers use a port; only the PostgreSQL adapter imports Prisma.                 |
| Tests           | API Vitest collects unit/integration tests; database suites are opt-in with `RUN_POSTGRES_INTEGRATION=1` | Use real PostgreSQL for concurrency and constraints, while keeping fast unit tests available by default. |

## Decision 1: Store A Balance Projection Beside The Ledger

**Decision**: Keep `WaterWallet.balanceMl` as a derivable projection and append a
`WalletLedgerEntry` in the same transaction.

**Rationale**: Public balance reads and conditional debits remain one indexed
row operation regardless of ledger size. The ledger remains immutable audit
truth, while reconciliation can reproduce the projection as signed credits
minus debits. A failed append rolls back the projection update.

**Alternatives considered**:

- Sum the ledger on every read/debit: simplest source of truth but makes a hot
  read and every debit grow with history and complicates concurrent overdraft
  protection.
- Keep only a mutable balance: cannot satisfy audit, idempotency, history, or
  reconciliation requirements.
- Maintain the projection asynchronously: exposes partial state and violates
  atomic visibility.

## Decision 2: Use PostgreSQL `bigint` And Decimal Strings At HTTP Boundaries

**Decision**: Store and calculate `0..9_223_372_036_854_775_807` millilitres in
PostgreSQL `bigint`; use TypeScript `bigint` internally and canonical decimal
strings in JSON.

**Rationale**: Whole-millilitre arithmetic is exact, PostgreSQL rejects overflow,
and decimal strings avoid JavaScript safe-integer and JSON `bigint`
serialization loss. The optional litre display is formatted by decimal string
division with exactly three fractional digits.

**Alternatives considered**:

- JavaScript `number`: loses integer precision above `2^53 - 1` and creates an
  unnecessary second database range.
- Prisma `Decimal`: exact but semantically permits fractional values and adds
  conversion rules the domain does not need.
- Store litres as floating point: directly violates the canonical-unit rule.

## Decision 3: Lazy Physical Wallet Creation

**Decision**: A registered user with no wallet row reads as zero; the first
accepted command creates the row inside the mutation transaction.

**Rationale**: This preserves completed registration behavior, avoids a schema
backfill, and keeps empty history free of a synthetic opening entry. The user
foreign key still prevents a wallet for an unknown user.

**Alternatives considered**:

- Create a wallet during registration: couples feature 004 to security-sensitive
  feature-002 behavior and requires backfilling existing users.
- Backfill all users during migration: creates unnecessary rows and makes
  migration cost proportional to the user table.

## Decision 4: Conditional Atomic Update At `READ COMMITTED`

**Decision**: Within a Prisma interactive transaction, lazily insert the wallet,
lock/verify that the owner remains active, then use one parameterized
`UPDATE ... WHERE ... RETURNING` for credit or debit.

**Rationale**: PostgreSQL 17 documents that `UPDATE` waits for a concurrent
updater and then re-evaluates its `WHERE` clause against the updated row. A debit
predicate `balanceMl >= amountMl` therefore allows only an affordable winner;
arithmetic update avoids lost updates. Credit uses `balanceMl <= MAX - amount`
to avoid overflow. `READ COMMITTED` is sufficient because the invariant's
serialization points are one row update and one unique insert, not a multi-row
predicate read. See [PostgreSQL transaction isolation](https://www.postgresql.org/docs/17/transaction-iso.html).

The short owner-row lock prevents an eligibility status update or deletion from
racing the accepted command. It is separate from, and acquired before, the
wallet-row update so all command paths use a stable lock order.

**Alternatives considered**:

- Read then update without a lock: rejected because concurrent callers can both
  make a decision from stale balance.
- `SELECT ... FOR UPDATE` then update: correct, but adds a round trip and holds
  the lock across more application work. Reserve it for a future aggregate rule.
- `SERIALIZABLE`: correct if the full transaction is retried on SQLSTATE `40001`,
  but adds retry/monitoring overhead without strengthening these simple row and
  uniqueness invariants.
- Optimistic version column: makes every collision an application retry and
  still needs database uniqueness for idempotency.

## Decision 5: Database-Arbitrated Global Idempotency

**Decision**: Put a global unique constraint on a private namespaced
`businessEventKey`, then compare every immutable event fact after a uniqueness
race.

**Rationale**: Global scope catches accidental reassignment of one upstream
business event to another user. The database, rather than process memory,
arbitrates concurrent delivery. A losing transaction is fully aborted before
the winner is reloaded. Identical facts yield the stored result; different facts
yield `WALLET_EVENT_CONFLICT`.

**Alternatives considered**:

- Unique `(userId, businessEventKey)`: permits one upstream event to credit
  multiple users after an ownership bug.
- Pre-query only: races and cannot guarantee exactly once.
- Derive uniqueness from operation kind/source: future domains may share labels;
  explicit caller-owned event identity is more stable.

## Decision 6: Extensible Classifier Strings, Strict Direction

**Decision**: Use a strict `CREDIT|DEBIT` enum, but bounded application-validated
strings for `operationKind` and `source`.

**Rationale**: Direction controls arithmetic and must be closed. Kind/source are
extension points for future modules; PostgreSQL enums would require a database
migration for every new trusted classifier. The wallet validates syntax and
length, while each future caller owns its allowlist.

**Alternatives considered**:

- Database enums for all classifiers: stronger fixed vocabulary but couples
  unrelated future feature rollout to wallet schema migration.
- Arbitrary metadata JSON: encourages provider/private data leakage and weakens
  response shaping.

## Decision 7: Migration Trigger Protects Ledger Immutability

**Decision**: Add a PostgreSQL `BEFORE UPDATE OR DELETE` trigger that raises an
exception for `WalletLedgerEntry`, plus `RESTRICT` foreign keys.

**Rationale**: Omitting repository methods is not enough to prevent an accidental
Prisma update/delete. PostgreSQL row triggers execute before the attempted row
operation and provide a durable application-level guard. See [PostgreSQL trigger
behavior](https://www.postgresql.org/docs/17/trigger-definition.html).

**Alternatives considered**:

- Application convention only: too easy to bypass.
- Database role revocation alone: the current deployment uses one Prisma role
  that must insert and read; introducing a privileged stored-procedure role is
  disproportionate until multiple writers exist.
- Event sourcing framework: heavy dependency and abstraction without a current
  need.

## Decision 8: Sequence Cursor For Deterministic History

**Decision**: Give every entry a unique monotonic `bigint` sequence and paginate
by `sequence DESC` with an opaque exclusive cursor.

**Rationale**: Timestamps can collide and UUID ordering has no temporal meaning.
An indexed owner/sequence query is deterministic, bounded, and duplicate-free.
Sequence gaps are harmless. New commits after a page boundary appear on refresh,
not by mutating the already established continuation.

**Alternatives considered**:

- Offset pagination: concurrent inserts shift offsets and duplicate/skip rows.
- Timestamp only: ties are ambiguous.
- `(occurredAt,id)` cursor: deterministic but lets backdated future inserts fall
  behind an already traversed boundary; recorded sequence better represents
  append order.

## Decision 9: Compensation Is A Linked Credit Without Invented Policy

**Decision**: A compensation is a new credit entry pointing to an existing
same-owner debit. Its own business key provides idempotency; several distinct
compensations may reference one debit.

**Rationale**: The feature must preserve corrections without editing history but
must not decide under-dispensing calculation, partial/cumulative caps, expiry,
or source-bucket rules. Structural origin validation is safe and sufficient for
the foundation.

**Alternatives considered**:

- Unique compensation link: prevents legitimate future partial compensation.
- Enforce cumulative amount not above debit now: creates an unapproved product
  policy and requires extra aggregate locking.
- Allow arbitrary credit with no origin: fails the compensation audit rule.

## Decision 10: Separate Mobile Wallet Composition Scope

**Decision**: Add a `WalletCompositionRoot` beside the existing
`AuthCompositionRoot`. It receives the existing `withAccess` capability and a
narrow observable session snapshot, and owns/disposes wallet flow state.

**Rationale**: This avoids renaming or broadening the completed auth root while
keeping components free of subscriptions. MobX owns renderable state; RxJS
`switchMap`, serialization, and epoch checks own cancellation and stale-result
suppression, matching project constitution and feature-002 style.

**Alternatives considered**:

- Put wallet state in React hooks: duplicates state ownership and weakens
  cross-session cleanup.
- Add wallet to `AuthCompositionRoot`: creates an unrelated feature dependency.
- Introduce a monorepo-wide app framework/shared package: premature abstraction.

## Decision 11: Real PostgreSQL Is Mandatory For Critical Tests

**Decision**: Use separate Prisma connections and synchronization barriers
against PostgreSQL 17 for uniqueness races, conditional debits, rollback,
constraints, foreign keys, and immutable-trigger tests.

**Rationale**: Repository mocks and an in-memory engine cannot reproduce
PostgreSQL row-lock waiting, `WHERE` re-evaluation, unique-index arbitration,
sequence gaps, transaction rollback, or trigger behavior.

**Alternatives considered**:

- Unit tests only: fast but cannot prove acceptance-critical guarantees.
- SQLite: different locking, types, SQL, and trigger behavior.
- Sequential integration calls: do not create a concurrency race.

## Decision 12: No New Dependency

**Decision**: Use existing Prisma transactions/tagged raw queries, NestJS,
class-validator, MobX, RxJS, Vitest, Supertest, and RNTL.

**Rationale**: The current stack already supplies all required mechanisms.
Prisma's transaction client can execute parameterized raw queries; tagged
templates keep values separate from SQL. See [Prisma transactions](https://www.prisma.io/docs/orm/prisma-client/queries/transactions)
and [Prisma raw queries](https://www.prisma.io/docs/orm/prisma-client/using-raw-sql/raw-queries).

**Alternatives considered**:

- Ledger/event-sourcing library: adds weight and a second persistence model.
- Cursor or bigint serialization packages: the required codecs are small,
  deterministic, and testable locally.

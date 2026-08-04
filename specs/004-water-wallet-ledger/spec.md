# Feature Specification: Water Wallet Ledger

**Feature Branch**: `water-wallet-ledger-feature`

**Created**: 2026-08-04

**Status**: Ready for Implementation

**Input**: User description: "Create a reliable internal water balance measured in whole millilitres, backed by an immutable and idempotent operation ledger, with authenticated balance and history access and a minimal mobile experience."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View My Water Balance (Priority: P1)

As an authenticated user, I want to see my current water balance so that I know
how much water is available for future purchases and dispensing.

**Why this priority**: The current balance is the primary user-visible value of
the wallet and the foundation for every later bonus, payment, and dispensing
feature.

**Independent Test**: Authenticate a user with no wallet activity, view the
balance, add one trusted internal credit, refresh the balance, and confirm that
the displayed quantity changes from exactly zero to the credited amount without
rounding loss.

**Acceptance Scenarios**:

1. **Given** an authenticated user with no prior wallet operations, **When** the user opens the balance view, **Then** the user sees an available balance of exactly zero litres and not an error or missing-account state.
2. **Given** an authenticated user with confirmed wallet operations, **When** the user opens or refreshes the balance view, **Then** the user sees the exact available quantity derived from those operations.
3. **Given** a balance that includes a partial litre, **When** it is displayed, **Then** the displayed value preserves millilitre precision and does not change the stored quantity through rounding.
4. **Given** an unauthenticated, expired, revoked, or otherwise invalid session, **When** balance access is attempted, **Then** no wallet information is returned and the existing authentication recovery behavior applies.
5. **Given** a temporary connectivity or service failure, **When** balance loading fails, **Then** the user sees a retryable error state rather than a fabricated zero or stale value presented as current.

---

### User Story 2 - Record A Balance Change Exactly Once (Priority: P1)

As a future trusted business capability, I need to credit, debit, or compensate
a user's water balance exactly once so that retries and concurrent processing
cannot create or destroy litres incorrectly.

**Why this priority**: Reliable, atomic balance changes are the core business
invariant on which referrals, package purchases, dispensing, and
under-dispensing compensation will depend.

**Independent Test**: Start with a known balance, submit trusted internal
operations including repeated and concurrent requests with the same business
event identity, and verify that each distinct event affects the balance once,
insufficient debits are rejected, and every accepted change has one immutable
history entry.

**Acceptance Scenarios**:

1. **Given** a valid positive credit for a user, **When** a trusted internal caller submits it, **Then** one ledger entry is recorded and the available balance increases by exactly that amount.
2. **Given** sufficient available balance, **When** a trusted internal caller submits a valid debit, **Then** one ledger entry is recorded and the available balance decreases by exactly that amount.
3. **Given** insufficient available balance, **When** a debit is submitted, **Then** the operation is rejected without a ledger entry or any balance change.
4. **Given** an accepted operation, **When** the same business event identity is submitted again with the same immutable facts, **Then** the original result is returned or recognized and the balance changes no more than once.
5. **Given** an existing business event identity, **When** it is reused with a different user, direction, amount, source, or operation kind, **Then** the request is rejected as a conflict and the original entry remains unchanged.
6. **Given** several concurrent debits whose combined amount exceeds the available balance, **When** they are processed, **Then** only a valid subset succeeds, the balance never becomes negative, and every successful debit has exactly one ledger entry.
7. **Given** several concurrent submissions for the same credit event, **When** they are processed, **Then** exactly one credit is recorded and all completed responses agree on the resulting operation.
8. **Given** a failure before an operation is fully committed, **When** processing ends, **Then** neither a partial balance change nor a partial ledger entry is visible.
9. **Given** a previously recorded mistake or a future under-dispensing adjustment, **When** a trusted caller records compensation, **Then** a new linked compensating entry is created without modifying or deleting the original entry.

---

### User Story 3 - Review My Balance History (Priority: P2)

As an authenticated user, I want to review a clear history of water balance
changes so that I can understand why litres were added, removed, or restored.

**Why this priority**: A transparent history makes the balance explainable and
provides the user-facing audit trail required by later payment, referral, and
dispensing features.

**Independent Test**: Create more operations than one history page for one
user, include credits, debits, and compensation, then page through the history
and verify exact quantities, stable ordering, no duplicates, and no operations
belonging to another user.

**Acceptance Scenarios**:

1. **Given** a user with no wallet operations, **When** the user opens history, **Then** an explicit empty state is shown.
2. **Given** a user with several operations, **When** history is loaded, **Then** entries are ordered newest first using a deterministic tie-breaker and show direction, exact quantity, operation kind, source category, effective time, and stable public identity.
3. **Given** more entries than one page, **When** the user requests subsequent pages, **Then** each entry appears once in deterministic order and the client can determine whether another page exists.
4. **Given** new activity occurs after an earlier page was loaded, **When** the user continues from that page's continuation point, **Then** already returned entries are not duplicated or reordered within the continuation sequence.
5. **Given** two different users, **When** either user requests history, **Then** only entries owned by the authenticated user are returned.
6. **Given** an entry containing internal correlation or idempotency data, **When** it is returned to the user, **Then** only the explicitly public history fields are exposed.

---

### User Story 4 - Refresh Wallet State With The Session (Priority: P2)

As a signed-in mobile user, I want balance and history to refresh safely after
login, session restoration, and manual retry so that the application does not
show another session's data or silently retain an obsolete wallet state.

**Why this priority**: Wallet data is user-specific and must follow the existing
authentication lifecycle before it can safely appear in the main application.

**Independent Test**: Restore an authenticated session, load wallet data,
log out, authenticate as a different user, and verify that the previous user's
balance and history are cleared before the new user's data is loaded.

**Acceptance Scenarios**:

1. **Given** a successfully authenticated or restored session, **When** the wallet experience becomes available, **Then** the current user's balance can be loaded without another OTP.
2. **Given** a wallet request is in progress, **When** the user logs out or the active session is replaced, **Then** the request no longer updates visible state and the previous wallet data is cleared.
3. **Given** a failed wallet load while the session remains valid, **When** the user retries, **Then** one new load is performed and successful data replaces the error state.
4. **Given** history pagination is in progress, **When** a refresh begins, **Then** the old continuation state is discarded and the refreshed history starts from the newest entry.

### Edge Cases

- Zero-value and negative input amounts are rejected; direction is explicitly
  selected by the credit, debit, or compensation command variant, and amount
  magnitude is always positive.
- Quantities that exceed the documented supported whole-millilitre range are
  rejected without changing balance or history.
- A debit equal to the complete available balance succeeds and leaves exactly
  zero; the next positive debit fails.
- Operations for an unknown, suspended, or otherwise ineligible user are
  rejected without implicitly creating usable funds.
- Identical timestamps do not make history ordering unstable because a second
  stable ordering key is always applied.
- A compensation must reference the existing operation it corrects; a missing
  or incompatible origin is rejected.
- A retry after an indeterminate caller-side timeout is safe because the
  original business event identity is reused.
- An empty wallet is not represented by a synthetic ledger entry, so history
  remains empty while the logical balance is zero.
- A balance read cannot expose an intermediate state in which the balance and
  its committed ledger entry disagree.
- Client-side formatting, locale separators, or litre conversion never changes
  the canonical whole-millilitre quantity used for later operations.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST maintain one logical water wallet per registered user and MUST present a predictable zero balance before that user has any wallet operations.
- **FR-002**: The canonical unit for every balance, operation, comparison, and calculation MUST be a whole millilitre; fractional millilitres and floating-point arithmetic MUST NOT affect wallet state.
- **FR-003**: The system MUST support trusted internal commands for credit, debit, and compensation without exposing a general-purpose public endpoint for changing balances.
- **FR-004**: Every accepted balance-changing command MUST include a stable business event identity, user identity, positive amount, operation kind, source category, and effective time; its direction MUST be explicitly determined by the credit, debit, or compensation command variant.
- **FR-005**: A distinct business event MUST change a user's balance no more than once, including after retries, concurrent delivery, application restart, or an indeterminate caller-side timeout.
- **FR-006**: Protection against duplicate business events MUST be enforced by durable storage uniqueness and MUST NOT depend only on in-memory or request-process checks.
- **FR-007**: Reuse of a business event identity with facts that differ from the original operation MUST produce a stable conflict result and MUST NOT modify the original operation or balance.
- **FR-008**: A credit MUST increase the balance by exactly its positive whole-millilitre amount.
- **FR-009**: A debit MUST decrease the balance by exactly its positive whole-millilitre amount only when sufficient balance is available.
- **FR-010**: The wallet balance MUST never become negative, including under concurrent debit attempts.
- **FR-011**: An accepted balance change and its ledger entry MUST become visible atomically; a failed operation MUST expose neither part.
- **FR-012**: Each accepted operation MUST append exactly one immutable ledger entry. Existing ledger entries MUST NOT be edited or deleted through normal application behavior.
- **FR-013**: Corrections and reversals MUST be represented as new linked compensating entries and MUST preserve the original operation.
- **FR-014**: After every committed operation performed through the supported wallet application boundary, the current balance MUST be exactly reconcilable with the user's confirmed ledger entries. Any stored balance projection MUST be treated as derivable and MUST not override ledger truth. Privileged out-of-band database changes are outside the supported application boundary and MUST be detectable by reconciliation; they MUST NOT be used as a normal mutation path.
- **FR-015**: The ledger MUST preserve enough source and operation-kind information for future referral bonus, welcome bonus, purchased-litre, dispensing debit, release, and under-dispensing compensation features without implementing their business rules in this feature.
- **FR-016**: Water quantities MUST remain separate from money, payment-provider payloads, prices, currencies, points, and cash-equivalent values.
- **FR-017**: Only an authenticated user with a currently valid existing session MAY read that user's wallet balance and history.
- **FR-018**: Balance and history reads MUST derive user ownership from the authenticated session and MUST NOT accept a caller-selected user identity that could expose another user's data.
- **FR-019**: The public balance result MUST expose the exact available whole-millilitre quantity and MAY include a presentation-safe litre representation, but that representation MUST NOT become the source for calculations.
- **FR-020**: Public history entries MUST expose only stable public identity, direction, exact whole-millilitre amount, operation kind, user-understandable source category, and timestamps required for display.
- **FR-021**: Public balance and history results MUST NOT expose internal uniqueness keys, raw provider identifiers, private correlation metadata, storage fields, or another user's information.
- **FR-022**: History MUST be ordered newest first by effective ordering fields with a stable unique tie-breaker.
- **FR-023**: History MUST support bounded continuation pagination with a default page size of 20 and a maximum page size of 100.
- **FR-024**: Continuing history pagination MUST not duplicate an already returned entry, skip an entry that belonged after the prior page boundary, or reorder the previously established continuation sequence.
- **FR-025**: The user experience MUST distinguish initial loading, loaded zero balance, loaded non-zero balance, empty history, additional-page loading, and retryable failure states.
- **FR-026**: The mobile wallet state MUST be cleared when the user logs out, loses the valid session, or changes authenticated identity.
- **FR-027**: Wallet loading and pagination work that belongs to an obsolete session or screen lifecycle MUST NOT update the currently visible user's state.
- **FR-028**: A successful session restoration MUST allow wallet data to load without another OTP, while an authentication failure MUST preserve the existing session recovery behavior.
- **FR-029**: The feature MUST preserve the existing OTP, registration, pending promo, legal acceptance, SMS, navigation, and session contracts and behavior.
- **FR-030**: Persistent wallet changes MUST be introduced through reviewed migrations; automatic schema synchronization MUST NOT be required.
- **FR-031**: Stable error outcomes MUST distinguish at least invalid amount, insufficient balance, duplicate-event conflict, invalid compensation origin, unauthorized access, and temporary dependency failure without exposing internal details.
- **FR-032**: Tests MUST prove zero balance, exact credit, exact debit, insufficient balance, duplicate retry, conflicting duplicate, concurrent debit safety, concurrent same-event credit safety, atomic rollback, ledger immutability, compensation, cross-user isolation, deterministic pagination, safe public errors, and whole-millilitre precision.
- **FR-033**: Automated regression checks MUST confirm that the completed phone OTP authentication feature retains its existing externally observable behavior.
- **FR-034**: The feature MUST NOT create referral relationships, validate or apply promo codes, award welcome or referral bonuses, process payments, calculate package prices, select machines, scan QR codes, communicate over MQTT, reserve water, or initiate physical dispensing.
- **FR-035**: The feature MUST NOT provide an administrative or user-facing arbitrary balance-adjustment capability.
- **FR-036**: The selected internal wallet command contract MUST remain independent of future referral, payment, machine, and dispensing implementations so those capabilities supply source-specific facts without becoming wallet dependencies.

### Business Rules

- **BR-001**: One litre equals exactly 1,000 canonical millilitres.
- **BR-002**: An operation amount is a positive magnitude; credit or debit direction determines its effect on balance.
- **BR-003**: Compensation is a new audit event, not a mutation. In this feature it restores litres through a credit and must identify the existing operation being compensated.
- **BR-004**: A wallet with no entries has a balance of zero and an empty history.
- **BR-005**: An operation is final once accepted. Pending payment, reservation, authorization, and settlement states belong to future features and do not create provisional ledger entries here.
- **BR-006**: The same business event identity is immutable across retries. A caller must reuse it after a timeout rather than generate a replacement for the same business fact.
- **BR-007**: Public history is an explanation of committed water changes, not a dump of internal audit or integration metadata.
- **BR-008**: This feature tracks a single aggregate available-water balance. Allocation between bonus, purchased, compensated, or other future source buckets and the order in which those buckets are consumed are outside scope.

### Public Read Contracts

- **Current balance**: Returns the authenticated user's exact available quantity
  in whole millilitres and an observation timestamp. A presentation-safe litre
  value may also be returned, but consumers must treat millilitres as canonical.
- **Operation history**: Returns a bounded newest-first page of explicitly
  shaped public entries plus an opaque continuation value when another page is
  available. The caller cannot select another user's wallet.
- Both reads use the existing authenticated-session boundary, reject invalid
  sessions through the established authentication behavior, and expose stable,
  redacted failures.

### Scope Boundaries

**In scope**:

- A user-owned logical wallet and exact current balance.
- Immutable ledger entries for trusted internal credit, debit, and compensation
  commands.
- Durable idempotency, atomicity, concurrency safety, reconciliation, and
  deterministic history pagination.
- Authenticated balance and history reads.
- Minimal mobile balance/history loading, display, empty, error, retry, refresh,
  pagination, and session-cleanup behavior.

**Out of scope**:

- Welcome or referral bonus rules, referral relationships, promo-code
  validation, or referral history.
- Source-bucket allocation, bonus-first spending, expiry rules, or balance
  reservation.
- Wave, Orange Money, money, pricing, package catalogues, webhooks, or refunds.
- Machines, maps, QR, MQTT, physical-button handling, dispensing, reconciliation
  with hardware, or under-dispensing calculation.
- Full main-screen design, profile, push notifications, account deletion, or an
  administrative adjustment interface.

### Key Entities

- **Water Wallet**: The registered user's logical ownership boundary for an
  exact non-negative available water quantity. It has one owner and can be
  reconciled with all confirmed entries belonging to that owner.
- **Ledger Entry**: An immutable record of one accepted balance change,
  including stable public identity, owner, direction, positive quantity in whole
  millilitres, operation kind, source category, effective and recorded times,
  and the balance resulting from that operation when needed for audit.
- **Business Event Identity**: A durable caller-supplied identity that makes one
  external business fact idempotent. It is private and immutable after first
  acceptance.
- **Compensation Link**: A relationship from a new compensating ledger entry to
  the original operation or business event it corrects; it preserves both audit
  records.
- **History Page**: A deterministic bounded slice of public ledger entries for
  the authenticated owner, with an opaque continuation value and an indication
  of whether more entries are available.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For every tested wallet, the displayed and reported balance equals the algebraic sum of all accepted ledger entries to the exact millilitre, with zero floating-point discrepancies.
- **SC-002**: Repeating the same business event 100 times sequentially or concurrently produces exactly one ledger entry and one balance effect.
- **SC-003**: In a test of at least 100 concurrent debit attempts whose total demand exceeds available water, the final balance is never negative and equals the starting balance minus exactly the successful debits.
- **SC-004**: Validation failure before a transaction, a conditional balance update that does not match, a forced ledger-insert failure after a balance update, and a losing unique-key race MUST expose no partial operation. The forced post-update failure MUST leave both balance and ledger unchanged; the other boundaries MUST preserve the last committed state and append no rejected operation.
- **SC-005**: After 5 warm-up requests, authenticated users can load a current balance or the first 20 history entries within 2 seconds in at least 95% of 20 measured local acceptance requests per endpoint against a wallet with 250 entries and 50 unrelated-user entries, using the documented local PostgreSQL 17 environment with no additional synthetic concurrency.
- **SC-006**: Paging through at least 250 operations returns every operation exactly once in deterministic order, with no cross-user entry and no duplicate across page boundaries.
- **SC-007**: All tested unauthorized, expired-session, conflicting-idempotency, insufficient-balance, invalid-input, and dependency-failure cases return stable safe outcomes with no private storage or correlation data exposed.
- **SC-008**: A session change or logout clears the previous user's visible wallet data before another user's balance or history can appear in 100% of lifecycle tests.
- **SC-009**: Existing phone OTP, registration, legal, SMS, and session regression suites retain their pre-feature externally observable outcomes.
- **SC-010**: Before release, 100% of the required wallet acceptance scenarios and affected authentication regression scenarios pass with no unresolved high-severity data-integrity or private-data-exposure defect.

## Assumptions

- The existing registered-user and session lifecycle remains the authority for
  wallet ownership and authenticated access; this feature does not introduce a
  new identity or authorization mechanism.
- A registered user has a logical zero wallet even if planning chooses to create
  persistent wallet state only on first access or first operation. That storage
  timing must not change observable behavior.
- Trusted internal balance commands are exercised directly by wallet tests and
  will later be called by referral, payment, and dispensing application
  capabilities. They are not exposed as general-purpose client operations.
- All accepted ledger operations in this feature are immediately final. Future
  reservations and pending external transactions will define their own state
  machines before posting final wallet entries.
- Default pagination is 20 entries and caller-selected pagination is bounded at
  100 entries to keep history predictable for mobile clients.
- This foundational feature neither defines nor applies expiry behavior.
  Source-specific expiry policy requires separate product approval and, if
  introduced later, must preserve immutable history rather than mutate entries.
- The minimal mobile experience extends the authenticated main-route placeholder
  only as far as needed to demonstrate balance and history states; a complete
  dashboard remains a separate feature.
- Existing package management, static analysis, formatting, test, migration,
  and reactive frontend conventions remain in force and will be addressed in
  technical planning rather than redefined here.
- Wallet projection consistency is guaranteed for committed commands through
  the sole supported wallet application/repository writer. Direct privileged
  SQL mutation is an out-of-band operational fault that reconciliation must
  detect, not a supported way to change balance.

## Conflicts And Resolutions

1. `docs/mvp-requirements.md` requires bonus and purchased litres to be recorded
   separately and later spent bonus-first. This feature must not decide or
   implement bonus rules or debit ordering. Resolution: every ledger entry
   retains an extensible source category, but this feature exposes one aggregate
   available balance and defers source-bucket allocation and consumption order
   to the feature that introduces those business rules.
2. The current persistent user model has no wallet relationship or ledger, while
   this feature requires durable uniqueness, atomic balance changes, and an
   immutable audit trail. Resolution: the specification defines observable
   invariants only; the technical plan must select a reviewed migration and
   concurrency strategy without automatic schema synchronization.
3. The current authenticated mobile main route is a session-restored
   placeholder rather than a complete dashboard. Resolution: the feature adds
   only the smallest balance/history experience needed for independent
   acceptance and does not treat that work as the final main-screen design.
4. The completed phone-auth feature deliberately discards pending promo context
   without referral or balance effects. Resolution: this feature does not alter
   registration completion or award any initial litres; a later referral
   feature must explicitly integrate its accepted business events with the
   wallet command boundary.

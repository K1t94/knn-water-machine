# Feature Specification: Referral Program

**Feature Branch**: `005-referral-program`

**Created**: 2026-08-06

**Status**: In Progress

**Input**: User description: "Create a referral program with stable user promo codes, immutable referral relationships, configurable welcome and inviter bonuses credited through the existing water wallet, and a minimal authenticated mobile experience."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Complete Registration With The Correct Bonuses (Priority: P1)

As a newly registered user, I want my registration to apply an optional promo
code only after phone verification and legal acceptance so that referral
relationships and water bonuses are granted safely and only once.

**Why this priority**: This completes the registration journey started by the
phone-auth feature and is the first business capability that writes to the water
wallet.

**Independent Test**: Complete one registration without a promo code and one
with a valid promo code, retry both completions, and verify that each new user
receives exactly one 10,000 ml welcome bonus while only the inviter in the
referred registration receives one additional 5,000 ml inviter bonus.

**Acceptance Scenarios**:

1. **Given** a user has verified a phone but has not accepted the current legal documents, **When** a promo code is present in pending registration context, **Then** no referral relationship or bonus is created.
2. **Given** a new user completes registration without a promo code, **When** registration succeeds, **Then** the user receives exactly one welcome bonus and no referral relationship is created.
3. **Given** a new user completes registration with another user's valid promo code, **When** registration succeeds, **Then** one permanent referral relationship is created, the new user receives only the welcome bonus, and the inviter receives exactly one inviter bonus.
4. **Given** a completed registration is retried with the same registration identity, **When** the retry is processed, **Then** it returns the prior successful outcome without another relationship or bonus.
5. **Given** a pending code is invalid, unknown, or belongs to the registering user, **When** registration completion is attempted, **Then** the referral is rejected with a safe actionable error and no referral relationship or referral bonus is created.
6. **Given** a temporary failure occurs while required referral effects are being recorded, **When** processing is retried or recovered, **Then** no required bonus is lost and no relationship or bonus is duplicated.

---

### User Story 2 - Apply A Promo Code After Registration (Priority: P1)

As a registered user who has not completed a water purchase, I want to apply an
inviter's promo code explicitly so that the inviter can receive the referral
bonus and the code becomes permanently attached to my account.

**Why this priority**: The MVP explicitly supports referral links and manual
promo entry after registration, but only before the first successful purchase.

**Independent Test**: Apply a valid promo code to an eligible registered user,
repeat the same request, attempt a replacement and self-referral, then lock
eligibility through the future-purchase boundary and verify every result and
wallet effect.

**Acceptance Scenarios**:

1. **Given** an eligible registered user has no inviter, **When** the user explicitly applies a valid code owned by another user, **Then** one permanent relationship is created and the inviter receives exactly one inviter bonus.
2. **Given** the same user has already applied the same code, **When** the request is repeated, **Then** the response returns `ALREADY_ATTACHED` with the same persisted `appliedAt` and without another relationship, entitlement, or wallet credit.
3. **Given** the user already has an inviter, **When** a different code is submitted, **Then** the request is rejected and the original relationship remains unchanged.
4. **Given** the user submits the user's own code, **When** application is attempted, **Then** it is rejected without creating a relationship or bonus.
5. **Given** the user's referral eligibility has been locked by the first successful water purchase, **When** any promo code is submitted, **Then** application is rejected and the user is told that the eligibility period has ended.
6. **Given** only failed, cancelled, or incomplete purchase attempts have occurred, **When** an otherwise valid code is submitted, **Then** the user remains eligible.
7. **Given** different valid codes are submitted concurrently for the same eligible user, **When** the requests finish, **Then** at most one relationship wins, exactly one inviter bonus is created, and all other attempts return deterministic non-success outcomes.

---

### User Story 3 - Share My Referral Code (Priority: P2)

As a registered user, I want to see and share my stable promo code and referral
link so that another person can use it during or after registration.

**Why this priority**: A referral program cannot acquire invitees unless users
can reliably distribute their own invitation.

**Independent Test**: Open the referral view as an existing user, copy the code,
share the generated link, reopen the view in a later session, and verify that
the same code and usable link are returned without exposing private data.

**Acceptance Scenarios**:

1. **Given** an authenticated registered user, **When** the referral view opens, **Then** the user's one stable promo code and a shareable link containing that code are shown.
2. **Given** the user copies the code or invokes system sharing, **When** the action completes, **Then** the shared content contains the displayed code and valid referral link.
3. **Given** the user signs out and later restores a valid session, **When** referral data reloads, **Then** the same promo code is returned.
4. **Given** an unauthenticated, expired, or replaced session, **When** referral data is requested, **Then** no referral information is disclosed and existing session recovery behavior applies.
5. **Given** a registered user opens an incoming referral link, **When** no inviter is yet attached and eligibility remains open, **Then** the apply-code view opens with the code prefilled but does not apply it until the user confirms.

---

### User Story 4 - Review Referral Results (Priority: P2)

As an inviter, I want to see the total water credited for referrals and a safe
history of my invitations so that I can understand the results of sharing my
code.

**Why this priority**: A visible and auditable outcome makes referrals useful
without exposing invitees' private account data.

**Independent Test**: Create more invitations than one page, open the inviter's
summary and history, traverse every page, and verify the exact total, stable
order, safe invitee labels, and isolation from another user's records.

**Acceptance Scenarios**:

1. **Given** a user has no successful invitations, **When** the referral view opens, **Then** the user sees a zero credited total and an explicit empty history state.
2. **Given** a user has successfully credited invitations, **When** summary is loaded, **Then** the credited total equals the exact sum of that user's successfully credited inviter bonuses.
3. **Given** more invitations exist than fit on one page, **When** the user loads subsequent pages, **Then** each invitation appears once in newest-first deterministic order.
4. **Given** an invitation is displayed, **When** the user views it, **Then** only a privacy-safe invitee label, date, public status, and credited whole-millilitre amount are shown.
5. **Given** two inviters have separate histories, **When** either requests referral data, **Then** only that authenticated user's summary and invitations are returned.

### Edge Cases

- Leading and trailing whitespace and letter case do not create distinct promo
  codes; comparison uses one documented canonical form.
- Empty, malformed, non-ASCII, overlong, or syntactically valid but unknown
  promo input is rejected without disclosing whether a particular person owns
  an account.
- Code generation collisions do not replace another user's code or expose a
  temporary duplicate; a unique code is produced before it becomes visible.
- A user whose code is used concurrently by many different invitees can receive
  one bonus per distinct confirmed invitee, without losing valid invitations.
- The invitee receives no additional referral-specific bonus; the 10,000 ml
  welcome bonus is the invitee's only bonus in this feature.
- A zero, negative, fractional, missing, or out-of-range configured bonus cannot
  be used to start bonus processing.
- Changing configured bonus values affects only future bonus entitlements and
  never rewrites the amount of an existing referral or wallet operation.
- If a caller times out after a successful application, retrying the same
  action does not create a second relationship or bonus.
- Suspending either account does not reassign the invitee to another inviter,
  and the confirmed referral relationship remains part of the audit history.
- A referral deep link received while signed out is treated as pending
  registration context; the same link received while signed in requires an
  explicit apply action.
- Logout, session loss, or identity replacement during a request prevents the
  previous user's referral data from updating the visible state.
- New invitations arriving between history pages do not duplicate or reorder
  entries already traversed from an existing continuation point.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every registered user MUST have exactly one stable, unique promo code that remains owned by that user for the lifetime of the account.
- **FR-002**: Promo codes MUST use a documented canonical representation so that surrounding whitespace and letter case cannot produce different identities.
- **FR-003**: The system MUST reject empty, malformed, unsupported-character, overlong, unknown, unavailable, and self-owned promo codes using stable public outcomes that do not reveal private owner information. A promo code owned by a suspended user is unavailable for a new referral attachment and MUST use the same public outcome as an invalid or unknown code.
- **FR-004**: A referral link MUST contain the canonical promo code and MUST route a signed-out recipient to registration context and a signed-in recipient to explicit promo application.
- **FR-005**: Opening a referral link MUST NOT itself apply the code or create a relationship.
- **FR-006**: A registering user MUST be able to replace or remove pending promo context until registration is completed.
- **FR-007**: Pending promo context MUST NOT create a referral relationship or bonus before both phone verification and acceptance of the current mandatory legal documents are complete.
- **FR-008**: Successful registration MUST grant exactly one welcome bonus to every newly registered user, whether or not a promo code was supplied.
- **FR-009**: The development and test welcome bonus MUST be 10,000 whole millilitres and MUST be replaceable through server-controlled configuration without a mobile application update.
- **FR-010**: An invited user MUST NOT receive a referral-specific bonus in addition to the welcome bonus.
- **FR-011**: When registration completes with a valid code owned by another user, the system MUST create exactly one relationship between that inviter and invitee.
- **FR-012**: A registered user without an inviter MUST be able to apply a valid code through an explicit confirmation action while referral eligibility remains open.
- **FR-013**: Referral eligibility for post-registration application MUST remain open until the user's first successfully completed water purchase and MUST remain open after failed, cancelled, or incomplete purchase attempts.
- **FR-014**: The feature MUST expose a trusted internal capability for a future purchase feature to close referral eligibility exactly once at the first successful purchase; it MUST NOT implement purchase processing or expose this capability publicly.
- **FR-015**: Once eligibility is closed, it MUST remain closed and all later promo application attempts MUST fail without changing prior referral state.
- **FR-016**: Each invitee MUST have at most one inviter, and a confirmed relationship MUST NOT be replaced, reassigned, edited, or deleted through normal application behavior. Suspending either account after confirmation MUST NOT reassign or invalidate the relationship, cancel its durable bonus entitlement, or prevent idempotent delivery recovery.
- **FR-017**: Applying the already attached code again MUST be idempotent and return `ALREADY_ATTACHED` with the original persisted attachment timestamp; applying a different code after attachment MUST return a stable conflict outcome.
- **FR-018**: A self-referral MUST be rejected without a relationship, entitlement, or wallet change.
- **FR-019**: Each confirmed relationship MUST create exactly one inviter bonus entitlement for its inviter.
- **FR-020**: The development and test inviter bonus MUST be 5,000 whole millilitres and MUST be replaceable through server-controlled configuration without a mobile application update.
- **FR-021**: Bonus quantities MUST be positive whole millilitres within the water wallet's supported range; floating-point quantities MUST NOT be accepted or used in bonus calculations.
- **FR-022**: The exact configured bonus amount effective when an entitlement is created MUST be preserved permanently for audit and later display.
- **FR-023**: Changing bonus configuration MUST affect only entitlements created after the change and MUST NOT recalculate, edit, or compensate prior bonuses automatically.
- **FR-024**: Welcome and inviter bonuses MUST be credited through the existing trusted wallet boundary and MUST appear as distinct, understandable operations in the user's immutable wallet history.
- **FR-025**: Referral behavior MUST NOT directly alter a wallet balance projection, edit wallet ledger entries, or expose a general-purpose balance mutation to public clients.
- **FR-026**: Every bonus entitlement MUST have a stable business-event identity, and repeated or concurrent processing of that identity MUST change the wallet no more than once.
- **FR-027**: Durable uniqueness MUST enforce one welcome entitlement per user, one inviter entitlement per referral relationship, and at most one referral relationship per invitee.
- **FR-028**: Concurrent attempts using the same or different codes for one invitee MUST produce at most one relationship and at most one inviter bonus.
- **FR-029**: A relationship MUST NOT be reported as successfully confirmed until its required inviter entitlement is durably recorded.
- **FR-030**: Successful registration MUST NOT be reported as having completed its referral effects until the required welcome entitlement and any applicable inviter entitlement are durably recorded.
- **FR-031**: A temporary failure between durable referral state and wallet credit MUST remain recoverable without manual balance editing, lost required credit, duplicate credit, or duplicate relationship.
- **FR-032**: Retries after timeout, restart, or indeterminate delivery MUST converge on the same relationship, entitlement, and wallet results.
- **FR-033**: Existing authentication, legal acceptance, session issuance, and registration request and response contracts MUST remain compatible.
- **FR-034**: The system MUST provide an authenticated user with the user's own stable promo code and referral link.
- **FR-035**: The system MUST provide an authenticated inviter with the exact whole-millilitre total of successfully credited inviter bonuses and a history of invitations whose inviter bonus has been successfully credited.
- **FR-036**: Referral history MUST be ordered newest first using a stable unique tie-breaker and MUST support bounded continuation pagination with a default page size of 20 and a maximum page size of 100.
- **FR-037**: Continuing pagination MUST NOT duplicate an already returned invitation, omit one that belonged after the prior boundary, or reorder the established continuation sequence.
- **FR-038**: Public referral data MUST derive ownership from the active authenticated session and MUST NOT accept a caller-selected user identity.
- **FR-039**: Public responses MUST NOT expose another user's internal identity, full phone number, wallet business-event identity, internal idempotency data, storage fields, recovery status, or private configuration.
- **FR-040**: Each public invitation entry MUST contain only a stable public entry identity, privacy-safe invitee label, stable `appliedAt` timestamp assigned by the database when the referral relationship is inserted in the transaction that successfully commits it, public `CREDITED` status, and exact credited whole-millilitre amount. `appliedAt` MUST NOT be accepted from an HTTP client or application-command caller, and an idempotent replay MUST return the persisted value.
- **FR-041**: A privacy-safe invitee label MUST reveal no more than the final two phone digits and MUST NOT expose the invitee's name or full telephone number.
- **FR-042**: Public errors MUST distinguish invalid or unavailable code, self-referral, already-attached conflict, closed eligibility, authentication failure, and retryable service failure without exposing private account data.
- **FR-043**: The mobile experience MUST show the user's code, referral link, current inviter-bonus total, invitation history, and controls to copy or share the invitation.
- **FR-044**: The mobile experience MUST provide a separate explicit apply-code action for signed-in users and MUST show the attached code read-only after success.
- **FR-045**: The mobile experience MUST distinguish initial loading, empty history, loaded data, apply success, validation failure, closed eligibility, additional-page loading, and retryable failure.
- **FR-046**: Referral state MUST reload after login and valid session restoration and MUST be cleared on logout, invalid session, or authenticated identity replacement.
- **FR-047**: A request started for an obsolete session MUST NOT update the currently visible referral state.
- **FR-048**: A history refresh MUST discard the old continuation position and restart from the newest invitation, while additional-page loading MUST preserve existing rows.
- **FR-049**: Existing registered users MUST receive a stable promo code without requiring re-registration.
- **FR-050**: Existing registered users MUST NOT receive a retroactive welcome bonus solely because this feature is deployed.
- **FR-051**: Provisioning promo codes for existing users MUST be repeatable, collision-safe, and MUST NOT create referral relationships or wallet operations.
- **FR-052**: Bonus values needed to explain the invitation experience MAY be returned to the user, but internal configuration structure and unrelated settings MUST remain private.
- **FR-053**: This feature MUST NOT implement referral levels, bonus expiry, money conversion, purchased-versus-bonus balance buckets, bonus-first spending, payment, QR, machine, messaging, or dispensing behavior.

### Key Entities

- **Promo Code**: A stable public invitation code owned by exactly one registered user, with a canonical value and creation time.
- **Referral Eligibility**: The invitee's durable ability to attach one inviter, including whether and when eligibility was closed by the future first successful purchase.
- **Referral Relationship**: The permanent one-to-one association from one invitee to one inviter, including application channel and a stable database-assigned application time persisted by the transaction that successfully creates the relationship.
- **Bonus Entitlement**: The durable obligation to credit a specific user a fixed whole-millilitre amount for one welcome or inviter event, including its stable event identity and completion outcome.
- **Referral Summary**: The authenticated user's own promo information, attached-code state, eligibility state, successfully credited inviter-bonus total, and counts needed by the referral view.
- **Invitation History Entry**: A privacy-shaped record shown to an inviter only after successful bonus credit, with public identity, safe invitee label, public `appliedAt` timestamp, `CREDITED` status, and exact credited quantity.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A newly registered user receives exactly one 10,000 ml welcome bonus in 100% of successful development and test registrations, including at least 100 repeated submissions of the same completion event.
- **SC-002**: Each valid confirmed invitation grants exactly one 5,000 ml inviter bonus and no additional invitee referral bonus in 100% of sequential and concurrent acceptance tests.
- **SC-003**: At least 100 concurrent attempts to apply one code to one eligible invitee produce exactly one relationship and one inviter bonus.
- **SC-004**: At least 100 concurrent attempts using competing codes for one eligible invitee produce no more than one relationship and one inviter bonus.
- **SC-005**: After the referral view has loaded, users can locate and copy their promo code or referral link within 10 seconds. In a separate measured run, users can locate and open the system share flow within 10 seconds. Both paths MUST be verified on supported iOS and Android targets.
- **SC-006**: After a successful registration or promo application outcome, all required authenticated balance and referral reads MUST expose the result within 5 seconds. Acceptance timing starts when the successful outcome is returned and runs with PostgreSQL, Redis where registration requires it, and the wallet boundary healthy, the one-second recovery scheduler active, no injected dependency failure, and result polling no less frequently than every 100 milliseconds.
- **SC-007**: Users can traverse at least 250 invitation records without duplicates, omissions, unstable ordering, or disclosure of another inviter's records.
- **SC-008**: Every displayed invitee label exposes no more than the final two telephone digits in all privacy validation cases.
- **SC-009**: Self-referral, conflicting replacement, unknown-code, and closed-eligibility attempts produce a clear non-success result without any referral or wallet state change in 100% of acceptance cases. Replaying the already attached code is a successful idempotent no-op and is excluded from this non-success set.
- **SC-010**: After logout or authenticated identity replacement, no prior user's referral data remains visible or can reappear from an obsolete in-flight request.
- **SC-011**: All required bonus obligations recover from simulated temporary failures without manual balance changes, missing credits, duplicate credits, or partially confirmed relationships.
- **SC-012**: Existing phone verification, registration, legal acceptance, session, and wallet acceptance scenarios continue to pass without public contract changes.

## Assumptions

- Development and test environments use a 10,000 ml welcome bonus and a
  5,000 ml inviter bonus. These are temporary values, not approved production
  business values.
- Production bonus values will be supplied explicitly before production use;
  clients do not determine or submit bonus quantities.
- Every newly registered user receives the welcome bonus, including users who
  did not use a promo code. An invited user receives no other bonus in this
  feature.
- Existing users receive promo codes but no retroactive welcome bonuses. This
  prevents an unapproved mass wallet credit when the feature is deployed.
- Promo codes use a short, uppercase, case-insensitive ASCII representation.
  Exact alphabet, length, link route, collision retry policy, and provisioning
  procedure are planning decisions as long as the observable requirements above
  remain true.
- The future purchase capability will close referral eligibility through the
  trusted internal boundary defined here. Until such a successful-purchase event
  exists, an otherwise eligible registered user remains eligible.
- Account deletion is outside the current MVP. Blocking an account does not
  rewrite a historical referral relationship or transfer it to another user.
- The inviter history uses a masked phone-derived label because no separate
  public display-name requirement currently exists.
- Referral and wallet data share the existing trusted system boundary, but this
  specification does not assume they can be committed in one transaction. The
  technical plan must select a recoverable design that meets FR-029 through
  FR-032 without claiming false cross-boundary atomicity.
- The source requirements mention bonus-first spending, while the completed
  wallet feature intentionally has no source buckets. This feature records
  distinct welcome and inviter operations only; allocation and spending order
  remain deferred to a future approved feature.
- Existing pending promo context accepts a broader printable value than the
  eventual canonical referral-code format. Users may continue editing pending
  text, but final application validates and canonicalizes it without changing
  the existing registration-context contract.
- The authenticated mobile application currently opens directly into the
  wallet view. This feature may add only the minimal navigation necessary to
  reach referral and apply-code views; a complete home-screen redesign remains
  out of scope.
- The referral mockup remains the visual-direction reference, but its sample
  20-litre reward, full invitee names, and reward-after-purchase wording conflict
  with the current requirements. Those illustrative values and behaviors MUST
  NOT override the 5,000 ml inviter reward, privacy-safe labels, or
  reward-on-confirmed-registration/application rules in this specification.

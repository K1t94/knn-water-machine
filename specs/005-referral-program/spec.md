# Feature Specification: Referral Program

**Feature Branch**: `005-referral-program`

**Created**: 2026-08-06

**Updated**: 2026-08-12

**Status**: In Progress

**Input**: User description: "Keep the existing referral program, remove all
welcome and invitee bonuses, restrict promo-code application to registration,
and add an operator-controlled runtime flag that disables both referral
behavior and its mobile interface."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Apply A Promo Code During Registration (Priority: P1)

As a new user, I want an optional promo code to be applied when I finish
registration so that the person who invited me receives one referral bonus.

**Why this priority**: Registration is the only allowed point at which a new
referral relationship and its inviter reward can be created.

**Independent Test**: Complete registrations with no code, a valid code, an
invalid code, and a self-owned code; retry and race valid completions; then
verify that only a valid referred registration creates one relationship and
one wallet credit for the inviter, with no credit for the invitee.

**Acceptance Scenarios**:

1. **Given** a user has not completed both phone verification and acceptance of the current mandatory legal documents, **When** a promo code is present in pending registration context, **Then** no referral relationship, bonus obligation, or wallet operation is created.
2. **Given** a new user completes registration without a promo code, **When** registration succeeds, **Then** no referral relationship or referral-related wallet operation is created and the user receives no registration bonus.
3. **Given** a new user completes registration with another user's valid and available promo code while the referral program is enabled, **When** registration succeeds, **Then** one permanent referral relationship and one inviter bonus obligation are created, the inviter is credited exactly once, and the invitee receives no bonus or wallet operation from this feature.
4. **Given** a pending promo code, **When** the user replaces or removes it before registration completes, **Then** only the value present at final registration is considered.
5. **Given** a completed registration is retried with the same registration identity, **When** the retry is processed, **Then** the prior outcome is returned without another relationship, obligation, or wallet credit.
6. **Given** concurrent completion attempts for one registration contain the same or competing valid codes, **When** the attempts finish, **Then** at most one inviter relationship is committed and at most one inviter bonus is credited.
7. **Given** a pending code is invalid, unavailable, unknown, or owned by the registering user, **When** registration completion is attempted while referrals are enabled, **Then** the referral is rejected with a stable safe result and no referral or wallet state is changed.
8. **Given** a temporary failure occurs after durable referral work begins, **When** the same registration is retried or recovery runs while referrals are enabled, **Then** processing converges on the same relationship, bonus obligation, and wallet result without loss or duplication.

---

### User Story 2 - Control Referral Availability (Priority: P1)

As an authorized operator, I want to enable or disable the whole referral
program at runtime so that referral acquisition and rewards can be stopped or
restored without rebuilding or restarting the services or mobile application.

**Why this priority**: The business must be able to stop new referral effects
and hide an unavailable experience consistently across all users and service
instances.

**Independent Test**: Toggle the flag off and on through both the protected
HTTP operation invoked with `curl` and the root project commands, including
unauthorized attempts, service restarts, multiple service instances, active
mobile sessions, registrations, and a previously incomplete inviter credit.

**Acceptance Scenarios**:

1. **Given** the program is enabled and the caller has operational permission, **When** the caller disables it through the protected HTTP operation using `curl`, **Then** the authoritative state changes without a rebuild or restart and every service instance observes the disabled state.
2. **Given** the program is disabled and the caller has operational permission, **When** the caller enables it through a root project command, **Then** the command succeeds only after the protected operation succeeds and every service instance observes the enabled state.
3. **Given** either target state, **When** an authorized operator invokes the corresponding root project command or protected HTTP operation repeatedly, **Then** the requested state remains stable and no referral data or wallet operation is duplicated.
4. **Given** a caller lacks valid operational credentials, **When** the caller attempts to read or change the operational flag, **Then** access is denied without revealing credentials, internal configuration, or referral data and the state remains unchanged.
5. **Given** the program is disabled, **When** services restart or requests are handled by different service instances, **Then** the program remains disabled and all instances enforce the same authoritative state.
6. **Given** registration completes with a pending promo code while the program is disabled, **When** registration succeeds, **Then** registration remains successful but the code creates no relationship, bonus obligation, wallet operation, or post-registration opportunity and is not retained as an attached code.
7. **Given** a referral bonus obligation was durably recorded before the program was disabled but not yet credited, **When** recovery runs while disabled and later after re-enablement, **Then** no credit is delivered while disabled and exactly one credit is eventually delivered after re-enablement.
8. **Given** existing codes, relationships, history, or credited bonuses, **When** the program is disabled and re-enabled, **Then** those records are neither removed nor recalculated and become available again without duplicate credit.

---

### User Story 3 - Share My Referral Code (Priority: P2)

As a registered user, I want to see and share my stable promo code and referral
link while the program is enabled so that a new user can use it during
registration.

**Why this priority**: Inviters need a reliable way to distribute the code that
connects a new registration to their account.

**Independent Test**: Open the enabled referral view, copy the code, share its
link, restore a later session, open the link as both an unregistered and an
already registered user, then disable the program and verify that all referral
entry points and content disappear.

**Acceptance Scenarios**:

1. **Given** the program is enabled and a registered user is authenticated, **When** the referral view opens, **Then** the user's one stable promo code and a shareable registration link containing that code are shown.
2. **Given** the referral view is available, **When** the user copies the code or invokes system sharing, **Then** the shared content contains the displayed code and valid referral link.
3. **Given** the user signs out and later restores a valid session while referrals remain enabled, **When** referral data reloads, **Then** the same promo code is returned.
4. **Given** an unregistered recipient opens a referral link while referrals are enabled, **When** registration opens, **Then** the code is prefilled as editable pending registration context and is not applied before registration completes.
5. **Given** an already registered user opens a referral link, **When** the link is handled, **Then** the code is not stored or applied and no apply-code action is offered.
6. **Given** the program is disabled, **When** a user navigates, refreshes application configuration, or opens a referral link, **Then** referral navigation, screens, codes, links, history, totals, copy actions, share actions, and promo-code input are not displayed or retained.
7. **Given** the program changes from enabled to disabled during an authenticated session, **When** the application next refreshes authoritative availability, **Then** visible referral state is cleared and obsolete in-flight referral results cannot restore it.
8. **Given** an unauthenticated, expired, or replaced session, **When** referral data is requested, **Then** no referral information is disclosed and existing session recovery behavior applies.

---

### User Story 4 - Review Referral Results (Priority: P2)

As an inviter, I want to see the total water credited for referrals and a safe
history of my invitations while the program is enabled so that I can understand
the results of sharing my code.

**Why this priority**: A visible and auditable result makes successful referrals
understandable without exposing invitees' private account data.

**Independent Test**: Create more credited invitations than one page, open the
inviter's summary and history, traverse every page, and verify the exact total,
stable order, safe labels, session isolation, and disabled-state behavior.

**Acceptance Scenarios**:

1. **Given** an enabled program and a user with no successfully credited invitations, **When** the referral view opens, **Then** the user sees a zero credited total and an explicit empty history state.
2. **Given** an enabled program and a user with credited invitations, **When** the summary loads, **Then** the total equals the exact sum of that user's successfully credited inviter bonuses.
3. **Given** more invitations exist than fit on one page, **When** the user loads subsequent pages, **Then** each invitation appears once in newest-first deterministic order.
4. **Given** an invitation is displayed, **When** the user views it, **Then** only a privacy-safe invitee label, application date, public status, and credited whole-millilitre amount are shown.
5. **Given** two inviters have separate histories, **When** either requests referral data, **Then** only that authenticated user's summary and invitations are returned.
6. **Given** the program is disabled, **When** a public referral read is attempted, **Then** it returns the stable `FEATURE_DISABLED` result without exposing or changing preserved referral data.

### Edge Cases

- Leading and trailing whitespace and letter case do not create distinct promo
  codes; comparison uses one documented canonical form.
- Empty, malformed, non-ASCII, overlong, or syntactically valid but unknown
  promo input is rejected without disclosing whether a particular person owns
  an account.
- Code generation collisions do not replace another user's code or expose a
  temporary duplicate; a unique code is produced before it becomes visible.
- A user whose code is used concurrently by many distinct registrations can
  receive one bonus per distinct confirmed invitee without losing valid
  invitations.
- No registration creates a wallet operation for the registering user through
  this feature, whether or not a promo code is present.
- A zero, negative, fractional, missing, or out-of-range configured inviter
  bonus cannot be used to start referral processing.
- Changing the configured inviter bonus affects only future obligations and
  never rewrites an existing relationship or wallet operation.
- If a caller times out after successful registration, replay does not create a
  second relationship or bonus.
- Suspending either account does not reassign the invitee to another inviter,
  and a confirmed relationship remains part of audit history.
- A deep link received while signed out can become editable pending registration
  context only while referrals are enabled; a link received while signed in is
  never an application path.
- Disabling the program during registration prevents referral effects at the
  authoritative completion decision even if the code was accepted into pending
  context while the program was enabled.
- Enabling the program after a registration completed while disabled does not
  apply its discarded code retroactively.
- Logout, session loss, identity replacement, or feature disablement during a
  request prevents obsolete referral data from updating visible state.
- New invitations arriving between history pages do not duplicate or reorder
  entries already traversed from an existing continuation point.
- A failed operational command exits unsuccessfully and does not report the
  requested flag state as applied.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: While the program is enabled, every registered user MUST have exactly one stable, unique promo code that remains owned by that user for the lifetime of the account.
- **FR-002**: Promo codes MUST use a documented canonical representation so that surrounding whitespace and letter case cannot produce different identities.
- **FR-003**: The system MUST reject empty, malformed, unsupported-character, overlong, unknown, unavailable, and self-owned promo codes using stable public outcomes that do not reveal private owner information. A code owned by a suspended user MUST be indistinguishable from an invalid or unknown code for a new referral.
- **FR-004**: A referral link MUST contain the canonical promo code and, only while the program is enabled, route an unregistered recipient to registration context with the code prefilled.
- **FR-005**: Opening a referral link MUST NOT itself apply a code or create a relationship, and opening it as an already registered user MUST NOT retain the code or offer an application action.
- **FR-006**: A registering user MUST be able to replace or remove pending promo context until registration is completed.
- **FR-007**: Pending promo context MUST NOT create a referral relationship or bonus before phone verification, acceptance of current mandatory legal documents, and successful registration completion.
- **FR-008**: Successful registration MUST NOT grant a registration, welcome, invitee, or other referral-funded bonus to the registering user, regardless of whether a promo code is supplied.
- **FR-009**: When registration completes with a valid code owned by another available user while referrals are enabled, the system MUST create exactly one immutable relationship between that inviter and invitee and exactly one inviter bonus obligation.
- **FR-010**: Promo-code application MUST be unavailable after registration completion through public endpoints, internal application commands, referral links, and mobile actions; no purchase-based eligibility state or eligibility-closing capability is part of this feature.
- **FR-011**: Each invitee MUST have at most one inviter, and a confirmed relationship MUST NOT be replaced, reassigned, edited, or deleted through normal application behavior.
- **FR-012**: The inviter bonus MUST be a positive whole-millilitre amount within the water wallet's supported range and MUST be controlled by the server without requiring a mobile application update.
- **FR-013**: The exact inviter bonus effective when an obligation is created MUST be preserved for audit and display, and later configuration changes MUST affect only future obligations.
- **FR-014**: Inviter bonuses MUST be credited through the existing trusted wallet boundary as distinct, understandable immutable operations; referral behavior MUST NOT directly alter balance projections or expose a general-purpose public balance mutation.
- **FR-015**: Every inviter bonus obligation MUST have a stable business-event identity, and repeated or concurrent processing of that identity MUST change the wallet no more than once.
- **FR-016**: Durable uniqueness MUST enforce one inviter bonus obligation per referral relationship and at most one referral relationship per invitee.
- **FR-017**: Concurrent registration attempts using the same or competing codes for one invitee MUST produce at most one relationship and at most one inviter bonus.
- **FR-018**: A referral relationship MUST NOT be reported as successfully confirmed until its inviter bonus obligation is durably recorded.
- **FR-019**: A temporary failure between durable referral state and wallet credit MUST remain recoverable without manual balance editing, lost required credit, duplicate credit, or duplicate relationship.
- **FR-020**: Retries after timeout, restart, or indeterminate delivery MUST converge on the same relationship, bonus obligation, and wallet result.
- **FR-021**: Existing authentication, legal acceptance, session issuance, and registration contracts MUST remain compatible except for the explicitly removed post-registration promo-application contract.
- **FR-022**: While enabled, the system MUST provide an authenticated user with the user's own stable promo code and referral link.
- **FR-023**: While enabled, the system MUST provide an authenticated inviter with the exact whole-millilitre total of successfully credited inviter bonuses and a history containing only invitations whose inviter bonus was successfully credited.
- **FR-024**: Referral history MUST be ordered newest first using a stable unique tie-breaker and MUST support bounded continuation pagination with a default page size of 20 and a maximum page size of 100.
- **FR-025**: Continuing pagination MUST NOT duplicate an already returned invitation, omit one that belonged after the prior boundary, or reorder the established continuation sequence.
- **FR-026**: Public referral data MUST derive ownership from the active authenticated session and MUST NOT accept a caller-selected user identity.
- **FR-027**: Public responses MUST NOT expose another user's internal identity, full phone number, wallet business-event identity, internal idempotency data, storage fields, recovery status, operational credentials, or private configuration.
- **FR-028**: Each public invitation entry MUST contain only a stable public identity, privacy-safe invitee label, stable application timestamp assigned when the relationship is committed, public `CREDITED` status, and exact credited whole-millilitre amount.
- **FR-029**: A privacy-safe invitee label MUST reveal no more than the final two phone digits and MUST NOT expose the invitee's name or full telephone number.
- **FR-030**: Public errors MUST distinguish invalid or unavailable code, self-referral, authentication failure, retryable service failure, and disabled feature without exposing private account data.
- **FR-031**: While enabled, the mobile experience MUST show the user's code, referral link, inviter-bonus total, invitation history, and copy and share controls, and MUST distinguish loading, empty history, loaded data, additional-page loading, and retryable failure.
- **FR-032**: The mobile experience MUST NOT expose a post-registration promo-code input, apply-code action, attached-code state, or purchase-based eligibility state.
- **FR-033**: Referral state MUST reload after login and valid session restoration and MUST be cleared on logout, invalid session, authenticated identity replacement, or observed feature disablement.
- **FR-034**: A request started for an obsolete session or obsolete enabled-feature state MUST NOT update currently visible referral state.
- **FR-035**: A history refresh MUST discard the old continuation position and restart from the newest invitation, while additional-page loading MUST preserve existing rows.
- **FR-036**: Existing registered users MUST retain or receive a stable promo code without re-registration and without creating referral relationships or wallet operations.
- **FR-037**: The system MUST maintain one server-authoritative runtime flag for the referral program, and changing it MUST NOT require a service restart, rebuild, or new mobile release.
- **FR-038**: The authoritative flag value MUST survive service restarts and MUST be enforced consistently by all concurrently running service instances.
- **FR-039**: An authorized operator MUST be able to read and set the flag through a protected internal HTTP operation that can be invoked with `curl`; repeated requests for the current state MUST be idempotent.
- **FR-040**: Unauthorized operational flag reads or changes MUST be denied, MUST leave the flag unchanged, and MUST NOT reveal credentials, private configuration, or referral data.
- **FR-041**: The root project MUST provide separate enable and disable commands that call the protected operation, obtain service location and credentials from the execution environment, contain no repository-stored secret, fail on an unsuccessful response, and verify the resulting authoritative state.
- **FR-042**: The mobile application MUST obtain referral availability from a public, privacy-safe server response and MUST NOT use a release-time local constant as the authoritative value.
- **FR-043**: When disabled availability is observed, the mobile experience MUST hide all referral navigation, screens, promo fields, codes, links, totals, history, copy/share controls, and application actions and MUST clear previously visible referral state.
- **FR-044**: While disabled, public referral operations MUST perform no referral work and MUST return the stable `FEATURE_DISABLED` result; registration itself MUST remain available and successful registrations MUST issue sessions normally.
- **FR-045**: A promo code present when registration completes while referrals are disabled MUST create no relationship, bonus obligation, or wallet operation, MUST NOT be retained as attached or pending referral state, and MUST NOT be applied retroactively after re-enablement.
- **FR-046**: Disabling the program MUST preserve existing promo codes, relationships, history, bonus obligations, and credited wallet operations without deletion, reassignment, recalculation, or reversal.
- **FR-047**: While disabled, recovery processing MUST NOT deliver an inviter credit that was incomplete at disablement; after re-enablement, recovery MUST deliver each valid preserved obligation exactly once.
- **FR-048**: Re-enabling the program MUST restore access to preserved referral data and allow only future qualifying registrations to create new relationships and inviter bonuses.
- **FR-049**: Historical registration-related bonuses credited before this scope change MUST NOT be revoked, recalculated, or granted retroactively to other users.
- **FR-050**: Referral bonus values needed to explain the invitation experience MAY be returned to the authenticated user, but operational configuration structure and unrelated settings MUST remain private.
- **FR-051**: This feature MUST NOT implement post-registration promo application, purchase-based referral eligibility, referral levels, bonus expiry, money conversion, purchased-versus-bonus balance buckets, bonus-first spending, payment, QR, machine, messaging, or dispensing behavior.

### Key Entities

- **Referral Availability**: The server-authoritative enabled or disabled state
  of the whole referral program, including its last accepted change, exposed in
  privacy-safe form to clients and in protected form to authorized operators.
- **Promo Code**: A stable public invitation code owned by exactly one registered
  user, with a canonical value and creation time, visible only while referrals
  are enabled.
- **Pending Registration Promo**: Editable registration context that may hold one
  canonical promo-code candidate until registration completes and has no
  referral effect by itself.
- **Referral Relationship**: The permanent association from one invitee to one
  inviter, created only by a qualifying completed registration and carrying a
  stable system-assigned application time.
- **Inviter Bonus Obligation**: The durable obligation to credit a specific
  inviter a fixed whole-millilitre amount for one referral relationship,
  including its stable event identity and completion outcome.
- **Referral Summary**: The authenticated inviter's own promo information,
  successfully credited inviter-bonus total, and counts needed by the referral
  view.
- **Invitation History Entry**: A privacy-shaped credited invitation record with
  a public identity, safe invitee label, application timestamp, credited status,
  and exact credited quantity.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100% of successful registrations without a promo code, no referral relationship and no registration-related bonus or wallet operation is created.
- **SC-002**: In 100% of successful registrations with a valid promo code while referrals are enabled, exactly one relationship and exactly one inviter bonus are created, while the invitee receives no bonus or wallet operation from this feature.
- **SC-003**: At least 100 repeated or concurrent completion attempts for one registration produce at most one relationship and one inviter bonus, including attempts with competing valid codes.
- **SC-004**: In 100% of tested post-registration entry points, an already registered user cannot submit, retain, confirm, replace, or attach a promo code.
- **SC-005**: An authorized operator can enable or disable referrals through either documented control method in under 30 seconds without a restart, rebuild, or mobile release; unauthorized attempts change the state in 0% of cases.
- **SC-006**: Across at least three concurrently running service instances and a restart of each, 100% of tested operations enforce the same authoritative flag state within 5 seconds of a successful change.
- **SC-007**: Within 5 seconds after the mobile application refreshes authoritative availability, 100% of referral navigation and content is absent when disabled and available when re-enabled to a registered user with a valid authenticated session.
- **SC-008**: In 100% of registrations completed while referrals are disabled, registration remains usable and a supplied code creates no relationship, bonus obligation, wallet operation, or later application opportunity.
- **SC-009**: All referral data and credited bonuses present before disablement remain unchanged after at least 100 disable and re-enable cycles, and every previously incomplete valid inviter obligation is credited exactly once after re-enablement.
- **SC-010**: After the enabled referral view has loaded, users can locate and copy their promo code or referral link within 10 seconds and can open the system share flow within 10 seconds on supported iOS and Android targets.
- **SC-011**: Users can traverse at least 250 invitation records without duplicates, omissions, unstable ordering, or disclosure of another inviter's records.
- **SC-012**: Every displayed invitee label exposes no more than the final two telephone digits in all privacy validation cases.
- **SC-013**: Existing phone verification, registration, legal acceptance, session, and wallet acceptance scenarios continue to pass, except for tests of the intentionally removed post-registration promo-application behavior.

## Assumptions

- The current server-controlled inviter bonus remains 5,000 whole millilitres in
  development and test environments until an approved production value is
  supplied; clients never determine or submit the quantity.
- The first persisted flag value is enabled so deployment of this scope change
  does not silently hide a currently active referral program; later operator
  changes become authoritative and durable.
- "Without restart" means the effective flag is runtime state rather than a
  process environment setting. Service location and operator credentials used
  by operational commands still come from the command's execution environment.
- The protected operational control reuses the project's trusted operational
  boundary. Its exact route, credential mechanism, audit fields, and command
  names are planning decisions subject to the security requirements above.
- Existing promo codes, relationships, bonus obligations, wallet credits, and
  history are migrated or preserved in place. No historical bonus is clawed
  back solely because the current reward policy changed.
- Users registered while referrals are disabled must have one stable promo code
  available after re-enablement, but whether collision-safe provisioning occurs
  during registration or on later reconciliation is a planning decision with no
  user-visible difference.
- Account deletion is outside the current MVP. Suspending either account does
  not rewrite a historical relationship or transfer it to another user.
- The inviter history uses a masked phone-derived label because no separate
  public display-name requirement currently exists.
- Referral and wallet data share a trusted system boundary but are not assumed
  to commit in one transaction; planning must retain recoverable, idempotent
  delivery without claiming false cross-boundary atomicity.
- The referral mockup remains the visual-direction reference, but its sample
  values, full invitee names, and reward timing do not override this
  specification.
- This update is an explicitly approved scope change to
  `docs/mvp-requirements.md`: it removes registration bonuses, removes
  post-registration promo application and purchase-based eligibility, and adds
  runtime referral availability. Those older MVP statements are not fallback
  requirements for this feature.

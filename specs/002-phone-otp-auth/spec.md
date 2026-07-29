# Feature Specification: Phone OTP Authentication

**Feature Branch**: `not-created`

**Created**: 2026-07-28

**Status**: Draft

**Input**: User description: "Регистрация и авторизация пользователя по сенегальскому номеру телефона через Orange SMS Senegal API с OTP, принятием актуальных legal-документов и сохраняемой пользовательской сессией; FakeSmsProvider для development и тестов."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Confirm A Senegalese Phone Number (Priority: P1)

As a user in Senegal, I want to enter my phone number, receive a one-time code,
and confirm the code so that the service can establish that I control the
number.

**Why this priority**: Phone confirmation is the required trust boundary for
both new registration and returning-user login.

**Independent Test**: Submit a valid Senegalese number, receive a six-digit code
through the configured delivery provider, verify it once, and confirm that the
same code cannot be used again.

**Acceptance Scenarios**:

1. **Given** a user enters a valid Senegalese number in a supported local or international format, **When** the user requests a code, **Then** the number is normalized to `+221` E.164 format, one active six-digit code is created, and the user sees the OTP entry screen with a 60-second resend timer.
2. **Given** a user enters a malformed number or a number outside Senegal, **When** the user requests a code, **Then** no SMS is requested and a clear validation error is shown.
3. **Given** an active unexpired challenge and the correct code, **When** the user submits the code, **Then** the phone is confirmed exactly once and the code immediately becomes unusable.
4. **Given** an active challenge and an incorrect code, **When** the user submits the code, **Then** the attempt is rejected without revealing the correct code and the remaining-attempt rule is enforced.
5. **Given** five incorrect submissions for one challenge, **When** another verification is attempted, **Then** the challenge is invalidated and the user must request a new code after the applicable restriction.
6. **Given** the resend timer has not elapsed, **When** the user attempts to resend from any client, **Then** the request is rejected by the server and the remaining wait is communicated.
7. **Given** two concurrent verification requests with the same valid code, **When** they are processed, **Then** no more than one request succeeds.

---

### User Story 2 - Complete Registration With Legal Acceptance (Priority: P1)

As a first-time user, I want to review and accept all current mandatory legal
documents after confirming my phone so that I can complete registration and
enter the application.

**Why this priority**: A phone-confirmed person is not a registered user until
all mandatory legal documents have been accepted.

**Independent Test**: Confirm a number that has no active user, obtain the
current mandatory documents, accept their exact versions, repeat the completion
request, and verify that one user and one acceptance per document version exist.

**Acceptance Scenarios**:

1. **Given** a confirmed number with no registered user, **When** OTP verification succeeds, **Then** the user receives a short-lived registration authorization and is directed to the current mandatory legal documents rather than the main application.
2. **Given** one or more mandatory documents are not accepted, **When** registration completion is requested, **Then** registration is refused and no active user session is created.
3. **Given** all current mandatory document versions are accepted with a valid registration authorization, **When** registration is completed, **Then** the user, phone confirmation, legal acceptances, and initial session are committed atomically.
4. **Given** the same valid registration completion is submitted more than once with the same idempotency key, **When** requests are processed, **Then** they return the same completion result without rotating its bootstrap refresh credential and without duplicate users, legal acceptances, or sessions.
5. **Given** a mandatory legal version changes after the documents were loaded, **When** the user submits acceptance for the stale set, **Then** completion is paused and the current document set must be reviewed and accepted.
6. **Given** OTP succeeded but a temporary dependency failure prevented completion, **When** the user retries while the registration authorization remains valid, **Then** completion can succeed without sending another SMS.
7. **Given** the registration authorization has expired, **When** completion is retried, **Then** the user must confirm the phone with a new OTP.

---

### User Story 3 - Log In And Restore A Session (Priority: P1)

As a registered user, I want to remain signed in across application restarts and
renew my access securely so that I do not need an OTP on every launch.

**Why this priority**: Persistent but revocable sessions are part of the core
authentication experience and prevent avoidable SMS cost and friction.

**Independent Test**: Log in an existing compliant user, restart the mobile
application, renew access with the stored refresh credential, rotate that
credential, and log out the current session.

**Acceptance Scenarios**:

1. **Given** an existing user who has accepted all current mandatory documents, **When** OTP verification succeeds, **Then** a new device session is created and short-lived access plus long-lived refresh credentials are issued.
2. **Given** an existing user is missing a current mandatory acceptance, **When** OTP verification succeeds, **Then** access to the main application is blocked until the missing versions are accepted.
3. **Given** a valid refresh session after an application restart, **When** the application restores authentication, **Then** access is renewed without another OTP and the refresh credential is rotated.
4. **Given** an already rotated refresh credential is submitted again, **When** reuse is detected, **Then** the associated session is revoked and further renewal for that session is denied.
5. **Given** a user has sessions on multiple devices, **When** the user logs out on one device, **Then** only the current device session is revoked.
6. **Given** a refresh session is expired, revoked, or invalid, **When** restoration is attempted, **Then** the application clears the local authentication state and requires OTP login.

---

### User Story 4 - Operate SMS Delivery Safely Without Production Credentials (Priority: P2)

As a developer or operator, I want OTP delivery to use a replaceable provider
contract with a safe local fake and an Orange implementation so that development
and automated tests do not depend on production access.

**Why this priority**: Delivery must be testable before customer credentials are
available without weakening staging or production safety.

**Independent Test**: Run the shared provider behavior tests against the fake
provider and a mocked Orange endpoint, verify normalized results and errors, and
confirm that staging or production refuses to start with the fake selected.

**Acceptance Scenarios**:

1. **Given** a development or automated-test environment with `SMS_PROVIDER=fake`, **When** an OTP is requested, **Then** the fake provider follows the common delivery contract and may expose the OTP only through an explicitly local-only testing channel.
2. **Given** a staging or production environment with `SMS_PROVIDER=fake`, **When** the service starts, **Then** startup fails before serving requests with a safe configuration error.
3. **Given** `SMS_PROVIDER=orange`, **When** a message is sent, **Then** the official Orange Senegal contract is used and provider-specific responses are normalized without leaking Orange internals to authentication behavior or users.
4. **Given** Orange credentials are unavailable during development, **When** automated validation runs, **Then** Orange authentication, sending, response mapping, and retry decisions can be validated against mocked contract responses without live delivery.
5. **Given** a temporary Orange failure, **When** delivery is attempted, **Then** retry is bounded; a permanent number, message, or authorization rejection is not retried indefinitely.

---

### Edge Cases

- A local-format number contains spaces, punctuation, or a leading trunk prefix:
  normalization either produces one valid Senegalese E.164 number or returns a
  user-facing validation error.
- A syntactically valid E.164 number has a non-`+221` country code: no challenge
  or provider request is created.
- The number belongs to a ported subscriber: eligibility is not inferred from
  an operator prefix.
- Two OTP send requests for the same phone arrive concurrently: at most one
  active challenge remains and parallel SMS pumping is prevented.
- A new code is issued while an older code is still valid: only the new
  challenge can be verified.
- Delivery fails after a challenge is prepared: the user receives a normalized
  retryable or non-retryable outcome and an unusable challenge does not grant
  authentication progress.
- The OTP has expired, was used, or was invalidated: all are rejected without
  exposing sensitive challenge details.
- The transient challenge store or persistent user store is unavailable: the
  operation fails closed and does not create a partial registration or session.
- The SMS daily budget or global send limit is exhausted: new sends stop even if
  a per-phone cooldown has elapsed.
- Delivery Receipt arrives more than once, arrives late, or references an
  unknown message: handling is idempotent and never changes OTP verification
  outcome.
- Current legal documents change between load and submission: stale acceptance
  cannot complete registration or login.
- A user already exists when an idempotent registration completion is retried:
  the existing unique active user is used and no duplicate is created.
- Concurrent same-key registration completion responses arrive out of order: each
  contains the same bootstrap credential result, so neither response can make
  the other stale or trigger refresh replay detection.
- Session creation fails during registration completion: no ambiguous
  client-visible success is returned; retry remains safe.
- A rotated refresh credential is replayed concurrently with a legitimate
  renewal: reuse detection prevents two valid successor credentials.
- The mobile device has no network during request, verification, legal load, or
  renewal: the application preserves only safe state and offers a retry without
  displaying infrastructure errors.

## Requirements *(mandatory)*

### Functional Requirements

#### Phone Number And OTP

- **FR-001**: The feature MUST support phone authentication only for Senegal and
  MUST store and exchange accepted phone numbers in E.164 form beginning with
  `+221`.
- **FR-002**: The mobile experience MUST accept common user-entered Senegalese
  number formatting, normalize it before submission, and show a clear error for
  an invalid length, format, or unsupported country.
- **FR-003**: The server MUST independently validate and normalize every phone
  number and MUST NOT determine the subscriber's operator solely from a number
  prefix.
- **FR-004**: Each OTP MUST contain exactly six decimal digits, be generated
  with a cryptographically secure source, expire five minutes after creation,
  and be usable at most once.
- **FR-005**: Only a protected representation of an OTP MAY be retained; a
  plaintext OTP MUST NOT be stored in persistent or transient data stores,
  application logs, metrics, or normal API responses. The sole exception is
  the bounded, ephemeral, in-process FakeSmsProvider inspection channel
  permitted by FR-037; it MUST remain development/test-only and MUST NOT use
  Redis, PostgreSQL, logs, traces, metrics, or normal API responses.
- **FR-006**: OTP comparison MUST be safe against timing disclosure, and
  successful consumption MUST be atomic so concurrent requests cannot both
  succeed.
- **FR-007**: Issuing a new OTP MUST invalidate every previous active challenge
  for the same normalized number.
- **FR-008**: A challenge MUST allow no more than five incorrect verification
  attempts; exhausting the allowance MUST invalidate it and MAY trigger an
  additional temporary restriction after repeated failed challenges.
- **FR-009**: Resending MUST be unavailable for 60 seconds after an accepted
  send request, and this cooldown MUST be enforced by the server independently
  of the user interface.
- **FR-010**: Send controls MUST cover phone number, source IP, device or
  installation identifier when available, global sending volume, and a daily
  SMS spend budget; exact additional thresholds MUST be configurable and
  finalized during planning.
- **FR-011**: Multiple concurrent send operations for one number MUST be
  prevented or serialized so they cannot bypass cooldown, invalidate the newest
  challenge unexpectedly, or produce uncontrolled spend.
- **FR-012**: The production SMS text MUST fit in one GSM-7 message, identify
  KAYNANN, include the five-minute validity period, and contain no links,
  Cyrillic text, emoji, or unnecessary special characters.
- **FR-013**: A successful SMS send alone MUST NOT create or activate a user,
  create a session, or establish completed registration.

#### Registration And Legal Acceptance

- **FR-014**: Successful OTP verification MUST determine whether the phone
  belongs to a registered user and whether that user has accepted every current
  mandatory legal document.
- **FR-015**: A new or legally non-compliant user MUST receive a short-lived,
  scoped registration authorization that permits legal-document retrieval and
  completion but does not grant main-application access.
- **FR-016**: A new user MUST be created or activated only after successful OTP
  verification and acceptance of the exact current versions of all mandatory
  legal documents.
- **FR-017**: Registration completion MUST atomically persist the user, unique
  normalized phone, phone-confirmation time, each accepted document version and
  acceptance time, required audit context, and the initial session.
- **FR-018**: Registration completion MUST be idempotent and MUST NOT create
  duplicate users, sessions, or acceptance records when requests are retried or
  processed concurrently. While the registration authorization and its
  completion result remain valid, the same idempotency key MUST return the same
  bootstrap credential result without rotating refresh lineage; a different
  idempotency key MUST be rejected.
- **FR-019**: A normalized phone number MUST be unique among active users.
  Temporary OTP challenges MUST NOT be treated as users.
- **FR-020**: If any mandatory legal version changes before completion, the
  stale acceptance MUST be rejected and the current documents MUST be presented.
- **FR-021**: If completion fails temporarily after OTP verification, the user
  MUST be able to retry without a new OTP while the registration authorization
  remains valid.
- **FR-022**: Expiration or invalidation of registration authorization MUST
  require a new OTP verification.
- **FR-023**: Registration MUST accept an optional referral promo code, including
  one prefilled from a referral deep link, allow the user to edit or remove it,
  and carry it as pending registration context without validating, applying, or
  creating referral effects in this feature.

#### Sessions And Authorization

- **FR-024**: A legally compliant registered user MUST receive a short-lived
  access credential and a long-lived refresh credential after successful OTP
  verification.
- **FR-025**: The access lifetime MUST be at most 15 minutes, and each
  `UserSession` MUST have an absolute 60-day lifetime measured from session
  creation. Refresh rotation, application activity, restart, and legal
  acceptance MUST NOT extend that deadline. Access credentials MUST NOT expire
  later than their session deadline.
- **FR-026**: Refresh credentials MUST rotate on successful renewal, and no
  plaintext refresh credential MAY be stored by the server.
- **FR-027**: Reuse of an already rotated refresh credential MUST revoke the
  associated session and deny subsequent renewal for that session.
- **FR-028**: Each device MAY have a separate revocable session; logging out MUST
  revoke the current session without automatically ending other device sessions.
- **FR-029**: The mobile application MUST store the refresh credential using
  platform-provided secure storage, restore a valid session after restart, renew
  access automatically, and clear authentication state when renewal is no longer
  valid.
- **FR-030**: A valid refresh session MUST avoid repeat OTP on application
  startup; an expired, revoked, or invalid refresh session MUST require OTP.
- **FR-031**: Users missing a newly mandatory legal version MUST be blocked from
  the main application and directed to acceptance before authorization resumes.

#### SMS Provider And Orange Integration

- **FR-032**: OTP behavior MUST depend on one replaceable SMS delivery contract
  rather than on Orange-specific request or response structures.
- **FR-033**: Every delivery implementation MUST provide a normalized send
  result, optional provider message identifier, common error categories, and a
  delivery-status capability indication.
- **FR-034**: Provider-specific credentials, OAuth behavior, endpoints, DTOs,
  response codes, and error models MUST remain isolated from OTP, registration,
  controllers, and the mobile application.
- **FR-035**: The active provider MUST be selected by
  `SMS_PROVIDER=fake|orange`; adding a future provider MUST NOT require changes
  to OTP, registration, session, controller, or mobile business behavior.
- **FR-036**: The fake provider MUST be permitted only in development and
  automated tests. Staging or production startup with the fake selected MUST
  fail before requests are accepted.
- **FR-037**: The fake provider MAY expose the generated OTP only through an
  explicitly enabled, local-development-only channel or an isolated automated
  test fixture; no such exposure is permitted in staging or production.
- **FR-038**: Orange delivery MUST follow the current official Orange SMS
  Senegal contract, including client-credentials OAuth, reuse of the access
  token until near expiry, the Senegal sender address or approved Sender Name,
  outbound SMS submission, and provider message identifier capture when
  available.
- **FR-039**: Orange credentials, access tokens, sender configuration, webhook
  secrets, and full provider payloads MUST remain server-side, outside source
  control and user-visible output, and MUST be supplied through protected runtime
  configuration.
- **FR-040**: Orange failures MUST map to stable product-safe categories that
  distinguish invalid configuration or credentials, insufficient balance,
  provider rate limit, invalid recipient or rejected message, timeout, and
  temporary unavailability.
- **FR-041**: Retry MUST be bounded and limited to temporary technical failures.
  Invalid recipients, rejected messages, invalid configuration, and other
  permanent failures MUST NOT be retried automatically.
- **FR-042**: Orange OAuth, sender approval, account balance, live delivery, and
  Delivery Receipt behavior MUST have a separate post-credential integration
  acceptance stage; absence of customer credentials MUST NOT block local or
  automated feature validation.
- **FR-043**: When Delivery Receipt is enabled, the system MUST accept provider
  status notifications through the approved secure callback, acknowledge valid
  notifications, process duplicates idempotently, and retain only necessary
  technical status.
- **FR-044**: All provider implementations MUST pass a shared behavior contract;
  the Orange implementation MUST additionally be verifiable against mocked
  official success, authentication, balance, rate-limit, validation, timeout,
  and temporary-failure responses.

#### Error Handling, Security, And Observability

- **FR-045**: User-visible errors MUST be stable product messages and MUST NOT
  expose raw Orange, storage, framework, credential, or internal exception
  details.
- **FR-046**: No log, metric, trace, analytics event, or public response MAY
  contain plaintext OTPs, access credentials, refresh credentials, registration
  credentials, Orange secrets, or full phone numbers; technical phone references
  MUST be masked or irreversibly pseudonymized.
- **FR-047**: All authentication boundaries MUST reject malformed input, operate
  only over secure transport outside isolated local development, and fail closed
  when required challenge, user, legal, or session state is unavailable.
- **FR-048**: The service MUST expose counts for OTP requests, successful sends,
  send failures by normalized category, successful confirmations, incorrect and
  expired codes, rate-limit activations, and current SMS spend consumption,
  without sensitive values.
- **FR-049**: When Delivery Receipt data is available, the service MUST expose
  aggregate delivery latency and delivery-result statistics; operator statistics
  MAY be reported only from delivery evidence and not inferred from prefixes.
- **FR-050**: Authentication flows MUST distinguish invalid phone, unsupported
  country, server rate limit, provider failure, no network, invalid/expired/used
  OTP, exhausted attempts, invalid registration authorization, stale legal
  versions, dependency failure, and session creation or renewal failure.

### Screen States

#### Phone Entry

- Initial entry with fixed Senegal country context (`+221`).
- Optional empty, prefilled, edited, or removed promo code.
- Invalid number or unsupported country.
- Sending with controls disabled.
- OTP sent and navigation to verification.
- Temporary provider failure.
- Server rate limit with retry guidance.
- No network.
- Service temporarily unavailable.

#### OTP Verification

- Waiting for six-digit input with operating-system autofill support when
  available.
- Verifying with repeated submission disabled.
- Incorrect code.
- Expired or invalidated code.
- Attempt allowance exhausted.
- Resend countdown.
- Resending with controls disabled.
- New code sent and previous input cleared.
- Resend failure.
- Successful confirmation and routing based on user/legal status.

#### Legal Acceptance

- Loading current documents.
- Documents loaded with mandatory versions identifiable.
- Not all mandatory documents accepted.
- Submitting acceptance with repeated submission disabled.
- Documents changed during the flow.
- Temporary completion failure with retry.
- Successful completion and session establishment.

### Business Rules

- **BR-001**: Senegal (`+221`) is the only supported country for MVP phone
  authentication.
- **BR-002**: One phone has at most one current OTP challenge; each challenge
  lives for five minutes, permits five incorrect attempts, and succeeds once.
- **BR-003**: A resend is allowed no sooner than 60 seconds after an accepted
  send request, while stricter anti-abuse or budget limits may continue to block
  it.
- **BR-004**: Orange delivers SMS only. OTP generation and verification,
  anti-abuse controls, user lifecycle, legal acceptance, and sessions remain
  responsibilities of the KAYNANN service.
- **BR-005**: Phone confirmation is necessary but insufficient for registration;
  every current mandatory legal document must also be accepted.
- **BR-006**: Acceptance is version-specific and auditable. A superseded version
  never substitutes for a current mandatory version.
- **BR-007**: Session validity, not application process lifetime, determines
  whether repeat OTP is required.
- **BR-008**: Delivery status is technical evidence and does not by itself
  confirm OTP possession, create a user, or establish a session.
- **BR-009**: The fake provider is a development/testing facility, never a
  staging or production fallback.
- **BR-010**: A pending promo code is optional registration context; its absence,
  validity, or later referral processing never blocks OTP verification, legal
  acceptance, user creation, or session establishment in this feature.
- **BR-011**: Refresh rotation replaces a credential only within the existing
  absolute session window. At or after the session deadline, renewal fails and
  a new successful OTP authentication is required to create a new session
  window.
- **BR-012**: Replaying an idempotent registration-completion result is not a
  refresh operation and never advances refresh-token lineage.

### Key Entities *(include if feature involves data)*

- **User**: A registered account identified by one unique active normalized
  Senegalese phone number; records phone-confirmation time, lifecycle status,
  and required audit timestamps. It exists or becomes active only after OTP and
  mandatory legal acceptance complete.
- **OtpChallenge**: Short-lived, non-user authentication state for one normalized
  phone; includes a protected code representation, creation and expiry times,
  attempt count, send cooldown, status, and safe request context. It transitions
  from active to consumed, expired, invalidated, or attempts-exhausted and is
  never reusable.
- **UserSession**: One revocable device session associated with a user; records a
  protected refresh credential representation, rotation lineage or reuse
  evidence, expiry, revocation state, device/installation context when
  available, and audit timestamps. A user may have multiple sessions.
- **LegalDocument**: A versioned legal text with type, version, publication
  state, mandatory flag, effective time, and content reference. Exactly the
  current mandatory set gates registration and login.
- **LegalAcceptance**: Immutable evidence that one user accepted one exact legal
  document version at a recorded time with required audit context. The
  user/document-version pair must not be duplicated.
- **SmsDelivery**: Minimal technical record for an attempted delivery, including
  provider, safe phone reference, provider message identifier when supplied,
  normalized status/error category, timestamps, attempt count, and Delivery
  Receipt evidence. It never stores the OTP or full provider secrets.
- **PendingPromoCode**: Optional registration context containing the
  user-entered or deep-link-prefilled code until registration completes. This
  feature does not validate or apply the code and creates no referral
  relationship or bonus from it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In acceptance testing, 100% of valid supported Senegalese test
  numbers can complete the request-and-confirm flow, while 100% of tested
  non-`+221` numbers are rejected before an SMS delivery request.
- **SC-002**: Across automated concurrency and lifecycle tests, zero consumed,
  expired, superseded, or attempts-exhausted OTPs are accepted, including two
  simultaneous submissions of the same valid code.
- **SC-003**: In 100% of tested challenges, a sixth incorrect submission is
  rejected and no resend is accepted during the first 60 seconds.
- **SC-004**: Across repeated and concurrent registration-completion tests,
  exactly one active user and one acceptance per required document version are
  created for a normalized phone.
- **SC-005**: In 100% of tested first-time and outdated-legal flows, the main
  application remains inaccessible until every current mandatory document is
  accepted.
- **SC-006**: A user with a valid refresh session can restart the application
  and regain authenticated access without OTP; replaying an old rotated
  credential revokes the affected session in 100% of security tests.
- **SC-007**: Automated scans of mobile artifacts, tracked repository content,
  logs, metrics, and normal API responses find zero Orange secrets, plaintext
  OTPs, plaintext refresh credentials, registration credentials, or full phone
  numbers.
- **SC-008**: The full OTP and provider test suite completes without live Orange
  credentials, while staging and production configuration tests reject the fake
  provider in 100% of cases.
- **SC-009**: Every tested Orange error category produces a stable product-safe
  outcome, and zero raw provider error messages are shown to users.
- **SC-010**: Replacing the selected SMS delivery implementation requires no
  change to OTP, registration, session, controller, or mobile business behavior,
  as demonstrated by the shared provider contract tests.
- **SC-011**: In a moderated acceptance test with 20 independent target
  participants who are not project contributors and have not previously seen
  the feature screens, at least 19 participants (95%) MUST complete the full
  new-user phone confirmation and mandatory legal-acceptance flow without
  product assistance within 180 seconds of active task time, excluding only
  controlled OTP delivery latency.
- **SC-012**: Operations can account for 100% of accepted OTP send requests as
  successful, normalized failure, or provider-pending outcomes and can identify
  every enforced rate-limit or budget-limit event without accessing sensitive
  values.
- **SC-013**: In 100% of registration tests, an optional manually entered or
  deep-link-prefilled promo code remains editable or removable and produces no
  referral relationship, bonus, or registration failure in this feature.
- **SC-014**: In the documented deterministic normal-health local profile using
  fake SMS, 200 independent OTP request/verification identities at concurrency
  10 complete with every auth-operation p95 below 500 ms, and 500 independent
  refresh sessions at concurrency 20 complete with refresh p95 below 300 ms,
  excluding external SMS delivery latency and with a zero unexpected-error rate.

## Assumptions

- `docs/requirements.md` does not exist in the repository; as confirmed by the
  user and required by `AGENTS.md`, `docs/mvp-requirements.md` version 0.12 is
  the general MVP source of truth.
- The existing bootstrap monorepo and its mobile/API applications, persistent
  database, transient store, migration workflow, and validation commands are
  extended rather than replaced; no bootstrap tasks are duplicated.
- Orange SMS Senegal is an external delivery dependency and currently documents
  Senegal delivery, client-credentials access, outbound sending, and optional
  Delivery Receipt onboarding. Customer approval, credentials, Sender Name,
  balance, callback allow-listing, and live delivery validation may be
  unavailable during implementation.
- Production Delivery Receipt activation depends on a customer-approved,
  publicly reachable secure callback and therefore belongs to the separate
  post-credential integration acceptance stage.
- Additional anti-abuse thresholds, registration-authorization lifetime,
  session audit fields, and retention periods will be selected during planning,
  remain configurable where operationally necessary, and default to
  security-preserving behavior.
- Device or installation rate limiting is applied when the existing mobile
  identity contract provides a stable identifier; phone, IP, global volume, and
  spend controls remain mandatory regardless.
- Per the latest user clarification, this feature carries only an optional
  pending promo code from manual entry or a registration deep link. Promo-code
  validation and application, referral relationships, referral sharing/history,
  welcome and referral bonuses, and all related balance effects are deferred to
  a separate referral feature.
- Account deletion, email recovery, social login, other countries, fallback SMS
  routing, water purchase/dispense, QR, MQTT, payments, and push notifications
  remain outside this feature.

# Feature Specification: Machine Discovery and Selection

**Feature Branch**: `006-machine-discovery-and-selection`

**Created**: 2026-08-13

**Status**: Approved for implementation

**Input**: User description: "Enable authenticated users to find, identify, inspect, and select a water machine using a map, nearby list, QR code, or manual public code."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Find Nearby Machines (Priority: P1)

As an authenticated user, I can view published water machines on a map and in a list so that I can find a suitable machine near my current location.

**Why this priority**: Discovering a machine is the primary entry point into the water-purchase journey and provides value independently of QR scanning.

**Independent Test**: With a catalog containing machines in different states and a known user position, verify that the user can open discovery, see map markers and a nearest-first list, inspect distance, address, price, and status, and open a machine card.

**Acceptance Scenarios**:

1. **Given** an authenticated user has granted location permission and published machines have valid coordinates, **When** the user opens machine discovery, **Then** the map shows those machines and the list orders them by ascending straight-line distance from the current position.
2. **Given** two machines have the same calculated distance, **When** the list is presented, **Then** their order is resolved deterministically by ascending public `machineId`.
3. **Given** location permission is denied, **When** the user opens discovery, **Then** the map opens in the configured service area, the catalog remains browsable, and entries do not show a calculated user distance.
4. **Given** the device location is temporarily unavailable, **When** discovery loads, **Then** the user sees a location-specific explanation while service-area map and list browsing remain available without calculated distance.
5. **Given** the user switches between map and list, **When** either view is restored, **Then** the current discovery context and already loaded catalog results are preserved without duplicate machines.
6. **Given** the catalog contains published `ONLINE`, `SERVICE`, and `OFFLINE` machines, **When** discovery loads, **Then** all three states are represented consistently while hidden, archived, deleted, and non-customer machines remain absent.
7. **Given** no visible machines match the current discovery context, **When** loading completes, **Then** the user sees a distinct empty state rather than an indefinite loader or a technical error.
8. **Given** the user selects a marker, **When** its summary is shown, **Then** the user can open the corresponding machine card.
9. **Given** the user selects an item in the list, **When** the action completes, **Then** the corresponding machine card opens.
10. **Given** the catalog has more entries than one result page, **When** the user continues browsing, **Then** additional results load without duplicates, omissions caused by paging, or nondeterministic reordering.

---

### User Story 2 - Identify a Machine by Code (Priority: P1)

As an authenticated user standing near a machine, I can scan its QR code or enter its public code manually so that I can open the correct machine without searching the map.

**Why this priority**: QR identification is a principal MVP path and manual entry is the required recovery path when camera access or recognition fails.

**Independent Test**: With one supported QR payload and public code, verify that scanning and manual entry both resolve the same public machine card, while malformed, external, unknown, and inaccessible identifiers fail safely.

**Acceptance Scenarios**:

1. **Given** camera permission is granted and a supported QR identifies a visible machine, **When** the user scans it, **Then** the latest card for exactly that machine opens.
2. **Given** the same QR remains in view while its first resolution is in progress, **When** it is detected repeatedly, **Then** only one resolution and one navigation occur.
3. **Given** the QR is malformed, unsupported, or contains an untrusted external address, **When** it is scanned, **Then** no external content or command is opened and the user receives a safe invalid-code result.
4. **Given** a syntactically valid QR identifies an unknown, hidden, archived, deleted, or non-customer machine, **When** it is resolved, **Then** the user receives the same safe not-found result without internal details.
5. **Given** camera permission is denied or the camera is unavailable, **When** the user opens the scanner, **Then** the application explains the limitation and offers manual code entry.
6. **Given** the user enters a valid public code with surrounding spaces or different letter case, **When** the code is submitted, **Then** safe normalization resolves the corresponding machine.
7. **Given** the user enters an empty, malformed, or unknown code, **When** it is submitted, **Then** no fuzzy match is attempted and a clear validation or not-found result is shown.
8. **Given** machine resolution cannot complete because of a connectivity failure, **When** scanning or manual entry is submitted, **Then** the user sees a retryable connectivity error distinct from an unknown-machine result.
9. **Given** the scanner is active, **When** the user cancels, **Then** scanning stops and no machine is selected.
10. **Given** a supported legacy code has a registered mapping to a current public machine, **When** the code is scanned, **Then** the current public machine card opens without exposing the legacy identifier.
11. **Given** location permission is denied or the device location is temporarily unavailable, **When** the user opens QR scanning or manual entry, **Then** identification remains available and does not require a user position.

---

### User Story 3 - Inspect and Select an Available Machine (Priority: P1)

As an authenticated user, I can inspect a machine's current customer-facing details and select it only when it remains available, so that the next purchase step starts with a valid machine and current price context.

**Why this priority**: Discovery is useful to the purchase journey only if it produces a safe, unambiguous selected machine and prevents continuation with unavailable or incomplete data.

**Independent Test**: Open cards for machines in every supported state and verify their displayed information, selection eligibility, final revalidation, and handoff without creating any purchase or dispensing effect.

**Acceptance Scenarios**:

1. **Given** a visible machine has a current `ONLINE` state and valid current price, **When** its card opens, **Then** the user sees its safe display name, address, status, price per liter, currency, and distance when location is available.
2. **Given** an `ONLINE` machine with a valid price remains eligible, **When** the user confirms selection, **Then** its stable public `machineId` is handed to the next flow exactly once.
3. **Given** a machine is `SERVICE` or `OFFLINE`, **When** its card opens, **Then** the card remains viewable, explains its unavailability, and does not allow continuation.
4. **Given** a visible machine has no valid current price or currency, **When** its card opens, **Then** the missing commercial information is not invented and continuation is unavailable with a clear explanation.
5. **Given** a machine became unavailable after appearing in the list or map, **When** its card opens, **Then** the card uses the refreshed state and prevents continuation.
6. **Given** a machine becomes unavailable between card display and confirmation, **When** selection is confirmed, **Then** the latest eligibility check rejects continuation and shows the updated safe state.
7. **Given** the price changes between list display and card opening, **When** the card opens, **Then** the card displays the current authoritative price rather than the earlier list value.
8. **Given** the price changes between card display and selection confirmation, **When** the user confirms, **Then** the latest price context is returned and the user is not advanced using an obsolete price.
9. **Given** the user taps the selection action repeatedly while confirmation is in progress, **When** it completes, **Then** only one handoff to the next flow occurs.
10. **Given** a selection succeeds, **When** the handoff is inspected, **Then** it contains the public machine identity required by the next flow and creates no purchase session, reservation, debit, or machine command.
11. **Given** no valid user position is available, **When** the user opens a known machine card and confirms an otherwise eligible machine, **Then** distance is omitted and selection remains available.

---

### User Story 4 - Receive Safe and Current Results (Priority: P2)

As a user, I receive the newest available discovery result and safe fallback states when location, catalog, price, or telemetry data changes or fails, so that stale information does not mislead me.

**Why this priority**: Resilience protects the primary journeys from common mobile-network and machine-connectivity conditions, but the base discovery paths can be demonstrated before every recovery case is implemented.

**Independent Test**: Delay older discovery and machine-detail results while issuing newer requests, then verify that only the newest context is presented and incomplete telemetry produces a safe non-selectable state.

**Acceptance Scenarios**:

1. **Given** an earlier discovery request remains in progress and the user position or viewed area changes, **When** a newer request completes first, **Then** a later response from the older request does not replace the current results.
2. **Given** a machine has no telemetry or its telemetry is older than the accepted freshness window, **When** its availability is presented, **Then** it is treated as `OFFLINE` and cannot be selected.
3. **Given** a catalog refresh repeats machines already loaded, **When** results are combined, **Then** each public `machineId` appears only once with its latest data.
4. **Given** catalog loading fails, **When** the error is presented, **Then** it is distinguishable from location failure, an empty catalog, and an unknown machine, and the user can retry safely.
5. **Given** a machine lacks valid coordinates, **When** map and nearby results are generated, **Then** it is not placed on the map or ranked by distance and no fabricated location is shown.

---

### User Story 5 - Keep Machine Data Session-Safe (Priority: P2)

As a user, I see machine discovery only in my current authenticated session and do not receive internal machine-system details, so that session boundaries and infrastructure information remain protected.

**Why this priority**: Authentication and intentional data exposure are mandatory safety boundaries across every discovery path.

**Independent Test**: Exercise discovery with valid, expired, replaced, and logged-out sessions, inspect all user-visible machine representations, and verify cleanup and absence of internal identifiers or telemetry.

**Acceptance Scenarios**:

1. **Given** no valid authenticated session exists, **When** map, list, scanner, manual lookup, card, or selection is requested, **Then** access is denied through the existing authentication flow and no machine data is returned.
2. **Given** a session expires during discovery, **When** the user attempts another protected action, **Then** the existing authentication flow is required before the user can repeat the action.
3. **Given** the user logs out or changes account, **When** the session transition completes, **Then** visible results, machine cards, pending resolutions, and selected-machine state from the previous session are cleared.
4. **Given** an obsolete request from a previous session completes later, **When** its result arrives, **Then** it cannot repopulate the current session's machine state.
5. **Given** any successful catalog, card, QR, manual lookup, or selection result, **When** its user-visible data is inspected, **Then** it contains no internal database identifier, device serial, modem identity, message topic, credential, or raw telemetry.

### Edge Cases

- If the user's coordinates change during loading, the most recent accepted position determines distances and order; older results cannot overwrite it.
- If location permission changes while discovery is open, the view moves between location-aware and service-area behavior without losing access to the catalog.
- A published machine without valid coordinates is excluded from map markers and all discovery-list results; it may only be resolved through QR or manual exact identification if its required card and eligibility data remain valid.
- Multiple physical machines may share an address, but each retains its own public identity, status, price, and card.
- Equal distances are resolved by ascending public `machineId` so repeated requests produce the same order.
- Missing or invalid price or currency projects a non-service machine to `OFFLINE`, makes it non-selectable, and never causes a client-supplied fallback price.
- Missing, unknown, or stale telemetry is normalized to `OFFLINE` rather than optimistically treated as available.
- A machine may move from `ONLINE` to `SERVICE` or `OFFLINE` between discovery, card opening, and confirmation; each later boundary uses refreshed eligibility.
- A price may change between discovery, card opening, and confirmation; the current value is shown at each refreshed boundary and an obsolete value is not used for handoff.
- Repeated pages, refreshes, QR detections, submissions, and taps do not create duplicated machines or multiple navigations.
- Empty input, malformed codes, unknown machines, unsupported payloads, and connectivity failures remain distinguishable where doing so does not reveal whether an inaccessible internal record exists.
- Untrusted addresses embedded in QR content are never opened automatically.
- Access-session expiry with failed renewal, logout, session replacement, or account change invalidates all visible and in-progress machine discovery state and returns the user to the existing authentication flow.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST restrict machine map, list, QR resolution, manual lookup, card, and selection capabilities to users with a valid authenticated session.
- **FR-002**: The system MUST provide an authoritative customer-facing catalog independent of direct mobile access to the reference ERP, its data store, and machine messaging infrastructure.
- **FR-003**: Every customer-facing physical machine MUST have one stable, unique, opaque public `machineId` that remains unchanged when its location, address, price, modem, status, or technical settings change.
- **FR-004**: The system MUST maintain internal mappings needed to resolve approved current and legacy identifiers without exposing those identifiers to users.
- **FR-005**: Customer-facing machine responses MUST be explicitly limited to public identity, safe display name, address, coordinates where applicable, normalized availability, price per liter, currency, optional distance and freshness information, selection eligibility, and a consumer-safe machine revision used only for stale-context detection. Transport metadata such as cursors, catalog revision, timestamps, and correlation IDs MAY be included only where explicitly defined by the public contract.
- **FR-006**: Customer-visible results MUST NOT include internal database identifiers, device serials, modem identities, machine-message topics, credentials, or raw telemetry.
- **FR-007**: The system MUST exclude hidden, archived, deleted, and non-customer machines from discovery and return a uniform safe not-found result when their codes are resolved.
- **FR-008**: The system MUST represent customer availability using exactly `ONLINE`, `SERVICE`, and `OFFLINE` in this feature.
- **FR-009**: A machine MUST be `ONLINE` only when it is published for customers, not in service mode, has a valid current price and currency, and has sufficiently current authoritative evidence of availability.
- **FR-010**: A machine explicitly placed in maintenance or service mode MUST be represented as `SERVICE`.
- **FR-011**: A non-service machine with explicit offline state, missing or invalid price or currency, missing telemetry, unknown telemetry, or telemetry older than the accepted freshness window MUST be represented as `OFFLINE`.
- **FR-012**: Published `SERVICE` and `OFFLINE` machines MUST remain discoverable but MUST NOT be selectable for the next flow.
- **FR-013**: Only a published `ONLINE` machine with a valid current price and currency MAY be selected.
- **FR-014**: Machine status, publication, and price eligibility MUST be refreshed when a card is opened and revalidated when selection is confirmed.
- **FR-015**: The system MUST prevent an obsolete status or price from authorizing selection after the authoritative machine state has changed.
- **FR-016**: Price MUST be authoritative, expressed as the amount for one liter with its currency, and update without requiring a new mobile application release.
- **FR-017**: The application MUST NOT invent, permanently define, or substitute a machine price, currency, address, or status when authoritative data is absent.
- **FR-018**: The system MUST show published machines with valid coordinates as map markers whose presentation distinguishes the three availability states.
- **FR-019**: Selecting a map marker MUST expose a safe summary and a path to the corresponding machine card.
- **FR-020**: The system MUST provide a list containing at least address, normalized status, price per liter and currency, plus distance when a current user position is available.
- **FR-021**: With a valid user position, the list MUST be ordered by ascending straight-line geographic distance, with ascending public `machineId` as the deterministic tie-breaker.
- **FR-022**: Without a valid user position, the system MUST omit calculated distance, show the configured service area, and preserve catalog, QR, manual lookup, card, and selection capabilities.
- **FR-023**: Location denial, temporary location failure, catalog failure, and an empty catalog MUST have distinct user-facing states and safe retry behavior where retry is applicable.
- **FR-024**: The catalog MUST support bounded incremental retrieval and MUST NOT require loading the entire catalog before presenting useful results.
- **FR-025**: Paging, refresh, or view switching MUST NOT duplicate a public machine or lose the deterministic result order for the same discovery context.
- **FR-026**: A newer accepted position, viewport, service area, session, or refresh MUST supersede older in-progress work, and older results MUST NOT replace newer visible state.
- **FR-027**: The application MUST allow switching between map and list without discarding the current valid discovery context.
- **FR-028**: The scanner MUST accept only explicitly supported machine-code formats and trusted application address patterns.
- **FR-029**: Machine QR content MUST resolve to a stable public `machineId` through authoritative validation; QR content alone MUST NOT prove that a machine exists or is selectable.
- **FR-030**: The scanner MUST NOT automatically open arbitrary external addresses, executable instructions, or unsupported content.
- **FR-031**: Repeated detection of the same QR while resolution is active MUST produce no more than one lookup and one navigation result.
- **FR-032**: Users MUST be able to cancel scanning and use manual code entry when camera permission is denied, unavailable, or scanning fails.
- **FR-033**: Manual lookup MUST trim surrounding whitespace and safely normalize letter case for public codes while rejecting empty or malformed input and avoiding fuzzy matching.
- **FR-034**: Connectivity failures during QR or manual resolution MUST be distinguishable from safe invalid-code and not-found results.
- **FR-035**: Legacy machine codes MAY resolve only through an approved unique mapping; ambiguous, duplicated, unsupported, or unmapped aliases MUST fail safely.
- **FR-036**: A machine card MUST display a safe name or neutral designation, address, normalized status, price per liter, currency, distance when available, and an explanation when selection is unavailable.
- **FR-037**: Confirming an eligible machine MUST hand its public `machineId` and current validated selection context to the next flow exactly once.
- **FR-038**: Confirming a machine in this feature MUST NOT create a purchase or dispensing session, reserve or debit value, or send a command to a machine.
- **FR-039**: Access-session expiry with failed renewal, logout, account change, and session replacement MUST clear catalog results, visible cards, pending lookups, and selected-machine state belonging to the prior session and MUST require the existing authentication flow before another protected action can be repeated.
- **FR-040**: Results produced for a previous or expired session MUST NOT repopulate state after expiry, failed renewal, logout, or session replacement.
- **FR-041**: The system MUST support controlled test catalog and availability data until production machine connectivity and protocol information are available.
- **FR-042**: Legacy QR compatibility MUST be validated against at least one actual deployed customer payload before production rollout; no unverified payment-provider QR format may be treated as a machine-selection code.

### Key Entities

- **Machine**: A customer-facing physical water machine identified by a stable opaque public `machineId`; carries a safe display designation, publication lifecycle, and associations to current location, price, availability, and approved internal identifier mappings.
- **MachineLocation**: The customer-visible address, explicit service-area assignment, and geographic coordinates associated with a machine. Multiple machines may share the same address while remaining individually identifiable; currency belongs only to `MachinePrice` and is never inferred from location.
- **MachinePrice**: The authoritative current charge for one liter and its currency, including enough recency context to prevent an absent or obsolete value from being used for selection.
- **MachineAvailability**: The normalized `ONLINE`, `SERVICE`, or `OFFLINE` customer state derived from publication, service state, valid current price and currency, communication evidence, and its freshness. It determines whether selection is allowed.
- **MachineIdentifierMapping**: A private association between a public machine and approved current or legacy identifiers used for exact resolution. Its internal identifiers are never part of customer-visible output.
- **MachineSelection**: The ephemeral validated handoff of one eligible public machine to the next flow, including the public `machineId` and current selection context; it is not a reservation, purchase, or dispensing session.

## Success Criteria *(mandatory)*

### Measurable Outcomes

Unless a criterion explicitly says otherwise, timed acceptance uses a warm authenticated application, the deterministic fixture catalog, a supported release device, and a controlled network profile whose per-request round-trip latency is between 80 and 120 ms inclusive, meaning no request deviates from the 100 ms reference latency by more than 20 ms, with zero injected packet loss. Automated latency criteria use at least 100 measured runs and pass when at least 95 runs meet the stated threshold. Physical QR and interaction acceptance uses at least 20 recorded trials on each supported platform and passes when at least 19 trials meet the stated threshold. Device acceptance uses a non-distributable release-mode E2E build: it retains the production release compiler/runtime settings but adds only the isolated E2E bootstrap, controlled fixture transport, recorder, and visible probes required for acceptance. Those E2E capabilities MUST be absent from the production-distributable build. The acceptance platform matrix contains one physical iOS device and one physical Android device supported by that tested build, plus compact and large screen configurations on each platform for responsive validation. Before trials begin, the validation record MUST identify the exact application build and variant, device model, OS version, logical viewport, and runtime; a change to any of those values starts a separately recorded trial set.

- **SC-001**: In separate map and list acceptance trial sets on each supported platform, with location enabled and at least 20 published machines, at least 95 of 100 discovery openings render useful results on the selected surface within 2 seconds under the agreed normal test-network conditions.
- **SC-002**: In separate map and list trial sets on each supported platform, a participant can open the card of a nearby machine in no more than three interactions after entering discovery in at least 19 of 20 recorded trials for each entry path.
- **SC-003**: At least 95% of supported, unobstructed machine QR scans open the correct current machine card within 3 seconds under the agreed normal test conditions.
- **SC-004**: 100% of valid manual public-code acceptance cases resolve the intended machine, and 100% of malformed, unknown, inaccessible, or ambiguous cases fail without selecting a different machine.
- **SC-005**: In all acceptance cases without location permission or with temporary location failure, users can still browse the catalog and reach QR and manual identification without being blocked.
- **SC-006**: In 100% of acceptance cases involving missing or stale telemetry, the affected machine is non-selectable and is never presented as `ONLINE`.
- **SC-007**: In 100% of simulated status or price changes between discovery, card opening, and confirmation, selection uses the latest validated state and never advances an unavailable machine or obsolete price context.
- **SC-008**: Across paging, refresh, view switching, position changes, and delayed-response acceptance tests, no machine appears more than once and no obsolete response replaces a newer discovery context.
- **SC-009**: In 100% of logout, account-change, and expired-session acceptance cases, previous machine results and selections are unavailable to the next session.
- **SC-010**: Inspection of every customer-visible success and error representation finds zero internal database identifiers, device serials, modem identities, message topics, credentials, or raw telemetry fields.
- **SC-011**: Selecting an eligible machine completes a single handoff to the next flow in no more than 2 seconds under the agreed normal test-network conditions and creates zero purchase, reservation, debit, dispensing, or machine-control effects.
- **SC-012**: Product acceptance confirms that map/list and scanner screens preserve the hierarchy and interaction intent of their approved visual references on supported iOS and Android screen sizes without relying on illustrative mockup data.

## Assumptions

- The existing authenticated session and reauthentication flow remain authoritative and are reused for all discovery entry points.
- The customer will provide the production machine inventory and the mapping between approved public codes and internal device and modem identities.
- The customer will provide at least one real deployed machine QR payload before legacy compatibility is approved for production.
- The customer will provide production machine-connectivity details, including broker access, authentication material, topics, payload examples, delivery guarantees, and heartbeat rules, before live status integration is released.
- Controlled catalog data and an availability emulator are acceptable until production machine-connectivity information is available.
- Address, coordinates, publication state, service state, price, currency, and normalized availability are authoritative server-provided values.
- The accepted availability freshness window will be configured according to the verified machine heartbeat behavior before production rollout; any state beyond that window fails safely to `OFFLINE`.
- If user location is unavailable, a configured service area provides the initial browsing region.
- Straight-line geographic distance is sufficient for MVP discovery; route distance and turn-by-turn navigation are not implied.
- One customer-facing card represents one physical machine even when multiple machines share a location.
- A supported legacy QR alias maps to at most one current public machine. Ambiguous mappings are rejected rather than guessed.
- The reference ERP remains a source of compatibility knowledge, not a runtime dependency for the mobile application.

## Dependencies

- Existing authentication, session renewal, logout, and account-replacement behavior.
- A customer-facing machine catalog populated with valid publication, location, price, currency, and identifier-mapping data.
- A configured service area for use when the user's location is unavailable.
- Approved map display and device location capabilities on supported mobile platforms.
- Camera permission and QR recognition capability for the scanning path; manual entry remains the fallback.
- An authoritative source of current machine state, using controlled test data or an emulator until verified production connectivity is available.
- A stable handoff expectation for the subsequent purchase feature.

## Scope Boundary and MVP Alignment

The MVP requirements describe a broader machine card that proceeds into volume selection, price calculation, and purchase-session creation. Feature 006 deliberately decomposes that journey: it delivers discovery, identification, the customer-facing card, eligibility revalidation, and a stable selected-machine handoff. Volume choice, total calculation, and session creation remain required MVP work for a subsequent purchase feature and are not removed from the overall MVP.

The visual references define layout direction only. Business behavior, supported data, and states in this specification take precedence over illustrative values or actions shown in the mockups.

## Out of Scope

- Selecting a water volume or calculating the total purchase amount.
- Creating purchase, reservation, payment, or dispensing sessions.
- Reserving or debiting wallet value and handling Wave or Orange Money payments.
- Wallet top-up behavior.
- Sending machine-control messages, waiting for the physical button, starting or stopping dispensing, or receiving dispensing commands.
- Measuring delivered volume, refunding under-delivery, sale reconciliation, or recovery after dispensing connectivity loss.
- Full production machine-messaging integration before the customer provides verified credentials and protocol examples.
- Machine firmware development or modification.
- Modification of the Python ERP or direct mobile access to the ERP, its database, or its machine broker.
- A catalog administration interface or automatic bidirectional ERP synchronization.
- Payment-provider merchant QR codes as machine-selection identifiers.
- Driving routes, route distance, turn-by-turn navigation, ratings, reviews, favorites, reservations, or machine booking.
- Copying illustrative prices, currencies, addresses, names, balances, or other sample content from visual mockups.
- Printing, replacing, or mass-managing physical QR labels.

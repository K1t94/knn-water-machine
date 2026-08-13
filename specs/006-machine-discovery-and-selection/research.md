# Phase 0 Research: Machine Discovery and Selection

## 1. Independent Consumer Catalog Ownership

**Decision**: The new NestJS/PostgreSQL application exclusively owns the
consumer machine catalog, public identity, publication state, address,
coordinates, price, identifier mappings, and availability evidence. Controlled
fixtures seed development/test data; production catalog management is a separate
future operational concern.

**Rationale**: Consumer contracts require stable public semantics and strict
privacy boundaries that the legacy implementation does not provide. Local
ownership makes availability, errors, migrations, and response shaping explicit
and testable.

**Alternatives considered**:

- ERP master/read-model synchronization: rejected. No current or future ERP
  integration exists or is planned.
- Runtime ERP API/database access: rejected for ownership, reliability,
  security, and explicit product-scope reasons.
- Static mobile catalog: rejected because publication, price, availability, and
  exact resolution must be authoritative at request time.

**Production rollout gates**: Define a non-ERP operational process for creating
and maintaining catalog records before production. This does not block the
fixture/emulator implementation.

## 2. Public Identifier and Versioned QR Contract

**Decision**: Give each machine an immutable random 128-bit `machineId`, encoded
as 22 base64url characters and distinct from the internal UUID. Support only the
trusted application URI form `kaynann://machine/v1/<machineId>` for v1 QR plus
explicitly registered legacy formats. QR parsing returns a candidate identifier;
the backend still performs exact authoritative resolution.

**Rationale**: Random public identity is stable, opaque, non-sequential, and does
not disclose serial/modem/database values. A versioned grammar permits controlled
evolution and rejects arbitrary URLs and payment-provider QR payloads.

**Alternatives considered**:

- Expose database UUID or serial/modem ID: rejected because it couples public
  contracts to internal identity.
- Accept any URL/deep link: rejected because it enables unsafe redirects and
  ambiguous interpretation.
- Put price/status in QR: rejected because QR content is not authoritative and
  becomes stale.

**Production rollout gates**: Approve the final trusted application address and
key-rotation/deep-link ownership configuration. Production legacy compatibility
remains disabled until the customer supplies an anonymized real payload and it
passes grammar, uniqueness, and security review.

## 3. Current and Legacy Identifier Normalization

**Decision**: Store aliases in a private normalized mapping table with a global
unique constraint on `(kind, normalizedValue)`. Manual current/legacy codes are
trimmed, ASCII-only, uppercased with locale-independent rules, then validated by
the scheme-specific grammar. QR values are parsed structurally and never passed
through broad case folding. Resolution is exact; zero and multiple matches both
fail safely.

**Rationale**: Scheme-specific canonicalization avoids fuzzy/accidental matches.
Database uniqueness makes the one-alias-to-one-machine invariant enforceable
under concurrency.

**Alternatives considered**:

- Fuzzy/substring lookup: rejected as unsafe for physical machine selection.
- Case-insensitive database search over raw input: rejected because normalization
  rules differ by scheme and can create hidden collisions.
- Copy legacy DTOs/internal IDs: rejected because mappings are private data owned
  by this application.

**Production rollout gates**: Register every production scheme with grammar,
normalization examples, ownership, and collision tests. Unknown schemes fail
closed.

## 4. Availability Projection and Freshness

**Decision**: Project customer state server-side. Explicit service/maintenance
mode yields `SERVICE`. Otherwise `ONLINE` requires fresh authoritative evidence,
reachable/ready/sales-allowed facts, no explicit offline state, valid current
price/currency, and public catalog eligibility. Every other case is `OFFLINE`.
Freshness uses an injected clock and configured maximum age.

**Rationale**: A strict fail-closed projection prevents mobile from inferring
machine health and makes stale/missing evidence safe. An injected clock makes
boundary behavior deterministic.

**Alternatives considered**:

- Trust a single connected flag: rejected because connected is not equivalent to
  customer readiness.
- Let mobile interpret raw telemetry: rejected because it leaks internals and
  creates inconsistent clients.
- Treat missing evidence as online: rejected as unsafe.

**Production rollout gates**: The production gateway remains disabled until the
customer confirms authenticated protocol, authoritative fields, freshness SLA,
clock semantics, state precedence, and disconnect behavior. Until then only the
application-owned emulator is valid.

## 5. Exact Money Representation

**Decision**: Store price per liter as PostgreSQL `NUMERIC(20,6)` through Prisma
`Decimal`, validate it as positive and within configured bounds, and serialize it
as a canonical decimal string with an uppercase three-letter ISO 4217 currency.
Never convert it to a JavaScript floating-point number for business comparison.

**Rationale**: Decimal storage supports exact per-liter prices, including
currencies/price precision not safely represented by binary floating point. A
string transport preserves exactness for clients.

**Alternatives considered**:

- JavaScript/PostgreSQL floating point: rejected due to rounding ambiguity.
- Integer minor units only: viable for charged totals but less suitable for a
  per-liter rate whose scale may exceed the currency's payment minor unit.
- Currency inferred from location: rejected; price currency is authoritative.

**Production rollout gates**: Confirm supported currencies and commercial price
bounds before production catalog entry. Unknown/invalid currency fails closed.

## 6. Coordinates, Distance, Viewport, and Pagination

**Decision**: Validate latitude in `[-90, 90]`, longitude in `[-180, 180]`, and
require both or neither. Store as `NUMERIC(9,6)`. Use a parameterized PostgreSQL
Haversine expression for straight-line distance. Located sort order is exact
computed distance then public `machineId`; unlocated sort is `machineId`.
Use signed keyset cursors bound to query context and catalog ordering revision.

**Rationale**: Haversine is adequate for display/ranking at MVP regional scale,
uses current infrastructure, and avoids an unjustified extension. Revision-bound
cursors return a clear stale-context conflict rather than silently paging across
changed ordering.

**Alternatives considered**:

- PostGIS/geography: technically stronger for large radius/polygon queries but
  rejected until scale/query-plan evidence justifies infrastructure and migration
  cost.
- Client distance/sort: rejected because clients would receive a non-authoritative
  subset and produce inconsistent pagination.
- Offset pagination: rejected because concurrent publication/location changes can
  duplicate or omit entries.

**Production rollout gates**: Load-test representative catalog density and inspect
query plans. Adopt PostGIS only if measured latency/index behavior misses the
feature target. Validate the configured service-area rectangle for production;
antimeridian-spanning areas require a reviewed split representation.

## 7. Map, Location, Camera, and QR Packages

**Decision**:

- `react-native-maps` for map rendering.
- `expo-location` for foreground permission/current location only.
- `expo-camera` `CameraView` for QR detection, restricted to QR barcode type.
- Manual code input is always available when camera/location is denied,
  restricted, revoked, unavailable, or temporarily failing.

Install via `expo install` for pinned SDK compatibility. Expo SDK 54 documentation
lists `react-native-maps 1.20.1`, `expo-location ~19.0.8`, and
`expo-camera ~17.0.10`.

**Rationale**: These are the minimal Expo-supported native dependencies.
`react-native-maps` is stable for SDK 54, while SDK 54 `expo-maps` is alpha and
requires development builds. Existing MobX/RxJS packages cover state/workflows.

**Alternatives considered**:

- `expo-maps`: rejected for this feature because the official SDK 54 module is
  alpha and carries breaking-change risk.
- Third-party QR parser/scanner: rejected; `expo-camera` already exposes barcode
  results and application code owns the strict URI grammar.
- Background location: rejected because discovery only needs user-initiated
  foreground position and must minimize collection.

**Production rollout gates**: Device-test iOS/Android permissions, scanner focus,
camera denial, Android Maps API key injection, and store disclosure strings.

**Official references**:

- https://docs.expo.dev/versions/v54.0.0/sdk/map-view/
- https://docs.expo.dev/versions/v54.0.0/sdk/location/
- https://docs.expo.dev/versions/v54.0.0/sdk/camera/

## 8. Safe API Error Taxonomy

**Decision**: Return a stable problem envelope with consumer code, safe message,
HTTP status, retryability, and correlation ID. Use:

- `AUTHENTICATION_REQUIRED` / `SESSION_INVALID` (`401`)
- `VALIDATION_ERROR` / `MACHINE_CODE_INVALID` (`400`)
- `MACHINE_NOT_FOUND` (`404`) for every absent/inaccessible category
- `DISCOVERY_CONTEXT_STALE` / `MACHINE_CONTEXT_CHANGED` (`409`)
- `MACHINE_NOT_SELECTABLE` (`422`)
- `DISCOVERY_TEMPORARILY_UNAVAILABLE` (`503`, retryable)

**Rationale**: This supports deterministic UX without exposing whether a hidden,
archived, deleted, legacy-mapped, or internal machine exists.

**Alternatives considered**:

- Raw framework/database errors: rejected due to disclosure and instability.
- Different errors for hidden/deleted/unknown: rejected due to enumeration risk.
- Treat connectivity failure as not-found: rejected because clients need safe
  retry behavior.

**Production rollout gates**: Verify gateway timeout/retry mapping once the
production protocol is approved; do not expose upstream details.

## 9. MobX/RxJS Cancellation and Session Cleanup

**Decision**: One MobX store owns all long-lived discovery state. An app-scoped
workflow accepts intents and composes typed Observable-first API/native adapters.
Use `switchMap` for supersedable work, `exhaustMap` for pagination and selection,
and a session epoch plus request generation on every result. `takeUntil` scopes
work to logout/account replacement/disposal; finalizers clear loading gates.

**Rationale**: Operator semantics make race behavior explicit. Epoch/generation
checks are a second barrier when an underlying native/network operation cannot be
physically cancelled.

**Alternatives considered**:

- Independent React state and effects per screen: rejected because map/list/card
  continuity and session teardown become nondeterministic.
- Public Subjects in screens: rejected because lifecycle and ownership leak into
  presentation code.
- Promise-only adapters: rejected because cancellation/supersession becomes
  implicit and inconsistent.

**Production rollout gates**: None. Race, delayed-response, logout, replacement,
and idempotent `dispose()` behavior must pass automated tests before merge.

## 10. Test Catalog and Availability Emulator

**Decision**: Provide deterministic, non-production seed/fixture data owned by
this repository plus an emulator implementing the read-only `MachineGateway`
availability port. The emulator controls evidence and response delays; a separate
test-only catalog fixture harness controls price/publication. Both use an
injected test clock for freshness edges.

**Rationale**: Development and automated tests need realistic state transitions
before a production machine protocol exists, without creating an accidental ERP
dependency.

**Alternatives considered**:

- ERP import/synchronization/adapter: rejected, including as a temporary option.
- Hardcoded mobile-only fixtures: rejected because they bypass API, persistence,
  security, and freshness behavior.
- Assume a future MQTT payload now: rejected because unconfirmed semantics would
  become accidental production architecture.

**Production rollout gates**: Production configuration must reject emulator mode.
A future production gateway requires a separately approved protocol plan. It must
not be ERP-based.

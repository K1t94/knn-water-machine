# Implementation Plan: Machine Discovery and Selection

**Feature**: `006-machine-discovery-and-selection`  
**Branch**: `machine-discovery-and-selection-feature`  
**Specification**: `specs/006-machine-discovery-and-selection/spec.md`  
**Date**: 2026-08-13

## Summary

Build a standalone, authenticated consumer machine-discovery boundary owned by
the new application. NestJS and PostgreSQL own the customer catalog, exact
identifier mappings, price, publication state, and availability evidence. The
API projects a strict allowlisted representation for Expo/React Native; mobile
never receives raw telemetry or internal identifiers and never talks to MQTT or
ERP.

The first implementation uses controlled fixtures and an application-owned
availability emulator behind a replaceable port. ERP reference material is only
a read-only example of domain behavior. There is no current or future ERP
integration, adapter, client, import, synchronization, polling, webhook, shared
database, or runtime dependency.

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js 24, React 19.1
**Backend**: NestJS 11, Prisma 6, PostgreSQL 18, RxJS 7  
**Mobile**: Expo SDK 54, React Native 0.81.5, MobX 6, RxJS 7, React Navigation 7  
**New mobile runtime dependencies**: `expo-location`, `expo-camera`,
`react-native-maps`, installed with Expo's SDK-aware installer  
**Storage**: Application-owned PostgreSQL; Redis only for existing platform
concerns, not as the catalog authority  
**Testing**: Vitest, Supertest, Testcontainers, React Native Testing Library,
Maestro  
**Target platforms**: NestJS API, iOS, Android  
**Performance goals**: first 20 catalog entries within 2 seconds under the
specified reference conditions; supported unobstructed QR detection-to-current-card
flow within 3 seconds; stable bounded pagination
**Security**: authenticated endpoints, validated inputs, safe error taxonomy,
allowlisted DTOs, no raw telemetry/topics/credentials/internal identifiers  
**Scale assumption**: MVP regional catalog; no evidence presently justifies
PostGIS or a separate search service

## Constitution Check

| Current constitution principle | Plan evidence | Status |
|---|---|---|
| I. One Logical Diff At A Time | Tasks are split into dependency-ordered test-first and implementation diffs with exact files; dependency, schema, auth, and security changes remain explicit. | PASS |
| II. Validate Inputs At Boundaries | Authenticated controller DTOs validate coordinates, viewport bounds, identifiers, QR payloads, cursors, revisions, money, and currency at their boundaries. | PASS |
| III. Shape Public Outputs Explicitly | All success and error responses pass through allowlisted DTO mappers that exclude private identifiers, telemetry, topics, and credentials. | PASS |
| IV. Schema Changes Use Migrations | All new tables, enums, constraints, triggers, and indexes are introduced by the reviewed forward-only Prisma migration; automatic synchronization is prohibited. | PASS |
| V. Security-Sensitive Behavior Is High Risk | Every route uses the existing access-session guard; cursor secrets, session isolation, production gates, and uniform safe errors have targeted tests. | PASS |
| VI. Minimal Validation After Each Change | Every task names the smallest relevant build, typecheck, test, migration, visual, or readback validation command; targeted Vitest checks use `pnpm --filter <package> exec vitest run <path>` rather than forwarding filters through the package-wide test script. | PASS |
| VII. Durable Style Memory Is Human-Guided | This feature does not modify `.codex/docs/ai-style-memory.md`; no style promotion is implied by implementation work. | PASS |
| VIII. Context Is A Resource | Work is scoped to the feature artifacts, relevant API/mobile modules, current mockups, and the read-only compatibility report; ERP is excluded from runtime and implementation. | PASS |
| IX. Frontend Reactive Architecture | One MobX store owns feature state; private RxJS workflows implement cancellation and concurrency; screens stay presentation-oriented and all subscriptions have disposal. | PASS |

No constitution violation is required. Re-check after design: the Phase 1 model
and contracts retain these properties and introduce no exception.

## Source Boundaries

### Authoritative inputs

1. `specs/006-machine-discovery-and-selection/spec.md`
2. Relevant discovery and machine-selection sections of
   `docs/mvp-requirements.md`
3. Current repository architecture and constitution
4. Mockups 02, 03, 04, and 10 for visual hierarchy only

`docs/integrations/machine-discovery-compatibility-report.md` and
`../erp-reference` are non-authoritative examples used only to understand domain
behavior, legacy ambiguity, and disclosure risks. Recommendations that imply ERP
ownership or integration are superseded by this plan.

## Project Structure

### Planning artifacts

```text
specs/006-machine-discovery-and-selection/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── machine-discovery.openapi.yaml
│   └── selection-handoff.md
└── spec.md
```

### Backend boundaries

```text
apps/api/
├── prisma/
│   ├── migrations/<timestamp>_add_machine_discovery_catalog/
│   │   └── migration.sql
│   ├── schema.prisma
│   └── seed-machine-discovery.ts
├── src/
│   ├── app.module.ts
│   ├── config/
│   │   ├── env.ts
│   │   └── env.machine-discovery.spec.ts
│   └── machines/
│       ├── machines.module.ts
│       ├── http/
│       │   ├── machine-discovery.controller.ts
│       │   ├── machine-selection.controller.ts
│       │   ├── machine-response.mapper.ts
│       │   └── dto/
│       ├── application/
│       │   ├── discover-machines.service.ts
│       │   ├── get-machine-detail.service.ts
│       │   ├── resolve-machine-identifier.service.ts
│       │   ├── revalidate-machine-selection.service.ts
│       │   └── ports/
│       │       ├── clock.port.ts
│       │       ├── machine-gateway.port.ts
│       │       └── machine.repository.ts
│       ├── domain/
│       │   ├── availability-projector.ts
│       │   ├── identifier-normalizer.ts
│       │   └── machine.types.ts
│       └── infrastructure/
│           ├── postgres/prisma-machine.repository.ts
│           ├── postgres/postgres-distance.repository.ts
│           ├── signed-catalog-cursor.ts
│           └── emulated-machine-gateway.ts
└── test/
    └── machines/
```

Controllers validate transport input, invoke one application service, and shape
documented responses. They contain no distance, availability, QR, or selection
business logic.

### Mobile boundaries

```text
apps/mobile/
├── app.config.ts
└── src/
    ├── App.tsx
    ├── api/
    │   ├── machine-discovery-api.ts
    │   └── machine-discovery-contracts.ts
    ├── navigation/
    │   ├── MainNavigator.tsx
    │   └── RootNavigator.tsx
    ├── machine-discovery/
    │   ├── machine-discovery-composition-root.ts
    │   ├── native/
    │   │   ├── LocationAdapter.ts
    │   │   ├── ExpoLocationAdapter.ts
    │   │   ├── ScannerAdapter.ts
    │   │   └── ExpoScannerAdapter.ts
    │   ├── stores/
    │   │   └── machine-discovery.store.ts
    │   ├── services/
    │   │   └── machine-discovery-flow.service.ts
    │   ├── machine-discovery.types.ts
    │   ├── screens/
    │   │   ├── MachineDiscoveryScreen.tsx
    │   │   ├── MachineDetailScreen.tsx
    │   │   └── MachineScannerScreen.tsx
    │   └── components/
    │       ├── MachineMap.tsx
    │       ├── MachineList.tsx
    │       ├── MachineCard.tsx
    │       └── ManualMachineCodeForm.tsx
    ├── testing/
    └── wallet/screens/WalletScreen.tsx
```

`MachineDiscoveryStore` is the sole owner of discovery context, deduplicated
entities, map/list view, permission, scanner, card, and selected-machine state.
React local state is limited to ephemeral visual mechanics that are not shared
application state.

`App` constructs machine discovery only for the current valid authenticated
account, `RootNavigator` passes that scope into `MainNavigator`, and a visible
Wallet action opens `MachineDiscovery`. Expiry with failed renewal, logout, or
account replacement removes the entry and disposes the prior scope before a new
one can be constructed after successful authentication.

## Architecture Decisions

### Catalog ownership and public identity

- PostgreSQL in this application is the only catalog authority.
- `machineId` is a cryptographically random, immutable, opaque 128-bit public
  identifier encoded as 22 base64url characters. It is distinct from the
  internal UUID primary key and from customer-entered codes.
- A nullable catalog display name is mapped to a localized generic customer
  fallback; the fallback never embeds internal or public identifiers.
- Publication controls public visibility independently from operational status.
- Identifier aliases live in a private table and are never serialized.
- Development/test data comes from deterministic fixtures, never ERP.

### Availability

- A backend projector produces only `ONLINE`, `SERVICE`, or `OFFLINE`.
- `SERVICE` wins when explicit maintenance/service mode is active.
- Otherwise `ONLINE` requires published/non-deleted catalog state, valid price
  and currency, fresh authoritative evidence, reachability, readiness, sales
  allowance, and no explicit offline evidence.
- All missing, unknown, stale, malformed, or conflicting evidence fails closed to
  `OFFLINE`. Invalid price/currency also makes selection ineligible.
- Detail refresh and selection revalidation query the configured
  `MachineGateway` port. The initial implementation binds only the controlled
  read-only availability emulator; the port has no command capability. No ERP
  implementation exists or is planned.

### Geographic discovery

- Coordinates use PostgreSQL `NUMERIC`, with latitude then longitude throughout
  all API and domain types.
- PostgreSQL calculates Haversine straight-line distance in a parameterized
  query. No PostGIS dependency is added for the MVP scale.
- Located ordering is `(distanceMeters ASC, machineId ASC)`; non-located ordering
  is `(machineId ASC)` within the configured service area.
- The opaque signed keyset cursor binds the normalized query context, catalog
  ordering revision, last sort key, and expiry. A catalog-ordering revision
  mismatch returns a stale-context conflict and requires refresh instead of
  silently producing duplicates or omissions.
- Optional viewport bounds are validated, bounded, and cursor-bound. Invalid or
  missing machine coordinates are excluded from map markers and discovery-list
  results. They remain reachable only through exact QR or manual identification
  when their public card and eligibility data are otherwise valid.
- User coordinates are request-scoped only and are not persisted or included in
  application logs/analytics.

### Acceptance performance profile

- Timed acceptance uses a warm authenticated application, deterministic fixtures,
  a supported release device, and a controlled network whose per-request
  round-trip latency is between 80 and 120 ms inclusive, so no request deviates
  from the 100 ms reference latency by more than 20 ms; no packet loss is injected.
- Automated suites apply that profile through test-only transport wrappers around
  the API request boundary and mobile API adapter. The wrappers use a seeded delay
  schedule whose measured round trip stays between 80 and 120 ms, inject no packet
  loss, expose the seed in results, and are never registered in production DI.
- Physical-device E2E runs use that same test/E2E-only mobile transport profile
  through the isolated bootstrap. Before every trial set, the runner performs a
  fail-closed preflight against an exact fixture origin from the E2E allowlist.
  The preflight must not follow redirects and must receive the expected
  `machine-discovery-e2e` environment marker, fixture-catalog identifier, and an
  echo of the runner nonce before accepting bootstrap-issued test credentials;
  an unknown origin, marker/catalog mismatch, nonce mismatch, redirect, or
  production credential provenance aborts the set. Every timed run records the
  profile identifier and seed, observed request round-trip samples, and an
  injected-packet-loss count of zero; any sample outside 80-120 ms, missing
  attestation, or injected loss invalidates the set. The allowlist, profile, and
  evidence path remain unavailable in production builds.
- Physical acceptance runs on a non-distributable release-mode E2E build. It
  retains production release compiler/runtime settings but differs from the
  production-distributable build only by the isolated bootstrap, controlled
  fixture transport, recorder, and visible E2E probes. Boundary tests must prove
  that none of those capabilities can be registered in the
  production-distributable build, and evidence records the exact build variant.
- Mobile service-level timing suites provide deterministic workflow regression
  evidence only. Device-level acceptance measures the actual rendered useful
  map/list boundary and completed navigation handoff in the release-mode E2E app.
- Device-level discovery timing uses the existing Maestro E2E runner together
  with a test/E2E-only in-app performance recorder that cannot be registered in
  production builds. Fixed `machine-discovery:device-perf` and
  `machine-discovery:device-perf:validate` package scripts execute the runner and
  validate its machine-readable evidence. Separate map and list trial sets run on
  each physical supported platform. The discovery timer starts with the
  authenticated action that opens discovery and stops when the selected surface
  has rendered useful fixture results. The selection timer starts with the enabled
  confirmation action and stops when the destination route has accepted the typed
  handoff and its E2E-only destination probe is visibly complete. Recorder hooks
  are wired explicitly through the isolated E2E bootstrap into the discovery
  screen, map/list result boundaries, detail confirmation, and navigation handoff;
  they observe UI completion rather than MobX or service-state transitions. The
  runner, exact command, start/end observations, and raw-result format remain
  unchanged for all runs in a set. Before physical trials, a runner smoke test uses
  a stubbed Maestro process and fixture evidence to verify orchestration, argument
  forwarding, preflight failure, result collection, and non-zero failure exits.
- Discovery and selection latency use at least 100 automated measured runs and
  require at least 95% of runs to meet their specification thresholds.
- QR timing and each of the separate map-to-card and list-to-card interaction
  outcomes use at least 20 recorded trials per supported platform and require at
  least 19 successful trials in every set.
- The acceptance matrix uses one physical iOS device and one physical Android
  device supported by the tested release build, plus compact and large screen
  configurations on each platform. The exact build, model, OS, logical viewport,
  and runtime are fixed and recorded before each trial set; a change to any
  recorded build, device, OS, viewport, or runtime value forms a new trial set
  rather than being merged with earlier measurements.
- Device-level raw results are stored as JSON in
  `performance-results/device-acceptance.json`; `performance-validation.md`
  contains the human-readable calculated summary. The validator independently
  requires all six iOS/Android map/list/selection sets, at least 100 raw results per
  set, fixed build/device/OS/viewport/network-profile metadata within each set,
  valid per-run network attestations with every observed request round trip in the
  inclusive 80-120 ms range and zero injected packet loss, at least 95 results no
  slower than 2 seconds, and pass-count/p95 values matching the raw timings.
  Missing, malformed, inconsistent, or failing evidence is rejected.

### Isolated mobile E2E bootstrap

- Maestro journeys use an E2E-only bootstrap that authenticates a deterministic
  fixture account, injects the machine-discovery scope, fixes the acceptance
  clock, resets PostgreSQL fixtures, and exposes controlled price, status, and
  evidence transitions needed by the journeys.
- The bootstrap and control transport are unavailable outside test/E2E builds.
  Production builds cannot register their modules or routes, and neither
  production credentials nor production machine endpoints are accepted.
- Journey execution waits for this bootstrap and for the authenticated
  composition root; authoring and static validation of journey YAML may precede
  that runtime integration.

### API and stale-result protection

- All four routes require the existing access-session guard.
- Errors expose stable consumer codes and correlation IDs, never database,
  identifier-mapping, telemetry, MQTT, or catalog-internal details.
- Unknown, hidden, archived, deleted, non-customer, and inaccessible identifiers
  all return the same `MACHINE_NOT_FOUND` representation.
- Every public detail carries a consumer-safe `machineRevision` that changes
  whenever selection-relevant data changes. It is a public stale-context token,
  not a raw persistence revision or internal database identifier.
- Selection revalidation accepts the displayed revision. If price, publication,
  or eligibility changed, it returns `MACHINE_CONTEXT_CHANGED` with a freshly
  allowlisted detail and does not produce a handoff.

### Mobile state and concurrency

- The current account-bound store owns one discovery context across map/list
  switches.
- The workflow uses `switchMap` for superseding position, viewport, refresh,
  detail, QR, manual, logout, and account-replacement work; `exhaustMap` for page
  append and selection confirmation; and scanner gating plus time-window
  suppression for duplicate QR detections.
- Each result is tagged with session epoch and request generation. Reducers
  ignore results that do not match the active epoch/generation.
- Expiry with failed renewal, logout, and account replacement increment the
  epoch, cancel subscriptions, clear catalog/card/scanner/handoff state, and
  dispose the current scope. A fresh scope is created only after successful
  authentication establishes a new valid session.
- Workflow and native adapters with subscriptions expose idempotent `dispose()`.

## API Surface

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/machines` | Bounded incremental catalog discovery with optional location/viewport context |
| `GET` | `/v1/machines/{machineId}` | Fresh consumer-safe card/detail |
| `POST` | `/v1/machines/resolve` | Exact QR or manual-code resolution |
| `POST` | `/v1/machines/{machineId}/selection-revalidation` | Final current eligibility/price check and typed handoff |

The normative transport definition is
`contracts/machine-discovery.openapi.yaml`. The navigation-only handoff is
defined in `contracts/selection-handoff.md`.

## Schema Changes and Forward Migrations

One forward migration, `add_machine_discovery_catalog`, introduces:

1. Enums for publication state, service mode, evidence state, and identifier
   kind.
2. `machines` with separate internal UUID and immutable unique public identity.
3. `machine_locations` with address and paired validated coordinates.
4. `machine_prices` with exact PostgreSQL numeric amount, ISO currency, and
   selection revision fields.
5. `machine_identifier_mappings` with normalized exact aliases and global
   collision protection.
6. `machine_availability_evidence` with freshness timestamps and emulator-owned
   readiness facts.
7. `machine_catalog_state` singleton with ordering revision used by cursors.
8. Check constraints, foreign keys, partial indexes, and exact-lookup indexes
   listed in `data-model.md`.

No automatic schema synchronization is allowed. The migration is forward-only;
rollback in production is restore/forward-fix, not destructive down migration.
Seed data is separate from the migration and is allowed only in controlled
development/test environments.

## New Runtime Dependencies

| Package | Scope | Reason |
|---|---|---|
| `expo-location` | mobile | Foreground permission and one-shot/coarse-to-precise position behind a typed adapter |
| `expo-camera` | mobile | `CameraView` barcode scanning restricted to configured QR types; no media recording |
| `react-native-maps` | mobile | Stable SDK 54-supported native map; avoids the alpha `expo-maps` package |

Use `pnpm --filter @kaynann/mobile exec expo install <package>` so Expo selects
the SDK-compatible release. SDK 54 documentation currently lists
`expo-location ~19.0.8`, `expo-camera ~17.0.10`, and `react-native-maps 1.20.1`;
the lockfile, not a hand-entered version, is authoritative at implementation
time. No backend runtime dependency and no geospatial extension are required.

## Native Configuration

- Add Expo config plugins for foreground location and camera permission strings.
- Do not request background location or microphone/recording permission.
- Configure Android Google Maps API key through deployment secrets/config, never
  source control. iOS defaults to Apple Maps unless product requirements later
  approve Google Maps configuration.
- Model `undetermined`, `granted`, `denied`, `restricted`, `revoked`, and
  `unavailable` states. All non-granted states retain list/manual fallback.
- Mount only one camera preview and disable/unmount it whenever the scanner route
  is unfocused.

## Delivery Phases

### Phase 0: Research

Complete `research.md`: ownership, identifiers/QR, exact mappings,
availability/freshness, money, geography/pagination, native packages, safe
errors, MobX/RxJS teardown, and emulator decisions. Unknown production protocol
facts become fail-closed rollout gates, not implementation clarifications.

### Phase 1: Design and contracts

Complete `data-model.md`, OpenAPI, typed selection handoff, and `quickstart.md`.
Validate the plan against the constitution and refresh the managed Spec Kit
agent context.

### Phase 2: Implementation outline

1. Add the reviewed Prisma migration, configuration schema, fixtures, and
   deterministic clock.
2. Implement domain normalization, availability projection, emulator port, and
   repositories with unit/integration tests.
3. Implement authenticated controllers, DTO shaping, OpenAPI generation, and
   security/pagination contract tests.
4. Add Expo dependencies/config and typed API/native adapters.
5. Implement the MobX store and RxJS workflow with cancellation/session tests.
6. Build map/list, card, scanner, and manual fallback following mockups without
   their illustrative data or out-of-scope controls.
7. Run backend, mobile, permission, concurrency, stale-result, and E2E scenarios
   from `quickstart.md`.

This outline informs later task generation; this command does not modify
`tasks.md` or production code.

## Testing Strategy

- Domain unit tests: normalization, alias collisions, status precedence,
  freshness boundaries, price validation, QR grammar, cursor signatures.
- PostgreSQL integration tests: constraints, Haversine ordering, tie-breakers,
  viewport bounds, revision conflicts, safe lookup, and pagination completeness.
- API tests: authentication, validation, allowlist snapshots, uniform not-found,
  stale selection, retry-safe errors, and absence of sensitive fields.
- Mobile tests: store ownership, deduplication, map/list continuity, permissions,
  scanner/manual fallback, request supersession, duplicate event suppression,
  session epoch teardown, and `dispose()`.
- E2E: deterministic catalog, map/list/card/scanner flow, price/status changes,
  delayed response races, logout/account replacement, and no purchase side
  effects.
- Performance acceptance: 100-run automated API and mobile service-level timing
  suites under the controlled network profile, followed by six Maestro-driven
  100-run device-level sets measured by a test/E2E-only in-app recorder at the
  actual rendered discovery and completed navigation boundaries. A dedicated
  validator recalculates pass counts and percentiles from raw JSON evidence.
  Separate sets of at least 20 physical trials per supported platform cover QR
  timing, map interaction count, and list interaction count, with raw measurements
  and pass-rate calculations retained in the validation artifacts.

## Complexity and Risk Register

| Risk | Mitigation / gate |
|---|---|
| Production machine protocol is unconfirmed | Emulator only; production adapter cannot ship until authenticated protocol, payload semantics, freshness, and failure modes are approved. |
| Legacy QR payload is unverified | Development-only fixtures; production legacy format remains disabled until an actual deployed payload is supplied through a protected input, validated without logging or committing its raw value, and recorded by fingerprint and approval evidence. |
| Catalog mutates during pagination | Cursor binds catalog ordering revision; stale contexts fail explicitly and refresh. |
| Native permission/platform differences | Typed adapters, exhaustive permission states, device tests, list/manual fallback. |
| Price/status changes between card and confirmation | Selection endpoint refreshes and compares `machineRevision`; changed context never advances. |
| Sensitive internal data leaks | DTO allowlist tests and a uniform external error taxonomy. |
| Future growth exceeds numeric Haversine query | Measure query plans and catalog size first; PostGIS is a later evidence-based migration, not an MVP dependency. |

## Explicitly Out of Scope

- Volume selection, total calculation, purchase, reservation, payment, wallet
  balance/top-up/debit/transaction behavior, dispensing sessions, or machine
  commands; a presentation-only Wallet navigation entry into machine discovery
  remains in scope
- MQTT command workflows, firmware, or production machine connectivity
- Payment-provider merchant QR
- Search, favorites, ratings, routes, booking, advanced filters, or catalog admin
- Any current or future ERP integration or indirect/direct runtime dependency
- ERP adapters, clients, ingestion ports, synchronization, import, polling,
  webhooks, shared databases, code/DTO ports, or ERP-derived seed data

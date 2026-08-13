# Phase 1 Quickstart: Machine Discovery and Selection

This is the implementation validation guide. Commands that reference machine
files/scripts become runnable after Phase 2 creates them; the current planning
command intentionally does not add production code or modify `tasks.md`.

## Prerequisites

- Node.js 22 and pnpm 10
- Docker for PostgreSQL/Redis integration tests
- Xcode or Android Studio plus an Expo development build for native map/camera
- No ERP service, credentials, database, network access, or checkout setup is
  required or permitted

## Planned Setup

```bash
pnpm install
pnpm services:up
pnpm db:migrate
pnpm --filter @kaynann/api machine-discovery:seed
pnpm dev
```

The planned seed command must refuse production, reset only feature-owned fixture
rows, use deterministic local values, and never read `../erp-reference`.

Install native dependencies through Expo's compatibility resolver during the
implementation diff:

```bash
pnpm --filter @kaynann/mobile exec expo install expo-location expo-camera react-native-maps
```

Set development-only machine configuration in the local environment using the
typed config names documented in `.env.example`:

```dotenv
MACHINE_GATEWAY_MODE=emulator
MACHINE_FIXTURE_MODE=true
MACHINE_LEGACY_QR_ENABLED=false
MACHINE_CURSOR_TTL_SECONDS=300
MACHINE_AVAILABILITY_FRESHNESS_SECONDS=60
MACHINE_AVAILABILITY_ALLOWED_CLOCK_SKEW_SECONDS=5
MACHINE_SERVICE_AREA_NORTH=56.10
MACHINE_SERVICE_AREA_EAST=38.20
MACHINE_SERVICE_AREA_SOUTH=55.40
MACHINE_SERVICE_AREA_WEST=36.70
```

Inject `MACHINE_CURSOR_HMAC_KEY` separately as at least 32 random
base64url-encoded bytes. Do not put deployed secret values in `.env.example`,
this quickstart, source control, image build arguments, or application logs.

Staging and production reject `MACHINE_GATEWAY_MODE=emulator`,
`MACHINE_FIXTURE_MODE=true`, and `MACHINE_LEGACY_QR_ENABLED=true`. Leave the
gateway disabled until a production adapter and its protocol have been
separately approved. Android Maps credentials are also deployment secrets and
must be injected outside source control.

## Static Validation

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm openapi:generate
pnpm openapi:check
```

Verify the generated OpenAPI includes exactly the four feature routes and that
response snapshots contain no internal UUID, identifier mapping, serial/modem
identifier, topic, credentials, raw evidence, or source metadata.

## Backend Scenarios

### Authentication and validation

1. Call each route without a token and expect the standard safe `401` envelope.
2. Supply one coordinate without the other, incomplete viewport bounds, invalid
   ranges, oversized code/cursor, and malformed public IDs; expect `400` with no
   framework/database details.
3. Expire/revoke the session and confirm no cached protected catalog is returned.

### Catalog and deterministic pagination

1. Seed more than 20 machines, including identical-distance pairs, unpublished
   records, missing coordinates, and invalid/offline evidence.
2. Request `limit=20` with location and verify ascending Haversine distance then
   `machineId` tie-break.
3. Follow all cursors and assert no duplicate or omitted public `machineId`.
4. Repeat the same context and assert stable ordering.
5. Change price/status only and confirm ordering cursor remains valid while item
   projections refresh.
6. Change publication/location, then reuse the old cursor and expect
   `409 DISCOVERY_CONTEXT_STALE`, never a mixed page.
7. Deny location and verify configured-service-area results ordered by
   `machineId`, with no user distance field.
8. Request a viewport and verify only valid in-bounds coordinates become map
   results; invalid/missing coordinates never produce markers.

### Availability and clock

Use the deterministic clock/emulator to verify:

| Fixture | Expected result |
|---|---|
| Fresh `READY`, reachable, ready, sales allowed, valid price | `ONLINE`, selectable |
| Explicit service mode with any evidence | `SERVICE`, not selectable |
| Explicit `OFFLINE` | `OFFLINE`, not selectable |
| Missing or `UNKNOWN` evidence | `OFFLINE`, not selectable |
| Observation exactly inside configured freshness | `ONLINE` if all other gates pass |
| Observation beyond freshness | `OFFLINE`, not selectable |
| Observation beyond allowed future skew | `OFFLINE`, not selectable |
| Missing/invalid price or currency | `OFFLINE`, not selectable |

Advance the clock without a write and confirm detail/selection recomputes stale
evidence as offline.

### Exact identifier resolution and disclosure safety

1. Resolve `kaynann://machine/v1/<machineId>` and a valid current manual code.
2. Verify manual trim/approved case normalization and exact matching.
3. Test arbitrary HTTPS/custom URLs, payment-provider QR, unsupported versions,
   Unicode confusables, fuzzy substrings, disabled aliases, and ambiguous fixture
   setup; all must fail safely.
4. Compare unknown, hidden, archived, deleted, non-customer, inaccessible, and
   unmapped responses; status/body shape must be indistinguishable.
5. Verify production legacy resolution remains disabled without a reviewed
   anonymized payload and `verifiedAt` mapping.

### Detail and selection revalidation

1. Open a card and assert availability/publication/price are freshly projected.
2. Confirm an unchanged `ONLINE` revision and receive the typed handoff.
3. Change the price after card load; confirmation must return
   `MACHINE_CONTEXT_CHANGED` with fresh safe detail and no handoff.
4. Change status to `SERVICE`, `OFFLINE`, stale, hidden, or deleted; confirmation
   must not advance.
5. Retry the endpoint and verify it creates no purchase, reservation, wallet,
   dispense, MQTT, or other persistent side effect.

Suggested targeted commands after test files exist:

```bash
pnpm --filter @kaynann/api test -- src/machines
pnpm --filter @kaynann/api test:integration -- machines
pnpm --filter @kaynann/api test:e2e -- machines
```

## Mobile Scenarios

### Permission and native fallbacks

Test iOS and Android with location/camera states `undetermined`, `granted`,
`denied`, `restricted`, `revoked`, and `unavailable`:

- The list remains usable without location.
- The configured service area is shown when user position is unavailable.
- Scanner failures retain a manual-code path.
- Only one focused camera preview exists; leaving the route stops detections.
- Safe Area, keyboard, compact screens, and orientation-supported layouts do not
  obscure primary actions/errors.

### State ownership and view continuity

1. Load pages in list view, switch to map, and verify deduplicated machines,
   viewport/discovery context, card, and permission state are retained by the one
   MobX owner.
2. Switch back and verify there is no duplicate request solely due to rendering.
3. Assert screens expose no public Subject/long-lived subscription and do not
   mirror discovery state in React local state.

### Concurrency and stale-response safety

Use fake adapters and delayed Observables:

1. Emit positions A then B with A responding last; only B may update state.
2. Change viewport during loading; the previous response must be ignored.
3. Trigger refresh during pagination; old page append must not mutate the new
   generation.
4. Scan the same QR repeatedly; only one lookup/card transition occurs in the
   suppression window.
5. Tap confirmation repeatedly; only one revalidation/navigation handoff occurs.
6. Log out or replace the account while every workflow type is in flight; all
   work is cancelled and late results cannot restore old state.
7. Call `dispose()` twice and assert no active subscriptions or later mutations.

Suggested targeted command after tests exist:

```bash
pnpm --filter @kaynann/mobile test -- machine-discovery
```

## UI Comparison

Visually compare native components against:

- `docs/design/mockups/03_machine_selection_hd.png`
- `docs/design/mockups/04_machine_purchase_hd.png`
- `docs/design/mockups/10_qr_scanner_hd.png`

Preserve map/list, card, scanner, spacing, hierarchy, and interaction states. Do
not implement or copy search, advanced filters, favorites, volume/total/purchase
controls, Ghana addresses, `+233`, USD, sample names/prices, fixed values, or
unapproved machine imagery.

## End-to-End Acceptance Run

```bash
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm --filter @kaynann/mobile test:e2e
```

Run device-specific camera/map permission checks separately; simulators alone do
not validate camera behavior. Capture discovery-opening and supported unobstructed
QR detection-to-current-card timings under the feature spec's reference network
conditions and verify the 2-second/3-second targets.

## Security Exit Checklist

- Every endpoint uses the access-session guard.
- Coordinates are request-scoped and absent from persistence/logging/analytics.
- Cursor signatures reject tampering and query-context reuse.
- Public JSON/OpenAPI contains only allowlisted fields.
- All inaccessible machine categories share one not-found representation.
- QR parsing never opens arbitrary URLs.
- Emulator mode cannot run in production.
- No source/config/dependency references ERP as runtime, upstream, master,
  integration target, or temporary data source.

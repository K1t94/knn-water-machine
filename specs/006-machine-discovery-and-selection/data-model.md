# Phase 1 Data Model: Machine Discovery and Selection

## Ownership and Privacy

All persistent entities in this document belong to the new application and live
in its PostgreSQL database. The model has no ERP foreign keys, remote identifiers,
sync metadata, import state, or shared tables. Internal UUIDs, identifier mapping
rows, evidence facts, and emulator configuration are never public API fields.

## Enumerations

### `MachinePublicationState`

- `PUBLISHED`: eligible for consumer discovery when not deleted.
- `HIDDEN`: intentionally unavailable to all consumer discovery/lookup.
- `ARCHIVED`: retained for audit/history but unavailable to consumers.

### `MachineServiceMode`

- `NORMAL`: availability is projected from evidence.
- `SERVICE`: customer-facing status is `SERVICE`; selection is forbidden.

### `MachineEvidenceState`

- `READY`: evidence may contribute to `ONLINE` if all boolean conditions pass.
- `OFFLINE`: explicit offline evidence.
- `UNKNOWN`: evidence cannot establish availability.

### `MachineIdentifierKind`

- `CURRENT_MANUAL`: approved current customer-entered code.
- `LEGACY_MANUAL`: approved legacy customer-entered code.
- `LEGACY_QR`: approved and verified legacy QR payload fingerprint/value.

The versioned application QR uses public `machineId` directly and does not need
an alias row.

## Entities

### `Machine`

Catalog aggregate root.

| Field | Storage | Validation / semantics |
|---|---|---|
| `id` | UUID PK | Internal only, generated server-side. |
| `machineId` | VARCHAR(22) | Random 128-bit base64url, unique, immutable, public. |
| `displayName` | VARCHAR(120) nullable | Trimmed safe customer copy; null uses a localized generic fallback with no identifiers. |
| `publicationState` | enum | Defaults `HIDDEN`; only `PUBLISHED` is consumer-visible. |
| `serviceMode` | enum | Defaults `SERVICE` until evidence/configuration is ready. |
| `selectionRevision` | BIGINT | Monotonic aggregate revision, starts at 1. |
| `deletedAt` | TIMESTAMPTZ nullable | Soft deletion; any value makes public lookup indistinguishable from absent. |
| `createdAt` | TIMESTAMPTZ | Server timestamp. |
| `updatedAt` | TIMESTAMPTZ | Server timestamp. |

Invariants:

- `machineId` is generated once; repository methods and a database trigger reject
  any update after insertion.
- The response mapper emits a localized equivalent of `Water machine` when
  `displayName` is null; it never appends internal UUID, public ID, alias, or
  serial/modem data.
- `selectionRevision` increments transactionally for changes to publication,
  service mode, public copy/location, price, identifier ownership, or evidence
  facts that can alter selection/card output.
- Deleted, hidden, and archived records never resolve publicly.

### `MachineLocation`

One current public location per machine.

| Field | Storage | Validation / semantics |
|---|---|---|
| `id` | UUID PK | Internal only. |
| `machineInternalId` | UUID FK UNIQUE | Required owner; `ON DELETE RESTRICT`. |
| `address` | VARCHAR(300) | Trimmed customer-safe display address. |
| `serviceAreaCode` | VARCHAR(64) | Explicit application-owned configured service-area assignment. |
| `latitude` | NUMERIC(9,6) nullable | Latitude first; `-90 <= value <= 90`. |
| `longitude` | NUMERIC(9,6) nullable | Longitude second; `-180 <= value <= 180`. |
| `updatedAt` | TIMESTAMPTZ | Used for audit/revision changes, not availability freshness. |

Invariants:

- Latitude and longitude are both null or both non-null.
- Public APIs never swap coordinate order: `{ latitude, longitude }`.
- Missing/invalid coordinates exclude a machine from map markers and all
  discovery-list results. Such a machine may still resolve through exact QR or
  manual identification when its public card and eligibility data are valid.

### `MachinePrice`

One current authoritative consumer price per machine.

| Field | Storage | Validation / semantics |
|---|---|---|
| `id` | UUID PK | Internal only. |
| `machineInternalId` | UUID FK UNIQUE | Required owner. |
| `amountPerLiter` | NUMERIC(20,6) | Positive exact decimal; never converted to JS `number`. |
| `currency` | CHAR(3) | Uppercase supported ISO 4217 code. |
| `updatedAt` | TIMESTAMPTZ | Included indirectly through aggregate revision. |

Invariants:

- Missing, zero, negative, malformed, or unsupported price/currency makes the
  machine non-selectable and prevents `ONLINE` projection.
- API serializes `amountPerLiter` as a canonical decimal string.
- Currency belongs to the price; it is never inferred from address/location.

### `MachineIdentifierMapping`

Private exact resolution mapping.

| Field | Storage | Validation / semantics |
|---|---|---|
| `id` | UUID PK | Internal only. |
| `machineInternalId` | UUID FK | Mapping owner. |
| `kind` | enum | Selects grammar and normalization. |
| `normalizedValue` | VARCHAR(256) | Trimmed/canonical exact value; never returned publicly. |
| `enabled` | BOOLEAN | Disabled mappings do not resolve. |
| `verifiedAt` | TIMESTAMPTZ nullable | Required for production legacy mappings. |
| `createdAt` | TIMESTAMPTZ | Server timestamp. |

Invariants:

- Unique `(kind, normalizedValue)` prevents one alias mapping to multiple public
  machines under concurrent writes.
- Manual normalization is ASCII trim plus locale-independent uppercase followed
  by scheme grammar validation. QR normalization is structural and
  scheme/version-specific.
- No fuzzy, substring, Unicode-confusable, or cross-kind matching.
- Production legacy resolution requires `enabled = true` and non-null
  `verifiedAt` based on a reviewed anonymized customer payload.

### `MachineAvailabilityEvidence`

Latest application-owned evidence behind the availability port.

| Field | Storage | Validation / semantics |
|---|---|---|
| `machineInternalId` | UUID PK/FK | One evidence projection per machine. |
| `state` | enum | `READY`, `OFFLINE`, or `UNKNOWN`. |
| `reachable` | BOOLEAN | Authoritative reachability fact. |
| `readyToSell` | BOOLEAN | Machine readiness fact. |
| `salesAllowed` | BOOLEAN | Operational sales gate. |
| `observedAt` | TIMESTAMPTZ | Source observation time used for freshness. |
| `receivedAt` | TIMESTAMPTZ | Application receipt time for diagnostics. |
| `sourceRevision` | VARCHAR(100) nullable | Emulator/future-gateway idempotency marker; private. |
| `updatedAt` | TIMESTAMPTZ | Persistence timestamp. |

Invariants:

- Evidence is fresh only when `observedAt <= now + allowedClockSkew` and
  `now - observedAt <= freshnessThreshold`.
- Missing evidence, future evidence beyond allowed skew, stale evidence,
  `UNKNOWN`, `OFFLINE`, or any false readiness fact fails closed.
- The table stores normalized facts, not raw telemetry, topics, credentials, or
  payload blobs.

### `MachineCatalogState`

Singleton controlling deterministic discovery ordering.

| Field | Storage | Validation / semantics |
|---|---|---|
| `singletonKey` | SMALLINT PK | Always `1` by check constraint. |
| `orderingRevision` | BIGINT | Monotonic revision used in catalog cursors. |
| `updatedAt` | TIMESTAMPTZ | Server timestamp. |

Increment `orderingRevision` in the same transaction as changes that may alter
catalog membership/order: publication, deletion, public identity, coordinates,
or address/service-area classification. Price/evidence-only changes increment
the machine selection revision but not ordering revision.

## Relationships

```text
Machine 1 ── 0..1 MachineLocation
Machine 1 ── 0..1 MachinePrice
Machine 1 ── 0..* MachineIdentifierMapping
Machine 1 ── 0..1 MachineAvailabilityEvidence
MachineCatalogState (singleton, transactionally updated by catalog writes)
```

A missing location/price/evidence row is valid persistence state but fails closed
for the customer capability that requires it.

## Availability Projection

Projection inputs are `Machine`, `MachinePrice`, normalized evidence, configured
freshness/skew, and the injected current time.

| Condition (first match wins) | Public status | Selectable |
|---|---|---|
| Not published or deleted | Not publicly returned | No |
| `serviceMode = SERVICE` | `SERVICE` | No |
| Missing/invalid price or currency | `OFFLINE` | No |
| Evidence missing/unknown/explicit offline | `OFFLINE` | No |
| Evidence stale or too far in the future | `OFFLINE` | No |
| Not reachable, not ready, or sales disallowed | `OFFLINE` | No |
| All required evidence fresh and true | `ONLINE` | Yes |

Transitions:

- Publish: `HIDDEN -> PUBLISHED`; visibility begins but defaults to fail-closed
  status until price/evidence are valid.
- Service entry: `NORMAL -> SERVICE`; public status immediately becomes
  `SERVICE`, selection revision increments.
- Service exit: `SERVICE -> NORMAL`; projection reevaluates current evidence and
  may be `ONLINE` or `OFFLINE`.
- Explicit offline: evidence becomes `OFFLINE`; projection is `OFFLINE`.
- Staleness: no write is required; passage of injected time changes projection
  to `OFFLINE`. Selection/detail always recomputes it.
- Archive/delete/hide: machine disappears from all public discovery/resolution;
  all categories share the same safe not-found behavior.

## Public Read Shapes

### `MachineSummary`

- `machineId`
- `displayName`
- `address`
- optional `{ latitude, longitude }`
- optional `distanceMeters`
- optional `{ amountPerLiter, currency }`
- `status`: `ONLINE | SERVICE | OFFLINE`
- `machineRevision`

### `MachineDetail`

Same allowlisted fields as summary plus `refreshedAt` and `selectable`. It never
contains internal UUID, alias, serial/modem IDs, topic, credentials, raw evidence,
source timestamps, or gateway metadata.

## Cursor Model

The catalog cursor is an opaque base64url envelope plus HMAC signature containing:

- format version;
- catalog `orderingRevision`;
- normalized discovery context hash (location pair, viewport/service-area mode);
- last exact distance and `machineId`, or last `machineId` for unlocated mode;
- expiration timestamp.

The server validates signature, expiry, query-context equality, and ordering
revision before executing the next page. Invalid cursors are validation errors;
valid but superseded ordering revisions return `DISCOVERY_CONTEXT_STALE`. Cursor
contents are not a public contract and may change by version.

## Ephemeral Selection Context

Selection creates no persistent row. After successful revalidation, mobile owns:

```ts
type MachineSelectionHandoff = Readonly<{
  machineId: string;
  machineRevision: string;
  price: Readonly<{
    amountPerLiter: string;
    currency: string;
  }>;
  availability: 'ONLINE';
  validatedAt: string;
}>;
```

The future purchase boundary must treat this as navigation context, not proof of
continued eligibility, and must revalidate again before any value-affecting
operation.

## Constraints and Indexes

Required database constraints/indexes:

1. Unique B-tree on `machines.machine_id`.
2. Partial catalog index on `(machine_id)` where publication is `PUBLISHED` and
   `deleted_at IS NULL`.
3. Checks for `machine_id` format, nonblank optional display name/address,
   service-area code, paired coordinates, coordinate ranges, positive decimal
   price, uppercase currency, and singleton catalog key.
4. Unique `machine_locations.machine_internal_id` and
   `machine_prices.machine_internal_id`.
5. Unique B-tree on identifier `(kind, normalized_value)` plus lookup index
   `(kind, normalized_value, enabled)`.
6. Index on availability `observed_at` for diagnostics/maintenance; public exact
   fetch remains keyed by machine FK.
7. B-tree on `service_area_code` and the valid coordinate pair for bounded
   rectangular prefiltering. Haversine remains a computed expression for MVP;
   inspect query plans before adding geospatial infrastructure.
8. Trigger rejecting any update to `machines.machine_id`.

## Migration Plan

### Forward migration: `add_machine_discovery_catalog`

1. Create the four enums.
2. Create `machines` and identity/publication checks.
3. Create location, price, identifier, evidence, and catalog-state tables with
   foreign keys/check constraints.
4. Create the public-identity immutability trigger.
5. Create unique, partial, and lookup indexes.
6. Insert the catalog singleton with revision `1`.
7. Do not insert machines, identifiers, prices, or evidence in the migration.

### Seed/fixture operation

Separate environment-gated code inserts deterministic test machines, current
codes, verified test-only legacy codes, prices, locations, and emulator evidence.
It must refuse production and must not read from ERP or external sources.

### Rollout safety

- Run Prisma validation and migration integration tests before deployment.
- Deploy additive schema before code that reads it.
- Production rollback uses forward-fix/restore procedures; no destructive down
  migration is generated.
- Any future schema change is a new migration, never automatic synchronization.

# Backend Validation

## T118 Scope

- Date: 2026-08-31
- Host: Darwin x86_64
- Node.js: v24.18.0
- pnpm: 11.18.0
- Database: local Compose-managed PostgreSQL in a disposable database named
  `kaynann_t118_validation_20260831`
- The database had zero public tables before `prisma migrate deploy` and was
  dropped after validation.
- Local database credentials are intentionally redacted. The commands below
  use this equivalent environment variable:

```bash
export T118_DATABASE_URL='postgresql://kaynann:<LOCAL_TEST_PASSWORD>@127.0.0.1:5432/kaynann_t118_validation_20260831?schema=public'
```

The disposable database lifecycle was controlled explicitly:

```bash
docker compose -f infra/compose.yaml up -d postgres
docker compose -f infra/compose.yaml exec -T postgres \
  createdb -U kaynann kaynann_t118_validation_20260831
docker compose -f infra/compose.yaml exec -T postgres \
  psql -U kaynann -d kaynann_t118_validation_20260831 -tAc \
  "SELECT current_database(), count(*) FROM information_schema.tables WHERE table_schema = 'public';"
# kaynann_t118_validation_20260831|0
```

## Generation, Migration, And Build

```bash
pnpm --filter @kaynann/api db:generate
# PASS: Prisma Client 6.19.3 generated

DATABASE_URL="$T118_DATABASE_URL" pnpm --filter @kaynann/api db:migrate
# PASS: 7 forward migrations applied to the empty database

pnpm --filter @kaynann/api build
# PASS: Nest build completed
```

The final migration inspection reported 7 applied migrations, zero rolled-back
migrations, 19 public tables, and zero leftover `machine_*` test schemas.

```bash
docker compose -f infra/compose.yaml exec -T postgres \
  psql -U kaynann -d kaynann_t118_validation_20260831 -v ON_ERROR_STOP=1 \
  -c "SELECT count(*) AS total, count(finished_at) AS applied, count(*) FILTER (WHERE rolled_back_at IS NOT NULL) AS rolled_back FROM _prisma_migrations;" \
  -c "SELECT count(*) AS public_tables FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';" \
  -c "SELECT count(*) AS leftover_machine_test_schemas FROM pg_namespace WHERE nspname LIKE 'machine\_%' ESCAPE '\\';"
# total=7, applied=7, rolled_back=0, public_tables=19,
# leftover_machine_test_schemas=0

docker compose -f infra/compose.yaml exec -T postgres \
  dropdb -U kaynann kaynann_t118_validation_20260831
docker compose -f infra/compose.yaml exec -T postgres \
  psql -U kaynann -d postgres -tAc \
  "SELECT count(*) FROM pg_database WHERE datname = 'kaynann_t118_validation_20260831';"
# 0: the disposable database no longer exists
```

## Machine Unit And Static Suites

```bash
MACHINE_FIXTURE_MODE=false MACHINE_LEGACY_QR_ENABLED=false \
  pnpm --filter @kaynann/api exec vitest run \
  src/machines \
  test/machines/machine-schema.spec.ts \
  test/machines/machine-fixture-harness.spec.ts \
  test/machines/machine-discovery.openapi-spec.ts
# PASS: 17 files, 207 tests
```

The first run without explicit machine flags loaded the developer's ignored
`.env` value `MACHINE_FIXTURE_MODE=true` and failed the module-default
assertion. The deterministic rerun above disables fixture and legacy modes and
passed without changing production configuration.

## PostgreSQL Integration Suites

```bash
RUN_POSTGRES_INTEGRATION=1 DATABASE_URL="$T118_DATABASE_URL" \
  MACHINE_FIXTURE_MODE=false MACHINE_LEGACY_QR_ENABLED=false \
  pnpm --filter @kaynann/api exec vitest run \
  test/machines/machine-catalog-database.integration-spec.ts \
  test/machines/machine-catalog-revision.integration-spec.ts \
  test/machines/postgres-distance.repository.integration-spec.ts \
  test/machines/prisma-machine.repository.integration-spec.ts \
  test/machines/seed-machine-discovery.spec.ts
# PASS: 5 files, 19 tests
```

## Machine HTTP E2E Suites

```bash
RUN_POSTGRES_INTEGRATION=1 DATABASE_URL="$T118_DATABASE_URL" \
  MACHINE_FIXTURE_MODE=false MACHINE_LEGACY_QR_ENABLED=false \
  pnpm --filter @kaynann/api exec vitest run \
  test/machines/discover-machines.e2e-spec.ts \
  test/machines/machine-discovery-quickstart.e2e-spec.ts \
  test/machines/machine-public-boundary.e2e-spec.ts \
  test/machines/resolve-machine.e2e-spec.ts \
  test/machines/machine-selection.e2e-spec.ts
# PASS: 5 files, 55 tests

pnpm --filter @kaynann/api exec eslint \
  test/machines/discover-machines.e2e-spec.ts
# PASS
```

The first E2E run exposed a stale test module in
`discover-machines.e2e-spec.ts`: the controller's existing
`ResolveMachineIdentifierService` dependency was not registered. A test-only
mock provider was added; the complete E2E rerun then passed. No production
provider, API contract, schema, or feature behavior changed.

## Deferred Validation

- Mobile typecheck, component tests, Expo dependency checks, and runtime
  Maestro journeys belong to T119 after the isolated T124 E2E bootstrap exists.
- Physical iOS and Android map, camera, permission, focus-lifecycle, and
  performance acceptance remain assigned to their later validation tasks.

# Mobile Validation

## T119 Attempt (Incomplete)

- Date: 2026-09-01
- Host: Darwin x86_64
- Node.js: v24.18.0
- pnpm: 11.18.0
- Maestro: 2.10.0
- Device: headless Pixel 6 Android emulator, Android 37.1 x86_64
- Database: local Compose-managed PostgreSQL in the disposable database
  `kaynann_t119_validation_20260901`; all 7 migrations were applied and the
  database was dropped after the attempt.
- Runtime: the test-only Nest host and exact non-distributable
  `machine-discovery-e2e` entry used an allowlisted loopback fixture origin,
  fixture-only credentials, deterministic fixture data, and the frozen
  acceptance clock. Credentials are intentionally redacted and were not
  persisted in source or `eas.json`.

T119 remains open. Its static/unit portion passed, but the five authored Maestro
journeys did not complete on this Android runtime. The runtime blockers and
failure points are recorded below rather than treating partial execution as
acceptance evidence.

## Mobile Static And Unit Suites

```bash
pnpm --filter @kaynann/mobile typecheck
# PASS

pnpm --filter @kaynann/mobile exec vitest run \
  src/machine-discovery/screens/MachineResponsiveLayout.spec.tsx \
  src/machine-discovery/services/machine-discovery-flow.stale-results.spec.ts
# PASS: 2 files, 19 tests

pnpm --filter @kaynann/mobile exec vitest run \
  src/machine-discovery/testing/machine-discovery-e2e-bootstrap.spec.ts \
  src/machine-discovery/machine-discovery-boundaries.spec.ts
# PASS: 2 files, 17 tests

pnpm --filter @kaynann/mobile test
# PASS: 53 files, 323 tests

pnpm --filter @kaynann/mobile exec expo install --check
# PASS: dependencies match the installed Expo SDK
```

The Expo dependency check ran without registry access and used Expo's local
`bundledNativeModules.json` metadata. The first complete mobile test run caught
a direct `fetch` implementation in the machine-discovery testing layer. The
typed E2E control HTTP adapter was moved to `apps/mobile/src/api/`, leaving the
testing bootstrap as an injected consumer; the boundary tests and complete
suite then passed.

## Runtime Build And API Contract

The test-only API host started successfully against the disposable database,
and the fixture bootstrap returned the expected environment marker, catalog,
account, acceptance time, API origin, and fixture credential provenance. An
exact E2E Android build selected and bundled `apps/mobile/index.e2e.ts`:

```bash
EAS_BUILD_PROFILE=machine-discovery-e2e APP_ENV=e2e \
  EXPO_PUBLIC_APP_ENV=e2e \
  EXPO_PUBLIC_BUILD_VARIANT=machine-discovery-e2e \
  EXPO_PUBLIC_PRODUCTION_DISTRIBUTABLE=false \
  pnpm --filter @kaynann/mobile exec expo run:android --variant release
# PASS: x86_64 APK built and installed
```

The first discovery launch exposed a public contract defect: PostGIS returned a
fractional distance while the OpenAPI contract and strict mobile decoder require
an integer `distanceMeters`. The public projection now rounds distance while
the exact repository distance remains in the signed pagination cursor.

```bash
CI=true pnpm --filter @kaynann/api exec vitest run \
  src/machines/application/discover-machines.service.spec.ts
# PASS: 1 file, 10 tests

CI=true pnpm --filter @kaynann/api exec eslint \
  src/machines/application/discover-machines.service.ts \
  src/machines/application/discover-machines.service.spec.ts
# PASS

CI=true pnpm --filter @kaynann/api build
# PASS
```

After that fix, the running E2E client rendered both deterministic machine cards
with integer distances. No schema, migration, authentication, or persisted
selection behavior changed.

## Maestro Runtime Results

All five files were invoked individually against the isolated build so one
failure would not hide the status of the other journeys:

```bash
maestro test apps/mobile/e2e/machine-discovery.yaml
maestro test apps/mobile/e2e/machine-identification.yaml
maestro test apps/mobile/e2e/machine-selection.yaml
maestro test apps/mobile/e2e/machine-safe-current-results.yaml
maestro test apps/mobile/e2e/machine-session-isolation.yaml
# INCOMPLETE: 0 of 5 journeys completed
```

- `machine-discovery.yaml` loaded both fixture machines and rendered their list
  cards, but failed the first `machine-marker-*` assertion. Android Maps first
  crashed when no deployment key was injected. A transient placeholder value
  allowed the native view to initialize, but Google rejected it, leaving the
  map surface and markers unavailable. A valid `GOOGLE_MAPS_ANDROID_API_KEY`
  must be supplied externally; the placeholder is not acceptance evidence.
- The other four journeys reached the application title, then failed their
  first scanner/card assertion because an Android location permission dialog
  still covered the UI. On Android 37.1, Maestro 2.10.0's launch-time
  `location: deny` reset the permission to undetermined rather than confirming
  the user denial. The captured hierarchies contain the system
  `permission_deny_button`, not the asserted application element.
- Completion requires a supported Android runtime/tool pairing that can set a
  deterministic denied state, or explicit cross-platform system-dialog handling
  in the authored journeys, plus a valid externally injected Android Maps key.
  App-level permission or map bypasses must not be added merely to make E2E pass.

The production selector was restored after the attempt:

```bash
APP_ENV=production EAS_BUILD_PROFILE=production \
  node apps/mobile/scripts/select-machine-discovery-entry.cjs
# PASS: apps/mobile/package.json main is index.ts
```

The test-only API and Metro processes were stopped, the emulator was shut down,
and querying PostgreSQL after cleanup returned zero databases named
`kaynann_t119_validation_20260901`.

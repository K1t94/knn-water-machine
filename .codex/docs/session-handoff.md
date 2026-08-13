# Session Handoff

## Current Goal

- Finish Phase 8 validation and release hardening for feature
  `006-machine-discovery-and-selection`, one logical diff per run.

## Current State

- Tasks `T001-T118`, `T124`, `T126-T127`, and `T130-T131` are complete.
- 123 of 131 task IDs are complete; 8 remain (`T119-T123`, `T125`, and
  `T128-T129`).
- T124 now provides a runnable, isolated machine-discovery E2E path. The
  `machine-discovery-e2e` EAS profile selects `index.e2e.ts` through the EAS
  pre-install hook, while the default and production entry remains `index.ts`.
- The E2E entry registers the real authenticated application roots, obtains a
  deterministic fixture session through the concrete control transport,
  injects the machine-discovery scope, fixes the acceptance clock, and consumes
  only the allowlisted Maestro launch scenarios.
- The API has a test-only Nest host and control routes that authenticate the
  deterministic fixture account, reset its sessions and PostgreSQL machine
  fixtures, and control fixture price, status, evidence, and time.
- Mobile native launch arguments are autolinked only for the exact
  non-distributable E2E build profile. Production mobile and API build graphs do
  not import the E2E entry, native module, bootstrap, host, or routes.
- T119 static validation is now green: mobile typecheck, 53-file/323-test suite,
  targeted bootstrap/boundary tests, Expo dependency check, and the isolated
  Android E2E build all passed.
- The runtime attempt found and fixed a real response-contract defect: public
  `distanceMeters` is now rounded to an integer while the exact distance remains
  in the pagination cursor. Its targeted 10-test suite, ESLint, and API build
  pass.
- All five Maestro files were invoked, but none completed on the available
  Android 37.1 emulator. Discovery requires a valid externally injected Google
  Maps Android key; the other four flows are covered by an undismissed system
  location prompt because Maestro 2.10.0 leaves `location: deny` undetermined on
  this runtime. T119 therefore remains unchecked and the count remains 123/131.
- The disposable T119 database was dropped, runtime processes and emulator were
  stopped, and `apps/mobile/package.json` was restored to `main: index.ts`.

## Next Single Diff

- Complete only `T119`; do not start performance, legacy QR, or release
  documentation tasks.
- Supply a valid `GOOGLE_MAPS_ANDROID_API_KEY` only through the local/deployment
  environment; never persist or print it. Rebuild the exact non-distributable
  `machine-discovery-e2e` Android entry against the fixture API.
- Make denied location/camera setup deterministic by using a supported
  Android/Maestro pairing or by adding explicit cross-platform handling for the
  native permission dialog to the authored journeys. Do not add an app-level
  map or permission bypass solely for E2E.
- Execute `maestro test apps/mobile/e2e/` and require all five journeys to pass.
  Then mark T119 complete, update validation and this handoff, restore
  `main: index.ts`, clean the disposable runtime, and stop.

## Latest Relevant Validation

```bash
pnpm --filter @kaynann/mobile typecheck
# passed

pnpm --filter @kaynann/mobile test
# passed: 53 files, 323 tests

pnpm --filter @kaynann/mobile exec expo install --check
# passed using local Expo SDK metadata; network was unavailable

CI=true pnpm --filter @kaynann/api exec vitest run \
  src/machines/application/discover-machines.service.spec.ts
# passed: 1 file, 10 tests

CI=true pnpm --filter @kaynann/api exec eslint \
  src/machines/application/discover-machines.service.ts \
  src/machines/application/discover-machines.service.spec.ts
# passed

CI=true pnpm --filter @kaynann/api build
# passed

maestro test apps/mobile/e2e/<each of the five authored files>
# incomplete: 0/5 completed; Maps key and Android permission-state blockers

APP_ENV=production EAS_BUILD_PROFILE=production \
  node apps/mobile/scripts/select-machine-discovery-entry.cjs
# passed: apps/mobile/package.json main is index.ts
```

## Validation Still Needed

- T119 must complete all five Maestro journeys against the runnable E2E mobile
  build and fixture API/PostgreSQL environment. Static/unit validation is
  already green.
- The E2E runtime requires explicit fixture-only values for the API origin,
  allowed origins, and control credential; do not persist credentials in source
  or `eas.json`.
- Android map execution additionally requires a valid deployment-secret Maps
  key injected outside source control. The placeholder used only to diagnose
  native initialization is invalid and is not acceptance evidence.
- Denied location/camera states must be deterministic on the chosen runtime;
  the Android 37.1/Maestro 2.10.0 combination used in this attempt did not apply
  a confirmed denial through `launchApp.permissions`.
- Physical iOS and Android validation remains required for native map tiles,
  the live camera preview, location prompts and fallback, and focus lifecycle.
- Performance, legacy QR, interaction-trial, and final release validation remain
  for `T120-T123`, `T125`, and `T128-T129`.

## Files To Read On Resume

- `specs/006-machine-discovery-and-selection/tasks.md`
- `specs/006-machine-discovery-and-selection/validation.md`
- `apps/mobile/package.json`
- `apps/mobile/eas.json`
- `apps/mobile/scripts/select-machine-discovery-entry.cjs`
- `apps/mobile/src/machine-discovery/screens/MachineResponsiveLayout.spec.tsx`
- `apps/mobile/src/machine-discovery/services/machine-discovery-flow.stale-results.spec.ts`
- `apps/mobile/src/api/machine-discovery-e2e-control-api.ts`
- `apps/mobile/src/machine-discovery/testing/machine-discovery-e2e-bootstrap.ts`
- `apps/mobile/e2e/`
- `apps/api/src/machines/application/discover-machines.service.ts`
- `apps/api/src/machines/application/discover-machines.service.spec.ts`
- `apps/api/test/machines/support/machine-discovery-e2e-host.ts`
- `apps/api/test/machines/support/machine-discovery-e2e-server.ts`

## Constraints And Risks

- Keep the next diff limited to T119 and one logical validation change; do not
  begin T120 or later work.
- Keep `apps/mobile/package.json` on `main: index.ts` outside the exact E2E build
  hook invocation.
- Do not weaken fail-closed build, endpoint, credential, session, fixture-data,
  or production-registration checks to make Maestro execution easier.
- Preserve T115 fail-closed production gates, read-only repository/gateway
  boundaries, and the existing staging policy.
- Do not introduce schema, dependency, auth, or security-sensitive changes
  without approval.
- Never modify the read-only ERP reference repository.

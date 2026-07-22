# Tasks: Project Bootstrap Foundation

**Input**: Design documents from `/specs/001-project-bootstrap/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Scope**: Bootstrap only. Do not implement OTP, authentication flows, payments, balance/ledger, MQTT dispensing, referrals, or external provider integrations.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the pnpm monorepo, runtime metadata, autonomous app packages, and shared command surface.

- [x] T001 Create the root workspace manifest and scripts in `package.json` using pnpm 10 and Node.js 24.x LTS
- [x] T002 [P] Create the workspace package declaration in `pnpm-workspace.yaml` for `apps/*`
- [x] T003 [P] Add Node.js and package-manager pins in `.nvmrc` and `package.json`
- [x] T004 [P] Create the API package manifest and NestJS entry-point scaffold in `apps/api/package.json` and `apps/api/src/main.ts`
- [x] T005 [P] Create the Expo mobile package manifest and baseline app config in `apps/mobile/package.json`, `apps/mobile/app.config.ts`, and `apps/mobile/eas.json`
- [x] T006 [P] Create the mobile baseline screen and bootstrap test scaffold in `apps/mobile/src/App.tsx` and `apps/mobile/__tests__/App.test.tsx`
- [x] T007 Generate and commit the root dependency lockfile at `pnpm-lock.yaml` after all package manifests are defined

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Establish local infrastructure, validated configuration, migration workflow, and API boundaries required by all stories.

**CRITICAL**: No user story work can begin until this phase is complete.

- [x] T008 Create safe environment configuration and ignore rules in `.env.example` and `.gitignore`, excluding real env files, credentials, certificates, native output, dependencies, coverage, caches, and logs
- [x] T009 [P] Create the local PostgreSQL, Redis, and Mosquitto topology with healthchecks in `infra/compose.yaml`
- [x] T010 [P] Add local MQTT emulator configuration without dispensing topics or business payload contracts in `infra/mosquitto/mosquitto.conf`
- [x] T011 Configure validated runtime environment loading and redacted diagnostics in `apps/api/src/config/env.ts`
- [x] T012 Configure Prisma schema and migration commands without automatic synchronization in `apps/api/prisma/schema.prisma` and `apps/api/package.json`
- [x] T013 [P] Create the Prisma service lifecycle wrapper in `apps/api/src/prisma/prisma.service.ts` and module wiring in `apps/api/src/prisma/prisma.module.ts`
- [x] T014 [P] Create API application/module wiring and global validation/error handling in `apps/api/src/app.module.ts` and `apps/api/src/main.ts`
- [x] T015 [P] Configure lint, formatting, TypeScript, and Vitest settings in `eslint.config.mjs`, `prettier.config.mjs`, `tsconfig.json`, and `vitest.config.ts`
- [x] T016 Add root orchestration commands for `dev`, `dev:api`, `dev:mobile`, `lint`, `typecheck`, `test`, `build:api`, `build:mobile:js`, `services:up`, `services:down`, `db:migrate`, `mobile:doctor`, and `mobile:prebuild` in `package.json`
- [x] T017 Add Expo development-build scripts and platform prerequisite diagnostics in `apps/mobile/package.json` and `scripts/mobile-doctor.mjs`

**Checkpoint**: Workspace dependencies, local services, configuration boundaries, and app-level command foundations are ready.

## Phase 3: User Story 1 - Start The Development Environment (Priority: P1) MVP

**Goal**: A developer can start local dependencies and the two autonomous applications, then verify API readiness through the documented healthcheck.

**Independent Test**: From a clean checkout, run the documented install, environment, service, migration, and start commands; call `GET /health` and confirm HTTP 200 with PostgreSQL, Redis, and MQTT marked `up`.

### Tests for User Story 1

- [x] T018 [P] [US1] Add healthcheck contract tests for HTTP 200 success within 5 seconds, HTTP 503 dependency failure within 5 seconds, bounded dependency timeouts, and allow-listed response fields in `apps/api/test/health.e2e-spec.ts`
- [x] T019 [P] [US1] Add API startup smoke coverage for validated local configuration, redacted dependency failures, and a non-hanging healthcheck when a dependency is unreachable in `apps/api/test/startup.smoke-spec.ts`
- [x] T020 [P] [US1] Add the mobile baseline bootstrap test for rendering the Expo entry point in `apps/mobile/__tests__/App.test.tsx`

### Implementation for User Story 1

- [x] T021 [US1] Implement PostgreSQL, Redis, and MQTT connectivity probes with bounded latency and stable non-secret error codes in `apps/api/src/health/dependency-checks.service.ts`
- [x] T022 [US1] Implement the explicitly shaped `GET /health` response and HTTP 503 failure behavior in `apps/api/src/health/health.controller.ts` and `apps/api/src/health/health.service.ts`
- [x] T023 [US1] Register the health module and configure the API port/startup lifecycle in `apps/api/src/health/health.module.ts` and `apps/api/src/main.ts`
- [x] T024 [US1] Create and apply the initial Prisma migration for bootstrap connectivity only in `apps/api/prisma/migrations/`
- [x] T025 [US1] Implement the Expo baseline screen and development-client entry point without customer journey or business operations in `apps/mobile/src/App.tsx` and `apps/mobile/index.ts`
- [x] T026 [US1] Implement headless startup verification that starts or validates services, launches the API via the `dev:api` command path, polls `GET /health`, redacts failures, and exits non-zero on error in `scripts/verify-startup.mjs`
- [x] T027 [US1] Document the exact root startup commands `services:up`, `db:migrate`, `dev:api`, `dev:mobile`, `dev`, and `verify:start`, including the simulator/device prerequisite in `docs/local-development.md`

**Checkpoint**: User Story 1 is independently demonstrable using local services, API healthcheck, and the Expo baseline app.

## Phase 4: User Story 2 - Verify Repository Quality (Priority: P1)

**Goal**: Root-level lint, typecheck, test, and build commands validate both autonomous applications with actionable failures.

**Independent Test**: Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build:api`, and `pnpm build:mobile:js` from the repository root on a clean bootstrap checkout.

### Tests for User Story 2

- [x] T028 [P] [US2] Add API Vitest configuration and a meaningful unit smoke test for health status shaping in `apps/api/vitest.config.ts` and `apps/api/src/health/health.service.spec.ts`
- [x] T029 [P] [US2] Add mobile JavaScript test-runner configuration and baseline test execution in `apps/mobile/vitest.config.ts` and `apps/mobile/__tests__/App.test.tsx`

### Implementation for User Story 2

- [x] T030 [P] [US2] Configure API lint, typecheck, test, development, and production build scripts in `apps/api/package.json`
- [x] T031 [P] [US2] Configure Expo mobile lint, typecheck, test, JavaScript bundle/build validation, and development scripts in `apps/mobile/package.json`
- [x] T032 [US2] Ensure root scripts orchestrate both applications deterministically and generated outputs are ignored in `package.json` and `.gitignore`
- [x] T033 [US2] Add CI-equivalent local validation documentation and expected failure behavior for missing native prerequisites in `docs/local-development.md`

**Checkpoint**: User Stories 1 and 2 both pass independently; API and mobile static/test validation are available from the root.

## Phase 5: User Story 3 - Understand And Safely Configure The Repository (Priority: P2)

**Goal**: Contributors can discover actual paths, commands, runtime decisions, and safe environment boundaries without exposing secrets.

**Independent Test**: Compare the repository map with the implemented tree and root scripts, copy `.env.example`, run a secret scan, and verify that real environment files and generated artifacts are ignored.

### Tests for User Story 3

- [x] T034 [P] [US3] Add a configuration safety check for placeholder-only environment values and forbidden secret patterns in `scripts/check-env-example.mjs`
- [x] T035 [P] [US3] Add an ignore-rule/repository-map verification script for required paths and commands in `scripts/check-repo-bootstrap.mjs`

### Implementation for User Story 3

- [x] T036 [US3] Update the factual onboarding map with actual application, infrastructure, entry-point, package, and validation paths in `specs/000-project-onboarding/repo-map.md`
- [x] T037 [US3] Document the selected Expo, pnpm, Node.js, Prisma, Vitest, PostgreSQL, Redis, and Mosquitto toolchain and out-of-scope business functions in `docs/local-development.md`
- [x] T038 [US3] Add safe environment-variable descriptions and local defaults without production endpoints or credentials in `.env.example`
- [x] T039 [US3] Verify public healthcheck and startup diagnostics never serialize URLs, credentials, tokens, stack traces, or raw driver errors in `apps/api/src/health/` and `scripts/verify-startup.mjs`

**Checkpoint**: User Story 3 is independently auditable from repository documentation, ignore rules, environment templates, and safety checks.

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Validate the complete bootstrap against the specification and quickstart without adding business functionality.

- [x] T040 [P] Run `pnpm lint`, `pnpm typecheck`, and `pnpm test` and fix only bootstrap-level failures in `package.json`, `apps/api/package.json`, `apps/mobile/package.json`, and the referenced lint/typecheck/test configuration files
- [x] T041 [P] Run `pnpm build:api` and `pnpm build:mobile:js`, recording any platform prerequisite limitation in `docs/local-development.md`
- [x] T042 Run `pnpm verify:start` against the local Compose stack and confirm the documented `GET /health` contract in `specs/001-project-bootstrap/contracts/healthcheck.md`
- [x] T043 Run the complete `specs/001-project-bootstrap/quickstart.md` flow and reconcile every command with actual root `package.json` scripts
- [x] T044 Confirm no OTP, authentication, payment, balance, dispensing, referral, or external-provider behavior was added and record residual risks in `specs/001-project-bootstrap/quickstart.md`

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; T002-T007 can proceed in parallel, while T008 depends on package manifests.
- **Foundational (Phase 2)**: Depends on Phase 1; T010-T016 and T018 can proceed in parallel after the relevant manifests exist, while T017 depends on package scripts.
- **User Story 1 (Phase 3)**: Depends on Phase 2; T019-T021 can be prepared in parallel, implementation then proceeds from probes/migrations to healthcheck/startup verification.
- **User Story 2 (Phase 4)**: Depends on Phase 2 and can begin in parallel with US1, but final root validation depends on the US1 app entry points.
- **User Story 3 (Phase 5)**: Depends on the implemented paths and commands from US1/US2; safety checks can be authored in parallel.
- **Polish (Phase 6)**: Depends on all selected user stories being complete.

### User Story Dependencies

- **US1 (P1)**: Depends on Foundational; no dependency on other user stories.
- **US2 (P1)**: Depends on Foundational; uses US1 entry points for end-to-end root validation but remains independently testable through package-level checks.
- **US3 (P2)**: Depends on US1 and US2 because `repo-map.md` and documentation must describe factual implementation paths and commands.

## Parallel Execution Examples

### After Setup

```text
T002 workspace declaration
T003 runtime pins
T004 API package scaffold
T005 Expo package/config scaffold
T006 mobile baseline test scaffold
T007 shared tooling package scaffold
```

### User Story 1

```text
T019 healthcheck contract tests
T020 API startup smoke test
T021 mobile bootstrap test
```

### User Story 2

```text
T029 API Vitest/unit setup
T030 mobile Vitest/bootstrap setup
T031 API package scripts
T032 Expo package scripts
```

### User Story 3

```text
T035 environment safety check
T036 repository bootstrap check
T039 safe environment template
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational.
3. Complete Phase 3: User Story 1.
4. Run the independent startup test and verify `GET /health` with all dependencies healthy.
5. Stop before implementing any business functionality.

### Incremental Delivery

1. Add User Story 2 for deterministic root quality gates.
2. Add User Story 3 for factual documentation and configuration safety.
3. Complete Polish only after all commands match the quickstart.

## Notes

- Every task has a sequential ID and exact file path(s).
- `[P]` marks tasks that can run in parallel without touching incomplete dependent work.
- Story tasks include `[US1]`, `[US2]`, or `[US3]`; setup, foundational, and polish tasks intentionally do not.
- Native Expo builds require local platform SDKs or optional EAS; JS/static validation must remain runnable without them.

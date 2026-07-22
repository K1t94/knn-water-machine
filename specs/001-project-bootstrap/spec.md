# Feature Specification: Project Bootstrap Foundation

**Feature Branch**: `001-project-bootstrap`

**Created**: 2026-07-22

**Status**: Draft

**Input**: User description: "Создать базовую структуру проекта KAYNANN Water Vending MVP: единый репозиторий с двумя автономными приложениями, React Native-приложение, NestJS API, PostgreSQL, Redis, локальный MQTT emulator, единые команды качества и запуска, безопасный .env.example, healthcheck и базовая проверка запуска. После bootstrap обновить repo-map.md фактическими путями и командами. Не реализовывать бизнес-функции, OTP, платежи, баланс, MQTT-выдачу и реферальную программу."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Start The Development Environment (Priority: P1)

As a developer, I want to install the repository dependencies and start the local services and both applications using documented commands, so that I can verify the project foundation without reconstructing the environment manually.

**Why this priority**: A reproducible local start is the minimum foundation for all later MVP work.

**Independent Test**: From a clean checkout with the supported Node.js LTS and package manager installed, run the documented root commands, start the local dependencies and both applications, and confirm the API healthcheck succeeds. The API startup check is headless; the Expo startup check requires a simulator, emulator, or device.

**Acceptance Scenarios**:

1. **Given** a clean checkout and the documented runtime prerequisites, **When** a developer installs dependencies from the repository root, **Then** installation completes using one declared package manager and the lockfile is sufficient for a repeatable install.
2. **Given** the local PostgreSQL, Redis, and MQTT emulator configuration is available, **When** a developer runs `pnpm services:up`, `pnpm db:migrate`, `pnpm dev:api`, and `pnpm dev:mobile` from the repository root, **Then** both autonomous applications and the required local services start without requiring real credentials.
3. **Given** the API is running, **When** a developer calls the documented healthcheck, **Then** it returns a successful status and reports the availability of the required local dependencies without exposing credentials.

### User Story 2 - Verify Repository Quality (Priority: P1)

As a developer, I want root-level commands for linting, type checking, tests, and builds, so that every contributor and CI job can apply the same baseline checks.

**Why this priority**: Consistent validation prevents an unstable foundation from becoming a dependency for future business features.

**Independent Test**: Run each documented quality command from the repository root on the bootstrap code and confirm that it completes successfully.

**Acceptance Scenarios**:

1. **Given** the bootstrap code, **When** a developer runs lint and typecheck commands, **Then** both applications are checked and the commands fail with actionable output when an intentional source error is introduced.
2. **Given** the bootstrap code, **When** a developer runs the unit/test command, **Then** each application has at least one meaningful smoke-level test and the test command exits successfully.
3. **Given** the bootstrap code, **When** a developer runs the build command, **Then** the API and the mobile application have documented build validation appropriate to their toolchains, with generated output excluded from version control.

### User Story 3 - Understand And Safely Configure The Repository (Priority: P2)

As a developer or operator, I want the repository map, runtime decisions, and environment variable contract documented, so that local setup is transparent and secrets cannot be accidentally committed.

**Why this priority**: Clear ownership and safe configuration reduce onboarding time and operational mistakes.

**Independent Test**: Review the bootstrap documentation and `.env.example`, compare every referenced path and command with the repository, and scan the example file for real secrets.

**Acceptance Scenarios**:

1. **Given** the bootstrapped repository, **When** a developer reads `repo-map.md`, **Then** it lists the actual application, infrastructure, configuration, test, entry-point, and validation-command paths.
2. **Given** a fresh local environment, **When** a developer copies the example environment file and supplies only local non-secret defaults, **Then** the applications can start without values that look like production credentials.
3. **Given** the repository contents, **When** a developer reviews the ignore rules and environment documentation, **Then** real `.env` files, credentials, certificates, signing material, and generated artifacts are excluded from version control while `.env.example` remains tracked.

### Edge Cases

- A required local dependency is stopped or unreachable: the healthcheck reports a failed dependency clearly and does not claim the API is fully ready.
- A developer runs a root command from the wrong directory: the documentation identifies the repository root and commands fail without silently operating on a different project.
- An environment variable is omitted or contains a placeholder: startup reports the missing configuration without logging its value.
- The MQTT emulator is available but no machine business contract exists: the bootstrap provides connectivity/test scaffolding only and does not send dispense commands or interpret vending events.
- Native mobile prerequisites are unavailable: backend and static quality checks remain runnable, while the documented mobile build command reports the missing prerequisite explicitly.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The repository MUST contain one root workspace for two autonomous applications: a React Native mobile application and a NestJS API; neither application may require business logic from the other to start its baseline checks.
- **FR-002**: The repository MUST declare one package manager, a supported Node.js LTS baseline, and exact root commands for installation (`pnpm install --frozen-lockfile`), development start (`pnpm dev:api`, `pnpm dev:mobile`, and optional `pnpm dev`), lint (`pnpm lint`), typecheck (`pnpm typecheck`), tests (`pnpm test`), and builds (`pnpm build:api`, `pnpm build:mobile:js`).
- **FR-003**: The package manager choice MUST provide a lockfile and root-level orchestration so the documented checks can be run from the repository root.
- **FR-004**: The API MUST expose a healthcheck endpoint with a stable documented response contract and a non-success result when a required local dependency is unavailable.
- **FR-005**: The repository MUST provide local configuration for PostgreSQL, Redis, and an MQTT emulator/broker that can be started without production accounts or external business integrations.
- **FR-006**: PostgreSQL configuration MUST include a versioned ORM schema/migration workflow, and the bootstrap MUST not rely on automatic schema synchronization as the shared-environment workflow.
- **FR-007**: The bootstrap MUST select and document an ORM and a test runner for the API, and the selected test runner MUST execute at least one API smoke test.
- **FR-008**: The mobile application MUST have a runnable baseline screen/entry point and at least one test or equivalent startup check that validates the application bootstrap without implementing a customer journey.
- **FR-009**: The repository MUST provide lint, typecheck, test, and build coverage for both applications, or document the platform prerequisite and exact reason when a native build cannot run in the current environment.
- **FR-010**: The repository MUST include a tracked `.env.example` containing only safe placeholders, local defaults, variable descriptions where needed, and no real secrets, tokens, private keys, or production endpoints.
- **FR-011**: The repository MUST exclude real environment files, credentials, certificates, native build output, dependencies, coverage, caches, and logs from version control while retaining source configuration and migration files.
- **FR-012**: The repository MUST include a basic startup verification that installs or validates prerequisites, starts the local dependencies and API, calls the healthcheck, and exits non-zero on failure.
- **FR-013**: The bootstrap documentation MUST explicitly state that OTP, authentication flows, payments, balance/ledger, MQTT water dispensing, referrals, external provider integrations, and other MVP business functions are out of scope for this feature.
- **FR-014**: After bootstrap, `specs/000-project-onboarding/repo-map.md` MUST be updated with the actual paths, selected toolchain, local-service configuration, entry points, and copy-pasteable validation commands; speculative paths and commands MUST be removed or labeled as future work.
- **FR-015**: Public healthcheck responses and logs MUST not expose environment values, credentials, tokens, connection strings, or internal session data.

### Key Entities

- **Workspace**: The repository-level unit containing the two applications, shared tooling configuration, documentation, and local infrastructure configuration.
- **Mobile application**: The iOS/Android client baseline with its own source, tests, and platform build configuration.
- **API application**: The backend baseline with its own source, healthcheck, ORM configuration, migrations, tests, and build configuration.
- **Local service stack**: The PostgreSQL database, Redis service, and MQTT emulator/broker needed to validate local connectivity.
- **Environment contract**: The documented set of configuration variables and safe local placeholder values required to start the baseline.
- **Validation command set**: The root and application-level commands used to lint, typecheck, test, build, start, and verify the bootstrap.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer with the documented prerequisites can install dependencies and start the baseline API plus local service stack from a clean checkout using no more than the documented setup commands and no production credentials.
- **SC-002**: The API healthcheck returns a successful response within 5 seconds when all required local services are healthy and returns a diagnosable non-success response when any required service is unavailable.
- **SC-003**: All documented root-level lint, typecheck, test, and API build checks pass on a clean bootstrap checkout; each check completes without manual source edits or generated-file changes.
- **SC-004**: A new contributor can identify the two application entry points, selected package manager, Node.js LTS baseline, ORM, test runner, local service commands, and validation commands from repository documentation in under 10 minutes.
- **SC-005**: A repository scan finds zero real credentials, private keys, access tokens, or production connection strings in tracked environment examples and bootstrap configuration.
- **SC-006**: The bootstrap can be demonstrated without invoking OTP, payment, balance, dispensing, referral, or external-provider behavior, and no such business operation is required for the healthcheck or baseline tests to pass.

## Assumptions

- The bootstrap will use `pnpm` as the single package manager because it supports a root workspace and explicit filtering for autonomous applications; the final version and package metadata will be pinned in the implementation.
- The supported Node.js baseline will be the current Active/Maintenance LTS available when bootstrap is implemented, pinned in repository runtime metadata and documented with the package manager version.
- The API ORM will be Prisma and the API test runner will be Vitest unless repository constraints discovered during planning require an equivalent choice; the decision must be recorded before implementation.
- The local MQTT component is an emulator/broker for connectivity and test scaffolding only; the physical machine protocol is intentionally not defined by this feature.
- Local service data may be disposable and may use non-secret development credentials, but production secrets and external provider access remain outside the repository.
- The mobile build requires platform-specific SDKs and signing/toolchain prerequisites; static checks and the API validation path must remain independently usable when those prerequisites are absent.
- No persistent business schema beyond the minimum connectivity/bootstrap migration is required; future domain schema changes will be introduced through versioned migrations.
- Existing onboarding documents remain historical input; `repo-map.md` is updated only after implementation establishes factual paths and commands.

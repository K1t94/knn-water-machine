# Tasks: Unified ESLint Rules

**Input**: Design documents from `/specs/003-eslint-rules/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/lint-commands.md`, `quickstart.md`

**Tests**: Controlled invalid and valid lint fixtures are required by the specification. They must be written before the rules that make them pass, remain outside normal lint/build scopes, and be executed only by the dedicated verification harness.

**Organization**: Tasks are grouped by user story so each policy outcome can be implemented and verified independently. All dependency changes require the repository's normal approval checkpoint before installation.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel because it touches different files and has no incomplete dependency
- **[Story]**: Maps the task to a user story from `spec.md`
- Every task names the file or scope it changes or verifies
- Every file-changing task ends with the smallest validation named in that task; a later checkpoint complements rather than replaces that validation

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish a reproducible baseline and approved toolchain before changing lint behavior.

- [x] T001 Record the declared and lockfile-resolved versions of ESLint, Expo, React Native, React, TypeScript, NestJS, Vitest, Prettier, pnpm, and existing lint plugins in `specs/003-eslint-rules/quickstart.md`, then read the table back against the manifests and lockfile queries
- [x] T002 Obtain dependency-change approval, then add every exact selected dev dependency from `specs/003-eslint-rules/plan.md`, including the pinned RxJS-x evaluation candidate, to `package.json`; update only their resolved entries in `pnpm-lock.yaml`, verify the lock resolves only `eslint-plugin-import@2.32.0`, and confirm there is no `eslint-plugin-import-x` or incompatible import-plugin peer variant
- [x] T003 Run the pre-change root, mobile, API, formatting, typecheck, test, and build commands that currently exist and record commands, exit status, and cold/warm lint timing baselines in `specs/003-eslint-rules/quickstart.md`; finish with `pnpm exec prettier --check specs/003-eslint-rules/quickstart.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Create the central Flat Config shape, isolated fixture projects, and verification harness needed by every user story.

**CRITICAL**: User-story rule work starts only after this phase is complete.

- [x] T004 Restructure `eslint.config.mjs` into named global-ignore, JavaScript baseline, TypeScript syntax, type-aware, mobile, API, test/tooling, and final Prettier Flat Config blocks without enabling the new strict rules yet; immediately run `node --check eslint.config.mjs` and one representative `pnpm exec eslint --print-config` readback
- [x] T005 Add the single centralized ignore list for dependencies, generated native projects, Prisma/generated contracts, builds, coverage, caches, temporary files, and both `.eslint-fixtures` directories in `eslint.config.mjs`; immediately verify one normal source remains included and representative ignored paths are omitted without warnings
- [x] T006 [P] Create an isolated typed mobile fixture project outside production compilation in `apps/mobile/.eslint-fixtures/tsconfig.json`, parse it as JSON, and verify the production mobile tsconfig file list excludes `.eslint-fixtures`
- [x] T007 [P] Create an isolated typed API fixture project outside production compilation in `apps/api/.eslint-fixtures/tsconfig.json`, parse it as JSON, and verify the production API tsconfig file list excludes `.eslint-fixtures`
- [x] T008 Implement the JSON-diagnostic fixture runner skeleton with `--group shared|mobile|api|commands`, `--case <name>`, explicit `--no-ignore` execution, exact expected/forbidden rule-ID assertions, and non-zero mismatch handling in `scripts/verify-eslint-rules.mjs`; immediately run `node --check` and the empty manifest
- [x] T009 Verify with `--print-config` that `apps/mobile/tsconfig.json` and `apps/api/tsconfig.json` files receive type information while root/app configuration files outside those projects receive the syntax-only fallback; record representative results in `specs/003-eslint-rules/quickstart.md`, then run `pnpm exec prettier --check specs/003-eslint-rules/quickstart.md`

**Checkpoint**: The central config loads, normal scopes ignore fixtures, fixture tsconfigs are isolated, and the harness can execute an empty manifest.

---

## Phase 3: User Story 1 - Detect Actionable TypeScript Defects (Priority: P1) MVP

**Goal**: Provide one strict, practical TypeScript baseline that detects unused code, unsafe typing, broken async handling, redundant control flow, import defects, and accidental console use in both applications.

**Independent Test**: Run the fixture harness for shared cases, then run the normal repository scope; every controlled invalid category must report its exact rule ID and current valid code must pass or produce a classified non-behavioral cleanup list.

### Tests for User Story 1

- [x] T010 [P] [US1] Add failing mobile shared fixtures for unused imports/values, `_` placeholder exceptions, floating and misused Promises, unsafe `any` operations, unnecessary assertions, unreachable/duplicate flow, import ordering/type imports, unresolved imports, and production console use in `apps/mobile/.eslint-fixtures/invalid-shared.ts`; read back the case inventory and confirm normal mobile lint ignores the file
- [x] T011 [P] [US1] Add failing API shared fixtures for unused imports/values, `_` placeholder exceptions, floating and misused Promises, unsafe `any` operations, unnecessary assertions, unreachable/duplicate flow, import ordering/type imports, unresolved imports, and production console use in `apps/api/.eslint-fixtures/invalid-shared.ts`; read back the case inventory and confirm normal API lint ignores the file
- [x] T012 [US1] Register exact expected and forbidden diagnostics for both shared fixture files in `scripts/verify-eslint-rules.mjs` and confirm the new cases fail before the shared rules are implemented

### Implementation for User Story 1

- [x] T013 [US1] Configure shared TypeScript unused-code enforcement, the documented leading-underscore convention, explicit-`any` restrictions, naming rules, type-only import consistency, and non-duplicated `eslint-plugin-unused-imports` ownership in `eslint.config.mjs`; immediately run the focused unused/type-import fixture cases
- [x] T014 [US1] Before enabling typed rules, record one cold run and three warm runs of fixed mobile/API file sets as the syntax-only checkpoint; configure project-aware `typescript-eslint` rules for floating/misused Promises, Promise truthiness, redundant `await`, unsafe assignments/calls/member access/arguments/returns, unnecessary assertions/type parameters, and reliably detectable redundant control flow in `eslint.config.mjs`; repeat the same runs as the typed checkpoint, record both checkpoints in `specs/003-eslint-rules/quickstart.md`, run the focused Promise/unsafe-type/control-flow cases, and finish with `pnpm exec prettier --check specs/003-eslint-rules/quickstart.md`
- [x] T015 [US1] Register the direct root `eslint-plugin-import@2.32.0` and TypeScript resolver once as the sole import engine for deterministic grouping/order, side-effect preservation, TypeScript aliases, unresolved imports, and cross-application rejection in `eslint.config.mjs`; immediately run focused import cases and use API `--print-config` to prove import rules do not depend on an Expo block
- [x] T016 [US1] Configure production `no-console` enforcement and narrow syntax-only or relaxed overrides for configuration files, scripts, migrations, seeds, mocks, fixtures, and tests in `eslint.config.mjs`; immediately run focused production-console and allowed-override cases
- [x] T017 [US1] Run the shared fixture manifest and normal repository lint, then classify every existing finding as safe automatic, mechanical manual, or behavior-sensitive/deferred in `specs/003-eslint-rules/quickstart.md` without changing OTP, registration, legal, sessions, SMS, navigation, schemas, or public contracts; finish with `pnpm exec prettier --check specs/003-eslint-rules/quickstart.md`
- [x] T018 [US1] Verify the shared valid/invalid matrix, exact rule IDs, and non-zero invalid exit behavior through `scripts/verify-eslint-rules.mjs`, record any requirement that lacks reliable ESLint coverage in `specs/003-eslint-rules/quickstart.md`, then run `pnpm exec prettier --check specs/003-eslint-rules/quickstart.md`

**Checkpoint**: Shared TypeScript fixtures prove every reliably enforceable baseline category, and normal mobile/API code receives type-aware rules without parser failures.

---

## Phase 4: User Story 2 - Validate React Native Code Correctly (Priority: P1)

**Goal**: Apply Expo-, React-, Hooks-, React Native-, test-, platform-, and reactive-aware policies without DOM-only assumptions or a blanket inline-style ban.

**Independent Test**: Run the mobile fixture subset and `pnpm lint:mobile`; the completed phone-auth flow and valid native/platform cases pass, while controlled Hooks, JSX, native, async/reactive, testing, and boundary defects fail.

### Tests for User Story 2

- [x] T019 [P] [US2] Add failing production mobile cases for hook ordering/dependencies, conditional hooks, list keys, raw native text, unused `StyleSheet` members, ignored async work, and forbidden API imports in `apps/mobile/.eslint-fixtures/invalid-mobile.tsx`; add invalid Testing Library/Vitest cases separately in `apps/mobile/.eslint-fixtures/invalid-mobile.spec.tsx`, then verify both are excluded from normal lint and load through their intended harness cases
- [x] T020 [P] [US2] Add positive automatic JSX runtime, `Platform.select`, native accessibility props without DOM attributes, dynamic inline styles, and neutral `./platform-target` import coverage in `apps/mobile/.eslint-fixtures/valid-platform-import.tsx`; add both `platform-target.ios.ts` and `platform-target.android.ts`, then verify the fixture tsconfig includes all three files
- [x] T021 [US2] Register exact mobile expected/forbidden diagnostics, including proof that browser-only accessibility rules are absent, in `scripts/verify-eslint-rules.mjs` and confirm the invalid cases fail before mobile rules are implemented

### Implementation for User Story 2

- [x] T022 [US2] Scope `eslint-config-expo/flat` to mobile files and verify through mobile and API `--print-config` readbacks that Expo-owned React, React Hooks, JSX, and environment rules are not redeclared or leaked, while the one shared import registration remains active
- [x] T023 [US2] Configure applicable modern React Hooks rules, dependency checks for the project's actual hooks, automatic JSX runtime behavior, JSX/list correctness, and MobX-compatible effect handling in `eslint.config.mjs`; immediately run focused Hooks/JSX cases
- [x] T024 [US2] Configure `eslint-plugin-react-native` for unused styles and raw JSX text, leave strict inline-style prohibition disabled, and add only evidence-based exceptions for dynamic/native patterns in `eslint.config.mjs`; immediately run focused raw-text/style positive and negative cases
- [x] T025 [US2] Configure mobile resolver extensions for TypeScript aliases and native `*.ios.*`/`*.android.*` modules plus the deterministic boundary preventing API implementation imports in `eslint.config.mjs`; do not add internal mobile layer restrictions without an explicit zero-baseline allowed/forbidden matrix, and immediately verify alias, cross-app boundary, iOS-target, and Android-target cases
- [x] T026 [US2] Configure `eslint-plugin-testing-library` and `@vitest/eslint-plugin` only for `apps/mobile/__tests__/**/*.{ts,tsx}`, `apps/mobile/src/**/*.{test,spec}.{ts,tsx}`, and the explicitly invoked ignored `invalid-mobile.spec.tsx` fixture; configure standalone mocks/helpers in a separate override without either test plugin, then use `--print-config` and focused cases to prove production TSX and standalone helpers do not receive test rules
- [x] T027 [US2] Evaluate the already installed pinned `eslint-plugin-rxjs-x@0.9.6` against ESLint 9 Flat Config, focused fixtures, current MobX/RxJS code, and isolated on/off timing with one cold and three warm runs; retain it only when diagnostics are correct, warm-median overhead is at most `max(1 second, 10% of baseline)`, and cold overhead is at most `max(2 seconds, 15% of baseline)`, otherwise remove the package, lock entry, and config in one reviewed diff; document the decision or fallback in `specs/003-eslint-rules/quickstart.md`, rerun the mobile reactive cases, and finish with `pnpm exec prettier --check specs/003-eslint-rules/quickstart.md`
- [x] T028 [US2] Add React Native Testing Library assertions for existing labels, roles, and interactive-control accessibility in `apps/mobile/__tests__/phone-auth-flow.test.tsx` without changing navigation or authentication behavior; follow the documented negative-control procedure by temporarily adding a test-local mock that removes one required native accessibility semantic, record the expected focused-test failure, restore it with the inverse edit, rerun only this test file successfully, and verify the temporary change leaves no diff
- [x] T029 [US2] Run the mobile fixtures, `pnpm --filter @kaynann/mobile lint`, focused feature-002 mobile tests, and mobile typecheck/build; record the static native-a11y gap plus effect-state, dynamic-style, and Observable checks that remain review/test responsibilities in `specs/003-eslint-rules/quickstart.md`, then run `pnpm exec prettier --check specs/003-eslint-rules/quickstart.md`

**Checkpoint**: Mobile lint understands Expo and native code, validates the phone-auth flow, rejects controlled native defects, and does not demand browser-only attributes.

---

## Phase 5: User Story 3 - Preserve API Layer Boundaries (Priority: P1)

**Goal**: Apply NestJS-safe async, dependency-boundary, console, and special-file policies without false positives for decorators, dependency injection, DTOs, guards, interceptors, filters, modules, or providers.

**Independent Test**: Run the API fixture subset and `pnpm lint:api`; valid Nest metadata/runtime imports and feature-002 API code pass, while Promise misuse and enforceable forbidden imports fail.

### Tests for User Story 3

- [x] T030 [P] [US3] Add failing API cases for floating/misused Promises, HTTP-to-infrastructure imports, domain/application dependency inversion, controller console use, and production-only rule leakage into special files in `apps/api/.eslint-fixtures/invalid-api.ts`; read back the case inventory and confirm normal API lint ignores the file
- [x] T031 [P] [US3] Add positive NestJS cases for decorator/metadata use, dependency injection, DTO runtime imports, guards, interceptors, filters, modules, providers, and thin controller delegation in `apps/api/.eslint-fixtures/valid-nest-runtime-import.ts`; add positive path-based override cases in `migrations/valid-migration.ts`, `seeds/valid-seed.ts`, `scripts/valid-script.ts`, and `mocks/valid-mock.ts`, then verify all are included only by the fixture tsconfig/harness
- [x] T032 [US3] Register exact API expected/forbidden diagnostics in `scripts/verify-eslint-rules.mjs` and confirm invalid boundary/async cases fail while valid Nest runtime imports pass before API-specific rules are implemented

### Implementation for User Story 3

- [x] T033 [US3] Configure API static import boundaries for HTTP, application, domain, infrastructure, common, and cross-application directions that can be expressed reliably from the existing Nest module layout in `eslint.config.mjs`; immediately run focused allowed/forbidden API boundary cases
- [x] T034 [US3] Configure API typed async rules and runtime-import-safe TypeScript policies so controllers, services, providers, schedulers, and framework-managed declarations are checked without decorator or metadata false positives in `eslint.config.mjs`; immediately run focused Promise and valid Nest runtime-import cases
- [x] T035 [US3] Add narrow API overrides for `apps/api/test/**`, `apps/api/src/**/*.spec.ts`, migrations, seeds, operational scripts, mock implementations, test fixtures, and OpenAPI generation plus mirrored fixture paths in `eslint.config.mjs`; immediately compare `--print-config` for each production/fixture scope and run all positive override cases while confirming Promise/import safety remains enabled
- [x] T036 [US3] Audit representative feature-002 controllers, DTOs, guards, filters, modules, providers, and repositories against the enforceable boundaries and record non-static review checks for controller thinness, DI correctness, and business intent in `specs/003-eslint-rules/quickstart.md`; immediately read back the completed checklist against every named representative category
- [x] T037 [US3] Run the API fixtures, `pnpm --filter @kaynann/api lint`, focused feature-002 API tests, and API typecheck/build; classify findings in `specs/003-eslint-rules/quickstart.md` without changing auth/session/SMS contracts, database behavior, or migrations, then run `pnpm exec prettier --check specs/003-eslint-rules/quickstart.md`
- [x] T038 [US3] Verify valid Nest runtime imports remain value imports and all API invalid cases produce exact expected rule IDs and non-zero status through `scripts/verify-eslint-rules.mjs`

**Checkpoint**: API lint catches enforceable async and dependency-direction defects while current Nest metadata patterns and narrow maintenance/test scopes remain valid.

---

## Phase 6: User Story 4 - Use Predictable Local and CI Commands (Priority: P2)

**Goal**: Expose documented root, application-scoped, safe-fix, fixture-verification, and formatter commands with deterministic scopes and exit codes.

**Independent Test**: From a clean checkout, follow only `README.md` and `specs/003-eslint-rules/quickstart.md`; all valid checks pass, controlled invalid fixtures fail under the harness, fix mode remains non-zero when errors remain, and formatting is a separate idempotent concern.

### Tests for User Story 4

- [x] T039 [P] [US4] Extend `scripts/verify-eslint-rules.mjs` with command-contract checks for ignored normal fixtures, explicit fixture inclusion, invalid non-zero status, valid zero status, and exact mobile/API scope isolation; immediately run `node --check` and the focused `--group commands` cases
- [x] T040 [P] [US4] Add documented smoke procedures for generated/build/coverage/temp ignore behavior, remaining-error exit codes, Prettier-to-lint-fix idempotence, the accessibility negative control, and adding a justified override or new source category in `specs/003-eslint-rules/quickstart.md`, then read each procedure back against the command contract before execution

### Implementation for User Story 4

- [x] T041 [US4] Add root `lint`, `lint:mobile`, `lint:api`, `lint:fix`, `lint:rules:test`, and separate `format:check` scripts with `--max-warnings=0` semantics to `package.json`; immediately parse the manifest and smoke each new script entry point
- [x] T042 [P] [US4] Align the mobile workspace lint and safe-fix entry points with the root command contract in `apps/mobile/package.json`; immediately parse the manifest and run the mobile check entry point
- [x] T043 [P] [US4] Align the API workspace lint and safe-fix entry points with the root command contract in `apps/api/package.json`; immediately parse the manifest and run the API check entry point
- [x] T044 [US4] Add one visible lint-command section to `README.md` documenting prerequisites, root/mobile/API scopes, exit semantics, safe-fix limitations, formatter separation, fixture isolation, future CI usage, and a link to the justified-override/new-source-category process; immediately perform a README-only command-discovery smoke read
- [x] T045 [US4] Place `eslint-config-prettier/flat` last, remove or avoid conflicting layout rules, and keep formatter execution outside ESLint in `eslint.config.mjs`; immediately run the conflict helper on one mobile and one API file
- [x] T046 [US4] Run each command-contract smoke procedure and, separately from performance timing, execute the clean-terminal README discovery protocol for root/mobile/API; record command, scope, exit code, formatter result, elapsed discovery time, and ambiguity in `specs/003-eslint-rules/quickstart.md`, then run `pnpm exec prettier --check specs/003-eslint-rules/quickstart.md`
- [x] T047 [US4] Measure one cold run and the median of three warm root/mobile/API runs plus `TIMING=1` rule costs, summarize the staged syntax-only/type-aware checkpoints from T014, assert warm root is at most 30 seconds and neither warm app scope is slower than root, record commands and results in `specs/003-eslint-rules/quickstart.md`, then run `pnpm exec prettier --check specs/003-eslint-rules/quickstart.md`

**Checkpoint**: Every documented command has a verified scope and exit contract, and ESLint remains separate from and compatible with Prettier.

---

## Phase 7: Polish & Cross-Cutting Verification

**Purpose**: Complete measured graph checks, review safe cleanup, and validate the integrated policy without product behavior changes.

- [x] T048 Evaluate `import/no-cycle` with alias and both native platform resolutions plus isolated on/off timing with one cold and three warm runs; retain it only when correctness passes, warm-median overhead is at most `max(1 second, 10% of baseline)`, and cold overhead is at most `max(2 seconds, 15% of baseline)`, immediately rerun the focused import cases, record the decision in `specs/003-eslint-rules/quickstart.md`, then run `pnpm exec prettier --check specs/003-eslint-rules/quickstart.md`
- [x] T049 Apply only reviewed safe automatic fixes from the T017/T037 classification to reported files under `apps/mobile/` and `apps/api/`, inspect the diff to prove no expressions, control flow, runtime imports, or public outputs changed, then run `pnpm lint:mobile` and/or `pnpm lint:api` for every application touched by the diff
- [x] T050 Apply only reviewed mechanical manual fixes from the T017/T037 classification to reported files under `apps/mobile/` and `apps/api/`; after each file run its smallest scoped lint/test or typecheck, and defer every async, Observable, architecture, DTO, contract, schema, OTP, legal, session, SMS, or navigation change that could alter behavior
- [x] T051 Run `pnpm lint:fix` twice and `pnpm format:check` before and after it to prove safe-fix idempotence and no formatter conflict, record results in `specs/003-eslint-rules/quickstart.md`, then run `pnpm exec prettier --check specs/003-eslint-rules/quickstart.md`
- [x] T052 Run `pnpm lint`, `pnpm lint:mobile`, `pnpm lint:api`, and `pnpm lint:rules:test`, record final zero/non-zero expectations and timings in `specs/003-eslint-rules/quickstart.md`, then run `pnpm exec prettier --check specs/003-eslint-rules/quickstart.md`
- [x] T053 Run the existing mobile/API typechecks, focused feature-002 test suites, `pnpm build:api`, and `pnpm build:mobile:js`, record results in `specs/003-eslint-rules/quickstart.md` without editing `specs/002-phone-otp-auth/`, then run `pnpm exec prettier --check specs/003-eslint-rules/quickstart.md`
- [x] T054 Audit the final diff against `specs/003-eslint-rules/spec.md`, `specs/003-eslint-rules/contracts/lint-commands.md`, and the forbidden product-change list; document every deferred static-analysis gap and ensure no useful rule was globally disabled merely to pass existing code in `specs/003-eslint-rules/quickstart.md`, then run `pnpm exec prettier --check specs/003-eslint-rules/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 - Setup**: Starts immediately; T002 requires explicit approval before package installation, and T003 captures the pre-change baseline before T004
- **Phase 2 - Foundational**: Depends on Phase 1 and blocks all user-story policy work
- **Phase 3 - US1**: Depends on Phase 2 and establishes the shared TypeScript baseline used by both application policies
- **Phase 4 - US2**: Depends on Phase 2 and integrates with the shared baseline from US1; fixture authoring T019-T021 can begin once Phase 2 is complete
- **Phase 5 - US3**: Depends on Phase 2 and integrates with the shared baseline from US1; fixture authoring T030-T032 can begin once Phase 2 is complete
- **Phase 6 - US4**: Depends on completed US1-US3 scopes so command contracts exercise final policies
- **Phase 7 - Polish**: Depends on all selected user stories and must be the final diff/validation phase

### User Story Dependencies

- **US1 (P1, MVP)**: No user-story dependency after the foundation; delivers the shared defect-detection baseline
- **US2 (P1)**: Its native fixtures and policy can be developed after the foundation, but final validation uses US1's shared baseline
- **US3 (P1)**: Its Nest fixtures and policy can be developed after the foundation, but final validation uses US1's shared baseline
- **US4 (P2)**: Requires the final US1-US3 config scopes and harness cases before command behavior can be certified

### Within Each User Story

- Add controlled fixtures and expected diagnostics first; demonstrate failure before enabling their rules
- Configure the smallest relevant Flat Config block next; use `--print-config` when overlap or scope is uncertain
- Run the story-specific fixture subset before normal lint, typecheck, tests, or build
- Classify existing-code findings before any fix; never weaken production policy globally to clear current findings
- Treat dependency, cycle, RxJS, performance, and compatibility gates as measured decisions rather than assumptions

### Parallel Opportunities

- T006 and T007 can run in parallel because they create separate fixture tsconfigs
- T010 and T011 can run in parallel because they create application-local shared fixtures
- T019 and T020 can run in parallel because they create separate mobile fixture files
- T030 and T031 can run in parallel because they create separate API fixture files
- After Phase 2, mobile fixture work T019-T021 and API fixture work T030-T032 can proceed in parallel while shared rules are built, but edits to `eslint.config.mjs` must be serialized
- T039 and T040 can run in parallel, and T042 and T043 can run in parallel because they touch different files

---

## Parallel Example: User Story 2

```text
Task T019: Add failing Hooks/JSX/native/mobile-boundary cases in apps/mobile/.eslint-fixtures/invalid-mobile.tsx
Task T020: Add valid Expo/native cases plus neutral, iOS, and Android platform fixtures under apps/mobile/.eslint-fixtures/
```

## Parallel Example: User Story 3

```text
Task T030: Add invalid async and API-boundary cases in apps/api/.eslint-fixtures/invalid-api.ts
Task T031: Add valid Nest decorator/DI/DTO cases in apps/api/.eslint-fixtures/valid-nest-runtime-import.ts
```

---

## Implementation Strategy

### MVP First: Shared TypeScript Baseline

1. Complete Phase 1 and capture the untouched baseline.
2. Complete Phase 2 and verify fixture isolation/type information.
3. Complete US1 through T018.
4. Stop and independently verify shared fixtures plus normal repository lint.
5. Review the classified cleanup list before changing any existing source file.

### Incremental Delivery

1. Setup + foundation establishes the one Flat Config entry point and test harness.
2. US1 adds shared TypeScript safety and is the MVP.
3. US2 adds Expo/React Native semantics and validates the mobile phone-auth flow.
4. US3 adds NestJS boundaries and validates the API phone-auth modules.
5. US4 exposes stable local/CI-ready commands and formatter separation.
6. Polish applies only approved safe cleanup and runs the full regression matrix.

### Safe Cleanup Rules

- **Safe automatic**: reviewed import order, genuinely unused imports, type-only imports, and other fixes that do not change expressions or control flow
- **Mechanical manual**: documented `_` placeholders, preserving Nest runtime imports, using the established logger, or making already-intended async/subscription ownership explicit only when existing tests prove behavior
- **Deferred**: any change to async ordering/error propagation, Observable cancellation/composition, controllers/layers, DTO/public contracts, OTP, registration, legal, sessions, SMS, navigation, database/schema, or other product behavior

---

## Notes

- `[P]` tasks touch different files and can run concurrently; all `eslint.config.mjs`, `package.json`, and `scripts/verify-eslint-rules.mjs` edits are otherwise serialized to keep diffs reviewable.
- Static ESLint rules enforce only reliable import directions. Controller thinness, runtime DI graphs, native accessibility gaps, dynamic style intent, and business semantics remain explicit test/code-review responsibilities where the plan found no compatible low-noise rule.
- No task changes feature-002 specifications, migrations, product contracts, or product behavior.

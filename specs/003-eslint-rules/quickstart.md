# Quickstart: Validate Unified ESLint Rules

Executable after implementation. Requires Node `>=24 <25`, pnpm `11.18.0`, and
dependencies installed from the lockfile.

## Phase 1 Baseline

Captured on 2026-08-02 before changing the ESLint policy or its dependencies.
The repository already uses ESLint 9 Flat Config through `eslint.config.mjs`.

### Environment

| Item    | Declared   | Observed               |
| ------- | ---------- | ---------------------- |
| Node.js | `>=24 <25` | `v24.18.0`             |
| pnpm    | `11.18.0`  | `11.18.0`              |
| Machine | n/a        | `Darwin 24.6.0 x86_64` |

### Tool Versions

| Tool                | Declared version | Lockfile-resolved version | Scope                                 |
| ------------------- | ---------------- | ------------------------- | ------------------------------------- |
| ESLint              | `^9.28.0`        | `9.39.5`                  | root dev dependency                   |
| `@eslint/js`        | `^9.28.0`        | `9.39.5`                  | existing JavaScript lint baseline     |
| `typescript-eslint` | `^8.34.0`        | `8.65.0`                  | existing TypeScript lint baseline     |
| Expo                | `^54.0.0`        | `54.0.36`                 | mobile                                |
| React Native        | `0.81.5`         | `0.81.5`                  | mobile                                |
| React               | `19.1.0`         | `19.1.0`                  | mobile                                |
| TypeScript          | `^5.8.3`         | `5.9.3`                   | root toolchain                        |
| NestJS              | `^11.1.6`        | `11.1.28`                 | API (`@nestjs/common`, core packages) |
| Vitest              | `^3.2.4`         | `3.2.7`                   | mobile and API tests                  |
| Prettier            | `^3.5.3`         | `3.9.6`                   | root formatter                        |

The only direct lint-policy modules before T002 are `@eslint/js` and
`typescript-eslint`. The declared versions come from the root or application
manifests; resolved versions come from `pnpm-lock.yaml`.

### Pre-change Command Baseline

| Command                                   | Exit | Baseline result                                                                                                                           |
| ----------------------------------------- | ---: | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                               |    0 | Root ESLint scope passes.                                                                                                                 |
| `pnpm --filter @kaynann/mobile lint`      |    0 | Mobile ESLint scope passes.                                                                                                               |
| `pnpm --filter @kaynann/api lint`         |    0 | API ESLint scope passes.                                                                                                                  |
| `pnpm exec prettier --check .`            |    1 | Existing formatter baseline reports 230 files, including managed Spec Kit files and application source.                                   |
| `pnpm typecheck`                          |    2 | Root TypeScript context reports 11 existing API errors, primarily `exactOptionalPropertyTypes` and conflicting `AbortSignal` definitions. |
| `pnpm --filter @kaynann/mobile typecheck` |    0 | Scoped mobile typecheck passes.                                                                                                           |
| `pnpm --filter @kaynann/api typecheck`    |    0 | Scoped API typecheck passes.                                                                                                              |
| `pnpm test`                               |    1 | Mobile passes; the API child fails for the environment reasons recorded below.                                                            |
| `pnpm --filter @kaynann/mobile test`      |    0 | 16 files and 72 tests pass.                                                                                                               |
| `pnpm --filter @kaynann/api test`         |    1 | 15 files fail, 28 pass, and 9 skip; 40 tests fail, 120 pass, and 33 skip.                                                                 |
| `pnpm build:api`                          |    0 | Nest build passes in 9.65 seconds.                                                                                                        |
| `pnpm build:mobile:js`                    |    0 | Expo Android/iOS export passes in 18.51 seconds.                                                                                          |

The API test failures are environmental: the restricted runner rejects local
listeners with `EPERM`, and PostgreSQL is unavailable at `localhost:5432`.
These failures, the root-only TypeScript failures, and the repository-wide
formatter baseline predate the new ESLint rules and are not corrected in Phase 1.

### Pre-change Lint Timing

Measured without ESLint caching on the environment above. Warm median is the
median of three separate processes.

| Scope  |   Cold | Warm 1 | Warm 2 | Warm 3 | Warm median |
| ------ | -----: | -----: | -----: | -----: | ----------: |
| Root   | 5.04 s | 3.41 s | 3.63 s | 3.62 s |      3.62 s |
| Mobile | 2.48 s | 2.50 s | 2.64 s | 2.65 s |      2.64 s |
| API    | 3.26 s | 3.20 s | 3.19 s | 3.39 s |      3.20 s |

## Phase 2 Foundation

The root Flat Config now has named global-ignore, JavaScript, TypeScript syntax,
type-aware application, mobile, API, test, tooling, and final Prettier layers.
No feature-specific strict policy is enabled in this phase.

### Type Information Readback

Captured with `pnpm exec eslint --print-config <file>` after the foundation was
created. Application files covered by their nearest app tsconfig use the project
service; Vitest configuration files outside those projects use the explicit
syntax-only fallback.

| Representative file                                 | Type mode   | `projectService` | `project` |
| --------------------------------------------------- | ----------- | ---------------- | --------- |
| `apps/mobile/src/auth/screens/PhoneEntryScreen.tsx` | type-aware  | `true`           | unset     |
| `apps/mobile/app.config.ts`                         | type-aware  | `true`           | unset     |
| `apps/api/src/auth/http/auth.controller.ts`         | type-aware  | `true`           | unset     |
| `vitest.config.ts`                                  | syntax-only | `false`          | `false`   |
| `apps/mobile/vitest.config.ts`                      | syntax-only | `false`          | `false`   |
| `apps/api/vitest.config.ts`                         | syntax-only | `false`          | `false`   |

Both `apps/mobile/.eslint-fixtures/tsconfig.json` and
`apps/api/.eslint-fixtures/tsconfig.json` parse as JSON and include only files
inside their fixture directories. `tsc --listFilesOnly` confirms neither app's
production tsconfig includes `.eslint-fixtures`. A JSON ESLint run confirmed a
normal mobile source file remains included while representative `dist` and
generated-contract paths are omitted without warnings. The empty verifier
manifest passes with `node scripts/verify-eslint-rules.mjs`.

## Phase 3 Shared TypeScript Baseline

The shared fixture matrix is executable independently of normal source lint:

```bash
node scripts/verify-eslint-rules.mjs --group shared
```

It contains invalid and valid cases for both applications plus a narrow
configuration-file console allowance. Invalid cases must exit non-zero and
match the exact rule-ID set; valid cases must exit zero. Normal application
lint ignores `.eslint-fixtures`.

### Fixed-Set Timing Checkpoints

Captured on the Phase 1 environment without ESLint caching. Each checkpoint
uses the same three production files per application. The syntax-only row was
captured after the syntax policies and before enabling type-aware rules; the
typed row includes the Promise, unsafe-type, unnecessary-type, and typed
control-flow policies.

| Scope  | Policy checkpoint |   Cold |  Warm 1 |  Warm 2 | Warm 3 | Warm median |
| ------ | ----------------- | -----: | ------: | ------: | -----: | ----------: |
| Mobile | Syntax-only rules | 4.55 s |  4.23 s |  4.25 s | 4.23 s |      4.23 s |
| Mobile | Type-aware rules  | 4.74 s |  4.45 s |  4.50 s | 4.47 s |      4.47 s |
| API    | Syntax-only rules | 6.04 s |  5.47 s |  6.00 s | 5.62 s |      5.62 s |
| API    | Type-aware rules  | 6.13 s | 11.14 s | 10.18 s | 9.76 s |     10.18 s |

The mobile warm-median delta is `0.24 s` (`5.7%`). The API sample is noisy and
its observed warm-median delta is `4.56 s` (`81.1%`), so API lint performance
remains an explicit risk for the final full-scope timing gate. A subsequent
`TIMING=1` sample attributed about `0.5 s` to all enabled rules combined, led by
`no-unsafe-assignment` and `no-misused-promises`; most elapsed time was outside
rule execution in TypeScript/import graph setup. No rule is removed on this
single noisy sample, and final timing must be repeated before CI adoption.

### Existing-Code Cleanup Inventory

Phase 3 intentionally does not auto-fix feature-002 or other product code. The
normal scopes currently fail with 95 mobile diagnostics in 24 files and 344 API
diagnostics in 74 files. Root lint adds five findings from
`apps/mobile/vitest.setup.ts`, for 444 diagnostics in 99 files total.

| Classification                 | Count | Included findings                                                                                                                                                 | Treatment                                                                                       |
| ------------------------------ | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Safe automatic, reviewed diff  |   266 | 227 fixable `import/order`, 27 unnecessary assertions, 11 clearly type-only mobile/tooling imports, and one fixable duplicate import                              | Run only in a dedicated cleanup diff, inspect side-effect order, then typecheck/test.           |
| Mechanical manual              |    21 | Three non-fixable import-order cases, 16 API type-import cases requiring Nest metadata review, one unnecessary type parameter, and one duplicate-import case      | Edit individually; preserve decorator/DI runtime values and public type signatures.             |
| Behavior-sensitive or deferred |   157 | 53 unsafe arguments, 40 unsafe member accesses, 31 unnecessary conditions, 21 unsafe assignments, eight unsafe calls, two unsafe returns, and two Promise defects | Do not change in this feature; each needs boundary/runtime intent and focused regression tests. |

The categories account for every current Phase 3 diagnostic. No OTP,
registration, legal, session, SMS, navigation, database, schema, or public
contract behavior was changed.

### Reliable Coverage Boundaries

- ESLint reliably owns unused code, explicit `any`, naming, type-only imports,
  Promise misuse, unsafe typed operations, syntactic duplicate/unreachable
  flow, import resolution/order, cross-application imports, and production
  console use.
- Three proven RxJS checks own accidentally ignored Observables, Observable
  values returned where `void` is required, and async subscribe callbacks.
  Subscription teardown and broader Observable lifecycle intent remain review
  and focused-test responsibilities.
- `import/no-cycle` remains deferred until its dedicated correctness and timing
  gate; it is not silently enabled in the shared baseline.
- Thin Nest controllers, business-logic placement, dependency direction inside
  existing feature layers, and semantic duplicate business logic are code
  review concerns. Path rules enforce only the reliable cross-app boundary.
- Naming checks intentionally exclude property keys so external API/DTO field
  names are not rewritten or falsely rejected.

## Phase 4 Mobile Policies

`eslint-config-expo/flat` is scoped to `apps/mobile` and remains the owner of
React, Hooks, JSX, and Expo environment rules. The shared config registers the
single import plugin; Expo's duplicate import and TypeScript plugin objects are
removed while its rules remain active. The mobile additions are deliberately
narrow:

| Scope                   | Added policy                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| Production and tests    | `react-native/no-raw-text` and `react-native/no-unused-styles`; strict inline-style rejection stays off |
| Mobile source           | Three typed `rxjs-x` correctness rules                                                                  |
| Mobile tests            | Selected Testing Library async-query and Vitest suite/expect rules                                      |
| Standalone test helpers | Explicit helper override without Testing Library or Vitest plugins                                      |

The test presets are not enabled wholesale: DOM-biased rules, `prefer-screen`,
and broad `all`/`expect-expect` checks conflict with the current RNTL render-result
style or create helper noise. Automatic JSX runtime, `Platform.select`, native
accessibility props, dynamic inline styles, and both controlled platform target
files pass the mobile fixture case. There are no configured TypeScript path
aliases today; the selected TypeScript resolver reads both application tsconfigs
and has explicit `.ios`, `.android`, and `.native` extensions ready for aliases
when the project adds them. The reliable cross-app rule rejects mobile imports
from `apps/api/src`; no unproven internal mobile layer heuristic was added.

### Scope Readback

Captured with `eslint --print-config` on 2026-08-02:

| Representative file               | Expo/React/Hooks/native | RxJS | Testing Library/Vitest | Shared import |
| --------------------------------- | ----------------------- | ---- | ---------------------- | ------------- |
| Mobile production TSX             | yes                     | yes  | no                     | yes           |
| Mobile `phone-auth-flow.test.tsx` | yes                     | no   | yes                    | yes           |
| Mobile standalone test helper     | yes                     | yes  | no                     | yes           |
| API controller                    | no                      | no   | no                     | yes           |

The neutral platform fixture and both `.ios.ts`/`.android.ts` files are listed
by the fixture tsconfig readback; the mobile harness lints all three explicitly.
Normal mobile lint reports ignored fixture paths, while the harness uses
`--no-ignore` and exact expected/forbidden rule IDs.

### RxJS Gate

`eslint-plugin-rxjs-x@0.9.6` was retained. It supports ESLint 9 Flat Config,
matched every controlled defect, and produced no `rxjs-x` diagnostic across
the current `apps/mobile/src` corpus. The fixed production sample used the same
three files with and without the plugin:

| Policy             |   Cold | Warm 1 | Warm 2 | Warm 3 | Warm median |
| ------------------ | -----: | -----: | -----: | -----: | ----------: |
| Without RxJS rules | 6.64 s | 6.22 s | 5.83 s | 5.76 s |      5.83 s |
| With RxJS rules    | 5.58 s | 6.74 s | 5.71 s | 6.28 s |      6.28 s |

Warm overhead is `0.45 s` (`7.7%`), below the `max(1 s, 10%)` gate. The cold
sample did not regress and therefore also passes `max(2 s, 15%)`. Enabled rules
are `no-floating-observables`, `no-misused-observables`, and
`no-async-subscribe`; broader lifecycle rules remain deferred.

### Accessibility And Validation

The feature-002 RNTL flow now asserts existing input/back labels, button and
checkbox roles, checkbox state, and retry/logout interaction semantics. A
temporary test-only `Pressable` mock stripped `accessibilityRole`: the focused
file failed four assertions with exit `1`. The inverse edit restored the helper,
the same file passed all five tests, and the helper had no remaining diff.

| Phase 4 command                    | Result                                              |
| ---------------------------------- | --------------------------------------------------- |
| Mobile fixture group               | 3 cases pass                                        |
| Focused `phone-auth-flow.test.tsx` | 5 tests pass                                        |
| Mobile typecheck                   | passes                                              |
| Expo iOS/Android export            | passes                                              |
| Mobile lint                        | expected interim failure: 95 errors and 17 warnings |

The lint count is the preserved Phase 3 cleanup baseline, not new framework
diagnostics; no React, Hooks, native, RxJS, or test-plugin false positive was
introduced in ordinary mobile code. It is intentionally not hidden with global
disables or behavior-sensitive OTP/auth edits.

Remaining review/test responsibilities are explicit: static native accessibility
coverage (the available native-a11y plugin excludes ESLint 9 and DOM rules are
invalid for React Native), state updates inside effects (Expo's Hooks version
lacks the modern rule), whether a dynamic inline style belongs in a `StyleSheet`,
and subscription teardown/lifecycle beyond the three selected Observable rules.
Prettier remains the formatter, `eslint-config-prettier/flat` stays last, and
ESLint owns correctness rather than layout.

## Phase 5 API Policies

The API policy keeps the shared type-aware Promise and unsafe-type checks and
adds only path boundaries supported by the current Nest module layout. Each
layer retains the cross-application rule that rejects imports from mobile.

| Importing scope                                                        | Statically rejected dependency                                                     |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `**/http/**`                                                           | Local infrastructure plus direct Prisma/Redis access                               |
| `**/application/**`                                                    | HTTP transport code                                                                |
| `**/domain/**`                                                         | Application, HTTP, and infrastructure code                                         |
| `**/infrastructure/**`                                                 | HTTP transport code                                                                |
| `src/common/**`                                                        | Feature-owned auth, health, legal, observability, OTP, session, SMS, and user code |
| API production outside `sms/infrastructure/orange` and `sms.module.ts` | Private Orange implementation                                                      |

Tests, mocks, fixtures, migrations, seeds, operational scripts, and OpenAPI
generation receive narrow `console` and explicit-`any` allowances. Their import
rules remain enabled. Type-aware special paths covered by the API or isolated
fixture tsconfig also retain `no-floating-promises` and
`no-misused-promises`; `--print-config` confirmed both rules at error severity
for every positive fixture path, API tests, and OpenAPI generation. Selected
Vitest rules apply only to API test globs. `vitest/valid-expect` is deliberately
excluded from the API override because it rejected the project's valid
two-argument expectations and added ten false positives.

### Existing Boundary Exceptions

Four feature-002 transport files already cross the target boundary. They are
exact-path exceptions rather than global disables and remain architecture debt:

- `auth/http/auth-http.helpers.ts` maps errors declared by Redis-backed stores;
- `legal/http/legal.controller.ts` reads the registration authorization store;
- `legal/http/dto/legal.dto.ts` exposes a Prisma enum in transport metadata;
- `sessions/http/access-session.guard.ts` queries the sessions repository.

Moving those dependencies behind application ports could change DI wiring,
error contracts, or request behavior, so it is outside this lint-only feature.
All other matching production paths receive the boundary rules. Current API
source produces zero `no-restricted-imports` findings with these explicit debts.

### Feature-002 Architecture Audit

| Category     | Representative code                                                                                | Static result                                      | Review-only check                                                                                          |
| ------------ | -------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Controllers  | `auth/http/auth.controller.ts`                                                                     | Delegates to application services; boundary passes | Keep response shaping and transport mapping in the controller; reject new business decisions               |
| DTOs         | `auth/http/dto/otp.dto.ts`                                                                         | Decorator/runtime imports pass                     | Review validation completeness and public response exposure                                                |
| Guards       | `sessions/http/access-session.guard.ts`                                                            | Exact repository-debt exception                    | Review authentication intent and move persistence behind an application port before removing the exception |
| Filters      | `common/redacted-exception.filter.ts`                                                              | Common boundary passes                             | Review redaction and stable public error behavior                                                          |
| Modules      | `auth/auth.module.ts`                                                                              | Composition-root imports are allowed               | Review provider tokens, exports, scopes, and runtime DI wiring                                             |
| Providers    | `auth/application/auth-retention.scheduler.ts`, `sms/infrastructure/orange/orange-sms.provider.ts` | Scheduler and private-provider boundaries pass     | Review lifecycle, retries, side effects, and port substitution behavior                                    |
| Repositories | `legal/infrastructure/postgres/legal.repository.ts`                                                | Infrastructure-to-Prisma direction is allowed      | Review transaction, query, and persistence semantics                                                       |

ESLint cannot reliably decide controller thinness, correct Nest token wiring,
decorator/metadata reachability, business intent, transaction correctness, or
whether an allowed application-to-infrastructure dependency should become a
port. These remain mandatory code-review and focused-test checks.

### API Validation And Cleanup Baseline

| Phase 5 command               | Result                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------- |
| API fixture group             | Three exact cases pass; invalid async/boundary/console case exits non-zero   |
| Focused feature-002 API tests | Four files, 18 tests pass                                                    |
| API typecheck                 | Passes                                                                       |
| Nest build                    | Passes                                                                       |
| API lint                      | Expected interim failure: 344 errors in 74 files, zero new boundary findings |

The 344 findings remain the Phase 3 cleanup baseline. No auth, session, SMS,
database, migration, or public-contract code was changed.

| Classification                   | Count | Treatment                                                                                       |
| -------------------------------- | ----: | ----------------------------------------------------------------------------------------------- |
| Safe automatic after diff review |   182 | 158 import-order fixes, one duplicate-import fix, and 23 unnecessary assertion removals         |
| Mechanical manual                |    19 | Review 16 Nest-sensitive type imports plus two non-fixable order cases and one duplicate import |
| Behavior-sensitive or deferred   |   143 | Promise misuse, unnecessary conditions, and unsafe-value flow require focused behavioral work   |

The valid Nest fixture keeps `OtpRequestDto` as a value import because decorated
parameter metadata needs it at runtime. It also covers controller delegation,
dependency injection, guards, interceptors, filters, modules, and providers
without type-import or decorator false positives.

## Phase 6 Command Smoke Procedures

All commands run from the repository root. Check commands are read-only and use
`--max-warnings=0`; an error, warning, parser failure, or configuration failure
must return non-zero. The current application lint baseline remains non-zero
until the reviewed cleanup tasks in Phase 7.

### Scope And Exit Contracts

```bash
pnpm lint
pnpm lint:mobile
pnpm lint:api
pnpm lint:rules:test
pnpm format:check
```

The first three commands must inspect only their documented normal scopes and
must not report `.eslint-fixtures`. The rule harness explicitly includes those
fixtures: invalid cases must make the inner ESLint process non-zero, valid cases
must make it zero, and the harness itself succeeds only when the exact rule IDs
match. Use `pnpm exec eslint --no-ignore --fix-dry-run --max-warnings=0
apps/api/.eslint-fixtures/invalid-api.ts` to verify that remaining errors still
produce a non-zero safe-fix simulation without modifying production files.

### Ignore Smoke

Pipe the same invalid source into representative ignored paths. Every command
must exit zero with no diagnostic because only the filename is inspected and no
artifact is created:

```bash
printf 'console.log("ignored")\n' | pnpm exec eslint --stdin --stdin-filename apps/api/generated/ignored.ts --no-warn-ignored --max-warnings=0
printf 'console.log("ignored")\n' | pnpm exec eslint --stdin --stdin-filename apps/api/dist/ignored.ts --no-warn-ignored --max-warnings=0
printf 'console.log("ignored")\n' | pnpm exec eslint --stdin --stdin-filename apps/mobile/coverage/ignored.ts --no-warn-ignored --max-warnings=0
printf 'console.log("ignored")\n' | pnpm exec eslint --stdin --stdin-filename tmp/ignored.ts --no-warn-ignored --max-warnings=0
```

### Safe Fix And Formatter Smoke

Phase 6 does not run root `pnpm lint:fix`, because the existing lint baseline
contains reviewed production fixes reserved for Phase 7. Instead, verify the
same safe fixer on an isolated valid fixture and compare its digest before and
after two runs:

```bash
shasum apps/api/.eslint-fixtures/valid-nest-runtime-import.ts
pnpm exec prettier --check apps/api/.eslint-fixtures/valid-nest-runtime-import.ts
pnpm exec eslint --no-ignore --fix --max-warnings=0 apps/api/.eslint-fixtures/valid-nest-runtime-import.ts
pnpm exec eslint --no-ignore --fix --max-warnings=0 apps/api/.eslint-fixtures/valid-nest-runtime-import.ts
pnpm exec prettier --check apps/api/.eslint-fixtures/valid-nest-runtime-import.ts
shasum apps/api/.eslint-fixtures/valid-nest-runtime-import.ts
```

The two digests must match. The full normal-scope `lint:fix` idempotence check
remains T051 after safe and mechanical findings have been reviewed.

The native accessibility negative control is documented under
[Accessibility Negative Control](#accessibility-negative-control). The process
for narrow overrides and new source categories is documented under
[Extending Lint Scope](#extending-lint-scope).

### Phase 6 Smoke Results

Recorded on 2026-08-02. Non-zero normal-scope and formatter results are the
classified cleanup baseline for Phase 7, not command/configuration failures.

| Command or procedure                                    | Scope                                      |   Exit | Result                                                                 |
| ------------------------------------------------------- | ------------------------------------------ | -----: | ---------------------------------------------------------------------- |
| `pnpm lint`                                             | Normal repository scope                    |      1 | 467 diagnostics: 450 errors and 17 warnings                            |
| `pnpm lint:mobile`                                      | Mobile source, tests, entry, and config    |      1 | 117 diagnostics: 100 errors and 17 warnings                            |
| `pnpm lint:api`                                         | API source, tests, and config              |      1 | 344 errors                                                             |
| `pnpm lint:rules:test`                                  | Isolated rule fixtures                     |      0 | All shared, mobile, and API cases passed                               |
| `node scripts/verify-eslint-rules.mjs --group commands` | Script and fixture-isolation contract      |      0 | Both command cases passed                                              |
| `pnpm format:check`                                     | Repository formatter scope                 |      1 | 229 files remain in the Phase 7 formatting baseline                    |
| Invalid fixture with `--fix-dry-run`                    | Remaining-error exit contract              |      1 | Seven errors remained after safe-fix simulation                        |
| Four stdin ignore checks                                | Generated, build, coverage, and temp paths | 0 each | No output or ignored-file warning                                      |
| Conflict helper                                         | One mobile and one API production file     |      0 | No Prettier-conflicting ESLint rules                                   |
| Focused phone-auth test                                 | Existing accessibility semantics           |      0 | Five tests passed; the Phase 4 negative control remains recorded above |

The safe-fix fixture had SHA-1
`e1f77d6764e265ba56681d59eb026e87fef625cb` before and after two ESLint fix
runs. Prettier passed before and after, proving idempotence without a production
edit. Root `pnpm lint:fix` remains intentionally unexecuted until T051 so Phase
6 cannot silently apply the already classified production fixes.

A README-only command-discovery audit found `pnpm lint`, `pnpm lint:mobile`, and
`pnpm lint:api` exactly once in 8.79 ms with no ambiguity. This is below the
two-minute usability threshold and excludes lint execution time.

## Effective Configuration

```bash
pnpm exec eslint --print-config apps/mobile/src/auth/screens/PhoneEntryScreen.tsx
pnpm exec eslint --print-config apps/mobile/__tests__/phone-auth-flow.test.tsx
pnpm exec eslint --print-config apps/api/src/auth/http/auth.controller.ts
pnpm exec eslint --print-config apps/api/test/phone-auth.integration-spec.ts
```

Expect mobile framework/test layers only where applicable, API boundary/test
layers without React, and no parser failure. The neutral
`valid-platform-import.tsx` fixture imports `./platform-target`; both controlled
`.ios.ts` and `.android.ts` targets must resolve.

## Rule Contracts And Lint

```bash
pnpm lint:rules:test
pnpm lint:mobile
pnpm lint:api
pnpm lint
```

All exit `0`. The fixture harness confirms Promise, Observable, unused/unsafe
typing, control flow, imports/boundaries, Hooks, native, test, and positive Nest
DI/DTO cases. Invalid fixtures are excluded from normal lint/build. A temporary
ordinary-source floating Promise or unused import must make its scoped and root
commands fail; revert only that deliberate edit afterward.

## Fix And Formatter Separation

From a reviewed diff, introduce a harmless disposable import-order issue:

```bash
pnpm lint:fix
pnpm lint
pnpm format:check
pnpm exec eslint-config-prettier apps/mobile/src/auth/screens/PhoneEntryScreen.tsx apps/api/src/auth/http/auth.controller.ts
git diff --check
```

Expect only the safe fix, no conflict report, and no formatting oscillation or
product/schema/contract change. Do not revert unrelated working-tree changes.

## Performance

```bash
/usr/bin/time -p pnpm lint
/usr/bin/time -p pnpm lint:mobile
/usr/bin/time -p pnpm lint:api
TIMING=1 pnpm lint:mobile
TIMING=1 pnpm lint:api
```

Record Node/pnpm/machine, one cold run, and the median of three warm runs. Capture
syntax-only and typed checkpoints on the same fixed mobile/API file sets before
and after T014; the final timing task summarizes those staged measurements.
Assert warm root lint at 30 seconds or less and each warm app lint at no longer
than warm root.

### Phase 6 Full-Scope Timing

Measured without ESLint cache on Node.js `24.18.0`, pnpm `11.18.0`, macOS x64,
Intel Core i5-8257U (8 logical cores). The commands retain their expected
interim exit code `1`; timing is measured independently of cleanup status.

| Command            |    Cold |  Warm 1 |  Warm 2 |  Warm 3 | Warm median |
| ------------------ | ------: | ------: | ------: | ------: | ----------: |
| `pnpm lint`        | 19.78 s | 23.69 s | 29.72 s | 25.06 s |     25.06 s |
| `pnpm lint:mobile` | 14.60 s | 12.38 s | 11.48 s | 11.31 s |     11.48 s |
| `pnpm lint:api`    | 16.08 s | 17.56 s | 17.62 s | 19.36 s |     17.62 s |

The root warm median is below the 30-second gate. Mobile and API warm medians
are both below the root median. `TIMING=1` attributed 3.78 seconds to mobile
rules, led by `import/namespace` (1.74 seconds, 45.9%) and
`no-misused-promises` (0.60 seconds, 16.0%). It attributed 5.40 seconds to API
rules, led by `no-unsafe-assignment` (1.95 seconds, 36.1%),
`no-misused-promises` (0.94 seconds, 17.4%), and `no-floating-promises` (0.67
seconds, 12.3%).

The earlier fixed-file T014 checkpoint remains the type-aware comparison:
mobile warm median increased from 4.23 to 4.47 seconds, while the noisy API
sample increased from 5.62 to 10.18 seconds. The final full-scope gate passes,
but TypeScript/import graph setup and API type-aware startup remain documented
performance risks rather than reasons to weaken correctness rules.

### Cycle Rule Decision

`import/no-cycle` was evaluated with `ignoreExternal: true` against the same
full-root scope used for the Phase 6 baseline. A controlled two-file cycle was
detected, while the TypeScript alias cases and both neutral iOS/Android platform
resolutions continued to pass.

| Policy                    |    Cold |  Warm 1 |  Warm 2 |  Warm 3 | Warm median |
| ------------------------- | ------: | ------: | ------: | ------: | ----------: |
| Without `import/no-cycle` | 19.78 s | 23.69 s | 29.72 s | 25.06 s |     25.06 s |
| With `import/no-cycle`    | 39.55 s | 56.75 s | 48.51 s | 43.99 s |     48.51 s |

The rule exceeds both gates: cold overhead is 19.77 seconds and warm-median
overhead is 23.45 seconds. It is therefore rejected and removed. Deterministic
`no-restricted-imports`, `import/no-unresolved`, alias/platform resolution, and
code review remain the lower-cost safeguards; runtime and semantic dependency
cycles remain deferred.

Measure cycle and RxJS rule sets independently with the same config and file
scope immediately before and after enabling each set. Retain an optional set only
when its diagnostics are correct, warm-median overhead is no more than the greater
of 1 second or 10 percent of baseline, and cold overhead is no more than the
greater of 2 seconds or 15 percent of baseline.

### Phase 7 Cleanup Results

The reviewed ESLint fixers updated imports and removed unnecessary assertions in
23 mobile and 70 API files. Four non-fixable import-order/duplicate cases were
then corrected mechanically. One unsafe automatic assertion removal in the
hoisted mobile test context was replaced with an explicit generic context type;
the value and test behavior remain unchanged.

The final diff was inspected for expressions, control flow, public outputs, and
Nest runtime metadata. Decorated DTOs and injected providers remain value
imports. Imports converted to `import type` are used only as types; the Orange
OAuth client is manually constructed rather than decorator-injected. No schema,
migration, API contract, OTP, registration, legal, session, SMS, or navigation
behavior was changed.

Normal lint now reports 158 errors in 33 files and no warnings. These findings
are intentionally deferred rather than hidden or changed without behavioral
context:

| Deferred rule                                       | Count |
| --------------------------------------------------- | ----: |
| `@typescript-eslint/no-unsafe-argument`             |    53 |
| `@typescript-eslint/no-unsafe-member-access`        |    40 |
| `@typescript-eslint/no-unnecessary-condition`       |    31 |
| `@typescript-eslint/no-unsafe-assignment`           |    21 |
| `@typescript-eslint/no-unsafe-call`                 |     8 |
| `@typescript-eslint/no-unsafe-return`               |     2 |
| `@typescript-eslint/no-floating-promises`           |     1 |
| `@typescript-eslint/no-misused-promises`            |     1 |
| `@typescript-eslint/no-unnecessary-type-parameters` |     1 |

The last type-parameter finding is retained because changing an existing public
generic signature is not a mechanical lint-only edit. Promise, unsafe-value,
and condition findings require boundary intent and focused regression tests.

### Fix Idempotence And Formatter

`pnpm lint:fix` was run twice. Both runs returned `1` for the same 158
non-fixable errors, and the complete diff stat was identical after each run, so
the safe fixer is idempotent. `pnpm format:check` returned `1` both before and
after with the same 231-file historical formatting baseline. The cleanup did
not introduce a formatter oscillation; broad formatting of those existing files
is outside this lint-policy feature.

### Final Command Matrix

Measured on the Phase 1 environment without ESLint cache:

| Command                | Exit | Elapsed | Final expectation                                                |
| ---------------------- | ---: | ------: | ---------------------------------------------------------------- |
| `pnpm lint:mobile`     |    1 | 10.13 s | 15 deferred errors make the check fail                           |
| `pnpm lint:api`        |    1 | 15.53 s | 143 deferred errors make the check fail                          |
| `pnpm lint`            |    1 | 24.94 s | 158 deferred errors make the repository check fail               |
| `pnpm lint:rules:test` |    0 | 97.19 s | All 13 controlled rule cases pass with exact diagnostic matching |

The non-zero application results prove the command exit contract but mean the
clean-code success conditions in SC-001 and SC-003 are not yet met. The root
timing remains below the 30-second SC-004 threshold, and each application scope
remains faster than the root scope.

### Regression Validation

| Validation                        | Result                                              |
| --------------------------------- | --------------------------------------------------- |
| Mobile typecheck                  | Pass                                                |
| API typecheck                     | Pass                                                |
| Mobile `phone-auth-flow.test.tsx` | 5 tests pass                                        |
| Focused feature-002 API suites    | 20 tests pass; 1 environment-dependent test skipped |
| `pnpm build:api`                  | Pass                                                |
| `pnpm build:mobile:js`            | Pass; iOS and Android bundles export successfully   |

The focused API run required normal host socket permissions because the sandbox
rejected Supertest's local listener with `EPERM`; the approved rerun passed.
No file under `specs/002-phone-otp-auth/` was edited.

### Deferred Gaps And Final Audit

- The 158 findings above remain real lint failures; no useful rule was disabled
  or downgraded to make existing code appear clean.
- `import/no-cycle` remains disabled only because its measured overhead failed
  both retention gates; deterministic boundaries and review remain mandatory.
- Native accessibility, controller thinness, Nest metadata intent, internal
  feature-layer direction, and broad Observable lifecycle ownership remain
  review/test responsibilities for the reasons recorded in Phases 4 and 5.
- The repository-wide Prettier baseline remains independently non-zero and must
  be handled as a separate formatting cleanup rather than folded into ESLint.
- SC-001, SC-003, and the formatter's independent clean-state contract remain
  open until the deferred lint and historical formatting baselines are resolved.

## Accessibility Negative Control

1. Run the focused phone-auth test and record its successful exit code.
2. Apply the documented test-local mock that removes one required native label,
   role, or interaction semantic without editing production code.
3. Run the same focused test, record the expected assertion failure and non-zero
   exit code, then restore the mock with the inverse edit.
4. Run the focused test again and verify it succeeds; inspect the diff to prove
   the temporary negative-control change is absent.

## Documentation Usability

Run this separately from lint timing:

1. Start in a clean terminal at the repository root with no feature documents
   open and start a timer.
2. Open only `README.md` and locate the whole-repository, mobile-only, and
   API-only lint commands.
3. Launch the requested command and stop the timer as soon as it starts.
4. Repeat from a fresh terminal for each scope, recording elapsed time and every
   ambiguous or missing instruction in this file.

Each run must take under two minutes. This protocol measures command discovery,
not ESLint execution time.

## Regression

```bash
pnpm typecheck
pnpm test
pnpm build:api
pnpm build:mobile:js
```

Feature-002 OTP, registration, legal, session, SMS, navigation, MobX, and RxJS
behavior must remain unchanged. Its four manual/external tasks remain out of
scope and are not marked complete.

## Extending Lint Scope

Before an override: prove the special scope, use the narrowest glob/rule change,
add a reason and positive fixture, keep Promise/import/unused safety where
possible, then rerun the smallest scoped lint plus `lint:rules:test`.

Before adding a source category: document its glob and owner, decide whether it
has full project type information or requires the syntax-only fallback, add a
narrow policy block and positive fixture, prove unrelated scopes do not receive
the block with `--print-config`, then run its scoped lint and
`pnpm lint:rules:test`.

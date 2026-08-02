# Implementation Plan: Unified ESLint Rules

**Branch**: `eslint-feature` | **Date**: 2026-08-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-eslint-rules/spec.md`

## Summary

Preserve ESLint 9 Flat Config and make the root `eslint.config.mjs` the single
policy entry point. Compose a shared type-aware TypeScript baseline with scoped
Expo/React Native mobile, NestJS API, test, and tooling policies. Reuse the
React and Hooks plugins bundled by Expo rather than duplicate them. Register one
root import plugin/resolver version that also satisfies Expo's dependency range.
Adopt rules in measured stages, verify them with isolated positive/negative
fixtures, and allow only behavior-preserving cleanup of the feature-002 corpus.

## Technical Context

**Language/Version**: Node.js `>=24 <25`; TypeScript declared `^5.8.3`, resolved `5.9.3`

**Primary Dependencies**: ESLint declared `^9.28.0`, resolved `9.39.5`;
typescript-eslint `8.65.0`; Expo declared `^54.0.0`, resolved `54.0.36`; React
Native `0.81.5`; React `19.1.0`; NestJS declared `^11.1.6`, resolved `11.1.28`;
RxJS `7.8.2`; MobX `6.16.1`; Prettier `3.9.6`

**Storage**: N/A; no runtime persistence or schema work

**Testing**: Vitest declared `^3.2.4`, resolved `3.2.7`; React Native Testing
Library `14.0.1`; controlled ESLint fixtures; existing typecheck/tests/builds

**Target Platform**: pnpm `11.18.0` monorepo; Expo iOS/Android and Node.js 24 API

**Project Type**: Existing mobile + API monorepo under `apps/*`

**Performance Goals**: warm root lint at most 30 seconds and each warm app lint
no slower than root; separate cold, type-aware, RxJS, and cycle-rule measurements

**Constraints**: keep Flat Config and pnpm; no framework/product changes; no
generated output; no strict inline-style ban or DOM-only native rules

**Scale/Scope**: about 39 mobile and 135 API source/test files; feature 002 is
the primary architecture and compatibility corpus

## Constitution Check

_GATE: passed before research and passed again after design._

| Principle                      | Design evidence                                                                               | Result |
| ------------------------------ | --------------------------------------------------------------------------------------------- | ------ |
| One logical diff               | Planning is docs-only; implementation is split into config, fixtures, safe cleanup, and docs. | PASS   |
| Boundary validation            | Only deterministic import boundaries are linted; product DTO validation is unchanged.         | PASS   |
| Explicit outputs               | Public responses are unchanged; only CLI/exit contracts are added.                            | PASS   |
| Schema safety                  | No schema/migration changes; migrations only get a lint override.                             | PASS   |
| Security-sensitive work        | OTP/session/SMS/legal behavior is excluded; async cleanup requires regressions.               | PASS   |
| Minimal validation             | Each adoption stage has a targeted fixture/scoped command.                                    | PASS   |
| Durable style memory           | Style memory was read and is not modified.                                                    | PASS   |
| Context discipline             | Analysis was limited to relevant configs, features 002/003, and their code.                   | PASS   |
| Frontend reactive architecture | Targeted RxJS rules protect consumption/lifecycle without changing ownership.                 | PASS   |

No constitution violation requires a complexity exception.

## Conflicts And Assumptions

1. Feature 002 still has unchecked manual/external tasks `T123`-`T125` and
   `T127`. Its code is the reference corpus, but this plan does not claim those
   acceptance activities are complete.
2. `eslint-config-expo@10.0.0` is the SDK 54 baseline and already registers
   React, Hooks, `eslint-plugin-import`, Expo, and TypeScript syntax policies.
3. Expo 10's Hooks line covers Rules of Hooks and dependencies but predates
   `set-state-in-effect`. An out-of-range transitive override is not planned;
   unsafe effect updates remain test/review coverage until Expo exposes a
   compatible rule. This is a disclosed tooling limitation.
4. `eslint-plugin-react-native-a11y@3.5.1` excludes ESLint 9 in its peers and has
   no native Flat preset. It will not be forced; compatible static native rules
   cover what they can, focused RNTL assertions cover labels/roles/interactions,
   review covers custom abstractions, and DOM-only rules are prohibited.
5. Feature-002 layering is pragmatic: some application code reaches
   repositories/Prisma/Redis, `otp/domain` uses Nest/shared security, and some
   cross-feature HTTP imports exist. Initial boundaries protect only patterns
   already satisfied; stronger layering requires a separate refactor.

## Configuration Design

`eslint.config.mjs` remains the only normal entry and exports named Flat Config
layers in this order:

1. `global-ignores`: dependencies, builds, coverage, Expo/native generated
   projects, generated clients, caches, temp files, and invalid fixtures.
2. `javascript-baseline`: core recommended, runtime globals, unreachable and
   duplicate control flow, and production console policy.
3. `typescript-syntax-baseline`: parsing and syntax-safe shared checks.
4. `typescript-type-aware`: `recommendedTypeChecked` plus Promise, unsafe-type,
   unnecessary-cast, exhaustiveness, and type-import rules.
5. `mobile-expo`: `eslint-config-expo/flat` scoped to `apps/mobile`.
6. `mobile-native`: `no-unused-styles` and `no-raw-text`; inline/split-platform
   rules stay off.
7. `mobile-reactive`: only RxJS rules that pass fixtures, corpus, and timing.
8. `api-boundaries`: deterministic restricted imports with composition-root
   exceptions.
9. `test-policies`: Vitest and Testing Library only on test globs; standalone
   mocks and helpers receive separate narrow allowances without test plugins.
10. `tooling-policies`: syntax-aware configs/scripts; console only for
    operational output.
11. `prettier-compatibility`: `eslint-config-prettier/flat` last.

### Type Information

- `apps/mobile/tsconfig.json`: entry, app config, `src/**/*.{ts,tsx}`, and
  `__tests__/**/*.tsx`.
- `apps/api/tsconfig.json`: `src/**/*.ts` and `test/**/*.ts`.
- Use `parserOptions.projectService: true` with repository `tsconfigRootDir`.
- App/root Vitest configs, mobile setup, and `.mjs` files outside projects use
  `tseslint.configs.disableTypeChecked`; no broad `allowDefaultProject`.
- A future typed out-of-project config needs an exact path or small lint tsconfig
  plus a timing measurement.

### Reliable Architecture Checks

- mobile cannot import API implementation;
- API HTTP cannot import Prisma, Redis, or local infrastructure directly;
- API domain cannot import HTTP/Express/private provider paths where the current
  corpus already complies;
- private Orange implementation stays limited to composition roots;
- import resolution covers TypeScript aliases and Metro platform suffixes.

No internal mobile screen/component/context/hook/service/store direction is
enforced until the current corpus supports an explicit allowed/forbidden matrix
with positive and negative fixtures. Controller thinness, business intent, DI
correctness, runtime module cycles, custom-component accessibility, and semantic
subscription ownership remain review concerns. Complexity/size heuristics are
rejected as noisy proxies.

## Dependency Decisions

Detailed evidence is in [research.md](./research.md).

**Select**:

- `eslint-config-expo@10.0.0`;
- `eslint-plugin-import@2.32.0` and
  `eslint-import-resolver-typescript@4.4.5`, directly registered once for shared
  and API rules while satisfying Expo's `^2.30.0` import-plugin dependency;
- `eslint-plugin-react-native@5.0.0`, manually registered with two rules;
- `eslint-plugin-unused-imports@4.4.1`;
- `eslint-plugin-testing-library@7.16.2`, test-only;
- `@vitest/eslint-plugin@1.6.25`, test-only;
- `eslint-config-prettier@10.1.8`, last;
- exactly `eslint-plugin-rxjs-x@0.9.6`, installed for a mobile-only evaluation
  and retained only if its compatibility, fixture, corpus, and timing gates pass.

Continue installed `typescript-eslint@8.65.0`. The direct root import packages
are the sole import family; verify the lockfile resolves only
`eslint-plugin-import@2.32.0`, has no `eslint-plugin-import-x`, and has no
incompatible import-plugin peer variant shared by the root config and Expo.

**Reject separately**: React and Hooks plugins (Expo duplicates), `import-x`
(second engine), React Native a11y (peer/Flat incompatible), legacy RxJS
(stale), RxJS-x 1.x (ESLint 10), and
`eslint-plugin-prettier` (mixed responsibilities).

## Planned Files

Planning output: `plan.md`, `research.md`, `data-model.md`, `quickstart.md`, and
`contracts/lint-commands.md` under this feature.

Implementation is limited to:

```text
eslint.config.mjs
package.json
pnpm-lock.yaml
README.md
scripts/verify-eslint-rules.mjs
specs/003-eslint-rules/quickstart.md
apps/mobile/package.json
apps/mobile/.eslint-fixtures/{tsconfig.json,invalid-shared.ts,invalid-mobile.tsx,invalid-mobile.spec.tsx,valid-platform-import.tsx,platform-target.ios.ts,platform-target.android.ts}
apps/mobile/__tests__/phone-auth-flow.test.tsx
apps/api/package.json
apps/api/.eslint-fixtures/{tsconfig.json,invalid-shared.ts,invalid-api.ts,valid-nest-runtime-import.ts}
apps/api/.eslint-fixtures/{migrations/valid-migration.ts,seeds/valid-seed.ts,scripts/valid-script.ts,mocks/valid-mock.ts}
```

Other existing source/test files may change only for classified safe cleanup.
The listed phone-auth test may add behavior-preserving RNTL accessibility
assertions only. No feature-002 docs/contracts, schemas, migrations, navigation,
or runtime config.

## Commands

The detailed contract is [contracts/lint-commands.md](./contracts/lint-commands.md).

| Command                | Scope                    | Semantics                                         |
| ---------------------- | ------------------------ | ------------------------------------------------- |
| `pnpm lint`            | normal repository scope  | check, `--max-warnings=0`                         |
| `pnpm lint:mobile`     | `apps/mobile`            | check, `--max-warnings=0`                         |
| `pnpm lint:api`        | `apps/api`               | check, `--max-warnings=0`                         |
| `pnpm lint:fix`        | normal repository scope  | safe declared fixes, then fail if findings remain |
| `pnpm lint:rules:test` | isolated fixtures        | assert exact expected/forbidden rule IDs          |
| `pnpm format:check`    | Prettier-supported files | separate formatter check                          |

Workspace app lint scripts stay aligned with root scoped commands.

## Verification And Adoption

Fixtures live under `.eslint-fixtures`, are centrally ignored and outside
production tsconfigs/builds, and run only through a JSON-parsing harness with
`--no-ignore`. The harness supports `--group shared|mobile|api|commands` and
`--case <name>` so each configuration diff has a minimal verification. Cover
unused code, Promise/Observable misuse, unsafe types, redundant/unreachable
flow, type imports, console, alias/platform resolution for both iOS and Android,
cross-app/API boundaries, hooks, raw text/styles, list keys, Testing Library,
Vitest, positive Nest DI/DTO runtime imports, and positive path-based API special
scopes. A positive native fixture proves DOM-only a11y rules are absent; focused
RNTL assertions verify native accessibility behavior separately. Their negative
control uses a documented temporary test-local mock that removes one required
native accessibility semantic, records the expected focused-test failure, is
restored with the inverse edit, and is followed by the same focused passing test
and a clean-diff check for the temporary change.

Adopt in order:

1. Exact dependencies and centralized ignores/syntax baseline.
2. Type-aware mobile/API layers and config-file fallback.
3. Expo/native/platform rules and `--print-config` verification.
4. Deterministic import boundaries; retain `import/no-cycle` only after timing.
5. Test plugins and conditional RxJS rules.
6. Prettier compatibility and classified source cleanup.
7. Final errors, commands/docs, then lint, fixtures, formatting, typecheck,
   tests, and builds.

## Cleanup Strategy

**Safe automatic**: ordering, truly type-only imports, unused imports, and other
fixes whose reviewed diff changes no expressions/control flow.

**Mechanical manual**: `_` placeholders; preserve Nest runtime imports; use the
existing logger only where the replacement is behavior-equivalent; add native
roles/labels only where current tests establish intent.

**Forbidden behavior changes**: altered Observable cancellation/composition,
async ordering/error propagation, newly awaited, returned, caught, or detached
Promises, subscription ownership or disposal changes, controllers/layers,
DTO/public contracts, OTP/session/SMS/legal/navigation, or schemas. Such
findings become separate approved work, not global disables.

## Formatting And Performance

Prettier owns layout; ESLint owns correctness/framework/architecture.
`eslint-config-prettier/flat` is last and no formatter runs inside lint. Verify
with `format:check`, its conflict helper, and Prettier-to-`lint:fix` idempotence.

Record one cold run and the median of three warm runs for root/mobile/API plus
`TIMING=1` rule costs. Immediately before T014 enables typed rules, record the
syntax-only checkpoint on fixed mobile/API file sets; after T014, repeat the same
commands as the typed checkpoint. T047 summarizes those staged results instead
of reconstructing a syntax-only final config.

The acceptance gate is warm root at most 30 seconds with neither warm app scope
slower than root. Measure each optional cycle and RxJS-x rule set independently
against the same config and file scope with the rule set disabled. Retain it only
when diagnostics are correct, its warm-median overhead is at most the greater of
1 second or 10 percent of baseline, and its cold overhead is at most the greater
of 2 seconds or 15 percent of baseline. Otherwise keep deterministic boundary
rules and test/review coverage. The two-minute documentation-usability criterion
is measured by its own discovery protocol and is not a lint performance
threshold.

## Risks And Deferred Checks

- Typed lint has typecheck-like cost; nearest projects and scopes limit it.
- Expo import resolution must be proven for platform suffixes.
- Native unused-style analysis is syntactic and needs file-specific exceptions
  for dynamic cases.
- Full native a11y lint and newer effect-state lint are disclosed compatibility
  gaps; compatible static rules, focused RNTL tests, and review cover them without
  browser rules or unsafe overrides.
- RxJS-x 0.9.6 must remain pinned below its ESLint-10 major and may be rejected
  after measurement.
- Static rules cannot prove controller thinness, DI graph correctness, runtime
  cycles, or business intent.
- Feature 002's four manual/external tasks remain out of scope.

## Project Structure

### Documentation (this feature)

```text
specs/003-eslint-rules/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/lint-commands.md
└── tasks.md                 # later /speckit-tasks output
```

### Source Code (repository root)

```text
apps/{mobile,api}/
scripts/verify-eslint-rules.mjs
eslint.config.mjs
package.json
pnpm-lock.yaml
prettier.config.mjs
```

**Structure Decision**: keep the existing two-app workspace and one root Flat
Config. Named scoped arrays are sufficient; no shared workspace package.

## Complexity Tracking

No constitution violation requires justification.

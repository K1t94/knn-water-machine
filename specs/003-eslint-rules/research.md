# Research: Unified ESLint Rules

## Version Baseline

### Decision

Keep pnpm 11.18, Node 24, ESLint 9 Flat Config, and current framework versions.
The lock resolves ESLint 9.39.5, TypeScript 5.9.3, typescript-eslint 8.65.0,
Expo 54.0.36, React Native 0.81.5, React 19.1.0, NestJS 11.1.28, Vitest 3.2.7,
Prettier 3.9.6, RxJS 7.8.2, and RNTL 14.0.1. Manifest ranges are older for
several tools and must not be reported as installed versions.

### Rationale

The repository already has one lockfile, strict app tsconfigs, Flat Config, and
Prettier. Migration or framework upgrades add risk without lint coverage.

### Alternatives Considered

Legacy `.eslintrc`, per-app independent configs, and a new shared workspace
package were rejected as regressions or unnecessary duplication.

## Candidate Matrix

| Candidate                               | Decision and coverage                                             | Compatibility / Flat Config / maintenance                                                              | Overlap, false positives, and performance                                                              | Rejected fallback                                              |
| --------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `eslint-config-expo@10.0.0`             | Select as mobile base: Expo, React, Hooks, imports, JSX/TS syntax | SDK 54 package; ESLint `>=8.10`; native Flat entry; maintained by Expo                                 | Deliberately owns several plugin namespaces; low/medium cost; framework defaults lower false positives | N/A                                                            |
| `typescript-eslint@8.65.0`              | Select installed package: typed Promise/type safety               | ESLint 9 and TS 5.9 compatible; native Flat configs; actively maintained                               | Typed programs are the main performance cost; selective rules avoid strict-preset noise                | N/A                                                            |
| `eslint-plugin-react`                   | Reject as direct dependency                                       | Expo supplies compatible 7.37 line and Flat registration; active upstream                              | Complete duplication and namespace conflict risk                                                       | Expo React layer                                               |
| `eslint-plugin-react-hooks`             | Reject as direct dependency                                       | Expo supplies compatible 5.x line and Flat registration; active upstream                               | Duplicate namespace/version skew; newer effect-state rule is unavailable on this baseline              | Expo Hooks rules plus tests/review for effect-state gap        |
| `eslint-plugin-react-native@5.0.0`      | Select two native rules                                           | ESLint 9 peer; plugin object works in Flat, presets are legacy; low activity                           | Low AST cost; dynamic styles/wrappers can cause false positives, so no broad preset                    | File-specific exceptions or review for dynamic cases           |
| `eslint-plugin-react-native-a11y@3.5.1` | Reject                                                            | Peer ends at ESLint 8; no native Flat preset; recently released but compatibility metadata is blocking | Forcing it risks install/runtime failure; rules are otherwise relevant                                 | RNTL behavior tests and review; no DOM plugin                  |
| `eslint-plugin-import@2.32.0`           | Select one direct root registration for shared/API and Expo use   | ESLint 9 peer support; satisfies Expo 10's `^2.30.0`; Flat plugin object; established maintenance       | One graph engine; cycles may be expensive and platform resolution needs fixtures                       | Restricted imports remain if cycle rule is deferred            |
| `eslint-import-resolver-typescript@4.4.5` | Select direct resolver for aliases and native suffixes           | ESLint-compatible peers; current TypeScript resolver; configured through Flat settings                 | Shared resolver avoids hidden transitive access; platform resolution still requires fixtures           | Explicit restricted paths if resolver proof fails              |
| `eslint-plugin-import-x`                | Reject                                                            | Strong ESLint 9/native Flat support and active maintenance                                             | Would duplicate the selected import parsing/diagnostics despite possible speed benefits                | Direct `eslint-plugin-import` family                           |
| `eslint-plugin-unused-imports@4.4.1`    | Select unused import/variable ownership                           | ESLint 9, typescript-eslint 8, Flat examples; active maintenance                                       | Low cost; JSX/generated globals checked by fixtures; duplicate unused rules disabled                   | TypeScript unused rule without import autofix                  |
| `eslint-plugin-testing-library@7.16.2`  | Select mobile-test-only async/query checks                        | ESLint 9/native Flat; active maintenance                                                               | Low/medium test-only cost; DOM-biased rules and custom helpers can be noisy                            | Keep only proven RNTL subset; tests/review for omitted rules   |
| `@vitest/eslint-plugin@1.6.25`          | Select test-only runner checks                                    | ESLint `>=8.57`, TS 5, native Flat; actively maintained                                                | Low test-only cost; `all`/`expect-expect` may be noisy on helpers                                      | Explicit Vitest imports plus selected core checks              |
| `eslint-config-prettier@10.1.8`         | Select last to disable formatting conflicts                       | ESLint 9/native Flat export; actively maintained                                                       | Negligible cost; no correctness overlap because it only disables style rules                           | Manual conflict audit if removed                               |
| `eslint-plugin-rxjs-x@0.9.6`            | Conditional select for typed mobile Observable errors             | ESLint 9 Flat-only maintained backport; RxJS 7 and TS <6                                               | Medium/high typed cost and lifecycle false-positive risk; exact pin and gates required                 | RxJS behavior tests/review; never syntax-ban all subscriptions |
| `eslint-plugin-rxjs`                    | Reject                                                            | Stale release and incompatible peer/tooling line                                                       | Unsupported typed rules create maintenance risk                                                        | Conditional RxJS-x backport or tests/review                    |

## TypeScript And Unused Code

### Decision

Use installed typescript-eslint with `recommendedTypeChecked` and
`projectService: true` on files included by the nearest app tsconfig. Select
Promise misuse, unsafe flow, unnecessary assertion/argument, exhaustiveness,
and consistent type-import rules. Use `disableTypeChecked` for out-of-project
configs; avoid broad `allowDefaultProject`. This follows the official
[typed lint guide](https://typescript-eslint.io/getting-started/typed-linting/)
and [Project Service guidance](https://typescript-eslint.io/blog/project-service/).

Select `eslint-plugin-unused-imports@4.4.1`; its
[compatibility matrix](https://github.com/sweepline/eslint-plugin-unused-imports)
supports ESLint 9 and typescript-eslint 8. Disable duplicate core/TS unused
rules and use `_` as the single intentional-placeholder prefix.

### Rationale

Typed rules catch defects syntax cannot. Project Service matches editor project
selection. The unused-import plugin supplies a focused safe fix without deleting
side-effect-only imports or emitting duplicate diagnostics.

### Alternatives Considered

Wholesale `strictTypeChecked`, root project arrays, broad default projects, and
blanket naming conventions were rejected for cost or framework false positives.

## Expo, React, Hooks, And Native

### Decision

Select `eslint-config-expo@10.0.0`. Expo documents Flat Config as default for
SDK 53+ in its [ESLint guide](https://docs.expo.dev/guides/using-eslint/), and
the SDK 54 [package source](https://raw.githubusercontent.com/expo/expo/sdk-54/packages/eslint-config-expo/package.json)
shows React, Hooks, import, Expo, and TypeScript dependencies. Reject separate
React/Hooks plugins because Expo already registers them. Its rules accept the
automatic JSX runtime and provide Rules of Hooks/dependency checking.

Select `eslint-plugin-react-native@5.0.0` with manual Flat registration and only
`no-unused-styles`/`no-raw-text`. Its ESLint 9 peers are compatible, but legacy
presets and low maintenance require a smoke test. Keep inline styles and valid
platform splitting allowed.

### Rationale

Expo supplies framework-aware defaults without duplication; the two native
rules add concrete coverage Expo lacks.

### Alternatives Considered

A hand-built Expo stack, plugin `all`, strict inline styles, and
`split-platform-components` were rejected as duplicate/noisy. Expo's Hooks line
predates `set-state-in-effect`; forcing an out-of-range replacement was rejected,
so that newer check is explicitly deferred to tests/review.

## Accessibility

### Decision

Reject `eslint-plugin-react-native-a11y@3.5.1`: its
[package metadata](https://raw.githubusercontent.com/FormidableLabs/eslint-plugin-react-native-a11y/master/package.json)
excludes ESLint 9 and exposes no native Flat preset. Do not substitute DOM-only
`jsx-a11y`. Use compatible static native rules where available, focused RNTL
behavior tests, and a review checklist, with a positive fixture proving native
components are not asked for `alt`/`tabindex`.

### Rationale

Unsupported peers harm reproducibility; browser semantics and simplistic local
Pressable heuristics create false positives for child text and wrappers.

### Alternatives Considered

Force-installation, DOM rules, and a broad local AST heuristic were rejected.

## Import Analysis And Architecture

### Decision

Install `eslint-plugin-import@2.32.0` and
`eslint-import-resolver-typescript@4.4.5` directly at the root and register them
once as the sole import family. Version 2.32.0 supports ESLint 9 and satisfies
Expo 10's `^2.30.0` dependency; verify the lockfile resolves one plugin version.
Verify aliases and `.ios`/`.android`/`.native` suffixes with fixtures.
Use unresolved, duplicate, order, and core restricted-import rules. Benchmark a
limited-depth `import/no-cycle`; retain it only under correctness/time gates.

Use path rules for proven API/mobile boundaries. Preserve Nest runtime value
imports used by decorators, DI tokens, DTOs, modules, guards, interceptors,
filters, and metadata. Nest documents class/string/symbol runtime tokens in its
[provider guide](https://docs.nestjs.com/fundamentals/custom-providers).

### Rationale

Adding import-x would duplicate the selected engine. Depending on Expo's
transitive plugin object would make shared/API policy ownership ambiguous under
pnpm isolation. Static path boundaries are reliable; controller thinness,
business intent, DI wiring, runtime cycles, and current
application-to-infrastructure exceptions are not.

### Alternatives Considered

`eslint-plugin-import-x` was rejected because one directly registered import
family also satisfies Expo and avoids duplicate parsing.
Deep always-on cycles, blanket layer bans, and complexity/size proxies were
rejected for cost or false positives.

## RxJS

### Decision

Install exactly `eslint-plugin-rxjs-x@0.9.6` for a conditional mobile evaluation.
This
maintained Flat-only backport supports ESLint 9, RxJS 7, and TS <6; current 1.x
requires ESLint 10. Start with floating/misused Observable and async-subscribe
rules, then evaluate lifecycle rules against feature 002. The API has no current
Observable workflows. See the [plugin repository](https://github.com/JasonWeinzierl/eslint-plugin-rxjs-x).

### Rationale

Promise rules do not catch ignored Observables. Exact pinning and fixture/timing
gates avoid an incompatible major and protect established ownership patterns.

### Alternatives Considered

Legacy `eslint-plugin-rxjs`, RxJS-x 1.x, and syntax-only `.subscribe()` bans were
rejected. If 0.9.6 fails a gate, Observable semantics remain explicit test/review
coverage rather than a global suppression.

## Tests And Formatting

### Decision

Select `@vitest/eslint-plugin@1.6.25` for test globs and a reviewed recommended
subset; do not add globals because tests import APIs. Select
`eslint-plugin-testing-library@7.16.2` only for mobile RNTL tests, using its
[Flat support](https://github.com/testing-library/eslint-plugin-testing-library)
but excluding DOM-biased/noisy rules.

Select `eslint-config-prettier@10.1.8` last, per its
[official guide](https://github.com/prettier/eslint-config-prettier). Reject
`eslint-plugin-prettier`; formatting and static analysis remain separate.

### Rationale

All selected packages support ESLint 9/Flat Config and are narrowly scoped.
Prettier compatibility disables conflicts without running formatting in lint.

### Alternatives Considered

Legacy Vitest package, `all` presets, global Testing Library rules, formatter in
lint, and replacing Prettier were rejected.

## Performance And Rollout

### Decision

Measure cold/warm root, mobile, and API lint; use `TIMING=1`; compare syntax-only
and typed checkpoints. Assert the warm acceptance threshold separately from the
cold regression baseline. Treat RxJS and cycles as explicit retain/defer gates.
Roll out baseline, typed, framework, boundaries, tests/RxJS, then Prettier.

### Rationale

Type programs and dependency graphs are likely cost centers. Staging makes
findings and regressions attributable; all accepted final rules still become
errors rather than permanent warnings.

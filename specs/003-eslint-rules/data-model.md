# Configuration Model: Unified ESLint Rules

This feature has no persisted business data. These entities define its
configuration and validation model.

## Lint Scope

Fields: stable name, file globs, runtime globals, type-information mode, ordered
rule layers, and narrow exclusions. Every normal source file gets a baseline
and at most one app framework scope. Test/tooling relaxations cannot leak into
production; typed files must belong to their nearest tsconfig.

## Rule Layer

Fields: name, plugin/source, rule map, type requirement, fixability, and owner
(shared/mobile/API/test/tooling). A diagnostic has one owning rule; duplicate
core/plugin rules are disabled together. Prettier compatibility is last and
contains no correctness policy.

## Central Ignore Set

Fields: dependencies, build/coverage/cache/temp output, generated native
projects, generated clients/contracts, and controlled fixtures. It is defined
once and must not hide normal source, tests, platform files, scripts, migrations,
or seeds. Fixtures are reached only by their dedicated command.

## Dependency Decision

Fields: package/version, selected/conditional/rejected status, unique coverage,
ESLint/TS/framework/Flat compatibility, maintenance, overlap, false-positive
risk, performance risk, and fallback.

State transitions:

```text
candidate -> researched -> selected -> fixture-verified -> timed -> enabled
                        \-> rejected
selected/verified/timed -> rejected (failed gate)
```

No conditional package reaches enabled without fixture and timing evidence.

## Override

Fields: special scope, reason, exact rules/globals/type mode, narrow glob, and
positive evidence. Overrides cannot disable the shared baseline. Console is
allowed only for operational output. Inline suppression is last resort and
requires a reason.

## Contract Fixture

Fields: isolated path, positive/negative polarity, scope, expected and forbidden
rule IDs, and nearest fixture tsconfig when typed. Negative success requires the
exact rule, not any nonzero exit. Positive Nest runtime imports and native
platform resolution must remain clean. Fixtures never enter normal lint/build.

## Benchmark Result

Fields: repository/mobile/API/type-cost scope, cold/warm mode, wall seconds,
rule timings, environment, and retain/tune/defer decision. Final cold root lint
must be at most 30 seconds; cycle/RxJS decisions and fixture time are separate.

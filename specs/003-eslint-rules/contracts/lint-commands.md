# CLI Contract: ESLint Commands

Run all commands from the repository root with its pnpm version. Check commands
are read-only. Exit `0` means no remaining warning/error; warnings, lint/parser
errors, or configuration failures produce nonzero exit.

| Command                | Scope                                                | Mutation                   | Success condition                                |
| ---------------------- | ---------------------------------------------------- | -------------------------- | ------------------------------------------------ |
| `pnpm lint`            | normal repository files, centralized ignores applied | none                       | both apps/tooling clean with zero warnings       |
| `pnpm lint:mobile`     | mobile source, tests, entry/config files             | none                       | shared, Expo/native/reactive/test policies clean |
| `pnpm lint:api`        | API source, tests, configs                           | none                       | shared, Nest-safe/boundary/test policies clean   |
| `pnpm lint:fix`        | same normal scope as root lint                       | declared ESLint safe fixes | no findings remain after fixes                   |
| `pnpm lint:rules:test` | isolated `.eslint-fixtures`                          | none                       | exact expected/forbidden rule IDs match          |
| `pnpm format:check`    | existing Prettier scope                              | none                       | formatting is clean, independently of ESLint     |

`lint:fix` must not use broad unsafe suggestion modes. Its diff is reviewed; no
business flow, async order, Observable lifecycle, contract, or schema change is
accepted as automatic cleanup.

The fixture harness bypasses normal ignores, parses ESLint JSON, and succeeds
only on exact diagnostic assertions. Fixtures stay outside production tsconfigs,
tests, builds, and normal lint. Workspace mobile/API lint scripts remain
equivalent to their root scoped commands.

For timing, record cold/warm wall time for root/mobile/API and use `TIMING=1` for
rule cost. Compare syntax-only with typed checkpoints and separately decide
cycle/RxJS retention.

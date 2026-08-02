# Kaynann Water Vending

Monorepo with an Expo React Native mobile application and a NestJS API.

## Prerequisites

- Node.js 24
- pnpm 11.18.0, selected through the root `packageManager` field
- `pnpm install --frozen-lockfile` completed from the repository root

## Lint And Formatting

Run these commands from the repository root:

| Command                | Scope                                        |
| ---------------------- | -------------------------------------------- |
| `pnpm lint`            | All normal repository files                  |
| `pnpm lint:mobile`     | Mobile source, tests, entry, and config      |
| `pnpm lint:api`        | API source, tests, and config                |
| `pnpm lint:fix`        | Safe ESLint fixes across the normal scope    |
| `pnpm lint:rules:test` | Isolated positive and negative rule fixtures |
| `pnpm format:check`    | Independent Prettier formatting check        |

Lint commands use `--max-warnings=0`: warnings, errors, parser failures, and
configuration failures return a non-zero exit code. This makes the commands
suitable for local development and future CI jobs without changing their
semantics.

`pnpm lint:fix` uses only ESLint's declared safe fixes. Review its diff and do
not accept changes to control flow, async or Observable ownership, public
contracts, schemas, or product behavior as automatic cleanup. Prettier owns
layout and runs separately; ESLint does not invoke Prettier.

Files under `.eslint-fixtures` are excluded from normal lint, TypeScript builds,
and production bundles. Only `pnpm lint:rules:test` includes them explicitly and
checks exact expected and forbidden rule IDs.

See the [ESLint quickstart](specs/003-eslint-rules/quickstart.md#extending-lint-scope)
before adding a justified override or a new source category.

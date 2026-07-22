# Implementation Plan: Project Bootstrap Foundation

**Branch**: `001-project-bootstrap` | **Date**: 2026-07-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-project-bootstrap/spec.md`

## Summary

Create a reproducible pnpm monorepo containing autonomous React Native and NestJS applications, a local PostgreSQL/Redis/Mosquitto service stack, a dependency-aware healthcheck, safe environment configuration, and root-level validation commands. The bootstrap deliberately stops at platform and connectivity verification; it does not implement MVP business flows.

## Technical Context

**Language/Version**: TypeScript; Node.js 24.x LTS; SQL only for versioned database migrations/diagnostics

**Primary Dependencies**: pnpm 10 workspace; Expo with `expo-dev-client`; NestJS; Prisma ORM; Vitest; Docker Compose; PostgreSQL; Redis; Mosquitto MQTT broker; optional EAS CLI for cloud builds

**Storage**: PostgreSQL for API persistence and migration smoke checks; Redis for connectivity check; no domain data model in this feature

**Testing**: Vitest for API unit/integration smoke tests; React Native test setup for mobile bootstrap; root orchestration for lint, typecheck, test, and build

**Target Platform**: Node.js API on developer/CI hosts; iOS and Android mobile targets; Docker-compatible local development

**Project Type**: Monorepo with one mobile app and one backend service

**Performance Goals**: Healthcheck completes within 5 seconds under healthy local dependencies; root checks must be deterministic and suitable for CI

**Constraints**: No production secrets; no business integrations; no automatic schema synchronization; Expo Go is not the production-like test target; local mobile builds depend on Xcode/Android SDK/JDK; EAS cloud builds require Expo credentials; MQTT contract is intentionally undefined

**Scale/Scope**: Two applications, three local infrastructure dependencies, one healthcheck contract, one safe environment contract, smoke-level tests, and documented root commands

### Root Command Contract

| Command | Responsibility | Runtime requirement |
|---|---|---|
| `pnpm install --frozen-lockfile` | Install the workspace deterministically | Node.js 24.x, pnpm 10.x |
| `pnpm services:up` / `pnpm services:down` | Start/stop PostgreSQL, Redis, and Mosquitto | Docker Compose |
| `pnpm db:migrate` | Apply committed Prisma migrations | PostgreSQL available |
| `pnpm dev:api` | Start the NestJS API in watch mode | Local `.env`, services for full health |
| `pnpm dev:mobile` | Start the Expo development client | Simulator/emulator/device |
| `pnpm dev` | Run `dev:api` and `dev:mobile` concurrently | Services plus mobile target |
| `pnpm verify:start` | Start/verify services, launch API, and assert `GET /health` | Docker Compose, API port |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | Validate both applications | Node.js 24.x, pnpm 10.x |
| `pnpm build:api` / `pnpm build:mobile:js` | Validate API build and Expo JS bundle | Native SDKs are not required for JS bundle validation |

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Status | Evidence |
|---|---|---|
| One logical diff | PASS | Plan scopes work to repository bootstrap and excludes business features. |
| Boundary validation | PASS | Environment/config inputs and healthcheck dependency status are validated at startup/API boundaries. |
| Explicit public outputs | PASS | Healthcheck contract defines an allow-listed response and forbids secrets/connection strings. |
| Migrations for schema | PASS | Prisma migrations are required; schema synchronization is not used as shared workflow. |
| Security-sensitive behavior | PASS | `.env.example`, ignore rules, and redacted diagnostics are explicit deliverables. |
| Minimal validation | PASS | Each phase has targeted checks plus a startup smoke command. |
| Context discipline | PASS | Design artifacts are limited to this feature and update only the managed plan reference. |

No constitutional violations require complexity justification.

### Post-Design Recheck

PASS. The design keeps the healthcheck response explicitly shaped, treats all
environment values as secrets at the boundary, uses Prisma migrations rather
than synchronization, and limits local MQTT to connectivity scaffolding. No
business schema, authentication, payment, balance, dispense, or referral
behavior is introduced.

## Project Structure

### Documentation (this feature)

```text
specs/001-project-bootstrap/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
└── tasks.md                 # created by /speckit-tasks
```

### Source Code (repository root)

```text
apps/
├── api/
│   ├── src/
│   │   ├── health/
│   │   ├── config/
│   │   ├── prisma/
│   │   └── main.ts
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/
│   └── test/
└── mobile/
    ├── src/
    ├── app.config.ts
    ├── eas.json
    └── __tests__/
infra/
└── compose.yaml
scripts/
└── verify-startup.mjs
docs/
└── local-development.md
package.json
pnpm-workspace.yaml
pnpm-lock.yaml
.env.example
.nvmrc
```

**Structure Decision**: Keep the two deployable applications under `apps/` with independent package manifests and entry points. The mobile application uses Expo development builds and app config; native `ios/` and `android/` projects are generated by prebuild/CNG and are not hand-authored in the foundation unless a later native customization requires that change. Keep tooling configuration at the repository root and inside each application; do not create a shared config or business package until concrete reuse justifies it. Keep local infrastructure under `infra/`, operational validation in `scripts/`, and the source-of-truth onboarding map under `specs/000-project-onboarding/repo-map.md`.

## Complexity Tracking

No constitution violations require complexity tracking.

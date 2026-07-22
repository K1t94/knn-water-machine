# Local Development

## Prerequisites

- Node.js 24 LTS
- pnpm 10.15.1
- Docker Desktop with Compose
- Expo-compatible mobile tooling for native runs

## Selected Toolchain

- `pnpm 10.15.1` workspace with one root lockfile.
- Node.js `24.x LTS`, pinned by `.nvmrc` and the root `engines` field.
- Expo SDK 54 with React Native 0.81 and `expo-dev-client`; native projects are
  generated through Expo prebuild/CNG when required.
- NestJS 11 API with Prisma 6 and committed, migration-first PostgreSQL schema.
- Vitest 3 for API unit/integration smoke tests and mobile JavaScript tests.
- PostgreSQL 17, Redis 7, and Mosquitto 2 supplied by `infra/compose.yaml`.

The MQTT broker is an emulator for connectivity scaffolding only. No vending
topic or dispense payload contract is implemented in this bootstrap.

## First Run

```sh
cp .env.example .env
pnpm install
pnpm services:up
pnpm db:migrate
pnpm verify:start
```

`verify:start` starts the API, polls `GET /health`, and succeeds only when
PostgreSQL, Redis, and MQTT are reachable and the response is healthy within
the required 5-second healthcheck limit. It does not print child-process logs
or environment values.

`.env.example` documents the local environment contract. It contains only
loopback endpoints and a development-only placeholder password. Copy it to
`.env` for local work; never add production endpoints, credentials, tokens,
private keys, or certificates to the example file.

## Development Commands

```sh
pnpm dev:api
pnpm dev:mobile
pnpm lint
pnpm typecheck
pnpm test
pnpm build:api
pnpm build:mobile:js
pnpm mobile:doctor
pnpm check:env
pnpm check:repo
```

The local services are exposed on PostgreSQL `5432`, Redis `6379`, and MQTT
`1883`. Stop them with `pnpm services:down`.

The root `db:migrate` wrapper loads the root `.env` and applies committed Prisma
migrations explicitly. It does not use automatic schema synchronization.

## CI-Equivalent Validation

Run the same deterministic checks used by local CI before opening a change:

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build:api
pnpm build:mobile:js
```

API tests include the public health contract and service shaping tests. The
mobile test validates the Expo baseline entry point without requiring a native
simulator.

Native prerequisites are checked separately:

```sh
pnpm mobile:doctor
```

Missing `xcodebuild` or `adb` is reported as an optional limitation for the
corresponding native platform; it does not block API checks or the Expo
JavaScript bundle. A native build still requires Xcode/CocoaPods on macOS or
Android Studio, Android SDK, and Java on Android.

## Scope

This bootstrap contains connectivity checks and an Expo/NestJS skeleton only.
OTP, payments, balance, MQTT vending commands, and referrals are intentionally
out of scope.

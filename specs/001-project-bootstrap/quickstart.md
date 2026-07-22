# Bootstrap Quickstart Validation

This guide defines the validation flow for the implementation. Commands are the planned stable root scripts; after implementation they must match the actual root `package.json` and be copied into `specs/000-project-onboarding/repo-map.md`.

## Prerequisites

- Node.js 24.x LTS.
- pnpm 10.x enabled through Corepack or the documented equivalent.
- Docker and Docker Compose.
- For Expo JavaScript development: an Expo development build installed on a simulator/emulator/device, or Expo Go only for a limited baseline screen check.
- For local mobile native builds: Xcode and CocoaPods on macOS for iOS, or Android Studio, Android SDK, and JDK 17 for Android.
- For EAS cloud builds: an Expo account and the EAS CLI; this is optional for local API and JavaScript validation.

## Setup

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm services:up
pnpm db:migrate
pnpm mobile:doctor
```

The copied `.env` must contain local placeholders only. No production or external-provider credentials are needed.

The root `db:migrate` command loads this root `.env` and invokes Prisma's
committed migrations explicitly; it does not synchronize the schema.

## Development Start Commands

Start the local services and apply migrations first:

```sh
pnpm services:up
pnpm db:migrate
```

Start the API independently in watch mode:

```sh
pnpm dev:api
```

Start the Expo development client independently on a simulator, emulator, or device:

```sh
pnpm dev:mobile
```

For convenience, `pnpm dev` runs `dev:api` and `dev:mobile` concurrently. It does not replace `services:up` or `db:migrate`.

## Mobile Development Build

```sh
pnpm mobile:prebuild
pnpm dev:mobile
```

`mobile:prebuild` generates the native projects from Expo app config when needed. Use `expo-dev-client` development builds for production-like native testing; Expo Go is not sufficient for remote push, app/universal links, or native libraries not bundled into Expo Go.

For cloud development builds, use the Expo EAS CLI directly when EAS
credentials are available. The current bootstrap does not add root EAS wrapper
commands. For local native builds, use the documented platform-specific
commands after `mobile:prebuild`. A native dependency change requires
rebuilding the development client.

## Static Validation

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build:api
pnpm build:mobile:js
```

`build:mobile:js` validates the Expo JavaScript bundle. Native Android/iOS builds require the platform SDKs locally or the optional EAS cloud build path. When native prerequisites are unavailable, run the mobile static checks and report the missing prerequisite rather than substituting a different command.

## Startup Verification

```sh
pnpm services:up
pnpm verify:start
```

Expected result: the script starts or verifies the local service stack, starts the API through the same path as `pnpm dev:api`, calls `GET /health`, confirms HTTP `200`, all dependency statuses `up`, and a total response time under 5 seconds, then exits `0`. It exits non-zero with a redacted diagnostic if a dependency or startup step fails. An unavailable dependency must produce HTTP `503` within the same 5-second limit rather than hanging. Mobile startup is verified separately with `pnpm dev:mobile` because it requires a simulator, emulator, or device.

## Out Of Scope Check

The quickstart must not require OTP, payments, wallet/balance operations, referral codes, physical dispense commands, external provider credentials, or a real vending machine.

## Residual Risks

- The repository requires Node.js 24.x LTS; the checks emit an engine warning
  if an older Node version is active.
- Native iOS and Android builds remain platform-dependent: this environment may
  lack `xcodebuild`, CocoaPods, `adb`, Android Studio, or a configured device.
  API checks and Expo JavaScript export remain runnable without those SDKs.
- PostgreSQL, Redis, and Mosquitto data are disposable local development state;
  no production service or credential is used by the bootstrap.

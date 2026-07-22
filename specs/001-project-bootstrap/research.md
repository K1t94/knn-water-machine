# Research: Project Bootstrap Foundation

## Decision: pnpm 10 workspace

- **Rationale**: One lockfile and root scripts can orchestrate independent `apps/api` and `apps/mobile` packages without coupling their runtime code. pnpm's workspace model fits a monorepo and supports filtered commands.
- **Alternatives considered**: npm workspaces (less focused filtering); Yarn (valid, but no existing repository convention and unnecessary migration cost).
- **Implementation note**: Pin the package manager through `packageManager` in the root manifest and commit `pnpm-lock.yaml`.

## Decision: Node.js 24.x LTS

- **Rationale**: Node's official release page lists v24 as LTS on 2026-07-22. It is the current LTS line suitable for the API and tooling.
- **Alternatives considered**: Node 22.x LTS (older supported line, fallback if a selected native dependency does not support 24); Node 26 Current (not selected because production guidance favors LTS).
- **Source**: https://nodejs.org/en/about/previous-releases

## Decision: Expo development builds for `apps/mobile`

- **Rationale**: The MVP requires camera/QR, maps/location, deep links, push, secure storage, and platform-specific permission configuration, but it does not currently require a custom machine SDK or custom native module. Expo provides these capabilities while reducing native bootstrap and onboarding cost. Development builds, rather than Expo Go, preserve the ability to use native libraries and custom native configuration.
- **Alternatives considered**: Bare React Native CLI (more direct native ownership, but higher bootstrap and maintenance cost without a current custom-native requirement); Expo Go only (rejected because production-like native libraries, push, app links, and native configuration require a custom development build).
- **Source**: https://docs.expo.dev/develop/development-builds/introduction/
- **Operational choice**: Use Expo prebuild/CNG as the native project generation path. Treat generated `ios/` and `android/` directories as derived unless a deliberate native customization requires committing them. Use EAS for reproducible cloud test builds when credentials are available; keep local build commands documented and usable with Xcode/Android SDK.

## Decision: Prisma ORM with migration-first PostgreSQL workflow

- **Rationale**: Prisma provides a typed schema/client workflow and a first-class migration path compatible with the TypeScript API. Migrations are committed and applied explicitly; automatic schema synchronization is prohibited.
- **Alternatives considered**: TypeORM (NestJS ecosystem fit, but less attractive generated type workflow); Drizzle (strong SQL control, but no existing repository evidence).
- **Source**: https://www.prisma.io/docs/getting-started

## Decision: Vitest for API and mobile JavaScript tests

- **Rationale**: One fast runner can cover API unit/integration smoke tests and mobile JavaScript bootstrap tests; native device tests remain a separate prerequisite.
- **Alternatives considered**: Jest (mature React Native default and fallback); Node built-in test runner (not sufficient for the mobile transform/module ecosystem).
- **Implementation note**: Select the React Native transformer/preset during dependency bootstrap and record it in the app manifest.

## Decision: Expo modules for baseline native capabilities

- **Rationale**: Prefer maintained Expo modules for camera/QR, location, notifications, linking, and secure storage in the foundation. This keeps permissions and native configuration explicit in app config and avoids prematurely adding bespoke native code.
- **Alternatives considered**: Separate community native packages for every capability (may still be introduced when a concrete MVP requirement needs them); direct FCM/APNs native integration (retain as a later option if provider-specific behavior exceeds the Expo notifications contract).
- **Source**: https://docs.expo.dev/develop/development-builds/use-development-builds/

## Decision: Docker Compose with PostgreSQL, Redis, and Mosquitto

- **Rationale**: Compose provides a disposable local topology with healthchecks and named network endpoints. Mosquitto supplies a local MQTT broker for connectivity tests without pretending to be the vending-machine protocol.
- **Alternatives considered**: Testcontainers (more isolated but more moving parts for onboarding); in-process MQTT mock (does not validate broker connectivity and topic transport).

## Resolved Unknowns

- Package manager: pnpm 10.
- Node.js baseline: 24.x LTS.
- ORM: Prisma.
- Test runner: Vitest, with React Native-specific transform configuration as needed.
- Local MQTT emulator: Mosquitto broker with bootstrap-only topics/credentials; no dispensing payload contract.
- Mobile native build: Expo development builds with Xcode/Android SDK/JDK prerequisites documented separately from API checks; EAS cloud builds are optional infrastructure, not a runtime dependency.

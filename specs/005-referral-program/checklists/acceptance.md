# Phase 9 Acceptance Checklist

**Feature**: `005-referral-program`  
**Recorded**: 2026-08-11

## Hermetic And Contract Evidence

- [x] Referral API domain, application, HTTP, and OpenAPI tests pass: 12 files,
      76 tests.
- [x] Referral mobile API, store, flow, deep-link, native-action, screen, and
      navigation tests pass: 8 files, 23 tests.
- [x] Generated OpenAPI matches the source contract.
- [x] Default `pnpm test` passes with referral service-backed suites skipped:
      API 323 passed/90 opt-in skipped; mobile 113 passed.
- [x] Workspace ESLint and TypeScript checks pass.

## Service-Backed Evidence

Prerequisites and commands are documented in
`specs/005-referral-program/quickstart.md`.

- [x] PostgreSQL referral migration, provisioning, repository, concurrency, and
      recovery suites pass: 5 files, 27 tests; the 9-test registration file is
      skipped by this PostgreSQL-only command.
- [x] PostgreSQL plus Redis registration suite passes: 9 tests.
- [x] Feature-004 wallet PostgreSQL regressions pass: 2 files, 10 tests.
- [x] Concurrent same-code and competing-code referral attempts execute at the
      planned 100-request scale.
- [x] Recovery proves lease reclaim, `SKIP LOCKED`, crash-after-credit replay,
      permanent conflict handling, and exactly one wallet ledger effect.
- [x] SC-006 apply starts the real one-second scheduler and observes the
      relationship, invitation, inviter summary, and exactly one 5,000 ml wallet
      effect in about 1.6 seconds, below the 5-second limit.
- [x] SC-006 registration starts the real one-second scheduler and observes the
      relationship, 10,000 ml welcome effect, and 5,000 ml inviter effect in
      about 0.3 seconds, below the 5-second limit.

## Final Gates

- [x] Prisma format and validate.
- [x] Prisma client generation.
- [x] API and mobile lint.
- [x] Prettier check.
- [x] API and mobile typecheck.
- [x] Full workspace tests.
- [x] API build.
- [x] iOS/Android Expo JS export.
- [x] OpenAPI consistency.

## Manual Evidence

- [x] The user confirmed the T086 iOS and Android visual, accessibility,
      deep-link, session-lifecycle, copy, and share checks on 2026-08-11.
- [x] The user confirmed the separate SC-005 copy and share runs completed
      within 10 seconds on both platforms. Exact durations were not recorded.

Detailed evidence is recorded in [`mobile-visual.md`](mobile-visual.md).
Commands, prerequisites, and manual procedures are documented in
[`quickstart.md`](../quickstart.md).

## Environment Note

The managed command sandbox denied loopback listeners/connections during the
first full-suite attempt. The same loopback-dependent commands were rerun with
local-service permission and passed; this was an execution-environment
restriction, not a product failure.

# Phase 8 Runtime And Rollout Validation

**Feature**: `005-referral-program`  
**Executed**: 2026-08-13  
**Environment**: local disposable services and three local API instances; this
is not approval for a shared-environment contract migration.

## Operational Control

- [x] Authorized `curl` disable completed in 25 ms and changed revision `11` to
      `12`; its 6 ms repeat retained revision `12`.
- [x] An invalid credential returned HTTP 401 in 3 ms; the next authorized read
      proved state and revision were unchanged.
- [x] Authorized `curl` enable completed in 10 ms and changed revision `12` to
      `13`; its 7 ms repeat retained revision `13`.
- [x] `pnpm referral:disable` completed in 9.567 s at revision `14`; its repeat
      completed in 2.863 s and retained revision `14`.
- [x] `pnpm referral:enable` completed in 2.694 s at revision `15`; its repeat
      completed in 3.623 s and retained revision `15`.
- [x] An invalid-credential package call exited non-zero on HTTP 401 in 24.934 s
      without printing the credential or changing state.
- [x] An unreachable-URL package call exited non-zero in 4.772 s without
      printing the credential.

All cases completed under 30 seconds. Credentials came only from environment
variables and are not recorded here.

## Persistence And Multiple Instances

- [x] API processes on ports 3000, 3001, and 3002 shared one authoritative
      PostgreSQL database.
- [x] A disable on port 3000 produced revision `16`; all three `/v1/app-config`
      responses showed `referralProgramEnabled=false` within 4.685 s.
- [x] After all three processes were stopped and restarted, every instance still
      returned `false`.
- [x] An enable on port 3001 produced revision `17`; all three instances returned
      `true` within 2.507 s. The local environment was left enabled.

## Registration And Recovery

- [x] Registration acceptance: 9 tests passed for enabled/disabled registration,
      invalid/self referral, replay, and concurrent completion.
- [x] Recovery acceptance: 9 tests passed for paused delivery, safe resume, and
      exactly-once inviter delivery.
- [x] Repository acceptance: 3 tests passed, including 100 disable/enable cycles
      preserving codes, relationships, entitlements, ledger, history, and totals.
- [x] Referral concurrency: 3 tests passed; wallet credit concurrency: 2 passed.
- [x] Assertions prove only the inviter receives the new entitlement; no invitee
      referral bonus or welcome bonus is created.

Shared rollout and the T073 contraction gate remain blocked separately in
`rollout-readiness.md`.

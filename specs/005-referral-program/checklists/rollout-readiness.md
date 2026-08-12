# Referral Eligibility Contract Rollout Readiness

## Prepared Evidence

| Gate | Status | Evidence |
|------|--------|----------|
| T070 runtime boundary | PASS | `referral-boundaries.spec.ts`: API production source has no active eligibility, eligibility-close command, or post-registration apply route/command reference |
| T070 generated client boundary | PASS | Contract acceptance confirms the generated `PrismaClient` has no `referralEligibility` delegate |
| T071 contract migration | PREPARED ONLY | `20260812000200_drop_referral_eligibility` uses explicit `DROP TABLE`, `DROP FUNCTION`, and `DROP TYPE` statements without `CASCADE` |
| T072 disposable migration | PASS | 2026-08-13: `referral-migration.integration-spec.ts`, 11 tests passed against local disposable PostgreSQL schemas |
| T072 compatible binary | PASS | Prisma generation and API typecheck pass against the contracted schema; preserved models remain queryable after migration |

The disposable acceptance seed includes users, a promo code, a relationship, an
inviter entitlement, a wallet, a wallet ledger row, and a legacy eligibility
row. The post-migration assertions compare preserved row counts and retrieve the
historical relationship and entitlement through the newly generated client.

## Blocking T073 Application Gate

Status: **NOT EXECUTED**

The contract migration must not be applied to a shared environment until every
field below is recorded and approved immediately before application.

| Required evidence | Recorded value |
|-------------------|----------------|
| Target environment | Pending |
| Compatible deployed API version(s) | Pending |
| Proof each live version passed the T070 boundary | Pending |
| Old-instance termination/drain evidence | Pending |
| Responsible approver and timestamp | Pending |
| Migration application timestamp | Pending |
| Applied migration identity from `_prisma_migrations` | Pending |
| Pre/post user row count | Pending |
| Pre/post promo-code row count | Pending |
| Pre/post relationship row count | Pending |
| Pre/post entitlement row count | Pending |
| Pre/post wallet-ledger row count | Pending |
| Eligibility table/type/function absent | Pending |
| Referral availability and recovery health check | Pending |

Any missing field blocks application. A local disposable migration run is not
approval for a shared environment.

## Local Phase 8 Evidence

Backend, operational-control, restart, three-instance propagation,
registration, recovery, and concurrency evidence is recorded in
`backend-validation.md` and `runtime-rollout-validation.md`. Those local results
do not populate or approve any T073 field above.

Mobile automation is recorded in `mobile-visual.md`. Current iOS and Android
manual comparison and timing remain pending, so T083 is not complete.

## Forward-Only Recovery

After the contract migration, a legacy binary that references eligibility is
incompatible and must be rejected from deployment.

1. Disable the referral feature through the authoritative operational endpoint.
2. Stop or replace the incompatible binary; do not recreate eligibility storage.
3. Deploy a corrected forward binary that is compatible with the contracted schema.
4. Do not run a down migration and do not synthesize deleted eligibility rows.
5. Verify preserved referral/accounting row counts and exactly-once recovery health.
6. Re-enable referral only after the corrected deployment and health checks pass.

Rollback after contraction is therefore an application rollback only to a
known compatible build. Database recovery remains forward-only.

## Residual Risks

- Shared-environment deployed-version inventory, old-instance drain, approver,
  migration identity, and historical row counts remain unrecorded.
- Current-build iOS and Android accessibility, visual comparison, disabled-state
  timing, and copy/share timing remain unexecuted.
- T084 remains blocked until T073 executes immediately before migration
  application and the rollout table contains real environment evidence.

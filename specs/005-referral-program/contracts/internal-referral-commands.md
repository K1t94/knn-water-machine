# Internal Referral Command Contracts

These application boundaries are trusted in-process contracts. They are not
HTTP endpoints and must not be registered in Swagger. Prisma types appear only
on the transaction-aware composition adapter used by registration; referral
domain and public application services remain persistence-agnostic.

## Registration Onboarding

```ts
type CompleteReferralOnboardingInput = Readonly<{
  userId: string;
  isNewUser: boolean;
  pendingPromoCode: string | null;
  completedAt: Date;
  registrationCompletionId: string;
}>;

type CompleteReferralOnboardingResult = Readonly<{
  promoCode: string;
  relationshipCreated: boolean;
  entitlementIds: readonly string[];
}>;
```

The registration composition adapter invokes this command with its existing
`Prisma.TransactionClient` inside the current serializable completion
transaction. The implementation must:

1. Provision promo and eligibility rows idempotently.
2. Create a welcome entitlement only when `isNewUser` is true.
3. Canonicalize and revalidate pending promo ownership in the transaction.
4. Lock eligibility before attaching a relationship.
5. Create at most one inviter entitlement.
6. Return only durable entitlement IDs; it must not call wallet before commit.

Before the transaction begins, registration validates pending promo while Redis
authorization is still editable. Unknown, malformed, or self-owned input fails
completion with a stable public referral error and does not advance Redis to a
state that prevents editing/removal. The transaction repeats authoritative
validation to close races.

After commit, registration may request a bounded inline delivery attempt for
the returned entitlement IDs. Failure of that attempt is logged and left to
durable recovery; it does not roll back user/legal/session state and does not
change the existing registration response.

`registrationCompletionId` is diagnostic command identity and must not be used
as the wallet business key. `completedAt` describes registration completion and
must not be reused as relationship `appliedAt`; the database assigns the latter
when inserting a relationship. Entitlement UUIDs define stable wallet events.

## Apply Promo Code

```ts
type ApplyReferralCodeCommand = Readonly<{
  inviteeUserId: string;
  promoCode: string;
}>;

type ApplyReferralCodeResult = Readonly<{
  status: "ATTACHED" | "ALREADY_ATTACHED";
  canonicalPromoCode: string;
  appliedAt: Date;
  inviterEntitlementId: string;
}>;
```

The HTTP adapter derives `inviteeUserId` only from `AccessSessionGuard`.
`promoCode` is bounded at the DTO and canonicalized in the application layer.
The repository assigns `appliedAt` through the database when it inserts the
relationship in the transaction that successfully commits. Callers cannot
provide this timestamp, and same-code replay returns the persisted value.
The repository transaction locks the eligibility row and either:

- creates relationship plus entitlement and commits `ATTACHED`;
- returns `ALREADY_ATTACHED` when the same inviter is already attached;
- raises `REFERRAL_ALREADY_ATTACHED` for a different inviter;
- raises `REFERRAL_ELIGIBILITY_CLOSED` for closed eligibility;
- raises `REFERRAL_SELF_NOT_ALLOWED` for own code; or
- raises `REFERRAL_CODE_UNAVAILABLE` for invalid/unknown code.

No public `Idempotency-Key` is required because a user can acquire exactly one
immutable relationship and same-code replay has a deterministic stored result.
After commit, the application performs one bounded inline entitlement delivery
attempt. The response confirms relationship attachment, not technical worker
state; credited totals/history change only after the entitlement reaches
`DELIVERED` through a confirmed wallet effect.

## Close Eligibility After A Future Successful Purchase

```ts
type CloseReferralEligibilityCommand = Readonly<{
  userId: string;
  purchaseBusinessEventKey: string;
  succeededAt: Date;
}>;

type CloseReferralEligibilityResult =
  | Readonly<{ status: "CLOSED"; closedAt: Date }>
  | Readonly<{ status: "ALREADY_CLOSED"; closedAt: Date }>
  | Readonly<{ status: "ALREADY_ATTACHED" }>;
```

This trusted application command has no HTTP adapter. A future purchase module
calls it only after the purchase is successfully completed; failed, cancelled,
or incomplete purchases never call it. The stable purchase key is validated
using the project's bounded business-key convention.

The referral repository locks the eligibility row. `OPEN` becomes `CLOSED` and
records the key/time; replay of the same key returns `ALREADY_CLOSED`; a
different close key on an already closed row is a stable event conflict;
`ATTACHED` returns `ALREADY_ATTACHED`. A future purchase repository that needs
the purchase and eligibility effects in one commit may use a narrow
transaction-aware composition adapter rather than exposing Prisma through the
domain contract.

Apply and close serialize on the same row. The first successfully committed
transition wins; there is no timestamp heuristic.

## Deliver Bonus Entitlement

```ts
type DeliverReferralEntitlementCommand = Readonly<{
  entitlementId: string;
  expectedLeaseOwner?: string;
}>;

type DeliverReferralEntitlementResult =
  | Readonly<{ status: "DELIVERED"; walletLedgerEntryId: string }>
  | Readonly<{ status: "RETRY_SCHEDULED"; nextAttemptAt: Date }>
  | Readonly<{ status: "PERMANENT_FAILURE"; errorCode: string }>
  | Readonly<{ status: "STALE_LEASE" }>;
```

Delivery loads immutable entitlement facts and calls the existing
`WalletCommandService.credit` with:

```ts
{
  userId: entitlement.beneficiaryUserId,
  businessEventKey: `referral_bonus:${entitlement.id}`,
  amountMl: entitlement.amountMl,
  operationKind:
    entitlement.kind === "WELCOME"
      ? "REFERRAL_WELCOME_BONUS"
      : "REFERRAL_INVITER_BONUS",
  source: "REFERRAL_PROGRAM",
  occurredAt: entitlement.occurredAt,
}
```

Every retry uses those exact stored facts. Wallet idempotent replay after a
caller timeout or process crash returns the original ledger entry. A conditional
entitlement update stores that entry only if the worker still owns the lease.
A stale worker may have caused the wallet effect, but cannot overwrite a newer
lease; the next worker safely reconciles by replaying the same key.

Retryable dependency failures return to `PENDING` with bounded exponential
backoff and jitter. Wallet fact conflict or corrupt immutable data becomes
`PERMANENT_FAILURE` and emits high-severity structured diagnostics without user
data. No finite retry limit discards a transient obligation.

## Recovery Claim

```ts
type ClaimReferralEntitlementsInput = Readonly<{
  workerId: string;
  now: Date;
  leaseDurationMs: number;
  limit: number;
}>;
```

The PostgreSQL repository claims due `PENDING` rows and expired `PROCESSING`
rows with `FOR UPDATE SKIP LOCKED`, sets `PROCESSING`, increments attempts, and
commits before wallet calls. Defaults are batch 25, lease 30 seconds, schedule
one second, and retry delay from one second to five minutes. Only one recovery
run overlaps per process; multiple processes remain safe.

The scheduled worker and `referral:recover` CLI share this application service.
The CLI can retry due/expired obligations but cannot edit referral facts,
entitlement amounts, wallet balances, or ledger entries.

## Public Query Boundaries

```ts
type GetMyReferralQuery = Readonly<{ userId: string }>;

type GetInvitationsQuery = Readonly<{
  inviterUserId: string;
  limit: number;
  beforeSequence: bigint | null;
}>;
```

Reads provision missing promo/eligibility records as an existing-user safety
repair without creating bonus entitlements. Summary and history include only
successfully delivered inviter entitlements. Public mappers never expose user
IDs, wallet event keys, entitlement IDs, leases, attempts, error fields, or full
phone numbers.

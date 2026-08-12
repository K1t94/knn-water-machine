# Internal Referral Command Contracts

These are trusted application boundaries, not public HTTP endpoints.

## Complete Referral Onboarding

Called from successful registration completion inside its existing serializable Prisma transaction.

```ts
interface CompleteReferralOnboardingInput {
  userId: string;
  isNewUser: boolean;
  pendingPromoCode: string | null;
  completedAt: Date;
  registrationCompletionId: string;
}

interface CompleteReferralOnboardingResult {
  promoCode: string;
  relationshipCreated: boolean;
  inviterEntitlementIds: readonly string[];
}
```

Rules:

- Execute only after OTP, current legal acceptance, and registration completion preconditions.
- Lock/read authoritative availability in the same transaction before referral validation or writes.
- Always provision the registering user's stable promo code idempotently.
- Disabled/unavailable state consumes pending context and returns no relationship or entitlement without failing registration.
- Enabled plus no code returns no relationship or entitlement.
- Enabled plus valid non-self code atomically creates one `REGISTRATION` relationship and one `INVITER` entitlement.
- Never create welcome/invitee entitlements.
- Repeated or concurrent completion converges through completion identity and database uniqueness.

## Validate Pending Registration Promo

```ts
interface ValidatePendingRegistrationPromoInput {
  promoCode: string;
  prospectiveInviteeUserId?: string;
}
```

This boundary exists only for editable registration context. It canonicalizes and returns privacy-safe unavailable/self outcomes while enabled. Disabled state must not retain the code or expose owner information. Validation never creates a relationship, entitlement, or wallet operation.

## Read Referral Availability

```ts
interface ReferralAvailability {
  enabled: boolean;
  revision: bigint;
  updatedAt: Date;
}
```

Public consumers receive only the boolean. Internal business consumers use an authoritative read or transactional shared-lock assertion. Storage failure is distinct from disabled state and fails referral behavior closed.

## Set Referral Availability

```ts
interface SetReferralAvailabilityInput { enabled: boolean }
type SetReferralAvailabilityResult = ReferralAvailability;
```

Only the protected operational controller may invoke this command. It takes an exclusive row lock. Same-value calls are idempotent and keep revision/time; transitions increment revision once.

## Deliver Inviter Entitlement

```ts
interface DeliverReferralEntitlementInput {
  entitlementId: string;
  expectedLeaseOwner?: string;
}
```

Rules:

- Accept only active `INVITER` entitlements; legacy `WELCOME` rows are not eligible.
- Claim only while enabled.
- Invoke a trusted wallet command that takes a shared feature-row lock inside the wallet transaction immediately before the idempotent ledger write.
- If disabled wins the lock order, create no ledger entry and return the entitlement to retryable pending state.
- Preserve the stable business-event key on every retry.
- Crash after wallet commit is reconciled by idempotent replay and entitlement completion after re-enable.

## Run Referral Recovery

```ts
interface ReferralRecoveryRunOptions {
  batchSize?: number;
  workerId?: string;
}
```

While disabled, claim zero rows and perform no wallet work. After enable, expired/current due inviter obligations resume with existing `FOR UPDATE SKIP LOCKED`, leases, bounded backoff, and wallet idempotency.

## Query Referral Data

Authenticated query commands derive `userId` from session claims. They first require enabled authoritative state and otherwise return `FEATURE_DISABLED`. Summary contains no eligibility or attached-code state. Invitation history includes only delivered inviter entitlements and privacy-safe fields.

## Removed Contracts

- Post-registration apply promo code.
- Close referral eligibility after purchase.
- Create welcome entitlement.
- Provision eligibility.
- Public or internal attached-code/eligibility state.

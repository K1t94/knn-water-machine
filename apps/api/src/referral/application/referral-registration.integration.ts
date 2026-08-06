import type { PromoCode, ReferralEntitlementId } from '../domain/referral-types';

export const REFERRAL_REGISTRATION_INTEGRATION = Symbol('REFERRAL_REGISTRATION_INTEGRATION');

export interface CompleteReferralOnboardingInput {
    readonly userId: string;
    readonly isNewUser: boolean;
    readonly pendingPromoCode: string | null;
    readonly completedAt: Date;
    readonly registrationCompletionId: string;
}

export interface CompleteReferralOnboardingResult {
    readonly promoCode: PromoCode;
    readonly relationshipCreated: boolean;
    readonly entitlementIds: readonly ReferralEntitlementId[];
}

export interface ReferralRegistrationIntegration<TTransaction = unknown> {
    prevalidatePendingPromo(pendingPromoCode: string | null, inviteeUserId?: string): Promise<PromoCode | null>;
    completeOnboarding(
        transaction: TTransaction,
        input: CompleteReferralOnboardingInput,
    ): Promise<CompleteReferralOnboardingResult>;
    deliverAfterCommit(entitlementIds: readonly ReferralEntitlementId[]): Promise<void>;
}

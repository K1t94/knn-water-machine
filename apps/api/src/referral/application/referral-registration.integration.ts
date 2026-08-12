import type { PromoCode, ReferralEntitlementId } from '../domain/referral-types';

export const REFERRAL_REGISTRATION_INTEGRATION = Symbol('REFERRAL_REGISTRATION_INTEGRATION');

export interface CompleteReferralOnboardingInput {
    readonly userId: string;
    readonly pendingPromoCode: string | null;
    readonly completedAt: Date;
    readonly registrationCompletionId: string;
}

export interface CompleteReferralOnboardingResult {
    readonly promoCode: PromoCode;
    readonly relationshipCreated: boolean;
    readonly inviterEntitlementIds: readonly ReferralEntitlementId[];
}

export interface ReferralRegistrationIntegration<TTransaction = unknown> {
    completeOnboarding(
        transaction: TTransaction,
        input: CompleteReferralOnboardingInput,
    ): Promise<CompleteReferralOnboardingResult>;
    deliverAfterCommit(inviterEntitlementIds: readonly ReferralEntitlementId[]): Promise<void>;
}

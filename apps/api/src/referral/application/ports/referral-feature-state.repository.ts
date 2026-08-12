export const REFERRAL_FEATURE_STATE_REPOSITORY = Symbol('REFERRAL_FEATURE_STATE_REPOSITORY');

export const REFERRAL_PROGRAM_FEATURE_KEY = 'REFERRAL_PROGRAM' as const;

export interface ReferralFeatureAvailability {
    readonly key: typeof REFERRAL_PROGRAM_FEATURE_KEY;
    readonly enabled: boolean;
    readonly revision: bigint;
    readonly updatedAt: Date;
}

export interface SetReferralFeatureAvailabilityInput {
    readonly enabled: boolean;
}

export interface ReferralFeatureStateRepository {
    readAvailability(): Promise<ReferralFeatureAvailability>;
    isEnabledWithSharedLock(transaction: unknown): Promise<boolean>;
    setEnabled(input: SetReferralFeatureAvailabilityInput): Promise<ReferralFeatureAvailability>;
}

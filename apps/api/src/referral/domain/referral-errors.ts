export const REFERRAL_PUBLIC_ERROR_CODES = [
    'FEATURE_DISABLED',
    'REFERRAL_CODE_UNAVAILABLE',
    'REFERRAL_SELF_NOT_ALLOWED',
    'REFERRAL_SERVICE_UNAVAILABLE',
] as const;

export type ReferralPublicErrorCode = (typeof REFERRAL_PUBLIC_ERROR_CODES)[number];

export type ReferralErrorCode =
    | ReferralPublicErrorCode
    | 'REFERRAL_ALREADY_ATTACHED'
    | 'REFERRAL_CURSOR_INVALID'
    | 'REFERRAL_DELIVERY_CONFLICT'
    | 'REFERRAL_INVALID_AMOUNT'
    | 'REFERRAL_PROMO_CODE_COLLISION_EXHAUSTED';

export class ReferralError extends Error {
    readonly code: ReferralErrorCode;

    constructor(code: ReferralErrorCode, message: string) {
        super(message);
        this.name = 'ReferralError';
        this.code = code;
    }
}

export function referralCodeUnavailable(): ReferralError {
    return new ReferralError('REFERRAL_CODE_UNAVAILABLE', 'Referral code is unavailable');
}

export function referralFeatureDisabled(): ReferralError {
    return new ReferralError('FEATURE_DISABLED', 'Referral program is disabled');
}

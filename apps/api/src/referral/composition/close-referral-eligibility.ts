import type {
    CloseReferralEligibilityInput,
    CloseReferralEligibilityResult,
} from '../application/ports/referral.repository';

export const CLOSE_REFERRAL_ELIGIBILITY = Symbol('CLOSE_REFERRAL_ELIGIBILITY');

export interface CloseReferralEligibility {
    execute(input: CloseReferralEligibilityInput): Promise<CloseReferralEligibilityResult>;
}

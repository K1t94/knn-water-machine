import { Inject, Injectable } from '@nestjs/common';

import { REFERRAL_REPOSITORY } from './ports/referral.repository';

import type { CloseReferralEligibility } from '../composition/close-referral-eligibility';
import type {
    CloseReferralEligibilityInput,
    CloseReferralEligibilityResult,
    ReferralRelationshipRepository,
} from './ports/referral.repository';

@Injectable()
export class ReferralEligibilityService implements CloseReferralEligibility {
    constructor(
        @Inject(REFERRAL_REPOSITORY)
        private readonly repository: ReferralRelationshipRepository,
    ) {}

    execute(input: CloseReferralEligibilityInput): Promise<CloseReferralEligibilityResult> {
        return this.repository.closeEligibility(input);
    }
}

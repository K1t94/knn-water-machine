import { Inject, Injectable } from '@nestjs/common';

import { REFERRAL_FEATURE_STATE_REPOSITORY } from './ports/referral-feature-state.repository';

import type {
    ReferralFeatureAvailability,
    ReferralFeatureStateRepository,
    SetReferralFeatureAvailabilityInput,
} from './ports/referral-feature-state.repository';

@Injectable()
export class ReferralFeatureStateService {
    constructor(
        @Inject(REFERRAL_FEATURE_STATE_REPOSITORY)
        private readonly repository: ReferralFeatureStateRepository,
    ) {}

    readAvailability(): Promise<ReferralFeatureAvailability> {
        return this.repository.readAvailability();
    }

    isEnabledWithSharedLock(transaction: unknown): Promise<boolean> {
        return this.repository.isEnabledWithSharedLock(transaction);
    }

    setEnabled(input: SetReferralFeatureAvailabilityInput): Promise<ReferralFeatureAvailability> {
        return this.repository.setEnabled(input);
    }
}

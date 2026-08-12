import { Inject, Injectable } from '@nestjs/common';

import { loadEnv } from '../../config/env';
import { referralFeatureDisabled } from '../domain/referral-errors';
import { parseReferralMillilitres } from '../domain/referral-types';

import { REFERRAL_REPOSITORY, type ReferralQueryRepository } from './ports/referral.repository';
import { ReferralFeatureStateService } from './referral-feature-state.service';

import type { ReferralCursor } from '../domain/referral-types';

@Injectable()
export class ReferralQueryService {
    constructor(
        @Inject(REFERRAL_REPOSITORY)
        private readonly repository: ReferralQueryRepository,
        @Inject(ReferralFeatureStateService)
        private readonly featureState: ReferralFeatureStateService,
    ) {}

    async getMyReferral(userId: string) {
        await this.requireEnabled();
        const summary = await this.repository.getMyReferral(userId);
        return {
            ...summary,
            currentInviterRewardMl: parseReferralMillilitres(loadEnv().REFERRAL_INVITER_BONUS_ML),
        };
    }

    async getInvitations(userId: string, limit: number, cursor: ReferralCursor | null) {
        await this.requireEnabled();
        return this.repository.getInvitations(userId, limit, cursor);
    }

    private async requireEnabled(): Promise<void> {
        if (!(await this.featureState.readAvailability()).enabled) throw referralFeatureDisabled();
    }
}

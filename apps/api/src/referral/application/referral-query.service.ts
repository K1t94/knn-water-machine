import { Inject, Injectable } from '@nestjs/common';

import { loadEnv } from '../../config/env';
import { parseReferralMillilitres } from '../domain/referral-types';

import { REFERRAL_REPOSITORY, type ReferralQueryRepository } from './ports/referral.repository';

import type { ReferralCursor } from '../domain/referral-types';

@Injectable()
export class ReferralQueryService {
    constructor(
        @Inject(REFERRAL_REPOSITORY)
        private readonly repository: ReferralQueryRepository,
    ) {}

    async getMyReferral(userId: string) {
        const summary = await this.repository.getMyReferral(userId);
        return {
            ...summary,
            currentInviterRewardMl: parseReferralMillilitres(loadEnv().REFERRAL_INVITER_BONUS_ML),
        };
    }

    getInvitations(userId: string, limit: number, cursor: ReferralCursor | null) {
        return this.repository.getInvitations(userId, limit, cursor);
    }
}

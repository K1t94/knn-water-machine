import { serializeReferralMillilitres } from '../domain/referral-types';

import type { MyReferralResponseDto, ReferralInvitationPageResponseDto } from './dto/referral-response.dto';
import type { ReferralInvitationPage, ReferralSummary } from '../application/ports/referral.repository';

type ReferralSummaryView = ReferralSummary & {
    readonly currentInviterRewardMl: bigint;
};

export function toMyReferralResponse(view: ReferralSummaryView): MyReferralResponseDto {
    return {
        promoCode: view.promoCode,
        referralLink: view.referralLink,
        currentInviterRewardMl: view.currentInviterRewardMl.toString(10),
        creditedInviterBonusMl: view.deliveredInviterBonusMl.toString(10),
        creditedInvitationCount: view.deliveredInvitationCount,
    };
}

export function toReferralInvitationPageResponse(page: ReferralInvitationPage): ReferralInvitationPageResponseDto {
    return {
        items: page.items.map((item) => ({
            id: item.publicId,
            inviteeLabel: item.inviteeLabel,
            appliedAt: item.appliedAt.toISOString(),
            status: item.status,
            creditedAmountMl: serializeReferralMillilitres(item.creditedAmountMl),
        })),
        nextCursor: page.nextCursor,
        hasMore: page.nextCursor !== null,
    };
}

import { serializeReferralMillilitres } from '../domain/referral-types';

import type {
    ApplyReferralCodeResponseDto,
    MyReferralResponseDto,
    ReferralInvitationPageResponseDto,
} from './dto/referral-response.dto';
import type { ReferralInvitationPage, ReferralSummary } from '../application/ports/referral.repository';
import type { ApplyReferralCodeView } from '../application/referral-application.service';

type ReferralSummaryView = ReferralSummary & {
    readonly currentInviterRewardMl: bigint;
};

export function toApplyReferralCodeResponse(view: ApplyReferralCodeView): ApplyReferralCodeResponseDto {
    return {
        status: view.status,
        promoCode: view.promoCode,
        appliedAt: view.appliedAt.toISOString(),
    };
}

export function toMyReferralResponse(view: ReferralSummaryView): MyReferralResponseDto {
    return {
        promoCode: view.promoCode,
        referralLink: view.referralLink,
        eligibility: view.applicationStatus,
        attachedPromoCode: view.attachedPromoCode,
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

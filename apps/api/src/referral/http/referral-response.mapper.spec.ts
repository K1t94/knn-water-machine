import { describe, expect, it } from 'vitest';

import { canonicalizePromoCode } from '../domain/promo-code';
import { parseReferralMillilitres } from '../domain/referral-types';

import {
    toApplyReferralCodeResponse,
    toMyReferralResponse,
    toReferralInvitationPageResponse,
} from './referral-response.mapper';

describe('referral response mapper', () => {
    it('serializes application and summary values without internal fields', () => {
        const appliedAt = new Date('2026-08-10T10:00:00.000Z');

        expect(
            toApplyReferralCodeResponse({
                status: 'ATTACHED',
                promoCode: canonicalizePromoCode('3A7K9MN2QTVW'),
                appliedAt,
            }),
        ).toEqual({ status: 'ATTACHED', promoCode: '3A7K9MN2QTVW', appliedAt: appliedAt.toISOString() });
        expect(
            toMyReferralResponse({
                promoCode: canonicalizePromoCode('4A7K9MN2QTVW'),
                referralLink: 'kaynann://register?promo=4A7K9MN2QTVW',
                applicationStatus: 'OPEN',
                attachedPromoCode: null,
                currentInviterRewardMl: 5_000n,
                deliveredInvitationCount: 2,
                deliveredInviterBonusMl: 10_000n,
            }),
        ).toEqual({
            promoCode: '4A7K9MN2QTVW',
            referralLink: 'kaynann://register?promo=4A7K9MN2QTVW',
            eligibility: 'OPEN',
            attachedPromoCode: null,
            currentInviterRewardMl: '5000',
            creditedInviterBonusMl: '10000',
            creditedInvitationCount: 2,
        });
    });

    it('serializes invitation pages and derives hasMore only from the opaque cursor', () => {
        const appliedAt = new Date('2026-08-09T10:00:00.000Z');
        const response = toReferralInvitationPageResponse({
            items: [
                {
                    sequence: 99n,
                    publicId: '00000000-0000-4000-8000-000000000099',
                    inviteeLabel: '**42',
                    appliedAt,
                    creditedAmountMl: parseReferralMillilitres(5_000n),
                    status: 'CREDITED',
                },
            ],
            nextCursor: 'opaque-cursor' as never,
        });

        expect(response).toEqual({
            items: [
                {
                    id: '00000000-0000-4000-8000-000000000099',
                    inviteeLabel: '**42',
                    appliedAt: appliedAt.toISOString(),
                    status: 'CREDITED',
                    creditedAmountMl: '5000',
                },
            ],
            nextCursor: 'opaque-cursor',
            hasMore: true,
        });
        expect(JSON.stringify(response)).not.toMatch(/sequence|userId|entitlement|business|lease/i);
    });
});

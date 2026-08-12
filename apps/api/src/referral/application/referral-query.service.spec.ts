import { describe, expect, it, vi } from 'vitest';

import { REFERRAL_PROGRAM_FEATURE_KEY } from './ports/referral-feature-state.repository';
import { ReferralQueryService } from './referral-query.service';

import type { ReferralQueryRepository } from './ports/referral.repository';
import type { ReferralFeatureStateService } from './referral-feature-state.service';
import type { PromoCode, ReferralCursor, ReferralMillilitres } from '../domain/referral-types';

vi.mock('../../config/env', () => ({
    loadEnv: () => ({ REFERRAL_INVITER_BONUS_ML: 5_000n }),
}));

const enabledAvailability = {
    key: REFERRAL_PROGRAM_FEATURE_KEY,
    enabled: true,
    revision: 1n,
    updatedAt: new Date('2026-08-12T00:00:00.000Z'),
} as const;

describe('ReferralQueryService', () => {
    it('returns only inviter credit totals from the owner-scoped summary projection', async () => {
        const repository = createRepository();
        vi.mocked(repository.getMyReferral).mockResolvedValue({
            promoCode: '23456789ABCD' as PromoCode,
            referralLink: 'kaynann://register?promo=23456789ABCD',
            deliveredInvitationCount: 3,
            deliveredInviterBonusMl: 15_000n,
        });
        const featureState = createFeatureState();
        const service = new ReferralQueryService(repository, featureState);

        const result = await service.getMyReferral('owner-a');

        expect(result).toEqual({
            promoCode: '23456789ABCD',
            referralLink: 'kaynann://register?promo=23456789ABCD',
            currentInviterRewardMl: 5_000n,
            deliveredInvitationCount: 3,
            deliveredInviterBonusMl: 15_000n,
        });
        expect(result).not.toHaveProperty('eligibility');
        expect(result).not.toHaveProperty('applicationChannel');
        expect(repository.getMyReferral).toHaveBeenCalledWith('owner-a');
    });

    it('enforces authoritative availability before either owner query', async () => {
        const repository = createRepository();
        const featureState = createFeatureState(false);
        const service = new ReferralQueryService(repository, featureState);

        await expect(service.getMyReferral('owner-a')).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
        await expect(service.getInvitations('owner-a', 100, null)).rejects.toMatchObject({
            code: 'FEATURE_DISABLED',
        });
        expect(repository.getMyReferral).not.toHaveBeenCalled();
        expect(repository.getInvitations).not.toHaveBeenCalled();
    });

    it('preserves privacy-safe labels and traverses 250 stable owner rows without duplication', async () => {
        const repository = createRepository();
        const rows = Array.from({ length: 250 }, (_, index) => ({
            sequence: BigInt(250 - index),
            publicId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
            inviteeLabel: `**${String(index % 100).padStart(2, '0')}`,
            appliedAt: new Date(`2026-08-${String((index % 10) + 1).padStart(2, '0')}T10:00:00.000Z`),
            creditedAmountMl: 5_000n as ReferralMillilitres,
            status: 'CREDITED' as const,
        }));
        vi.mocked(repository.getInvitations).mockImplementation(async (userId, limit, cursor) => {
            expect(userId).toBe('owner-a');
            const offset = cursor === null ? 0 : Number(String(cursor).slice('cursor-'.length));
            const items = rows.slice(offset, offset + limit);
            const nextOffset = offset + items.length;
            return {
                items,
                nextCursor: nextOffset < rows.length ? (`cursor-${nextOffset}` as ReferralCursor) : null,
            };
        });
        const service = new ReferralQueryService(repository, createFeatureState());
        const visited = [];
        let cursor: ReferralCursor | null = null;

        do {
            const page = await service.getInvitations('owner-a', 100, cursor);
            visited.push(...page.items);
            cursor = page.nextCursor;
        } while (cursor !== null);

        expect(visited).toHaveLength(250);
        expect(new Set(visited.map(({ publicId }) => publicId))).toHaveLength(250);
        expect(visited.map(({ sequence }) => sequence)).toEqual(
            [...visited.map(({ sequence }) => sequence)].sort((left, right) => (left > right ? -1 : 1)),
        );
        expect(visited.every(({ inviteeLabel }) => /^\*\*\d{2}$/.test(inviteeLabel))).toBe(true);
        expect(repository.getInvitations).toHaveBeenCalledTimes(3);
    });

    it('never substitutes one owner when delegating paginated history', async () => {
        const repository = createRepository();
        vi.mocked(repository.getInvitations).mockResolvedValue({ items: [], nextCursor: null });
        const service = new ReferralQueryService(repository, createFeatureState());
        const cursor = 'opaque-owner-b-cursor' as ReferralCursor;

        await service.getInvitations('owner-b', 20, cursor);

        expect(repository.getInvitations).toHaveBeenCalledWith('owner-b', 20, cursor);
    });
});

function createRepository(): ReferralQueryRepository {
    return {
        getMyReferral: vi.fn(),
        getInvitations: vi.fn(),
    };
}

function createFeatureState(enabled = true): ReferralFeatureStateService {
    return {
        readAvailability: vi.fn().mockResolvedValue({ ...enabledAvailability, enabled }),
    } as unknown as ReferralFeatureStateService;
}

import { describe, expect, it, vi } from 'vitest';

import { ReferralEligibilityService } from './referral-eligibility.service';

import type { PurchaseBusinessEventKey } from '../domain/referral-types';

describe('ReferralEligibilityService', () => {
    it('delegates eligibility close to the repository boundary', async () => {
        const repository = {
            validatePromoCode: vi.fn(),
            applyCode: vi.fn(),
            createWelcomeEntitlement: vi.fn(),
            closeEligibility: vi.fn().mockResolvedValue({
                status: 'CLOSED',
                closedAt: new Date('2026-08-06T12:00:00.000Z'),
            }),
        };
        const service = new ReferralEligibilityService(repository);
        const input = {
            userId: '1d67f6a8-39a5-4702-aef3-ad9cfb550be3',
            purchaseBusinessEventKey: 'purchase:1' as PurchaseBusinessEventKey,
            succeededAt: new Date('2026-08-06T12:00:00.000Z'),
        };

        await expect(service.execute(input)).resolves.toEqual({
            status: 'CLOSED',
            closedAt: input.succeededAt,
        });
        expect(repository.closeEligibility).toHaveBeenCalledWith(input);
    });
});

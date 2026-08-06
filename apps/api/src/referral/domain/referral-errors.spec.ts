import { describe, expect, it } from 'vitest';

import { ReferralError, referralCodeUnavailable } from './referral-errors';

describe('referral errors', () => {
    it('exposes stable codes without infrastructure details', () => {
        const error = new ReferralError('REFERRAL_ALREADY_ATTACHED', 'A referral code is already attached');

        expect(error).toMatchObject({
            name: 'ReferralError',
            code: 'REFERRAL_ALREADY_ATTACHED',
            message: 'A referral code is already attached',
        });
        expect(JSON.stringify(error)).not.toMatch(/prisma|database|constraint/i);
    });

    it('uses one safe error for invalid and unavailable codes', () => {
        expect(referralCodeUnavailable()).toMatchObject({
            code: 'REFERRAL_CODE_UNAVAILABLE',
            message: 'Referral code is unavailable',
        });
    });
});

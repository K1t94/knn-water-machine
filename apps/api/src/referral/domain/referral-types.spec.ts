import { describe, expect, it } from 'vitest';

import { MAX_REFERRAL_MILLILITRES, parseReferralMillilitres, serializeReferralMillilitres } from './referral-types';

describe('referral millilitres', () => {
    it.each([1n, 5_000n, 10_000n, MAX_REFERRAL_MILLILITRES])('accepts exact positive bigint %s', (value) => {
        expect(parseReferralMillilitres(value)).toBe(value);
        expect(serializeReferralMillilitres(parseReferralMillilitres(value))).toBe(value.toString(10));
    });

    it.each([0n, -1n, MAX_REFERRAL_MILLILITRES + 1n, 1, 1.5, '10000', Number.MAX_SAFE_INTEGER])(
        'rejects non-exact referral amount %s',
        (value) => {
            let thrown: unknown;
            try {
                parseReferralMillilitres(value);
            } catch (error) {
                thrown = error;
            }

            expect(thrown).toMatchObject({ code: 'REFERRAL_INVALID_AMOUNT' });
        },
    );
});

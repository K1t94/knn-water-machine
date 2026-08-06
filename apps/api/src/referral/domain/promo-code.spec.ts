import { describe, expect, it, vi } from 'vitest';

import { PROMO_CODE_ALPHABET, canonicalizePromoCode, generatePromoCode, generateUniquePromoCode } from './promo-code';
import { referralCodeUnavailable } from './referral-errors';

describe('promo codes', () => {
    it('trims and uppercases a valid code', () => {
        expect(canonicalizePromoCode(' 23456789abcd ')).toBe('23456789ABCD');
    });

    it.each(['', '23456789ABC', '23456789ABCDE', '23456789ABCI', '23456789ABCО', 'x'.repeat(65)])(
        'rejects invalid input %j with the safe unavailable error',
        (value) => {
            expect(() => canonicalizePromoCode(value)).toThrowError(referralCodeUnavailable());
        },
    );

    it('uses the exact unambiguous alphabet', () => {
        expect(PROMO_CODE_ALPHABET).toBe('23456789ABCDEFGHJKMNPQRSTVWXYZ');
    });

    it('rejects random bytes outside the unbiased range', () => {
        const randomBytes = vi
            .fn<(size: number) => Uint8Array>()
            .mockReturnValueOnce(Uint8Array.from([240, 255, 0, 1, 2, 3, 4, 5]))
            .mockReturnValueOnce(Uint8Array.from([6, 7, 8, 9, 10, 11]));

        expect(generatePromoCode(randomBytes)).toBe('23456789ABCD');
        expect(randomBytes).toHaveBeenCalledTimes(2);
    });

    it('stops after eight database collision responses', async () => {
        const claim = vi.fn<(code: string) => Promise<boolean>>().mockResolvedValue(false);
        const randomBytes = vi
            .fn<(size: number) => Uint8Array>()
            .mockReturnValue(Uint8Array.from({ length: 12 }, () => 0));

        await expect(generateUniquePromoCode(claim, randomBytes)).rejects.toMatchObject({
            code: 'REFERRAL_PROMO_CODE_COLLISION_EXHAUSTED',
        });
        expect(claim).toHaveBeenCalledTimes(8);
    });
});

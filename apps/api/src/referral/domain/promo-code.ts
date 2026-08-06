import { randomBytes as nodeRandomBytes } from 'node:crypto';

import { ReferralError, referralCodeUnavailable } from './referral-errors';

import type { PromoCode } from './referral-types';

export const PROMO_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const PROMO_CODE_LENGTH = 12;
export const PROMO_CODE_MAX_RAW_LENGTH = 64;
export const PROMO_CODE_COLLISION_ATTEMPTS = 8;

const promoCodePattern = new RegExp(`^[${PROMO_CODE_ALPHABET}]{${PROMO_CODE_LENGTH}}$`);
const unbiasedByteLimit = Math.floor(256 / PROMO_CODE_ALPHABET.length) * PROMO_CODE_ALPHABET.length;

export type RandomBytesSource = (size: number) => Uint8Array;

export function canonicalizePromoCode(value: unknown): PromoCode {
    if (typeof value !== 'string' || value.length > PROMO_CODE_MAX_RAW_LENGTH) {
        throw referralCodeUnavailable();
    }

    const canonical = value.trim().toUpperCase();
    if (!promoCodePattern.test(canonical)) {
        throw referralCodeUnavailable();
    }

    return canonical as PromoCode;
}

export function generatePromoCode(randomBytes: RandomBytesSource = nodeRandomBytes): PromoCode {
    let code = '';

    while (code.length < PROMO_CODE_LENGTH) {
        const remaining = PROMO_CODE_LENGTH - code.length;
        const bytes = randomBytes(Math.max(remaining, 8));
        if (bytes.length === 0) {
            throw new ReferralError('REFERRAL_PROMO_CODE_COLLISION_EXHAUSTED', 'Unable to generate referral code');
        }

        for (const byte of bytes) {
            if (byte >= unbiasedByteLimit) continue;

            code += PROMO_CODE_ALPHABET[byte % PROMO_CODE_ALPHABET.length];
            if (code.length === PROMO_CODE_LENGTH) break;
        }
    }

    return code as PromoCode;
}

export async function generateUniquePromoCode(
    claim: (candidate: PromoCode) => Promise<boolean>,
    randomBytes: RandomBytesSource = nodeRandomBytes,
): Promise<PromoCode> {
    for (let attempt = 0; attempt < PROMO_CODE_COLLISION_ATTEMPTS; attempt += 1) {
        const candidate = generatePromoCode(randomBytes);
        if (await claim(candidate)) return candidate;
    }

    throw new ReferralError('REFERRAL_PROMO_CODE_COLLISION_EXHAUSTED', 'Unable to allocate a unique referral code');
}

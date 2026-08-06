import { describe, expect, it } from 'vitest';

import { ReferralError } from '../../domain/referral-errors';

import {
    DEFAULT_REFERRAL_HISTORY_LIMIT,
    MAX_REFERRAL_HISTORY_LIMIT,
    decodeReferralCursor,
    encodeReferralCursor,
    normalizeReferralPageLimit,
} from './referral-cursor';

import type { ReferralCursor } from '../../domain/referral-types';

describe('referral cursor', () => {
    it('round-trips a positive sequence through an opaque cursor', () => {
        const cursor = encodeReferralCursor(250n);

        expect(cursor).not.toContain('250');
        expect(decodeReferralCursor(cursor)).toBe(250n);
    });

    it('rejects malformed cursors', () => {
        expect(() => decodeReferralCursor('not-a-cursor' as ReferralCursor)).toThrow(ReferralError);
        expect(() => decodeReferralCursor(encodeReferralCursor(1n).slice(1) as ReferralCursor)).toThrow(ReferralError);
    });

    it('normalizes page limits with default and maximum bounds', () => {
        expect(normalizeReferralPageLimit(undefined)).toBe(DEFAULT_REFERRAL_HISTORY_LIMIT);
        expect(normalizeReferralPageLimit('5')).toBe(5);
        expect(normalizeReferralPageLimit(500)).toBe(MAX_REFERRAL_HISTORY_LIMIT);
        expect(() => normalizeReferralPageLimit(0)).toThrow(ReferralError);
        expect(() => normalizeReferralPageLimit('1.5')).toThrow(ReferralError);
    });
});

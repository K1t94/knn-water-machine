import { ReferralError } from '../../domain/referral-errors';

import type { ReferralCursor } from '../../domain/referral-types';

const CURSOR_VERSION = 1;
const DECIMAL_BIGINT = /^(?:[1-9]\d*)$/;

export const DEFAULT_REFERRAL_HISTORY_LIMIT = 20;
export const MAX_REFERRAL_HISTORY_LIMIT = 100;

interface ReferralCursorPayload {
    readonly v: typeof CURSOR_VERSION;
    readonly beforeSequence: string;
}

export function encodeReferralCursor(beforeSequence: bigint): ReferralCursor {
    if (beforeSequence < 1n) {
        throw new ReferralError('REFERRAL_CURSOR_INVALID', 'Referral cursor sequence must be positive');
    }

    const payload: ReferralCursorPayload = {
        v: CURSOR_VERSION,
        beforeSequence: beforeSequence.toString(10),
    };

    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url') as ReferralCursor;
}

export function decodeReferralCursor(cursor: ReferralCursor | null): bigint | null {
    if (cursor === null) return null;

    try {
        const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<ReferralCursorPayload>;
        if (parsed.v !== CURSOR_VERSION || typeof parsed.beforeSequence !== 'string') {
            throw new Error('Unsupported cursor payload');
        }
        if (!DECIMAL_BIGINT.test(parsed.beforeSequence)) {
            throw new Error('Invalid cursor sequence');
        }
        return BigInt(parsed.beforeSequence);
    } catch {
        throw new ReferralError('REFERRAL_CURSOR_INVALID', 'Referral history cursor is invalid');
    }
}

export function normalizeReferralPageLimit(value: unknown): number {
    if (value === undefined || value === null) return DEFAULT_REFERRAL_HISTORY_LIMIT;

    const limit = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(limit) || limit < 1) {
        throw new ReferralError('REFERRAL_CURSOR_INVALID', 'Referral history limit must be a positive integer');
    }

    return Math.min(limit, MAX_REFERRAL_HISTORY_LIMIT);
}

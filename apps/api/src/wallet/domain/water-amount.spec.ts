import { describe, expect, it } from 'vitest';

import {
    MAX_WATER_MILLILITRES,
    applyWalletDelta,
    parseWalletBalance,
    parseWaterAmount,
    serializeMillilitres,
} from './water-amount';

function expectWalletError(operation: () => unknown, code: string): void {
    try {
        operation();
    } catch (error: unknown) {
        expect(error).toMatchObject({ code });
        return;
    }

    throw new Error(`Expected wallet error ${code}`);
}

describe('water amount', () => {
    it.each([1n, 1_000n, MAX_WATER_MILLILITRES])('accepts positive bigint amount %s', (value) => {
        expect(parseWaterAmount(value)).toBe(value);
    });

    it('represents a zero wallet balance exactly', () => {
        expect(parseWalletBalance(0n)).toBe(0n);
    });

    it.each([0n, -1n, 1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1, null, { value: 1n }, MAX_WATER_MILLILITRES + 1n])(
        'rejects an unsafe amount input',
        (value) => {
            expectWalletError(() => parseWaterAmount(value), 'WALLET_INVALID_AMOUNT');
        },
    );

    it('applies signed deltas at both bigint boundaries', () => {
        expect(applyWalletDelta(0n, MAX_WATER_MILLILITRES)).toBe(MAX_WATER_MILLILITRES);
        expect(applyWalletDelta(MAX_WATER_MILLILITRES, -MAX_WATER_MILLILITRES)).toBe(0n);
    });

    it.each([
        [MAX_WATER_MILLILITRES, 1n, 'WALLET_BALANCE_LIMIT_EXCEEDED'],
        [0n, -1n, 'WALLET_INSUFFICIENT_BALANCE'],
    ])('rejects a delta outside the wallet range', (balance, delta, code) => {
        expectWalletError(() => applyWalletDelta(balance, delta), code);
    });

    it('serializes exact values without converting through number', () => {
        expect(serializeMillilitres(9_007_199_254_740_993n)).toBe('9007199254740993');
        expect(serializeMillilitres(MAX_WATER_MILLILITRES)).toBe('9223372036854775807');
    });
});

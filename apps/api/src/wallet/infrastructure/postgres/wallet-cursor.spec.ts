import { describe, expect, it } from 'vitest';

import {
    parseBusinessEventKey,
    parseWalletOperationKind,
    parseWalletOperationSource,
} from '../../domain/wallet-operation';
import { parseWalletBalance, parseWaterAmount } from '../../domain/water-amount';

import {
    decodeWalletHistoryCursor,
    encodeWalletHistoryCursor,
    paginateWalletOperations,
    parseWalletHistoryLimit,
} from './wallet-cursor';

import type { WalletOperationFacts } from '../../domain/wallet-operation';

function operation(sequence: bigint): WalletOperationFacts {
    return {
        id: `entry-${sequence}`,
        sequence,
        userId: 'user-1',
        businessEventKey: parseBusinessEventKey(`test:event-${sequence}`),
        direction: 'CREDIT',
        amountMl: parseWaterAmount(1n),
        operationKind: parseWalletOperationKind('TEST_OPERATION'),
        source: parseWalletOperationSource('TEST_SUITE'),
        balanceAfterMl: parseWalletBalance(sequence),
        occurredAt: new Date('2026-08-04T10:00:00.000Z'),
        recordedAt: new Date('2026-08-04T10:00:00.000Z'),
        compensatesEntryId: null,
    };
}

describe('wallet history cursor', () => {
    it('round-trips only the versioned exclusive sequence boundary', () => {
        const encoded = encodeWalletHistoryCursor({ beforeSequence: 12345n });

        expect(encoded).not.toContain('12345');
        expect(decodeWalletHistoryCursor(encoded)).toEqual({ beforeSequence: 12345n });
    });

    it.each([
        '',
        'not-base64url!',
        Buffer.from('{}').toString('base64url'),
        Buffer.from('{"v":2,"beforeSequence":"1"}').toString('base64url'),
        Buffer.from('{"v":1,"beforeSequence":"0"}').toString('base64url'),
        Buffer.from('{"v":1,"beforeSequence":"01"}').toString('base64url'),
        Buffer.from('{"v":1,"beforeSequence":"1","order":"asc"}').toString('base64url'),
    ])('rejects malformed cursor %s', (value) => {
        expectInvalidCursor(() => decodeWalletHistoryCursor(value));
    });

    it('uses default 20 and accepts limits through 100', () => {
        expect(parseWalletHistoryLimit(undefined)).toBe(20);
        expect(parseWalletHistoryLimit(1)).toBe(1);
        expect(parseWalletHistoryLimit(100)).toBe(100);
        expectInvalidCursor(() => parseWalletHistoryLimit(101));
    });

    it('slices limit plus one results and derives the next exclusive cursor', () => {
        const page = paginateWalletOperations([operation(5n), operation(4n), operation(3n)], 2);

        expect(page.operations.map(({ sequence }) => sequence)).toEqual([5n, 4n]);
        expect(page.nextCursor).toEqual({ beforeSequence: 4n });
        expect(paginateWalletOperations([operation(3n), operation(2n)], 2).nextCursor).toBeNull();
    });

    it('rejects rows that are not in strict sequence-descending order', () => {
        expectInvalidCursor(() => paginateWalletOperations([operation(4n), operation(5n)], 2));
    });
});

function expectInvalidCursor(action: () => unknown): void {
    try {
        action();
    } catch (error: unknown) {
        expect(error).toMatchObject({ code: 'WALLET_CURSOR_INVALID' });
        return;
    }
    throw new Error('Expected wallet cursor validation to fail.');
}

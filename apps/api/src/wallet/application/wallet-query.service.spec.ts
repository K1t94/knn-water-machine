import { describe, expect, it, vi } from 'vitest';

import { WalletError } from '../domain/wallet-errors';
import {
    parseBusinessEventKey,
    parseWalletOperationKind,
    parseWalletOperationSource,
} from '../domain/wallet-operation';
import { parseWalletBalance, parseWaterAmount } from '../domain/water-amount';

import { WalletQueryService } from './wallet-query.service';

import type { WalletOperationFacts } from '../domain/wallet-operation';
import type { WalletQueryRepository } from './ports/wallet.repository';

describe('WalletQueryService', () => {
    const userId = '00000000-0000-4000-8000-000000000001';

    function setup(balance = 0n) {
        const repository = {
            getBalance: vi.fn().mockResolvedValue(parseWalletBalance(balance)),
            getHistory: vi.fn().mockResolvedValue({ operations: [], nextCursor: null }),
        } satisfies WalletQueryRepository;

        return { repository, service: new WalletQueryService(repository) };
    }

    it('returns exact zero for an owner without a persisted wallet', async () => {
        const { service } = setup();

        await expect(service.getBalance(userId)).resolves.toBe(0n);
    });

    it('returns an exact projected balance without number conversion', async () => {
        const exact = 9_007_199_254_740_993n;
        const { service } = setup(exact);

        await expect(service.getBalance(userId)).resolves.toBe(exact);
    });

    it('scopes the repository lookup to the supplied authenticated owner', async () => {
        const { repository, service } = setup();

        await service.getBalance(userId);

        expect(repository.getBalance).toHaveBeenCalledExactlyOnceWith(userId);
    });

    it('preserves the stable infrastructure error', async () => {
        const unavailable = new WalletError(
            'WALLET_TEMPORARILY_UNAVAILABLE',
            'The wallet operation is temporarily unavailable.',
        );
        const repository = {
            getBalance: vi.fn().mockRejectedValue(unavailable),
            getHistory: vi.fn().mockResolvedValue({ operations: [], nextCursor: null }),
        } satisfies WalletQueryRepository;
        const service = new WalletQueryService(repository);

        await expect(service.getBalance(userId)).rejects.toBe(unavailable);
    });

    it('validates pagination, scopes history to the owner, and maps only public facts', async () => {
        const { repository, service } = setup();
        repository.getHistory.mockResolvedValueOnce({
            operations: [operation(9n)],
            nextCursor: { beforeSequence: 9n },
        });

        const result = await service.getHistory(userId, { limit: 1 });
        expect(typeof result.nextCursor).toBe('string');
        expect({ ...result, nextCursor: '<opaque>' }).toEqual({
            items: [
                {
                    id: 'entry-9',
                    direction: 'CREDIT',
                    amountMl: '1250',
                    operationKind: 'TEST_OPERATION',
                    source: 'TEST_SUITE',
                    occurredAt: '2026-08-04T10:00:00.000Z',
                    recordedAt: '2026-08-04T10:00:01.000Z',
                },
            ],
            nextCursor: '<opaque>',
            hasMore: true,
        });
        expect(repository.getHistory).toHaveBeenCalledWith({ userId, limit: 1, cursor: null });
    });

    it('uses default pagination and rejects malformed cursors before repository access', async () => {
        const { repository, service } = setup();

        await service.getHistory(userId, {});
        expect(repository.getHistory).toHaveBeenCalledWith({ userId, limit: 20, cursor: null });

        repository.getHistory.mockClear();
        await expect(service.getHistory(userId, { cursor: 'invalid!' })).rejects.toMatchObject({
            code: 'WALLET_CURSOR_INVALID',
        });
        expect(repository.getHistory).not.toHaveBeenCalled();
    });
});

function operation(sequence: bigint): WalletOperationFacts {
    return {
        id: `entry-${sequence}`,
        sequence,
        userId: 'private-owner',
        businessEventKey: parseBusinessEventKey(`test:event-${sequence}`),
        direction: 'CREDIT',
        amountMl: parseWaterAmount(1_250n),
        operationKind: parseWalletOperationKind('TEST_OPERATION'),
        source: parseWalletOperationSource('TEST_SUITE'),
        balanceAfterMl: parseWalletBalance(1_250n),
        occurredAt: new Date('2026-08-04T10:00:00.000Z'),
        recordedAt: new Date('2026-08-04T10:00:01.000Z'),
        compensatesEntryId: null,
    };
}

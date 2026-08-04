import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createWalletPostgresFixture, walletPostgresEnabled } from './wallet-postgres.fixture';

import type { WalletPostgresFixture } from './wallet-postgres.fixture';
import type { WalletOperationFacts } from '../src/wallet/domain/wallet-operation';

describe.skipIf(!walletPostgresEnabled)('wallet history PostgreSQL integration', () => {
    let fixture: WalletPostgresFixture;
    let ownerId: string;
    let otherId: string;
    const occurredAt = new Date('2026-08-04T10:00:00.000Z');

    beforeAll(async () => {
        fixture = await createWalletPostgresFixture('history');
        ownerId = await fixture.createUser();
        otherId = await fixture.createUser();
        await seedHistory(fixture, ownerId, 250, true);
        await seedHistory(fixture, otherId, 25, false);
    }, 60_000);

    afterAll(async () => fixture.dispose(), 30_000);

    it('returns empty history for an owner without ledger entries', async () => {
        const emptyOwner = await fixture.createUser();
        await expect(fixture.repository.getHistory({ userId: emptyOwner, limit: 20, cursor: null })).resolves.toEqual({
            operations: [],
            nextCursor: null,
        });
    });

    it('traverses 250+ owner entries exactly once in stable sequence-desc order', async () => {
        const first = await traverse(ownerId, 37);
        const repeated = await traverse(ownerId, 37);

        expect(first.length).toBe(252);
        expect(new Set(first.map(({ id }) => id)).size).toBe(252);
        expect(first.map(({ id }) => id)).toEqual(repeated.map(({ id }) => id));
        expect(first.every((entry, index) => index === 0 || first[index - 1].sequence > entry.sequence)).toBe(true);
        expect(first.every(({ userId }) => userId === ownerId)).toBe(true);
        expect(first.every(({ occurredAt: value }) => value.getTime() === occurredAt.getTime())).toBe(true);
        expect(first.some(({ compensatesEntryId }) => compensatesEntryId !== null)).toBe(true);
    });

    async function traverse(userId: string, limit: number): Promise<WalletOperationFacts[]> {
        const result: WalletOperationFacts[] = [];
        let cursor = null;
        do {
            const page = await fixture.repository.getHistory({ userId, limit, cursor });
            result.push(...page.operations);
            cursor = page.nextCursor;
        } while (cursor);
        return result;
    }

    async function seedHistory(
        target: WalletPostgresFixture,
        userId: string,
        count: number,
        includeCompensation: boolean,
    ): Promise<void> {
        await target.prisma.waterWallet.create({ data: { userId, balanceMl: BigInt(count) } });
        await target.prisma.walletLedgerEntry.createMany({
            data: Array.from({ length: count }, (_, index) => ({
                walletUserId: userId,
                businessEventKey: `history:${userId}-${index}`,
                direction: 'CREDIT' as const,
                amountMl: 1n,
                operationKind: 'TEST_OPERATION',
                source: 'TEST_SUITE',
                balanceAfterMl: BigInt(index + 1),
                occurredAt,
            })),
        });
        if (!includeCompensation) return;

        const debitId = randomUUID();
        await target.prisma.walletLedgerEntry.create({
            data: {
                id: debitId,
                walletUserId: userId,
                businessEventKey: `history:${userId}-debit`,
                direction: 'DEBIT',
                amountMl: 1n,
                operationKind: 'TEST_OPERATION',
                source: 'TEST_SUITE',
                balanceAfterMl: BigInt(count - 1),
                occurredAt,
            },
        });
        await target.prisma.walletLedgerEntry.create({
            data: {
                walletUserId: userId,
                businessEventKey: `history:${userId}-compensation`,
                direction: 'CREDIT',
                amountMl: 1n,
                operationKind: 'COMPENSATION',
                source: 'TEST_SUITE',
                balanceAfterMl: BigInt(count),
                occurredAt,
                compensatesEntryId: debitId,
            },
        });
    }
});

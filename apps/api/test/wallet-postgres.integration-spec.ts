import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAX_WATER_MILLILITRES } from '../src/wallet/domain/water-amount';

import {
    createWalletPostgresFixture,
    type WalletPostgresFixture,
    walletCommand,
    walletPostgresEnabled,
} from './wallet-postgres.fixture';

const describePostgres = walletPostgresEnabled ? describe : describe.skip;

describePostgres('Prisma wallet repository', () => {
    let fixture: WalletPostgresFixture;

    beforeAll(async () => {
        fixture = await createWalletPostgresFixture('mutations');
    }, 60_000);

    afterAll(async () => {
        await fixture.dispose();
    });

    it('reads a logical zero without creating a wallet or ledger entry', async () => {
        const userId = await fixture.createUser();

        await expect(fixture.repository.getBalance(userId)).resolves.toBe(0n);
        expect(await fixture.prisma.waterWallet.findUnique({ where: { userId } })).toBeNull();
        expect(await fixture.prisma.walletLedgerEntry.count({ where: { walletUserId: userId } })).toBe(0);
    });

    it('lazily creates a wallet and applies exact credit and debit entries', async () => {
        const userId = await fixture.createUser();
        expect(await fixture.prisma.waterWallet.findUnique({ where: { userId } })).toBeNull();

        const credited = await fixture.service.credit(walletCommand(userId, 'tests:exact-credit', 2_500n));
        const debited = await fixture.service.debit(walletCommand(userId, 'tests:exact-debit', 750n));

        expect(credited).toMatchObject({ balanceAfterMl: 2_500n, idempotentReplay: false });
        expect(debited).toMatchObject({ balanceAfterMl: 1_750n, idempotentReplay: false });
        await expect(fixture.repository.reconcile(userId)).resolves.toBe(1_750n);
        expect(await fixture.prisma.walletLedgerEntry.count({ where: { walletUserId: userId } })).toBe(2);
    });

    it('applies 100 sequential identical submissions exactly once', async () => {
        const userId = await fixture.createUser();
        const command = walletCommand(userId, 'tests:sequential-idempotency', 125n);
        const results = [];
        for (let attempt = 0; attempt < 100; attempt += 1) {
            results.push(await fixture.service.credit(command));
        }

        expect(results.filter((result) => !result.idempotentReplay)).toHaveLength(1);
        expect(new Set(results.map((result) => result.entryId)).size).toBe(1);
        expect(await fixture.repository.reconcile(userId)).toBe(125n);
        expect(await fixture.prisma.walletLedgerEntry.count({ where: { walletUserId: userId } })).toBe(1);
    });

    it('enforces one global key and rejects conflicting immutable facts', async () => {
        const firstUserId = await fixture.createUser();
        const secondUserId = await fixture.createUser();
        await fixture.service.credit(walletCommand(firstUserId, 'tests:global-key', 300n));

        await expect(
            fixture.service.credit(walletCommand(secondUserId, 'tests:global-key', 300n)),
        ).rejects.toMatchObject({ code: 'WALLET_EVENT_CONFLICT' });
        await expect(
            fixture.service.credit(walletCommand(firstUserId, 'tests:global-key', 301n)),
        ).rejects.toMatchObject({ code: 'WALLET_EVENT_CONFLICT' });
        expect(await fixture.prisma.waterWallet.findUnique({ where: { userId: secondUserId } })).toBeNull();
        expect(await fixture.repository.reconcile(firstUserId)).toBe(300n);
    });

    it.each([
        ['unknown', randomUUID()],
        ['suspended', null],
    ])('rejects an %s owner without retaining a zero projection', async (_label, suppliedId) => {
        const userId = suppliedId ?? (await fixture.createUser('SUSPENDED'));

        await expect(
            fixture.service.credit(walletCommand(userId, `tests:ineligible-${randomUUID()}`, 1n)),
        ).rejects.toMatchObject({ code: 'WALLET_USER_INELIGIBLE' });
        expect(await fixture.prisma.waterWallet.findUnique({ where: { userId } })).toBeNull();
    });

    it('rejects insufficient balance and rolls lazy creation back', async () => {
        const userId = await fixture.createUser();

        await expect(fixture.service.debit(walletCommand(userId, 'tests:insufficient', 1n))).rejects.toMatchObject({
            code: 'WALLET_INSUFFICIENT_BALANCE',
        });
        expect(await fixture.prisma.waterWallet.findUnique({ where: { userId } })).toBeNull();
        expect(await fixture.prisma.walletLedgerEntry.count({ where: { walletUserId: userId } })).toBe(0);
    });

    it('rejects upper-bound overflow without appending a second entry', async () => {
        const userId = await fixture.createUser();
        await fixture.service.credit(walletCommand(userId, 'tests:max-balance', MAX_WATER_MILLILITRES));

        await expect(fixture.service.credit(walletCommand(userId, 'tests:overflow', 1n))).rejects.toMatchObject({
            code: 'WALLET_BALANCE_LIMIT_EXCEEDED',
        });
        expect(await fixture.repository.reconcile(userId)).toBe(MAX_WATER_MILLILITRES);
        expect(await fixture.prisma.walletLedgerEntry.count({ where: { walletUserId: userId } })).toBe(1);
    });
});

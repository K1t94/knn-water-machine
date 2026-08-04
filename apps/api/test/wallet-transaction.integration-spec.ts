import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { WalletError } from '../src/wallet/domain/wallet-errors';
import { MAX_WATER_MILLILITRES } from '../src/wallet/domain/water-amount';

import {
    createWalletPostgresFixture,
    type WalletPostgresFixture,
    walletCommand,
    walletPostgresEnabled,
} from './wallet-postgres.fixture';

const describePostgres = walletPostgresEnabled ? describe : describe.skip;

function expectSynchronousWalletError(action: () => unknown, code: WalletError['code']): void {
    try {
        action();
        throw new Error('Expected a WalletError.');
    } catch (error: unknown) {
        expect(error).toBeInstanceOf(WalletError);
        if (error instanceof WalletError) {
            expect(error.code).toBe(code);
        }
    }
}

describePostgres('wallet transaction boundaries', () => {
    let fixture: WalletPostgresFixture;

    beforeAll(async () => {
        fixture = await createWalletPostgresFixture('transactions');
    }, 60_000);

    afterAll(async () => {
        await fixture.dispose();
    });

    it('rejects malformed input before opening a transaction', async () => {
        const userId = await fixture.createUser();

        expectSynchronousWalletError(
            () =>
                fixture.service.credit({
                    ...walletCommand(userId, 'tests:never-called', 1n),
                    amountMl: 1 as unknown as bigint,
                }),
            'WALLET_INVALID_AMOUNT',
        );
        expect(await fixture.prisma.waterWallet.findUnique({ where: { userId } })).toBeNull();
    });

    it('rolls the projection back when ledger insertion fails after an update', async () => {
        const userId = await fixture.createUser();
        await fixture.service.credit(walletCommand(userId, 'tests:rollback-seed', 1_000n));
        await fixture.prisma.$executeRaw(Prisma.sql`
            CREATE FUNCTION reject_wallet_test_entry()
            RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF NEW."businessEventKey" = 'tests:forced-ledger-failure' THEN
                    RAISE EXCEPTION 'forced_wallet_ledger_failure' USING ERRCODE = '55000';
                END IF;
                RETURN NEW;
            END;
            $$
        `);
        await fixture.prisma.$executeRaw(Prisma.sql`
            CREATE TRIGGER "WalletLedgerEntry_test_failure"
            BEFORE INSERT ON "WalletLedgerEntry"
            FOR EACH ROW EXECUTE FUNCTION reject_wallet_test_entry()
        `);

        await expect(
            fixture.service.debit(walletCommand(userId, 'tests:forced-ledger-failure', 250n)),
        ).rejects.toMatchObject({ code: 'WALLET_TEMPORARILY_UNAVAILABLE' });
        expect((await fixture.prisma.waterWallet.findUniqueOrThrow({ where: { userId } })).balanceMl).toBe(1_000n);
        expect(
            await fixture.prisma.walletLedgerEntry.count({
                where: { businessEventKey: 'tests:forced-ledger-failure' },
            }),
        ).toBe(0);
        await expect(fixture.repository.reconcile(userId)).resolves.toBe(1_000n);
    });

    it('rolls a losing cross-owner unique-key race back completely', async () => {
        const firstUserId = await fixture.createUser();
        const secondUserId = await fixture.createUser();
        const secondConnection = await fixture.createConnection();
        const key = 'tests:cross-owner-race';
        const outcomes = await Promise.allSettled([
            fixture.service.credit(walletCommand(firstUserId, key, 55n)),
            secondConnection.service.credit(walletCommand(secondUserId, key, 55n)),
        ]);

        expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
        expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
        const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
        expect(rejected?.status === 'rejected' ? (rejected.reason as { code?: string }).code : null).toBe(
            'WALLET_EVENT_CONFLICT',
        );
        expect(await fixture.prisma.walletLedgerEntry.count({ where: { businessEventKey: key } })).toBe(1);
        const wallets = await fixture.prisma.waterWallet.findMany({
            where: { userId: { in: [firstUserId, secondUserId] } },
        });
        expect(wallets).toHaveLength(1);
        expect(wallets[0]?.balanceMl).toBe(55n);
    });

    it('supports independently idempotent compensations of a same-user debit', async () => {
        const userId = await fixture.createUser();
        await fixture.service.credit(walletCommand(userId, 'tests:compensation-seed', 1_000n));
        const debit = await fixture.service.debit(walletCommand(userId, 'tests:compensation-origin', 400n));
        const firstCommand = {
            ...walletCommand(userId, 'tests:compensation-one', 100n),
            operationKind: 'COMPENSATION' as const,
            compensatesEntryId: debit.entryId,
        };
        const first = await fixture.service.compensate(firstCommand);
        const replay = await fixture.service.compensate(firstCommand);
        await fixture.service.compensate({
            ...firstCommand,
            businessEventKey: 'tests:compensation-two',
            amountMl: 150n,
        });

        expect(first.idempotentReplay).toBe(false);
        expect(replay).toMatchObject({
            entryId: first.entryId,
            balanceAfterMl: first.balanceAfterMl,
            idempotentReplay: true,
        });
        expect(await fixture.repository.reconcile(userId)).toBe(850n);
        expect(await fixture.prisma.walletLedgerEntry.count({ where: { compensatesEntryId: debit.entryId } })).toBe(2);
    });

    it('rejects missing, non-debit, and cross-user compensation origins without an append', async () => {
        const userId = await fixture.createUser();
        const otherUserId = await fixture.createUser();
        const credit = await fixture.service.credit(walletCommand(userId, 'tests:invalid-origin-credit', 500n));
        const otherCredit = await fixture.service.credit(walletCommand(otherUserId, 'tests:other-credit', 500n));
        const debit = await fixture.service.debit(walletCommand(otherUserId, 'tests:other-debit', 100n));
        const origins = [randomUUID(), credit.entryId, debit.entryId, otherCredit.entryId];

        for (const [index, compensatesEntryId] of origins.entries()) {
            await expect(
                fixture.service.compensate({
                    ...walletCommand(userId, `tests:invalid-compensation-${index}`, 10n),
                    operationKind: 'COMPENSATION',
                    compensatesEntryId,
                }),
            ).rejects.toMatchObject({ code: 'WALLET_INVALID_COMPENSATION_ORIGIN' });
        }
        expect(await fixture.repository.reconcile(userId)).toBe(500n);
        expect(await fixture.prisma.walletLedgerEntry.count({ where: { walletUserId: userId } })).toBe(1);
    });

    it('keeps ledger entries immutable and detects projection reconciliation mismatch', async () => {
        const userId = await fixture.createUser();
        const entry = await fixture.service.credit(walletCommand(userId, 'tests:immutable', 100n));

        await expect(
            fixture.prisma.walletLedgerEntry.update({ where: { id: entry.entryId }, data: { amountMl: 99n } }),
        ).rejects.toThrow();
        await expect(fixture.prisma.walletLedgerEntry.delete({ where: { id: entry.entryId } })).rejects.toThrow();
        await fixture.prisma.$executeRaw(Prisma.sql`
            UPDATE "WaterWallet" SET "balanceMl" = 101 WHERE "userId" = ${userId}::uuid
        `);
        await expect(fixture.repository.reconcile(userId)).rejects.toMatchObject({
            code: 'WALLET_RECONCILIATION_FAILED',
        });
    });

    it('preserves the last committed state after conditional insufficient and overflow failures', async () => {
        const debitUserId = await fixture.createUser();
        await fixture.service.credit(walletCommand(debitUserId, 'tests:conditional-debit-seed', 10n));
        await expect(
            fixture.service.debit(walletCommand(debitUserId, 'tests:conditional-debit-failure', 11n)),
        ).rejects.toMatchObject({ code: 'WALLET_INSUFFICIENT_BALANCE' });

        const creditUserId = await fixture.createUser();
        await fixture.service.credit(
            walletCommand(creditUserId, 'tests:conditional-credit-seed', MAX_WATER_MILLILITRES),
        );
        await expect(
            fixture.service.credit(walletCommand(creditUserId, 'tests:conditional-credit-failure', 1n)),
        ).rejects.toMatchObject({ code: 'WALLET_BALANCE_LIMIT_EXCEEDED' });

        await expect(fixture.repository.reconcile(debitUserId)).resolves.toBe(10n);
        await expect(fixture.repository.reconcile(creditUserId)).resolves.toBe(MAX_WATER_MILLILITRES);
    });
});

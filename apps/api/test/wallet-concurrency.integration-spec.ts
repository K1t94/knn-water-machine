import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
    createWalletPostgresFixture,
    type WalletPostgresFixture,
    walletCommand,
    walletPostgresEnabled,
} from './wallet-postgres.fixture';

import type { WalletCommandService } from '../src/wallet/application/wallet-command.service';

const describePostgres = walletPostgresEnabled ? describe : describe.skip;

async function startTogether<T>(actions: readonly (() => Promise<T>)[]): Promise<PromiseSettledResult<T>[]> {
    let release: (() => void) | undefined;
    const barrier = new Promise<void>((resolve) => {
        release = resolve;
    });
    const pending = actions.map(async (action) => {
        await barrier;
        return action();
    });
    release?.();
    return Promise.allSettled(pending);
}

describePostgres('wallet PostgreSQL concurrency', () => {
    let fixture: WalletPostgresFixture;
    let services: WalletCommandService[];

    beforeAll(async () => {
        fixture = await createWalletPostgresFixture('concurrency');
        const connections = await Promise.all(Array.from({ length: 16 }, () => fixture.createConnection()));
        services = connections.map((connection) => connection.service);
    }, 60_000);

    afterAll(async () => {
        await fixture.dispose();
    });

    it('prevents overspending across 100 concurrent debit attempts', async () => {
        const userId = await fixture.createUser();
        await fixture.service.credit(walletCommand(userId, 'tests:debit-race-seed', 1_000n));

        const outcomes = await startTogether(
            Array.from(
                { length: 100 },
                (_, index) => () =>
                    services[index % services.length].debit(
                        walletCommand(userId, `tests:concurrent-debit-${index}`, 20n),
                    ),
            ),
        );
        const successes = outcomes.filter((outcome) => outcome.status === 'fulfilled');
        const failures = outcomes.filter((outcome) => outcome.status === 'rejected');

        expect(successes).toHaveLength(50);
        expect(failures).toHaveLength(50);
        expect(
            failures.every((outcome) => (outcome.reason as { code?: string }).code === 'WALLET_INSUFFICIENT_BALANCE'),
        ).toBe(true);
        expect(await fixture.repository.reconcile(userId)).toBe(0n);
        expect((await fixture.prisma.waterWallet.findUniqueOrThrow({ where: { userId } })).balanceMl).toBe(0n);
    }, 60_000);

    it('classifies all 100 concurrent same-key credits as one commit and 99 replays', async () => {
        const userId = await fixture.createUser();
        const command = walletCommand(userId, 'tests:concurrent-same-key', 777n);

        const outcomes = await startTogether(
            Array.from({ length: 100 }, (_, index) => () => services[index % services.length].credit(command)),
        );

        expect(outcomes.every((outcome) => outcome.status === 'fulfilled')).toBe(true);
        const results = outcomes.flatMap((outcome) => (outcome.status === 'fulfilled' ? [outcome.value] : []));
        expect(results.filter((result) => !result.idempotentReplay)).toHaveLength(1);
        expect(results.filter((result) => result.idempotentReplay)).toHaveLength(99);
        expect(new Set(results.map((result) => result.entryId)).size).toBe(1);
        expect(await fixture.repository.reconcile(userId)).toBe(777n);
        expect(await fixture.prisma.walletLedgerEntry.count({ where: { walletUserId: userId } })).toBe(1);
    }, 60_000);
});

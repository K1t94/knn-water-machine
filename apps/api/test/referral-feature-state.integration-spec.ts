import { setTimeout as delay } from 'node:timers/promises';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaReferralFeatureStateRepository } from '../src/referral/infrastructure/postgres/prisma-referral-feature-state.repository';

import {
    createIndependentReferralPrismaClient,
    createReferralPostgresSchema,
    disposeReferralPostgresSchema,
    lockReferralFeatureState,
    referralPostgresEnabled,
    resetReferralFeatureState,
} from './referral-postgres.fixture';

import type { ReferralPostgresSchema } from './referral-postgres.fixture';
import type { PrismaClient } from '@prisma/client';

const describePostgres = referralPostgresEnabled ? describe : describe.skip;

interface Deferred {
    readonly promise: Promise<void>;
    resolve(): void;
}

function deferred(): Deferred {
    let resolve = (): void => undefined;
    const promise = new Promise<void>((complete) => {
        resolve = complete;
    });
    return { promise, resolve };
}

async function expectPending(operation: Promise<unknown>): Promise<void> {
    let settled = false;
    void operation.then(
        () => {
            settled = true;
        },
        () => {
            settled = true;
        },
    );
    await delay(75);
    expect(settled).toBe(false);
}

describePostgres('referral feature state repository', () => {
    let fixture: ReferralPostgresSchema;
    let firstClient: PrismaClient;
    let secondClient: PrismaClient;
    let firstRepository: PrismaReferralFeatureStateRepository;
    let secondRepository: PrismaReferralFeatureStateRepository;

    beforeAll(async () => {
        fixture = await createReferralPostgresSchema('feature_state');
        fixture.deploy();
        firstClient = await createIndependentReferralPrismaClient(fixture.url);
        secondClient = await createIndependentReferralPrismaClient(fixture.url);
        firstRepository = new PrismaReferralFeatureStateRepository(firstClient);
        secondRepository = new PrismaReferralFeatureStateRepository(secondClient);
    }, 30_000);

    beforeEach(async () => {
        await resetReferralFeatureState(fixture.prisma);
    });

    afterAll(async () => {
        await Promise.all([firstClient.$disconnect(), secondClient.$disconnect()]);
        await disposeReferralPostgresSchema(fixture);
    });

    it('makes real transitions visible across API instances with monotonic revisions', async () => {
        const disabled = await firstRepository.setEnabled({ enabled: false });
        expect(disabled).toEqual(expect.objectContaining({ enabled: false, revision: 2n }));
        await expect(secondRepository.readAvailability()).resolves.toEqual(disabled);

        const enabled = await secondRepository.setEnabled({ enabled: true });
        expect(enabled).toEqual(expect.objectContaining({ enabled: true, revision: 3n }));
        await expect(firstRepository.readAvailability()).resolves.toEqual(enabled);
    });

    it('does not change revision or timestamp for an idempotent same-value update', async () => {
        const before = await firstRepository.readAvailability();
        await delay(5);

        const unchanged = await secondRepository.setEnabled({ enabled: true });

        expect(unchanged).toEqual(before);
    });

    it('serializes concurrent same-value updates into one revision transition', async () => {
        const results = await Promise.all(
            Array.from({ length: 10 }, (_, index) =>
                (index % 2 === 0 ? firstRepository : secondRepository).setEnabled({ enabled: false }),
            ),
        );

        expect(results.every(({ enabled, revision }) => !enabled && revision === 2n)).toBe(true);
        await expect(firstRepository.readAvailability()).resolves.toEqual(
            expect.objectContaining({ enabled: false, revision: 2n }),
        );
    });

    it('makes an exclusive update wait for an existing shared operation lock', async () => {
        const sharedAcquired = deferred();
        const releaseShared = deferred();
        const sharedHolder = firstClient.$transaction(async (transaction) => {
            expect(await firstRepository.isEnabledWithSharedLock(transaction)).toBe(true);
            sharedAcquired.resolve();
            await releaseShared.promise;
        });
        await sharedAcquired.promise;

        const update = secondRepository.setEnabled({ enabled: false });
        await expectPending(update);
        releaseShared.resolve();

        await expect(sharedHolder).resolves.toBeUndefined();
        await expect(update).resolves.toEqual(expect.objectContaining({ enabled: false, revision: 2n }));
    });

    it('makes a shared operation lock wait for an existing exclusive toggle lock', async () => {
        const exclusiveAcquired = deferred();
        const releaseExclusive = deferred();
        const exclusiveHolder = firstClient.$transaction(async (transaction) => {
            await lockReferralFeatureState(transaction, 'UPDATE');
            exclusiveAcquired.resolve();
            await releaseExclusive.promise;
        });
        await exclusiveAcquired.promise;

        const sharedRead = secondClient.$transaction((transaction) =>
            secondRepository.isEnabledWithSharedLock(transaction),
        );
        await expectPending(sharedRead);
        releaseExclusive.resolve();

        await expect(exclusiveHolder).resolves.toBeUndefined();
        await expect(sharedRead).resolves.toBe(true);
    });
});
